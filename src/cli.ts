/**
 * Cria um usuário pela linha de comando.
 * Uso: npm run create-user -- "Nome" email@empresa.com SenhaForte123 [admin|editor]
 */
import { hashPassword, passwordProblem } from './auth.js';
import { db } from './db.js';

const [name, emailRaw, password, roleRaw] = process.argv.slice(2);
const email = (emailRaw ?? '').toLowerCase();
const role = roleRaw === 'admin' ? 'admin' : 'editor';
if (!name || !email || !password) {
  console.error('Uso: npm run create-user -- "Nome" email@empresa.com SenhaForte123 [admin|editor]');
  process.exit(1);
}
const problem = passwordProblem(password);
if (problem) {
  console.error(problem);
  process.exit(1);
}
if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
  console.error('Já existe um usuário com esse e-mail.');
  process.exit(1);
}
db.prepare('INSERT INTO users (name, email, password_hash, role, must_change) VALUES (?, ?, ?, ?, 1)')
  .run(name, email, hashPassword(password), role);
console.log(`Usuário criado: ${email} (${role}). Ele vai trocar a senha no primeiro acesso.`);
