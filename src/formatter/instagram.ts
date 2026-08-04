import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { formatHashtagsLine } from './hashtag-generator.js';

function formatPrice(value: number): string {
  return value.toLocaleString('pt-BR', {
    style: 'currency',
    currency: 'BRL',
  });
}

/**
 * Formata legenda de alto impacto para publicação no Instagram (Feed / Re-share)
 * Estruturada para engajamento orgânico com o algoritmo da Meta.
 */
export function formatInstagramCaption(
  offer: AffiliateOffer,
  bioLink?: string,
  customHashtags?: string,
  triggerWord: string = 'PASSE'
): string {
  const discountStr = offer.discountPercent > 0 ? `🔥 [${offer.discountPercent}% OFF]` : '🔥 SUPER OFERTA';
  const priceLines = offer.discountPercent > 0 && offer.originalPrice !== offer.currentPrice
    ? `💰 De: ~${formatPrice(offer.originalPrice)}~\n🏷️ Por apenas: *${formatPrice(offer.currentPrice)}* (-${offer.discountPercent}%)`
    : `💰 Preço: *${formatPrice(offer.currentPrice)}*`;

  const lowest30DaysStr = offer.isLowest30Days ? '\n📉 *MENOR PREÇO DOS ÚLTIMOS 30 DIAS!* 🔥' : '';
  const shippingStr = offer.freeShipping ? '🚚 *Frete Grátis!*' : '🚚 *Frete Rápido & Entrega Garantida!*';

  const hookOptions = [
    '🚨 ACHADINHO DA SEMANA EM PROMOÇÃO IMPERDÍVEL!',
    '😱 OLHA ESSE PREÇO! TÁ QUASE DE GRAÇA NO MERCADO LIVRE!',
    '⚡ OFERTA RELÂMPAGO! CORRE QUE VAI ACABAR RÁPIDO!',
    '💥 QUEM PROCURA QUALIDADE COM O MENOR PREÇO:',
    '🎁 ACHADO INCRÍVEL QUE VOCÊ PRECISA CONHECER:'
  ];

  const hookIndex = Math.abs(offer.title.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0)) % hookOptions.length;
  const hook = hookOptions[hookIndex];

  const productTags = formatHashtagsLine(offer.title, 5);
  const defaultHashtags = '#achadinhos #ofertas #mercadolivre #promocao #desconto';
  const hashtags = customHashtags ? `${productTags} ${customHashtags}` : `${productTags} ${defaultHashtags}`;

  const affiliateUrl = offer.affiliateLink || offer.permalink;
  const trigger = (triggerWord || 'PASSE').toUpperCase();

  return `${hook}

🛒 ${offer.title}

${discountStr}
${priceLines}${lowest30DaysStr}
${shippingStr}

💬 *COMO RECEBER O LINK COM DESCONTO:*
👉 Comente "${trigger}" neste post que te envio o link direto no seu DIRECT! 📥

🔗 Ou acesse pelo link oficial: ${affiliateUrl}
${bioLink ? `🔗 Link da Bio: ${bioLink}` : ''}

📌 Salve este post para não perder essa promoção!

.
.
${hashtags}`.trim();
}
