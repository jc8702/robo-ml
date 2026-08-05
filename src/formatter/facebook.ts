import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { getRandomLinkCta, getRandomFooterCta, getRandomWaGroupCta } from './cta-phrases.js';
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
 * Gera o texto do comentário contendo o link do grupo do WhatsApp para ser postado logo após a publicação.
 */
export function formatFacebookWaComment(waGroupLink?: string): string {
  const linkToPromote = waGroupLink || process.env.FB_WA_GROUP_LINK || 'https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N';
  return getRandomWaGroupCta(linkToPromote);
}

/**
 * Gera texto de post para o Facebook para uma oferta individual.
 * O link do WhatsApp é removido do corpo do post e direcionado ao 1º comentário fixado.
 * Isso impede que o Facebook gere o cartão de prévia do WhatsApp e garante o destaque total da foto do produto.
 */
export function formatFacebookOffer(
  offer: AffiliateOffer,
  _waGroupLink?: string
): string {
  const lines: string[] = [];

  lines.push('🔥 OFERTA IMPERDÍVEL 🔥');
  lines.push('');
  lines.push(`📦 ${offer.title}`);
  lines.push('');

  if (offer.discountPercent > 0 && offer.originalPrice !== offer.currentPrice) {
    lines.push(`💰 De: ${formatPrice(offer.originalPrice)}`);
    lines.push(`🏷️ Por: ${formatPrice(offer.currentPrice)} (-${offer.discountPercent}%)`);
  } else {
    lines.push(`🏷️ Preço: ${formatPrice(offer.currentPrice)}`);
  }

  if (offer.isLowest30Days) {
    lines.push('📉 MENOR PREÇO DOS ÚLTIMOS 30 DIAS! 🔥');
  }

  if (offer.freeShipping) {
    lines.push('🚚 Frete Grátis!');
  }

  lines.push('');
  lines.push(`${getRandomLinkCta(false)} ${offer.affiliateLink}`);
  lines.push('');
  lines.push(getRandomFooterCta(false));
  lines.push('');
  lines.push(formatHashtagsLine(offer.title, 4));

  // Chamada direta para o 1º comentário onde está o link de divulgação do WhatsApp
  lines.push('');
  lines.push('👇 Grupo VIP de Ofertas e Cupons no primeiro comentário abaixo!');

  return lines.join('\n');
}

/**
 * Gera texto de post para o Facebook com lista de ofertas.
 */
export function formatFacebookOfferList(
  offers: AffiliateOffer[],
  _waGroupLink?: string
): string {
  const lines: string[] = [];

  lines.push('🛒 TOP OFERTAS DO DIA 🛒');
  lines.push(`📅 ${new Date().toLocaleDateString('pt-BR')}`);
  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');

  for (let i = 0; i < offers.length; i++) {
    const offer = offers[i];
    lines.push('');
    lines.push(`${i + 1}. ${offer.title}`);

    if (offer.discountPercent > 0 && offer.originalPrice !== offer.currentPrice) {
      lines.push(`   ${formatPrice(offer.originalPrice)} ➜ ${formatPrice(offer.currentPrice)} (-${offer.discountPercent}%)`);
    } else {
      lines.push(`   ${formatPrice(offer.currentPrice)}`);
    }

    if (offer.freeShipping) {
      lines.push('   🚚 Frete Grátis');
    }

    lines.push(`   ${getRandomLinkCta(false)} ${offer.affiliateLink}`);

    if (i < offers.length - 1) {
      lines.push('');
      lines.push('─────────────────────');
    }
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push(getRandomFooterCta(false));
  lines.push('');
  if (offers.length > 0) {
    lines.push(formatHashtagsLine(offers[0].title, 4));
  }

  lines.push('');
  lines.push('👇 Grupo VIP de Ofertas e Cupons no primeiro comentário abaixo!');

  return lines.join('\n');
}
