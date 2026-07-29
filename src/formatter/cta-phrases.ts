/**
 * Coleção de frases de engajamento e chamada para ação (CTA) de compra.
 * Cada link gerado terá uma frase randômica para engajar os clientes e incentivar o clique.
 */
const CTA_PHRASES: string[] = [
  '👉 Garanta o seu com desconto antes que acabe:',
  '🛒 Clique no link oficial e aproveite a promoção:',
  '⚡ Resgate esse preço exclusivo acessando:',
  '🔥 Confira todos os detalhes e garanta o seu:',
  '📲 Acesse o link para conferir no Mercado Livre:',
  '🎯 Estoque limitado! Aproveite clicando aqui:',
  '✨ Clique aqui para garantir a oferta especial:',
  '💣 Preço imbatível! Acesse o link para comprar:',
  '🛍️ Não perca essa oportunidade, compre pelo link:',
  '🚀 Garanta seu desconto exclusivo acessando:',
  '💎 Oferta especial por tempo limitado, confira:',
  '📦 Compre direto na loja oficial clicando aqui:',
  '🏷️ Clique e economize agora mesmo:',
  '⚡ Aproveite essa super promoção pelo link:',
  '📢 Tá valendo super a pena! Clique para ver:',
  '🎉 Preço top! Garanta a sua compra por este link:',
  '👇 Clique abaixo e aproveite o desconto de hoje:',
  '🎁 Oferta imperdível! Clique no link e garanta o seu:',
  '🔴 Desconto ativo! Clique aqui para comprar com segurança:',
  '🚨 Preço promocional por tempo limitado, confira:',
];

const FOOTER_CTA_PHRASES: string[] = [
  '⚡ Corre que a promoção pode acabar a qualquer momento!',
  '💡 Estoque limitado, aproveite o desconto enquanto dura!',
  '🔥 Clique no link e garanta o seu antes que esgoste!',
  '🚀 Promoção por tempo limitado na loja oficial!',
  '✨ Aproveite as melhores ofertas do dia antes que termine!',
];

const WA_GROUP_CTA_PHRASES: string[] = [
  '💬 Quer receber mais ofertas exclusivas como essa diariamente no seu WhatsApp? Entre no nosso grupo VIP:',
  '📱 Não perca nenhuma promoção! Faça parte do nosso grupo de ofertas no WhatsApp:',
  '🔥 Receba achadinhos e cupons em primeira mão! Acesse nosso grupo exclusivo:',
  '✨ As melhores ofertas do dia chegam antes no WhatsApp! Clique para entrar no grupo:',
  '🟢 Entre no nosso grupo do WhatsApp e receba alertas de menor preço todos os dias:',
  '🎯 Quer economizar de verdade? Faça parte do nosso grupo VIP de ofertas no WhatsApp:',
];

/**
 * Retorna uma frase de chamada para ação (CTA) randômica para o link.
 * @param isWhatsApp Se true, aplica a formatação com *negrito* do WhatsApp.
 */
export function getRandomLinkCta(isWhatsApp: boolean = false): string {
  const randomIndex = Math.floor(Math.random() * CTA_PHRASES.length);
  const phrase = CTA_PHRASES[randomIndex];

  if (isWhatsApp) {
    // Separa o emoji/ícone inicial do texto para colocar o texto em negrito
    const parts = phrase.split(' ');
    const icon = parts[0];
    const text = parts.slice(1).join(' ');
    return `${icon} *${text}*`;
  }

  return phrase;
}

/**
 * Retorna uma frase de rodapé randômica para finalizar a mensagem.
 * @param isWhatsApp Se true, aplica a formatação em _itálico_ do WhatsApp.
 */
export function getRandomFooterCta(isWhatsApp: boolean = false): string {
  const randomIndex = Math.floor(Math.random() * FOOTER_CTA_PHRASES.length);
  const phrase = FOOTER_CTA_PHRASES[randomIndex];

  if (isWhatsApp) {
    const parts = phrase.split(' ');
    const icon = parts[0];
    const text = parts.slice(1).join(' ');
    return `${icon} _${text}_`;
  }

  return phrase;
}

/**
 * Retorna uma chamada randômica para o grupo do WhatsApp (usado nas postagens do Facebook).
 * @param groupUrl Link de convite do grupo do WhatsApp
 */
export function getRandomWaGroupCta(groupUrl: string): string {
  const randomIndex = Math.floor(Math.random() * WA_GROUP_CTA_PHRASES.length);
  const phrase = WA_GROUP_CTA_PHRASES[randomIndex];
  return `${phrase}\n👉 ${groupUrl}`;
}
