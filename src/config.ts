/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Configuração lida das variáveis de ambiente (ver .env.example). */
import path from 'node:path';

function env(name: string, fallback = ''): string {
  return (process.env[name] ?? fallback).trim();
}

export const config = {
  port: Number(env('PORT', '3000')),
  dataDir: path.resolve(env('DATA_DIR', './data')),
  /** true quando o site roda atrás de HTTPS (produção). */
  cookieSecure: env('COOKIE_SECURE', 'false') === 'true',
  sessionDays: Number(env('SESSION_DAYS', '7')),
  anthropicKey: env('ANTHROPIC_API_KEY'),
  anthropicModel: env('ANTHROPIC_MODEL', 'claude-sonnet-5-5'),
  adminName: env('ADMIN_NAME', 'Administrador'),
  adminEmail: env('ADMIN_EMAIL').toLowerCase(),
  adminPassword: env('ADMIN_PASSWORD'),
  /** Quantas gerações com IA cada usuário pode fazer por dia (0 = sem limite). */
  dailyAiLimit: Number(env('DAILY_AI_LIMIT', '0')),
  trustProxy: env('TRUST_PROXY', 'true') === 'true',
  /** Endereço público do site (para o Instagram buscar as imagens e voltar do login). */
  publicUrl: (env('PUBLIC_URL') || (env('DOMAIN') ? 'https://' + env('DOMAIN') : '')).replace(/\/+$/, ''),
  /** App da Meta com o produto "Instagram API with Instagram Login". */
  igAppId: env('IG_APP_ID'),
  igAppSecret: env('IG_APP_SECRET'),
  igApiVersion: env('IG_API_VERSION', 'v25.0'),
  // Endereços da API (só mudam em testes).
  igGraphUrl: env('IG_GRAPH_URL', 'https://graph.instagram.com'),
  igAuthUrl: env('IG_AUTH_URL', 'https://www.instagram.com/oauth/authorize'),
  igTokenUrl: env('IG_TOKEN_URL', 'https://api.instagram.com/oauth/access_token'),
  /** App do Mercado Livre (developers.mercadolivre.com.br) para o Studio ML. */
  mlClientId: env('ML_CLIENT_ID'),
  mlClientSecret: env('ML_CLIENT_SECRET'),
  mlApiUrl: env('ML_API_URL', 'https://api.mercadolibre.com'),
  mlAuthUrl: env('ML_AUTH_URL', 'https://auth.mercadolivre.com.br/authorization'),
  /** Scraping de reserva (sistema próprio). POST {q} → {resultados} e POST {url} → {produto}. */
  scraperUrl: env('SCRAPER_URL').replace(/\/+$/, ''),
  scraperToken: env('SCRAPER_TOKEN'),
};

export const uploadsDir = path.join(config.dataDir, 'uploads');
/** Imagens JPEG temporárias que o Instagram baixa na hora de publicar (apagadas depois). */
export const igMediaDir = path.join(config.dataDir, 'ig-media');
