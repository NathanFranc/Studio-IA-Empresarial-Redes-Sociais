/** Cria o primeiro administrador a partir do .env quando o banco ainda não tem usuários. */
import { hashPassword, passwordProblem } from './auth.js';
import { config } from './config.js';
import { db } from './db.js';

export function seedAdmin(): void {
  const { n } = db.prepare('SELECT COUNT(*) AS n FROM users').get() as { n: number };
  if (n > 0) return;
  if (!config.adminEmail || !config.adminPassword) {
    console.warn('[estudio] Nenhum usuário cadastrado. Defina ADMIN_EMAIL e ADMIN_PASSWORD no .env e reinicie, ou rode "npm run create-user".');
    return;
  }
  const problem = passwordProblem(config.adminPassword);
  if (problem) {
    console.error('[estudio] ADMIN_PASSWORD inválida: ' + problem);
    return;
  }
  db.prepare("INSERT INTO users (name, email, password_hash, role, must_change) VALUES (?, ?, ?, 'admin', 1)")
    .run(config.adminName, config.adminEmail, hashPassword(config.adminPassword));
  console.log(`[estudio] Administrador criado: ${config.adminEmail} (troque a senha no primeiro acesso).`);
}
