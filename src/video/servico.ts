/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * Gerador de vídeo da Mídia dos concorrentes (2026-10-22, pedido do Nathan: "tem alguns produtos que realmente
 * não têm vídeos… criar um campo gerador de vídeo… a pessoa manda a foto e já gera"). Só para pesquisa PRONTA
 * que não trouxe nenhum vídeo (a rota confere no bitbrain). O roteiro é fixo (roteiro.ts) e o serviço é trocável
 * (provedores.ts). Limite por dia no Estúdio inteiro, porque cada vídeo custa.
 *
 * Fluxo: a rota reserva a vaga do dia e grava a linha (situacao 'gerando') → pede ao provedor → a rotina
 * `acompanhar` (a cada 15 s) pergunta se ficou pronto e grava data/videos/<id>.mp4. O código da operação fica no
 * banco: reiniciar o servidor no meio não perde o vídeo.
 */
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config, videosDir } from '../config.js';
import { db } from '../db.js';
import { GeradorErro, motivoDesligado, provedorAtivo } from './provedores.js';
import { roteiroApresentacao } from './roteiro.js';

fs.mkdirSync(videosDir, { recursive: true });

db.exec(`
CREATE TABLE IF NOT EXISTS video_gerado (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER REFERENCES users(id) ON DELETE SET NULL,
  pesquisa_id INTEGER NOT NULL,             -- pesquisa de mídia no bitbrain
  produto     TEXT NOT NULL,
  marca       TEXT,
  modelo      TEXT,
  provedor    TEXT NOT NULL,                -- chave do GERADOR_VIDEO (simulado, omni, veo…)
  operacao    TEXT,                         -- código da operação no serviço (NULL = ainda não pediu)
  situacao    TEXT NOT NULL DEFAULT 'gerando',  -- gerando | pronto | erro | apagado
  erro        TEXT,
  bytes       INTEGER NOT NULL DEFAULT 0,
  criado_em   TEXT NOT NULL DEFAULT (datetime('now')),
  pronto_em   TEXT
);
CREATE INDEX IF NOT EXISTS video_gerado_pesquisa ON video_gerado(pesquisa_id, id);
CREATE INDEX IF NOT EXISTS video_gerado_criado ON video_gerado(criado_em);
`);

export interface VideoRow {
  id: number; user_id: number | null; pesquisa_id: number; produto: string; marca: string | null; modelo: string | null;
  provedor: string; operacao: string | null; situacao: string; erro: string | null; bytes: number;
  criado_em: string; pronto_em: string | null;
}

/** Desde a meia-noite de Brasília (o servidor grava em UTC). */
const HOJE_BRT = "datetime('now','-3 hours','start of day','+3 hours')";
/** Conta no limite tudo o que foi pedido hoje, menos o que falhou ANTES de chegar ao serviço (não foi cobrado). */
const usadosHoje = db.prepare(
  `SELECT COUNT(*) AS n FROM video_gerado WHERE criado_em >= ${HOJE_BRT} AND NOT (situacao = 'erro' AND operacao IS NULL)`,
);

export function estado() {
  const motivo = motivoDesligado();
  const usados = (usadosHoje.get() as { n: number }).n;
  const limite = Math.max(0, config.geradorVideoLimiteDia);
  return {
    ligado: !motivo,
    motivo,
    provedor: provedorAtivo()?.nome ?? null,
    duracao_s: config.geradorVideoDuracao,
    limite_dia: limite,
    usados_hoje: usados,
    restantes: Math.max(0, limite - usados),
    guarda_dias: config.geradorVideoGuardaDias,
  };
}

const publico = (v: VideoRow) => ({
  id: v.id, pesquisa_id: v.pesquisa_id, situacao: v.situacao, erro: v.erro, bytes: v.bytes,
  criado_em: v.criado_em, pronto_em: v.pronto_em,
  video: v.situacao === 'pronto' ? `/api/midia/gerador/${v.id}/video` : null,
});

export function daPesquisa(pesquisaId: number) {
  const linhas = db.prepare('SELECT * FROM video_gerado WHERE pesquisa_id = ? ORDER BY id DESC LIMIT 20').all(pesquisaId) as VideoRow[];
  return linhas.map(publico);
}

export function buscar(id: number): VideoRow | null {
  return (db.prepare('SELECT * FROM video_gerado WHERE id = ?').get(id) as VideoRow | undefined) ?? null;
}

export function arquivoDoVideo(id: number): string {
  return path.join(videosDir, id + '.mp4');
}

/** Foto em data URL (JPEG/PNG/WEBP) → JPEG até 1280 px. Recusa foto pequena demais para virar vídeo. */
export async function prepararFoto(dataUrl: unknown): Promise<Buffer> {
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl ?? ''));
  if (!m) throw new GeradorErro('Envie uma foto JPG, PNG ou WEBP do produto.', 400);
  const bruto = Buffer.from(m[2], 'base64');
  if (bruto.length > 15 * 1024 * 1024) throw new GeradorErro('A foto passa de 15 MB. Use uma menor.', 400);
  try {
    const meta = await sharp(bruto).metadata();
    if ((meta.width ?? 0) < 300 || (meta.height ?? 0) < 300) throw new GeradorErro('A foto é pequena demais (mínimo 300×300). Use uma foto melhor do produto.', 400);
    return await sharp(bruto).rotate().flatten({ background: '#ffffff' })
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true }).jpeg({ quality: 90 }).toBuffer();
  } catch (e) {
    if (e instanceof GeradorErro) throw e;
    throw new GeradorErro('Não consegui ler a foto. Tente outra.', 400);
  }
}

/**
 * Reserva a vaga do dia e pede o vídeo. A conferência do limite e a gravação da linha vão na mesma transação
 * (dois cliques ao mesmo tempo não passam do limite).
 */
export async function iniciar(p: {
  userId: number; pesquisaId: number; produto: string; marca?: string; modelo?: string; foto: Buffer;
}): Promise<VideoRow> {
  const provedor = provedorAtivo();
  const motivo = motivoDesligado();
  if (!provedor || motivo) throw new GeradorErro(motivo || 'O gerador de vídeo está desligado.', 503);

  const reservar = db.transaction(() => {
    const andando = db.prepare("SELECT id FROM video_gerado WHERE pesquisa_id = ? AND situacao = 'gerando'").get(p.pesquisaId);
    if (andando) throw new GeradorErro('Já tem um vídeo sendo gerado para esta pesquisa. Espere terminar.', 409);
    const usados = (usadosHoje.get() as { n: number }).n;
    if (usados >= config.geradorVideoLimiteDia) {
      throw new GeradorErro(`O limite de ${config.geradorVideoLimiteDia} vídeos por dia já foi usado. Amanhã libera de novo.`, 429);
    }
    const r = db.prepare('INSERT INTO video_gerado (user_id, pesquisa_id, produto, marca, modelo, provedor) VALUES (?, ?, ?, ?, ?, ?)')
      .run(p.userId, p.pesquisaId, p.produto, p.marca || null, p.modelo || null, config.geradorVideo);
    return Number(r.lastInsertRowid);
  });
  const id = reservar();

  fs.writeFileSync(path.join(videosDir, id + '.jpg'), p.foto);
  const prompt = roteiroApresentacao({ produto: p.produto, marca: p.marca, modelo: p.modelo, duracaoS: config.geradorVideoDuracao });
  try {
    const operacao = await provedor.iniciar({ foto: p.foto, prompt, duracaoS: config.geradorVideoDuracao, proporcao: '9:16' });
    db.prepare('UPDATE video_gerado SET operacao = ? WHERE id = ?').run(String(operacao).slice(0, 500), id);
  } catch (e) {
    // Sem operação = o serviço não aceitou: não conta no limite do dia.
    const msg = e instanceof GeradorErro ? e.message : 'O serviço de vídeo não aceitou o pedido. Tente de novo em instantes.';
    if (!(e instanceof GeradorErro)) console.error('[gerador]', e);
    db.prepare("UPDATE video_gerado SET situacao = 'erro', erro = ? WHERE id = ?").run(msg, id);
    throw new GeradorErro(msg);
  }
  return buscar(id)!;
}

const PRAZO_MIN = 20;
let rodando = false;

/** Pergunta ao serviço como estão os vídeos em andamento. Roda a cada 15 s (server.ts). */
export async function acompanhar(): Promise<void> {
  if (rodando) return;
  rodando = true;
  try {
    // Linha sem operação há mais de 5 min = o servidor caiu no meio do pedido.
    db.prepare(`UPDATE video_gerado SET situacao = 'erro', erro = 'O pedido não chegou ao serviço de vídeo. Tente de novo.'
                WHERE situacao = 'gerando' AND operacao IS NULL AND criado_em < datetime('now','-5 minutes')`).run();
    const andando = db.prepare("SELECT * FROM video_gerado WHERE situacao = 'gerando' AND operacao IS NOT NULL ORDER BY id LIMIT 10").all() as VideoRow[];
    if (!andando.length) return;
    const provedor = provedorAtivo();
    for (const v of andando) {
      if (!provedor || v.provedor !== config.geradorVideo) {
        db.prepare("UPDATE video_gerado SET situacao = 'erro', erro = 'O gerador de vídeo foi trocado ou desligado no meio.' WHERE id = ?").run(v.id);
        continue;
      }
      try {
        const a = await provedor.consultar(v.operacao!);
        if ('erro' in a) {
          db.prepare("UPDATE video_gerado SET situacao = 'erro', erro = ? WHERE id = ?").run(a.erro.slice(0, 300), v.id);
        } else if (a.pronto) {
          fs.writeFileSync(arquivoDoVideo(v.id), a.video);
          db.prepare("UPDATE video_gerado SET situacao = 'pronto', bytes = ?, pronto_em = datetime('now') WHERE id = ?").run(a.video.length, v.id);
        } else if (Date.parse(v.criado_em.replace(' ', 'T') + 'Z') < Date.now() - PRAZO_MIN * 60_000) {
          db.prepare("UPDATE video_gerado SET situacao = 'erro', erro = ? WHERE id = ?").run(`O serviço passou de ${PRAZO_MIN} minutos sem entregar o vídeo.`, v.id);
        }
      } catch (e) {
        console.error('[gerador] consultar', v.id, e); // tenta de novo na próxima volta (o prazo acima encerra)
      }
    }
  } finally {
    rodando = false;
  }
}

/** Apaga do disco os vídeos (e fotos) com mais de GERADOR_VIDEO_GUARDA_DIAS. A linha fica, como 'apagado'. */
export function limparAntigos(): void {
  const dias = Math.max(1, config.geradorVideoGuardaDias);
  const velhos = db.prepare(`SELECT id FROM video_gerado WHERE situacao IN ('pronto','erro') AND criado_em < datetime('now', ?)`)
    .all(`-${dias} days`) as { id: number }[];
  for (const { id } of velhos) {
    for (const f of [arquivoDoVideo(id), path.join(videosDir, id + '.jpg')]) fs.rmSync(f, { force: true });
    db.prepare("UPDATE video_gerado SET situacao = 'apagado' WHERE id = ?").run(id);
  }
}
