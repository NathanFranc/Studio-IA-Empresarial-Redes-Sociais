/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/** Textos enviados para a IA. Montados no servidor para que ninguém use a chave com outro fim. */
import { ICON_KEYS } from './catalog.js';
import type { Company } from './companies.js';

export function postPrompt(co: Company, desc: string, nImg: number, photoWhite: boolean | null): string {
  const withImage = nImg > 0;
  const photoNote = photoWhite === null
    ? 'Ainda não há foto.'
    : photoWhite
      ? 'A foto tem fundo branco (produto isolado).'
      : 'A foto NÃO tem fundo branco (provavelmente produto em uso ou num ambiente).';
  return `Você cria posts de feed do Instagram para a ${co.about}.
${withImage ? 'A imagem anexada é a foto do produto. ' : ''}${photoNote}
Leia a descrição/ficha técnica abaixo e devolva SOMENTE um JSON com os textos da arte, o modelo indicado e a legenda.

REGRAS
- Português do Brasil. Use APENAS fatos da descrição${withImage ? ' e da foto' : ''}. Nunca invente números, potência, capacidade, material, preço ou marca. Se a marca não aparecer, "marca": "".
- "titulo": nome curto do produto em no máximo 2 palavras (ex.: "PIPOQUEIRA", "PANELA DE PRESSÃO", "SECADOR VANQUISH").
- "subtitulo": complemento com até 38 caracteres (ex.: "antiaderente com manivela").
- "tipo": tipo do produto em caixa alta (ex.: "LIQUIDIFICADOR", "MÁQUINA DE CORTE").
- "linha": modelo/versão em até 2 partes separadas por " · " (ex.: "PURE POWER 2L · EMPIRE RED"), só com dados da descrição; senão "".
- "manchete": {"topo": 1 palavra curta em caixa alta (ex.: "MAIS"), "destaque": até 26 caracteres em caixa alta (ex.: "POTÊNCIA, MAIS SABOR,"), "script": fecho manuscrito em minúsculas até 18 caracteres (ex.: "todos os dias!")}.
- "badge": frase de efeito até 34 caracteres para a faixa com estrela (ex.: "POTÊNCIA QUE TRANSFORMA SUA ROTINA").
- "carimbo": {"topo","base","icone"} para o selo redondo, cada texto até 18 caracteres (ex.: "DESEMPENHO POTENTE", "RESULTADOS INCRÍVEIS").
- "publico": para quem é, começando com "IDEAL PARA" (até 28 caracteres, ex.: "IDEAL PARA PETSHOPS").
- "extras": exatamente 4 vantagens DIFERENTES dos benefícios, {"titulo" até 18, "texto" até 40, "icone"}, para a faixa do rodapé.
- "cta": {"titulo": até 22 caracteres (ex.: "GARANTA O SEU AGORA"), "texto": até 42 caracteres (ex.: "e leve mais potência para suas receitas!")}.
- "selo": até 18 caracteres (ex.: "NOVIDADE NA LOJA"; "PRODUTO ORIGINAL" só se a descrição disser que é original).
- "beneficios": exatamente 4 itens {"titulo" até 16 caracteres, "texto" até 26 caracteres, "icone"} focados no que ajuda o cliente a saber se é o produto que procura. "icone" é um destes: ${ICON_KEYS.join(', ')}.
- "especificacoes": até 4 itens {"rotulo","valor"} com dados técnicos curtos da ficha (ex.: {"rotulo":"Potência","valor":"1000W"}). Lista vazia se não houver.
- "variacoes": se a descrição oferecer o produto em mais de um tamanho, capacidade, voltagem ou cor, liste cada opção curta (ex.: ["3L","4,5L","7L"] ou ["110V","220V"]). Senão, lista vazia.
- "data_comemorativa": se a descrição citar uma data (ex.: "Dia dos Pais", "Natal", "Black Friday"), escreva-a; senão "".
- "chamada": frase curta de impacto para o rodapé, até 24 caracteres.
- "frase": manchete em até 3 partes para modelos de impacto: {"topo": até 16 caracteres em caixa alta (ex.: "MONITOR DE", "SOM QUE"), "destaque": a parte forte, até 22 caracteres (ex.: "REFERÊNCIA", "ELEVA SUA EXPERIÊNCIA", "CONEXÃO TOTAL."), "base": opcional, até 16 caracteres (ex.: "PROFISSIONAL")}.
- "resumo": 1 frase de até 110 caracteres sobre o que o produto entrega ao cliente.
- "cor": a cor que combina com o produto/categoria, uma destas: ${co.colors.join(', ')}.
- "modelo": o modelo de arte mais adequado, um destes ids:
${co.models.map((m) => '  ' + m.id + ' = ' + m.name + ': ' + m.when).join('\n')}
- "motivo": por que esse modelo, em até 90 caracteres, falando com a equipe da loja.
- "legenda": legenda no estilo da loja: ${co.captionStyle}; fecha com "${co.closing}" e 6 a 8 hashtags incluindo ${co.hashtag}.

FORMATO
{"marca":"","selo":"","tipo":"","titulo":"","subtitulo":"","linha":"","manchete":{"topo":"","destaque":"","script":""},"badge":"","carimbo":{"topo":"","base":"","icone":""},"publico":"","beneficios":[{"titulo":"","texto":"","icone":""}],"extras":[{"titulo":"","texto":"","icone":""}],"cta":{"titulo":"","texto":""},"especificacoes":[{"rotulo":"","valor":""}],"variacoes":[],"data_comemorativa":"","chamada":"","frase":{"topo":"","destaque":"","base":""},"resumo":"","cor":"","modelo":"","motivo":"","legenda":""}

DESCRIÇÃO DO PRODUTO
"""
${desc.slice(0, 8000)}
"""`;
}

export function carouselPrompt(co: Company, desc: string, nImg: number, tema: string, n: number): string {
  return `Você cria carrosséis de conteúdo para o Instagram da ${co.about}.
${nImg > 1 ? 'As ' + nImg + ' imagens anexadas são as fotos 1 a ' + nImg + ' do MESMO produto, em ângulos diferentes, nessa ordem. ' : nImg === 1 ? 'A imagem anexada é a foto do produto. ' : ''}Monte um carrossel de ${n} slides sobre o produto abaixo: 1 capa, ${n - 2} slides de conteúdo e 1 slide final de chamada.
${tema ? 'Tema pedido pela equipe: ' + tema.slice(0, 200) : 'Escolha o tema que mais ajuda o cliente a decidir a compra (ex.: motivos para ter, como usar, dicas de uso, como escolher).'}

REGRAS
- Português do Brasil, frases curtas e diretas, tom próximo.
- Dados técnicos (potência, capacidade, material, medidas, voltagem) só se estiverem na descrição. Nunca invente números, preço ou marca.
- Dicas de uso gerais e de bom senso podem ser usadas, desde que não contradigam a descrição.
- Capa no estilo da loja: "capa.gancho" começa com número (ex.: "3 tarefas simples", "4 motivos para ter uma"), até 32 caracteres; "capa.pilula" continua a frase numa faixa colorida, até 22 caracteres (ex.: "que roubam seu"); "capa.destaque" 1 palavra gigante (ex.: "tempo"); "capa.script" fecho manuscrito até 14 caracteres (ex.: "em casa"); "capa.apoio" até 30 caracteres (ex.: "e como resolver hoje.").
- "slides": exatamente ${n - 2} itens. Cada um tem "tipo":
  todos têm "titulo" (parte escura, até 22 caracteres) e "destaque" (parte colorida, até 22 caracteres), ex.: titulo "Mais sabor," destaque "menos trabalho.";
  "problema" = problema e solução: "problema" até 110 caracteres, "solucao" até 110 caracteres, "itens" com 4 vantagens curtas até 22 caracteres (use pelo menos 1 slide assim);
  "topico" = um benefício ou dica: "texto" até 200 caracteres; opcional "numero" (dado da ficha, ex.: "10L") e "numero_rotulo" (ex.: "de capacidade");
  "passos" = passo a passo: "titulo" + "itens" com 3 a 5 passos de até 50 caracteres;
  "specs" = ficha técnica: "titulo" + "itens" no formato "Rótulo: valor" (máx. 6), SÓ se a descrição tiver dados técnicos.
  "icone" de cada slide é um destes: ${ICON_KEYS.join(', ')}.
- "cta.titulo" parte escura até 20 caracteres (ex.: "Mais praticidade e"); "cta.destaque" parte colorida até 20 caracteres (ex.: "mais tempo livre"); "cta.texto" até 70 caracteres.
- "produto": nome curto do produto.
${nImg > 1 ? '- "foto": em cada slide, na capa e no cta, o número (1 a ' + nImg + ') da foto que melhor ilustra aquele conteúdo (ex.: tampa aberta no slide sobre limpeza). Use a foto mais bonita e completa na capa e varie as fotos entre os slides.\n' : ''}- "legenda": legenda do carrossel no estilo da loja: abre com pergunta, convida a arrastar, resume o conteúdo em 2 parágrafos curtos, fecha com "${co.closing}" e 6 a 8 hashtags incluindo ${co.hashtag}.

FORMATO
{"produto":"","capa":{"gancho":"","pilula":"","destaque":"","script":"","apoio":""${nImg > 1 ? ',"foto":1' : ''}},"slides":[{"tipo":"problema","titulo":"","destaque":"","texto":"","problema":"","solucao":"","numero":"","numero_rotulo":"","itens":[],"icone":""${nImg > 1 ? ',"foto":2' : ''}}],"cta":{"titulo":"","destaque":"","texto":""${nImg > 1 ? ',"foto":1' : ''}},"legenda":""}

DESCRIÇÃO DO PRODUTO
"""
${desc.slice(0, 8000)}
"""`;
}

// ---------------------------------------------------------------- Studio ML
export function mlRewritePrompt(co: Company, d: { title: string; brand: string; model: string; attributes: { name: string; value: string }[]; texts: { source: string; title: string; text: string }[] }): string {
  const ficha = d.attributes.map((a) => `- ${a.name}: ${a.value}`).join('\n') || '(sem ficha)';
  const textos = d.texts.slice(0, 4).map((t, i) => `[${i + 1}] ${t.source} — "${t.title}"\n${t.text.slice(0, 2500)}`).join('\n\n') || '(sem descrições)';
  return `Você escreve anúncios do Mercado Livre para a ${co.about}.
Abaixo estão os dados de um produto coletados no Mercado Livre: título, ficha técnica e descrições de outros anúncios.
Escreva um anúncio NOVO e PRÓPRIO da ${co.name}. Use os fatos da ficha e das descrições, mas não copie frases dos concorrentes.

REGRAS
- Português do Brasil. Só fatos que estão nos dados. Nunca invente medidas, potência, voltagem, garantia, brindes ou compatibilidade.
- Se as fontes discordarem num dado, use o da ficha técnica e cite a dúvida em "alertas".
- "titulo": até 60 caracteres, no padrão do ML: tipo do produto + marca + modelo + 1 ou 2 atributos mais buscados (ex.: "Cafeteira Elétrica Oster 0,75L Inox 220V"). Sem emojis, sem caixa alta inteira, sem palavras como "promoção" ou "frete grátis".
- "descricao": texto puro (sem HTML, sem emojis, sem links, sem telefone, e-mail ou redes sociais), entre 900 e 2500 caracteres, com: 1 parágrafo de abertura sobre o uso e o benefício principal; "PRINCIPAIS CARACTERÍSTICAS" com 4 a 8 linhas começando com "- "; "ESPECIFICAÇÕES TÉCNICAS" com as linhas "Nome: valor" mais importantes; "CONTEÚDO DA EMBALAGEM" só se os dados disserem o que vem na caixa; e uma frase final de confiança da loja (sem prometer prazo ou garantia que não esteja nos dados).
- "ficha": lista {"nome","valor"} limpa e padronizada para o anúncio (nomes curtos com inicial maiúscula, valores com unidade, sem duplicados, sem dados internos do ML), na ordem de importância para o comprador. Até 25 itens.
- "destaques": 3 a 5 frases curtas (até 60 caracteres) com os principais argumentos de venda.
- "alertas": lista de avisos curtos para a equipe conferir (ex.: voltagem diferente entre anúncios, ficha incompleta). Lista vazia se não houver.

FORMATO
{"titulo":"","descricao":"","ficha":[{"nome":"","valor":""}],"destaques":[],"alertas":[]}

DADOS COLETADOS
Título de referência: ${d.title}
Marca: ${d.brand || '(não informada)'} · Modelo: ${d.model || '(não informado)'}

FICHA TÉCNICA
${ficha}

DESCRIÇÕES DE REFERÊNCIA
${textos}`;
}

export function watermarkPrompt(n: number): string {
  return `As ${n} imagens anexadas são fotos de produto de anúncios do Mercado Livre, na ordem 1 a ${n}.
Para cada imagem, diga se ela tem MARCA D'ÁGUA ou identificação de outra loja: logo ou nome de loja/vendedor, @ de rede social, site, telefone, carimbo semitransparente sobre a foto, ou faixa/selo promocional com nome de loja.
Logos e nomes que fazem parte do próprio produto ou da embalagem original do fabricante NÃO são marca d'água.
Responda SOMENTE com JSON: {"imagens":[{"n":1,"marca_dagua":true,"onde":"logo 'LOJA X' no canto inferior direito"}]} — "onde" curto, vazio quando não houver.`;
}
