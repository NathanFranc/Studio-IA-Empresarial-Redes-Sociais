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
};

export const uploadsDir = path.join(config.dataDir, 'uploads');
