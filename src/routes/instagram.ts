/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** API do Instagram: status da conexão, permissões, desconectar e publicar. */
import { Router, type NextFunction, type Request, type Response } from 'express';
import { requireAdmin } from '../auth.js';
import { db } from '../db.js';
import { disconnect, editorsCanPublish, IgError, publish, setEditorsCanPublish, status } from '../instagram.js';
import { logAction } from '../logs.js';

export const instagramRouter = Router();

const canPublish = (req: Request) => req.user!.role === 'admin' || editorsCanPublish();

instagramRouter.get('/status', (req, res) => {
  const s = status();
  if (req.user!.role !== 'admin') { delete (s as Partial<typeof s>).redirectUri; }
  res.json({ ...s, canPublish: canPublish(req) });
});

instagramRouter.post('/settings', requireAdmin, (req, res) => {
  if (typeof req.body?.editorsCanPublish === 'boolean') setEditorsCanPublish(req.body.editorsCanPublish);
  res.json(status());
});

instagramRouter.post('/disconnect', requireAdmin, (req, res) => {
  const s = status();
  disconnect();
  logAction(req, 'instagram_desconectado', { detail: { conta: s.username } });
  res.json(status());
});

// Uma publicação por vez, para não sair post duplicado com cliques repetidos.
let busy = false;

const JPEG = /^data:image\/jpeg;base64,/;
const MAX_BYTES = 8 * 1024 * 1024;

instagramRouter.post('/publish', async (req: Request, res: Response, next: NextFunction) => {
  if (!canPublish(req)) return void res.status(403).json({ error: 'Só administradores podem publicar no Instagram. Peça ao administrador para liberar.' });
  const images: unknown[] = Array.isArray(req.body?.images) ? req.body.images : [];
  const caption = String(req.body?.caption ?? '').trim();
  const postId = Number(req.body?.postId) || null;
  const kind = images.length > 1 ? 'carrossel' : 'post';
  if (!images.length || images.length > 10) return void res.status(400).json({ error: 'Envie de 1 a 10 imagens.' });
  if (!images.every((i) => typeof i === 'string' && JPEG.test(i))) return void res.status(400).json({ error: 'As imagens precisam estar em JPEG.' });
  if (caption.length > 2200) return void res.status(400).json({ error: `A legenda tem ${caption.length} caracteres. O Instagram aceita até 2.200.` });
  const tags = caption.match(/#[\p{L}\p{N}_]+/gu) ?? [];
  if (tags.length > 30) return void res.status(400).json({ error: `A legenda tem ${tags.length} hashtags. O Instagram aceita até 30.` });
  const buffers = (images as string[]).map((i) => Buffer.from(i.replace(JPEG, ''), 'base64'));
  if (buffers.some((b) => b.length > MAX_BYTES || b.length < 1000)) return void res.status(400).json({ error: 'Uma das imagens está vazia ou grande demais.' });
  if (busy) return void res.status(409).json({ error: 'Já tem uma publicação sendo enviada. Aguarde terminar.' });

  busy = true;
  const t0 = Date.now();
  try {
    const r = await publish(buffers, caption);
    const validPost = postId && db.prepare('SELECT 1 FROM posts WHERE id = ?').get(postId) ? postId : null;
    db.prepare('INSERT INTO ig_posts (user_id, post_id, media_id, permalink, kind, username) VALUES (?, ?, ?, ?, ?, ?)')
      .run(req.user!.id, validPost, r.mediaId, r.permalink, kind, r.username);
    logAction(req, 'publicar_instagram', { postId: validPost, detail: { conta: r.username, tipo: kind, imagens: buffers.length, link: r.permalink, ms: Date.now() - t0 } });
    res.json({ ok: true, ...r });
  } catch (e) {
    const err = e instanceof IgError ? e : new IgError('Não foi possível publicar agora. Tente de novo.');
    if (!(e instanceof IgError)) console.error(e);
    logAction(req, 'erro_instagram', { postId, detail: { motivo: err.message, tipo: kind } });
    res.status(err.status).json({ error: err.message });
  } finally {
    busy = false;
  }
  void next;
});
