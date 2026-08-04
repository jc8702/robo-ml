import type { AffiliateOffer } from '../affiliate/link-converter.js';

/**
 * Formata legenda de alto impacto para publicação no Instagram (Feed / Re-share)
 * Estruturada para engajamento orgânico com o algoritmo da Meta:
 * 1. Hook (Gancho visual chamativo)
 * 2. Título do produto + Preço em destaque + % Desconto
 * 3. Chamada de ação limpa (CTA: "Comente OFERTA" / "Link na Bio")
 * 4. Bloco de Hashtags de nicho para distribuição orgânica
 */
export function formatInstagramCaption(offer: AffiliateOffer, bioLink?: string, customHashtags?: string): string {
  const discountStr = offer.discountPercent > 0 ? `🔥 [${offer.discountPercent}% OFF]` : '🔥 SUPER OFERTA';
  const priceStr = offer.originalPrice 
    ? `De R$ ${offer.originalPrice.toFixed(2)} por apenas R$ ${offer.currentPrice.toFixed(2)}`
    : `Por apenas R$ ${offer.currentPrice.toFixed(2)}`;

  const hookOptions = [
    '🚨 ACHADINHO DA SEMANA EM PROMOÇÃO IMPERDÍVEL!',
    '😱 OLHA ESSE PREÇO! TÁ QUASE DE GRAÇA NO MERCADO LIVRE!',
    '⚡ OFERTA RELÂMPAGO! CORRE QUE VAI ACABAR RÁPIDO!',
    '💥 QUEM PROCURA QUALIDADE COM O MENOR PREÇO:',
    '🎁 ACHADO INCRÍVEL QUE VOCÊ PRECISA CONHECER:'
  ];

  // Seleciona um gancho dinâmico com base no hash do título
  const hookIndex = Math.abs(offer.title.split('').reduce((acc: number, char: string) => acc + char.charCodeAt(0), 0)) % hookOptions.length;
  const hook = hookOptions[hookIndex];

  const defaultHashtags = '#achadinhos #ofertas #mercadolivre #promocao #desconto #achadosdosdia #compras #achadosmercadolivre #cupom';
  const hashtags = customHashtags ? `${customHashtags} ${defaultHashtags}` : defaultHashtags;

  return `${hook}

🛒 ${offer.title}

${discountStr}
💰 ${priceStr}
🚚 Frete Rápido & Entrega Garantida!

👇 COMO GARANTIR O SEU:
1️⃣ Clique no LINK DA BIO para acessar o grupo VIP!
2️⃣ Ou comente "OFERTA" que te enviamos o link direto!
${bioLink ? `\n🔗 Link direto: ${bioLink}` : ''}

📌 Salve este post para não perder essa promoção!

.
.
${hashtags}`.trim();
}
