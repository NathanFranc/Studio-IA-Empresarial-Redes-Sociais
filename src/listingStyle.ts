/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * Padrão de anúncio da loja (título SEO + estrutura da descrição), tirado dos anúncios da
 * própria Megadino no Mercado Livre (Wahl Vapor Switch e Intelbras V3501). O administrador pode
 * trocar o texto por empresa em Administração › Mercado Livre (chave ml_style:<empresa>).
 */
import { getSetting, setSetting } from './db.js';

export const DEFAULT_STYLE = `TÍTULO (SEO)
- 55 a 60 caracteres, com as palavras que o comprador digita na busca, nesta ordem: tipo do produto + qualificador de uso + marca + modelo + 2 ou 3 atributos mais buscados (voltagem, capacidade, recurso principal).
- Cada palavra com inicial maiúscula. Sem emojis, sem símbolos, sem pontuação, sem palavras repetidas.
- Sem "promoção", "oferta", "frete grátis", "original", "lançamento", "melhor", "top", nome de loja ou estado de conservação.
- Exemplos nossos: "Maquina Cortar Cabelo Profissional Wahl Vapor Switch Bivolt" · "Telefone Ip Intelbras V3501 Display Voip Viva-voz Hd Voice".

DESCRIÇÃO (texto puro, sem emojis, sem links, sem contato)
1) Abertura de 2 a 5 parágrafos corridos e técnicos: o que é o produto (com nome e modelo), para quem foi feito, as tecnologias e recursos com nome próprio (mantendo ™ e ® quando o fabricante usa) e o benefício de cada um no uso real. Tom profissional e confiante, sem exagero.
2) "PRINCIPAIS DIFERENCIAIS:" (ou "PRINCIPAIS CARACTERÍSTICAS:" quando o produto é mais técnico) com 4 a 8 itens no formato "- Nome do recurso: explicação curta do benefício;", com uma linha em branco entre os itens.
3) "ESPECIFICAÇÕES TÉCNICAS:" com itens "- Nome: valor" (com unidade), começando por Marca, Linha (se houver) e Modelo. Em produto técnico (rede, áudio, informática), divida em blocos como "ESPECIFICAÇÕES TÉCNICAS DE REDE:" e "ESPECIFICAÇÕES TÉCNICAS DE ÁUDIO:".
4) "CONTEÚDO DA EMBALAGEM:" com itens "- 01 Nome do item" (quantidade com 2 dígitos). Só o que os dados confirmam.
5) Quando fizer sentido, "ORIENTAÇÕES DE USO E MANUTENÇÃO:" com 2 a 4 itens "- Tema: orientação.".
6) Última linha: "Garantia de fábrica: N meses" (só se a garantia estiver nos dados; senão não escreva a linha e avise em alertas).
Títulos de seção em CAIXA ALTA terminando com dois-pontos, uma linha em branco entre as seções. Não termine com frase de loja.`;

export function getStyle(co: string): string {
  return (getSetting('ml_style:' + co) ?? '').trim() || DEFAULT_STYLE;
}
export function setStyle(co: string, text: string | null): void {
  const t = (text ?? '').trim();
  setSetting('ml_style:' + co, t && t !== DEFAULT_STYLE ? t.slice(0, 8000) : null);
}
export const isCustomStyle = (co: string) => !!(getSetting('ml_style:' + co) ?? '').trim();

/** Conferência automática do título (o que dá para checar sem IA). */
const BANNED = ['promocao', 'promoção', 'oferta', 'frete gratis', 'frete grátis', 'original', 'lancamento', 'lançamento', 'melhor', 'top', 'barato', 'imperdivel', 'imperdível', 'queima'];
export function titleIssues(t: string): string[] {
  const out: string[] = [], s = t.trim(), low = s.toLowerCase();
  if (s.length > 60) out.push(`tem ${s.length} caracteres (máximo 60)`);
  else if (s.length < 45) out.push(`tem só ${s.length} caracteres; use 55 a 60 com mais palavras de busca`);
  for (const b of BANNED) if (new RegExp('(^|\\s)' + b + '(\\s|$)').test(low)) out.push(`tem a palavra "${b}", que o ML não recomenda`);
  const words = low.split(/\s+/).filter((w) => w.length > 2), seen = new Set<string>();
  for (const w of words) { if (seen.has(w)) { out.push(`repete a palavra "${w}"`); break; } seen.add(w); }
  if (/[!?*#@$%|/\\]|[\u{1F300}-\u{1FAFF}]/u.test(s)) out.push('tem símbolo ou emoji');
  if (s.length > 8 && s === s.toUpperCase()) out.push('está todo em maiúsculas');
  return out;
}
