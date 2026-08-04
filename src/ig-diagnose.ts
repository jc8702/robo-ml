import { chromium } from 'playwright-core';
import { resolve } from 'node:path';
import { existsSync, unlinkSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { findBrowserPath, isCloudEnvironment } from './config/browser.js';

const IG_PROFILE_DIR = resolve(process.cwd(), '.ig-profile');

// Limpa locks
const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
for (const f of lockFiles) {
  const p = resolve(IG_PROFILE_DIR, f);
  if (existsSync(p)) { try { unlinkSync(p); } catch {} }
}

try {
  execSync('powershell -NoProfile -ExecutionPolicy Bypass -File kill-ig-chrome.ps1', { stdio: 'ignore', cwd: process.cwd() });
} catch {}

await new Promise(r => setTimeout(r, 2000));

const executablePath = findBrowserPath();
const isCloud = isCloudEnvironment();

const opts: any = {
  headless: isCloud,
  viewport: { width: 1280, height: 900 },
  userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
  args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-notifications', '--disable-blink-features=AutomationControlled'],
};
if (executablePath && !isCloud) opts.executablePath = executablePath;

console.log('Abrindo navegador com perfil .ig-profile ...');
const context = await chromium.launchPersistentContext(IG_PROFILE_DIR, opts);
const page = context.pages()[0] || await context.newPage();

console.log('Navegando para instagram.com...');
await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
await new Promise(r => setTimeout(r, 5000));

// Fecha pop-ups
for (const txt of ['Agora não', 'Not Now', 'Permitir todos os cookies', 'Allow all cookies', 'Accept', 'Aceitar']) {
  const btn = page.locator(`button:has-text("${txt}")`).first();
  if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
    await btn.click().catch(() => {});
    await new Promise(r => setTimeout(r, 1500));
  }
}

await page.screenshot({ path: 'ig-diag-1-feed.png', fullPage: false });
console.log('Screenshot 1 salvo: ig-diag-1-feed.png');

// Verifica login
const isLoggedOut = await page.locator('input[name="username"]').isVisible({ timeout: 2000 }).catch(() => false);
if (isLoggedOut) {
  console.log('❌ NÃO ESTÁ LOGADO! Precisa fazer login primeiro.');
  await context.close();
  process.exit(1);
}

console.log('✅ Está logado!');

// Dump de todos os links/botões da sidebar
const sidebarItems = await page.evaluate(() => {
  const items: string[] = [];
  document.querySelectorAll('a, div[role="button"], span, svg').forEach(el => {
    const text = (el as HTMLElement).innerText?.trim() || '';
    const ariaLabel = el.getAttribute('aria-label') || '';
    const role = el.getAttribute('role') || '';
    const tag = el.tagName;
    if (text.toLowerCase().includes('criar') || text.toLowerCase().includes('create') || 
        ariaLabel.toLowerCase().includes('criar') || ariaLabel.toLowerCase().includes('create') ||
        ariaLabel.toLowerCase().includes('nova') || ariaLabel.toLowerCase().includes('new post')) {
      const rect = el.getBoundingClientRect();
      items.push(`${tag} | text="${text}" | aria="${ariaLabel}" | role="${role}" | pos=(${Math.round(rect.x)},${Math.round(rect.y)}) | size=${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
  });
  return items;
});

console.log('\n🔍 Elementos "Criar/Create" encontrados:');
sidebarItems.forEach(item => console.log('  ', item));

// Tenta clicar no Criar via evaluate
console.log('\n🖱️ Clicando em "Criar"...');
const clicked = await page.evaluate(() => {
  const allLinks = Array.from(document.querySelectorAll('a'));
  for (const a of allLinks) {
    if (a.textContent?.trim().includes('Criar') || a.textContent?.trim().includes('Create')) {
      (a as HTMLElement).click();
      return `Clicou em: <a> "${a.textContent?.trim()}" href="${a.getAttribute('href')}"`;
    }
  }
  // SVG fallback
  const svgs = Array.from(document.querySelectorAll('svg'));
  for (const svg of svgs) {
    const label = svg.getAttribute('aria-label') || '';
    if (label.includes('Criar') || label.includes('Create') || label.includes('Nova')) {
      const parent = svg.closest('a') || svg.closest('div[role="button"]') || svg.parentElement;
      if (parent) {
        (parent as HTMLElement).click();
        return `Clicou em parent de SVG aria="${label}"`;
      }
    }
  }
  return 'NÃO ENCONTROU elemento Criar';
});
console.log('Resultado:', clicked);

await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: 'ig-diag-2-after-criar.png', fullPage: false });
console.log('\nScreenshot 2 salvo: ig-diag-2-after-criar.png');

// Dump de todos os novos elementos visíveis
const afterElements = await page.evaluate(() => {
  const items: string[] = [];
  // Procura dialogs, modals, menus, popovers
  document.querySelectorAll('div[role="dialog"], div[role="menu"], div[role="listbox"], div[role="presentation"], [data-testid], div[style*="position: fixed"], div[style*="z-index"]').forEach(el => {
    const role = el.getAttribute('role') || '';
    const text = (el as HTMLElement).innerText?.substring(0, 200) || '';
    const rect = el.getBoundingClientRect();
    items.push(`${el.tagName} | role="${role}" | text="${text.replace(/\n/g, ' ').substring(0, 100)}" | pos=(${Math.round(rect.x)},${Math.round(rect.y)}) size=${Math.round(rect.width)}x${Math.round(rect.height)}`);
  });
  // Look for spans that say "Publicação" or "Post"
  document.querySelectorAll('span').forEach(el => {
    const text = el.textContent?.trim() || '';
    if (text === 'Publicação' || text === 'Post' || text === 'Vídeo do Reels' || text === 'Reel') {
      const rect = el.getBoundingClientRect();
      items.push(`SPAN-OPTION | text="${text}" | pos=(${Math.round(rect.x)},${Math.round(rect.y)}) size=${Math.round(rect.width)}x${Math.round(rect.height)}`);
    }
  });
  return items;
});

console.log('\n🔍 Elementos após clicar em Criar:');
afterElements.forEach(item => console.log('  ', item));

// Se há opção "Publicação", clica nela
const pubClicked = await page.evaluate(() => {
  const spans = Array.from(document.querySelectorAll('span'));
  for (const s of spans) {
    if (s.textContent?.trim() === 'Publicação' || s.textContent?.trim() === 'Post') {
      (s as HTMLElement).click();
      return `Clicou em span "${s.textContent?.trim()}"`;
    }
  }
  return 'NÃO ENCONTROU Publicação/Post';
});
console.log('\nResultado Publicação:', pubClicked);

await new Promise(r => setTimeout(r, 3000));
await page.screenshot({ path: 'ig-diag-3-after-publicacao.png', fullPage: false });
console.log('\nScreenshot 3 salvo: ig-diag-3-after-publicacao.png');

// Verifica modal final
const finalElements = await page.evaluate(() => {
  const items: string[] = [];
  document.querySelectorAll('div[role="dialog"], div[role="presentation"], input[type="file"], button').forEach(el => {
    const role = el.getAttribute('role') || '';
    const text = (el as HTMLElement).innerText?.substring(0, 100) || '';
    const type = el.getAttribute('type') || '';
    const tag = el.tagName;
    const rect = el.getBoundingClientRect();
    if (tag === 'INPUT' && type === 'file') {
      items.push(`INPUT[type=file] | accept="${el.getAttribute('accept')}" | pos=(${Math.round(rect.x)},${Math.round(rect.y)})`);
    } else if (role === 'dialog' || role === 'presentation') {
      items.push(`${tag} | role="${role}" | text="${text.replace(/\n/g, ' ').substring(0, 80)}" | size=${Math.round(rect.width)}x${Math.round(rect.height)}`);
    } else if (text.includes('Selecionar') || text.includes('Select') || text.includes('computador') || text.includes('computer') || text.includes('Compartilhar') || text.includes('Share')) {
      items.push(`BUTTON | text="${text.replace(/\n/g, ' ').substring(0, 80)}" | pos=(${Math.round(rect.x)},${Math.round(rect.y)})`);
    }
  });
  return items;
});

console.log('\n🔍 Modal final:');
finalElements.forEach(item => console.log('  ', item));

await context.close();
console.log('\n✅ Diagnóstico concluído!');
