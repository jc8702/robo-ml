import { chromium, type Browser, type BrowserContext, type Page } from 'playwright-core';
import { join } from 'node:path';
import { existsSync, mkdirSync } from 'node:fs';
import type { AppConfig } from '../config/settings.js';
import { findBrowserPath, isCloudEnvironment } from '../config/browser.js';
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

// findBrowserPath() e isCloudEnvironment() importados de ../config/browser.js

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
    delete contextOptions.executablePath;
    context = await chromium.launchPersistentContext(BROWSER_PROFILE_DIR, contextOptions);
  }

  await context.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
  });

  return { browser: context as any, context };
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

    page = context.pages().length > 0 ? context.pages()[0] : await context.newPage();

    const queryLower = query.toLowerCase().trim();
    const dealCampaignTerms = [
      'ofertas do dia', 'ofertas relampago', 'mais vendidos', 'menos de 50 reais',
      'ofertas de mercado', 'liquidação queima de estoque', 'cupons e descontos',
      'menor preco 30 dias', 'ofertas', 'promocoes', 'promoção', 'desconto',
      'achadinhos', 'oferta', 'queima de estoque', 'liquidação', 'destaques'
    ];
    const isGenericQuery = dealCampaignTerms.some((term) => queryLower.includes(term));

    let url = '';
    if (isGenericQuery) {
      url = 'https://www.mercadolivre.com.br/ofertas';
    } else {
      url = `https://www.mercadolivre.com.br/jm/search?as_word=${encodeURIComponent(queryLower)}`;
    }

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
    console.log(`  🔎 URL Resolvida: "${page.url()}" | Título: "${await page.title()}"`);

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

    const queryKeywords = queryLower
      .replace(/[^a-z0-9\s]/g, '')
      .split(/\s+/)
      .filter((w) => w.length >= 2);

    let relevantOffers = offers.filter((offer) => {
      if (isGenericQuery) return true;
      const titleLower = offer.title.toLowerCase();
      // Se for ex "playstation 5", aceita se contiver "playstation", "ps5" ou "console"
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

    // Fallback: se não encontrou nenhuma oferta relevante com os termos da busca (ou caiu em account-verification),
    // acessa a busca padrão do Mercado Livre ou feed /ofertas
    if (page.url().includes('account-verification') || relevantOffers.length === 0) {
      console.log(`  ⚠️ 0 ofertas com filtro rígido para "${query}". Utilizando produtos da busca do ML...`);
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
