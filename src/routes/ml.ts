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
import { fetchImage, PHOTO_SIZE, toSquare } from '../photos.js';
import { allowedImage, MlError, mlDetail, mlDisconnect, mlLookup, mlSearch, mlStatus } from '../ml.js';
import { mlReviewPrompt, mlRewritePrompt, watermarkPrompt } from '../prompts.js';
import { DEFAULT_STYLE, getStyle, isCustomStyle, setStyle, titleIssues } from '../listingStyle.js';

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

type Detail = Awaited<ReturnType<typeof mlDetail>>;
type Reviewable = Pick<Detail, 'title' | 'brand' | 'model' | 'attributes' | 'texts'>;
/** Passa o rascunho pelo revisor e confere o título; devolve título/descrição corrigidos e o relatório. */
async function review(co: ReturnType<typeof pickCompany>, d: Reviewable, titulo: string, descricao: string) {
  const r = await askJson(mlReviewPrompt(co, d, getStyle(co.id), { titulo, descricao }, titleIssues(titulo)), [], 7000) as Record<string, unknown>;
  const t = clip(r.titulo, 80) || titulo, desc = clip(r.descricao, 8000) || descricao;
  const list = (v: unknown, n: number) => (Array.isArray(v) ? v : []).slice(0, n).map((x: unknown) => clip(x, 200)).filter(Boolean);
  return { titulo: t, descricao: desc, revisao: { feita: true, correcoes: list(r.correcoes, 12), pendencias: list(r.pendencias, 8), titulo: titleIssues(t) } };
}

/** Revisar de novo o texto que a equipe editou. */
mlRouter.post('/review', async (req, res) => {
  const co = pickCompany(req.body?.company);
  const titulo = clip(req.body?.titulo, 120), descricao = clip(req.body?.descricao, 9000);
  if (!titulo || !descricao) return void res.status(400).json({ error: 'Preencha título e descrição antes de revisar.' });
  if (!aiReady()) return void res.status(400).json({ error: 'A chave da IA não está configurada.' });
  const ctx = req.body?.contexto ?? {};
  const d: Reviewable = {
    title: clip(ctx.title, 200), brand: clip(ctx.brand, 60), model: clip(ctx.model, 60),
    attributes: (Array.isArray(ctx.attributes) ? ctx.attributes : []).slice(0, 60).map((a: Record<string, unknown>) => ({ name: clip(a?.name ?? a?.nome, 80), value: clip(a?.value ?? a?.valor, 200) })),
    texts: (Array.isArray(ctx.texts) ? ctx.texts : []).slice(0, 4).map((t: Record<string, unknown>) => ({ source: clip(t?.source, 80), title: clip(t?.title, 200), text: clip(t?.text, 2500) })),
  };
  try {
    const out = await review(co, d, titulo, descricao);
    logAction(req, 'ml_revisar', { detail: { empresa: co.name, titulo: out.titulo, correcoes: out.revisao.correcoes.length } });
    res.json(out);
  } catch (e) { fail(res, e); }
});

/** Padrão de anúncio por empresa (o admin edita; todos leem). */
mlRouter.get('/style', (req, res) => {
  const co = pickCompany(req.query.company);
  res.json({ company: co.id, style: getStyle(co.id), custom: isCustomStyle(co.id), default: DEFAULT_STYLE });
});
mlRouter.put('/style', requireAdmin, (req, res) => {
  const co = pickCompany(req.body?.company);
  setStyle(co.id, req.body?.reset ? null : String(req.body?.style ?? ''));
  logAction(req, 'ml_padrao', { detail: { empresa: co.name, restaurado: !!req.body?.reset } });
  res.json({ company: co.id, style: getStyle(co.id), custom: isCustomStyle(co.id), default: DEFAULT_STYLE });
});

/** Conferência rápida do título (sem IA), usada enquanto a pessoa digita. */
mlRouter.post('/title-check', (req, res) => res.json({ issues: titleIssues(clip(req.body?.titulo, 200)) }));

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
        askJson(mlRewritePrompt(co, detail, getStyle(co.id)), [], 6000),
        pics.length ? askJson(watermarkPrompt(pics.length), pics.map((p) => p.url), 1500) : Promise.resolve({ imagens: [] }),
      ]);
      if (rw.status === 'fulfilled') {
        const r = rw.value as Record<string, unknown>;
        ai = {
          titulo: clip(r.titulo, 80),
          titulos: (Array.isArray(r.titulos_alternativos) ? r.titulos_alternativos : []).slice(0, 3).map((x: unknown) => clip(x, 80)).filter(Boolean),
          palavras: (Array.isArray(r.palavras_chave) ? r.palavras_chave : []).slice(0, 10).map((x: unknown) => clip(x, 60)).filter(Boolean),
          descricao: clip(r.descricao, 8000),
          ficha: (Array.isArray(r.ficha) ? r.ficha : []).slice(0, 30).map((f: Record<string, unknown>) => ({ nome: clip(f?.nome, 60), valor: clip(f?.valor, 120) })).filter((f: { nome: string; valor: string }) => f.nome && f.valor),
          destaques: (Array.isArray(r.destaques) ? r.destaques : []).slice(0, 6).map((x: unknown) => clip(x, 80)).filter(Boolean),
          alertas: (Array.isArray(r.alertas) ? r.alertas : []).slice(0, 6).map((x: unknown) => clip(x, 160)).filter(Boolean),
        };
        // Revisão automática contra o padrão da loja (segunda passada da IA).
        try {
          Object.assign(ai, await review(co, detail, String(ai.titulo), String(ai.descricao)));
        } catch (e) {
          ai.revisao = { feita: false, correcoes: [], pendencias: ['A revisão automática falhou (' + (e as Error).message + '). Use "Revisar de novo".'] };
        }
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
    if (req.query.q === String(PHOTO_SIZE)) {
      // Versão padronizada 1200×1200 (fundo branco, produto centralizado) para o ZIP.
      const { jpg, srcW, srcH } = await toSquare(await fetchImage(u));
      res.setHeader('Content-Type', 'image/jpeg');
      res.setHeader('X-Source-Size', `${srcW}x${srcH}`);
      res.setHeader('Cache-Control', 'private, max-age=86400');
      return void res.send(jpg);
    }
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
