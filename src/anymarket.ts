/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * AnyMarket (API v2, cabeçalho gumgaToken). Um token por empresa: ANYMARKET_TOKEN_MEGADINO,
 * ANYMARKET_TOKEN_IDMSHOP… O endereço (sandbox ou produção) vem de ANYMARKET_API_URL.
 * Monta o produto a partir do anúncio do Studio ML e envia com POST /products.
 */
import { config } from './config.js';

export class AmError extends Error {
  constructor(message: string, public status = 502) { super(message); }
}

const tokenOf = (co: string) => (process.env['ANYMARKET_TOKEN_' + co.toUpperCase()] ?? '').trim();
export const amConfigured = (co: string) => !!tokenOf(co);
export const amSandbox = () => /sandbox/i.test(config.anymarketUrl);

async function am(co: string, path: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const tok = tokenOf(co);
  if (!tok) throw new AmError('O token do AnyMarket desta empresa não está configurado no servidor (ANYMARKET_TOKEN_' + co.toUpperCase() + ').', 400);
  let res: Response;
  try {
    res = await fetch(config.anymarketUrl + path, {
      ...init,
      headers: { gumgaToken: tok, platform: 'ESTUDIO', accept: 'application/json', 'content-type': 'application/json', ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(40_000),
    });
  } catch {
    throw new AmError('Não foi possível falar com o AnyMarket agora. Tente de novo em instantes.');
  }
  const text = await res.text();
  let body: unknown = text;
  try { body = text ? JSON.parse(text) : {}; } catch { /* resposta em texto */ }
  if (res.status === 401 || res.status === 403) throw new AmError('O AnyMarket recusou o token desta empresa. Confira o ANYMARKET_TOKEN e se ele é do ambiente certo (sandbox ou produção).', 400);
  if (res.status === 429) {
    const wait = Number(res.headers.get('ratelimit-reset') ?? '') || 60;
    throw new AmError(`O AnyMarket limitou as chamadas agora. Espere ${wait} segundo(s) e tente de novo.`, 429);
  }
  return { status: res.status, body };
}

/** Mensagem legível dos erros de validação do AnyMarket. */
function amMessage(body: unknown): string {
  if (typeof body === 'string') return body.slice(0, 300);
  const b = body as { message?: string; details?: unknown; errors?: unknown; error?: string };
  const parts: string[] = [];
  if (b?.message) parts.push(String(b.message));
  for (const list of [b?.details, b?.errors]) {
    if (Array.isArray(list)) for (const e of list.slice(0, 6)) parts.push(typeof e === 'string' ? e : String((e as { message?: string; field?: string }).message ?? JSON.stringify(e)));
    else if (typeof list === 'string') parts.push(list);
  }
  if (!parts.length && b?.error) parts.push(String(b.error));
  return parts.join(' · ').slice(0, 500) || 'erro sem detalhe';
}

// ---------------------------------------------------------------- categorias e marcas (cache de 10 min)
const cache = new Map<string, { at: number; data: unknown }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const c = cache.get(key);
  if (c && Date.now() - c.at < 600_000) return c.data as T;
  const data = await fn();
  cache.set(key, { at: Date.now(), data });
  return data;
}

export interface AmCategory { id: number; name: string; path: string; leaf: boolean }
export async function amCategories(co: string): Promise<AmCategory[]> {
  return cached('cat:' + co, async () => {
    const r = await am(co, '/categories/fullPath');
    if (r.status !== 200 || !Array.isArray(r.body)) throw new AmError('Não consegui listar as categorias do AnyMarket: ' + amMessage(r.body));
    const out: AmCategory[] = [];
    const walk = (list: Record<string, unknown>[], trail: string[]) => {
      for (const c of list) {
        const name = String(c.name ?? '');
        const kids = (c.children as Record<string, unknown>[]) ?? [];
        const path = String(c.path ?? '') || [...trail, name].join(' > ');
        out.push({ id: Number(c.id), name, path, leaf: !kids.length });
        if (kids.length) walk(kids, [...trail, name]);
      }
    };
    walk(r.body as Record<string, unknown>[], []);
    return out.sort((a, b) => a.path.localeCompare(b.path, 'pt-BR'));
  });
}

export interface AmBrand { id: number; name: string }
export async function amBrands(co: string, q: string): Promise<AmBrand[]> {
  const r = await am(co, '/brands?limit=50' + (q ? '&name=' + encodeURIComponent(q) : ''));
  if (r.status !== 200) throw new AmError('Não consegui listar as marcas do AnyMarket: ' + amMessage(r.body));
  return (((r.body as { content?: Record<string, unknown>[] }).content) ?? []).map((b) => ({ id: Number(b.id), name: String(b.name ?? '') }));
}
export async function amCreateBrand(co: string, name: string): Promise<AmBrand> {
  const r = await am(co, '/brands', { method: 'POST', body: JSON.stringify({ name, reducedName: name.slice(0, 20) }) });
  if (r.status !== 200 && r.status !== 201) throw new AmError('O AnyMarket não criou a marca: ' + amMessage(r.body), 400);
  const b = r.body as Record<string, unknown>;
  return { id: Number(b.id), name: String(b.name ?? name) };
}

// ---------------------------------------------------------------- produto
export interface AmForm {
  categoryId: number; brandId: number;
  sku: string; ean: string; preco: number; precoDe: number | null; estoque: number; prazo: number;
  garantia: number; garantiaTexto: string; altura: number; largura: number; comprimento: number; peso: number;
  ncm: string; origem: number; modelo: string; anunciosAuto: boolean;
}
export interface ListingData {
  titulo: string; descricao: string;
  ficha: { nome: string; valor: string }[];
  fotos: string[];
  am: AmForm;
  /** A equipe marcou que revisou título e descrição (padrão do administrador). */
  revisado?: boolean;
}

/** Confere os campos obrigatórios do AnyMarket e devolve a lista do que falta. */
export function missing(d: ListingData): string[] {
  const f = d.am, out: string[] = [];
  if (!d.titulo?.trim()) out.push('título');
  if (!d.descricao?.trim()) out.push('descrição');
  if (!d.fotos?.length) out.push('pelo menos 1 foto');
  if (!d.revisado) out.push('marcar "Revisei título e descrição"');
  if ((d.titulo ?? '').trim().length > 60) out.push('título com até 60 caracteres');
  if (!f?.categoryId) out.push('categoria do AnyMarket');
  if (!f?.brandId) out.push('marca do AnyMarket');
  if (!f?.sku?.trim()) out.push('SKU');
  if (!(f?.preco > 0)) out.push('preço de venda');
  if (!(f?.estoque >= 0) || f?.estoque === null) out.push('estoque');
  if (!(f?.garantia >= 0) || f?.garantia === null) out.push('garantia (meses)');
  for (const [k, n] of [['altura', 'altura'], ['largura', 'largura'], ['comprimento', 'profundidade'], ['peso', 'peso']] as const) if (!(Number(f?.[k]) > 0)) out.push(n + ' da embalagem');
  if (f?.ean && !/^\d{8,13}$/.test(f.ean)) out.push('EAN válido (8 a 13 números; EAN-14 não cabe no AnyMarket)');
  if (f?.sku && !/^[A-Za-z0-9._-]+$/.test(f.sku.trim())) out.push('SKU só com letras, números, - _ e .');
  if (f && (f.origem < 0 || f.origem > 7)) out.push('origem fiscal de 0 a 7');
  if (f?.ncm && !/^\d{8}$/.test(f.ncm.replace(/\D/g, ''))) out.push('NCM com 8 números');
  return out;
}

const esc = (t: string) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
/** Texto do Studio → HTML simples (parágrafos, listas com "- " e quebras). */
export function toHtml(text: string): string {
  return text.trim().split(/\n{2,}/).map((block) => {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length && lines.every((l) => /^[-•*]\s+/.test(l))) return '<ul>' + lines.map((l) => '<li>' + esc(l.replace(/^[-•*]\s+/, '')) + '</li>').join('') + '</ul>';
    if (lines.length > 1 && lines.slice(1).every((l) => /^[-•*]\s+/.test(l))) return '<p><strong>' + esc(lines[0]) + '</strong></p><ul>' + lines.slice(1).map((l) => '<li>' + esc(l.replace(/^[-•*]\s+/, '')) + '</li>').join('') + '</ul>';
    return '<p>' + lines.map(esc).join('<br>') + '</p>';
  }).join('');
}

export function buildProduct(d: ListingData, externalId: string) {
  const f = d.am;
  const precoDe = f.precoDe && f.precoDe > f.preco ? f.precoDe : f.preco;
  return {
    title: d.titulo.trim().slice(0, 150),
    description: toHtml(d.descricao),
    externalIdProduct: externalId,
    category: { id: Number(f.categoryId) },
    brand: { id: Number(f.brandId) },
    ...(f.ncm ? { nbm: { id: f.ncm.replace(/\D/g, '') } } : {}),
    origin: { id: Number(f.origem ?? 0) },
    ...(f.modelo ? { model: f.modelo.slice(0, 60) } : {}),
    warrantyTime: Number(f.garantia),
    ...(f.garantiaTexto ? { warrantyText: f.garantiaTexto.slice(0, 200) } : {}),
    height: Number(f.altura), width: Number(f.largura), length: Number(f.comprimento), weight: Number(f.peso),
    priceFactor: 1,
    calculatedPrice: false,
    definitionPriceScope: 'SKU',
    hasVariations: false,
    type: 'SIMPLE',
    isProductActive: true,
    characteristics: d.ficha.filter((c) => c.nome && c.valor).slice(0, 60).map((c, i) => ({ index: i + 1, name: c.nome.slice(0, 100), value: c.valor.slice(0, 250) })),
    images: d.fotos.slice(0, 12).map((url, i) => ({ index: i + 1, main: i === 0, url })),
    skus: [{
      title: d.titulo.trim().slice(0, 150),
      partnerId: f.sku.trim(),
      ...(f.ean ? { ean: f.ean } : {}),
      amount: Number(f.estoque),
      additionalTime: Number(f.prazo ?? 0),
      price: precoDe,
      sellPrice: Number(f.preco),
    }],
    allowAutomaticSkuMarketplaceCreation: !!f.anunciosAuto,
  };
}

/** Produto que já existe no AnyMarket com este SKU (o filtro da API é "contém"; aqui conferimos igual). */
export async function amFindBySku(co: string, sku: string): Promise<{ id: string; title: string; skuId: string } | null> {
  const r = await am(co, '/products?limit=20&sku=' + encodeURIComponent(sku));
  if (r.status !== 200) throw new AmError('Não consegui procurar o SKU no AnyMarket: ' + amMessage(r.body));
  for (const p of ((r.body as { content?: Record<string, unknown>[] }).content ?? [])) {
    const s = ((p.skus as Record<string, unknown>[]) ?? []).find((x) => String(x.partnerId ?? '') === sku);
    if (s) return { id: String(p.id ?? ''), title: String(p.title ?? ''), skuId: String(s.id ?? '') };
  }
  return null;
}

/** Atualiza um produto existente: textos, ficha e medidas (PUT, sem mexer nas fotos) e o preço do SKU (PATCH). */
export async function amUpdate(co: string, productId: string, skuId: string, product: ReturnType<typeof buildProduct>): Promise<void> {
  const { images: _i, skus, ...rest } = product;
  const r = await am(co, '/products/' + encodeURIComponent(productId), { method: 'PUT', body: JSON.stringify({ ...rest, id: Number(productId) || productId }) });
  if (r.status !== 200 && r.status !== 204) throw new AmError('O AnyMarket não atualizou o produto: ' + amMessage(r.body), r.status === 422 || r.status === 400 ? 400 : 502);
  if (skuId) {
    const p = await am(co, '/products/' + encodeURIComponent(productId) + '/skus/' + encodeURIComponent(skuId), { method: 'PATCH', headers: { 'content-type': 'application/merge-patch+json' }, body: JSON.stringify({ price: skus[0].price, sellPrice: skus[0].sellPrice }) });
    if (p.status !== 200 && p.status !== 204) throw new AmError('Textos atualizados, mas o AnyMarket não aceitou o preço: ' + amMessage(p.body), 502);
  }
}

export async function amSend(co: string, product: ReturnType<typeof buildProduct>): Promise<{ id: string; skuId: string }> {
  const r = await am(co, '/products', { method: 'POST', body: JSON.stringify(product) });
  if (r.status === 200 || r.status === 201) {
    const b = r.body as { id?: unknown; skus?: { id?: unknown }[] };
    return { id: String(b.id ?? ''), skuId: String(b.skus?.[0]?.id ?? '') };
  }
  throw new AmError('O AnyMarket recusou o produto: ' + amMessage(r.body), r.status === 422 || r.status === 400 ? 400 : 502);
}
