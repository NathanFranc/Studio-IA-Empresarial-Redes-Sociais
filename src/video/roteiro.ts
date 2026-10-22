/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * Roteiro FIXO do vídeo de apresentação. 2026-10-22, pedido do Nathan: "um modelo único para todos os produtos…
 * tudo a questão do gerador do prompt fica escondido para o usuário". Nenhuma IA escreve texto por vídeo (sem
 * gastar tokens): só entram nome, marca e modelo da pesquisa. Fica no servidor e nunca vai para o navegador.
 *
 * Em inglês porque os geradores de vídeo seguem melhor; sem texto na tela (os geradores escrevem letras
 * erradas) e sem voz (a loja põe a própria narração, se quiser).
 */
export function roteiroApresentacao(p: { produto: string; marca?: string; modelo?: string; duracaoS: number }): string {
  const nome = [p.marca, p.produto, p.modelo].map((s) => limpar(s ?? '')).filter(Boolean).join(' ');
  return [
    `A ${p.duracaoS}-second vertical product presentation video of the product in the reference image: ${nome}.`,
    'Keep the product exactly as in the photo: same shape, colors, logo and details. Do not add, remove or change parts.',
    'Clean seamless studio background in soft neutral tones, professional studio lighting with gentle reflections.',
    'Camera: slow smooth orbit around the product, then a slow push-in to a close-up of its main details, ending on a centered hero shot.',
    'The product stays centered and fully visible. No people, no hands, no other objects.',
    'No text, no captions, no logos added, no watermarks.',
    'Audio: soft modern background music, no voice-over.',
  ].join(' ');
}

/** Só letras, números e pontuação simples: o nome vem da pesquisa digitada no Estúdio. */
function limpar(s: string): string {
  return s.replace(/[^\p{L}\p{N} .,'"+\-/()]/gu, ' ').replace(/\s+/g, ' ').trim().slice(0, 120);
}
