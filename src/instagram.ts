/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * Conexão com o Instagram (API do Instagram com login do Instagram) e publicação de posts e carrosséis.
 *
 * Fluxo de conexão: o admin é mandado ao instagram.com, autoriza, volta com um "code";
 * trocamos por um token curto e depois por um token longo (60 dias), que é renovado sozinho.
 * O token fica no banco criptografado (AES-256-GCM com chave derivada do IG_APP_SECRET).
 *
 * Publicação: salvamos cada imagem como JPEG numa pasta pública temporária, criamos os
 * "containers" na API, esperamos ficarem prontos e publicamos. Depois apagamos os arquivos.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { config, igMediaDir } from './config.js';
import { getSetting, setSetting } from './db.js';

export class IgError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const DAY = 86_400_000;
fs.mkdirSync(igMediaDir, { recursive: true });

// ---------------------------------------------------------------- configuração e conta
export function igConfigured(): boolean {
  return !!(config.igAppId && config.igAppSecret && config.publicUrl);
}
export const redirectUri = () => `${config.publicUrl}/instagram/retorno`;

interface Account {
  igUserId: string;
  username: string;
  token: string;
  expiresAt: number;      // ms
  obtainedAt: number;     // ms (renovação só depois de 24 h)
  connectedBy: number;
  connectedAt: number;
}

function key(): Buffer {
  return crypto.createHash('sha256').update('estudio-megadino:' + config.igAppSecret).digest();
}
function seal(text: string): string {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([c.update(text, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), enc].map((b) => b.toString('base64')).join('.');
}
function open(box: string): string {
  const [iv, tag, enc] = box.split('.').map((s) => Buffer.from(s, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(enc), d.final()]).toString('utf8');
}

export function getAccount(): Account | null {
  const raw = getSetting('ig_account');
  if (!raw || !config.igAppSecret) return null;
  try {
    return JSON.parse(open(raw)) as Account;
  } catch {
    return null; // segredo do app mudou: precisa conectar de novo
  }
}
function saveAccount(a: Account | null): void {
  setSetting('ig_account', a ? seal(JSON.stringify(a)) : null);
}
export function disconnect(): void {
  saveAccount(null);
}

/** Se os editores também podem publicar (o admin sempre pode). */
export function editorsCanPublish(): boolean {
  return getSetting('ig_editors_publish') === '1';
}
export function setEditorsCanPublish(v: boolean): void {
  setSetting('ig_editors_publish', v ? '1' : '0');
}

export function status() {
  const a = getAccount();
  return {
    configured: igConfigured(),
    connected: !!a && a.expiresAt > Date.now(),
    expired: !!a && a.expiresAt <= Date.now(),
    username: a?.username ?? null,
    expiresAt: a ? new Date(a.expiresAt).toISOString() : null,
    connectedAt: a ? new Date(a.connectedAt).toISOString() : null,
    editorsCanPublish: editorsCanPublish(),
    redirectUri: config.publicUrl ? redirectUri() : null,
  };
}

// ---------------------------------------------------------------- chamadas HTTP
async function call(url: string, init?: RequestInit): Promise<Record<string, unknown>> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(30_000) });
  } catch {
    throw new IgError('Não foi possível falar com o Instagram agora. Tente de novo em instantes.');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok || body.error || body.error_type) {
    throw new IgError(igMessage(body), res.status === 400 || res.status === 403 ? 400 : 502);
  }
  return body;
}

/** Traduz os erros mais comuns da API para algo que a equipe entende. */
function igMessage(body: Record<string, unknown>): string {
  const e = (body.error ?? {}) as { message?: string; code?: number; error_subcode?: number; error_user_msg?: string };
  const msg = e.error_user_msg || e.message || (body.error_message as string) || '';
  const code = e.code;
  if (code === 190) return 'A conexão com o Instagram expirou ou foi revogada. Peça ao administrador para conectar de novo.';
  if (code === 4 || code === 17 || code === 32 || code === 613) return 'O Instagram limitou as publicações por hoje. Tente de novo mais tarde.';
  if (code === 10 || code === 200) return 'O app não tem permissão para publicar nessa conta. Confira as permissões na Meta e conecte de novo.';
  if (code === 9004 || /media|image/i.test(msg) && /download|fetch|url/i.test(msg)) {
    return 'O Instagram não conseguiu baixar a imagem. Confira se o site está acessível pela internet (PUBLIC_URL).';
  }
  if (code === 36003) return 'A proporção da imagem não é aceita pelo Instagram.';
  return 'O Instagram recusou a publicação' + (msg ? ': ' + msg : '.');
}

const graph = (p: string) => `${config.igGraphUrl}/${config.igApiVersion}/${p}`;

// ---------------------------------------------------------------- conexão (OAuth)
export function authorizeUrl(state: string): string {
  const q = new URLSearchParams({
    client_id: config.igAppId,
    redirect_uri: redirectUri(),
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_content_publish',
    state,
  });
  return `${config.igAuthUrl}?${q.toString()}`;
}

export async function finishConnect(code: string, userId: number): Promise<Account> {
  const form = new URLSearchParams({
    client_id: config.igAppId,
    client_secret: config.igAppSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri(),
    code: code.replace(/#_$/, ''),
  });
  const short = await call(config.igTokenUrl, { method: 'POST', body: form });
  const shortToken = String(short.access_token ?? '');
  if (!shortToken) throw new IgError('O Instagram não devolveu o acesso. Tente conectar de novo.');
  const long = await call(`${config.igGraphUrl}/access_token?` + new URLSearchParams({
    grant_type: 'ig_exchange_token', client_secret: config.igAppSecret, access_token: shortToken,
  }).toString());
  const token = String(long.access_token ?? '');
  const me = await call(graph('me') + '?' + new URLSearchParams({ fields: 'user_id,username,account_type', access_token: token }).toString());
  const now = Date.now();
  const acc: Account = {
    igUserId: String(me.user_id ?? me.id ?? short.user_id ?? ''),
    username: String(me.username ?? ''),
    token,
    expiresAt: now + Number(long.expires_in ?? 60 * 86_400) * 1000,
    obtainedAt: now,
    connectedBy: userId,
    connectedAt: now,
  };
  if (!acc.igUserId) throw new IgError('Não foi possível identificar a conta do Instagram.');
  saveAccount(acc);
  return acc;
}

/** Renova o token quando faltam menos de 20 dias (a API só renova tokens com mais de 24 h). */
export async function refreshIfNeeded(): Promise<void> {
  const a = getAccount();
  if (!a || a.expiresAt <= Date.now()) return;
  if (a.expiresAt - Date.now() > 20 * DAY || Date.now() - a.obtainedAt < DAY) return;
  try {
    const r = await call(`${config.igGraphUrl}/refresh_access_token?` + new URLSearchParams({ grant_type: 'ig_refresh_token', access_token: a.token }).toString());
    const now = Date.now();
    saveAccount({ ...a, token: String(r.access_token ?? a.token), expiresAt: now + Number(r.expires_in ?? 60 * 86_400) * 1000, obtainedAt: now });
    console.log('[instagram] token renovado');
  } catch (e) {
    console.error('[instagram] falha ao renovar o token:', (e as Error).message);
  }
}

// ---------------------------------------------------------------- publicação
/** Grava o JPEG numa pasta pública com nome aleatório; devolve [url, caminho]. */
function stage(jpeg: Buffer): [string, string] {
  const name = crypto.randomBytes(20).toString('hex') + '.jpg';
  const file = path.join(igMediaDir, name);
  fs.writeFileSync(file, jpeg);
  return [`${config.publicUrl}/ig-media/${name}`, file];
}

/** Apaga imagens temporárias esquecidas (mais de 2 h). */
export function cleanMedia(): void {
  const limit = Date.now() - 2 * 3_600_000;
  for (const f of fs.readdirSync(igMediaDir)) {
    const p = path.join(igMediaDir, f);
    try { if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p); } catch { /* já apagado */ }
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function waitReady(id: string, token: string): Promise<void> {
  for (let i = 0; i < 40; i++) {
    const r = await call(graph(id) + '?' + new URLSearchParams({ fields: 'status_code,status', access_token: token }).toString());
    const s = String(r.status_code ?? '');
    if (s === 'FINISHED' || s === 'PUBLISHED') return;
    if (s === 'ERROR' || s === 'EXPIRED') throw new IgError('O Instagram não conseguiu processar a imagem' + (r.status ? ` (${r.status})` : '') + '.');
    await sleep(i < 5 ? 1000 : 2500);
  }
  throw new IgError('O Instagram demorou demais para processar. Confira no app se a publicação saiu antes de tentar de novo.');
}

export interface PublishResult { mediaId: string; permalink: string | null; username: string }

/**
 * Publica 1 imagem (post) ou de 2 a 10 (carrossel) com a legenda.
 * `jpegs` são os arquivos já em JPEG 1080×1350.
 */
export async function publish(jpegs: Buffer[], caption: string, onStep?: (s: string) => void): Promise<PublishResult> {
  const a = getAccount();
  if (!a) throw new IgError('O Instagram não está conectado. Peça ao administrador para conectar em Administração > Instagram.', 400);
  if (a.expiresAt <= Date.now()) throw new IgError('A conexão com o Instagram expirou. Peça ao administrador para conectar de novo.', 400);
  const me = a.igUserId, token = a.token;
  const files: string[] = [];
  try {
    const urls = jpegs.map((j) => { const [u, f] = stage(j); files.push(f); return u; });
    let creation: string;
    if (urls.length === 1) {
      onStep?.('Enviando a imagem');
      const r = await call(graph(`${me}/media`), { method: 'POST', body: new URLSearchParams({ image_url: urls[0], caption, access_token: token }) });
      creation = String(r.id);
    } else {
      const children: string[] = [];
      for (const [i, u] of urls.entries()) {
        onStep?.(`Enviando imagem ${i + 1} de ${urls.length}`);
        const r = await call(graph(`${me}/media`), { method: 'POST', body: new URLSearchParams({ image_url: u, is_carousel_item: 'true', access_token: token }) });
        children.push(String(r.id));
      }
      for (const c of children) await waitReady(c, token);
      onStep?.('Montando o carrossel');
      const r = await call(graph(`${me}/media`), { method: 'POST', body: new URLSearchParams({ media_type: 'CAROUSEL', children: children.join(','), caption, access_token: token }) });
      creation = String(r.id);
    }
    await waitReady(creation, token);
    onStep?.('Publicando');
    const pub = await call(graph(`${me}/media_publish`), { method: 'POST', body: new URLSearchParams({ creation_id: creation, access_token: token }) });
    const mediaId = String(pub.id);
    let permalink: string | null = null;
    try {
      const info = await call(graph(mediaId) + '?' + new URLSearchParams({ fields: 'permalink', access_token: token }).toString());
      permalink = info.permalink ? String(info.permalink) : null;
    } catch { /* o post saiu; só não veio o link */ }
    return { mediaId, permalink, username: a.username };
  } finally {
    for (const f of files) fs.rm(f, { force: true }, () => {});
  }
}
