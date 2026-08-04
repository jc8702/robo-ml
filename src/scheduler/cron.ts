import cron, { type ScheduledTask } from 'node-cron';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { AppConfig } from '../config/settings.js';
import { loadConfigAsync } from '../config/settings.js';
import { collectOffers } from '../collector/ml-api.js';
import { convertOffers } from '../affiliate/link-converter.js';
import { sendOfferWithPhoto, initWhatsAppClient } from '../whatsapp/client.js';
import { saveSentOffersToHistory } from '../collector/history.js';
import { postOffersToFacebookGroups } from '../facebook/fb-poster.js';
import { dbGetSettings } from '../db/index.js';

/** Referência do cron agendado para permitir cancelamento externo */
let scheduledTask: ScheduledTask | null = null;

/** Retorna a referência do cron ativo (para cancelamento via API) */
export function getScheduledTask(): ScheduledTask | null {
  return scheduledTask;
}

/** Para o cron agendado */
export function stopScheduler(): void {
  if (scheduledTask) {
    scheduledTask.stop();
    scheduledTask = null;
    console.log('[SCHEDULER] Agendador parado com sucesso.');
  }
}

export async function runAutomaticCycle(_configHint?: AppConfig): Promise<void> {
  // Recarrega config do Neon a cada ciclo para pegar alterações feitas pelo painel web
  const config = await loadConfigAsync();

  console.log(`\n[CRON] [${new Date().toLocaleTimeString('pt-BR')}] Iniciando ciclo automático de ofertas...`);

  const groupJid = process.env.WHATSAPP_GROUP_ID;

  const offers = await collectOffers(config.queries, config);

  if (offers.length === 0) {
    console.log('[CRON] Nenhuma oferta nova encontrada neste ciclo (ou todas já foram enviadas recentemente).');
    return;
  }

  console.log(`\n[CRON] ${offers.length} ofertas coletadas e preparadas.`);

  const affiliateOffers = await convertOffers(offers, config);

  // 1. Grava no Histórico Global (Neon DB + .sent-history.json) imediatamente após a coleta
  try {
    const historyPayload = affiliateOffers.map(offer => ({
      permalink: offer.permalink,
      title: offer.title,
      currentPrice: offer.currentPrice,
      originalPrice: offer.originalPrice,
      discountPercent: offer.discountPercent,
      imageUrl: offer.thumbnail,
    }));
    saveSentOffersToHistory(historyPayload);
    console.log(`[CRON] 💾 ${historyPayload.length} oferta(s) salvas no histórico global (Neon DB / .sent-history.json).`);
  } catch (histErr) {
    console.error('[CRON] Erro ao salvar histórico:', histErr);
  }

  // 2. Disparo para o WhatsApp (Isolado em try/catch)
  if (groupJid) {
    console.log(`\n📱 [WHATSAPP] Enviando ${affiliateOffers.length} ofertas para o grupo...`);
    try {
      let sentCount = 0;
      for (let i = 0; i < affiliateOffers.length; i++) {
        const offer = affiliateOffers[i];
        const sent = await sendOfferWithPhoto(offer, groupJid);
        if (sent) sentCount++;

        if (i < affiliateOffers.length - 1) {
          await new Promise((r) => setTimeout(r, 3000));
        }
      }
      console.log(`📱 [WHATSAPP] Concluído: ${sentCount} de ${affiliateOffers.length} ofertas enviadas com sucesso!`);
    } catch (waErr) {
      console.error('❌ [WHATSAPP] Erro na automação do WhatsApp:', waErr);
    }
  } else {
    console.log('⚠️ [WHATSAPP] WHATSAPP_GROUP_ID não configurado no .env. Pulando envio do WhatsApp e continuando para FB/IG...');
  }

  // 3. Postagem nos Grupos do Facebook (Isolado em try/catch)
  if (config.facebook && config.facebook.enabled && config.facebook.groupUrls.length > 0) {
    console.log('\n📘 [FACEBOOK] Iniciando postagem nos grupos do Facebook...');
    try {
      const fbResult = await postOffersToFacebookGroups(
        affiliateOffers,
        config.facebook.groupUrls,
        config.facebook.maxGroupsPerCycle,
        config.facebook.delayBetweenPostsSec,
        config.facebook.waGroupLink
      );
      console.log(`📘 [FACEBOOK] Concluído: ${fbResult.success} publicados, ${fbResult.failed} falharam.`);
    } catch (fbError) {
      console.error('❌ [FACEBOOK] Erro na automação do Facebook:', fbError);
    }
  } else if (config.facebook && config.facebook.enabled && config.facebook.groupUrls.length === 0) {
    console.log('⚠️ [FACEBOOK] Facebook habilitado mas nenhum grupo configurado. Adicione FB_GROUP_URLS no .env.');
  }

  // 4. Postagem no Instagram (Feed / Posts de Alto Impacto Orgânico) (Isolado em try/catch)
  if (config.instagram && config.instagram.enabled) {
    console.log('\n📸 [INSTAGRAM] Iniciando postagem automática no Instagram...');
    try {
      const { postOfferToInstagram } = await import('../instagram/ig-poster.js');
      const maxIg = config.instagram.maxPostsPerCycle || 3;
      const igOffers = affiliateOffers.slice(0, maxIg);
      let countIg = 0;
      for (const offer of igOffers) {
        const posted = await postOfferToInstagram(offer, {
          bioLink: config.instagram.bioLink,
          hashtags: config.instagram.customHashtags,
        });
        if (posted) countIg++;
        await new Promise((r) => setTimeout(r, 5000));
      }
      console.log(`📸 [INSTAGRAM] Concluído: ${countIg} de ${igOffers.length} ofertas publicadas no Instagram.`);
    } catch (igErr) {
      console.error('❌ [INSTAGRAM] Erro na automação do Instagram:', igErr);
    }
  }

  console.log(`\n[CRON] Ciclo concluído! Próximo envio agendado.\n`);
}

export async function startScheduler(config: AppConfig): Promise<void> {
  if (scheduledTask) {
    stopScheduler();
  }

  const dbSettings = await dbGetSettings();
  let cronExpression = dbSettings.AUTO_SCHEDULE_CRON || process.env.AUTO_SCHEDULE_CRON || '0 */3 * * *';

  if (!cron.validate(cronExpression)) {
    console.warn(`\n[CRON] Expressao Cron invalida: "${cronExpression}". Usando padrao "0 */3 * * *" (a cada 3 horas).`);
    cronExpression = '0 */3 * * *';
  }

  console.log('\n[SCHEDULER] Agendador Automatico Iniciado!');
  console.log(`[SCHEDULER] Frequencia (Cron): "${cronExpression}"`);
  const hasWaProfile = existsSync(join(process.cwd(), '.wa-profile'));
  const hasWaAuth = existsSync(join(process.cwd(), '.wa-auth', 'creds.json'));

  if (hasWaProfile) {
    console.log('[SCHEDULER] WhatsApp: Sessão Web Ativa (.wa-profile/)');
  } else if (hasWaAuth) {
    console.log('[SCHEDULER] WhatsApp: Conectando via Baileys...');
    await initWhatsAppClient().catch(() => {});
  } else {
    console.log('[SCHEDULER] WhatsApp: Nenhuma sessão pareada detectada. Dê dois cliques em Conectar-WhatsApp.bat para vincular.');
  }

  await runAutomaticCycle(config);

  // Guarda a referência para permitir cancelamento via stopScheduler()
  scheduledTask = cron.schedule(cronExpression, () => {
    runAutomaticCycle().catch((err) => {
      console.error('[CRON] Erro no ciclo automatico:', err);
    });
  });
}

