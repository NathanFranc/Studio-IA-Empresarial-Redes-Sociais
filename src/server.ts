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
import { mlRouter } from './routes/ml.js';
import { anymarketRouter, listingsRouter } from './routes/listings.js';
import { mlAuthorizeUrl, mlConfigured, mlFinishConnect, MlError, mlKeepAlive } from './ml.js';
import crypto from 'node:crypto';
import { authorizeUrl, cleanMedia, finishConnect, igConfigured, IgError, refreshIfNeeded } from './instagram.js';
import { seedAdmin } from './seed.js';
import { logAction } from './logs.js';
import { COMPANIES, pickCompany } from './companies.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

seedAdmin();
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 3600_000).unref();
cleanMedia();
setInterval(cleanMedia, 3600_000).unref();
void refreshIfNeeded();
setInterval(() => void refreshIfNeeded(), 6 * 3600_000).unref();
setInterval(() => void mlKeepAlive(), 24 * 3600_000).unref();

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
app.use('/api/ml/listings', requireUser, listingsRouter);
app.use('/api/ml', requireUser, mlRouter);
app.use('/api/anymarket', requireUser, anymarketRouter);
app.get('/api/companies', requireUser, (_req, res) => {
  res.json({ companies: Object.values(COMPANIES).map((c) => ({ id: c.id, name: c.name, handle: c.handle })) });
});
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
app.get('/ml', requireUser, page('ml.html'));

// ----- Mercado Livre: conectar (admin)
app.get('/ml/conectar', requireUser, requireAdmin, (_req, res) => {
  if (!mlConfigured()) return void res.redirect('/admin?ml=config#mercadolivre');
  const state = crypto.randomBytes(18).toString('base64url');
  res.cookie('ml_state', state, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 10 * 60_000, path: '/ml' });
  res.redirect(mlAuthorizeUrl(state));
});
app.get('/ml/retorno', requireUser, requireAdmin, async (req, res) => {
  const back = (q: string) => res.redirect('/admin?' + q + '#mercadolivre');
  const expected = req.cookies?.ml_state;
  res.clearCookie('ml_state', { path: '/ml' });
  if (req.query.error) return back('ml=cancelado');
  if (!expected || req.query.state !== expected || typeof req.query.code !== 'string') return back('ml=invalido');
  try {
    const acc = await mlFinishConnect(req.query.code, req.user!.id);
    logAction(req, 'ml_conectado', { detail: { conta: acc.nickname } });
    back('ml=ok');
  } catch (e) {
    const msg = e instanceof MlError ? e.message : 'Não foi possível conectar.';
    if (!(e instanceof MlError)) console.error(e);
    logAction(req, 'erro_ml', { detail: { etapa: 'conectar', motivo: msg } });
    back('ml=erro&msg=' + encodeURIComponent(msg));
  }
});

// ----- Instagram: conectar (admin) e imagens temporárias que o Instagram baixa
app.get('/instagram/conectar', requireUser, requireAdmin, (req, res) => {
  if (!igConfigured()) return void res.redirect('/admin?ig=config#instagram');
  const co = pickCompany(req.query.empresa).id;
  const state = crypto.randomBytes(18).toString('base64url');
  res.cookie('ig_state', state + '.' + co, { httpOnly: true, sameSite: 'lax', secure: config.cookieSecure, maxAge: 10 * 60_000, path: '/instagram' });
  res.redirect(authorizeUrl(state));
});
app.get('/instagram/retorno', requireUser, requireAdmin, async (req, res) => {
  const [expected, co] = String(req.cookies?.ig_state ?? '').split('.');
  const back = (q: string) => res.redirect('/admin?' + q + '&empresa=' + encodeURIComponent(co || '') + '#instagram');
  res.clearCookie('ig_state', { path: '/instagram' });
  if (req.query.error) return back('ig=cancelado');
  if (!expected || req.query.state !== expected || typeof req.query.code !== 'string') return back('ig=invalido');
  try {
    const company = pickCompany(co);
    const acc = await finishConnect(req.query.code, req.user!.id, company.id);
    logAction(req, 'instagram_conectado', { detail: { empresa: company.name, conta: acc.username } });
    back('ig=ok');
  } catch (e) {
    const msg = e instanceof IgError ? e.message : 'Não foi possível conectar.';
    if (!(e instanceof IgError)) console.error(e);
    logAction(req, 'erro_instagram', { detail: { motivo: msg, etapa: 'conectar' } });
    back('ig=erro&msg=' + encodeURIComponent(msg));
  }
});
app.use('/ig-media', express.static(igMediaDir, { index: false, dotfiles: 'deny', maxAge: 0, setHeaders: (r) => r.setHeader('Cache-Control', 'no-store') }));
// JS e CSS sempre revalidados (ETag), para cada atualização aparecer sem precisar limpar o cache; imagens ficam 1 h.
app.use('/assets', express.static(path.join(pub, 'assets'), {
  maxAge: '1h',
  setHeaders: (res, file) => { if (/\.(js|css)$/.test(file)) res.setHeader('Cache-Control', 'no-cache'); },
}));
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
