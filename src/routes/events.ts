/** Eventos que só o navegador conhece (downloads, cópia de legenda). */
import { Router } from 'express';
import { logAction, type Action } from '../logs.js';

export const eventsRouter = Router();

const CLIENT_ACTIONS: Action[] = ['baixar_post', 'baixar_carrossel', 'baixar_slide', 'copiar_legenda'];

eventsRouter.post('/', (req, res) => {
  const action = req.body?.action as Action;
  if (!CLIENT_ACTIONS.includes(action)) {
    res.status(400).json({ error: 'Evento desconhecido.' });
    return;
  }
  const postId = Number(req.body?.postId) || null;
  const detail = req.body?.detail && typeof req.body.detail === 'object' ? req.body.detail : undefined;
  logAction(req, action, { postId, detail });
  res.json({ ok: true });
});
