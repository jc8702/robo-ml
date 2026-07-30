import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
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
 * Cria uma instância limpa do browser + contexto com User-Agent oficial de Desktop Chrome.
 */
async function openBrowser(): Promise<{ browser: Browser; context: BrowserContext }> {
  const executablePath = findBrowserPath();
  const isCloud = !!process.env.RENDER || process.env.HEADLESS === 'true' || process.platform !== 'win32';

  const launchOptions: any = {
    headless: isCloud,
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

  const browserInstance = await chromium.launch(launchOptions);
  const context = await browserInstance.newContext({
    locale: 'pt-BR',
    viewport: { width: 1366, height: 768 },
    userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
    extraHTTPHeaders: {
      'accept-language': 'pt-BR,pt;q=0.9,en-US;q=0.8,en;q=0.7',
      'sec-ch-ua': '"Chromium";v="124", "Google Chrome";v="124", "Not-A.Brand";v="99"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
    },
  });

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return { browser: browserInstance, context };
}

/**
 * Extrai ofertas da página de busca do ML.
 */
async function extractOffers(page: Page): Promise<MLOffer[]> {
  return page.evaluate(() => {
    const results: any[] = [];
    const anchors = Array.from(document.querySelectorAll('a[href]')) as HTMLAnchorElement[];
    
    const productAnchors = anchors.filter(a => {
      const href = a.getAttribute('href') || '';
      return href.includes('/p/MLB') || href.includes('produto.mercadolivre.com.br/MLB') || href.includes('/MLB-');
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

        const card = a.closest('.poly-card, .ui-search-result__wrapper, .ui-search-layout__item, li, article') || a.parentElement || a;
        const titleEl = card.querySelector('h2, h3, .poly-component__title, [class*="title"]') || a;
        const title = titleEl?.textContent?.trim() || '';
        if (!title || title.length < 5) return;

        const imgEl = card.querySelector('img.poly-component__picture, img[data-testid="picture"], img') as HTMLImageElement | null;
        let thumbnail = imgEl ? (imgEl.getAttribute('src') || imgEl.src || imgEl.getAttribute('data-src') || '') : '';
        if (thumbnail.startsWith('//')) thumbnail = 'https:' + thumbnail;
        if (thumbnail && thumbnail.includes('mlstatic.com')) {
          thumbnail = thumbnail.replace(/-I\.jpg/g, '-O.jpg').replace(/-V\.jpg/g, '-O.jpg').replace(/-F\.jpg/g, '-O.jpg');
        }

        const priceParts = card.querySelectorAll('.andes-money-amount__fraction, [class*="fraction"]');
        let currentPrice = 0;
        let originalPrice = 0;

        if (priceParts.length >= 2) {
          originalPrice = parsePrice(priceParts[0].textContent);
          currentPrice = parsePrice(priceParts[1].textContent);
        } else if (priceParts.length === 1) {
          currentPrice = parsePrice(priceParts[0].textContent);
          originalPrice = currentPrice;
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

/**
 * Busca ofertas no Mercado Livre utilizando uma página existente.
 */
export async function searchOffers(
  query: string,
  config: AppConfig,
  existingContext?: BrowserContext
): Promise<MLOffer[]> {
  let createdBrowser: Browser | null = null;
  let context: BrowserContext | null = existingContext || null;
  let page: Page | null = null;

  try {
    if (!context) {
      const res = await openBrowser();
      createdBrowser = res.browser;
      context = res.context;
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

    // Espera a navegação estabilizar (captura redirecionamentos cliente)
    await page.waitForTimeout(3000);

    let offers: MLOffer[] = [];
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        offers = await extractOffers(page);
        if (offers.length > 0) break;
        await page.waitForTimeout(1500);
      } catch {
        await page.waitForTimeout(1500);
      }
    }

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
    if (createdBrowser) await createdBrowser.close().catch(() => {});
    return relevantOffers;
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ Erro ao buscar "${query}": ${msg}`);
    if (page) await page.close().catch(() => {});
    if (createdBrowser) await createdBrowser.close().catch(() => {});
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

  let sharedBrowser: Browser | null = null;
  let sharedContext: BrowserContext | null = null;

  try {
    const res = await openBrowser();
    sharedBrowser = res.browser;
    sharedContext = res.context;

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
    if (sharedBrowser) {
      await sharedBrowser.close().catch(() => {});
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
