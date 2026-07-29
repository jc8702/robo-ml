import cron from 'node-cron';
import type { AppConfig } from '../config/settings.js';
import { collectOffers } from '../collector/ml-api.js';
import { convertOffers } from '../affiliate/link-converter.js';
import { sendOfferWithPhoto, initWhatsAppClient } from '../whatsapp/client.js';
import { saveSentOffersToHistory } from '../collector/history.js';
import { postOffersToFacebookGroups } from '../facebook/fb-poster.js';

/**
 * Executa um ciclo de coleta e envio automático de ofertas.
 * Envia para WhatsApp e, se configurado, também para grupos do Facebook.
 */
export async function runAutomaticCycle(config: AppConfig): Promise<void> {
  console.log(`\n⏰ [${new Date().toLocaleTimeString('pt-BR')}] Iniciando ciclo automático de ofertas...`);

  const groupJid = process.env.WHATSAPP_GROUP_ID;

  if (!groupJid) {
    console.error('❌ WHATSAPP_GROUP_ID não configurado no .env! O envio automático precisa do ID do grupo.');
    console.log('💡 Execute "npm run list-groups" para ver os IDs dos seus grupos.');
    return;
  }

  // 1. Coletar ofertas
  const offers = await collectOffers(config.queries, config);

  if (offers.length === 0) {
    console.log('😕 Nenhuma oferta nova encontrada neste ciclo (ou todas já foram enviadas recentemente).');
    return;
  }

  console.log(`\n✅ ${offers.length} ofertas coletadas. Enviando para o WhatsApp...`);

  // 2. Converter links para afiliados com URLs encurtadas
  const affiliateOffers = await convertOffers(offers, config);

  // 3. Enviar cada oferta com foto no grupo do WhatsApp
  const sentOffers: { permalink: string; title: string }[] = [];

  for (let i = 0; i < affiliateOffers.length; i++) {
    const offer = affiliateOffers[i];
    const sent = await sendOfferWithPhoto(offer, groupJid);
    if (sent) {
      sentOffers.push({ permalink: offer.permalink, title: offer.title });
    }

    // Pausa de 3 segundos entre envios para evitar floode / bloqueio
    if (i < affiliateOffers.length - 1) {
      await new Promise((r) => setTimeout(r, 3000));
    }
  }

  // Salva no histórico local para impedir repetição
  if (sentOffers.length > 0) {
    saveSentOffersToHistory(sentOffers);
  }

  console.log(`✨ WhatsApp: ${sentOffers.length} ofertas enviadas com sucesso!`);

  // 4. Postar nos grupos do Facebook (se habilitado)
  if (config.facebook.enabled && config.facebook.groupUrls.length > 0) {
    console.log('\n📘 Iniciando postagem nos grupos do Facebook...');
    try {
      const fbResult = await postOffersToFacebookGroups(
        affiliateOffers,
        config.facebook.groupUrls,
        config.facebook.maxGroupsPerCycle,
        config.facebook.delayBetweenPostsSec,
        config.facebook.waGroupLink
      );
      console.log(`📘 Facebook concluído: ${fbResult.success} publicados, ${fbResult.failed} falharam.`);
    } catch (fbError) {
      console.error('❌ Erro na automação do Facebook:', fbError);
      console.log('⚠️ WhatsApp foi enviado normalmente. Apenas o Facebook falhou.');
    }
  } else if (config.facebook.enabled && config.facebook.groupUrls.length === 0) {
    console.log('\n⚠️ Facebook habilitado mas nenhum grupo configurado. Adicione FB_GROUP_URLS no .env.');
  }

  console.log(`\n✨ Ciclo concluído! Próximo envio agendado.\n`);
}

/**
 * Inicia o agendador automático via Cron.
 */
export async function startScheduler(config: AppConfig): Promise<void> {
  let cronExpression = process.env.AUTO_SCHEDULE_CRON || '0 */3 * * *'; // A cada 3 horas por padrão

  if (!cron.validate(cronExpression)) {
    console.warn(`\n⚠️  Expressão Cron inválida: "${cronExpression}". Usando padrão "0 */3 * * *" (a cada 3 horas).`);
    cronExpression = '0 */3 * * *';
  }

  console.log('\n🤖 Agendador Automático Iniciado!');
  console.log(`📅 Frequência (Cron): "${cronExpression}"`);
  console.log(`📱 WhatsApp: Ativo`);
  console.log(`📘 Facebook: ${config.facebook.enabled ? `Ativo (${config.facebook.groupUrls.length} grupo(s))` : 'Desativado'}`);

  // Garante que o WhatsApp está conectado antes de iniciar o agendador
  await initWhatsAppClient();

  // Executa um ciclo imediato ao iniciar
  await runAutomaticCycle(config);

  // Agenda execuções recorrentes
  cron.schedule(cronExpression, () => {
    runAutomaticCycle(config).catch((err) => {
      console.error('❌ Erro no ciclo automático:', err);
    });
  });
}

