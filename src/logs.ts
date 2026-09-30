/** Registro de ações (acessos, gerações, downloads, histórico, administração). */
import type { Request } from 'express';
import { db } from './db.js';

export const ACTIONS = [
  'login', 'login_falhou', 'logout', 'senha_alterada',
  'gerar_post', 'gerar_carrossel', 'erro_ia',
  'salvar_historico', 'atualizar_historico', 'abrir_historico', 'excluir_historico',
  'baixar_post', 'baixar_carrossel', 'baixar_slide', 'copiar_legenda',
  'usuario_criado', 'usuario_alterado',
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
