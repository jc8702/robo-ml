import 'dotenv/config';
import { dbGetSettings } from '../db/index.js';

export const DEFAULT_CATEGORIES = [
  // Celulares & Telefones
  'iphone', 'samsung galaxy', 'xiaomi', 'motorola', 'realme', 'smartwatch', 'airpods', 'carregador celular', 'capinha celular',
  // Informática & Computação
  'notebook gamer', 'pc gamer', 'monitor gamer', 'placa de video', 'processador intel ryzen', 'ssd nvme', 'teclado mecanico', 'impressora', 'roteador wifi',
  // Games & Consoles
  'playstation 5', 'xbox series', 'nintendo switch', 'steam deck', 'cadeira gamer', 'volante logitech',
  // Eletrônicos & Áudio
  'smart tv', 'caixa de som jbl', 'fone bluetooth', 'soundbar', 'drone dji', 'camera de seguranca', 'fire tv stick',
  // Eletrodomésticos
  'air fryer', 'cafeteira', 'aspirador robo', 'geladeira', 'lava e seca', 'cooktop', 'ar condicionado', 'liquidificador',
  // Casa & Móveis
  'sofa retratil', 'colchao queen king', 'guarda roupa', 'mesa de jantar', 'lampada smart', 'jogo de cama',
  // Ferramentas
  'parafusadeira', 'jogo de ferramentas', 'serra tico tico', 'inversora de solda', 'chuveiro lorenzetti',
  // Beleza & Cuidado Pessoal
  'barbeador eletrico', 'secador de cabelo', 'perfume importado', 'skincare', 'maquiagem',
  // Saúde & Suplementos
  'whey protein', 'creatina', 'pre treino', 'vitamina c d3',
  // Esportes & Fitness
  'bicicleta aro 29', 'kit halteres', 'tenis corrida', 'barraca camping', 'bola futebol',
  // Moda & Calçados
  'tenis casual', 'camiseta masculina', 'vestido feminino', 'mochila notebook', 'relogio casio',
  // Bebês & Infantil
  'carrinho de bebe', 'brinquedo fisher price', 'lego', 'mamadeira avent',
  // Automotivo
  'pneu aro', 'multimidia android', 'oleo motor 5w30', 'estetica automotiva',
  // Pet Shop
  'racao caes', 'racao gatos', 'caminha pet'
];

export interface FacebookConfig {
  enabled: boolean;
  groupUrls: string[];
  maxGroupsPerCycle: number;
  delayBetweenPostsSec: number;
  waGroupLink: string;
  autoJoin: boolean;
}

export interface InstagramConfig {
  enabled: boolean;
  username: string;
  password?: string;
  maxPostsPerCycle: number;
  bioLink: string;
  customHashtags: string;
}

export interface AppConfig {
  affiliate: {
    id: string;
    source: string;
    word: string;
  };
  filters: {
    minDiscount: number;
    minPrice: number;
    maxPrice: number;
    maxResults: number;
    categories: string[];
  };
  queries: string[];
  output: {
    format: 'individual' | 'lista';
    autoClipboard: boolean;
  };
  api: {
    accessToken: string;
    useApi: boolean;
  };
  facebook: FacebookConfig;
  instagram: InstagramConfig;
}

function parseList(value: string | undefined): string[] {
  if (!value || value.trim() === '') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

/**
 * Carrega configurações de forma síncrona (local / env) com fallback padrão de categorias.
 */
export function loadConfig(): AppConfig {
  const affiliateId = process.env.ML_AFFILIATE_ID ?? '52075002';
  const accessToken = process.env.ML_ACCESS_TOKEN ?? '';

  const parsedCat = parseList(process.env.ML_CATEGORIES);
  const categories = parsedCat.length > 0 ? parsedCat : DEFAULT_CATEGORIES;

  return {
    affiliate: {
      id: affiliateId,
      source: process.env.ML_AFFILIATE_SOURCE ?? 'whatsapp',
      word: process.env.ML_AFFILIATE_WORD ?? 'promos-wa',
    },
    filters: {
      minDiscount: Number(process.env.ML_MIN_DISCOUNT ?? 0),
      minPrice: Number(process.env.ML_MIN_PRICE ?? 30),
      maxPrice: Number(process.env.ML_MAX_PRICE ?? 10000),
      maxResults: Number(process.env.ML_MAX_RESULTS ?? 35),
      categories,
    },
    queries: categories,
    output: {
      format: (process.env.ML_OUTPUT_FORMAT as 'individual' | 'lista') ?? 'individual',
      autoClipboard: process.env.ML_AUTO_CLIPBOARD !== 'false',
    },
    api: {
      accessToken,
      useApi: accessToken.length > 0,
    },
    facebook: {
      enabled: process.env.FB_ENABLED === 'true',
      groupUrls: parseList(process.env.FB_GROUP_URLS),
      maxGroupsPerCycle: Number(process.env.FB_MAX_GROUPS_PER_CYCLE ?? 64),
      delayBetweenPostsSec: Number(process.env.FB_DELAY_BETWEEN_POSTS ?? 60),
      waGroupLink: process.env.FB_WA_GROUP_LINK || 'https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N',
      autoJoin: process.env.FB_AUTO_JOIN !== 'false',
    },
    instagram: {
      enabled: process.env.INSTAGRAM_ENABLED === 'true',
      username: process.env.INSTAGRAM_USERNAME || '',
      password: process.env.INSTAGRAM_PASSWORD || '',
      maxPostsPerCycle: Number(process.env.INSTAGRAM_MAX_POSTS_PER_CYCLE ?? 3),
      bioLink: process.env.INSTAGRAM_BIO_LINK || 'https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N',
      customHashtags: process.env.INSTAGRAM_HASHTAGS || '#achadinhos #ofertas #mercadolivre #desconto',
    },
  };
}

/**
 * Carrega configurações mesclando o banco de dados Neon (nuvem) e fallbacks locais.
 */
export async function loadConfigAsync(): Promise<AppConfig> {
  const dbSettings = await dbGetSettings();

  const categoriesStr = dbSettings.ML_CATEGORIES || process.env.ML_CATEGORIES;
  const categories = categoriesStr ? parseList(categoriesStr) : DEFAULT_CATEGORIES;

  const minDiscount = Number(dbSettings.ML_MIN_DISCOUNT || process.env.ML_MIN_DISCOUNT || 0);
  const minPrice = Number(dbSettings.ML_MIN_PRICE || process.env.ML_MIN_PRICE || 30);
  const maxPrice = Number(dbSettings.ML_MAX_PRICE || process.env.ML_MAX_PRICE || 10000);
  const maxResults = Number(dbSettings.ML_MAX_RESULTS || process.env.ML_MAX_RESULTS || 35);

  const affiliateId = process.env.ML_AFFILIATE_ID || '52075002';
  const accessToken = process.env.ML_ACCESS_TOKEN || '';

  return {
    affiliate: {
      id: affiliateId,
      source: process.env.ML_AFFILIATE_SOURCE || 'whatsapp',
      word: process.env.ML_AFFILIATE_WORD || 'promos-wa',
    },
    filters: {
      minDiscount,
      minPrice,
      maxPrice,
      maxResults,
      categories,
    },
    queries: categories,
    output: {
      format: (process.env.ML_OUTPUT_FORMAT as 'individual' | 'lista') || 'individual',
      autoClipboard: process.env.ML_AUTO_CLIPBOARD !== 'false',
    },
    api: {
      accessToken,
      useApi: accessToken.length > 0,
    },
    facebook: {
      enabled: dbSettings.FB_ENABLED ? dbSettings.FB_ENABLED === 'true' : process.env.FB_ENABLED === 'true',
      groupUrls: parseList(dbSettings.FB_GROUP_URLS).length > 0 ? parseList(dbSettings.FB_GROUP_URLS) : parseList(process.env.FB_GROUP_URLS),
      maxGroupsPerCycle: Number(dbSettings.FB_MAX_GROUPS_PER_CYCLE || process.env.FB_MAX_GROUPS_PER_CYCLE || 64),
      delayBetweenPostsSec: Number(dbSettings.FB_DELAY_BETWEEN_POSTS || process.env.FB_DELAY_BETWEEN_POSTS || 60),
      waGroupLink: dbSettings.FB_WA_GROUP_LINK || process.env.FB_WA_GROUP_LINK || 'https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N',
      autoJoin: dbSettings.FB_AUTO_JOIN ? dbSettings.FB_AUTO_JOIN === 'true' : process.env.FB_AUTO_JOIN !== 'false',
    },
    instagram: {
      enabled: dbSettings.INSTAGRAM_ENABLED ? dbSettings.INSTAGRAM_ENABLED === 'true' : process.env.INSTAGRAM_ENABLED === 'true',
      username: dbSettings.INSTAGRAM_USERNAME || process.env.INSTAGRAM_USERNAME || '',
      password: dbSettings.INSTAGRAM_PASSWORD || process.env.INSTAGRAM_PASSWORD || '',
      maxPostsPerCycle: Number(dbSettings.INSTAGRAM_MAX_POSTS_PER_CYCLE || process.env.INSTAGRAM_MAX_POSTS_PER_CYCLE || 3),
      bioLink: dbSettings.INSTAGRAM_BIO_LINK || process.env.INSTAGRAM_BIO_LINK || 'https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N',
      customHashtags: dbSettings.INSTAGRAM_HASHTAGS || process.env.INSTAGRAM_HASHTAGS || '#achadinhos #ofertas #mercadolivre #desconto',
    },
  };
}
