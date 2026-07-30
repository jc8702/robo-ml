import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
import type { AppConfig } from '../config/settings.js';
import { loadSentHistory, normalizeTitleKey, isLowestPriceIn30Days } from './history.js';

/** Representa uma oferta coletada do Mercado Livre */
export interface MLOffer {
  id: string;
  title: string;
  permalink: string;
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

/**
 * Encontra o Chrome/Chromium no sistema (Windows ou Linux/Docker/Render).
 */
function findBrowserPath(): string | undefined {
  if (process.env.EXECUTABLE_PATH && existsSync(process.env.EXECUTABLE_PATH)) {
    return process.env.EXECUTABLE_PATH;
  }

  const homeDir = homedir();
  const candidates: string[] = [];

  if (process.platform === 'win32') {
    const pwDir = join(homeDir, 'AppData', 'Local', 'ms-playwright');
    if (existsSync(pwDir)) {
      const dirs = readdirSync(pwDir)
        .filter((d: string) => d.startsWith('chromium'))
        .sort();
      for (const dir of dirs.reverse()) {
        candidates.push(join(pwDir, dir, 'chrome-win', 'chrome.exe'));
      }
    }
    candidates.push(
      'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
      'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
      join(homeDir, 'AppData', 'Local', 'Google', 'Chrome', 'Application', 'chrome.exe'),
    );
  } else {
    // Linux / Docker / Render
    const pwDir = '/ms-playwright';
    if (existsSync(pwDir)) {
      try {
        const dirs = readdirSync(pwDir)
          .filter((d: string) => d.startsWith('chromium'))
          .sort();
        for (const dir of dirs.reverse()) {
          candidates.push(join(pwDir, dir, 'chrome-linux', 'chrome'));
        }
      } catch {}
    }
    candidates.push(
      '/usr/bin/google-chrome-stable',
      '/usr/bin/google-chrome',
      '/usr/bin/chromium-browser',
      '/usr/bin/chromium'
    );
  }

  for (const p of candidates) {
    if (existsSync(p)) return p;
  }

  return undefined;
}

/**
 * Abre browser com perfil persistente e User-Agent oficial de Desktop Chrome.
 */
async function openBrowser(): Promise<BrowserContext> {
  const executablePath = findBrowserPath();
  const isCloud = !!process.env.RENDER || process.env.HEADLESS === 'true' || process.platform !== 'win32';

  if (!existsSync(BROWSER_PROFILE_DIR)) {
    mkdirSync(BROWSER_PROFILE_DIR, { recursive: true });
  }

  const launchOptions: any = {
    headless: isCloud,
    locale: 'pt-BR',
    viewport: { width: 1366, height: 768 },
    // CRÍTICO: User-Agent oficial de Chrome para evitar detecção Headless no Mercado Livre
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
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
      '--disable-gpu',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  };

  if (executablePath) {
    launchOptions.executablePath = executablePath;
  }

  const context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, launchOptions);

  // Stealth: esconde sinais de automação no DOM
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

  return context;
}

/**
 * Verifica se a página carregou resultados de busca.
 */
async function hasSearchResults(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const hasProductLinks = document.querySelectorAll('a[href*="/p/MLB"], a[href*="produto.mercadolivre.com.br"], a[href*="mercadolivre.com.br/MLB"]').length > 0;
    if (hasProductLinks) return true;

    const selectors = [
      '.ui-search-layout__item',
      '.ui-search-result__wrapper',
      '[class*="poly-card"]',
      '[class*="ui-search"]',
      '.ui-search-results',
      'ol.ui-search-layout',
      'li.ui-search-layout__item',
      '.ui-search-item',
      'section.ui-search-results',
      'div.ui-search-result',
    ];
    return selectors.some(s => document.querySelectorAll(s).length > 0);
  });
}

/**
 * Extrai ofertas da página de busca do ML com validação de vendedor qualificado.
 */
async function extractOffers(page: Page): Promise<MLOffer[]> {
  return page.evaluate(() => {
    const results: any[] = [];

    let rawItems = Array.from(document.querySelectorAll('.ui-search-layout__item, [class*="poly-card"], .ui-search-result__wrapper, li.ui-search-layout__item, [class*="ui-search-result"], div.ui-search-result__content-wrapper'));
    
    if (rawItems.length === 0) {
      const anchors = document.querySelectorAll('a[href*="mercadolivre.com.br"]');
      anchors.forEach(a => {
        const parent = a.closest('li, article, div[class*="search"], div[class*="card"], div[class*="item"]') || a.parentElement;
        if (parent && !rawItems.includes(parent)) rawItems.push(parent);
      });
    }

    rawItems.forEach((item, i) => {
      try {
        const link = item.querySelector('a[href*="mercadolivre.com.br"]') as HTMLAnchorElement;
        if (!link) return;
        let rawHref = link.href.split('#')[0].split('?')[0];

        const pMatch = rawHref.match(/\/p\/(MLB\d+)/i);
        const mlbMatch = rawHref.match(/(MLB-?\d+)/i);

        let permalink = rawHref;
        if (pMatch && pMatch[1]) {
          permalink = `https://www.mercadolivre.com.br/p/${pMatch[1]}`;
        } else if (mlbMatch && mlbMatch[1]) {
          permalink = `https://produto.mercadolivre.com.br/${mlbMatch[1]}`;
        }

        const titleEl = item.querySelector('h2, h3, [class*="title"], .poly-component__title');
        const title = titleEl?.textContent?.trim() || '';
        if (!title || title.length < 5) return;

        const itemText = item.textContent || '';
        const itemTextLower = itemText.toLowerCase();
        const isOfficial = item.querySelector('.ui-search-official-store-label, [class*="official"]') !== null || itemTextLower.includes('loja oficial');
        const isLeader = itemTextLower.includes('mercadolíder') || itemTextLower.includes('mercadolider');
        const isFull = itemText.includes('FULL');
        const sellerEl = item.querySelector('.poly-component__seller, .ui-search-official-store-label, [class*="seller"]');
        const sellerName = sellerEl?.textContent?.trim() || (isOfficial ? 'Loja Oficial' : (isLeader ? 'MercadoLíder' : ''));

        const isQualified = isOfficial || isLeader || isFull || sellerName.length > 0;
        if (!isQualified) return;

        const img = item.querySelector('img[src*="http"], img[data-src*="http"]') as HTMLImageElement | null;
        let thumbnail = img?.src || img?.getAttribute('data-src') || '';
        if (thumbnail) {
          thumbnail = thumbnail.replace(/-I\.jpg/g, '-O.jpg').replace(/-V\.jpg/g, '-O.jpg');
        }

        const priceParts = item.querySelectorAll('.andes-money-amount__fraction');
        let currentPrice = 0;
        let originalPrice = 0;

        if (priceParts.length >= 2) {
          const first = priceParts[0];
          const second = priceParts[1];
          const firstIsOld = first.closest('s, del, [class*="previous"]') !== null;

          if (firstIsOld) {
            originalPrice = parseFloat(first.textContent?.replace(/\./g, '') || '0');
            currentPrice = parseFloat(second.textContent?.replace(/\./g, '') || '0');
          } else {
            currentPrice = parseFloat(first.textContent?.replace(/\./g, '') || '0');
            originalPrice = currentPrice;
          }
        } else if (priceParts.length === 1) {
          currentPrice = parseFloat(priceParts[0].textContent?.replace(/\./g, '') || '0');
          originalPrice = currentPrice;
        }

        if (currentPrice <= 0) return;

        const discountPercent = originalPrice > currentPrice
          ? Math.round(((originalPrice - currentPrice) / originalPrice) * 100)
          : 0;

        const freeShipping = itemTextLower.includes('frete grátis');

        const isLowest30Days = itemTextLower.includes('menor preço') ||
                               itemTextLower.includes('menor preco') ||
                               itemTextLower.includes('últimos 30 dias') ||
                               itemTextLower.includes('ultimos 30 dias') ||
                               itemTextLower.includes('melhor preço');

        results.push({
          id: `ml-${i}`,
          title,
          permalink,
          thumbnail,
          originalPrice: originalPrice || currentPrice,
          currentPrice,
          discountPercent,
          freeShipping,
          seller: sellerName || 'Vendedor Qualificado',
          condition: 'new',
          soldQuantity: 0,
          isLowest30Days,
        });
      } catch { /* skip */ }
    });

    return results;
  });
}

/**
 * Busca ofertas no Mercado Livre utilizando um contexto de navegador existente (ou cria um novo se omitido).
 */
export async function searchOffers(
  query: string,
  config: AppConfig,
  existingContext?: BrowserContext
): Promise<MLOffer[]> {
  const shouldCloseContext = !existingContext;
  let context: BrowserContext | null = existingContext || null;
  let page: Page | null = null;

  try {
    if (!context) {
      context = await openBrowser();
    }

    page = await context.newPage();

    const searchQuery = query.replace(/\s+/g, '-');
    const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(searchQuery)}`;

    console.log(`  📡 Acessando: ${url}`);

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch {
      await page.waitForTimeout(2000);
    }

    await page.waitForTimeout(2500);

    let hasResults = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        hasResults = await hasSearchResults(page);
        if (hasResults) break;
        await page.waitForTimeout(1500);
      } catch {
        await page.waitForTimeout(1500);
      }
    }

    const isCloud = !!process.env.RENDER || process.env.HEADLESS === 'true' || process.platform !== 'win32';

    if (!hasResults && isCloud) {
      const directOffers = await extractOffers(page);
      if (directOffers.length > 0) {
        hasResults = true;
      }
    }

    if (hasResults) {
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
      await page.waitForTimeout(1000);

      const offers = await extractOffers(page);

      const queryLower = query.toLowerCase().trim();
      const isGenericQuery = ['ofertas do dia', 'mais vendidos', 'promoção', 'desconto', 'oferta'].includes(queryLower);

      const queryKeywords = queryLower
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length >= 3);

      const relevantOffers = offers.filter((offer) => {
        if (isGenericQuery) return true;
        const titleLower = offer.title.toLowerCase();
        return queryKeywords.some((keyword) => titleLower.includes(keyword));
      });

      console.log(`  📦 ${offers.length} no ML ➔ ${relevantOffers.length} filtrados com precisão para "${query}"`);

      await page.close().catch(() => {});
      if (shouldCloseContext && context) await context.close().catch(() => {});
      return relevantOffers;
    }

    await page.close().catch(() => {});
    if (shouldCloseContext && context) await context.close().catch(() => {});
    return [];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ Erro: ${msg}`);
    if (page) await page.close().catch(() => {});
    if (shouldCloseContext && context) await context.close().catch(() => {});
    return [];
  }
}

/**
 * Coleta ofertas de múltiplas queries com reutilização de 1 único navegador, deduplicação e filtro de histórico.
 */
export async function collectOffers(
  queries: string[],
  config: AppConfig
): Promise<MLOffer[]> {
  const allOffers: MLOffer[] = [];
  const history = loadSentHistory();

  console.log(`\n📚 Histórico carregado: ${history.size} registros de envios anteriores (produtos não serão repetidos).`);

  let sharedContext: BrowserContext | null = null;

  try {
    sharedContext = await openBrowser();

    for (const query of queries) {
      console.log(`\n🔍 Buscando: "${query}"...`);
      const offers = await searchOffers(query, config, sharedContext);

      for (const offer of offers) {
        const titleKey = normalizeTitleKey(offer.title);
        if (history.has(offer.permalink) || history.has(titleKey)) {
          continue;
        }

        offer.isLowest30Days = isLowestPriceIn30Days(titleKey, offer.currentPrice, offer.isLowest30Days);
        allOffers.push(offer);
      }

      if (queries.indexOf(query) < queries.length - 1) {
        await new Promise((r) => setTimeout(r, 1500));
      }
    }
  } catch (err) {
    console.error('[ML] Erro no ciclo de coleta de ofertas:', err);
  } finally {
    if (sharedContext) {
      await sharedContext.close().catch(() => {});
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

  console.log(`\n📊 Resumo do Coletor ML: ${allOffers.length} brutas ➔ ${filtered.length} após filtros ➔ ${finalOffers.length} melhores ofertas finalizadas.`);
  return finalOffers;
}
