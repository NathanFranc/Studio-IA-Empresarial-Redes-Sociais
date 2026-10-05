/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Studio ML: status, busca, detalhe com texto reescrito pela IA, aviso de marca d'água e proxy das fotos. */
import { Router } from 'express';
import { AiError, aiReady, askJson } from '../ai.js';
import { requireAdmin } from '../auth.js';
import { pickCompany } from '../companies.js';
import { logAction } from '../logs.js';
import { allowedImage, MlError, mlDetail, mlDisconnect, mlLookup, mlSearch, mlStatus } from '../ml.js';
import { mlRewritePrompt, watermarkPrompt } from '../prompts.js';

export const mlRouter = Router();

const fail = (res: import('express').Response, e: unknown) => {
  const err = e instanceof MlError || e instanceof AiError ? e : new MlError('Algo falhou ao buscar no Mercado Livre. Tente de novo.');
  if (!(e instanceof MlError) && !(e instanceof AiError)) console.error(e);
  res.status(err.status).json({ error: err.message });
};

mlRouter.get('/status', (req, res) => {
  const s = mlStatus();
  if (req.user!.role !== 'admin') delete (s as Partial<typeof s>).redirectUri;
  res.json(s);
});

mlRouter.post('/disconnect', requireAdmin, (req, res) => {
  const s = mlStatus();
  mlDisconnect();
  logAction(req, 'ml_desconectado', { detail: { conta: s.nickname } });
  res.json(mlStatus());
});

mlRouter.post('/search', async (req, res) => {
  const q = String(req.body?.q ?? '').trim().slice(0, 120);
  if (q.length < 3) return void res.status(400).json({ error: 'Digite o nome do produto (pelo menos 3 letras).' });
  try {
    const r = await mlSearch(q);
    logAction(req, 'ml_buscar', { detail: { busca: q, resultados: r.results.length } });
    res.json(r);
  } catch (e) {
    logAction(req, 'erro_ml', { detail: { etapa: 'buscar', busca: q, motivo: (e as Error).message } });
    fail(res, e);
  }
});

const clip = (v: unknown, n: number) => String(v ?? '').trim().slice(0, n);

mlRouter.post('/detail', async (req, res) => {
  const kind = String(req.body?.kind ?? '');
  const id = String(req.body?.id ?? '').trim();
  const co = pickCompany(req.body?.company);
  if (!['catalogo', 'anuncio', 'scraping'].includes(kind) || !id) return void res.status(400).json({ error: 'Escolha um produto da lista.' });
  const t0 = Date.now();
  try {
    const detail = await mlDetail(kind, id);
    let ai: Record<string, unknown> | null = null, aiError = '';
    const marks: Record<number, string> = {};
    let wmChecked = false;
    if (aiReady()) {
      const pics = detail.pictures.slice(0, 16);
      const [rw, wm] = await Promise.allSettled([
        askJson(mlRewritePrompt(co, detail), [], 4000),
        pics.length ? askJson(watermarkPrompt(pics.length), pics.map((p) => p.url), 1500) : Promise.resolve({ imagens: [] }),
      ]);
      if (rw.status === 'fulfilled') {
        const r = rw.value as Record<string, unknown>;
        ai = {
          titulo: clip(r.titulo, 60),
          descricao: clip(r.descricao, 6000),
          ficha: (Array.isArray(r.ficha) ? r.ficha : []).slice(0, 30).map((f: Record<string, unknown>) => ({ nome: clip(f?.nome, 60), valor: clip(f?.valor, 120) })).filter((f: { nome: string; valor: string }) => f.nome && f.valor),
          destaques: (Array.isArray(r.destaques) ? r.destaques : []).slice(0, 6).map((x: unknown) => clip(x, 80)).filter(Boolean),
          alertas: (Array.isArray(r.alertas) ? r.alertas : []).slice(0, 6).map((x: unknown) => clip(x, 160)).filter(Boolean),
        };
      } else aiError = (rw.reason as Error)?.message || 'A IA não respondeu.';
      if (wm.status === 'fulfilled') {
        wmChecked = true;
        for (const it of (((wm.value as { imagens?: { n?: number; marca_dagua?: boolean; onde?: string }[] }).imagens) ?? [])) {
          const i = Number(it.n) - 1;
          if (it.marca_dagua && i >= 0 && i < pics.length) marks[i] = clip(it.onde, 120) || "marca d'água";
        }
      } else console.error('[ml] verificação de marca d\'água falhou:', (wm.reason as Error)?.message);
    } else aiError = 'A chave da IA não está configurada; os textos vieram sem reescrita.';
    const pictures = detail.pictures.map((p, i) => ({ ...p, watermark: marks[i] ?? null, checked: wmChecked && i < 16 }));
    logAction(req, 'ml_gerar', { detail: { empresa: co.name, produto: detail.title, fonte: kind, fotos: pictures.length, com_marca: Object.keys(marks).length, ms: Date.now() - t0 } });
    res.json({ detail: { ...detail, pictures }, ai, aiError });
  } catch (e) {
    logAction(req, 'erro_ml', { detail: { etapa: 'detalhe', id, motivo: (e as Error).message } });
    fail(res, e);
  }
});

/** Dados da loja (SKU, EAN, preço, estoque, medidas, NCM) pelo sistema próprio (bitbrain), se ele oferecer. */
mlRouter.post('/lookup', async (req, res) => {
  const codigo = String(req.body?.codigo ?? '').trim().slice(0, 40);
  if (codigo.length < 3) return void res.status(400).json({ error: 'Digite o SKU ou o EAN.' });
  try {
    const r = await mlLookup(codigo, pickCompany(req.body?.company).id);
    res.json(r);
  } catch (e) { fail(res, e); }
});

/** Proxy das fotos do ML (a página só carrega imagens do próprio site e precisa delas para o ZIP). */
mlRouter.get('/img', async (req, res) => {
  const u = String(req.query.u ?? '');
  if (!allowedImage(u)) return void res.status(400).end();
  try {
    const r = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    const type = r.headers.get('content-type') ?? '';
    if (!r.ok || !type.startsWith('image/')) return void res.status(502).end();
    res.setHeader('Content-Type', type);
    res.setHeader('Cache-Control', 'private, max-age=86400');
    res.send(Buffer.from(await r.arrayBuffer()));
  } catch {
    res.status(502).end();
  }
});
