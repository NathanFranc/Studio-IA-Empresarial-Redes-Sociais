/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
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
/** Traduz o erro da API da Anthropic para uma mensagem clara (e registra o original nos logs do servidor). */
function explain(e: unknown): AiError {
  const err = e as { status?: number; message?: string; error?: { error?: { type?: string; message?: string } } };
  const status = err.status;
  const detail = String(err.error?.error?.message ?? err.message ?? '');
  const type = String(err.error?.error?.type ?? '');
  console.error('[ia] erro', status ?? '-', type, detail.slice(0, 300));
  if (status === 401) return new AiError('A chave da IA é inválida ou foi desativada. Gere outra em console.anthropic.com e troque ANTHROPIC_API_KEY no .env do servidor.', 503);
  if (status === 403) return new AiError('A chave da IA não tem permissão para usar este modelo. Confira a chave e o ANTHROPIC_MODEL no .env.', 503);
  if (status === 404 || type === 'not_found_error') return new AiError(`O modelo "${config.anthropicModel}" não foi encontrado para esta chave. Confira ANTHROPIC_MODEL no .env.`, 503);
  if (/credit balance|billing|purchase credits/i.test(detail)) return new AiError('A conta da Anthropic está sem créditos. Adicione créditos em console.anthropic.com > Billing.', 503);
  if (status === 429) return new AiError('Muitos pedidos à IA agora (ou o limite da conta foi atingido). Espere um minuto e tente de novo.', 429);
  if (status === 529 || type === 'overloaded_error') return new AiError('A IA está sobrecarregada neste momento. Tente de novo em alguns segundos.', 503);
  if (status === 400) return new AiError('A IA recusou o pedido' + (detail ? ': ' + detail.slice(0, 160) : '.') , 400);
  if (!status) return new AiError('O servidor não conseguiu falar com a API da Anthropic (rede ou firewall do VPS). Tente de novo em instantes.');
  return new AiError('Não consegui falar com a IA agora (erro ' + status + '). Tente de novo em instantes.');
}

/** Teste rápido da chave e do modelo, para o painel do administrador. */
export async function testAi(): Promise<{ ok: boolean; model: string; message: string; ms: number }> {
  const t0 = Date.now();
  if (!client) return { ok: false, model: config.anthropicModel, message: 'A chave da IA (ANTHROPIC_API_KEY) não está configurada no servidor.', ms: 0 };
  try {
    await client.messages.create({ model: config.anthropicModel, max_tokens: 5, messages: [{ role: 'user', content: 'Responda apenas: ok' }] });
    return { ok: true, model: config.anthropicModel, message: 'A IA respondeu normalmente.', ms: Date.now() - t0 };
  } catch (e) {
    return { ok: false, model: config.anthropicModel, message: explain(e).message, ms: Date.now() - t0 };
  }
}

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
    throw explain(e);
  }
  const text = msg.content.map((c) => (c.type === 'text' ? c.text : '')).join('');
  if (msg.stop_reason === 'max_tokens') throw new AiError('A resposta ficou longa demais. Tente com menos slides.');
  return parseJson(text);
}
