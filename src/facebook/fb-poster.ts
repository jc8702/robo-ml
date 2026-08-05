import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { formatFacebookOffer, formatFacebookWaComment } from '../formatter/facebook.js';
import { findBrowserPath, isCloudEnvironment } from '../config/browser.js';
import { getDbPool } from '../db/index.js';
import { dismissNativeWindowsFileDialogs } from '../utils/win-dialog-dismiss.js';

const FB_PROFILE_DIR = join(process.cwd(), '.fb-profile');
const TEMP_IMG_DIR = join(process.cwd(), '.fb-temp-images');

function randomDelay(minMs: number, maxMs: number): Promise<void> {
  const delay = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((r) => setTimeout(r, delay));
}

export async function restoreFbCookiesFromDb(context: BrowserContext): Promise<boolean> {
  const db = getDbPool();
  if (!db) return false;
  try {
    const res = await db.query("SELECT value FROM app_settings WHERE key = 'FB_COOKIES_JSON'");
    if (res.rows.length > 0 && res.rows[0].value) {
      const cookies = JSON.parse(res.rows[0].value);
      if (Array.isArray(cookies) && cookies.length > 0) {
        await context.addCookies(cookies);
        console.log(`[FB] 🔑 ${cookies.length} cookie(s) do Facebook restaurados do Neon PostgreSQL.`);
        return true;
      }
    }
  } catch (err) {
    console.error('[FB] Erro ao restaurar cookies do DB:', err);
  }
  return false;
}

export async function saveFbCookiesToDb(context: BrowserContext): Promise<void> {
  const db = getDbPool();
  if (!db) return;
  try {
    const cookies = await context.cookies('https://www.facebook.com');
    if (cookies && cookies.length > 0) {
      const json = JSON.stringify(cookies);
      await db.query(
        `INSERT INTO app_settings (key, value) VALUES ('FB_COOKIES_JSON', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [json]
      );
      console.log(`[FB] 💾 ${cookies.length} cookie(s) do Facebook salvos no Neon PostgreSQL.`);
    }
  } catch (err) {
    console.error('[FB] Erro ao salvar cookies no DB:', err);
  }
}

function cleanProfileLock(profileDir: string) {
  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
  for (const lockFile of lockFiles) {
    const lockPath = join(profileDir, lockFile);
    if (existsSync(lockPath)) {
      try {
        unlinkSync(lockPath);
      } catch {
        // Se o arquivo estiver preso por outro processo ativo, ignora
      }
    }
  }
}

let activeFbContext: BrowserContext | null = null;

/**
 * Abre browser com perfil persistente dedicado ao Facebook.
 * Separado do perfil do ML para evitar conflitos de sessão.
 */
export async function openFacebookBrowser(): Promise<BrowserContext> {
  if (activeFbContext && activeFbContext.pages().length > 0) {
    try {
      // Testa se o contexto ainda está responsivo
      const pages = activeFbContext.pages();
      if (pages.length > 0 && !pages[0].isClosed()) {
        return activeFbContext;
      }
    } catch {
      activeFbContext = null;
    }
  }

  const executablePath = findBrowserPath();
  const isCloud = isCloudEnvironment();

  if (!existsSync(FB_PROFILE_DIR)) {
    mkdirSync(FB_PROFILE_DIR, { recursive: true });
  }

  cleanProfileLock(FB_PROFILE_DIR);

  const contextOptions: any = {
    headless: isCloud,
    locale: 'pt-BR',
    viewport: { width: 1366, height: 768 },
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };

  if (executablePath && !isCloud) {
    contextOptions.executablePath = executablePath;
  }

  let context: BrowserContext;
  try {
    context = await chromium.launchPersistentContext(FB_PROFILE_DIR, contextOptions);
  } catch (launchErr) {
    console.warn('[FB] Aviso ao abrir com Chrome do sistema. Expurgando lock e relançando...', launchErr);
    cleanProfileLock(FB_PROFILE_DIR);
    delete contextOptions.executablePath;
    context = await chromium.launchPersistentContext(FB_PROFILE_DIR, contextOptions);
  }

  activeFbContext = context;

  // Stealth: esconde sinais de automação
  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    delete (navigator as any).__proto__.webdriver;
    Object.defineProperty(navigator, 'plugins', {
      get: () => [1, 2, 3, 4, 5],
    });
    Object.defineProperty(navigator, 'languages', {
      get: () => ['pt-BR', 'pt', 'en-US', 'en'],
    });
    (window as any).chrome = {
      runtime: {},
      loadTimes: () => {},
      csi: () => {},
      app: {},
    };
  });

  // Interceptor global: cancela automaticamente qualquer janela nativa Explorer do SO em TODAS as páginas
  const registerFileChooserInterceptor = (p: Page) => {
    p.on('filechooser', async (fc) => {
      console.log('[FB] 🛡️ Interceptado FileChooser do SO no Facebook. Fechando/cancelando janela nativa automaticamente...');
      await fc.setFiles([]).catch(() => {});
    });
  };

  context.pages().forEach(registerFileChooserInterceptor);
  context.on('page', registerFileChooserInterceptor);

  // Restaura cookies da sessão do Neon DB
  await restoreFbCookiesFromDb(context);

  return context;
}

/**
 * Verifica se o Facebook está logado verificando a presença de elementos do feed.
 */
async function isFacebookLoggedIn(page: Page): Promise<boolean> {
  try {
    // Verifica elementos que só existem quando logado
    const loggedIn = await page.evaluate(() => {
      return (
        document.querySelector('[aria-label="Facebook"]') !== null ||
        document.querySelector('[aria-label="Página inicial"]') !== null ||
        document.querySelector('[aria-label="Home"]') !== null ||
        document.querySelector('[data-pagelet="LeftRail"]') !== null ||
        document.querySelector('[role="banner"]') !== null
      );
    });
    return loggedIn;
  } catch {
    return false;
  }
}

/**
 * Faz download de uma imagem de URL para arquivo temporário local.
 * Necessário porque o Facebook exige upload via input[type=file].
 */
async function downloadImageToTemp(imageUrl: string, index: number): Promise<string | null> {
  try {
    if (!existsSync(TEMP_IMG_DIR)) {
      mkdirSync(TEMP_IMG_DIR, { recursive: true });
    }

    const filePath = join(TEMP_IMG_DIR, `offer-${index}-${Date.now()}.jpg`);

    const response = await fetch(imageUrl);
    if (!response.ok) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    writeFileSync(filePath, buffer);

    return filePath;
  } catch (error) {
    console.error(`  ⚠️ Erro ao baixar imagem: ${error}`);
    return null;
  }
}

/**
 * Limpa arquivos temporários de imagens.
 */
function cleanTempImages(): void {
  try {
    if (!existsSync(TEMP_IMG_DIR)) return;
    const files = readdirSync(TEMP_IMG_DIR);
    for (const file of files) {
      try {
        unlinkSync(join(TEMP_IMG_DIR, file));
      } catch { /* ignore */ }
    }
  } catch { /* ignore */ }
}

import type { Locator } from 'playwright-core';

function normalizeFbText(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '');
}

/**
 * Identifica com 100% de precisão o card de publicação que o próprio usuário acabou de criar no grupo.
 * NUNCA permite que comentários sejam aplicados em postagens de terceiros no feed.
 */
async function findNewlyCreatedPostArticle(page: Page, offer: AffiliateOffer): Promise<Locator | null> {
  await randomDelay(2000, 3500);

  const offerTitle = offer.title || '';
  const offerLink = offer.affiliateLink || offer.permalink || '';

  // 1. TENTA NAVEGAR/ISOLAR VIA TOAST DE CONFIRMAÇÃO DO FACEBOOK ("Ver publicação" / "View post")
  try {
    const toastLink = page.locator('a[href*="/posts/"], a[href*="/permalink/"], a:has-text("Ver publicação"), a:has-text("View post")').first();
    if (await toastLink.isVisible({ timeout: 2000 })) {
      const href = await toastLink.getAttribute('href').catch(() => null);
      if (href && href.includes('/posts/')) {
        console.log(`  🎯 [1º COMENTÁRIO] Navegando diretamente para a URL da postagem criada: ${href}`);
        await page.goto(href, { waitUntil: 'domcontentloaded', timeout: 20000 });
        await randomDelay(2000, 3000);
        const singlePostArticle = page.locator('[role="article"]').first();
        if (await singlePostArticle.isVisible({ timeout: 3000 })) {
          return singlePostArticle;
        }
      }
    }
  } catch {}

  // 2. SELEÇÃO EXCLUSIVA DE CARDS DE POSTAGENS PRINCIPAIS DO FEED (DESCARTA SUB-COMENTÁRIOS DE OUTROS MEMBROS)
  // Utiliza seletores que englobam o post inteiro no feed, descartando threads de comentários internos
  const topFeedUnitSelectors = [
    'div[data-pagelet*="FeedUnit"]',
    'div[role="feed"] > div:has([role="article"])',
    'div[role="main"] div[role="article"]:not([role="article"] [role="article"])',
  ];

  let topUnits: Locator | null = null;
  let count = 0;

  for (const sel of topFeedUnitSelectors) {
    try {
      const loc = page.locator(sel);
      const c = await loc.count().catch(() => 0);
      if (c > 0) {
        topUnits = loc;
        count = c;
        break;
      }
    } catch {}
  }

  if (!topUnits || count === 0) {
    topUnits = page.locator('[role="article"]:not([role="article"] [role="article"])');
    count = await topUnits.count().catch(() => 0);
  }

  if (count === 0) return null;

  const normalizedTitle = normalizeFbText(offerTitle);
  const titleWords = normalizedTitle
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !['com', 'para', 'sem', 'por', 'dos', 'das', 'que', 'promo', 'oferta'].includes(w));

  // TIER 1: Match por LINK DE AFILIADO / PERMALINK DA OFERTA (100% Único da postagem do usuário!)
  if (offerLink && offerLink.length > 8) {
    const cleanLink = offerLink.replace(/^https?:\/\//i, '').replace(/\/$/, '');
    const linkSnippet = cleanLink.split('?')[0];

    for (let i = 0; i < Math.min(count, 5); i++) {
      const unit = topUnits.nth(i);
      try {
        const text = await unit.innerText().catch(() => '');
        const html = await unit.innerHTML().catch(() => '');
        if (text.includes(offerLink) || text.includes(linkSnippet) || html.includes(linkSnippet)) {
          console.log(`  🎯 [1º COMENTÁRIO] Card de post do próprio usuário isolado pelo Link de Afiliado!`);
          return unit;
        }
      } catch {}
    }
  }

  // TIER 2: Match por PALAVRAS DO TÍTULO DA OFERTA (sem acentos)
  if (titleWords.length > 0) {
    for (let i = 0; i < Math.min(count, 4); i++) {
      const unit = topUnits.nth(i);
      try {
        const text = normalizeFbText(await unit.innerText().catch(() => ''));
        const matchingWords = titleWords.filter((w) => text.includes(w));
        if (matchingWords.length >= Math.min(2, titleWords.length)) {
          console.log(`  🎯 [1º COMENTÁRIO] Card de post do próprio usuário isolado por Palavras do Título (${matchingWords.join(', ')})!`);
          return unit;
        }
      } catch {}
    }
  }

  // TIER 3: Match por SELOS RECENTES ("Você acabou de publicar", "Agora mesmo", "Just now", "1 min")
  const recentBadges = [
    'você acabou de publicar',
    'voce acabou de publicar',
    'agora mesmo',
    'just now',
    'sua publicação',
    'your post',
    'just published',
    '1 min',
    '1m',
  ];

  for (let i = 0; i < Math.min(count, 4); i++) {
    const unit = topUnits.nth(i);
    try {
      const text = normalizeFbText(await unit.innerText().catch(() => ''));
      for (const badge of recentBadges) {
        if (text.includes(badge)) {
          console.log(`  🎯 [1º COMENTÁRIO] Card de post do próprio usuário isolado pelo selo recente ("${badge}")!`);
          return unit;
        }
      }
    } catch {}
  }

  // TIER 4: O PRIMEIRO CARD DO TOPO DO FEED DO GRUPO (O post que o robô ACABOU de criar fica no topo do feed!)
  console.log('  🎯 [1º COMENTÁRIO] Selecionando o card no topo do feed do grupo!');
  for (let i = 0; i < Math.min(count, 3); i++) {
    const unit = topUnits.nth(i);
    try {
      const text = normalizeFbText(await unit.innerText().catch(() => ''));
      const isPinned = text.includes('em destaque') || text.includes('featured') || text.includes('fixado') || text.includes('pinned');
      if (!isPinned) {
        return unit;
      }
    } catch {}
  }

  return topUnits.first();
}

/**
 * Detecta com alta precisão se a página do Facebook é de conteúdo indisponível, grupo deletado ou acesso negado.
 * Retorna true se a página contiver os textos ou seletores da tela "This content isn't available right now".
 */
export async function checkIsFacebookPageUnavailable(page: Page): Promise<boolean> {
  try {
    for (let attempt = 0; attempt < 3; attempt++) {
      const isUnavailable = await page.evaluate(() => {
        const text = (document.body?.innerText || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

        const triggers = [
          "content isn't available",
          "content is not available",
          "conteudo nao esta disponivel",
          "conteudo nao disponivel",
          "pagina nao esta disponivel",
          "pagina nao disponivel",
          "page not found",
          "pagina nao encontrada",
          "when this happens, it's usually because",
          "quando isso acontece, geralmente",
          "visit help center",
          "central de ajuda",
          "go to feed",
          "ir para o feed",
          "ir ao feed",
          "shared it with a small group",
          "compartilhou o conteudo apenas com",
        ];

        for (const trigger of triggers) {
          if (text.includes(trigger)) return true;
        }

        // Checagem visual por botões da tela de erro
        const linksAndButtons = Array.from(document.querySelectorAll('a, button, [role="button"]'));
        for (const el of linksAndButtons) {
          const btnText = (el.textContent || '').toLowerCase().trim().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
          if (
            btnText === 'go to feed' ||
            btnText === 'ir para o feed' ||
            btnText === 'visit help center' ||
            btnText === 'visitar central de ajuda' ||
            btnText === 'go back' ||
            btnText === 'voltar'
          ) {
            return true;
          }
        }

        return false;
      }).catch(() => false);

      if (isUnavailable) return true;
      await new Promise((r) => setTimeout(r, 600));
    }

    return false;
  } catch {
    return false;
  }
}

/**
 * Detecta e trata modais de "Participation review" / "Regras do grupo" / "Perguntas de adesão".
 * 1. Tenta marcar caixas de aceite de regras ("I agree to the group rules", "Concordo com as regras")
 * 2. Clica em "Submit" / "Enviar" se habilitado
 * 3. Se o modal persistir ou exigir respostas de texto manuais, fecha o modal (X, ESC, Close) para desbloquear a tela e permite que o grupo seja pulado.
 */
export async function handleFacebookGroupRulesModal(page: Page): Promise<{ modalDetected: boolean; skipped: boolean }> {
  try {
    const dialogs = page.locator('div[role="dialog"]');
    const count = await dialogs.count();
    if (count === 0) return { modalDetected: false, skipped: false };

    let isRulesModal = false;
    let targetDialog = null;

    for (let i = 0; i < count; i++) {
      const dialog = dialogs.nth(i);
      const text = (await dialog.innerText().catch(() => '')).toLowerCase();
      if (
        text.includes('participation review') ||
        text.includes('group rules') ||
        text.includes('regras do grupo') ||
        text.includes('análise de participação') ||
        text.includes('perguntas de adesão') ||
        text.includes('i agree to the group rules') ||
        text.includes('concordo com as regras')
      ) {
        isRulesModal = true;
        targetDialog = dialog;
        break;
      }
    }

    if (!isRulesModal || !targetDialog) {
      return { modalDetected: false, skipped: false };
    }

    console.log('  ⚠️ [REGRAS] Detectado modal de regras do grupo ("Participation review"). Processando liberação...');

    // A) Marca caixas de seleção (checkboxes) de regras do grupo
    const checkboxes = targetDialog.locator('input[type="checkbox"], div[role="checkbox"], [aria-checked]');
    const cbCount = await checkboxes.count();
    for (let c = 0; c < cbCount; c++) {
      try {
        const cb = checkboxes.nth(c);
        const isChecked = (await cb.isChecked().catch(() => false)) || (await cb.getAttribute('aria-checked')) === 'true';
        if (!isChecked && (await cb.isVisible().catch(() => false))) {
          await cb.click({ force: true }).catch(() => {});
          await randomDelay(300, 600);
        }
      } catch { /* próximo */ }
    }

    // Marca especificamente elementos com rótulo "agree" / "concordo"
    const agreeLabels = targetDialog.locator('label, span, div').filter({ hasText: /agree|concordo/i });
    const labelCount = await agreeLabels.count();
    for (let l = 0; l < Math.min(labelCount, 3); l++) {
      try {
        const label = agreeLabels.nth(l);
        if (await label.isVisible().catch(() => false)) {
          await label.click({ force: true }).catch(() => {});
          await randomDelay(300, 500);
        }
      } catch { /* próximo */ }
    }

    await randomDelay(800, 1500);

    // B) Clica no botão "Submit" / "Enviar" / "Concluir"
    const submitSelectors = [
      '[aria-label="Submit"]',
      '[aria-label="Enviar"]',
      '[aria-label="Concluir"]',
      '[role="button"]:has-text("Submit")',
      '[role="button"]:has-text("Enviar")',
      '[role="button"]:has-text("Concluir")',
      'button:has-text("Submit")',
      'button:has-text("Enviar")',
    ];

    for (const sel of submitSelectors) {
      try {
        const btn = targetDialog.locator(sel).first();
        if ((await btn.isVisible({ timeout: 1500 })) && (await btn.isEnabled().catch(() => true))) {
          await btn.click({ force: true }).catch(() => {});
          console.log('  ✅ [REGRAS] Termos do grupo aceitos e enviados via Submit!');
          await randomDelay(2000, 3000);
          break;
        }
      } catch { /* próximo */ }
    }

    // C) Se o modal continua visível (ex: exige respostas manuais digitadas), descarta o modal para não travar
    const modalStillVisible = await targetDialog.isVisible({ timeout: 1500 }).catch(() => false);

    if (modalStillVisible) {
      console.log('  ℹ️ [REGRAS] O grupo exige respostas manuais ou aprovação. Descartando modal e pulando grupo...');

      const closeSelectors = [
        '[aria-label="Fechar"]',
        '[aria-label="Close"]',
        '[aria-label="Cancelar"]',
        '[aria-label="Cancel"]',
        'div[aria-label="Fechar"]',
        'div[aria-label="Close"]',
        'button:has-text("Cancelar")',
        'button:has-text("Cancel")',
      ];

      let closed = false;
      for (const cSel of closeSelectors) {
        try {
          const closeBtn = targetDialog.locator(cSel).first();
          if (await closeBtn.isVisible({ timeout: 1000 })) {
            await closeBtn.click({ force: true }).catch(() => {});
            closed = true;
            await randomDelay(800, 1200);
            break;
          }
        } catch { /* próximo */ }
      }

      if (!closed) {
        await page.keyboard.press('Escape').catch(() => {});
        await randomDelay(800, 1200);
      }

      return { modalDetected: true, skipped: true };
    }

    return { modalDetected: true, skipped: false };
  } catch {
    return { modalDetected: false, skipped: false };
  }
}

/**
 * Posta uma oferta em um grupo do Facebook.

 *
 * Fluxo:
 * 1. Navega para a URL do grupo
 * 2. Clica no campo "No que você está pensando?" / "Write something..."
 * 3. Digita o texto da oferta
 * 4. (Opcional) Faz upload da imagem do produto
 * 5. Clica em "Publicar" / "Post"
 */
async function postToFacebookGroup(
  page: Page,
  offer: AffiliateOffer,
  groupUrl: string,
  offerIndex: number,
  waGroupLink?: string
): Promise<boolean> {
  try {
    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 5000);

    // 0. CHECAGEM AVANÇADA DE GRUPO INDISPONÍVEL / DELETADO / SEM ACESSO ("This content isn't available right now")
    const isUnavailable = await checkIsFacebookPageUnavailable(page);
    if (isUnavailable) {
      console.warn(`  ⚠️ [FACEBOOK] Grupo indisponível ou deletado (${groupUrl}). Purgando do .env e redirecionando janela...`);
      removeInvalidGroupUrlFromEnv(groupUrl);
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
      return false;
    }

    // Checagem complementar de texto da página
    const pageBodyText = (await page.innerText('body').catch(() => '')).toLowerCase();

    // Checagem de Restrição / Bloqueio Temporário da Conta
    if (
      pageBodyText.includes("temporarily blocked") ||
      pageBodyText.includes("temporariamente bloqueado") ||
      pageBodyText.includes("sua conta esta restric") ||
      pageBodyText.includes("sua conta está restrita") ||
      pageBodyText.includes("action blocked")
    ) {
      console.error(`  🚨 [FACEBOOK ALERTA] Conta temporariamente bloqueada ou restrita pelo Facebook. Pausando envio neste ciclo.`);
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
      return false;
    }

    // 0. TRATAMENTO DE LINKS DE COMPARTILHAMENTO (share/g/) E REDIRECIONAMENTOS
    if (page.url().includes('/share/') || page.url().includes('share/g') || groupUrl.includes('share/g')) {
      try {
        const viewGroupSelectors = [
          'a[href*="/groups/"]:has-text("Visualizar")',
          'a[href*="/groups/"]:has-text("Ir para")',
          'a:has-text("Visualizar grupo")',
          'a:has-text("Ir para o grupo")',
          '[role="button"]:has-text("Visualizar grupo")',
          '[role="button"]:has-text("Ir para o grupo")',
          '[role="main"] a[href*="/groups/"]',
        ];
        for (const sel of viewGroupSelectors) {
          try {
            const btn = page.locator(sel).first();
            if (await btn.isVisible({ timeout: 2000 })) {
              await btn.click();
              await page.waitForLoadState('domcontentloaded');
              await randomDelay(2000, 4000);
              break;
            }
          } catch { /* próximo */ }
        }
      } catch { /* ignora */ }
    }

    // Se o redirecionamento foi concluído para uma URL de grupo canônica (/groups/ID/), atualiza no .env
    const currentResolvedUrl = page.url();
    const canonicalMatch = currentResolvedUrl.match(/facebook\.com\/groups\/([^\/?#]+)/i);
    if (canonicalMatch && canonicalMatch[1] && groupUrl.includes('share/g')) {
      const cleanCanonicalUrl = `https://www.facebook.com/groups/${canonicalMatch[1]}/`;
      replaceGroupUrlInEnv(groupUrl, cleanCanonicalUrl);
    }

    // Fecha popups / notificações / modais de regras que o Facebook exibe
    try {
      const closeSelectors = [
        '[aria-label="Fechar"]',
        '[aria-label="Close"]',
        '[aria-label="Agora não"]',
        '[aria-label="Not now"]',
        '[role="button"]:has-text("Entendido")',
        '[role="button"]:has-text("Concluir")',
      ];
      for (const sel of closeSelectors) {
        try {
          const closeBtn = page.locator(sel).first();
          if (await closeBtn.isVisible({ timeout: 1500 })) {
            await closeBtn.click();
            await randomDelay(500, 1000);
          }
        } catch { /* próximo */ }
      }
    } catch { /* sem popup */ }

    // Trata modais de regras / participação no grupo ("Participation review")
    const rulesCheck = await handleFacebookGroupRulesModal(page);
    if (rulesCheck.skipped) {
      console.warn(`  🗑️ [PURGA DE REGRAS] Grupo ${groupUrl} expurgado por exigir respostas manuais de adesão.`);
      removeInvalidGroupUrlFromEnv(groupUrl, 'Exige respostas manuais de adesão');
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
      return false;
    }

    // Clica no campo de criar publicação
    // O Facebook tem vários seletores possíveis para o campo de publicação (texto ou ícone de foto do feed)
    const createPostSelectors = [
      '[role="button"] span:has-text("No que você está pensando")',
      '[role="button"] span:has-text("Escreva algo")',
      '[role="button"] span:has-text("O que você tem em mente")',
      '[role="button"] span:has-text("Write something")',
      '[role="main"] [role="button"]:has-text("No que você")',
      'div[role="button"]:has-text("Escreva uma publicação")',
      'div[role="button"]:has-text("Create a public post")',
      '[role="main"] [aria-label*="Foto/vídeo"]',
      '[role="main"] [aria-label*="Photo/video"]',
      '[role="main"] [aria-label*="foto"]',
      'div[class*="sjgh65i0"]', // Classe dinâmica do FB, fallback
    ];

    let clicked = false;
    for (const selector of createPostSelectors) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 3000 })) {
          await el.click();
          clicked = true;
          console.log(`  ✅ Campo de publicação aberto`);
          break;
        }
      } catch { /* próximo seletor */ }
    }

    if (!clicked) {
      // Fallback: tenta clicar em qualquer elemento que pareça o campo de criação de post
      try {
        const fallback = page.locator('div[role="dialog"] [contenteditable="true"], [role="textbox"][aria-label*="publicação"], [role="textbox"][aria-label*="post"]').first();
        if (await fallback.isVisible({ timeout: 3000 })) {
          await fallback.click();
          clicked = true;
        }
      } catch { /* sem fallback */ }
    }

    if (!clicked) {
      console.warn(`  🗑️ [PURGA DE INEFICIÊNCIA] Grupo "${groupUrl}" expurgado por não permitir abertura do campo de publicação.`);
      removeInvalidGroupUrlFromEnv(groupUrl, 'Campo de publicação não abre ou bloqueado');
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
      return false;
    }

    await randomDelay(2000, 4000);

    // 1. UPLOAD DA IMAGEM DO PRODUTO EM 1º LUGAR (Anexa a foto ANTES de colar o texto com os links)
    // Isso garante que o post entice no modo Mídia/Foto e a foto do produto do Mercado Livre seja o destaque principal.
    // IMPORTANTE: NUNCA chama btn.click() sem interceptar o 'filechooser', para NUNCA abrir a janela nativa do Windows Explorer ("Abrir").
    let photoUploaded = false;
    if (offer.thumbnail && offer.thumbnail.startsWith('http')) {
      const imgPath = await downloadImageToTemp(offer.thumbnail, offerIndex);
      if (imgPath) {
        try {
          await dismissNativeWindowsFileDialogs();

          // A) Injeta o arquivo diretamente nos inputs de arquivo já existentes no modal (sem clicar em botões)
          const fileInputs = [
            'div[role="dialog"] input[type="file"]',
            'input[type="file"][accept*="image"]',
            'input[type="file"]',
          ];

          for (const sel of fileInputs) {
            try {
              const fileInput = page.locator(sel).first();
              if ((await fileInput.count()) > 0) {
                await fileInput.setInputFiles(imgPath);
                photoUploaded = true;
                console.log(`  📸 Foto do produto carregada via DOM no modal expandido (${sel})!`);
                break;
              }
            } catch { /* próximo */ }
          }

          // B) Se não havia input de arquivo visível, expande a área "Foto/vídeo" interceptando o evento FileChooser via CDP
          if (!photoUploaded) {
            const photoButtonSelectors = [
              'div[role="dialog"] [aria-label*="Foto/vídeo"]',
              'div[role="dialog"] [aria-label*="Photo/video"]',
              'div[role="dialog"] [aria-label*="foto"]',
              'div[role="dialog"] [aria-label*="photo"]',
              'div[role="dialog"] div:has-text("Foto/vídeo")',
            ];

            for (const btnSel of photoButtonSelectors) {
              try {
                const btn = page.locator(btnSel).first();
                if (await btn.isVisible({ timeout: 2000 })) {
                  // Envolve o clique no evento filechooser para evitar que o Chromium abra a janela nativa do SO
                  const [fileChooser] = await Promise.all([
                    page.waitForEvent('filechooser', { timeout: 3000 }).catch(() => null),
                    btn.click().catch(() => {}),
                  ]);

                  if (fileChooser) {
                    await fileChooser.setFiles(imgPath).catch(() => {});
                    photoUploaded = true;
                    console.log(`  📸 Foto do produto inserida via interceptador FileChooser no botão (${btnSel})!`);
                  }
                  await randomDelay(800, 1500);
                  break;
                }
              } catch { /* próximo */ }
            }
          }

          // C) Fallback: tenta novamente preencher input[type=file] expandido
          if (!photoUploaded) {
            for (const sel of fileInputs) {
              try {
                const fileInput = page.locator(sel).first();
                if (await fileInput.count() > 0) {
                  await fileInput.setInputFiles(imgPath);
                  photoUploaded = true;
                  console.log(`  📸 Foto do produto carregada via DOM no modal expandido (${sel})!`);
                  break;
                }
              } catch { /* próximo */ }
            }
          }

          await dismissNativeWindowsFileDialogs();

          if (photoUploaded) {
            console.log('  ⏳ Aguardando renderização e upload da foto na CDN do Facebook (5s)...');
            try {
              // Aguarda explicitamente a confirmação visual da thumbnail/preview no modal
              await page.waitForSelector(
                'div[role="dialog"] img[src*="fbcdn"], div[role="dialog"] img[src*="blob"], div[role="dialog"] [aria-label*="Remover"], div[role="dialog"] [aria-label*="Remove"], div[role="dialog"] [aria-label*="Editar"]',
                { timeout: 12000 }
              );
              console.log('  ✅ Preview da foto confirmado e anexado com sucesso!');
            } catch {
              console.log('  ℹ️ Buffer de tempo aplicado para processamento de imagem.');
            }
            await randomDelay(4000, 6000); // Delay de segurança obrigatório para vincular imagem ao post
          } else {
            console.log(`  ⚠️ Não foi possível anexar a foto do produto antes de colar o texto.`);
          }
        } catch (imgError) {
          console.log(`  ⚠️ Upload de imagem falhou: ${imgError}`);
        }
      }
    }

    // 2. ENCONTRAR O CAMPO DE TEXTO E COLAR O TEXTO DA OFERTA (DEPOIS DA FOTO)
    const textboxSelectors = [
      'div[role="dialog"] [contenteditable="true"]',
      'div[role="dialog"] [role="textbox"]',
      '[role="textbox"][contenteditable="true"]',
      'div[aria-label*="publicação"][contenteditable="true"]',
      'div[aria-label*="post"][contenteditable="true"]',
      'div[data-contents="true"][contenteditable="true"]',
    ];

    let textbox = null;
    for (const selector of textboxSelectors) {
      try {
        const el = page.locator(selector).first();
        if (await el.isVisible({ timeout: 3000 })) {
          textbox = el;
          break;
        }
      } catch { /* próximo */ }
    }

    if (!textbox) {
      console.warn(`  🗑️ [PURGA DE INEFICIÊNCIA] Grupo "${groupUrl}" expurgado por ausência de campo de texto.`);
      removeInvalidGroupUrlFromEnv(groupUrl, 'Campo de texto da publicação não encontrado');
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
      return false;
    }

    // Digita o texto da oferta (incluindo chamada para o grupo do WhatsApp)
    const postText = formatFacebookOffer(offer, waGroupLink);
    await textbox.click();
    await randomDelay(500, 1000);

    // Usa clipboard para colar texto
    await page.evaluate((text) => {
      navigator.clipboard.writeText(text);
    }, postText);
    await page.keyboard.press('Control+v');
    await randomDelay(1500, 2500);

    // Verifica se o texto foi colado; se não, tenta type() como fallback
    const currentText = await textbox.textContent();
    if (!currentText || currentText.trim().length < 10) {
      console.log(`  ⚠️ Clipboard não funcionou, tentando digitação direta...`);
      await textbox.fill('');
      for (const line of postText.split('\n')) {
        await page.keyboard.type(line, { delay: 10 });
        await page.keyboard.press('Enter');
      }
      await randomDelay(1000, 2000);
    }

    // 3. SE O FACEBOOK TENTAR GERAR CARTÃO DE PRÉVIA DO LINK APÓS O TEXTO,
    // E REMOVER OU ATROPELAR A FOTO DO PRODUTO: detecta e clica em "Remover prévia" imediatamente
    try {
      const removePreviewSelectors = [
        'div[role="dialog"] [aria-label="Remover prévia"]',
        'div[role="dialog"] [aria-label="Remove preview"]',
        'div[role="dialog"] [aria-label="Remover cartão de prévia"]',
        'div[role="dialog"] [aria-label="Remover prévia de link"]',
        'div[role="dialog"] [aria-label="Remove link preview"]',
        'div[role="dialog"] [aria-label*="Remover"][aria-label*="link"]',
        'div[role="dialog"] [aria-label*="Remove"][aria-label*="link"]',
      ];
      for (const removeSel of removePreviewSelectors) {
        try {
          const removeBtn = page.locator(removeSel).first();
          if (await removeBtn.isVisible({ timeout: 1200 }).catch(() => false)) {
            console.log('  ⚠️ Detectada prévia de link gerada sobre o texto. Removendo prévia de link...');
            await removeBtn.click().catch(() => {});
            await randomDelay(1000, 1500);
          }
        } catch { /* ignora */ }
      }
    } catch { /* ignora */ }

    // Fallback: se por algum motivo a foto não tinha sido enviada no início, tenta enviar agora
    if (!photoUploaded && offer.thumbnail && offer.thumbnail.startsWith('http')) {
      const imgPath = await downloadImageToTemp(offer.thumbnail, offerIndex);
      if (imgPath) {
        try {
          const fallbackInput = page.locator('div[role="dialog"] input[type="file"]').first();
          if (await fallbackInput.count() > 0) {
            await fallbackInput.setInputFiles(imgPath);
            console.log(`  📸 Foto do produto anexada em fallback após o texto!`);
            await randomDelay(3000, 4000);
          }
        } catch { /* ignora fallback */ }
      }
    }

    // 3. CLICA EM "PUBLICAR" / "POST" (NENHUMA FOTO É DELETADA!)
    const publishSelectors = [
      'div[role="dialog"] [aria-label="Publicar"]',
      'div[role="dialog"] [aria-label="Post"]',
      'div[role="dialog"] [role="button"]:has-text("Publicar")',
      'div[role="button"]:has-text("Publicar")',
      'div[role="dialog"] [role="button"]:has-text("Post")',
      'div[role="button"]:has-text("Post")',
      '[aria-label="Publicar"]',
      '[aria-label="Post"]',
    ];

    let published = false;
    for (const sel of publishSelectors) {
      try {
        const btn = page.locator(sel).first();
        if (await btn.isVisible({ timeout: 3000 })) {
          await btn.click();
          published = true;
          console.log(`  ✅ Post publicado no grupo!`);
          break;
        }
      } catch { /* próximo */ }
    }

    if (!published) {
      console.warn(`  🗑️ [PURGA DE INEFICIÊNCIA] Grupo "${groupUrl}" expurgado por falha ao acionar o botão Publicar.`);
      removeInvalidGroupUrlFromEnv(groupUrl, 'Falha ao acionar botão Publicar');
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
      return false;
    }

    // Espera publicação processar
    await randomDelay(3000, 5000);

    // Verificação de post pendente para aprovação dos moderadores do grupo
    const pendingApprovalSelectors = [
      'text="aprovação"',
      'text="pendente"',
      'text="pending approval"',
      'text="Submit for admin approval"',
      'text="enviada para análise"',
      'text="análise dos administradores"',
      'text="análise de administradores"',
      'text="análise de moderadores"',
      'text="análise do administrador"',
      '[aria-label*="aprovação"]',
      '[aria-label*="approval"]',
    ];
    let isPending = false;
    for (const pSel of pendingApprovalSelectors) {
      try {
        const pEl = page.locator(pSel).first();
        if (await pEl.isVisible({ timeout: 1200 }).catch(() => false)) {
          isPending = true;
          break;
        }
      } catch {}
    }

    if (isPending) {
      console.warn(`  🗑️ [PURGA DE APROVAÇÃO] Grupo "${groupUrl}" expurgado por exigir aprovação prévia de administradores/moderadores.`);
      removeInvalidGroupUrlFromEnv(groupUrl, 'Exige aprovação prévia de administradores');
      await page.goto('https://www.facebook.com', { waitUntil: 'domcontentloaded' }).catch(() => {});
      return false;
    }

    console.log(`  ✅ Postagem publicada com sucesso no Facebook com CTAs do WhatsApp e Instagram incorporados no texto!`);
    return true;
  } catch (error) {
    console.error(`  ❌ Erro ao postar no grupo ${groupUrl}:`, error);
    return false;
  }
}

/**
 * Posta ofertas em todos os grupos do Facebook configurados.
 *
 * Estratégia anti-bloqueio:
 * - Pausa de 60-90s entre grupos
 * - Máximo de grupos por ciclo (configurável)
 * - Delays aleatórios para simular comportamento humano
 */
export async function postOffersToFacebookGroups(
  offers: AffiliateOffer[],
  groupUrls: string[],
  maxGroupsPerCycle: number,
  delayBetweenPostsSec: number,
  waGroupLink?: string
): Promise<{ success: number; failed: number }> {
  if (offers.length === 0) {
    console.log('  ⚠️ Nenhuma oferta para postar no Facebook.');
    return { success: 0, failed: 0 };
  }

  let context: BrowserContext | null = null;
  let success = 0;
  let failed = 0;

  try {
    context = await openFacebookBrowser();
    const page = context.pages()[0] || await context.newPage();

    // Verifica se o Facebook está logado
    console.log('  🔐 Verificando sessão do Facebook...');
    await page.goto('https://www.facebook.com/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 5000);

    const loggedIn = await isFacebookLoggedIn(page);

    if (!loggedIn) {
      // Perfil do Facebook separado — primeira vez: mostrar browser visível para login
      const hasProfile = existsSync(join(FB_PROFILE_DIR, 'Default'))
        || existsSync(join(FB_PROFILE_DIR, 'Local State'));

      if (!hasProfile) {
        console.log('');
        console.log('  ╔═══════════════════════════════════════════════════╗');
        console.log('  ║  🆕 PRIMEIRA EXECUÇÃO DO FACEBOOK                ║');
        console.log('  ║                                                   ║');
        console.log('  ║  O browser vai abrir. Faça login no Facebook:     ║');
        console.log('  ║  1. Digite seu e-mail/telefone e senha            ║');
        console.log('  ║  2. Complete verificação 2FA se solicitado        ║');
        console.log('  ║  3. A automação continua após o login             ║');
        console.log('  ║                                                   ║');
        console.log('  ║  ⏱️  Você tem 3 minutos para completar.            ║');
        console.log('  ║  Nas próximas vezes, será automático.             ║');
        console.log('  ╚═══════════════════════════════════════════════════╝');
        console.log('');
      }

      // Espera até 3 minutos pelo login
      try {
        await page.waitForSelector('[aria-label="Facebook"], [aria-label="Página inicial"], [aria-label="Home"], [role="banner"]', {
          timeout: 180000,
        });
        console.log('  ✅ Facebook logado com sucesso!');
      } catch {
        console.log('  ⏰ Tempo esgotado para login no Facebook. Pulando postagem.');
        await context.close();
        return { success: 0, failed: 0 };
      }
    } else {
      console.log('  ✅ Facebook já logado (sessão salva).');
    }

    // 🔄 SYNC: Sincroniza automaticamente todos os grupos que o perfil já faz parte
    await syncJoinedFacebookGroups(page);

    // Recarrega dinamicamente a lista de grupos se for ciclo normal (não teste de 1 grupo)
    if (maxGroupsPerCycle > 1 && existsSync(join(process.cwd(), '.env'))) {
      const envContent = readFileSync(join(process.cwd(), '.env'), 'utf-8');
      const updatedUrlsMatch = envContent.match(/^FB_GROUP_URLS=(.*)$/m);
      if (updatedUrlsMatch && updatedUrlsMatch[1].trim()) {
        groupUrls = updatedUrlsMatch[1].split(',').map((u) => u.trim()).filter(Boolean);
      }
      const updatedMaxMatch = envContent.match(/^FB_MAX_GROUPS_PER_CYCLE=(\d+)$/m);
      if (updatedMaxMatch) {
        maxGroupsPerCycle = parseInt(updatedMaxMatch[1], 10);
      }
    }

    if (groupUrls.length === 0) {
      console.log('  ⚠️ Nenhum grupo do Facebook encontrado ou configurado no .env.');
      await context.close();
      return { success: 0, failed: 0 };
    }

    // Fila Circular de Grupos: lê o último índice e avança em lotes ágeis (padrão: 15 grupos)
    let lastIndex = parseInt(process.env.FB_LAST_GROUP_INDEX || '0', 10);
    if (isNaN(lastIndex) || lastIndex < 0 || lastIndex >= groupUrls.length) {
      lastIndex = 0;
    }

    const batchSize = Math.min(maxGroupsPerCycle > 0 ? maxGroupsPerCycle : 15, groupUrls.length);
    const groupsToPostFinal: string[] = [];

    for (let i = 0; i < batchSize; i++) {
      const idx = (lastIndex + i) % groupUrls.length;
      groupsToPostFinal.push(groupUrls[idx]);
    }

    const nextIndex = (lastIndex + batchSize) % groupUrls.length;
    console.log(`\n📘 Facebook: Postando em lote ágil de ${groupsToPostFinal.length} grupo(s) (Fila circular: grupos ${lastIndex + 1} até ${lastIndex + groupsToPostFinal.length} de ${groupUrls.length})...`);

    // Posta em cada grupo — uma oferta diferente por grupo (rotação)
    for (let i = 0; i < groupsToPostFinal.length; i++) {
      const groupUrl = groupsToPostFinal[i];
      // Rotação: cada grupo recebe uma oferta diferente (ou repete se houver mais grupos que ofertas)
      const offer = offers[i % offers.length];

      const posted = await postToFacebookGroup(page, offer, groupUrl, i, waGroupLink);

      if (posted) {
        success++;
      } else {
        failed++;
      }

      // Delay anti-bloqueio entre grupos
      if (i < groupsToPostFinal.length - 1) {
        const delaySec = delayBetweenPostsSec;
        console.log(`  ⏳ Aguardando ${delaySec}s antes do próximo grupo...`);
        await randomDelay(delaySec * 1000, (delaySec + 30) * 1000);
      }
    }

    // Salva o próximo ponteiro circular no .env para o próximo ciclo dar continuidade
    try {
      const envFile = join(process.cwd(), '.env');
      if (existsSync(envFile)) {
        let envContent = readFileSync(envFile, 'utf-8');
        if (envContent.includes('FB_LAST_GROUP_INDEX=')) {
          envContent = envContent.replace(/^FB_LAST_GROUP_INDEX=.*$/m, `FB_LAST_GROUP_INDEX=${nextIndex}`);
        } else {
          envContent += `\nFB_LAST_GROUP_INDEX=${nextIndex}`;
        }
        writeFileSync(envFile, envContent, 'utf-8');
        process.env.FB_LAST_GROUP_INDEX = String(nextIndex);
        console.log(`  📍 [FILA CIRCULAR] Ponteiro de grupos atualizado para o grupo #${nextIndex + 1} no próximo ciclo.`);
      }
    } catch {}

    // 🔍 AUTO-JOIN (EXCLUSIVO NO FINAL DO PROCESSO): Busca e entra automaticamente em novos grupos apenas após concluir todas as postagens
    const autoJoinEnabled = process.env.FB_AUTO_JOIN !== 'false';
    if (autoJoinEnabled) {
      console.log('\n🔎 [FINAL DO PROCESSO] Iniciando busca e entrada em novos grupos do Facebook...');
      await autoDiscoverAndJoinFacebookGroups(page, 1);
    }
  } catch (error) {
    console.error('  ❌ Erro geral na automação do Facebook:', error);
  } finally {
    // Limpa imagens temporárias
    cleanTempImages();

    // Fecha browser
    if (context) {
      try {
        await context.close();
      } catch { /* ignore */ }
    }
  }

  console.log(`\n📘 Facebook: ${success} posts publicados, ${failed} falharam.`);
  return { success, failed };
}

/**
 * Escaneia a página de grupos do perfil (https://www.facebook.com/groups/joins/)
 * e sincroniza TODOS os grupos dos quais o perfil participa diretamente no arquivo .env
 */
export async function syncJoinedFacebookGroups(page: Page): Promise<{ totalGroups: number; updated: boolean }> {
  console.log('  🔄 [SYNC] Escaneando todos os grupos que seu perfil do Facebook faz parte...');

  try {
    // Navega para a página oficial que lista os grupos do perfil
    await page.goto('https://www.facebook.com/groups/joins/', { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 5000);

    // Rola a página para garantir que todos os grupos sejam carregados
    await page.evaluate(async () => {
      for (let i = 0; i < 4; i++) {
        window.scrollTo(0, document.body.scrollHeight);
        await new Promise((r) => setTimeout(r, 1000));
      }
    });

    // Extrai os links dos grupos
    const extractedGroupUrls = await page.evaluate(() => {
      const links = Array.from(document.querySelectorAll('a[href*="/groups/"]')) as HTMLAnchorElement[];
      const urls: string[] = [];

      for (const link of links) {
        const href = link.href;
        if (!href) continue;

        // Filtra links de navegação interna do Facebook
        if (
          href.includes('/search/') ||
          href.includes('/create/') ||
          href.includes('/feed/') ||
          href.includes('/joins/') ||
          href.includes('/discover/') ||
          href.includes('/notifications/') ||
          href.includes('/user/')
        ) {
          continue;
        }

        const match = href.match(/facebook\.com\/groups\/([^\/?#]+)/i);
        if (match && match[1]) {
          const cleanUrl = `https://www.facebook.com/groups/${match[1]}/`;
          if (!urls.includes(cleanUrl)) {
            urls.push(cleanUrl);
          }
        }
      }

      return urls;
    });

    if (extractedGroupUrls.length === 0) {
      console.log('  ℹ️ [SYNC] Nenhum grupo encontrado em /groups/joins/.');
      return { totalGroups: 0, updated: false };
    }

    const envFile = join(process.cwd(), '.env');
    if (!existsSync(envFile)) return { totalGroups: extractedGroupUrls.length, updated: false };

    let content = readFileSync(envFile, 'utf-8');

    // Lê os grupos atuais do .env
    const groupUrlsMatch = content.match(/^FB_GROUP_URLS=(.*)$/m);
    let currentGroupUrls: string[] = [];
    if (groupUrlsMatch && groupUrlsMatch[1].trim()) {
      currentGroupUrls = groupUrlsMatch[1].split(',').map((u) => u.trim()).filter(Boolean);
    }

    // Mescla com os grupos extraídos (sem duplicatas)
    const mergedUrls = Array.from(new Set([...currentGroupUrls, ...extractedGroupUrls]));
    const updatedGroupUrlsStr = mergedUrls.join(',');
    const totalGroupsCount = mergedUrls.length;

    // Atualiza FB_GROUP_URLS
    if (groupUrlsMatch) {
      content = content.replace(/^FB_GROUP_URLS=.*$/m, `FB_GROUP_URLS=${updatedGroupUrlsStr}`);
    } else {
      content += `\nFB_GROUP_URLS=${updatedGroupUrlsStr}`;
    }

    writeFileSync(envFile, content, 'utf-8');

    // Atualiza variáveis em memória
    process.env.FB_GROUP_URLS = updatedGroupUrlsStr;

    // Sincroniza no Neon DB
    const db = getDbPool();
    if (db) {
      db.query(
        `INSERT INTO app_settings (key, value) VALUES ('FB_GROUP_URLS', $1)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [updatedGroupUrlsStr]
      ).catch(() => {});
    }

    console.log(`\n✅ [SYNC] SUCESSO! GRUPOS DO SEU PERFIL SINCRONIZADOS NO .ENV E NEON DB:`);
    console.log(`  📊 Total de Grupos Encontrados: ${totalGroupsCount}`);
    console.log(`  🔗 FB_GROUP_URLS atualizado com todas as URLs`);
    console.log(`  🎯 FB_MAX_GROUPS_PER_CYCLE atualizado para ${totalGroupsCount}\n`);

    return { totalGroups: totalGroupsCount, updated: true };
  } catch (error) {
    console.error(`  ❌ [SYNC] Erro ao sincronizar grupos do perfil:`, error);
    return { totalGroups: 0, updated: false };
  }
}

/**
 * Executa a varredura e sincronização dos grupos participados do perfil no Facebook sob demanda (via API/Painel).
 */
export async function syncFacebookProfileGroups(): Promise<{ totalGroups: number; groups: string[]; updated: boolean }> {
  console.log('[FB-SYNC] 🌐 Iniciando varredura e sincronização de grupos do perfil do Facebook...');
  try {
    const context = await openFacebookBrowser();
    const page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    const result = await syncJoinedFacebookGroups(page);

    let currentGroupUrls: string[] = [];
    if (process.env.FB_GROUP_URLS) {
      currentGroupUrls = process.env.FB_GROUP_URLS.split(',').map((u) => u.trim()).filter(Boolean);
    }

    return { totalGroups: result.totalGroups || currentGroupUrls.length, groups: currentGroupUrls, updated: result.updated };
  } catch (err) {
    console.error('[FB-SYNC] Erro ao sincronizar grupos do Facebook:', err);
    return { totalGroups: 0, groups: [], updated: false };
  }
}

/**
 * Substitui uma URL temporária de compartilhamento (share/g/...) pela URL canônica oficial do grupo (groups/ID/) no .env
 */
export function replaceGroupUrlInEnv(oldUrl: string, cleanCanonicalUrl: string): void {
  try {
    const envFile = join(process.cwd(), '.env');
    if (!existsSync(envFile)) return;

    let content = readFileSync(envFile, 'utf-8');
    const groupUrlsMatch = content.match(/^FB_GROUP_URLS=(.*)$/m);
    if (!groupUrlsMatch || !groupUrlsMatch[1].trim()) return;

    let currentUrls = groupUrlsMatch[1].split(',').map((u) => u.trim()).filter(Boolean);

    let modified = false;
    const updatedUrls: string[] = [];

    for (const url of currentUrls) {
      if (url === oldUrl || url.toLowerCase() === oldUrl.toLowerCase()) {
        if (!updatedUrls.includes(cleanCanonicalUrl)) {
          updatedUrls.push(cleanCanonicalUrl);
        }
        modified = true;
      } else {
        if (!updatedUrls.includes(url)) {
          updatedUrls.push(url);
        }
      }
    }

    if (modified) {
      const updatedStr = updatedUrls.join(',');
      content = content.replace(/^FB_GROUP_URLS=.*$/m, `FB_GROUP_URLS=${updatedStr}`);
      content = content.replace(/^FB_MAX_GROUPS_PER_CYCLE=.*$/m, `FB_MAX_GROUPS_PER_CYCLE=${updatedUrls.length}`);
      writeFileSync(envFile, content, 'utf-8');
      process.env.FB_GROUP_URLS = updatedStr;
      process.env.FB_MAX_GROUPS_PER_CYCLE = String(updatedUrls.length);
      console.log(`  ✨ URL do grupo resolvida e atualizada no .env: ${cleanCanonicalUrl}`);
    }
  } catch { /* ignora */ }
}

/**
 * Remove a URL de um grupo que está quebrado, deletado, ineficiente ou exige aprovação de administradores do arquivo .env e DB.
 */
export function removeInvalidGroupUrlFromEnv(groupUrl: string, reason?: string): void {
  try {
    const envFile = join(process.cwd(), '.env');
    if (!existsSync(envFile)) return;

    let content = readFileSync(envFile, 'utf-8');
    const groupUrlsMatch = content.match(/^FB_GROUP_URLS=(.*)$/m);
    if (!groupUrlsMatch || !groupUrlsMatch[1].trim()) return;

    const currentUrls = groupUrlsMatch[1].split(',').map((u) => u.trim()).filter(Boolean);
    const targetMatch = groupUrl.match(/facebook\.com\/groups\/([^\/?#]+)/i);
    const targetSlug = targetMatch && targetMatch[1] ? targetMatch[1].toLowerCase() : groupUrl.toLowerCase();

    const updatedUrls = currentUrls.filter((u) => {
      const uClean = u.toLowerCase();
      return !uClean.includes(targetSlug);
    });

    if (updatedUrls.length < currentUrls.length) {
      const updatedStr = updatedUrls.join(',');
      content = content.replace(/^FB_GROUP_URLS=.*$/m, `FB_GROUP_URLS=${updatedStr}`);

      writeFileSync(envFile, content, 'utf-8');
      process.env.FB_GROUP_URLS = updatedStr;

      // Sincroniza a remoção no banco Neon DB se disponível
      const db = getDbPool();
      if (db) {
        db.query(
          `INSERT INTO app_settings (key, value) VALUES ('FB_GROUP_URLS', $1)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
          [updatedStr]
        ).catch(() => {});
      }

      console.log(`  🗑️ [PURGA DE GRUPO] ${reason || 'Grupo ineficiente'} expurgado do .env e Neon DB: ${groupUrl}`);
      console.log(`  📊 Grupos eficientes restantes: ${updatedUrls.length}`);
    }
  } catch (err) {
    console.error('  ⚠️ Erro ao remover grupo do .env:', err);
  }
}

/**
 * Salva a URL de um novo grupo encontrado no arquivo .env
 * E incrementa o valor de FB_MAX_GROUPS_PER_CYCLE em +1.
 */
export function saveNewGroupToEnv(rawGroupUrl: string): { newTotal: number; newMax: number } | null {
  const envFile = join(process.cwd(), '.env');
  if (!existsSync(envFile)) return null;

  let content = readFileSync(envFile, 'utf-8');

  // Limpa a URL para a estrutura oficial: https://www.facebook.com/groups/ID_DO_GRUPO/
  const match = rawGroupUrl.match(/facebook\.com\/groups\/([^\/?#]+)/i);
  if (!match || !match[1]) return null;

  const cleanGroupUrl = `https://www.facebook.com/groups/${match[1]}/`;

  // Lê FB_GROUP_URLS do .env
  const groupUrlsMatch = content.match(/^FB_GROUP_URLS=(.*)$/m);
  let currentGroupUrls: string[] = [];
  if (groupUrlsMatch && groupUrlsMatch[1].trim()) {
    currentGroupUrls = groupUrlsMatch[1].split(',').map((u) => u.trim()).filter(Boolean);
  }

  // Verifica se o grupo já está no .env
  const exists = currentGroupUrls.some(u => u.toLowerCase().includes(match[1].toLowerCase()));
  if (exists) {
    return null; // Já cadastrado
  }

  // Adiciona novo grupo à lista
  currentGroupUrls.push(cleanGroupUrl);
  const updatedGroupUrlsStr = currentGroupUrls.join(',');

  // Lê FB_MAX_GROUPS_PER_CYCLE do .env e incrementa +1
  const maxMatch = content.match(/^FB_MAX_GROUPS_PER_CYCLE=(\d+)$/m);
  const currentMax = maxMatch ? parseInt(maxMatch[1], 10) : 5;
  const newMax = currentMax + 1;

  // Atualiza conteúdo do .env
  if (groupUrlsMatch) {
    content = content.replace(/^FB_GROUP_URLS=.*$/m, `FB_GROUP_URLS=${updatedGroupUrlsStr}`);
  } else {
    content += `\nFB_GROUP_URLS=${updatedGroupUrlsStr}`;
  }

  if (maxMatch) {
    content = content.replace(/^FB_MAX_GROUPS_PER_CYCLE=.*$/m, `FB_MAX_GROUPS_PER_CYCLE=${newMax}`);
  } else {
    content += `\nFB_MAX_GROUPS_PER_CYCLE=${newMax}`;
  }

  writeFileSync(envFile, content, 'utf-8');

  // Atualiza variáveis em memória
  process.env.FB_GROUP_URLS = updatedGroupUrlsStr;
  process.env.FB_MAX_GROUPS_PER_CYCLE = String(newMax);

  // Sincroniza no Neon DB
  const db = getDbPool();
  if (db) {
    db.query(
      `INSERT INTO app_settings (key, value) VALUES ('FB_GROUP_URLS', $1), ('FB_MAX_GROUPS_PER_CYCLE', $2)
       ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [updatedGroupUrlsStr, String(newMax)]
    ).catch(() => {});
  }

  console.log(`\n🎉 [AUTO-JOIN] NOVO GRUPO DO FACEBOOK ADICIONADO AO .ENV E NEON DB!`);
  console.log(`  🔗 Grupo: ${cleanGroupUrl}`);
  console.log(`  📊 FB_GROUP_URLS atualizado (${currentGroupUrls.length} grupos cadastrados no .env)`);
  console.log(`  ⬆️ FB_MAX_GROUPS_PER_CYCLE incrementado de ${currentMax} para ${newMax} no .env\n`);

  return { newTotal: currentGroupUrls.length, newMax: newMax };
}

/**
 * Busca e solicita entrada automática em novos grupos de ofertas no Facebook.
 */
export async function autoDiscoverAndJoinFacebookGroups(
  page: Page,
  maxToJoinPerRun: number = 1
): Promise<number> {
  const searchTerms = [
    'ofertas e promoções',
    'achadinhos mercado livre',
    'cupons de desconto',
    'ofertas do dia',
    'compras e vendas ofertas',
  ];

  // Escolhe um termo de busca randômico
  const searchTerm = searchTerms[Math.floor(Math.random() * searchTerms.length)];
  const searchUrl = `https://www.facebook.com/search/groups/?q=${encodeURIComponent(searchTerm)}`;

  console.log(`  🔎 [AUTO-JOIN] Buscando novos grupos com termo: "${searchTerm}"...`);

  try {
    await page.goto(searchUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 5000);

    // Scroll leve para carregar cartões de grupos
    await page.evaluate(() => window.scrollTo(0, 600));
    await randomDelay(2000, 3000);

    // Localiza cartões/links de grupos na busca
    const joinedCount = await page.evaluate(async (maxToJoin) => {
      const groupLinks = Array.from(document.querySelectorAll('a[href*="/groups/"]')) as HTMLAnchorElement[];
      let joined = 0;

      for (const link of groupLinks) {
        if (joined >= maxToJoin) break;

        const href = link.href;
        if (!href || href.includes('/user/') || href.includes('/create/')) continue;

        // Encontra o container/card pai deste grupo
        let card = link.closest('[role="article"], [data-pagelet*="Item"]') || link.parentElement?.parentElement?.parentElement;
        if (!card) continue;

        const cardText = card.textContent?.toLowerCase() || '';

        // Se já for membro ou já solicitou, pula
        if (
          cardText.includes('participou') ||
          cardText.includes('solicitado') ||
          cardText.includes('membro') ||
          cardText.includes('joined') ||
          cardText.includes('requested') ||
          cardText.includes('pending') ||
          cardText.includes('visitar')
        ) {
          continue;
        }

        // Procura o botão de participar do grupo
        const joinButtons = Array.from(card.querySelectorAll('[role="button"], button')) as HTMLElement[];
        const joinBtn = joinButtons.find(b => {
          const text = (b.textContent || b.getAttribute('aria-label') || '').toLowerCase();
          return text.includes('participar') || text.includes('entrar') || text.includes('join');
        });

        if (joinBtn) {
          // Clique simulado no botão Participar
          joinBtn.click();
          joined++;
        }
      }

      return joined;
    }, maxToJoinPerRun);

    if (joinedCount > 0) {
      console.log(`  ✅ Solicitação de participação enviada para ${joinedCount} novo(s) grupo(s)!`);
      await randomDelay(3000, 5000);

      // Trata modais de regras/perguntas de entrada se surgirem
      await handleFacebookGroupRulesModal(page);

      // Extrai os links dos grupos para salvar no .env
      const groupLinksOnPage = await page.evaluate(() => {
        const links = Array.from(document.querySelectorAll('a[href*="/groups/"]')) as HTMLAnchorElement[];
        return links
          .map(l => l.href)
          .filter(h => h.includes('/groups/') && !h.includes('/search/') && !h.includes('/create/'));
      });

      for (const rawUrl of groupLinksOnPage) {
        saveNewGroupToEnv(rawUrl);
      }
    } else {
      console.log('  ℹ️ [AUTO-JOIN] Nenhum novo grupo pendente encontrado nesta busca.');
    }

    return joinedCount;
  } catch (err) {
    console.log(`  ⚠️ [AUTO-JOIN] Erro ao buscar novos grupos: ${err}`);
    return 0;
  }
}

export function checkFacebookSessionStatus(): { connected: boolean; profileExists: boolean } {
  const profileExists = existsSync(FB_PROFILE_DIR);
  if (!profileExists) return { connected: false, profileExists: false };
  const hasCookies = existsSync(join(FB_PROFILE_DIR, 'Default', 'Cookies')) || 
                     existsSync(join(FB_PROFILE_DIR, 'Default', 'Network', 'Cookies')) ||
                     existsSync(join(FB_PROFILE_DIR, 'Default', 'Storage'));
  return { connected: hasCookies, profileExists };
}
