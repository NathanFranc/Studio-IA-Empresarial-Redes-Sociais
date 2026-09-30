/** Textos enviados para a IA. Montados no servidor para que ninguém use a chave com outro fim. */
import { COLOR_KEYS, ICON_KEYS, MODELS } from './catalog.js';

const CLOSING = 'Acesse o link na bio e garanta o seu com envio rápido pela Megadino! 📦';

export function postPrompt(desc: string, nImg: number, photoWhite: boolean | null): string {
  const withImage = nImg > 0;
  const photoNote = photoWhite === null
    ? 'Ainda não há foto.'
    : photoWhite
      ? 'A foto tem fundo branco (produto isolado).'
      : 'A foto NÃO tem fundo branco (provavelmente produto em uso ou num ambiente).';
  return `Você cria posts de feed do Instagram para a Megadino, loja online brasileira que vende eletroportáteis, utilidades domésticas e produtos de cuidado pessoal (Wahl, KitchenAid, Philco, Britânia...).
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
- "cor": a cor que combina com o produto/categoria, uma destas: ${COLOR_KEYS.join(', ')}.
- "modelo": o modelo de arte mais adequado, um destes ids:
${MODELS.map((m) => '  ' + m.id + ' = ' + m.name + ': ' + m.when).join('\n')}
- "motivo": por que esse modelo, em até 90 caracteres, falando com a equipe da loja.
- "legenda": legenda no estilo da loja: abre com uma pergunta ou dor do cliente, 2 a 3 parágrafos curtos explicando benefícios e especificações, emojis com moderação, fecha com "${CLOSING}" e 6 a 8 hashtags incluindo #Megadino.

FORMATO
{"marca":"","selo":"","tipo":"","titulo":"","subtitulo":"","linha":"","manchete":{"topo":"","destaque":"","script":""},"badge":"","carimbo":{"topo":"","base":"","icone":""},"publico":"","beneficios":[{"titulo":"","texto":"","icone":""}],"extras":[{"titulo":"","texto":"","icone":""}],"cta":{"titulo":"","texto":""},"especificacoes":[{"rotulo":"","valor":""}],"variacoes":[],"data_comemorativa":"","chamada":"","cor":"","modelo":"","motivo":"","legenda":""}

DESCRIÇÃO DO PRODUTO
"""
${desc.slice(0, 8000)}
"""`;
}

export function carouselPrompt(desc: string, nImg: number, tema: string, n: number): string {
  return `Você cria carrosséis de conteúdo para o Instagram da Megadino, loja online brasileira de eletroportáteis, utilidades domésticas e cuidado pessoal.
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
${nImg > 1 ? '- "foto": em cada slide, na capa e no cta, o número (1 a ' + nImg + ') da foto que melhor ilustra aquele conteúdo (ex.: tampa aberta no slide sobre limpeza). Use a foto mais bonita e completa na capa e varie as fotos entre os slides.\n' : ''}- "legenda": legenda do carrossel no estilo da loja: abre com pergunta, convida a arrastar, resume o conteúdo em 2 parágrafos curtos, fecha com "${CLOSING}" e 6 a 8 hashtags incluindo #Megadino.

FORMATO
{"produto":"","capa":{"gancho":"","pilula":"","destaque":"","script":"","apoio":""${nImg > 1 ? ',"foto":1' : ''}},"slides":[{"tipo":"problema","titulo":"","destaque":"","texto":"","problema":"","solucao":"","numero":"","numero_rotulo":"","itens":[],"icone":""${nImg > 1 ? ',"foto":2' : ''}}],"cta":{"titulo":"","destaque":"","texto":""${nImg > 1 ? ',"foto":1' : ''}},"legenda":""}

DESCRIÇÃO DO PRODUTO
"""
${desc.slice(0, 8000)}
"""`;
}
