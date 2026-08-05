import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { getRandomLinkCta, getRandomFooterCta } from './cta-phrases.js';
import { formatHashtagsLine } from './hashtag-generator.js';

/**
 * Formata um preço em reais brasileiro.
 */
function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/**
 * Gera mensagem WhatsApp para uma oferta individual.
 * Usa formatação WhatsApp: *negrito*, ~tachado~, _itálico_
 */
export function formatIndividualOffer(offer: AffiliateOffer): string {
  const lines: string[] = [];

  lines.push('🔥 *OFERTA IMPERDÍVEL* 🔥');
  lines.push('');
  lines.push(`📦 *${offer.title}*`);
  lines.push('');

  if (offer.discountPercent > 0 && offer.originalPrice !== offer.currentPrice) {
    lines.push(`💰 De: ~${formatPrice(offer.originalPrice)}~`);
    lines.push(`🏷️ Por: *${formatPrice(offer.currentPrice)}* (-${offer.discountPercent}%)`);
  } else {
    lines.push(`🏷️ Preço: *${formatPrice(offer.currentPrice)}*`);
  }

  if (offer.isLowest30Days) {
    lines.push('📉 *MENOR PREÇO DOS ÚLTIMOS 30 DIAS!* 🔥');
  }

  if (offer.freeShipping) {
    lines.push('🚚 *Frete Grátis!*');
  } else {
    lines.push('🚚 *Frete Rápido & Entrega Garantida!*');
  }

  lines.push('');
  lines.push(getRandomLinkCta(true));
  
  if (offer.productId) {
    lines.push('');
    lines.push(`🔍 *Cole este texto no buscador do Mercado Livre:* ${offer.productId}`);
    lines.push('');
    lines.push(`🔗 *Ou acesse o link:* ${offer.affiliateLink || offer.permalink}`);
  } else {
    lines.push(offer.affiliateLink || offer.permalink);
  }

  const igUsername = (process.env.INSTAGRAM_USERNAME || 'achadosmeli.bnu').replace(/^@/, '');
  const igHandle = `@${igUsername}`;
  const igCleanUrl = `instagram.com/${igUsername}`;

  lines.push('');
  lines.push('📲 *Siga nosso Instagram:*');
  lines.push(`👉 *${igHandle}* (${igCleanUrl})`);
  lines.push('');
  lines.push(getRandomFooterCta(true));
  lines.push('');
  lines.push(formatHashtagsLine(offer.title, 5));

  return lines.join('\n');
}

/**
 * Gera mensagem WhatsApp com lista de ofertas.
 */
export function formatOfferList(offers: AffiliateOffer[]): string {
  const lines: string[] = [];

  lines.push('🛒 *TOP OFERTAS DO DIA* 🛒');
  lines.push(`📅 ${new Date().toLocaleDateString('pt-BR')}`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    lines.push('');
    lines.push(`*${i + 1}.* ${offer.title}`);

    if (offer.discountPercent > 0 && offer.originalPrice !== offer.currentPrice) {
      lines.push(`   ~${formatPrice(offer.originalPrice)}~ ➜ *${formatPrice(offer.currentPrice)}* (-${offer.discountPercent}%)`);
    } else {
      lines.push(`   *${formatPrice(offer.currentPrice)}*`);
    }

    if (offer.freeShipping) {
      lines.push('   🚚 Frete Grátis');
    }

    if (offer.productId) {
      lines.push(`   🔍 *Cole no buscador do ML:* ${offer.productId}`);
      lines.push(`   🔗 *Acesse:* ${offer.affiliateLink}`);
    } else {
      lines.push(`   ${getRandomLinkCta(true)} ${offer.affiliateLink}`);
    }

    if (i < offers.length - 1) {
      lines.push('');
      lines.push('─────────────────────');
    }
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  const igUsernameList = (process.env.INSTAGRAM_USERNAME || 'achadosmeli.bnu').replace(/^@/, '');
  const igHandleList = `@${igUsernameList}`;
  const igCleanUrlList = `instagram.com/${igUsernameList}`;

  lines.push('');
  lines.push('📲 *Siga nosso Instagram:*');
  lines.push(`👉 *${igHandleList}* (${igCleanUrlList})`);
  lines.push('');
  lines.push(getRandomFooterCta(true));

  return lines.join('\n');
}

/**
 * Formata ofertas de acordo com o formato configurado.
 */
export function formatOffers(
  offers: AffiliateOffer[],
  format: 'individual' | 'lista'
): string[] {
  if (format === 'lista') {
    return [formatOfferList(offers)];
  }

  return offers.map(formatIndividualOffer);
}
