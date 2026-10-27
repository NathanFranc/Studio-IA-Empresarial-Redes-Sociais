/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * Mídia dos concorrentes: pesquisa no bitbrain as fotos e vídeos da Shopee (vendedor e clientes) e do
 * Mercado Livre (concorrentes). Usa o mesmo SCRAPER_URL/SCRAPER_TOKEN do Studio ML.
 *
 * O token nunca vai para o navegador: toda chamada sai daqui e os arquivos passam por este servidor (proxy).
 */
import { Router, type Request, type Response } from 'express';
import { Readable } from 'node:stream';
import { config } from '../config.js';
import { logAction } from '../logs.js';

export const midiaRouter = Router();

/** SCRAPER_URL aponta para .../estudio/ml. A base (sem o caminho) serve para os downloads. */
function endpoints() {
  const u = config.scraperUrl;
  if (!u) return null;
  const base = /\/estudio\/ml$/.test(u) ? u.replace(/\/estudio\/ml$/, '') : u;
  const ml = /\/estudio\/ml$/.test(u) ? u : u + '/estudio/ml';
  return { base, ml, host: new URL(base).host };
}
const auth = (): Record<string, string> => (config.scraperToken ? { authorization: 'Bearer ' + config.scraperToken } : {});

export class MidiaError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

/** POST na rota do Estúdio no bitbrain. Repassa o {"erro"} e o status (ex.: 429) do bitbrain. */
export async function bitbrain(body: Record<string, unknown>): Promise<Record<string, unknown>> {
  const ep = endpoints();
  if (!ep) throw new MidiaError('O bitbrain não está configurado no servidor (SCRAPER_URL).', 400);
  let r: globalThis.Response;
  try {
    r = await fetch(ep.ml, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...auth() },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(30_000),
    });
  } catch {
    throw new MidiaError('O bitbrain não respondeu. Tente de novo em instantes.');
  }
  const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok || data.erro) {
    const msg = String(data.erro ?? '').slice(0, 300) || (r.status === 429 ? 'Muitas consultas ao mesmo tempo. Espere um pouco e tente de novo.' : 'O bitbrain recusou o pedido (' + r.status + ').');
    throw new MidiaError(msg, r.status >= 400 && r.status < 600 && r.status !== 401 && r.status !== 403 ? r.status : 502);
  }
  return data;
}

const fail = (res: Response, e: unknown) => {
  const err = e instanceof MidiaError ? e : new MidiaError('Algo falhou ao falar com o bitbrain. Tente de novo.');
  if (!(e instanceof MidiaError)) console.error('[midia]', e);
  res.status(err.status).json({ error: err.message });
};

// A rota do bitbrain aceita 30 chamadas/min no total. Várias abas olhando a mesma pesquisa usam a mesma resposta.
const cache = new Map<string, { at: number; data: Record<string, unknown> }>();
async function cached(key: string, ttl: number, load: () => Promise<Record<string, unknown>>) {
  const c = cache.get(key);
  if (c && Date.now() - c.at < ttl) return c.data;
  const data = await load();
  cache.set(key, { at: Date.now(), data });
  if (cache.size > 200) for (const [k, v] of cache) if (Date.now() - v.at > 60_000) cache.delete(k);
  return data;
}

const ID = /^[A-Za-z0-9_-]{1,64}$/;
const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

/** Troca os caminhos do bitbrain (/estudio/midia/...) pelos do proxy do Estúdio. */
function proxied(p: unknown): string | null {
  const s = String(p ?? '');
  if (!s) return null;
  const ep = endpoints();
  let path = s;
  if (/^https?:\/\//i.test(s)) {
    try {
      const u = new URL(s);
      if (!ep || u.host !== ep.host) return null; // fora do bitbrain: a página não carrega (CSP)
      path = u.pathname + u.search;
    } catch { return null; }
  }
  if (!/^\/estudio\/midia\/[A-Za-z0-9_\-./=?&%]+$/.test(path) || path.includes('..')) return null;
  return '/api/midia/f' + path.slice('/estudio/midia'.length);
}

function shape(data: Record<string, unknown>) {
  const p = (data.pesquisa ?? null) as Record<string, unknown> | null;
  if (p) p.zip = p.zip ? proxied(p.zip) : null;
  const arquivos = ((data.arquivos as Record<string, unknown>[]) ?? []).map((a) => ({
    ...a,
    download: proxied(a.download),
    capa_url: proxied(a.capa_url),
  }));
  return { pesquisa: p, coletor: data.coletor ?? null, arquivos };
}

// ----- consultas (JSON)
midiaRouter.get('/lista', async (_req, res) => {
  try {
    const d = await cached('lista', 8_000, () => bitbrain({ acao: 'midia_lista' }));
    const pesquisas = ((d.pesquisas as Record<string, unknown>[]) ?? []).map((p) => ({ ...p, zip: p.zip ? proxied(p.zip) : null }));
    res.json({ pesquisas, coletor: d.coletor ?? null });
  } catch (e) { fail(res, e); }
});

midiaRouter.post('/pesquisar', async (req, res) => {
  const termo = clip(req.body?.termo, 120), marca = clip(req.body?.marca, 60), modelo = clip(req.body?.modelo, 60);
  const sku = clip(req.body?.sku, 60);
  if (termo.length < 3) return void res.status(400).json({ error: 'Digite o produto (de 3 a 120 letras).' });
  try {
    const body: Record<string, unknown> = { acao: 'midia_pesquisar', termo, pedido_por: req.user!.name };
    if (marca) body.marca = marca;
    if (modelo) body.modelo = modelo;
    if (sku) body.sku = sku; // 2026-10-26: só um rótulo, aparece antes do nome nas últimas pesquisas
    const d = await bitbrain(body);
    cache.delete('lista');
    const p = (d.pesquisa ?? {}) as Record<string, unknown>;
    logAction(req, 'midia_pesquisar', { detail: { termo, marca, modelo, sku, id: p.id ?? null } });
    res.json(shape(d));
  } catch (e) {
    logAction(req, 'erro_midia', { detail: { etapa: 'pesquisar', termo, motivo: (e as Error).message } });
    fail(res, e);
  }
});

/** 2026-10-27 (Nathan: "eu so quero poder colocar uma lista de produtos no estudio e ele ir pegando os produtos um por
 *  um na midia dos concorrentes"): uma linha por produto (ou colunas do Excel: produto, marca, modelo, SKU). O bitbrain
 *  guarda tudo numa fila e pesquisa um produto por vez, mesmo com esta tela fechada. */
midiaRouter.post('/fila', async (req, res) => {
  const produtos = String(req.body?.produtos ?? '').slice(0, 20_000);
  if (!produtos.trim()) return void res.status(400).json({ error: 'Cole pelo menos um produto (um por linha).' });
  try {
    const d = await bitbrain({ acao: 'midia_fila', produtos, pedido_por: req.user!.name });
    cache.delete('lista');
    const ps = (d.pesquisas as Record<string, unknown>[]) ?? [];
    logAction(req, 'midia_fila', { detail: { quantidade: ps.length, ids: ps.map((p) => p.id) } });
    res.json({ quantidade: ps.length, na_fila: d.na_fila ?? ps.length });
  } catch (e) {
    logAction(req, 'erro_midia', { detail: { etapa: 'fila', motivo: (e as Error).message } });
    fail(res, e);
  }
});

midiaRouter.get('/pesquisa/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!ID.test(id)) return void res.status(400).json({ error: 'Pesquisa inválida.' });
  try {
    const d = await cached('p:' + id, 8_000, () => bitbrain({ acao: 'midia_situacao', id: /^\d+$/.test(id) ? Number(id) : id }));
    res.json(shape(d));
  } catch (e) { fail(res, e); }
});

/** Exclui a pesquisa e os arquivos dela no bitbrain (libera o espaço na hora). Em andamento, o bitbrain recusa (409). */
midiaRouter.delete('/pesquisa/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!/^\d{1,12}$/.test(id)) return void res.status(400).json({ error: 'Pesquisa inválida.' });
  try {
    await bitbrain({ acao: 'midia_excluir', id: Number(id) });
    cache.delete('lista');
    cache.delete('p:' + id);
    logAction(req, 'midia_excluir', { detail: { id: Number(id) } });
    res.json({ ok: true });
  } catch (e) {
    logAction(req, 'erro_midia', { detail: { etapa: 'excluir', id: Number(id), motivo: (e as Error).message } });
    fail(res, e);
  }
});

/** 2026-10-26 (Nathan: "na parte de últimas pesquisas apareça o sku do produto na frente do nome"): põe, troca ou tira
 *  (vazio) o SKU de uma pesquisa — botão "+ SKU"/"Trocar SKU" das últimas pesquisas. */
midiaRouter.post('/pesquisa/:id/sku', async (req, res) => {
  const id = String(req.params.id);
  if (!/^\d{1,12}$/.test(id)) return void res.status(400).json({ error: 'Pesquisa inválida.' });
  const sku = clip(req.body?.sku, 60);
  try {
    await bitbrain({ acao: 'midia_ligar_sku', id: Number(id), sku });
    cache.delete('lista');
    cache.delete('p:' + id);
    logAction(req, 'midia_sku', { detail: { id: Number(id), sku } });
    res.json({ ok: true });
  } catch (e) {
    logAction(req, 'erro_midia', { detail: { etapa: 'sku', id: Number(id), motivo: (e as Error).message } });
    fail(res, e);
  }
});

// ----- arquivos (proxy em streaming, com Range para o player de vídeo)
async function pipe(req: Request, res: Response, path: string, opts: { attach?: boolean; log?: Record<string, unknown> } = {}) {
  const ep = endpoints();
  if (!ep) return void res.status(400).json({ error: 'O bitbrain não está configurado no servidor (SCRAPER_URL).' });
  const ctrl = new AbortController();
  res.on('close', () => ctrl.abort());
  let r: globalThis.Response;
  try {
    const headers: Record<string, string> = { ...auth() };
    if (req.headers.range) headers.range = String(req.headers.range);
    r = await fetch(ep.base + path, { headers, signal: ctrl.signal });
  } catch {
    if (!res.headersSent) res.status(502).json({ error: 'O bitbrain não respondeu. Tente de novo.' });
    return;
  }
  if (!r.ok && r.status !== 206) {
    const data = (await r.json().catch(() => ({}))) as Record<string, unknown>;
    return void res.status(r.status === 404 ? 404 : 502).json({ error: String(data.erro ?? '').slice(0, 300) || (r.status === 404 ? 'Arquivo não encontrado (a pesquisa pode ter sido excluída).' : 'O bitbrain recusou o download (' + r.status + ').') });
  }
  res.status(r.status);
  for (const h of ['content-type', 'content-length', 'content-range', 'accept-ranges', 'last-modified', 'etag']) {
    const v = r.headers.get(h);
    if (v) res.setHeader(h, v);
  }
  const disp = r.headers.get('content-disposition');
  if (opts.attach) res.setHeader('content-disposition', disp ? disp.replace(/^inline/i, 'attachment') : 'attachment');
  else if (disp) res.setHeader('content-disposition', disp.replace(/^attachment/i, 'inline'));
  res.setHeader('cache-control', 'private, max-age=3600');
  res.setHeader('x-content-type-options', 'nosniff');
  if (opts.log) logAction(req, 'midia_baixar', { detail: opts.log });
  if (!r.body) return void res.end();
  Readable.fromWeb(r.body as import('node:stream/web').ReadableStream).on('error', () => res.destroy()).pipe(res);
}

midiaRouter.get('/coletor.zip', (req, res) => void pipe(req, res, '/estudio/midia/coletor.zip', { attach: true, log: { arquivo: 'extensão Coletor de mídia' } }));

midiaRouter.get('/f/:id/zip', (req, res) => {
  const id = String(req.params.id);
  if (!ID.test(id)) return void res.status(400).json({ error: 'Pesquisa inválida.' });
  void pipe(req, res, `/estudio/midia/${id}/zip`, { attach: true, log: { pesquisa: id, arquivo: 'tudo (.zip)' } });
});

/** Qualquer outro arquivo da pesquisa (/arquivo/<id>, capas). ?baixar=1 força o download. */
midiaRouter.get('/f/:id/*rest', (req, res) => {
  const id = String(req.params.id);
  const segs = ([] as string[]).concat((req.params as unknown as { rest: string[] | string }).rest);
  if (!ID.test(id) || !segs.length || segs.length > 4 || segs.some((x) => !/^[A-Za-z0-9_\-.=]{1,120}$/.test(x) || x === '..' || x === '.')) return void res.status(400).end();
  const rest = segs.join('/');
  const baixar = req.query.baixar === '1';
  void pipe(req, res, `/estudio/midia/${id}/${rest}`, baixar && !req.headers.range ? { attach: true, log: { pesquisa: id, arquivo: rest } } : { attach: baixar });
});
