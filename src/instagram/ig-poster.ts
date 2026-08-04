import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { resolve, join } from 'node:path';
import { existsSync, mkdirSync, unlinkSync, writeFileSync, readFileSync } from 'node:fs';
import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { formatInstagramCaption } from '../formatter/instagram.js';
import { findBrowserPath, isCloudEnvironment } from '../config/browser.js';

export const IG_PROFILE_DIR = resolve(process.cwd(), '.ig-profile');
const TEMP_IMG_DIR = resolve(process.cwd(), '.ig-temp-images');

if (!existsSync(IG_PROFILE_DIR)) {
  mkdirSync(IG_PROFILE_DIR, { recursive: true });
}
if (!existsSync(TEMP_IMG_DIR)) {
  mkdirSync(TEMP_IMG_DIR, { recursive: true });
}

import { execSync } from 'node:child_process';

function cleanProfileLock(profileDir: string) {
  try {
    const folderName = profileDir.split(/[\\/]/).pop();
    if (folderName) {
      const psCommand = `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"name='chrome.exe'\\" | Where-Object CommandLine -like '*${folderName}*' | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"`;
      execSync(psCommand, { stdio: 'ignore' });
      try {
        execSync('timeout /t 1 /nobreak > nul', { stdio: 'ignore' });
      } catch {}
    }
  } catch {}

  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
  for (const lockFile of lockFiles) {
    const lockPath = join(profileDir, lockFile);
    if (existsSync(lockPath)) {
      try {
        unlinkSync(lockPath);
      } catch {}
    }
  }
}

let activeIgContext: BrowserContext | null = null;

import { getDbPool } from '../db/index.js';

export async function restoreIgCookiesFromDb(context: BrowserContext): Promise<boolean> {
  const db = getDbPool();
  if (!db) return false;
  try {
    const res = await db.query("SELECT value FROM app_settings WHERE key = 'IG_COOKIES_JSON'");
    if (res.rows.length > 0 && res.rows[0].value) {
      const cookies = JSON.parse(res.rows[0].value);
      if (Array.isArray(cookies) && cookies.length > 0) {
        await context.addCookies(cookies);
        console.log(`[IG] 🔑 ${cookies.length} cookie(s) do Instagram restaurados do Neon PostgreSQL.`);
        return true;
      }
    }
  } catch (err) {
    console.error('[IG] Erro ao restaurar cookies do DB:', err);
  }
  return false;
}

export async function saveIgCookiesToDb(context: BrowserContext): Promise<void> {
  const db = getDbPool();
  if (!db) return;
  try {
    const cookies = await context.cookies('https://www.instagram.com');
    if (cookies && cookies.length > 0) {
      const json = JSON.stringify(cookies);
      await db.query(
        `INSERT INTO app_settings (key, value) VALUES ('IG_COOKIES_JSON', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [json]
      );
      console.log(`[IG] 💾 ${cookies.length} cookie(s) do Instagram salvos no Neon PostgreSQL.`);
    }
  } catch (err) {
    console.error('[IG] Erro ao salvar cookies no DB:', err);
  }
}

export async function openInstagramBrowser(): Promise<BrowserContext> {
  if (activeIgContext && activeIgContext.pages().length > 0) {
    try {
      const pages = activeIgContext.pages();
      if (pages.length > 0 && !pages[0].isClosed()) {
        return activeIgContext;
      }
    } catch {
      activeIgContext = null;
    }
  }

  const executablePath = findBrowserPath();
  const isCloud = isCloudEnvironment();

  cleanProfileLock(IG_PROFILE_DIR);

  const contextOptions: any = {
    headless: isCloud,
    viewport: { width: 1280, height: 900 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-notifications',
      '--disable-blink-features=AutomationControlled',
    ],
  };

  if (executablePath && !isCloud) {
    contextOptions.executablePath = executablePath;
  }

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(IG_PROFILE_DIR, contextOptions);
  } catch (launchErr) {
    console.warn('[IG] Aviso ao abrir com Chrome do sistema. Tentando expurgar lock e relançar...', launchErr);
    cleanProfileLock(IG_PROFILE_DIR);
    delete contextOptions.executablePath;
    context = await chromium.launchPersistentContext(IG_PROFILE_DIR, contextOptions);
  }

  activeIgContext = context;
  await restoreIgCookiesFromDb(context);
  return context;
}

function randomDelay(minMs = 1500, maxMs = 3500): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function downloadOfferImage(imageUrl: string): Promise<string | null> {
  try {
    const res = await fetch(imageUrl);
    if (!res.ok) return null;
    const arrayBuffer = await res.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);
    const fileName = `ig-img-${Date.now()}.jpg`;
    const filePath = join(TEMP_IMG_DIR, fileName);
    writeFileSync(filePath, buffer);
    return filePath;
  } catch (err) {
    console.error('[IG] Erro ao baixar imagem da oferta:', err);
    return null;
  }
}

import { IgApiClient } from 'instagram-private-api';
import { dbGetSettings, dbSaveMultipleSettings } from '../db/index.js';

export async function postViaPrivateApi(
  imagePath: string,
  captionText: string,
  username: string,
  password?: string
): Promise<{ success: boolean; error?: string }> {
  const dbSettings = await dbGetSettings().catch(() => ({} as Record<string, string>));
  const pwd = password || process.env.INSTAGRAM_PASSWORD || dbSettings.INSTAGRAM_PASSWORD;
  const user = username || process.env.INSTAGRAM_USERNAME || dbSettings.INSTAGRAM_USERNAME || 'clickmarido';

  if (!pwd) {
    console.log('[IG API] ⚠️ INSTAGRAM_PASSWORD não informada. Preencha a senha no Painel Web (Automação Instagram).');
    return { success: false, error: 'Senha do Instagram não informada' };
  }

  const ig = new IgApiClient();
  ig.state.generateDevice(user);

  // Restaura estado de sessão anterior salvo no Neon DB
  if (dbSettings.IG_SESSION_STATE_JSON) {
    try {
      await ig.state.deserialize(dbSettings.IG_SESSION_STATE_JSON);
      console.log('[IG API] 🔑 Sessão do Instagram restaurada do Neon PostgreSQL.');
    } catch {
      /* recria sessão em caso de expiração */
    }
  }

  // Listener para salvar automaticamente o estado da sessão no banco
  ig.request.end$.subscribe(async () => {
    try {
      const serialized = await ig.state.serialize();
      delete serialized.constants;
      await dbSaveMultipleSettings({ IG_SESSION_STATE_JSON: JSON.stringify(serialized) });
    } catch {}
  });

  try {
    console.log(`[IG API] 📲 Autenticando conta @${user} na API do Instagram...`);
    await ig.account.login(user, pwd);

    console.log('[IG API] 📤 Enviando foto HD e legenda para o Feed do Instagram...');
    const fileBuffer = readFileSync(imagePath);

    const publishResult = await ig.publish.photo({
      file: fileBuffer,
      caption: captionText,
    });

    console.log(`[IG API] ✅ Post publicado com sucesso no Instagram! ID da Mídia: ${publishResult.media.id}`);
    return { success: true };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error('[IG API] ❌ Erro na publicação via API Mobile:', errMsg);
    return { success: false, error: errMsg };
  }
}

/**
 * Publica uma oferta no Instagram (Feed / Post com Foto)
 */
export async function postOfferToInstagram(
  offer: AffiliateOffer,
  options?: { bioLink?: string; hashtags?: string; username?: string; password?: string }
): Promise<{ success: boolean; error?: string }> {
  console.log(`\n📸 [INSTAGRAM] Iniciando postagem da oferta: "${offer.title.slice(0, 40)}..."`);
  let localImagePath: string | null = null;
  let apiError = '';

  try {
    // 1. Baixa a foto do produto em HD
    if (offer.thumbnail) {
      localImagePath = await downloadOfferImage(offer.thumbnail);
    }

    if (!localImagePath || !existsSync(localImagePath)) {
      console.log('  ⚠️ Não foi possível obter imagem em HD para o Instagram. Pulando postagem.');
      return { success: false, error: 'Imagem em HD indisponível' };
    }

    const captionText = formatInstagramCaption(offer, options?.bioLink, options?.hashtags);
    const dbSettings = await dbGetSettings().catch(() => ({} as Record<string, string>));
    const username = options?.username || process.env.INSTAGRAM_USERNAME || dbSettings.INSTAGRAM_USERNAME || 'clickmarido';
    const password = options?.password || process.env.INSTAGRAM_PASSWORD || dbSettings.INSTAGRAM_PASSWORD;

    // TENTA PRIMEIRO VIA API MOBILE OFICIAL (Mais rápido, 100% confiável no Render Cloud)
    if (password) {
      console.log('  ⚡ Tentando envio direto via API do Instagram...');
      const apiResult = await postViaPrivateApi(localImagePath, captionText, username, password);
      if (apiResult.success) {
        return { success: true };
      }
      apiError = apiResult.error || 'Falha na API Mobile';
      console.log(`  ⚠️ Envio via API falhou (${apiError}). Tentando fallback via navegador Playwright...`);
    }

    const context = await openInstagramBrowser();
    const page = context.pages()[0] || await context.newPage();

    // 2. Navega para o Instagram
    console.log('  📷 Acessando Instagram...');
    await page.goto('https://www.instagram.com/', { waitUntil: 'domcontentloaded', timeout: 45000 });
    await randomDelay(3000, 5000);

    // Trata popups de Cookies e "Agora não"
    const cookieBtn = page.locator('button:has-text("Allow all cookies"), button:has-text("Permitir todos os cookies"), button:has-text("Aceitar"), button:has-text("Accept")').first();
    if (await cookieBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await cookieBtn.click().catch(() => {});
      await randomDelay(1000, 2000);
    }

    const notNowBtn = page.locator('button:has-text("Agora não"), button:has-text("Not Now"), button:has-text("Salvar informações")').first();
    if (await notNowBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
      await notNowBtn.click().catch(() => {});
      await randomDelay(1000, 2000);
    }

    // Verifica se está logado
    const currentUrl = page.url();
    const hasLoginForm = await page.locator('input[name="username"], input[name="password"], form#loginForm').isVisible({ timeout: 4000 }).catch(() => false);
    const isLoggedOut = currentUrl.includes('/accounts/login') || hasLoginForm;

    if (isLoggedOut) {
      console.log('');
      console.log('  ╔═══════════════════════════════════════════════════╗');
      console.log('  ║  🆕 LOGIN NO INSTAGRAM NECESSÁRIO                 ║');
      console.log('  ║                                                   ║');
      console.log('  ║  O navegador abriu no Instagram. Faça seu login:  ║');
      console.log('  ║  1. Digite seu usuário/e-mail e senha             ║');
      console.log('  ║  2. Complete a verificação 2FA (se ativada)       ║');
      console.log('  ║  3. A automação continuará automaticamente!       ║');
      console.log('  ║                                                   ║');
      console.log('  ║  ⏱️  Aguardando até 3 minutos pelo login...        ║');
      console.log('  ╚═══════════════════════════════════════════════════╝');
      console.log('');

      try {
        await page.waitForSelector('svg[aria-label="Nova publicação"], svg[aria-label="New post"], svg[aria-label="Criar"], svg[aria-label="Create"], [aria-label="Nova publicação"], a[href*="create"], a[href*="/explore/"]', {
          timeout: 180000,
        });
        console.log('  ✅ Login no Instagram detectado com sucesso!');
        await randomDelay(3000, 5000);
      } catch {
        console.log('  ⏰ Tempo esgotado para login no Instagram. Pulando postagem.');
        return { success: false, error: 'Sessão do Instagram não está logada no navegador' };
      }
    }

    // Trata popups adicionais de Notificações / Informações de login se presentes
    const popupCloseSelectors = [
      'button:has-text("Agora não")',
      'button:has-text("Not Now")',
      'button:has-text("Salvar informações")',
      'button:has-text("Save Info")',
      'button:has-text("Cancelar")',
      'button:has-text("Cancel")'
    ];
    for (const sel of popupCloseSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 1500 }).catch(() => false)) {
          await btn.click({ force: true }).catch(() => {});
          await randomDelay(1000, 1500);
        }
      } catch {}
    }

    // 3. Clica no botão de Criar Nova Publicação (+ Criar) na barra lateral
    console.log('  ➕ Abrindo criador de nova publicação (+)...');
    let modalOpened = false;

    // Clica no link "Criar" / "Create" na sidebar
    try {
      const linkEl = page.locator('a:has-text("Criar"), a:has-text("Create")').first();
      if (await linkEl.isVisible({ timeout: 3000 }).catch(() => false)) {
        console.log('  🎯 Clicando no link Criar...');
        await linkEl.evaluate((el: HTMLElement) => el.click());
        await randomDelay(2000, 3000);
      }
    } catch {}

    // O submenu que abre tem "Postar", "Vídeo ao vivo", "Anúncio", "IA"
    // Precisa clicar em "Postar" / "Post" — usar page.getByText para exatidão
    try {
      // Tenta com getByText exato
      let postClicked = false;
      for (const label of ['Postar', 'Post']) {
        const el = page.getByText(label, { exact: true }).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          console.log(`  📌 Clicando na opção "${label}"...`);
          const box = await el.boundingBox().catch(() => null);
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            postClicked = true;
            await randomDelay(2000, 3000);
            break;
          }
        }
      }
      if (!postClicked) {
        console.log('  ⚠️ Opção "Postar" não encontrada no submenu.');
      }
    } catch {}

    // Espera pelo dialog/modal — Instagram usa role="dialog" OU role="presentation"
    try {
      await page.waitForSelector('div[role="dialog"], div[role="presentation"]:has(input[type="file"]), div[role="presentation"]:has(button)', { timeout: 8000 });
      // Verifica se tem input[type="file"] ou botão "Selecionar do computador" como indicativo de modal de upload
      const hasFileInput = await page.locator('input[type="file"]').isVisible({ timeout: 2000 }).catch(() => false);
      const hasSelectBtn = await page.locator('button:has-text("Selecionar do computador"), button:has-text("Select from computer"), button:has-text("Selecionar"), button:has-text("Select")').first().isVisible({ timeout: 2000 }).catch(() => false);
      const hasDialog = await page.locator('div[role="dialog"]').isVisible().catch(() => false);
      
      if (hasFileInput || hasSelectBtn || hasDialog) {
        modalOpened = true;
        console.log(`  ✅ Modal de criação aberto! (fileInput=${hasFileInput}, selectBtn=${hasSelectBtn}, dialog=${hasDialog})`);
      }
    } catch {
      modalOpened = false;
    }

    if (!modalOpened) {
      await page.screenshot({ path: 'ig-debug.png', fullPage: true }).catch(() => {});
      console.log('  ⚠️ Não foi possível abrir o modal de criação no Instagram. Screenshot ig-debug.png salvo.');
      return { success: false, error: apiError || 'Não foi possível abrir modal de criação' };
    }

    await randomDelay(2000, 3500);

    // 4. Seleciona o arquivo de imagem do computador
    console.log('  🖼️ Selecionando arquivo de imagem...');
    await randomDelay(1000, 2000);

    let uploaded = false;

    // Método 1: setInputFiles no input[type="file"] visível na página
    try {
      const fileInput = page.locator('input[type="file"]').first();
      await fileInput.setInputFiles(localImagePath, { timeout: 10000 });
      uploaded = true;
      console.log('  ✅ Imagem carregada via setInputFiles!');
    } catch (err) {
      console.warn('  ⚠️ setInputFiles falhou, tentando clique no botão visual...');
    }

    // Método 2: filechooser ao clicar no botão "Selecionar do computador"
    if (!uploaded) {
      const selectBtn = page.locator('button:has-text("Selecionar do computador"), button:has-text("Select from computer"), button:has-text("Selecionar"), button:has-text("Select from")').first();
      if (await selectBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
        try {
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 10000 }),
            selectBtn.click()
          ]);
          if (fileChooser) {
            await fileChooser.setFiles(localImagePath);
            uploaded = true;
            console.log('  ✅ Imagem selecionada via filechooser!');
          }
        } catch (fcErr) {
          console.warn('  ⚠️ Filechooser falhou:', fcErr);
        }
      }
    }

    if (!uploaded) {
      await page.screenshot({ path: 'ig-debug-upload.png' }).catch(() => {});
      console.log('  ⚠️ Não foi possível carregar a imagem no Instagram. Screenshot ig-debug-upload.png salvo.');
      return { success: false, error: apiError || 'Não foi possível carregar a imagem' };
    }

    await randomDelay(3000, 5000);

    // 5. Clica em "Avançar" / "Next" (Corte/Proporção)
    console.log('  ➡️ Avançando tela de ajuste de foto...');
    for (const label of ['Avançar', 'Next']) {
      const el = page.getByText(label, { exact: true }).first();
      if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
        const box = await el.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          console.log(`  ✅ Clicou em "${label}" (Corte)`);
          await randomDelay(2000, 4000);
          break;
        }
      }
    }

    // 6. Clica em "Avançar" / "Next" (Filtros)
    console.log('  ➡️ Avançando tela de filtros...');
    for (const label of ['Avançar', 'Next']) {
      const el = page.getByText(label, { exact: true }).first();
      if (await el.isVisible({ timeout: 5000 }).catch(() => false)) {
        const box = await el.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          console.log(`  ✅ Clicou em "${label}" (Filtros)`);
          await randomDelay(2000, 4000);
          break;
        }
      }
    }

    // 7. Escreve a legenda persuasiva de alto engajamento
    console.log('  ✍️ Digitando legenda formatada...');

    // Tenta vários seletores para a caixa de legenda
    let captionFound = false;
    const captionSelectors = [
      'div[aria-label*="Escreva uma legenda"]',
      'div[aria-label*="Write a caption"]',
      'div[contenteditable="true"]',
      'textarea[aria-label*="legenda"]',
      'textarea[aria-label*="caption"]',
      'p[data-lexical-text="true"]',
    ];
    for (const sel of captionSelectors) {
      const el = page.locator(sel).first();
      if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
        await el.click();
        await randomDelay(500, 1000);
        await page.keyboard.type(captionText, { delay: 5 });
        captionFound = true;
        console.log(`  ✅ Legenda digitada! (seletor: ${sel})`);
        await randomDelay(1500, 2500);
        break;
      }
    }
    if (!captionFound) {
      await page.screenshot({ path: 'ig-debug-caption.png' }).catch(() => {});
      console.log('  ⚠️ Caixa de legenda não encontrada. Screenshot ig-debug-caption.png salvo.');
    }

    // 8. Clica em "Compartilhar" / "Share"
    console.log('  🚀 Compartilhando publicação no Instagram...');

    // Fecha sugestões de hashtags que podem estar sobrepostas
    await page.keyboard.press('Escape').catch(() => {});
    await randomDelay(1000, 1500);
    // Clica fora da caixa de texto para deselecionar
    await page.mouse.click(400, 120).catch(() => {});
    await randomDelay(1000, 1500);

    let shared = false;
    // Tenta múltiplas abordagens para clicar em "Compartilhar"
    // Abordagem 1: getByText com exact
    for (const label of ['Compartilhar', 'Share']) {
      const el = page.getByText(label, { exact: true }).first();
      if (await el.isVisible({ timeout: 3000 }).catch(() => false)) {
        const box = await el.boundingBox().catch(() => null);
        if (box) {
          await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
          shared = true;
          console.log(`  ⏳ Clicou em "${label}" — processando publicação...`);
          break;
        }
      }
    }

    // Abordagem 2: locator com role="button" ou div/span
    if (!shared) {
      const selectors = [
        'div[role="button"]:has-text("Compartilhar")',
        'div[role="button"]:has-text("Share")',
        'span:has-text("Compartilhar")',
        'span:has-text("Share")',
        'a:has-text("Compartilhar")',
      ];
      for (const sel of selectors) {
        const el = page.locator(sel).first();
        if (await el.isVisible({ timeout: 2000 }).catch(() => false)) {
          const box = await el.boundingBox().catch(() => null);
          if (box) {
            await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
            shared = true;
            console.log(`  ⏳ Clicou em Compartilhar via ${sel}`);
            break;
          }
        }
      }
    }

    if (!shared) {
      await page.screenshot({ path: 'ig-debug-share.png' }).catch(() => {});
      console.log('  ❌ Botão Compartilhar não localizado. Screenshot ig-debug-share.png salvo.');
      return { success: false, error: apiError || 'Botão Compartilhar não localizado' };
    }

    await randomDelay(8000, 12000);
    console.log('  ✅ Oferta publicada com sucesso no Instagram!');
    await saveIgCookiesToDb(context).catch(() => {});

    return { success: true };
  } catch (err: any) {
    const errMsg = err?.message || String(err);
    console.error(`  ❌ Erro ao postar oferta no Instagram: ${errMsg}`);
    return { success: false, error: apiError || errMsg };
  }
}
