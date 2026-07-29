import type { AppConfig } from '../config/settings.js';
import type { MLOffer } from '../collector/ml-api.js';

export interface AffiliateOffer extends MLOffer {
  affiliateLink: string;
}

/**
 * Limpa URLs do Mercado Livre removendo títulos gigantes, parâmetros de busca (#polycard_client...)
 * e mantém apenas a estrutura limpa oficial.
 */
export function cleanMLPermalink(rawUrl: string): string {
  if (!rawUrl) return '';

  // Isolamento do caminho sem hash e sem query
  let url = rawUrl.split('#')[0].split('?')[0].trim();

  // Caso 1: Produto /p/MLBxxxxxx
  const pMatch = url.match(/\/p\/(MLB\d+)/i);
  if (pMatch && pMatch[1]) {
    return `https://www.mercadolivre.com.br/p/${pMatch[1]}`;
  }

  // Caso 2: Anúncio /MLB-xxxxxx
  const mlbMatch = url.match(/(MLB-?\d+)/i);
  if (mlbMatch && mlbMatch[1]) {
    return `https://produto.mercadolivre.com.br/${mlbMatch[1]}`;
  }

  return url;
}

/**
 * Converte um link normal do Mercado Livre no Link Oficial Encurtado & Limpo do Mercado Livre.
 *
 * Exemplo de transformação:
 *   Entrada (com sujeiras de busca):
 *     https://www.mercadolivre.com.br/jogo-chaves.../p/MLB70653356#polycard_client=search-desktop...
 *
 *   Saída (Link Oficial Curto Limpo):
 *     https://www.mercadolivre.com.br/p/MLB70653356?matt_tool=52075002&matt_word=carlossilva7700
 */
export function convertToOfficialMLAffiliateLink(
  permalink: string,
  config: AppConfig
): string {
  // Se a URL já for um link curto oficial do ML (ex: mercadolivre.com/sec/...), mantém intacto
  if (permalink.includes('mercadolivre.com/sec/') || permalink.includes('mliv.re/')) {
    return permalink;
  }

  const cleanUrl = cleanMLPermalink(permalink);
  const affiliateId = config.affiliate.id || '52075002';
  
  // Oculta nome de usuário de matt_word para proteger a privacidade
  let affiliateWord = config.affiliate.word || 'promos-wa';
  if (affiliateWord.toLowerCase().includes('carlossilva') || affiliateWord.includes('@')) {
    affiliateWord = 'promos-wa';
  }

  try {
    const url = new URL(cleanUrl);
    url.searchParams.set('matt_tool', affiliateId);
    url.searchParams.set('matt_word', affiliateWord);

    return url.toString();
  } catch {
    const separator = cleanUrl.includes('?') ? '&' : '?';
    return `${cleanUrl}${separator}matt_tool=${affiliateId}&matt_word=${affiliateWord}`;
  }
}

/**
 * Converte um array de ofertas utilizando exclusivamente o formato OFICIAL CURTO do Mercado Livre.
 */
export async function convertOffers(
  offers: MLOffer[],
  config: AppConfig
): Promise<AffiliateOffer[]> {
  return offers.map((offer) => ({
    ...offer,
    affiliateLink: convertToOfficialMLAffiliateLink(offer.permalink, config),
  }));
}
