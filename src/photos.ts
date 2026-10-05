/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * Padrão de fotos dos anúncios: 1200×1200, fundo branco, produto centralizado e inteiro.
 * Usado no ZIP do Studio ML (/api/ml/img?q=1200) e no envio ao AnyMarket, que recebe
 * as fotos já padronizadas por um endereço público (/am-media).
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import sharp from 'sharp';
import { config } from './config.js';
import { allowedImage } from './ml.js';

export const PHOTO_SIZE = 1200;
const INNER = 1140; // margem branca de 30px em volta do produto
export const amMediaDir = path.join(config.dataDir, 'am-media');
fs.mkdirSync(amMediaDir, { recursive: true });

/** Recorta a borda branca, encaixa o produto inteiro em 1140px e centraliza num quadrado branco de 1200×1200. */
export async function toSquare(input: Buffer): Promise<{ jpg: Buffer; srcW: number; srcH: number }> {
  const meta = await sharp(input).metadata();
  let base = sharp(input).rotate().flatten({ background: '#ffffff' });
  try {
    const trimmed = await base.clone().trim({ background: '#ffffff', threshold: 12 }).toBuffer({ resolveWithObject: true });
    if (trimmed.info.width > 20 && trimmed.info.height > 20) base = sharp(trimmed.data);
  } catch { /* imagem sem borda para recortar */ }
  const product = await base.resize(INNER, INNER, { fit: 'inside', kernel: 'lanczos3' }).toBuffer();
  const jpg = await sharp({ create: { width: PHOTO_SIZE, height: PHOTO_SIZE, channels: 3, background: '#ffffff' } })
    .composite([{ input: product, gravity: 'center' }])
    .jpeg({ quality: 90, mozjpeg: true })
    .toBuffer();
  return { jpg, srcW: meta.width ?? 0, srcH: meta.height ?? 0 };
}

export async function fetchImage(url: string): Promise<Buffer> {
  if (!allowedImage(url)) throw new Error('endereço de foto não permitido');
  const r = await fetch(url, { signal: AbortSignal.timeout(20_000) });
  const type = r.headers.get('content-type') ?? '';
  if (!r.ok || !type.startsWith('image/')) throw new Error('foto indisponível');
  return Buffer.from(await r.arrayBuffer());
}

/** Padroniza a foto e salva com nome fixo (hash do endereço); devolve o endereço público. */
export async function publishSquare(url: string): Promise<string> {
  const name = crypto.createHash('sha1').update(url + '|' + PHOTO_SIZE).digest('hex').slice(0, 24) + '.jpg';
  const file = path.join(amMediaDir, name);
  if (!fs.existsSync(file)) {
    const { jpg } = await toSquare(await fetchImage(url));
    fs.writeFileSync(file, jpg);
  }
  return `${config.publicUrl}/am-media/${name}`;
}

/** Apaga fotos padronizadas com mais de 90 dias (o AnyMarket baixa a foto quando recebe o produto). */
export function cleanAmMedia(): void {
  const limit = Date.now() - 90 * 86_400_000;
  for (const f of fs.readdirSync(amMediaDir)) {
    const p = path.join(amMediaDir, f);
    try { if (fs.statSync(p).mtimeMs < limit) fs.unlinkSync(p); } catch { /* ignora */ }
  }
}
