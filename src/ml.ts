/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * Studio ML: busca de produtos no Mercado Livre (API oficial) com scraping próprio de reserva.
 *
 * Conexão: o admin autoriza o app do ML uma vez (OAuth). O token de acesso dura 6 h e é
 * renovado sozinho com o refresh token (que também troca a cada renovação). Tudo fica no
 * banco criptografado com chave derivada do ML_CLIENT_SECRET.
 *
 * Busca: catálogo de produtos (/products/search) + anúncios (/sites/MLB/search). Se nada vier,
 * chama o scraping próprio (SCRAPER_URL). Detalhe: junta ficha, descrições e fotos do catálogo
 * e dos anúncios de concorrentes, guardando de onde veio cada coisa.
 */
import crypto from 'node:crypto';
import { config } from './config.js';
import { getSetting, setSetting } from './db.js';

export class MlError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

export const mlConfigured = () => !!(config.mlClientId && config.mlClientSecret && config.publicUrl);
export const mlRedirectUri = () => `${config.publicUrl}/ml/retorno`;
export const scraperOn = () => !!config.scraperUrl;

interface MlAccount { userId: string; nickname: string; access: string; refresh: string; expiresAt: number; connectedAt: number; connectedBy: number }

const key = () => crypto.createHash('sha256').update('estudio-ml:' + config.mlClientSecret).digest();
function seal(t: string): string {
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const e = Buffer.concat([c.update(t, 'utf8'), c.final()]);
  return [iv, c.getAuthTag(), e].map((b) => b.toString('base64')).join('.');
}
function unseal(b: string): string {
  const [iv, tag, e] = b.split('.').map((x) => Buffer.from(x, 'base64'));
  const d = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  d.setAuthTag(tag);
  return Buffer.concat([d.update(e), d.final()]).toString('utf8');
}
function getAcc(): MlAccount | null {
  const raw = getSetting('ml_account');
  if (!raw || !config.mlClientSecret) return null;
  try { return JSON.parse(unseal(raw)) as MlAccount; } catch { return null; }
}
const saveAcc = (a: MlAccount | null) => setSetting('ml_account', a ? seal(JSON.stringify(a)) : null);
export const mlDisconnect = () => saveAcc(null);

export function mlStatus() {
  const a = getAcc();
  return {
    configured: mlConfigured(),
    connected: !!a,
    nickname: a?.nickname ?? null,
    connectedAt: a ? new Date(a.connectedAt).toISOString() : null,
    scraper: scraperOn(),
    redirectUri: config.publicUrl ? mlRedirectUri() : null,
  };
}

// ---------------------------------------------------------------- HTTP
async function http(url: string, init?: RequestInit, timeout = 20_000): Promise<{ status: number; body: Record<string, unknown> }> {
  let res: Response;
  try {
    res = await fetch(url, { ...init, signal: AbortSignal.timeout(timeout) });
  } catch {
    throw new MlError('Não foi possível falar com o Mercado Livre agora. Tente de novo em instantes.');
  }
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  return { status: res.status, body };
}

// ---------------------------------------------------------------- OAuth
export function mlAuthorizeUrl(state: string): string {
  return `${config.mlAuthUrl}?` + new URLSearchParams({ response_type: 'code', client_id: config.mlClientId, redirect_uri: mlRedirectUri(), state }).toString();
}

async function tokenCall(form: Record<string, string>) {
  const r = await http(`${config.mlApiUrl}/oauth/token`, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.mlClientId, client_secret: config.mlClientSecret, ...form }),
  });
  if (r.status !== 200 || !r.body.access_token) {
    const msg = String(r.body.message ?? r.body.error ?? '');
    throw new MlError('O Mercado Livre recusou a conexão' + (msg ? ': ' + msg : '.') + ' Tente conectar de novo.', 400);
  }
  return r.body as { access_token: string; refresh_token: string; expires_in: number; user_id: number };
}

export async function mlFinishConnect(code: string, by: number): Promise<MlAccount> {
  const t = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: mlRedirectUri() });
  const me = await http(`${config.mlApiUrl}/users/me`, { headers: { authorization: 'Bearer ' + t.access_token } });
  const now = Date.now();
  const acc: MlAccount = {
    userId: String(t.user_id ?? me.body.id ?? ''), nickname: String(me.body.nickname ?? ''),
    access: t.access_token, refresh: t.refresh_token, expiresAt: now + (t.expires_in || 21600) * 1000, connectedAt: now, connectedBy: by,
  };
  saveAcc(acc);
  return acc;
}

let refreshing: Promise<string> | null = null;
async function accessToken(force = false): Promise<string> {
  const a = getAcc();
  if (!a) throw new MlError('O Mercado Livre não está conectado. Peça ao administrador para conectar em Administração > Mercado Livre.', 400);
  if (!force && a.expiresAt - Date.now() > 5 * 60_000) return a.access;
  // Uma renovação por vez: o refresh token do ML só pode ser usado uma vez.
  refreshing ??= (async () => {
    try {
      const t = await tokenCall({ grant_type: 'refresh_token', refresh_token: a.refresh });
      saveAcc({ ...a, access: t.access_token, refresh: t.refresh_token || a.refresh, expiresAt: Date.now() + (t.expires_in || 21600) * 1000 });
      return t.access_token;
    } catch {
      throw new MlError('A conexão com o Mercado Livre expirou. Peça ao administrador para conectar de novo.', 400);
    } finally {
      setTimeout(() => { refreshing = null; }, 0);
    }
  })();
  return refreshing;
}

/** GET na API do ML com o token (renova e tenta de novo uma vez se vier 401). */
async function ml(path: string): Promise<{ status: number; body: Record<string, unknown> }> {
  let tok = await accessToken();
  let r = await http(config.mlApiUrl + path, { headers: { authorization: 'Bearer ' + tok } });
  if (r.status === 401) {
    tok = await accessToken(true);
    r = await http(config.mlApiUrl + path, { headers: { authorization: 'Bearer ' + tok } });
  }
  return r;
}

/** Mantém o acesso vivo mesmo sem uso (o refresh token vence se ficar 6 meses parado). */
export async function mlKeepAlive(): Promise<void> {
  if (!getAcc()) return;
  try { await accessToken(); } catch (e) { console.error('[ml]', (e as Error).message); }
}

// ---------------------------------------------------------------- tipos de resultado
export interface Candidate {
  kind: 'catalogo' | 'anuncio' | 'scraping';
  id: string;
  title: string;
  thumb: string | null;
  brand?: string;
  price?: number | null;
  seller?: string;
  permalink?: string;
  origin?: string;
}
export interface Picture { url: string; thumb: string; source: string; sourceUrl?: string; w?: number; h?: number }
export interface Detail {
  title: string;
  brand: string;
  model: string;
  sources: { kind: string; id: string; title: string; permalink?: string }[];
  attributes: { name: string; value: string }[];
  texts: { source: string; title: string; text: string }[];
  pictures: Picture[];
  notes: string[];
}

const up = (u: string) => (/mlstatic\.com/.test(u) ? u.replace(/^http:\/\//, 'https://') : u);
const big = (u: string) => up(u).replace(/-[A-Z](\.(?:jpg|jpeg|webp|png))$/i, '-F$1'); // -F = maior versão (ex.: 1051×1200)
const small = (u: string) => up(u).replace(/-[A-Z](\.(?:jpg|jpeg|webp|png))$/i, '-I$1');
const attrVal = (a: Record<string, unknown>) => String(a.value_name ?? (Array.isArray(a.values) ? (a.values as { name?: string }[]).map((v) => v.name).filter(Boolean).join(', ') : '') ?? '').trim();
const pickAttr = (list: Record<string, unknown>[], id: string) => attrVal(list.find((a) => a.id === id) ?? {});
// Atributos internos do ML que não interessam na ficha.
const SKIP = new Set(['ITEM_CONDITION', 'SELLER_SKU', 'GTIN', 'EAN', 'UPC', 'MPN', 'SALE_FORMAT', 'IS_KIT', 'IS_FLAMMABLE', 'HAS_COMPATIBILITIES', 'PRODUCT_DATA_SOURCE', 'SHIPMENT_PACKING', 'PACKAGE_WEIGHT', 'PACKAGE_HEIGHT', 'PACKAGE_WIDTH', 'PACKAGE_LENGTH', 'EXCLUSIVE_CHANNEL', 'GIFTABLE', 'VALUE_ADDED_TAX', 'IMPORT_DUTY']);

// ---------------------------------------------------------------- scraping de reserva
async function scraper(body: Record<string, unknown>): Promise<Record<string, unknown> | null> {
  if (!scraperOn()) return null;
  const r = await http(config.scraperUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(config.scraperToken ? { authorization: 'Bearer ' + config.scraperToken } : {}) },
    body: JSON.stringify(body),
  }, 60_000).catch(() => null);
  if (!r || r.status !== 200) return null;
  return r.body;
}

// ---------------------------------------------------------------- busca
export async function mlSearch(q: string): Promise<{ results: Candidate[]; notes: string[] }> {
  const notes: string[] = [];
  const out: Candidate[] = [];
  const enc = encodeURIComponent(q);
  // Sem conta do ML conectada no Studio: usa direto o sistema próprio (que já tem a conta e o scraping).
  if (!getAcc() && scraperOn()) {
    const s = await scraper({ acao: 'buscar', q });
    if (!s) throw new MlError('O sistema de scraping não respondeu. Confira SCRAPER_URL e se o serviço está no ar.', 502);
    if (s.erro) throw new MlError(String(s.erro).slice(0, 200), 502);
    for (const n of ((s.avisos as string[]) ?? []).slice(0, 3)) notes.push(String(n).slice(0, 200));
    for (const it of ((s.resultados as Record<string, unknown>[]) ?? []).slice(0, 24)) {
      out.push({ kind: 'scraping', id: String(it.url ?? it.id ?? ''), title: String(it.titulo ?? ''), thumb: it.foto ? String(it.foto) : null, price: typeof it.preco === 'number' ? it.preco : null, seller: String(it.vendedor ?? ''), permalink: String(it.url ?? ''), origin: it.tipo === 'catalogo' ? 'Catálogo ML' : it.tipo === 'anuncio' ? 'Anúncio' : 'Sistema próprio' });
    }
    return { results: out, notes };
  }
  const [cat, ads] = await Promise.all([
    ml(`/products/search?status=active&site_id=MLB&q=${enc}&limit=12`).catch((e) => { throw e; }),
    ml(`/sites/MLB/search?q=${enc}&limit=24`).catch(() => ({ status: 0, body: {} as Record<string, unknown> })),
  ]);
  if (cat.status === 200) {
    for (const p of ((cat.body.results as Record<string, unknown>[]) ?? [])) {
      const attrs = (p.attributes as Record<string, unknown>[]) ?? [];
      const pic = ((p.pictures as { url?: string }[]) ?? [])[0]?.url;
      out.push({ kind: 'catalogo', id: String(p.id), title: String(p.name ?? ''), thumb: pic ? small(pic) : null, brand: pickAttr(attrs, 'BRAND') });
    }
  } else notes.push('O catálogo do ML não respondeu (' + cat.status + ').');
  if (ads.status === 200) {
    for (const it of ((ads.body.results as Record<string, unknown>[]) ?? [])) {
      const seller = it.seller as { nickname?: string } | undefined;
      out.push({ kind: 'anuncio', id: String(it.id), title: String(it.title ?? ''), thumb: it.thumbnail ? small(String(it.thumbnail)) : null, price: typeof it.price === 'number' ? it.price : null, seller: seller?.nickname ?? '', permalink: String(it.permalink ?? '') });
    }
  } else if (ads.status) notes.push('A busca de anúncios do ML não está liberada para este app (' + ads.status + ').');
  if (!out.length) {
    const s = await scraper({ acao: 'buscar', q });
    for (const it of ((s?.resultados as Record<string, unknown>[]) ?? []).slice(0, 24)) {
      out.push({ kind: 'scraping', id: String(it.url ?? it.id ?? ''), title: String(it.titulo ?? ''), thumb: it.foto ? String(it.foto) : null, price: typeof it.preco === 'number' ? it.preco : null, seller: String(it.vendedor ?? ''), permalink: String(it.url ?? ''), origin: it.tipo === 'catalogo' ? 'Catálogo ML' : it.tipo === 'anuncio' ? 'Anúncio' : 'Sistema próprio' });
    }
    if (s) notes.push('Resultados do scraping próprio (o ML não trouxe nada pela API).');
  }
  return { results: out, notes };
}

// ---------------------------------------------------------------- detalhe
async function itemsFull(ids: string[]): Promise<Record<string, unknown>[]> {
  if (!ids.length) return [];
  const r = await ml(`/items?ids=${ids.slice(0, 20).join(',')}`);
  if (r.status !== 200 || !Array.isArray(r.body)) return [];
  return (r.body as unknown as { code: number; body: Record<string, unknown> }[]).filter((x) => x.code === 200).map((x) => x.body);
}
async function itemDescription(id: string): Promise<string> {
  const r = await ml(`/items/${id}/description`).catch(() => null);
  return String(r?.body?.plain_text ?? '').trim();
}

export async function mlDetail(kind: string, id: string): Promise<Detail> {
  const d: Detail = { title: '', brand: '', model: '', sources: [], attributes: [], texts: [], pictures: [], notes: [] };
  const seenPic = new Set<string>();
  const addPic = (url: string, source: string, sourceUrl?: string, w?: number, h?: number) => {
    const k = url.replace(/-[A-Z]\.\w+$/, '').split('/').pop() || url;
    if (!url || seenPic.has(k) || d.pictures.length >= 30) return;
    seenPic.add(k);
    d.pictures.push({ url: big(url), thumb: small(url), source, sourceUrl, w, h });
  };
  const addAttrs = (list: Record<string, unknown>[]) => {
    for (const a of list) {
      const name = String(a.name ?? '').trim(), value = attrVal(a);
      if (!name || !value || SKIP.has(String(a.id))) continue;
      if (!d.attributes.some((x) => x.name.toLowerCase() === name.toLowerCase())) d.attributes.push({ name, value });
    }
  };
  const addItems = async (items: Record<string, unknown>[], max: number) => {
    for (const it of items.slice(0, max)) {
      const who = 'Anúncio de ' + (String((it.seller as { nickname?: string })?.nickname ?? '') || ('vendedor ' + String(it.seller_id ?? '')));
      d.sources.push({ kind: 'anuncio', id: String(it.id), title: String(it.title ?? ''), permalink: String(it.permalink ?? '') });
      addAttrs((it.attributes as Record<string, unknown>[]) ?? []);
      for (const p of ((it.pictures as { secure_url?: string; url?: string; max_size?: string }[]) ?? [])) {
        const [w, h] = String(p.max_size ?? '').split('x').map(Number);
        addPic(String(p.secure_url ?? p.url ?? ''), who, String(it.permalink ?? ''), w, h);
      }
      const text = await itemDescription(String(it.id));
      if (text) d.texts.push({ source: who, title: String(it.title ?? ''), text: text.slice(0, 6000) });
    }
  };

  if (kind === 'catalogo') {
    const r = await ml(`/products/${encodeURIComponent(id)}`);
    if (r.status !== 200) throw new MlError('Não encontrei esse produto no catálogo do ML.', 404);
    const p = r.body;
    const attrs = (p.attributes as Record<string, unknown>[]) ?? [];
    d.title = String(p.name ?? ''); d.brand = pickAttr(attrs, 'BRAND'); d.model = pickAttr(attrs, 'MODEL');
    d.sources.push({ kind: 'catalogo', id, title: d.title, permalink: String(p.permalink ?? '') });
    addAttrs(attrs);
    for (const pic of ((p.pictures as { url?: string; max_width?: number; max_height?: number }[]) ?? [])) addPic(String(pic.url ?? ''), 'Catálogo do ML', String(p.permalink ?? ''), pic.max_width, pic.max_height);
    const sd = (p.short_description as { content?: string } | undefined)?.content ?? '';
    const feats = ((p.main_features as { text?: string }[]) ?? []).map((f) => f.text).filter(Boolean).join('\n');
    if (sd || feats) d.texts.push({ source: 'Catálogo do ML', title: d.title, text: [sd, feats].filter(Boolean).join('\n\n').slice(0, 6000) });
    const li = await ml(`/products/${encodeURIComponent(id)}/items?limit=6`).catch(() => null);
    const sellers = ((li?.body?.results as { item_id?: string; seller_id?: number; price?: number }[]) ?? []).filter((x) => x.item_id);
    const ids = sellers.map((x) => String(x.item_id));
    const full = await itemsFull(ids);
    if (full.length) await addItems(full, 4);
    else {
      // O ML bloqueia (403) o anúncio de outro vendedor, mas libera a descrição dele.
      for (const x of sellers.slice(0, 3)) {
        const text = await itemDescription(String(x.item_id));
        const who = 'Anúncio ' + x.item_id + (typeof x.price === 'number' ? ' (' + x.price.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' }) + ')' : '');
        d.sources.push({ kind: 'anuncio', id: String(x.item_id), title: who, permalink: `https://produto.mercadolivre.com.br/${String(x.item_id).replace(/^MLB/, 'MLB-')}` });
        if (text) d.texts.push({ source: who, title: d.title, text: text.slice(0, 6000) });
      }
      if (sellers.length) d.notes.push('A API do ML não libera fotos e ficha de anúncios de outros vendedores; vieram as fotos e a ficha do catálogo e as descrições dos concorrentes.');
    }
    if (!ids.length) d.notes.push('Esse produto do catálogo não tem anúncios ativos de concorrentes agora.');
  } else if (kind === 'anuncio') {
    const items = await itemsFull([id]);
    if (!items.length) throw new MlError('Não encontrei esse anúncio no ML.', 404);
    const it = items[0], attrs = (it.attributes as Record<string, unknown>[]) ?? [];
    d.title = String(it.title ?? ''); d.brand = pickAttr(attrs, 'BRAND'); d.model = pickAttr(attrs, 'MODEL');
    await addItems([it], 1);
    // Se o anúncio é de um produto do catálogo, junta também a ficha oficial.
    if (it.catalog_product_id) {
      const r = await ml(`/products/${it.catalog_product_id}`).catch(() => null);
      if (r?.status === 200) {
        addAttrs((r.body.attributes as Record<string, unknown>[]) ?? []);
        for (const pic of ((r.body.pictures as { url?: string }[]) ?? [])) addPic(String(pic.url ?? ''), 'Catálogo do ML');
        d.sources.push({ kind: 'catalogo', id: String(it.catalog_product_id), title: String(r.body.name ?? ''), permalink: '' });
      }
    }
  } else {
    const s = await scraper({ acao: 'detalhe', url: id });
    if (!s) throw new MlError('O scraping próprio não respondeu.', 502);
    if (s.erro) throw new MlError(String(s.erro).slice(0, 200), 502);
    const p = (s.produto ?? s) as Record<string, unknown>;
    d.title = String(p.titulo ?? ''); d.brand = String(p.marca ?? ''); d.model = String(p.modelo ?? '');
    const origem = String(p.fonte ?? 'Sistema próprio');
    d.sources.push({ kind: 'scraping', id, title: d.title, permalink: String(p.url ?? id) });
    for (const a of ((p.ficha as { nome?: string; valor?: string }[]) ?? [])) if (a.nome && a.valor) d.attributes.push({ name: String(a.nome), value: String(a.valor) });
    if (p.descricao) d.texts.push({ source: origem, title: d.title, text: String(p.descricao).slice(0, 6000) });
    // Opcional: várias descrições (ex.: dos concorrentes do catálogo) e fotos com origem.
    for (const t of ((p.descricoes as { fonte?: string; texto?: string }[]) ?? []).slice(0, 4)) if (t?.texto) d.texts.push({ source: String(t.fonte ?? 'Anúncio'), title: d.title, text: String(t.texto).slice(0, 6000) });
    for (const f of ((p.fotos as (string | { url?: string; fonte?: string; largura?: number; altura?: number })[]) ?? [])) {
      if (typeof f === 'string') addPic(f, origem + (p.vendedor ? ' · ' + String(p.vendedor) : ''), String(p.url ?? id));
      else if (f?.url) addPic(String(f.url), String(f.fonte ?? origem), String(p.url ?? id), f.largura, f.altura);
    }
    for (const n of ((p.avisos as string[]) ?? []).slice(0, 4)) d.notes.push(String(n).slice(0, 200));
  }
  d.attributes = d.attributes.slice(0, 40);
  return d;
}

/** Busca os dados da loja pelo SKU/EAN no sistema próprio (ação opcional "produto_loja"). */
export async function mlLookup(codigo: string, empresa: string): Promise<{ produto: Record<string, unknown> | null; aviso?: string }> {
  if (!scraperOn()) return { produto: null, aviso: 'O sistema próprio não está configurado (SCRAPER_URL).' };
  const s = await scraper({ acao: 'produto_loja', codigo, empresa });
  if (!s) return { produto: null, aviso: 'O sistema próprio não respondeu ou ainda não tem a busca por SKU/EAN.' };
  if (s.erro) return { produto: null, aviso: String(s.erro).slice(0, 200) };
  return { produto: (s.produto as Record<string, unknown>) ?? null, aviso: s.produto ? undefined : 'Nada encontrado com esse código.' };
}

/** Só deixa o proxy de imagem buscar fotos do próprio ML. */
export function allowedImage(u: string): boolean {
  try {
    const h = new URL(u).hostname;
    if (process.env.ML_IMG_TEST_HOST && h === process.env.ML_IMG_TEST_HOST) return true;
    return /(^|\.)mlstatic\.com$/.test(h) || /(^|\.)mercadolivre\.com\.br$/.test(h) || /(^|\.)mercadolibre\.com$/.test(h);
  } catch {
    return false;
  }
}
