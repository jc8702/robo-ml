import { resolve } from 'node:path';
import { loadConfig } from './config/settings.js';
import { collectOffers } from './collector/ml-api.js';
import { convertOffers } from './affiliate/link-converter.js';
import { formatOffers } from './formatter/whatsapp.js';
import { copyToClipboard, saveToFile, printPreview } from './output/clipboard.js';
import { saveSentOffersToHistory } from './collector/history.js';
import { initDb } from './db/index.js';
import { startScheduler } from './scheduler/cron.js';

/**
 * ML Ofertas Bot — Entry Point
 *
 * Uso:
 *   npm run ofertas                         → Usa queries do .env (manual/clipboard)
 *   npm run ofertas:query "fone bluetooth"  → Busca específica (manual/clipboard)
 *   npm run auto                            → Modo Automação 24/7 (envio direto no grupo do WhatsApp)
 */
async function main(): Promise<void> {
  console.log('\n🛒 ML Ofertas Bot v1.1 (Com Envio de Fotos + Automação)');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // Inicializa o banco de dados Neon/PostgreSQL se DATABASE_URL estiver configurada
  const dbConnected = await initDb();
  if (dbConnected) {
    console.log('🐘 Conectado ao Neon PostgreSQL com sucesso!\n');
  }

  // 1. Carregar configuração
  const config = loadConfig();
  const cliArgs = process.argv.slice(2);

  // Modo Automático 24/7
  if (cliArgs.includes('--auto')) {
    await startScheduler(config);
    return;
  }

  // 2. Determinar queries (CLI ou .env)
  let queries: string[];

  if (cliArgs.includes('--query') || cliArgs.includes('-q')) {
    const queryIndex = cliArgs.indexOf('--query') !== -1
      ? cliArgs.indexOf('--query')
      : cliArgs.indexOf('-q');
    const queryValue = cliArgs[queryIndex + 1];

    if (!queryValue) {
      console.error('❌ Uso: npm run ofertas:query "sua busca aqui"');
      process.exit(1);
    }

    queries = [queryValue];
  } else if (cliArgs.length > 0 && !cliArgs[0].startsWith('-')) {
    queries = [cliArgs.join(' ')];
  } else {
    queries = config.queries;
  }

  console.log(`📋 Queries: ${queries.join(', ')}`);
  console.log(`🔧 Filtros: desconto ≥ ${config.filters.minDiscount}%, preço ${config.filters.minPrice}-${config.filters.maxPrice} BRL`);
  console.log(`📊 Máximo: ${config.filters.maxResults} ofertas\n`);

  // 3. Coletar ofertas
  const offers = await collectOffers(queries, config);

  if (offers.length === 0) {
    console.log('\n😕 Nenhuma oferta encontrada com os filtros atuais.');
    console.log('💡 Tente reduzir ML_MIN_DISCOUNT ou aumentar ML_MAX_PRICE no .env');
    return;
  }

  console.log(`\n✅ ${offers.length} oferta(s) encontrada(s)!\n`);

  // 4. Converter para links de afiliado encurtados
  const affiliateOffers = await convertOffers(offers, config);

  // 5. Formatar mensagens
  const messages = formatOffers(affiliateOffers, config.output.format);

  // 6. Exibir preview
  await printPreview(messages);

  // 7. Salvar em arquivo
  const outputDir = resolve(process.cwd(), 'output');
  const filepath = await saveToFile(messages, outputDir);
  console.log(`\n💾 Salvo em: ${filepath}`);

  // 8. Copiar para clipboard
  if (config.output.autoClipboard && messages.length > 0) {
    const textToCopy = messages.join('\n\n');
    const copied = await copyToClipboard(textToCopy);

    if (copied) {
      console.log('📋 Copiado para o clipboard! Cole no WhatsApp com Ctrl+V');
    }
  }

  // 9. Registrar no histórico local
  if (affiliateOffers.length > 0) {
    saveSentOffersToHistory(affiliateOffers.map((o) => ({ permalink: o.permalink, title: o.title })));
  }

  console.log('\n✨ Pronto! Agora é só colar no grupo do WhatsApp.');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

main().catch((error) => {
  console.error('❌ Erro fatal:', error);
  process.exit(1);
});
