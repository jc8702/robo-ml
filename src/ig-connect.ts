import { openInstagramBrowser } from './instagram/ig-poster';

async function main() {
  console.log('====================================================');
  console.log('📸 GERENCIADOR DE AUTENTICAÇÃO DO INSTAGRAM');
  console.log('====================================================');
  console.log('Abrindo navegador Chrome dedicado para o Instagram...');
  console.log('Faça login na sua conta do Instagram no navegador que vai se abrir.');
  console.log('Sua sessão ficará salva em ".ig-profile/" para postagens automáticas.');
  console.log('====================================================\n');

  try {
    const context = await openInstagramBrowser();
    const page = context.pages()[0] || await context.newPage();
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded' });

    console.log('📌 O navegador está aberto. Após fazer login, você pode fechar esta janela.');
  } catch (err) {
    console.error('❌ Erro ao abrir navegador do Instagram:', err);
  }
}

main();
