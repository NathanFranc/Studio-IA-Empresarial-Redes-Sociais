/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Servidor do Estúdio Megadino: páginas, API e arquivos estáticos. */
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiReady } from './ai.js';
import { loadUser, requireAdmin, requireAjaxHeader, requireUser } from './auth.js';
import { config, igMediaDir } from './config.js';
import { purgeExpiredSessions } from './db.js';
import { adminRouter } from './routes/admin.js';
import { aiRouter } from './routes/ai.js';
import { authRouter } from './routes/auth.js';
import { eventsRouter } from './routes/events.js';
import { postsRouter } from './routes/posts.js';
import { instagramRouter } from './routes/instagram.js';
import crypto from 'node:crypto';
import { authorizeUrl, cleanMedia, finishConnect, igConfigured, IgError, refreshIfNeeded } from './instagram.js';
import { seedAdmin } from './seed.js';
import { logAction } from './logs.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

seedAdmin();
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 3600_000).unref();
cleanMedia();
setInterval(cleanMedia, 3600_000).unref();
void refreshIfNeeded();
setInterval(() => void refreshIfNeeded(), 6 * 3600_000).unref();

const app = express();
if (config.trustProxy) app.set('trust proxy', 1);
app.disable('x-powered-by');
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'self'"],
      scriptSrc: ["'self'", "'unsafe-inline'", 'https://cdnjs.cloudflare.com'],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      connectSrc: ["'self'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginEmbedderPolicy: false,
}));
app.use(express.json({ limit: '60mb' }));
app.use(cookieParser());
app.use(loadUser);

app.get('/health', (_req, res) => {
  res.json({ ok: true, ia: aiReady() });
});

// ----- API
app.use('/api', requireAjaxHeader);
app.use('/api/auth', authRouter);
app.use('/api/ai', requireUser, aiRouter);
app.use('/api/posts', requireUser, postsRouter);
app.use('/api/events', requireUser, eventsRouter);
app.use('/api/admin', requireUser, requireAdmin, adminRouter);
app.use('/api/instagram', requireUser, instagramRouter);
app.use('/api', (_req, res) => {
  res.status(404).json({ error: 'Rota não encontrada.' });
});

// ----- páginas
const page = (file: string) => (_req: express.Request, res: express.Response) => {
  res.setHeader('Cache-Control', 'no-store');
  res.sendFile(path.join(pub, file));
};
app.get('/login', (req, res, next) => (req.user ? res.redirect('/') : next()), page('login.html'));
app.get('/', requireUser, page('index.html'));
app.get('/admin', requireUser, requireAdmin, page('admin.html'));
app.get('/conta', requireUser, page('conta.html'));

// ----- Instagram: conectar (admin) e imagens temporárias que o Instagram baixa
app.get('/instagram/conectar', requireUser, requireAdmin, (req, res) => {
  if (!igConfigured()) return void res.redirect('/admin?ig=config#instagram');
  const state = crypto.randomBytes(18).toString('base64url');
  res.cookie('ig_state', state, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 10 * 60_000, path: '/instagram' });
  res.redirect(authorizeUrl(state));
});
app.get('/instagram/retorno', requireUser, requireAdmin, async (req, res) => {
  const back = (q: string) => res.redirect('/admin?' + q + '#instagram');
  const expected = req.cookies?.ig_state;
  res.clearCookie('ig_state', { path: '/instagram' });
  if (req.query.error) return back('ig=cancelado');
  if (!expected || req.query.state !== expected || typeof req.query.code !== 'string') return back('ig=invalido');
  try {
    const acc = await finishConnect(req.query.code, req.user!.id);
    logAction(req, 'instagram_conectado', { detail: { conta: acc.username } });
    back('ig=ok');
  } catch (e) {
    const msg = e instanceof IgError ? e.message : 'Não foi possível conectar.';
    if (!(e instanceof IgError)) console.error(e);
    logAction(req, 'erro_instagram', { detail: { motivo: msg, etapa: 'conectar' } });
    back('ig=erro&msg=' + encodeURIComponent(msg));
  }
});
app.use('/ig-media', express.static(igMediaDir, { index: false, dotfiles: 'deny', maxAge: 0, setHeaders: (r) => r.setHeader('Cache-Control', 'no-store') }));
app.use('/assets', express.static(path.join(pub, 'assets'), { maxAge: '1h' }));
app.use((_req, res) => {
  res.status(404).redirect('/');
});

app.use((err: Error & { type?: string }, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  if (err.type === 'entity.too.large') {
    res.status(413).json({ error: 'As fotos são grandes demais. Use imagens menores.' });
    return;
  }
  console.error(err);
  res.status(500).json({ error: 'Erro interno. Tente de novo.' });
});

app.listen(config.port, () => {
  console.log(`[estudio] rodando em http://localhost:${config.port} · IA ${aiReady() ? 'configurada' : 'SEM chave'} · modelo ${config.anthropicModel}`);
});
