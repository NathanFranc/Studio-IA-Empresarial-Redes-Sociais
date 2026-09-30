/** Login, logout, sessão atual e troca de senha. */
import { Router } from 'express';
import {
  checkPassword, clearFails, endAllSessionsOf, endSession, hashPassword, loginBlocked,
  passwordProblem, registerFail, requireUser, startSession,
} from '../auth.js';
import { db, type UserRow } from '../db.js';
import { logAction } from '../logs.js';

export const authRouter = Router();

authRouter.post('/login', (req, res) => {
  const email = String(req.body?.email ?? '').trim().toLowerCase();
  const password = String(req.body?.password ?? '');
  const key = (req.ip ?? '') + '|' + email;
  const wait = loginBlocked(key);
  if (wait) {
    res.status(429).json({ error: `Muitas tentativas. Tente de novo em ${wait} min.` });
    return;
  }
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email) as UserRow | undefined;
  if (!user || !checkPassword(password, user.password_hash) || !user.active) {
    registerFail(key);
    logAction(req, 'login_falhou', { userId: user?.id ?? null, detail: { email, motivo: user && !user.active ? 'inativo' : 'senha' } });
    res.status(401).json({ error: user && !user.active ? 'Este usuário está desativado. Fale com o administrador.' : 'E-mail ou senha incorretos.' });
    return;
  }
  clearFails(key);
  startSession(req, res, user);
  logAction(req, 'login', { userId: user.id });
  res.json({ ok: true, mustChange: !!user.must_change });
});

authRouter.post('/logout', (req, res) => {
  if (req.user) logAction(req, 'logout');
  endSession(req, res);
  res.json({ ok: true });
});

authRouter.get('/me', requireUser, (req, res) => {
  res.json({ user: req.user });
});

authRouter.post('/password', requireUser, (req, res) => {
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(req.user!.id) as UserRow;
  if (!checkPassword(String(req.body?.current ?? ''), user.password_hash)) {
    res.status(400).json({ error: 'A senha atual está incorreta.' });
    return;
  }
  const problem = passwordProblem(req.body?.next);
  if (problem) {
    res.status(400).json({ error: problem });
    return;
  }
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(hashPassword(req.body.next), user.id);
  endAllSessionsOf(user.id);
  startSession(req, res, user);
  logAction(req, 'senha_alterada');
  res.json({ ok: true });
});
