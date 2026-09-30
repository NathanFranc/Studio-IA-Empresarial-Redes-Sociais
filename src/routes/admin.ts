/** Painel do administrador: usuários, logs (com exportação CSV) e resumo de uso. */
import { Router } from 'express';
import { endAllSessionsOf, hashPassword, passwordProblem } from '../auth.js';
import { db, type UserRow } from '../db.js';
import { ACTIONS, logAction } from '../logs.js';

export const adminRouter = Router();

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

adminRouter.get('/users', (_req, res) => {
  const users = db.prepare(
    `SELECT u.id, u.name, u.email, u.role, u.active, u.must_change, u.created_at, u.last_login_at,
       (SELECT COUNT(*) FROM logs l WHERE l.user_id = u.id AND l.action IN ('gerar_post','gerar_carrossel')) AS geracoes,
       (SELECT COUNT(*) FROM logs l WHERE l.user_id = u.id AND l.action IN ('baixar_post','baixar_carrossel','baixar_slide')) AS downloads
     FROM users u ORDER BY u.active DESC, u.name`,
  ).all();
  res.json({ users });
});

adminRouter.post('/users', (req, res) => {
  const name = String(req.body?.name ?? '').trim();
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const role = req.body?.role === 'admin' ? 'admin' : 'editor';
  const password = String(req.body?.password ?? '');
  if (!name) return void res.status(400).json({ error: 'Informe o nome.' });
  if (!EMAIL.test(email)) return void res.status(400).json({ error: 'Informe um e-mail válido.' });
  const problem = passwordProblem(password);
  if (problem) return void res.status(400).json({ error: problem });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return void res.status(409).json({ error: 'Já existe um usuário com esse e-mail.' });
  }
  const info = db.prepare(
    'INSERT INTO users (name, email, password_hash, role, must_change) VALUES (?, ?, ?, ?, 1)',
  ).run(name, email, hashPassword(password), role);
  logAction(req, 'usuario_criado', { detail: { id: Number(info.lastInsertRowid), email, role } });
  res.json({ id: Number(info.lastInsertRowid) });
});

adminRouter.patch('/users/:id', (req, res) => {
  const id = Number(req.params.id);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(id) as UserRow | undefined;
  if (!user) return void res.status(404).json({ error: 'Usuário não encontrado.' });
  const changes: Record<string, unknown> = {};
  if (typeof req.body?.name === 'string' && req.body.name.trim()) changes.name = req.body.name.trim();
  if (req.body?.role === 'admin' || req.body?.role === 'editor') changes.role = req.body.role;
  if (typeof req.body?.active === 'boolean') changes.active = req.body.active ? 1 : 0;
  if (id === req.user!.id && (changes.active === 0 || changes.role === 'editor')) {
    return void res.status(400).json({ error: 'Você não pode desativar nem rebaixar a si mesmo.' });
  }
  if (typeof req.body?.password === 'string' && req.body.password) {
    const problem = passwordProblem(req.body.password);
    if (problem) return void res.status(400).json({ error: problem });
    changes.password_hash = hashPassword(req.body.password);
    changes.must_change = 1;
  }
  const keys = Object.keys(changes);
  if (!keys.length) return void res.status(400).json({ error: 'Nada para alterar.' });
  db.prepare(`UPDATE users SET ${keys.map((k) => `${k} = ?`).join(', ')} WHERE id = ?`).run(...keys.map((k) => changes[k]), id);
  if (changes.active === 0 || changes.password_hash) endAllSessionsOf(id);
  const shown = { ...changes };
  if (shown.password_hash) {
    delete shown.password_hash;
    shown.senha = 'redefinida';
  }
  logAction(req, 'usuario_alterado', { detail: { id, email: user.email, ...shown } });
  res.json({ ok: true });
});

function logFilter(q: Record<string, unknown>) {
  const where: string[] = [];
  const args: unknown[] = [];
  if (q.user) { where.push('l.user_id = ?'); args.push(Number(q.user)); }
  if (q.action && ACTIONS.includes(q.action as never)) { where.push('l.action = ?'); args.push(q.action); }
  if (q.from) { where.push('l.created_at >= ?'); args.push(String(q.from) + ' 00:00:00'); }
  if (q.to) { where.push('l.created_at <= ?'); args.push(String(q.to) + ' 23:59:59'); }
  return { sql: where.length ? 'WHERE ' + where.join(' AND ') : '', args };
}

adminRouter.get('/logs', (req, res) => {
  const f = logFilter(req.query as Record<string, unknown>);
  const limit = Math.min(200, Number(req.query.limit) || 50);
  const offset = Math.max(0, Number(req.query.offset) || 0);
  const rows = db.prepare(
    `SELECT l.id, l.created_at, l.action, l.post_id, l.detail, l.ip, u.name AS user_name, u.email AS user_email
       FROM logs l LEFT JOIN users u ON u.id = l.user_id ${f.sql}
      ORDER BY l.id DESC LIMIT ? OFFSET ?`,
  ).all(...f.args, limit, offset);
  const total = (db.prepare(`SELECT COUNT(*) AS n FROM logs l ${f.sql}`).get(...f.args) as { n: number }).n;
  res.json({ logs: rows, total, actions: ACTIONS });
});

adminRouter.get('/logs.csv', (req, res) => {
  const f = logFilter(req.query as Record<string, unknown>);
  const rows = db.prepare(
    `SELECT l.created_at, u.name AS usuario, u.email, l.action, l.post_id, l.detail, l.ip
       FROM logs l LEFT JOIN users u ON u.id = l.user_id ${f.sql} ORDER BY l.id DESC LIMIT 50000`,
  ).all(...f.args) as Record<string, unknown>[];
  const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
  const head = ['data_hora_utc', 'usuario', 'email', 'acao', 'arte_id', 'detalhe', 'ip'];
  const body = rows.map((r) => [r.created_at, r.usuario, r.email, r.action, r.post_id, r.detail, r.ip].map(esc).join(';'));
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', 'attachment; filename="logs-estudio-megadino.csv"');
  res.send('﻿' + [head.join(';'), ...body].join('\r\n'));
});

adminRouter.get('/summary', (_req, res) => {
  const count = (sql: string) => (db.prepare(sql).get() as { n: number }).n;
  res.json({
    hoje: {
      geracoes: count("SELECT COUNT(*) AS n FROM logs WHERE action IN ('gerar_post','gerar_carrossel') AND created_at >= datetime('now','start of day')"),
      downloads: count("SELECT COUNT(*) AS n FROM logs WHERE action IN ('baixar_post','baixar_carrossel','baixar_slide') AND created_at >= datetime('now','start of day')"),
      acessos: count("SELECT COUNT(DISTINCT user_id) AS n FROM logs WHERE action = 'login' AND created_at >= datetime('now','start of day')"),
      erros: count("SELECT COUNT(*) AS n FROM logs WHERE action IN ('erro_ia','login_falhou') AND created_at >= datetime('now','start of day')"),
    },
    semana: db.prepare(
      `SELECT date(created_at) AS dia,
          SUM(action IN ('gerar_post','gerar_carrossel')) AS geracoes,
          SUM(action IN ('baixar_post','baixar_carrossel','baixar_slide')) AS downloads
         FROM logs WHERE created_at >= datetime('now','-6 days','start of day')
        GROUP BY dia ORDER BY dia`,
    ).all(),
    historico: count('SELECT COUNT(*) AS n FROM posts'),
    usuarios: count('SELECT COUNT(*) AS n FROM users WHERE active = 1'),
  });
});
