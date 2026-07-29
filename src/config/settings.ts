import 'dotenv/config';

export interface FacebookConfig {
  enabled: boolean;
  groupUrls: string[];
  maxGroupsPerCycle: number;
  delayBetweenPostsSec: number;
  waGroupLink: string;
  autoJoin: boolean;
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
}

function parseList(value: string | undefined): string[] {
  if (!value || value.trim() === '') return [];
  return value.split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(): AppConfig {
  const affiliateId = process.env.ML_AFFILIATE_ID ?? '';
  const accessToken = process.env.ML_ACCESS_TOKEN ?? '';

  if (!affiliateId || affiliateId === 'seu-tracking-id-aqui') {
    console.warn(
      '\n⚠️  ATENÇÃO: ML_AFFILIATE_ID não configurado no .env!' +
      '\n   Os links gerados NÃO terão seu tracking de afiliado.' +
      '\n   Configure em .env para ganhar comissões.\n'
    );
  }

  return {
    affiliate: {
      id: affiliateId,
      source: process.env.ML_AFFILIATE_SOURCE ?? 'whatsapp',
      word: process.env.ML_AFFILIATE_WORD ?? 'carlossilva7700',
    },
    filters: {
      minDiscount: Number(process.env.ML_MIN_DISCOUNT ?? 10),
      minPrice: Number(process.env.ML_MIN_PRICE ?? 30),
      maxPrice: Number(process.env.ML_MAX_PRICE ?? 500),
      maxResults: Number(process.env.ML_MAX_RESULTS ?? 10),
      categories: parseList(process.env.ML_CATEGORIES),
    },
    queries: parseList(process.env.ML_CATEGORIES).length > 0
      ? parseList(process.env.ML_CATEGORIES)
      : (parseList(process.env.ML_DEFAULT_QUERIES).length > 0
          ? parseList(process.env.ML_DEFAULT_QUERIES)
          : ['ofertas do dia']),
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
      maxGroupsPerCycle: Number(process.env.FB_MAX_GROUPS_PER_CYCLE ?? 5),
      delayBetweenPostsSec: Number(process.env.FB_DELAY_BETWEEN_POSTS ?? 60),
      waGroupLink: process.env.FB_WA_GROUP_LINK || 'https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N',
      autoJoin: process.env.FB_AUTO_JOIN !== 'false',
    },
  };
}
