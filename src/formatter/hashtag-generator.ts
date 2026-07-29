/**
 * Gerador de Hashtags Relevantes para Meta (Facebook / Instagram) e WhatsApp.
 *
 * Diretrizes do Algoritmo da Meta:
 * - 3 a 5 hashtags é a quantidade ideal (sweet spot) para alcance e indexação.
 * - Evita penalização por spam no algoritmo da Meta (mais de 8-10 hashtags reduz o alcance orgânico).
 * - Combina: Marca/Produto (específico) + Categoria + Intenção de Compra/Desconto.
 */

/** Dicionário de marcas conhecidas e suas hashtags oficiais */
const BRAND_HASHTAGS: Record<string, string> = {
  lg: '#LG',
  samsung: '#Samsung',
  apple: '#Apple',
  iphone: '#iPhone',
  xiaomi: '#Xiaomi',
  motorola: '#Motorola',
  realme: '#Realme',
  jbl: '#JBL',
  dji: '#DJI',
  lorenzetti: '#Lorenzetti',
  sony: '#Sony',
  philips: '#Philips',
  intelbras: '#Intelbras',
  mondial: '#Mondial',
  arno: '#Arno',
  electrolux: '#Electrolux',
  brastemp: '#Brastemp',
  console: '#PlayStation',
  playstation: '#PlayStation',
  xbox: '#Xbox',
  nintendo: '#Nintendo',
};

/** Dicionário de termos de produtos para hashtags de categoria */
const CATEGORY_HASHTAGS: Record<string, string[]> = {
  tv: ['#SmartTV', '#TV4K', '#Eletronicos'],
  television: ['#SmartTV', '#TV4K'],
  smarttv: ['#SmartTV', '#TV4K'],
  fone: ['#FoneBluetooth', '#Audio'],
  headphone: ['#Headphone', '#Audio'],
  airpods: ['#AirPods', '#Audio'],
  earbuds: ['#FoneBluetooth', '#Tecnologia'],
  celular: ['#Smartphone', '#Celular', '#Tecnologia'],
  smartphone: ['#Smartphone', '#Tecnologia'],
  smartwatch: ['#Smartwatch', '#Tecnologia'],
  relogio: ['#Smartwatch', '#Wearables'],
  soundbar: ['#Soundbar', '#HomeTheater'],
  caixa: ['#CaixaDeSom', '#Audio'],
  camera: ['#CameraSeguranca', '#CasaInteligente'],
  parafusadeira: ['#Ferramentas', '#Bricolagem'],
  ferramenta: ['#JogoDeFerramentas', '#Bricolagem'],
  chuveiro: ['#ChuveiroEletrico', '#CasaEConforto'],
  drone: ['#Drone', '#Fotografia'],
  carregador: ['#AcessoriosCelular', '#Tecnologia'],
  capinha: ['#AcessoriosCelular', '#Protecao'],
};

/** Hashtags gerais de intenção de compra e promoções */
const DEAL_HASHTAGS: string[] = [
  '#Ofertas',
  '#Promocao',
  '#Desconto',
  '#Achadinhos',
  '#MercadoLivre',
  '#OfertaDoDia',
  '#MenorPreco',
];

/**
 * Remove acentos e converte para minúsculas para correspondência limpa.
 */
function normalizeText(text: string): string {
  return text
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();
}

/**
 * Converte uma palavra em HashtagCase (CamelCase).
 */
function toHashtagCase(word: string): string {
  const clean = word.replace(/[^a-zA-Z0-9]/g, '');
  if (!clean) return '';
  return '#' + clean.charAt(0).toUpperCase() + clean.slice(1).toLowerCase();
}

/**
 * Gera de 3 a 5 hashtags altamente relevantes para o produto.
 * @param title Título do produto
 * @param maxHashtags Quantidade máxima de hashtags (padrão: 5, recomendado pela Meta)
 */
export function generateProductHashtags(
  title: string,
  maxHashtags: number = 5
): string[] {
  const hashtagsSet = new Set<string>();
  const normalizedTitle = normalizeText(title);

  // 1. Extrai marca do produto (se encontrada no título)
  for (const [brandKey, hashtag] of Object.entries(BRAND_HASHTAGS)) {
    if (normalizedTitle.includes(brandKey)) {
      hashtagsSet.add(hashtag);
      break; // Adiciona a primeira marca encontrada
    }
  }

  // 2. Extrai categorias do produto
  for (const [catKey, tags] of Object.entries(CATEGORY_HASHTAGS)) {
    if (normalizedTitle.includes(catKey)) {
      tags.forEach((tag) => hashtagsSet.add(tag));
      break;
    }
  }

  // 3. Se ainda tiver menos de 3 hashtags, extrai palavras-chave relevantes do título
  if (hashtagsSet.size < 3) {
    const stopWords = new Set([
      'com', 'para', 'sem', 'em', 'da', 'do', 'das', 'dos', 'de', 'e', 'a', 'o',
      'as', 'os', 'um', 'uma', 'kit', 'pro', 'max', 'plus', 'ultra', 'cor', 'preto',
      'branco', 'cinza', 'azul', 'unidades', 'modelo', 'tipo', 'novo'
    ]);

    const words = title
      .split(/\s+/)
      .map((w) => w.replace(/[^a-zA-Z0-9]/g, ''))
      .filter((w) => w.length >= 3 && !stopWords.has(w.toLowerCase()) && isNaN(Number(w)));

    for (const word of words) {
      if (hashtagsSet.size >= 4) break;
      const tag = toHashtagCase(word);
      if (tag.length >= 3) {
        hashtagsSet.add(tag);
      }
    }
  }

  // 4. Completa com hashtags de intenção de promoção/oferta até atingir o limite ideal (3 a 5)
  for (const dealTag of DEAL_HASHTAGS) {
    if (hashtagsSet.size >= Math.min(maxHashtags, 5)) break;
    hashtagsSet.add(dealTag);
  }

  return Array.from(hashtagsSet).slice(0, maxHashtags);
}

/**
 * Retorna uma string formatada com as hashtags em uma linha.
 */
export function formatHashtagsLine(title: string, maxHashtags: number = 4): string {
  const tags = generateProductHashtags(title, maxHashtags);
  return tags.join(' ');
}
