/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * Gerador de vídeo da Mídia dos concorrentes (ver src/video/servico.ts). Só para pesquisa PRONTA sem nenhum
 * vídeo, conferida no bitbrain na hora do pedido. Nome, marca e modelo vêm da pesquisa (não do navegador),
 * e o roteiro nunca sai do servidor.
 */
import { Router, type Response } from 'express';
import fs from 'node:fs';
import { logAction } from '../logs.js';
import { GeradorErro } from '../video/provedores.js';
import { arquivoDoVideo, buscar, daPesquisa, estado, iniciar, prepararFoto } from '../video/servico.js';
import { bitbrain, MidiaError } from './midia.js';

export const geradorRouter = Router();

const PID = /^\d{1,12}$/;

const fail = (res: Response, e: unknown) => {
  if (e instanceof GeradorErro || e instanceof MidiaError) return void res.status(e.status).json({ error: e.message });
  console.error('[gerador]', e);
  res.status(500).json({ error: 'Algo falhou no gerador de vídeo. Tente de novo.' });
};

/** A pesquisa no bitbrain, com o motivo quando ela não pode receber vídeo gerado. */
async function pesquisaParaGerar(id: number) {
  const d = await bitbrain({ acao: 'midia_situacao', id });
  const p = (d.pesquisa ?? {}) as Record<string, unknown>;
  const a = (p.arquivos ?? {}) as Record<string, unknown>;
  let motivo = '';
  if (p.situacao !== 'pronta') motivo = 'O gerador só abre quando a pesquisa estiver pronta.';
  else if (Number(a.videos) > 0) motivo = 'Esta pesquisa já trouxe vídeos dos concorrentes. O gerador é para produto sem nenhum vídeo.';
  return { p, motivo };
}

geradorRouter.get('/estado', (_req, res) => {
  res.json(estado());
});

/** Estado do gerador + vídeos já gerados para a pesquisa. Não chama o bitbrain (a tela já tem a pesquisa). */
geradorRouter.get('/pesquisa/:id', (req, res) => {
  const id = String(req.params.id);
  if (!PID.test(id)) return void res.status(400).json({ error: 'Pesquisa inválida.' });
  res.json({ estado: estado(), videos: daPesquisa(Number(id)) });
});

geradorRouter.post('/pesquisa/:id', async (req, res) => {
  const id = String(req.params.id);
  if (!PID.test(id)) return void res.status(400).json({ error: 'Pesquisa inválida.' });
  const pid = Number(id);
  try {
    const e = estado();
    if (!e.ligado) throw new GeradorErro(e.motivo, 503);
    const foto = await prepararFoto(req.body?.foto);
    const { p, motivo } = await pesquisaParaGerar(pid);
    if (motivo) throw new GeradorErro(motivo, 409);
    const v = await iniciar({
      userId: req.user!.id, pesquisaId: pid, foto,
      produto: String(p.termo ?? '').slice(0, 120), marca: String(p.marca ?? '').slice(0, 60), modelo: String(p.modelo ?? '').slice(0, 60),
    });
    logAction(req, 'video_gerar', { detail: { pesquisa: pid, video: v.id, produto: v.produto, marca: v.marca, modelo: v.modelo, provedor: v.provedor } });
    res.json({ estado: estado(), videos: daPesquisa(pid) });
  } catch (e) {
    logAction(req, 'erro_video', { detail: { pesquisa: pid, motivo: (e as Error).message } });
    fail(res, e);
  }
});

/** O vídeo pronto. res.sendFile responde com Range (o player pula para qualquer ponto). ?baixar=1 = download. */
geradorRouter.get('/:id/video', (req, res) => {
  const id = String(req.params.id);
  if (!PID.test(id)) return void res.status(400).end();
  const v = buscar(Number(id));
  const arq = arquivoDoVideo(Number(id));
  if (!v || v.situacao !== 'pronto' || !fs.existsSync(arq)) return void res.status(404).json({ error: 'Vídeo não encontrado (pode ter passado do prazo de guarda).' });
  const baixar = req.query.baixar === '1';
  if (baixar) {
    const nome = [v.marca, v.produto, v.modelo].filter(Boolean).join(' ').replace(/[^\p{L}\p{N} _-]/gu, '').trim().slice(0, 80) || 'video';
    res.attachment(nome + ' - video gerado.mp4');
    if (!req.headers.range) logAction(req, 'video_baixar', { detail: { video: v.id, pesquisa: v.pesquisa_id } });
  }
  res.setHeader('cache-control', 'private, max-age=3600');
  res.sendFile(arq, { headers: { 'content-type': 'video/mp4', 'x-content-type-options': 'nosniff' } });
});
