# Estúdio Megadino

Sistema interno para a equipe da Megadino criar as artes do Instagram. A pessoa envia a foto do produto e a ficha técnica, e o sistema devolve a arte do feed (1080×1350) ou um carrossel completo, com a legenda pronta.

- **Login com usuário e senha**, com perfis **Administrador** e **Editor**
- **Logs** de acessos (entradas, saídas e tentativas erradas), gerações com IA, downloads, cópias de legenda e alterações de usuários
- **Histórico reutilizável**: cada arte gerada fica salva com textos, ajustes, legenda e fotos, pronta para abrir e reusar
- **Painel de administração**: resumo do dia e da semana, gestão da equipe e consulta de logs com filtros e exportação CSV
- **Várias empresas**: Megadino (1080×1350) e IDM Shop (1080×1080), cada uma com logos, cores, modelos, histórico, legenda e conta do Instagram próprios. A troca fica no topo do Estúdio.
- **Publicar direto no Instagram**: posts e carrosséis saem do Estúdio para o perfil da loja, com confirmação antes
- **IA pela chave da empresa**: os textos são escritos no servidor, então a chave nunca aparece no navegador

## Como funciona

| Parte | Tecnologia |
|---|---|
| Servidor | Node.js 22 + Express + TypeScript |
| Banco | SQLite (arquivo `data/estudio.db`) |
| Fotos do histórico | Pasta `data/uploads/` |
| IA | API da Anthropic (Claude) |
| HTTPS | Caddy, com certificado automático |
| Deploy | Docker Compose |

Todos os dados ficam na pasta `data/`. **Para fazer backup, basta copiar essa pasta.**

---

## Colocar no ar (VPS da Hostinger)

### 1. Antes de começar
- Um **domínio** ou subdomínio (ex.: `estudio.suaempresa.com.br`) com um registro **A** apontando para o IP do VPS.
- Uma **chave da API da Anthropic**, criada em [console.anthropic.com](https://console.anthropic.com) > API Keys.
- As portas **80** e **443** liberadas no firewall do VPS.

### 2. Instalar o Docker no VPS (só na primeira vez)
```bash
curl -fsSL https://get.docker.com | sh
```

### 3. Enviar o projeto e configurar
```bash
git clone https://github.com/SEU_USUARIO/estudio-megadino.git
cd estudio-megadino
cp .env.example .env
nano .env
```
No `.env`, preencha pelo menos:
- `DOMAIN`: o domínio do passo 1
- `ANTHROPIC_API_KEY`: a chave da API
- `ADMIN_NAME`, `ADMIN_EMAIL` e `ADMIN_PASSWORD`: o primeiro administrador. A senha precisa ter 8 caracteres ou mais, com letras e números. Ela será trocada no primeiro acesso.

### 4. Subir
```bash
docker compose up -d --build
```
Depois de um ou dois minutos, abra `https://SEU_DOMINIO`. O Caddy emite o certificado HTTPS sozinho.

### 5. Primeiro acesso
1. Entre com o e-mail e a senha do `.env`.
2. O sistema pede a troca da senha.
3. Em **Administração > Usuários**, cadastre a equipe. Cada pessoa troca a senha provisória no primeiro acesso.

---

## Uso no dia a dia

### Criar usuário pelo terminal (alternativa ao painel)
```bash
docker compose exec app node dist/cli.js "Maria Silva" maria@empresa.com SenhaProvisoria1 editor
```

### Atualizar para uma nova versão
```bash
git pull
docker compose up -d --build
```

### Ver os logs do servidor
```bash
docker compose logs -f app
```

### Backup
```bash
tar czf backup-estudio-$(date +%F).tar.gz data/
```
Para restaurar, pare o sistema (`docker compose down`), coloque a pasta `data/` de volta e suba de novo.

---

## Publicar no Instagram (opcional)

O Estúdio publica posts e carrosséis direto no perfil da loja usando a API oficial do Instagram (login do Instagram). A conta precisa ser **profissional** (Empresa ou Criador de conteúdo).

### Configurar uma vez
1. Em [developers.facebook.com](https://developers.facebook.com), crie um app do tipo **Empresa** e adicione o produto **Instagram** › **API com login do Instagram**.
2. Em **Configurar login comercial do Instagram**, cadastre o endereço de redirecionamento: `https://SEU_DOMINIO/instagram/retorno` (o painel mostra o endereço exato em Administração › Instagram).
3. Em **Funções do app** › **Testadores do Instagram**, adicione a conta da loja e aceite o convite no Instagram (Configurações › Apps e sites › Convites de teste). Com o app em modo de desenvolvimento, só contas com função no app podem ser conectadas, o que basta para a própria loja.
4. No `.env`, preencha `IG_APP_ID` e `IG_APP_SECRET` (os do **app do Instagram**, na tela da API com login do Instagram) e rode `docker compose up -d`.
5. No Estúdio, vá em **Administração › Instagram › Conectar Instagram** e autorize.

### Como funciona
- O acesso vale 60 dias e é renovado sozinho. Ele fica no banco criptografado com uma chave derivada do `IG_APP_SECRET`.
- Por padrão só administradores publicam. Em **Administração › Instagram** dá para liberar os editores.
- Ao publicar, o servidor salva as imagens em JPEG numa pasta temporária pública (`/ig-media/`, com nomes aleatórios), o Instagram baixa e os arquivos são apagados em seguida. Por isso o site precisa estar acessível pela internet.
- Limites do Instagram: até 10 imagens por carrossel, 2.200 caracteres e 30 hashtags na legenda, e até 100 publicações pela API a cada 24 horas.
- Cada publicação fica nos logs (**Publicou no Instagram**), no histórico (selo **No Instagram**) e na lista da aba Instagram.

## Perfis

| | Editor | Administrador |
|---|---|---|
| Gerar posts e carrosséis | ✓ | ✓ |
| Ver o próprio histórico e o da equipe | ✓ | ✓ |
| Alterar ou excluir artes | só as próprias | todas |
| Cadastrar, desativar e redefinir senha de usuários | | ✓ |
| Ver resumo e logs, exportar CSV | | ✓ |

## O que é registrado nos logs

| Ação | Quando |
|---|---|
| Entrou / Saiu / Login falhou | acessos (com IP e navegador) |
| Trocou a senha | pelo próprio usuário |
| Gerou post / Gerou carrossel | a cada uso da IA, com produto, modelo, fotos e tempo |
| Erro na IA | quando a geração falha, com o motivo |
| Salvou / Atualizou / Abriu / Excluiu do histórico | movimentação do histórico |
| Baixou post / carrossel / slide | cada download |
| Copiou legenda | cada cópia |
| Conectou / Desconectou o Instagram | ações do administrador |
| Publicou no Instagram / Erro no Instagram | cada publicação direta, com link ou motivo do erro |
| Criou / Alterou usuário | ações do administrador |

Os horários ficam gravados em UTC e aparecem no painel no horário de Brasília. A exportação CSV sai em UTC.

## Segurança
- Senhas guardadas com bcrypt. Nenhuma senha aparece nos logs.
- Sessão em cookie `httpOnly` e `SameSite=Lax`, que expira em `SESSION_DAYS` dias.
- Proteção contra CSRF: toda alteração exige o cabeçalho `X-Requested-With: estudio`.
- Depois de 5 senhas erradas em 15 minutos, o login fica bloqueado para aquele e-mail e IP.
- Desativar um usuário ou redefinir a senha dele encerra as sessões abertas na hora.
- Com `DAILY_AI_LIMIT`, dá para limitar as gerações por pessoa por dia e controlar o custo da API.

## Custos da IA
Cada geração faz uma chamada à API da Anthropic, cobrada na conta da empresa. Acompanhe o consumo em [console.anthropic.com](https://console.anthropic.com) e, se precisar, use `DAILY_AI_LIMIT`. O modelo usado fica em `ANTHROPIC_MODEL`.

## Desenvolvimento local
```bash
npm install
cp .env.example .env   # em localhost, use COOKIE_SECURE=false
npm run dev            # http://localhost:3000
```

## Estrutura
```
src/
  server.ts        rotas das páginas, API e segurança
  auth.ts          senhas, sessões e permissões
  db.ts            tabelas do SQLite
  logs.ts          gravação dos logs
  ai.ts            chamada à API da Anthropic
  prompts.ts       instruções enviadas à IA (post e carrossel)
  catalog.ts       modelos, ícones e cores da Megadino (manter igual ao public/index.html)
  companies.ts     empresas: nome, @, jeito da legenda, cores e modelos de cada uma
  instagram.ts     conexão (OAuth), token criptografado e publicação no Instagram
  routes/          auth, ai, posts (histórico), events (downloads), admin, instagram
public/
  index.html       o Estúdio (modelos, recorte de fundo, carrossel, histórico)
  login.html, conta.html, admin.html
  assets/          logos, estilos e funções comuns
```

## Autoria e licença
Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
Software proprietário: uso, cópia, modificação e distribuição só com autorização por escrito do autor. Veja [LICENSE](LICENSE).
