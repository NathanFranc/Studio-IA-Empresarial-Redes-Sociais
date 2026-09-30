/** Chamada à API da Anthropic com imagens e leitura tolerante do JSON devolvido. */
import Anthropic from '@anthropic-ai/sdk';
import { config } from './config.js';

const client = config.anthropicKey ? new Anthropic({ apiKey: config.anthropicKey }) : null;

export class AiError extends Error {
  constructor(message: string, public status = 502) {
    super(message);
  }
}

type ImgType = 'image/jpeg' | 'image/png' | 'image/webp' | 'image/gif';

/** Converte data URLs (`data:image/jpeg;base64,...`) em blocos de imagem da API. */
function imageBlocks(images: string[]) {
  return images.slice(0, 5).flatMap((u) => {
    const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,([A-Za-z0-9+/=]+)$/.exec(u);
    if (!m) return [];
    return [{ type: 'image' as const, source: { type: 'base64' as const, media_type: m[1] as ImgType, data: m[2] } }];
  });
}

/** Extrai o primeiro valor JSON da resposta (texto puro, bloco ``` ou trecho entre { }). */
export function parseJson(text: string): unknown {
  const tries = [text.trim()];
  const fence = /```(?:json)?\s*([\s\S]*?)```/.exec(text);
  if (fence) tries.push(fence[1].trim());
  const a = text.indexOf('{'), b = text.lastIndexOf('}');
  if (a >= 0 && b > a) tries.push(text.slice(a, b + 1));
  for (const t of tries) {
    try {
      return JSON.parse(t);
    } catch {
      /* tenta a próxima forma */
    }
  }
  throw new AiError('A resposta da IA veio incompleta. Tente gerar de novo.');
}

export function aiReady(): boolean {
  return !!client;
}

/** Envia o prompt (e as fotos) e devolve o JSON interpretado. */
export async function askJson(prompt: string, images: string[]): Promise<unknown> {
  if (!client) throw new AiError('A chave da IA (ANTHROPIC_API_KEY) não está configurada no servidor.', 503);
  let msg;
  try {
    msg = await client.messages.create({
      model: config.anthropicModel,
      max_tokens: 4000,
      system: 'Você responde somente com um objeto JSON válido, sem texto antes ou depois.',
      messages: [{ role: 'user', content: [...imageBlocks(images), { type: 'text', text: prompt }] }],
    });
  } catch (e: unknown) {
    const status = (e as { status?: number }).status;
    if (status === 401) throw new AiError('A chave da IA é inválida. Confira ANTHROPIC_API_KEY.', 503);
    if (status === 429) throw new AiError('Muitos pedidos à IA agora. Espere um minuto e tente de novo.', 429);
    if (status === 400) throw new AiError('A IA recusou o pedido. Tente fotos menores ou uma descrição mais curta.', 400);
    throw new AiError('Não consegui falar com a IA agora. Tente de novo em instantes.');
  }
  const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  if (msg.stop_reason === 'max_tokens') throw new AiError('A resposta ficou longa demais. Tente com menos slides.');
  return parseJson(text);
}
