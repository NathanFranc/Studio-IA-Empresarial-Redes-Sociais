/** Listas compartilhadas com o front-end (manter em sincronia com public/estudio.js). */
export const ICON_KEYS = [
  'raio', 'escudo', 'relogio', 'gota', 'olho', 'cabo', 'brilho', 'caixa', 'fogo', 'girar', 'bateria', 'tomada',
  'regua', 'coracao', 'check', 'casa', 'vento', 'som', 'tesoura', 'celular', 'carrinho', 'cupom', 'presente',
  'estrela', 'caminhao', 'sacola', 'x', 'pata', 'pessoas', 'alvo', 'diamante', 'motor', 'folha',
];

export const COLOR_KEYS = ['vermelho', 'azul', 'laranja', 'verde', 'rosa', 'dourado', 'preto'];

export const MODELS: { id: string; name: string; when: string }[] = [
  { id: 'claro', name: 'Ficha clara', when: 'Fundo branco, marca grande e produto em destaque (estilo capas Wahl Travel Shaver e Style Pro).' },
  { id: 'ficha', name: 'Ficha colorida', when: 'Fundo na cor do produto, 3 benefícios e público ideal (estilo Wahl KM2+).' },
  { id: 'faixa', name: 'Destaque de marca', when: 'Marca forte: manchete, lista de benefícios, dados técnicos e faixa de vantagens (estilo KitchenAid).' },
  { id: 'tamanhos', name: 'Linha de tamanhos', when: 'Produto vendido em várias capacidades, voltagens ou cores (estilo Panelux).' },
  { id: 'kit', name: 'Kit / seleção', when: 'Kits e conjuntos sobre pedestal, com ícones de cada item (estilo Dagua Natural).' },
  { id: 'premium', name: 'Premium escuro', when: 'Fundo escuro com luz quente, dourado e faixa de nomes (estilo Wahl Barbearia).' },
  { id: 'ambiente', name: 'Produto no ambiente', when: 'Manchete no topo, destaque do modo de uso e faixa azul no rodapé (estilo Latina SR555).' },
  { id: 'dicas', name: 'Capa de carrossel', when: 'Número grande, frase com destaque e manuscrito (estilo "3 tarefas simples").' },
  { id: 'data', name: 'Data comemorativa', when: 'Fundo escuro de loja, data gigante, selo redondo e barra de confiança (estilo Dia dos Pais).' },
  { id: 'cupom', name: 'Cupom / promoção', when: 'Laranja vibrante, cupom em cartão tracejado e chamada final (estilo cupom Shopee).' },
];
