# Estúdio Megadino — Documento de Passagem (Handoff)

Autor: Nathan Vinicius Franca de Lima. Todos os direitos reservados (licença proprietária, ver `LICENSE`).
Repositório (privado): https://github.com/NathanFranc/Studio-IA-Empresarial-Redes-Sociais (branch `main`)

Este documento reúne tudo o que é preciso para continuar o projeto em outra conta/sessão de desenvolvimento: contexto, decisões, arquitetura, como rodar, como fazer deploy e o que falta.

---

## 1. Contexto e objetivo

- A nova empresa do Nathan é dona da loja **Megadino** (Instagram `@loja_megadino`).
- **Dor:** a equipe de e-commerce faz vários posts por dia e perde muito tempo montando a arte.
- **Solução:** ferramenta interna em que a pessoa envia a **foto do produto + descrição/ficha técnica** e recebe a **arte do feed (1080×1350)** pronta, com detalhes técnicos para o cliente conferir se é o produto certo, e a **legenda**.
- Nasceu como teste para comparar qual IA cria melhor os posts. Evoluiu para sistema com login e logs.

### Dois modos
1. **Post rápido (vitrine):** 10 modelos de arte + recomendação automática da IA conforme o produto.
2. **Carrossel (conteúdo):** vários slides com galeria de fotos (mínimo de fotos recomendado para encaixar melhor e mostrar outros ângulos).

### Requisitos importantes levantados
- Fotos geralmente vêm da internet/anúncios com **fundo branco** → o app **remove o fundo** e se adapta a fundos claros e escuros (sem halo branco).
- **Manter qualidade** da foto (receber na melhor resolução possível).
- Guardar e oferecer os **dois logos da Megadino** (preto e branco, PNG, extraídos do post do cupom Shopee).
- Modelos seguem os padrões reais do Instagram (tamanho de letra, espaçamento, cores, degradês, ícones, texturas, ângulo e tamanho dos produtos, disposição de kits).
- **Sistema com login e logs**, hospedado na própria VPS (Hostinger).
- **Autoria protegida** (assinatura no código, invisível na interface).

---

## 2. Modelos de post (vitrine)

Definidos em `src/catalog.ts` (`MODELS`) e replicados em `public/index.html`. **Manter os dois sincronizados.**

| id | Nome | Quando usar (referência do Instagram) |
|---|---|---|
| `claro` | Ficha clara | Fundo branco, marca grande, produto em destaque (Wahl Travel Shaver, Style Pro) |
| `ficha` | Ficha colorida | Fundo na cor do produto, 3 benefícios, público ideal (Wahl KM2+) |
| `faixa` | Destaque de marca | Marca forte: manchete, benefícios, dados técnicos, faixa de vantagens (KitchenAid) |
| `tamanhos` | Linha de tamanhos | Várias capacidades/voltagens/cores (Panelux) |
| `kit` | Kit / seleção | Kits sobre pedestal com ícones por item (Dagua Natural) |
| `premium` | Premium escuro | Fundo escuro, luz quente, dourado, faixa de nomes (Wahl Barbearia) |
| `ambiente` | Produto no ambiente | Manchete no topo, modo de uso, faixa azul no rodapé (Latina SR555) |
| `dicas` | Capa de carrossel | Número grande, frase com destaque, manuscrito ("3 tarefas simples") |
| `data` | Data comemorativa | Fundo escuro, data gigante, selo redondo, barra de confiança (Dia dos Pais) |
| `cupom` | Cupom / promoção | Laranja vibrante, cupom em cartão tracejado (cupom Shopee) |

### Carrossel
Tipos de slide: `capa`, `topico`, `problema`, `passos`, `specs`, `cta`. Cada slide pode ser claro ou escuro. Uma função `slidePhoto` escolhe a foto de cada slide. O download sai em ZIP (JSZip) ou slide a slide.

---

## 3. Renderização (front-end)

Tudo no `public/index.html` (arquivo único, sem build), usando **Canvas 2D**.

- **Fontes:** Anton, Outfit, Kaushan Script, Roboto Slab.
- **Helpers de desenho:** `font`, `fit`, `wrap`, `icon` (conjunto de ícones SVG via Path2D), `pill`, `ambient`, `blob`, `floor`, `stamp`, `band`, `trustBar`, `headStack`, `seal`.
- **Remoção de fundo (`cutBackground`):** estima a cor da borda, flood fill com tolerância, remoção de sombra, remoção opcional de buracos internos, matting de borda sensível à cor (raio 5 px) com "un-mixing", opção **"Borda limpa"** (choke), recorte aos limites. Modos: `auto`, `card`, `orig`.
- **Qualidade:** `imageSmoothingQuality='high'` (patch em `getContext`), corte em 2400 px, upscale em etapas + unsharp mask para fotos pequenas, aviso de resolução.
- **Limite conhecido:** a tampa de vidro transparente do produto fica levemente clara sobre fundo escuro.
- Logos em `public/assets/megadino-logo-preta.png` e `megadino-logo-branca.png`.

---

## 4. Back-end e arquitetura

| Parte | Tecnologia |
|---|---|
| Servidor | Node 22, Express 5, TypeScript (NodeNext) |
| Banco | SQLite via better-sqlite3 (WAL), arquivo `data/estudio.db` |
| Fotos do histórico | `data/uploads/<id>/` |
| Senhas | bcryptjs |
| Segurança HTTP | helmet com CSP, cookie-parser |
| IA | `@anthropic-ai/sdk` 0.130, modelo padrão `claude-sonnet-5-5` |
| HTTPS | Caddy (certificado automático) |
| Deploy | Docker multi-stage + docker-compose |

### Estrutura
```
src/
  server.ts       app Express, CSP, páginas (/login, /, /admin, /conta), estáticos /assets, limite JSON 60mb
  config.ts       variáveis de ambiente
  db.ts           schema SQLite: users, sessions, logs, posts; purgeExpiredSessions
  auth.ts         hash, regras de senha, sessões, requireUser/requireAdmin, CSRF, throttle
  logs.ts         ACTIONS e logAction(req, action, {userId, postId, detail})
  ai.ts           askJson(prompt, images), parseJson tolerante, AiError com mensagens PT-BR
  prompts.ts      postPrompt, carouselPrompt
  catalog.ts      ICON_KEYS, COLOR_KEYS, MODELS (manter igual ao front)
  seed.ts         cria o 1º admin a partir de ADMIN_* se o banco estiver vazio
  cli.ts          comando create-user
  routes/         auth, ai, posts (histórico), events (downloads/cópias), admin
public/
  index.html      o Estúdio (modelos, recorte, carrossel, histórico)
  login.html, conta.html, admin.html
  assets/         base.css, common.js, logos PNG
Dockerfile, docker-compose.yml, Caddyfile, .env.example, LICENSE, README.md
```

### Autenticação e segurança
- Sessão: token aleatório em cookie `httpOnly` `SameSite=Lax`; no banco fica o **sha256** do token. Expira em `SESSION_DAYS`.
- **CSRF:** toda requisição não-GET em `/api` exige o cabeçalho `X-Requested-With: estudio`.
- **Throttle de login:** 5 falhas em 15 min por IP+e-mail bloqueia.
- Perfis: `admin` e `editor`. `must_change` força troca de senha no primeiro acesso.
- Senha: 8+ caracteres, com letras e números.
- Desativar usuário ou redefinir senha encerra as sessões abertas.
- Detecção de API usa `req.originalUrl.startsWith('/api/')` (devolve 401/403 JSON, não redirect).

### Logs (17 ações)
`login`, `login_falhou`, `logout`, `senha_alterada`, `gerar_post`, `gerar_carrossel`, `erro_ia`, `salvar_historico`, `atualizar_historico`, `abrir_historico`, `excluir_historico`, `baixar_post`, `baixar_carrossel`, `baixar_slide`, `copiar_legenda`, `usuario_criado`, `usuario_alterado`.
Horários em UTC no banco; painel mostra America/Sao_Paulo; exportação CSV (BOM, separador `;`) sai em UTC.

### Histórico reutilizável
Cada arte gerada é salva automaticamente (textos, ajustes, legenda, fotos). Tela com busca, filtro "Minhas / De toda a equipe", abrir, "Salvar" / "Salvar como nova" e excluir (confirmação em 2 passos). Editor altera só o que é seu; admin altera tudo.

### Painel admin
Abas **Resumo / Usuários / Logs**: resumo do dia e semana, cadastro e desativação de usuários, redefinição de senha, logs com filtros e paginação, exportação CSV.

### Custo da IA
`DAILY_AI_LIMIT` limita gerações por usuário por dia (0 = sem limite).

---

## 4.1 Novidades (30/09/2026)
- Visual novo: login em card dividido (degradê Megadino + logo) e interface interna preta estilo estúdio.
- Prévia no feed: celular interativo (curtir, legenda com "mais", carrossel arrastável, grade do perfil 3:4, app claro/escuro).
- Administração › **Usuários e acessos**: criar e-mail e senha (com gerador), cartão para copiar o acesso, editar nome/e-mail, nova senha.
- Administração › **Instagram**: conectar a conta via OAuth (API do Instagram com login do Instagram) e publicar posts e carrosséis direto do Estúdio (`src/instagram.ts`, `src/routes/instagram.ts`). Token de 60 dias criptografado e renovado sozinho; imagens temporárias públicas em `/ig-media/`. Passo a passo da Meta no README.

## 5. Variáveis de ambiente (`.env`)

```
PORT=3000
DOMAIN=estudio.suaempresa.com.br     # usado pelo Caddy
ANTHROPIC_API_KEY=                   # console.anthropic.com > API Keys
ANTHROPIC_MODEL=claude-sonnet-5-5
ADMIN_NAME=Nathan
ADMIN_EMAIL=
ADMIN_PASSWORD=                      # 8+ chars, letras e números; trocada no 1º acesso
COOKIE_SECURE=true                   # false só em http://localhost
SESSION_DAYS=7
DAILY_AI_LIMIT=0
PUBLIC_URL=                          # opcional; padrão https://DOMAIN
IG_APP_ID=                           # app da Meta (Instagram API com login do Instagram)
IG_APP_SECRET=
```
Existe também `TRUST_PROXY` em `src/config.ts`. **Nunca commitar `.env` nem `data/`.**

---

## 6. Como rodar

### Desenvolvimento local
```bash
npm install
cp .env.example .env     # COOKIE_SECURE=false em localhost
npm run dev              # http://localhost:3000
```
Scripts: `dev`, `build`, `start`, `create-user`, `typecheck`.

### Deploy na VPS (Hostinger)
Pré-requisitos: subdomínio com registro **A** para o IP da VPS, chave da Anthropic, portas 80 e 443 livres.
```bash
curl -fsSL https://get.docker.com | sh          # 1ª vez
git clone https://github.com/NathanFranc/Studio-IA-Empresarial-Redes-Sociais.git estudio
cd estudio
cp .env.example .env && nano .env
docker compose up -d --build
```
Como o repositório é privado, o `git clone` pede usuário do GitHub e **token de acesso pessoal** no lugar da senha.

### Operação
```bash
docker compose exec app node dist/cli.js "Maria Silva" maria@empresa.com SenhaProvisoria1 editor   # criar usuário
git pull && docker compose up -d --build                                                          # atualizar
docker compose logs -f app                                                                        # logs
tar czf backup-estudio-$(date +%F).tar.gz data/                                                   # backup
```
Backup = copiar a pasta `data/`. Para restaurar: `docker compose down`, recolocar `data/`, subir de novo.

---

## 7. Autoria e licença

- `LICENSE` proprietária em nome de Nathan Vinicius Franca de Lima, "Todos os direitos reservados" (Leis 9.609/98 e 9.610/98).
- Cabeçalho de copyright em todos os `.ts`, em `common.js` e `base.css`; nas páginas HTML, comentário oculto + `<meta name="author">` e `<meta name="copyright">`. **Nada aparece na interface.**
- Recomendações (não feitas): registro do programa no **INPI** e acordo por escrito com a empresa sobre a titularidade do software (por lei, software desenvolvido em vínculo de trabalho pode pertencer ao empregador, art. 4º da Lei 9.609/98).

---

## 8. Estado atual

**Feito e testado (com IA simulada):** login, troca obrigatória de senha, bloqueio após 5 erros, geração salva no histórico, download PNG e ZIP, abrir do histórico com o modelo correto, admin criando usuário, 11 registros de log, editor bloqueado no admin (403), requisição sem cabeçalho CSRF retorna 400.

**Ainda não feito:**
1. **Deploy na VPS** (precisa: subdomínio + DNS, chave Anthropic, credenciais do admin no `.env`, confirmar se 80/443 estão livres).
2. Teste com **chave real** da Anthropic.
3. `docker compose build` real (no ambiente de desenvolvimento não havia Docker; o build foi simulado passo a passo).
4. Confirmar que o repositório está **privado** no GitHub.

**Não implementado / ideias:**
- Geração de novos ângulos da foto por IA (o app não gera imagens; inventar partes do produto é arriscado).
- Logos reais de marcas (Wahl, KitchenAid) — hoje aparecem como texto estilizado.
- Nota: o artefato publicado no claude.ai (https://claude.ai/artifact/TYXsM1tHdYKdsNhDT9wpkK) é a **versão antiga, só front-end**; a versão oficial é a deste repositório.

---

## 9. Histórico de problemas resolvidos (para não repetir)

- Retângulo claro atrás do produto no modelo escuro → gradiente elíptico escalado no lugar do recorte.
- Halo branco em fundos escuros → matting por cor de primeiro/segundo plano + "Borda limpa".
- Perda de qualidade → suavização alta, corte 2400 px, upscale em etapas.
- Manchete do carrossel vazia em `tplDicas` → tratamento de `m.topo`.
- Respostas de API com 302 em vez de 401/403 → uso de `originalUrl`.
- Elementos `[hidden]` visíveis → `[hidden]{display:none!important}` em `base.css`.
- Painéis do admin estreitos → `width:100%; max-width:none`.
- Testes com Playwright bloqueados pela CSP → `bypass_csp=True` no contexto de teste.

---

## 10. Perfil do usuário e forma de trabalho

- Nathan é desenvolvedor de BI/IA; fala português (Brasil); prefere respostas diretas.
- A VPS é da Hostinger. Foi combinado que o Claude pode operar o terminal web da Hostinger pelo Chrome, mas **segredos, DNS e logins ficam por conta do Nathan**.

## 11. Prompt sugerido para iniciar na outra conta

> Leia o `HANDOFF.md` e o `README.md` deste repositório. Este é o Estúdio Megadino (login, logs, histórico, 10 modelos de post e carrossel). Próximo objetivo: fazer o deploy na minha VPS Hostinger com Docker Compose e testar com a chave real da Anthropic. Não escreva segredos no repositório; eu preencho o `.env`.
