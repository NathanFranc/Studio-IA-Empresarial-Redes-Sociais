/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * Serviços que geram o vídeo. Cada um é uma peça trocável com duas etapas, porque os geradores do Google
 * (Omni Flash, Veo) levam de 10 s a 6 min: `iniciar` pede o vídeo e devolve o código da operação (guardado
 * no banco, então o reinício do servidor não perde nada) e `consultar` diz se ficou pronto.
 *
 * 2026-10-22, decisão do Nathan: "vamos deixar criada a estrutura, pois quando o adm escolher o gerador aí
 * nos conectamos". Para ligar um serviço de verdade: escrever o provedor aqui, pôr no PROVEDORES e configurar
 * GERADOR_VIDEO (+ GERADOR_VIDEO_CHAVE, GERADOR_VIDEO_MODELO) no .env.
 */
import { config } from '../config.js';
import { VIDEO_SIMULADO_B64 } from './simulado.js';

export interface PedidoVideo {
  /** Foto do produto em JPEG (já normalizada pelo servidor). */
  foto: Buffer;
  /** Roteiro fixo montado em roteiro.ts. Nunca vem do navegador. */
  prompt: string;
  duracaoS: number;
  proporcao: '9:16';
}

export type Andamento =
  | { pronto: false }
  | { pronto: true; video: Buffer; tipo: string }
  | { erro: string };

export interface Provedor {
  /** Nome que aparece na tela e no Log. */
  nome: string;
  iniciar(p: PedidoVideo): Promise<string>;
  consultar(operacao: string): Promise<Andamento>;
}

/** Erro com texto que pode ir para a tela. */
export class GeradorErro extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

/** Teste sem custo: "gera" em ~15 s um vídeo fixo escrito VIDEO DE TESTE. Serve para conferir a tela e o fluxo. */
const simulado: Provedor = {
  nome: 'Simulado (teste, sem custo)',
  async iniciar() {
    return 'sim:' + Date.now();
  },
  async consultar(operacao) {
    const t = Number(operacao.slice(4)) || 0;
    if (Date.now() - t < 15_000) return { pronto: false };
    return { pronto: true, video: Buffer.from(VIDEO_SIMULADO_B64, 'base64'), tipo: 'video/mp4' };
  },
};

const PROVEDORES: Record<string, Provedor> = {
  simulado,
  // omni: …  (Gemini Omni Flash, API do Gemini) — quando o administrador escolher
  // veo: …   (Veo pelo Google Cloud / Vertex AI) — quando o administrador escolher
};

/** O provedor ligado no .env, ou null (desligado ou nome desconhecido). */
export function provedorAtivo(): Provedor | null {
  return PROVEDORES[config.geradorVideo] ?? null;
}

/** Explica na tela por que o gerador está desligado ('' = ligado). */
export function motivoDesligado(): string {
  if (!config.geradorVideo) return 'O gerador de vídeo ainda não foi configurado. O administrador vai escolher o serviço.';
  if (!PROVEDORES[config.geradorVideo]) return 'O gerador "' + config.geradorVideo + '" ainda não existe no Estúdio.';
  if (config.geradorVideoLimiteDia <= 0) return 'O limite de vídeos por dia está em zero.';
  return '';
}
