/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Senhas, sessões por cookie e middlewares de acesso. */
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { db, type Role, type UserRow } from './db.js';

export const COOKIE = 'emsid';

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
  mustChange: boolean;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: SessionUser;
    }
  }
}

export function hashPassword(pw: string): string {
  return bcrypt.hashSync(pw, 11);
}

export function checkPassword(pw: string, hash: string): boolean {
  return bcrypt.compareSync(pw, hash);
}

/** Regras mínimas de senha. Retorna a mensagem de erro ou null. */
export function passwordProblem(pw: unknown): string | null {
  if (typeof pw !== 'string' || pw.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
  if (!/[A-Za-z]/.test(pw) || !/\d/.test(pw)) return 'A senha precisa ter letras e números.';
  return null;
}

const sha = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

/** Cria a sessão, grava no banco e envia o cookie. */
export function startSession(req: Request, res: Response, user: UserRow): void {
  const token = crypto.randomBytes(32).toString('base64url');
  const days = config.sessionDays;
  db.prepare(
    `INSERT INTO sessions (id, user_id, expires_at, ip, user_agent)
     VALUES (?, ?, datetime('now', ?), ?, ?)`,
  ).run(sha(token), user.id, `+${days} days`, req.ip ?? null, String(req.headers['user-agent'] ?? '').slice(0, 300));
  db.prepare("UPDATE users SET last_login_at = datetime('now') WHERE id = ?").run(user.id);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.cookieSecure,
    maxAge: days * 86400_000,
    path: '/',
  });
}

export function endSession(req: Request, res: Response): void {
  const token = req.cookies?.[COOKIE];
  if (token) db.prepare('DELETE FROM sessions WHERE id = ?').run(sha(token));
  res.clearCookie(COOKIE, { path: '/' });
}

export function endAllSessionsOf(userId: number): void {
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
}

const findSession = db.prepare(
  `SELECT u.id, u.name, u.email, u.role, u.active, u.must_change, s.id AS sid, s.last_seen
     FROM sessions s JOIN users u ON u.id = s.user_id
    WHERE s.id = ? AND s.expires_at > datetime('now')`,
);
const touch = db.prepare("UPDATE sessions SET last_seen = datetime('now') WHERE id = ?");

/** Carrega `req.user` a partir do cookie (não bloqueia). */
export function loadUser(req: Request, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[COOKIE];
  if (token) {
    const row = findSession.get(sha(token)) as
      | { id: number; name: string; email: string; role: Role; active: number; must_change: number; sid: string }
      | undefined;
    if (row && row.active) {
      req.user = { id: row.id, name: row.name, email: row.email, role: row.role, mustChange: !!row.must_change };
      touch.run(row.sid);
    }
  }
  next();
}

/** Exige usuário logado. Em rotas de API responde 401; em páginas redireciona para o login. */
export function requireUser(req: Request, res: Response, next: NextFunction): void {
  if (req.user) return next();
  if (req.originalUrl.startsWith('/api/')) {
    res.status(401).json({ error: 'Sua sessão expirou. Entre de novo.' });
    return;
  }
  res.redirect('/login');
}

export function requireAdmin(req: Request, res: Response, next: NextFunction): void {
  if (req.user?.role === 'admin') return next();
  if (req.originalUrl.startsWith('/api/')) {
    res.status(403).json({ error: 'Só administradores podem fazer isso.' });
    return;
  }
  res.redirect('/');
}

/**
 * Proteção CSRF simples: toda requisição que altera dados precisa do cabeçalho
 * `X-Requested-With: estudio`, que um formulário de outro site não consegue enviar.
 */
export function requireAjaxHeader(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'HEAD') return next();
  if (req.get('x-requested-with') === 'estudio') return next();
  res.status(400).json({ error: 'Requisição inválida.' });
}

/** Limite de tentativas de login por IP + e-mail (5 erros em 15 minutos). */
const fails = new Map<string, { n: number; until: number }>();
export function loginBlocked(key: string): number {
  const f = fails.get(key);
  if (!f) return 0;
  if (Date.now() > f.until) {
    fails.delete(key);
    return 0;
  }
  return f.n >= 5 ? Math.ceil((f.until - Date.now()) / 60000) : 0;
}
export function registerFail(key: string): void {
  const f = fails.get(key);
  const until = Date.now() + 15 * 60000;
  fails.set(key, { n: (f && Date.now() < f.until ? f.n : 0) + 1, until });
}
export function clearFails(key: string): void {
  fails.delete(key);
}
