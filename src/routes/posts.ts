/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Histórico reutilizável: salvar, listar, abrir, atualizar e excluir artes. */
import { Router, type Request } from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { uploadsDir } from '../config.js';
import { db } from '../db.js';
import { logAction } from '../logs.js';

export const postsRouter = Router();

interface PostRow {
  id: number; user_id: number | null; mode: string; title: string; model: string | null; color: string | null;
  data: string; caption: string | null; thumb: string | null; photos: number; created_at: string; updated_at: string;
  user_name?: string | null;
}

const MAX_PHOTOS = 8;
const MAX_PHOTO_BYTES = 12 * 1024 * 1024;

/** Grava as fotos (data URLs) em data/uploads/<id>/<n>.<ext>, substituindo as anteriores. */
function savePhotos(id: number, photos: unknown): number {
  if (!Array.isArray(photos)) return -1; // -1 = manter as fotos atuais
  const dir = path.join(uploadsDir, String(id));
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
  let n = 0;
  for (const p of photos.slice(0, MAX_PHOTOS)) {
    const m = typeof p === 'string' ? /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(p) : null;
    if (!m) continue;
    const buf = Buffer.from(m[2], 'base64');
    if (buf.length > MAX_PHOTO_BYTES) continue;
    fs.writeFileSync(path.join(dir, `${n}.${m[1] === 'jpeg' ? 'jpg' : m[1]}`), buf);
    n++;
  }
  return n;
}

function canTouch(req: Request, row: PostRow): boolean {
  return req.user!.role === 'admin' || row.user_id === req.user!.id;
}

function clean(body: Record<string, unknown>) {
  const mode = body.mode === 'carrossel' ? 'carrossel' : 'post';
  const thumb = typeof body.thumb === 'string' && body.thumb.startsWith('data:image/jpeg;base64,') && body.thumb.length < 400_000 ? body.thumb : null;
  return {
    mode,
    title: String(body.title ?? 'Sem título').slice(0, 120) || 'Sem título',
    model: body.model ? String(body.model).slice(0, 30) : null,
    color: body.color ? String(body.color).slice(0, 30) : null,
    data: JSON.stringify(body.data ?? {}).slice(0, 200_000),
    caption: String(body.caption ?? '').slice(0, 5000),
    thumb,
  };
}

postsRouter.get('/', (req, res) => {
  const mine = req.query.scope !== 'all';
  const q = `%${String(req.query.q ?? '').trim()}%`;
  const limit = Math.min(100, Number(req.query.limit) || 40);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = db.prepare(
    `SELECT p.id, p.user_id, p.mode, p.title, p.model, p.color, p.thumb, p.photos, p.created_at, p.updated_at, u.name AS user_name,
       (SELECT i.permalink FROM ig_posts i WHERE i.post_id = p.id ORDER BY i.id DESC LIMIT 1) AS ig_permalink,
       (SELECT COUNT(*) FROM ig_posts i WHERE i.post_id = p.id) AS ig_count
       FROM posts p LEFT JOIN users u ON u.id = p.user_id
      WHERE (? = 0 OR p.user_id = ?) AND p.title LIKE ?
      ORDER BY p.updated_at DESC LIMIT ? OFFSET ?`,
  ).all(mine ? 1 : 0, req.user!.id, q, limit, offset);
  res.json({ posts: rows });
});

postsRouter.get('/:id', (req, res) => {
  const row = db.prepare(
    'SELECT p.*, u.name AS user_name FROM posts p LEFT JOIN users u ON u.id = p.user_id WHERE p.id = ?',
  ).get(Number(req.params.id)) as PostRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Essa arte não existe mais no histórico.' });
    return;
  }
  const dir = path.join(uploadsDir, String(row.id));
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).sort((a, b) => parseInt(a) - parseInt(b)) : [];
  logAction(req, 'abrir_historico', { postId: row.id, detail: { titulo: row.title } });
  res.json({ post: { ...row, data: JSON.parse(row.data), photoUrls: files.map((f) => `/api/posts/${row.id}/photo/${f}`) } });
});

postsRouter.get('/:id/photo/:file', (req, res) => {
  const file = String(req.params.file);
  if (!/^\d+\.(jpg|png|webp)$/.test(file)) {
    res.status(404).end();
    return;
  }
  const p = path.join(uploadsDir, String(Number(req.params.id)), file);
  if (!fs.existsSync(p)) {
    res.status(404).end();
    return;
  }
  res.sendFile(p);
});

postsRouter.post('/', (req, res) => {
  const v = clean(req.body ?? {});
  const info = db.prepare(
    'INSERT INTO posts (user_id, mode, title, model, color, data, caption, thumb) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
  ).run(req.user!.id, v.mode, v.title, v.model, v.color, v.data, v.caption, v.thumb);
  const id = Number(info.lastInsertRowid);
  const n = savePhotos(id, req.body?.photos);
  if (n >= 0) db.prepare('UPDATE posts SET photos = ? WHERE id = ?').run(n, id);
  logAction(req, 'salvar_historico', { postId: id, detail: { titulo: v.title, modo: v.mode, modelo: v.model } });
  res.json({ id });
});

postsRouter.put('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id)) as PostRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Essa arte não existe mais no histórico.' });
    return;
  }
  if (!canTouch(req, row)) {
    res.status(403).json({ error: 'Só quem criou a arte ou um administrador pode alterá-la. Salve como nova.' });
    return;
  }
  const v = clean(req.body ?? {});
  db.prepare(
    `UPDATE posts SET mode=?, title=?, model=?, color=?, data=?, caption=?, thumb=COALESCE(?, thumb), updated_at=datetime('now') WHERE id=?`,
  ).run(v.mode, v.title, v.model, v.color, v.data, v.caption, v.thumb, row.id);
  const n = savePhotos(row.id, req.body?.photos);
  if (n >= 0) db.prepare('UPDATE posts SET photos = ? WHERE id = ?').run(n, row.id);
  logAction(req, 'atualizar_historico', { postId: row.id, detail: { titulo: v.title } });
  res.json({ id: row.id });
});

postsRouter.delete('/:id', (req, res) => {
  const row = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(req.params.id)) as PostRow | undefined;
  if (!row) {
    res.status(404).json({ error: 'Essa arte não existe mais no histórico.' });
    return;
  }
  if (!canTouch(req, row)) {
    res.status(403).json({ error: 'Só quem criou a arte ou um administrador pode excluí-la.' });
    return;
  }
  db.prepare('DELETE FROM posts WHERE id = ?').run(row.id);
  fs.rmSync(path.join(uploadsDir, String(row.id)), { recursive: true, force: true });
  logAction(req, 'excluir_historico', { postId: row.id, detail: { titulo: row.title } });
  res.json({ ok: true });
});
