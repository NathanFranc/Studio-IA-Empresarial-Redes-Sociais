/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Histórico do Studio ML (anúncios montados) e envio ao AnyMarket. */
import { Router, type Request } from 'express';
import { config } from '../config.js';
import { publishSquare } from '../photos.js';
import { AmError, amBrands, amCategories, amConfigured, amCreateBrand, amSandbox, amSend, buildProduct, missing, type ListingData } from '../anymarket.js';
import { COMPANIES, pickCompany } from '../companies.js';
import { db } from '../db.js';
import { logAction } from '../logs.js';

export const listingsRouter = Router();
export const anymarketRouter = Router();

interface Row { id: number; user_id: number | null; company: string; title: string; data: string; thumb: string | null; status: string; am_product_id: string | null; am_message: string | null; sent_at: string | null; created_at: string; updated_at: string }

const canTouch = (req: Request, r: Row) => req.user!.role === 'admin' || r.user_id === req.user!.id;
const getRow = (id: number) => db.prepare('SELECT * FROM ml_listings WHERE id = ?').get(id) as Row | undefined;
function clean(body: Record<string, unknown>) {
  const data = body.data && typeof body.data === 'object' ? body.data as Record<string, unknown> : {};
  const fotos = Array.isArray(data.fotos) ? (data.fotos as unknown[]).filter((u): u is string => typeof u === 'string' && /^https?:\/\//.test(u)).slice(0, 30) : [];
  return {
    company: pickCompany(body.company).id,
    title: String(data.titulo ?? body.title ?? 'Sem título').slice(0, 160) || 'Sem título',
    thumb: fotos[0] ?? null,
    data: JSON.stringify({ ...data, fotos }).slice(0, 400_000),
  };
}

listingsRouter.get('/', (req, res) => {
  const co = pickCompany(req.query.company).id;
  const q = '%' + String(req.query.q ?? '').trim() + '%';
  const mine = req.query.scope !== 'all';
  const rows = db.prepare(
    `SELECT l.id, l.user_id, l.company, l.title, l.thumb, l.status, l.am_product_id, l.am_message, l.sent_at, l.updated_at, u.name AS user_name
       FROM ml_listings l LEFT JOIN users u ON u.id = l.user_id
      WHERE l.company = ? AND l.title LIKE ? AND (? = 0 OR l.user_id = ?)
      ORDER BY l.updated_at DESC LIMIT 40`,
  ).all(co, q, mine ? 1 : 0, req.user!.id);
  res.json({ listings: rows });
});

listingsRouter.get('/:id', (req, res) => {
  const r = getRow(Number(req.params.id));
  if (!r) return void res.status(404).json({ error: 'Esse anúncio não existe mais.' });
  res.json({ listing: { ...r, data: JSON.parse(r.data) } });
});

listingsRouter.post('/', (req, res) => {
  const v = clean(req.body ?? {});
  const info = db.prepare('INSERT INTO ml_listings (user_id, company, title, data, thumb) VALUES (?, ?, ?, ?, ?)').run(req.user!.id, v.company, v.title, v.data, v.thumb);
  const id = Number(info.lastInsertRowid);
  logAction(req, 'ml_salvar', { detail: { anuncio: id, titulo: v.title, empresa: COMPANIES[v.company].name } });
  res.json({ id });
});

listingsRouter.put('/:id', (req, res) => {
  const r = getRow(Number(req.params.id));
  if (!r) return void res.status(404).json({ error: 'Esse anúncio não existe mais.' });
  if (!canTouch(req, r)) return void res.status(403).json({ error: 'Só quem criou ou um administrador pode alterar. Salve como novo.' });
  const v = clean({ ...req.body, company: r.company });
  db.prepare("UPDATE ml_listings SET title = ?, data = ?, thumb = ?, updated_at = datetime('now') WHERE id = ?").run(v.title, v.data, v.thumb, r.id);
  logAction(req, 'ml_atualizar', { detail: { anuncio: r.id, titulo: v.title } });
  res.json({ id: r.id });
});

listingsRouter.delete('/:id', (req, res) => {
  const r = getRow(Number(req.params.id));
  if (!r) return void res.status(404).json({ error: 'Esse anúncio não existe mais.' });
  if (!canTouch(req, r)) return void res.status(403).json({ error: 'Só quem criou ou um administrador pode excluir.' });
  db.prepare('DELETE FROM ml_listings WHERE id = ?').run(r.id);
  logAction(req, 'ml_excluir', { detail: { anuncio: r.id, titulo: r.title } });
  res.json({ ok: true });
});

// ---------------------------------------------------------------- AnyMarket
const amFail = (res: import('express').Response, e: unknown) => {
  const err = e instanceof AmError ? e : new AmError('Algo falhou ao falar com o AnyMarket.');
  if (!(e instanceof AmError)) console.error(e);
  res.status(err.status).json({ error: err.message });
};

anymarketRouter.get('/status', (_req, res) => {
  res.json({ sandbox: amSandbox(), companies: Object.values(COMPANIES).map((c) => ({ id: c.id, name: c.name, configured: amConfigured(c.id) })) });
});
anymarketRouter.get('/categories', async (req, res) => {
  try { res.json({ categories: await amCategories(pickCompany(req.query.company).id) }); } catch (e) { amFail(res, e); }
});
anymarketRouter.get('/brands', async (req, res) => {
  try { res.json({ brands: await amBrands(pickCompany(req.query.company).id, String(req.query.q ?? '').trim().slice(0, 60)) }); } catch (e) { amFail(res, e); }
});
anymarketRouter.post('/brands', async (req, res) => {
  const name = String(req.body?.name ?? '').trim().slice(0, 60);
  if (name.length < 2) return void res.status(400).json({ error: 'Informe o nome da marca.' });
  try { res.json({ brand: await amCreateBrand(pickCompany(req.body?.company).id, name) }); } catch (e) { amFail(res, e); }
});

/** Envia um anúncio salvo. O que está no histórico é o que vai (salve antes de enviar). */
anymarketRouter.post('/send/:id', async (req, res) => {
  const r = getRow(Number(req.params.id));
  if (!r) return void res.status(404).json({ error: 'Salve o anúncio antes de enviar.' });
  if (!canTouch(req, r)) return void res.status(403).json({ error: 'Só quem criou ou um administrador pode enviar.' });
  if (r.status === 'enviado' && r.am_product_id && !req.body?.forcar) return void res.status(409).json({ error: 'Esse anúncio já foi enviado ao AnyMarket (produto ' + r.am_product_id + '). Para enviar de novo como produto novo, confirme.' });
  const data = JSON.parse(r.data) as ListingData;
  const falta = missing(data);
  if (falta.length) return void res.status(400).json({ error: 'Falta preencher: ' + falta.join(', ') + '.' });
  const t0 = Date.now();
  try {
    if (!config.publicUrl) throw new AmError('Defina DOMAIN ou PUBLIC_URL no .env: o AnyMarket baixa as fotos 1200×1200 por um endereço público do Estúdio.', 400);
    // Fotos no padrão 1200×1200 (fundo branco), servidas em /am-media para o AnyMarket baixar.
    const fotos: string[] = [];
    for (const u of data.fotos.slice(0, 12)) {
      try { fotos.push(await publishSquare(u)); }
      catch { throw new AmError('Não consegui preparar a foto ' + (fotos.length + 1) + ' em 1200×1200. Tire ela da seleção ou tente de novo.', 502); }
    }
    const out = await amSend(r.company, buildProduct({ ...data, fotos }, 'studio-' + r.id));
    db.prepare("UPDATE ml_listings SET status = 'enviado', am_product_id = ?, am_message = ?, sent_at = datetime('now'), updated_at = datetime('now') WHERE id = ?")
      .run(out.id, amSandbox() ? 'sandbox' : 'produção', r.id);
    logAction(req, 'anymarket_enviar', { detail: { anuncio: r.id, produto: out.id, titulo: r.title, empresa: COMPANIES[r.company]?.name, ambiente: amSandbox() ? 'sandbox' : 'produção', anuncios_auto: !!data.am?.anunciosAuto, ms: Date.now() - t0 } });
    res.json({ ok: true, productId: out.id, sandbox: amSandbox() });
  } catch (e) {
    const msg = (e as Error).message;
    db.prepare("UPDATE ml_listings SET status = 'erro', am_message = ?, updated_at = datetime('now') WHERE id = ?").run(msg.slice(0, 500), r.id);
    logAction(req, 'erro_anymarket', { detail: { anuncio: r.id, motivo: msg } });
    amFail(res, e);
  }
});
