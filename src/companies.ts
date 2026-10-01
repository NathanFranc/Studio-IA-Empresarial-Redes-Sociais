/*
 * Estúdio Megadino — Copyright (c) 2026 Nathan Vinicius Franca de Lima. Todos os direitos reservados.
 * Uso, cópia, modificação ou distribuição só com autorização por escrito do autor. Ver LICENSE.
 */
/**
 * Empresas atendidas pelo Estúdio. Cada uma tem a própria conta do Instagram, o próprio
 * histórico, os próprios modelos de arte e o jeito de escrever a legenda.
 * Os modelos (id, nome, quando usar) precisam bater com public/index.html (COMPANIES).
 */
import { COLOR_KEYS, MODELS } from './catalog.js';

export interface Company {
  id: string;
  name: string;
  handle: string;
  /** Quem é a loja, para a IA. */
  about: string;
  /** Frase final da legenda. */
  closing: string;
  hashtag: string;
  /** Cores que a IA pode escolher (as mesmas chaves do front). */
  colors: string[];
  /** Como a legenda deve ser escrita. */
  captionStyle: string;
  models: { id: string; name: string; when: string }[];
}

export const COMPANIES: Record<string, Company> = {
  megadino: {
    id: 'megadino',
    name: 'Megadino',
    handle: 'loja_megadino',
    about: 'Megadino, loja online brasileira que vende eletroportáteis, utilidades domésticas e produtos de cuidado pessoal (Wahl, KitchenAid, Philco, Britânia...)',
    closing: 'Acesse o link na bio e garanta o seu com envio rápido pela Megadino! 📦',
    hashtag: '#Megadino',
    colors: COLOR_KEYS,
    captionStyle: 'abre com uma pergunta ou dor do cliente, 2 a 3 parágrafos curtos explicando benefícios e especificações, emojis com moderação',
    models: MODELS,
  },
  idmshop: {
    id: 'idmshop',
    name: 'IDM Shop',
    handle: 'idmshopoficial',
    about: 'IDM Shop, loja brasileira especializada em áudio e vídeo de alta performance: home theater, som ambiente, caixas acústicas, amplificadores, receivers, toca-discos e monitores de estúdio (JBL, Bowers & Wilkins, Harman Kardon, Polk, Yamaha, Denon, Onkyo, Monitor Audio, AKG, Loud, Pure Acoustics), com assessoria especializada. O público é exigente e gosta de dados técnicos (potência RMS, impedância, vias, polegadas, conexões)',
    closing: '👉 Acesse o link na bio e conheça!',
    hashtag: '#IDMShop',
    colors: ['laranja', 'amarelo', 'dourado', 'vermelho', 'azul', 'verde'],
    captionStyle: 'abre com uma linha de impacto com emoji (ex.: "🚀 LANÇAMENTO | Nova linha ..." ou uma pergunta), 1 parágrafo curto sobre a experiência de som, depois "✨ Destaques:" com 4 a 7 itens no formato "* emoji texto" só com dados da ficha, uma frase de fechamento e a linha "📍 Encontre o <produto> na IDM SHOP."',
    models: [
      { id: 'i_lanc', name: 'Lançamento premium', when: 'Fundo escuro noturno, selo dourado, marca + nova linha, manchete branca e dourada, 5 recursos com ícones e barra de dados (estilo Loud STA 2150). Bom para amplificadores, receivers e eletrônicos.' },
      { id: 'i_torre', name: 'Ficha laranja', when: 'Modelo gigante em laranja, chamada de experiência, texto curto, 4 recursos com ícones e barra Compre agora (estilo Pure Acoustics Supernova). Bom para caixas acústicas e produtos com muitos dados.' },
      { id: 'i_ref', name: 'Destaque amarelo', when: 'Manchete em 3 linhas com a palavra forte em amarelo, marca e modelo gigantes, caixa com frase e botão amarelo (estilo Yamaha HS5). Bom para produto profissional ou de referência.' },
      { id: 'i_data', name: 'Data comemorativa', when: 'Moldura dourada, data gigante em amarelo, faixa com o nome do produto e 3 recursos (estilo Dia dos Pais). Use quando a descrição citar uma data.' },
      { id: 'i_amb', name: 'Ambiente elegante', when: 'Foto do produto no ambiente com título fino e espaçado, nome do produto e detalhe dourado (estilo JBL Control no paisagismo). Melhor com foto do produto instalado.' },
      { id: 'i_curio', name: 'Conteúdo da marca', when: 'Fundo preto com a cor da marca, número gigante de motivos e manchete forte (estilo "3 coisas sobre a JBL"). Bom para engajamento e marcas fortes.' },
    ],
  },
};

export const DEFAULT_COMPANY = 'megadino';
export const companyIds = Object.keys(COMPANIES);

/** Lê a empresa enviada pelo front (cai na padrão se vier algo desconhecido). */
export function pickCompany(v: unknown): Company {
  return COMPANIES[String(v ?? '')] ?? COMPANIES[DEFAULT_COMPANY];
}
