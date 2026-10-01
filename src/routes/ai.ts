/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Geração de textos com IA (post rápido e carrossel), com log e limite diário opcional. */
import { Router } from 'express';
import { AiError, askJson } from '../ai.js';
import { config } from '../config.js';
import { db } from '../db.js';
import { logAction } from '../logs.js';
import { carouselPrompt, postPrompt } from '../prompts.js';
import { pickCompany } from '../companies.js';

export const aiRouter = Router();

function overLimit(userId: number): boolean {
  if (!config.dailyAiLimit) return false;
  const row = db.prepare(
    `SELECT COUNT(*) AS n FROM logs WHERE user_id = ? AND action IN ('gerar_post','gerar_carrossel')
       AND created_at >= datetime('now','start of day')`,
  ).get(userId) as { n: number };
  return row.n >= config.dailyAiLimit;
}

function readImages(body: unknown): string[] {
  const list = (body as { images?: unknown })?.images;
  return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 5) : [];
}

aiRouter.post('/post', async (req, res) => {
  const desc = String(req.body?.desc ?? '').trim();
  if (!desc) {
    res.status(400).json({ error: 'Cole a descrição ou ficha técnica do produto.' });
    return;
  }
  if (overLimit(req.user!.id)) {
    res.status(429).json({ error: `Você atingiu o limite de ${config.dailyAiLimit} gerações por dia.` });
    return;
  }
  const images = readImages(req.body).slice(0, 1);
  const photoWhite = typeof req.body?.photoWhite === 'boolean' ? req.body.photoWhite : null;
  const started = Date.now();
  try {
    const result = await askJson(postPrompt(pickCompany(req.body?.company), desc, images.length, photoWhite), images);
    const r = result as { titulo?: string; modelo?: string };
    logAction(req, 'gerar_post', { detail: { empresa: pickCompany(req.body?.company).name, titulo: r.titulo ?? '', modelo: r.modelo ?? '', fotos: images.length, ms: Date.now() - started } });
    res.json({ result });
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError('Algo falhou na geração.');
    logAction(req, 'erro_ia', { detail: { tipo: 'post', erro: err.message } });
    res.status(err.status).json({ error: err.message });
  }
});

aiRouter.post('/carousel', async (req, res) => {
  const desc = String(req.body?.desc ?? '').trim();
  const n = Math.min(8, Math.max(5, Number(req.body?.n) || 6));
  const tema = String(req.body?.tema ?? '').trim();
  if (!desc) {
    res.status(400).json({ error: 'Cole a descrição ou ficha técnica do produto.' });
    return;
  }
  if (overLimit(req.user!.id)) {
    res.status(429).json({ error: `Você atingiu o limite de ${config.dailyAiLimit} gerações por dia.` });
    return;
  }
  const images = readImages(req.body);
  const started = Date.now();
  try {
    const result = await askJson(carouselPrompt(pickCompany(req.body?.company), desc, images.length, tema, n), images);
    const r = result as { produto?: string };
    logAction(req, 'gerar_carrossel', { detail: { empresa: pickCompany(req.body?.company).name, produto: r.produto ?? '', slides: n, tema, fotos: images.length, ms: Date.now() - started } });
    res.json({ result });
  } catch (e) {
    const err = e instanceof AiError ? e : new AiError('Algo falhou na geração.');
    logAction(req, 'erro_ia', { detail: { tipo: 'carrossel', erro: err.message } });
    res.status(err.status).json({ error: err.message });
  }
});
