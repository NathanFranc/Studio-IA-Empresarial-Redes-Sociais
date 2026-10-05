/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Eventos que só o navegador conhece (downloads, cópia de legenda). */
import { Router } from 'express';
import { logAction, type Action } from '../logs.js';

export const eventsRouter = Router();

const CLIENT_ACTIONS: Action[] = ['baixar_post', 'baixar_carrossel', 'baixar_slide', 'copiar_legenda', 'ml_baixar_fotos'];

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
