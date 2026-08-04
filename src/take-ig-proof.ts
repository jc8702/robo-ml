import { openInstagramBrowser } from './instagram/ig-poster.js';
import { copyFileSync } from 'node:fs';
import { join } from 'node:path';

async function takeIgProfileProof() {
  console.log('📸 Acessando o perfil do Instagram para capturar a grade de postagens...');
  const context = await openInstagramBrowser();
  const page = context.pages()[0] || await context.newPage();

  // Acessa a página do perfil
  await page.goto('https://www.instagram.com/clickmarido/', { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(4000);

  const localProofPath = join(process.cwd(), 'ig_profile_posts.png');
  await page.screenshot({ path: localProofPath, fullPage: false });
  console.log(`✅ Print do perfil salvo em: ${localProofPath}`);

  const artifactDir = 'C:\\Users\\jc-pr\\.gemini\\antigravity-ide\\brain\\fff040e8-8c96-4903-bf8f-43e76e201eba';
  const artifactProofPath = join(artifactDir, 'ig_profile_posts.png');
  copyFileSync(localProofPath, artifactProofPath);
  console.log(`✅ Print copiado para artefatos: ${artifactProofPath}`);
}

takeIgProfileProof().catch(console.error);
