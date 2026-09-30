/** Servidor do Estúdio Megadino: páginas, API e arquivos estáticos. */
import cookieParser from 'cookie-parser';
import express from 'express';
import helmet from 'helmet';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { aiReady } from './ai.js';
import { loadUser, requireAdmin, requireAjaxHeader, requireUser } from './auth.js';
import { config } from './config.js';
import { purgeExpiredSessions } from './db.js';
import { adminRouter } from './routes/admin.js';
import { aiRouter } from './routes/ai.js';
import { authRouter } from './routes/auth.js';
import { eventsRouter } from './routes/events.js';
import { postsRouter } from './routes/posts.js';
import { seedAdmin } from './seed.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pub = path.join(root, 'public');

seedAdmin();
purgeExpiredSessions();
setInterval(purgeExpiredSessions, 3600_000).unref();

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
