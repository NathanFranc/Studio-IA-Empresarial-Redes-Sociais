/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Registro de ações (acessos, gerações, downloads, histórico, administração). */
import type { Request } from 'express';
import { db } from './db.js';

export const ACTIONS = [
  'login', 'login_falhou', 'logout', 'senha_alterada',
  'gerar_post', 'gerar_carrossel', 'erro_ia',
  'salvar_historico', 'atualizar_historico', 'abrir_historico', 'excluir_historico',
  'baixar_post', 'baixar_carrossel', 'baixar_slide', 'copiar_legenda',
  'usuario_criado', 'usuario_alterado',
  'instagram_conectado', 'instagram_desconectado', 'publicar_instagram', 'erro_instagram',
  'ml_conectado', 'ml_desconectado', 'ml_buscar', 'ml_gerar', 'ml_baixar_fotos', 'erro_ml',
] as const;
export type Action = (typeof ACTIONS)[number];

const insert = db.prepare(
  'INSERT INTO logs (user_id, action, post_id, detail, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)',
);

/** Grava uma linha de log. `detail` vira JSON. */
export function logAction(
  req: Request,
  action: Action,
  opts: { userId?: number | null; postId?: number | null; detail?: unknown } = {},
): void {
  const userId = opts.userId ?? req.user?.id ?? null;
  insert.run(
    userId,
    action,
    opts.postId ?? null,
    opts.detail === undefined ? null : JSON.stringify(opts.detail).slice(0, 4000),
    req.ip ?? null,
    String(req.headers['user-agent'] ?? '').slice(0, 300),
  );
}
