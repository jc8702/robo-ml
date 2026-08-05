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
  waGroupLink?: string
): string {
  const lines: string[] = [];
  const rawGroupUrl = waGroupLink || process.env.FB_WA_GROUP_LINK || 'https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N';
  // Remove https:// para impedir que o Facebook puxar imagem do WhatsApp no lugar da foto do produto
  const cleanGroupUrl = rawGroupUrl.replace(/^https?:\/\//, '');
  const igHandle = '@achadosdomeli.bnu';
  const igCleanUrl = 'instagram.com/achadosdomeli.bnu';

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
  } else {
    lines.push('🚚 Frete Rápido & Entrega Garantida!');
  }

  lines.push('');
  lines.push(getRandomLinkCta(false));

  if (offer.productId) {
    lines.push('');
    lines.push(`🔍 Cole este texto no buscador do Mercado Livre: ${offer.productId}`);
    lines.push('');
    lines.push(`🔗 Ou acesse o link: ${offer.affiliateLink || offer.permalink}`);
  } else {
    lines.push(offer.affiliateLink || offer.permalink);
  }

  lines.push('');
  lines.push('💬 Entre no nosso grupo VIP de ofertas no WhatsApp:');
  lines.push(`👉 ${cleanGroupUrl}`);

  lines.push('');
  lines.push('📲 Siga nosso perfil oficial no Instagram:');
  lines.push(`👉 ${igHandle} (${igCleanUrl})`);

  lines.push('');
  lines.push(getRandomFooterCta(false));
  lines.push('');
  lines.push(formatHashtagsLine(offer.title, 4));

  return lines.join('\n');
}

/**
 * Gera texto de post para o Facebook com lista de ofertas.
 */
export function formatFacebookOfferList(
  offers: AffiliateOffer[],
  waGroupLink?: string
): string {
  const lines: string[] = [];
  const rawGroupUrl = waGroupLink || process.env.FB_WA_GROUP_LINK || 'https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N';
  const cleanGroupUrl = rawGroupUrl.replace(/^https?:\/\//, '');
  const igHandle = '@achadosdomeli.bnu';
  const igCleanUrl = 'instagram.com/achadosdomeli.bnu';

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

    if (offer.productId) {
      lines.push(`   🔍 Cole no buscador do ML: ${offer.productId}`);
      lines.push(`   🔗 Acesse: ${offer.affiliateLink}`);
    } else {
      lines.push(`   ${getRandomLinkCta(false)} ${offer.affiliateLink}`);
    }

    if (i < offers.length - 1) {
      lines.push('');
      lines.push('─────────────────────');
    }
  }

  lines.push('');
  lines.push('━━━━━━━━━━━━━━━━━━━━━━');
  lines.push('');
  lines.push('💬 Entre no nosso grupo VIP de ofertas no WhatsApp:');
  lines.push(`👉 ${cleanGroupUrl}`);
  lines.push('');
  lines.push('📲 Siga nosso perfil oficial no Instagram:');
  lines.push(`👉 ${igHandle} (${igCleanUrl})`);
  lines.push('');
  lines.push(getRandomFooterCta(false));
  lines.push('');
  if (offers.length > 0) {
    lines.push(formatHashtagsLine(offers[0].title, 4));
  }

  return lines.join('\n');
}
