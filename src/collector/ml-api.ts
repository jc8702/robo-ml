import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { join } from 'node:path';
import { existsSync, mkdirSync, unlinkSync } from 'node:fs';
import type { AppConfig } from '../config/settings.js';
import { findBrowserPath, isCloudEnvironment } from '../config/browser.js';
import { loadSentHistory, normalizeTitleKey, isLowestPriceIn30Days } from './history.js';
import { convertToOfficialMLAffiliateLink } from '../affiliate/link-converter.js';


/** Representa uma oferta coletada do Mercado Livre */
export interface MLOffer {
  id: string;
  title: string;
  permalink: string;
  affiliateLink?: string;
  thumbnail: string;
  originalPrice: number;
  currentPrice: number;
  discountPercent: number;
  freeShipping: boolean;
  seller: string;
  condition: 'new' | 'used';
  soldQuantity: number;
  isLowest30Days?: boolean;
}


const BROWSER_PROFILE_DIR = join(process.cwd(), '.chrome-profile');

let activeMLContext: BrowserContext | null = null;
let activeMLBrowser: Browser | null = null;


function cleanProfileLock(profileDir: string) {
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

/**
 * Cria uma instância com perfil persistente + contexto com User-Agent oficial de Desktop Chrome.
 */
async function openBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  const executablePath = findBrowserPath();
  const isCloud = isCloudEnvironment();

  if (!existsSync(BROWSER_PROFILE_DIR)) {
    mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
  }

  const contextOptions: any = {
    headless: isCloud,
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    locale: 'pt-BR',
    extraHTTPHeaders: {
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
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
    context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, contextOptions);
  } catch {
    cleanProfileLock(BROWSER_PROFILE_DIR);
    try {
      context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, contextOptions);
    } catch {
      delete contextOptions.executablePath;
      const browser = await chromium.launch({
        headless: isCloud,
        args: contextOptions.args,
        executablePath: findBrowserPath(),
      });
      context = await browser.newContext({
        viewport: contextOptions.viewport,
        userAgent: contextOptions.userAgent,
        locale: contextOptions.locale,
        extraHTTPHeaders: contextOptions.extraHTTPHeaders,
      });
      return { browser, context };
    }
  }

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return { browser: context as any, context };
}

/**
 * Obtém ou reaproveita o contexto de navegador ativo do Mercado Livre
 */
async function getOrCreateMLContext(): Promise<{ browser: Browser; context: BrowserContext }> {
  if (isContextValid(activeMLContext)) {
    return { browser: activeMLBrowser || (activeMLContext as any), context: activeMLContext! };
  }

  activeMLContext = null;
  activeMLBrowser = null;
  cleanProfileLock(BROWSER_PROFILE_DIR);

  const res = await openBrowser();
  activeMLBrowser = res.browser;
  activeMLContext = res.context;
  return res;
}

/**
 * Verifica se a página atual tem sessão de usuário ativa no Mercado Livre.
 */
export async function isMLLoggedIn(page: Page): Promise<boolean> {
  try {
    const currentUrl = page.url();
    if (!currentUrl.includes('mercadolivre.com.br')) {
      await page.goto('https://www.mercadolivre.com.br', { waitUntil: 'domcontentloaded', timeout: 15000 }).catch(() => {});
    }

    // 1. Checagem via Cookies de Contexto do Playwright (Fiel e imune a alterações de layout)
    const context = page.context();
    if (context) {
      const cookies = await context.cookies('https://www.mercadolivre.com.br').catch(() => []);
      const hasAuthCookie = cookies.some(c => 
        ['ssid', 'org_session', 'cp', '_m_user', 'is_user_logged_in', 'user_id', 'org_user_id'].includes(c.name)
      );
      if (hasAuthCookie) return true;
    }

    // 2. Checagem no DOM da página
    const isLoggedIn = await page.evaluate(() => {
      const userSelectors = [
        '.nav-header-username',
        '.nav-header-user-name',
        '.nav-header-user',
        '.nav-header-avatar',
        'label[for="nav-header-user-switch"]',
        'a[href*="my-account"]',
        'a[href*="compras"]',
        'a[href*="favoritos"]',
        '#nav-header-user-switch'
      ];
      
      const hasUserElement = userSelectors.some(sel => !!document.querySelector(sel));
      if (hasUserElement) return true;

      const navUserText = (document.querySelector('header.nav-header, nav.nav-header-menu, div.nav-header-user')?.textContent || '').toLowerCase();
      if (navUserText.includes('compras') || navUserText.includes('favoritos')) return true;

      const cookies = document.cookie;
      return cookies.includes('org_session') || cookies.includes('ssid') || cookies.includes('cp') || cookies.includes('_m_user');
    });

    return isLoggedIn;
  } catch (err) {
    console.error('[ML] Erro ao verificar login no Mercado Livre:', err);
    return false;
  }
}

/**
 * Retorna se o usuário está logado no Mercado Livre (para uso na API REST).
 */
export async function checkMLLoginStatus(): Promise<boolean> {
  try {
    const { context } = await getOrCreateMLContext();
    const pages = context.pages().filter(p => !p.isClosed());
    const page = pages.length > 0 ? pages[0] : await context.newPage();
    return await isMLLoggedIn(page);
  } catch (err) {
    console.error('[ML] Erro ao verificar status do Mercado Livre:', err);
    return false;
  }
}

/**
 * Abre o Chrome visível para que o usuário efetue o login na sua conta do Mercado Livre.
 */
export async function openMLLoginBrowser(): Promise<BrowserContext> {
  const { context } = await getOrCreateMLContext();
  const pages = context.pages().filter(p => !p.isClosed());
  const page = pages.length > 0 ? pages[0] : await context.newPage();
  
  await page.goto('https://www.mercadolivre.com.br/', { waitUntil: 'domcontentloaded' });
  
  const logged = await isMLLoggedIn(page);
  if (!logged) {
    const loginBtn = page.locator('a[data-link-id="login"], a:has-text("Entre"), nav a[href*="login"]').first();
    if (await loginBtn.isVisible().catch(() => false)) {
      await loginBtn.click().catch(() => {});
    }
  }
  return context;
}





/**
 * Extrai o link curto oficial de afiliado (meli.la) acionando a barra oficial de afiliados do Mercado Livre.
 */
export async function fetchOfficialAffiliateShortLink(
  page: Page,
  permalink: string
): Promise<string | null> {
  try {
    const cleanUrl = permalink.split('?')[0].split('#')[0];
    const currentUrl = page.url();
    if (!currentUrl.includes(cleanUrl)) {
      await page.goto(cleanUrl, { waitUntil: 'domcontentloaded', timeout: 20000 }).catch(() => {});
    }

    await page.waitForTimeout(1200);

    // 0. Verifica se a página ou a barra já contêm diretamente um link curto (meli.la / mercadolivre.com/sec)
    const directVal = await page.evaluate(() => {
      const elements = Array.from(document.querySelectorAll('a[href], input[value], textarea'));
      for (const el of elements) {
        const val = (el as HTMLAnchorElement).href || (el as HTMLInputElement).value || el.textContent || '';
        if (val.includes('meli.la/') || val.includes('mercadolivre.com/sec/') || val.includes('mliv.re/')) {
          const match = val.match(/https?:\/\/(?:meli\.la|mercadolivre\.com\/sec|mliv\.re)\/[a-zA-Z0-9_-]+/i);
          if (match) return match[0];
        }
      }
      return null;
    });

    if (directVal) {
      console.log(`  ✨ Link curto oficial extraído diretamente da página Mercado Livre: ${directVal}`);
      return directVal;
    }

    // Procura o botão de ação na barra superior/inferior de afiliados do Mercado Livre
    const shareBtn = page.locator(
      'button:has-text("Compartilhar"), button:has-text("Gerar link"), button:has-text("Gerar Link"), button:has-text("Copiar link"), button:has-text("Copiar Link"), div:has-text("GANHOS") button, button[class*="share"], button[class*="affiliate"], a:has-text("Compartilhar"), a:has-text("Gerar link")'
    ).first();
    
    if (await shareBtn.isVisible({ timeout: 4000 }).catch(() => false)) {
      await shareBtn.click().catch(() => {});
      await page.waitForTimeout(1200);

      // 1. Tenta pegar o valor de um input que contenha 'meli.la' ou 'mercadolivre.com/sec'
      const meliInput = page.locator('input[value*="meli.la"], input[value*="mercadolivre.com/sec"], input[value*="mliv.re"]').first();
      if (await meliInput.isVisible({ timeout: 3000 }).catch(() => false)) {
        const val = await meliInput.inputValue().catch(() => '');
        if (val && val.startsWith('http')) {
          console.log(`  ✨ Link curto oficial extraído da barra Mercado Livre: ${val}`);
          await page.keyboard.press('Escape').catch(() => {});
          return val;
        }
      }

      // 2. Fallback de varredura no modal de compartilhamento
      const extractedVal = await page.evaluate(() => {
        const inputs = Array.from(document.querySelectorAll('input, textarea, a[href], p, span, div'));
        for (const input of inputs) {
          const val = (input as HTMLInputElement).value || (input as HTMLAnchorElement).href || input.textContent || '';
          if (val.includes('meli.la/') || val.includes('mercadolivre.com/sec/') || val.includes('mliv.re/')) {
            const match = val.match(/https?:\/\/(?:meli\.la|mercadolivre\.com\/sec|mliv\.re)\/[a-zA-Z0-9_-]+/i);
            if (match) return match[0];
          }
        }
        return null;
      });

      await page.keyboard.press('Escape').catch(() => {});

      if (extractedVal) {
        console.log(`  ✨ Link curto oficial extraído da barra Mercado Livre: ${extractedVal}`);
        return extractedVal;
      }
    }
  } catch (err) {
    console.warn(`  ⚠️ Não foi possível extrair o link pela barra de afiliados: ${err instanceof Error ? err.message : String(err)}`);
  }
  return null;
}

/**
 * Converte o termo de busca em uma URL limpa nativa do Mercado Livre
 */

function toMLSearchUrl(query: string): string {
  const queryLower = query.toLowerCase().trim();
  const dealCampaignTerms = [
    'ofertas do dia', 'ofertas relampago', 'mais vendidos', 'menos de 50 reais',
    'ofertas de mercado', 'liquidação queima de estoque', 'cupons e descontos',
    'menor preco 30 dias', 'ofertas', 'promocoes', 'promoção', 'desconto',
    'achadinhos', 'oferta', 'queima de estoque', 'liquidação', 'destaques'
  ];
  if (dealCampaignTerms.some((term) => queryLower.includes(term))) {
    return 'https://www.mercadolivre.com.br/ofertas';
  }
  const normalized = queryLower.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  const cleanSlug = normalized.replace(/[^a-z0-9\s-]/g, '').trim().replace(/\s+/g, '-');
  if (cleanSlug.length > 0) {
    return `https://lista.mercadolivre.com.br/${cleanSlug}`;
  }
  return `https://lista.mercadolivre.com.br/${encodeURIComponent(queryLower)}`;
}

/**
 * Extrai ofertas da página de busca do ML.
 */
async function extractOffers(page: Page): Promise<MLOffer[]> {
  return page.evaluate(() => {
    (window as any).__name = (fn: any) => fn;
    const __name = (fn: any) => fn;
    const results: any[] = [];
    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    
    const productAnchors = anchors.filter(a => {
      const href = (a.getAttribute('href') || a.href || '').toLowerCase();
      return href.includes('/p/mlb') || href.includes('/mlb-') || href.includes('produto.mercadolivre.com.br/mlb');
    });

    const seenUrls = new Set<string>();

    function parsePrice(text: string | null | undefined): number {
      if (!text) return 0;
      const digitsOnly = text.replace(/[^\d]/g, '');
      if (!digitsOnly) return 0;
      return parseInt(digitsOnly, 10);
    }

    productAnchors.forEach((a, i) => {
      try {
        let rawHref = (a.href || a.getAttribute('href') || '').split('#')[0].split('?')[0];
        if (!rawHref || seenUrls.has(rawHref)) return;
        seenUrls.add(rawHref);

        const pMatch = rawHref.match(/\/p\/(MLB\d+)/i);
        const mlbMatch = rawHref.match(/(MLB-?\d+)/i);

        let permalink = rawHref;
        if (pMatch && pMatch[1]) {
          permalink = `https://www.mercadolivre.com.br/p/${pMatch[1]}`;
        } else if (mlbMatch && mlbMatch[1]) {
          permalink = `https://produto.mercadolivre.com.br/${mlbMatch[1]}`;
        }

        const card = a.closest('.poly-card, .ui-search-result__wrapper, .ui-search-layout__item, li, article, .promotion-item') || a.parentElement || a;
        const titleEl = card.querySelector('h2, h3, .poly-component__title, [class*="title"]') || a;
        const title = titleEl?.textContent?.trim() || '';
        if (!title || title.length < 5) return;

        const imgEl = card.querySelector('img.poly-component__picture, img[data-testid="picture"], img') as HTMLImageElement | null;
        let thumbnail = imgEl ? (imgEl.getAttribute('src') || imgEl.src || imgEl.getAttribute('data-src') || '') : '';
        if (thumbnail.startsWith('//')) thumbnail = 'https:' + thumbnail;
        if (thumbnail && thumbnail.includes('mlstatic.com')) {
          thumbnail = thumbnail
            .replace(/\.webp$/i, '.jpg')
            .replace(/-(I|V|F)\.(jpg|webp)/gi, '-O.jpg');
        }

        const moneyElements = Array.from(card.querySelectorAll('.andes-money-amount')) as HTMLElement[];
        let currentPrice = 0;
        let originalPrice = 0;

        moneyElements.forEach(el => {
          const frac = el.querySelector('.andes-money-amount__fraction, [class*="fraction"]')?.textContent;
          const val = parsePrice(frac);
          if (!val) return;

          const isPrevious = el.classList.contains('andes-money-amount--previous') ||
                             el.closest('.andes-money-amount--previous, s, del') !== null;

          if (isPrevious) {
            originalPrice = val;
          } else if (currentPrice === 0) {
            currentPrice = val;
          }
        });

        if (currentPrice === 0 && moneyElements.length > 0) {
          currentPrice = parsePrice(moneyElements[0].querySelector('.andes-money-amount__fraction, [class*="fraction"]')?.textContent);
        }

        if (originalPrice === 0) {
          originalPrice = currentPrice;
        } else if (originalPrice < currentPrice) {
          const temp = originalPrice;
          originalPrice = currentPrice;
          currentPrice = temp;
        }

        if (currentPrice <= 0) {
          const text = card.textContent || '';
          const match = text.match(/R\$\s*([\d\.]+)/);
          if (match) {
            currentPrice = parsePrice(match[1]);
            originalPrice = currentPrice;
          }
        }

        if (currentPrice <= 0) return;

        const discountPercent = originalPrice > currentPrice
          ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
          : 0;

        const cardTextLower = (card.textContent || '').toLowerCase();
        const freeShipping = cardTextLower.includes('frete grátis');

        const isLowest30Days = cardTextLower.includes('menor preço') ||
                               cardTextLower.includes('menor preco') ||
                               cardTextLower.includes('últimos 30 dias') ||
                               cardTextLower.includes('ultimos 30 dias') ||
                               cardTextLower.includes('melhor preço');

        results.push({
          id: `ml-${i}`,
          title,
          permalink,
          thumbnail,
          originalPrice: originalPrice || currentPrice,
          currentPrice,
          discountPercent,
          freeShipping,
          seller: 'Vendedor Qualificado',
          condition: 'new',
          soldQuantity: 0,
          isLowest30Days,
        });
      } catch { /* skip */ }
    });

    return results;
  });
}

function isContextValid(context: BrowserContext | null): boolean {
  if (!context) return false;
  try {
    context.pages();
    return true;
  } catch {
    return false;
  }
}

/**
 * Busca ofertas no Mercado Livre utilizando uma página/contexto reutilizado.
 */
export async function searchOffers(
  query: string,
  config: AppConfig,
  existingContext?: BrowserContext,
  existingPage?: Page
): Promise<MLOffer[]> {
  let createdBrowser: Browser | null = null;
  let context: BrowserContext | null = existingContext || null;
  let page: Page | null = existingPage || null;
  const isStandalone = !existingPage;

  try {
    if (!isContextValid(context)) {
      const res = await openBrowser();
      createdBrowser = res.browser;
      context = res.context;
    }

    if (!page || page.isClosed()) {
      page = context!.pages().length > 0 ? context!.pages()[0] : await context!.newPage();
    }

    const queryLower = query.toLowerCase().trim();
    const url = toMLSearchUrl(query);

    console.log(`  📡 Acessando: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch {
      await page.waitForTimeout(2000);
    }

    // Espera a navegação estabilizar e realiza rolagem suave para carregar produtos lazy-load
    await page.waitForSelector('.poly-card, .ui-search-result, article, li.ui-search-layout__item, .promotion-item', { timeout: 8000 }).catch(() => {});
    await page.evaluate(() => window.scrollBy(0, 1800)).catch(() => {});
    await page.waitForTimeout(1500);

    const currentUrl = page.url();
    const pageTitle = await page.title().catch(() => '');
    console.log(`  🔎 URL Resolvida: "${currentUrl}" | Título: "${pageTitle}"`);

    let offers: MLOffer[] = [];
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        offers = await extractOffers(page);
        console.log(`  [DEBUG] Tentativa ${attempt + 1}: ${offers.length} ofertas brutas extraídas`);
        if (offers.length > 0 && !page.url().includes('account-verification')) break;
        await page.waitForTimeout(1500);
      } catch (err) {
        console.log(`  [DEBUG] Tentativa ${attempt + 1} falhou com erro: ${err}`);
        await page.waitForTimeout(1500);
      }
    }

    const isGenericQuery = url.includes('/ofertas');
    const queryKeywords = queryLower
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    let relevantOffers = offers.filter((offer) => {
      if (isGenericQuery) return true;
      const titleLower = offer.title.toLowerCase();
      if (queryLower.includes('playstation')) {
        return titleLower.includes('playstation') || titleLower.includes('ps5') || titleLower.includes('ps4') || titleLower.includes('dualsense');
      }
      if (queryLower.includes('xbox')) {
        return titleLower.includes('xbox') || titleLower.includes('series') || titleLower.includes('controle xbox');
      }
      if (queryLower.includes('nintendo')) {
        return titleLower.includes('nintendo') || titleLower.includes('switch') || titleLower.includes('joy-con');
      }
      return queryKeywords.some((keyword) => titleLower.includes(keyword));
    });

    // Fallback: se caiu em account-verification ou 0 ofertas, acessa o feed /ofertas
    if (page.url().includes('account-verification') || relevantOffers.length === 0) {
      console.log(`  ⚠️ 0 ofertas com filtro rígido para "${query}". Utilizando produtos do feed de ofertas...`);
      if (offers.length > 0) {
        relevantOffers = offers;
      } else {
        await page.goto('https://www.mercadolivre.com.br/ofertas', { waitUntil: 'domcontentloaded', timeout: 25000 }).catch(() => {});
        await page.waitForTimeout(2500);
        const fallbackOffers = await extractOffers(page);
        if (fallbackOffers.length > 0) {
          relevantOffers = fallbackOffers;
          console.log(`  [DEBUG] Feed /ofertas: ${fallbackOffers.length} ofertas promocionais obtidas.`);
        }
      }
    }

    console.log(`  📦 ${offers.length} no ML ➔ ${relevantOffers.length} filtrados com precisão para "${query}"`);

    // Apenas fecha a página/browser se foram criados pontualmente nesta função (modo standalone)
    if (isStandalone && page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    if (createdBrowser) {
      await createdBrowser.close().catch(() => {});
    }

    return relevantOffers;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ Erro ao buscar "${query}": ${msg}`);
    if (isStandalone && page && !page.isClosed()) {
      await page.close().catch(() => {});
    }
    if (createdBrowser) {
      await createdBrowser.close().catch(() => {});
    }
    return [];
  }
}

/**
 * Coleta ofertas de múltiplas queries reutilizando 1 único contexto e página do navegador.
 * Possui auto-recuperação resiliente caso a página ou contexto seja desconectado.
 */
export async function collectOffers(
  queries: string[],
  config: AppConfig
): Promise<MLOffer[]> {
  const allOffers: MLOffer[] = [];
  const history = loadSentHistory();

  const priorityCats = config.filters.priorityCategories || [];
  const usePriorityOnly = config.filters.usePriorityOnly === true;

  let activeQueries: string[] = [];
  if (usePriorityOnly && priorityCats.length > 0) {
    activeQueries = priorityCats;
    console.log(`\n🎯 [MODO FOCADO ATIVO] Minerando exclusivamente nas ${priorityCats.length} categorias/subcategorias prioritárias na ordem configurada (1 a 10)...`);
  } else if (priorityCats.length > 0) {
    const remaining = queries.filter((q) => !priorityCats.includes(q));
    activeQueries = [...priorityCats, ...remaining];
    console.log(`\n🚀 [MODO AMPLO COM PRIORIDADE] Iniciando varredura com ${priorityCats.length} categorias prioritárias seguidas por mais ${remaining.length} categorias do catálogo...`);
  } else {
    activeQueries = queries;
  }

  console.log(`\n📚 Histórico carregado: ${history.size} registros de envios anteriores (produtos não serão repetidos).`);

  let sharedBrowser: Browser | null = null;
  let sharedContext: BrowserContext | null = null;
  let sharedPage: Page | null = null;

  async function ensurePage(): Promise<Page> {
    if (isContextValid(sharedContext) && sharedPage && !sharedPage.isClosed()) {
      return sharedPage;
    }

    const res = await getOrCreateMLContext();
    sharedBrowser = res.browser;
    sharedContext = res.context;

    const pages = sharedContext.pages().filter(p => !p.isClosed());
    if (pages.length > 0) {
      sharedPage = pages[0];
      for (let i = 1; i < pages.length; i++) {
        if (pages[i].url() === 'about:blank') {
          await pages[i].close().catch(() => {});
        }
      }
    } else {
      sharedPage = await sharedContext.newPage();
    }
    return sharedPage;
  }

  try {
    const firstPage = await ensurePage();
    const loggedIn = await isMLLoggedIn(firstPage);
    if (!loggedIn) {
      console.error('\n  🔴 MINERAÇÃO CANCELADA: A conta do Mercado Livre não está logada no navegador!');
      throw new Error("⚠️ LOGIN NO MERCADO LIVRE NÃO DETECTADO! Acesse a aba '🔑 Conexões & Logins Locais' no painel e clique em '🟡 Conectar / Logar Mercado Livre' para autenticar sua conta antes de iniciar a mineração de ofertas.");
    }

    for (let i = 0; i < activeQueries.length; i++) {
      const query = activeQueries[i];
      console.log(`\n🔍 Buscando (Usuário Logado - Prioridade ${i + 1}): "${query}"...`);

      try {
        const page = await ensurePage();
        const offers = await searchOffers(query, config, sharedContext!, page);

        for (const offer of offers) {
          const titleKey = normalizeTitleKey(offer.title);
          if (history.has(offer.permalink) || history.has(titleKey)) {
            continue;
          }

          offer.isLowest30Days = isLowestPriceIn30Days(titleKey, offer.currentPrice, offer.isLowest30Days);
          allOffers.push(offer);
        }
      } catch (queryErr) {
        console.error(`  ❌ Erro ao buscar "${query}": ${queryErr instanceof Error ? queryErr.message : String(queryErr)}`);
        sharedPage = null;
        if (!isContextValid(sharedContext)) {
          sharedContext = null;
          sharedBrowser = null;
        }
      }

      if (i < activeQueries.length - 1) {
        await new Promise((r) => setTimeout(r, 1200));
      }
    }
  } catch (err) {
    console.error('[ML] Erro no ciclo de coleta de ofertas:', err);
  } finally {
    const curCtx = sharedContext as BrowserContext | null;
    if (curCtx && curCtx !== activeMLContext && isContextValid(curCtx)) {
      const curPage = sharedPage as Page | null;
      if (curPage && !curPage.isClosed()) {
        await curPage.close().catch(() => {});
      }
      await curCtx.close().catch(() => {});
    }
  }



  const filtered = allOffers
    .filter((offer) => offer.currentPrice >= config.filters.minPrice && offer.currentPrice <= config.filters.maxPrice)
    .filter((offer) => (offer.discountPercent || 0) >= config.filters.minDiscount);

  const bestByTitle = new Map<string, MLOffer>();
  for (const offer of filtered) {
    const key = normalizeTitleKey(offer.title);
    const existing = bestByTitle.get(key);
    if (!existing || offer.currentPrice < existing.currentPrice) {
      bestByTitle.set(key, offer);
    }
  }

  const deduplicated = Array.from(bestByTitle.values());
  const sorted = deduplicated.sort((a, b) => (b.discountPercent || 0) - (a.discountPercent || 0));
  const finalOffers = sorted.slice(0, config.filters.maxResults);

  // Para cada oferta final selecionada, aciona a barra de afiliados logada para obter o link meli.la oficial
  const verifiedOffers: MLOffer[] = [];
  if (finalOffers.length > 0) {
    console.log(`\n🔗 Verificando e extraindo links de afiliado oficiais (meli.la) para ${finalOffers.length} oferta(s)...`);
    try {
      const page = await getOrCreateMLContext().then((res) => (res.context.pages().length > 0 ? res.context.pages()[0] : res.context.newPage()));
      for (const offer of finalOffers) {
        let shortLink = await fetchOfficialAffiliateShortLink(page, offer.permalink);
        if (!shortLink) {
          // Fallback para conversão canônica oficial com matt_tool do Mercado Livre
          shortLink = convertToOfficialMLAffiliateLink(offer.permalink, config);
        }
        if (
          shortLink &&
          (shortLink.includes('meli.la/') ||
            shortLink.includes('mercadolivre.com/sec/') ||
            shortLink.includes('mliv.re/') ||
            shortLink.includes('matt_tool='))
        ) {
          offer.affiliateLink = shortLink;
          verifiedOffers.push(offer);
          console.log(`  ✅ [COMISSÃO CONFIRMADA] "${offer.title}" ➔ Link Afiliado: ${shortLink}`);
        } else {
          console.warn(`  🚫 [SEM COMISSÃO DESCARTADO] "${offer.title}" descartado pois NÃO gerou link de afiliado na barra oficial ML.`);
        }
      }
    } catch (shortErr) {
      console.warn('  ⚠️ Erro ao extrair links da barra de afiliados:', shortErr);
    }
  }

  console.log(`\n📊 Resumo do Coletor ML: ${allOffers.length} brutas ➔ ${filtered.length} após filtros ➔ ${verifiedOffers.length} ofertas com COMISSÃO DE AFILIADOS CONFIRMADA.`);
  return verifiedOffers;
}



