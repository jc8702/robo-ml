import { openInstagramBrowser, saveIgCookiesToDb } from './instagram/ig-poster.js';

async function main() {
  console.log('====================================================');
  console.log('📸 GERENCIADOR DE AUTENTICAÇÃO DO INSTAGRAM');
  console.log('====================================================');
  console.log('Abrindo navegador Chrome dedicado para o Instagram...');
  console.log('Faça login na sua conta do Instagram no navegador que vai se abrir.');
  console.log('Sua sessão ficará salva em ".ig-profile/" e no Neon DB Cloud para o Render.');
  console.log('====================================================\n');

  try {
    const context = await openInstagramBrowser();
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });

    console.log('📌 O navegador está aberto. Faça seu login normalmente.');
    console.log('⏳ Monitorando a janela para salvar seus cookies no Neon DB Cloud...');

    for (let i = 0; i < 36; i++) {
      await new Promise((r) => setTimeout(r, 5000));
      if (!page.isClosed()) {
        await saveIgCookiesToDb(context);
      } else {
        break;
      }
    }
    console.log('✅ Sessão do Instagram sincronizada com o Neon DB!');
  } catch (err) {
    console.error('❌ Erro ao abrir navegador do Instagram:', err);
  }
}

main();
