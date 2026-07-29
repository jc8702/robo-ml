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
 * Abre browser com perfil persistente.
 * No Render/Linux usa headless: true; em dev Windows pode ser visivel.
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

  return context;
}

/**
 * Verifica se a página carregou resultados de busca.
 */
async function hasSearchResults(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    // 1. Verifica se existem links de produtos do ML
    const hasProductLinks = document.querySelectorAll('a[href*="/p/MLB"], a[href*="produto.mercadolivre.com.br"], a[href*="mercadolivre.com.br/MLB"]').length > 0;
    if (hasProductLinks) return true;

    // 2. Seletores clássicos e modernos do DOM do ML
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

    // Tenta vários seletores (ML muda frequentemente)
    let rawItems = Array.from(document.querySelectorAll('.ui-search-layout__item, [class*="poly-card"], .ui-search-result__wrapper, li.ui-search-layout__item, [class*="ui-search-result"], div.ui-search-result__content-wrapper'));
    
    // Se não encontrou elementos com classes conhecidas, busca por containers pai de links de produtos
    if (rawItems.length === 0) {
      const anchors = document.querySelectorAll('a[href*="mercadolivre.com.br"]');
      anchors.forEach(a => {
        const parent = a.closest('li, article, div[class*="search"], div[class*="card"], div[class*="item"]') || a.parentElement;
        if (parent && !rawItems.includes(parent)) rawItems.push(parent);
      });
    }

    rawItems.forEach((item, i) => {
      try {
        // Link limpo
        const link = item.querySelector('a[href*="mercadolivre.com.br"]') as HTMLAnchorElement;
        if (!link) return;
        let rawHref = link.href.split('#')[0].split('?')[0];

        // Extrai o ID do produto para criar o permalink curto limpo
        const pMatch = rawHref.match(/\/p\/(MLB\d+)/i);
        const mlbMatch = rawHref.match(/(MLB-?\d+)/i);

        let permalink = rawHref;
        if (pMatch && pMatch[1]) {
          permalink = `https://www.mercadolivre.com.br/p/${pMatch[1]}`;
        } else if (mlbMatch && mlbMatch[1]) {
          permalink = `https://produto.mercadolivre.com.br/${mlbMatch[1]}`;
        }

        // Título
        const titleEl = item.querySelector('h2, h3, [class*="title"], .poly-component__title');
        const title = titleEl?.textContent?.trim() || '';
        if (!title || title.length < 5) return;

        // Vendedor & Qualificação (Loja Oficial, MercadoLíder, Full ou Vendedor Registrado)
        const itemText = item.textContent || '';
        const itemTextLower = itemText.toLowerCase();
        const isOfficial = item.querySelector('.ui-search-official-store-label, [class*="official"]') !== null || itemTextLower.includes('loja oficial');
        const isLeader = itemTextLower.includes('mercadolíder') || itemTextLower.includes('mercadolider');
        const isFull = itemText.includes('FULL');
        const sellerEl = item.querySelector('.poly-component__seller, .ui-search-official-store-label, [class*="seller"]');
        const sellerName = sellerEl?.textContent?.trim() || (isOfficial ? 'Loja Oficial' : (isLeader ? 'MercadoLíder' : ''));

        // Filtro de Vendedor Qualificado: descarta anúncios sem credencial confiável
        const isQualified = isOfficial || isLeader || isFull || sellerName.length > 0;
        if (!isQualified) return;

        // Imagem (alta resolução)
        const img = item.querySelector('img[src*="http"], img[data-src*="http"]') as HTMLImageElement | null;
        let thumbnail = img?.src || img?.getAttribute('data-src') || '';
        if (thumbnail) {
          thumbnail = thumbnail.replace(/-I\.jpg/g, '-O.jpg').replace(/-V\.jpg/g, '-O.jpg');
        }

        // Preços
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

        // Detecção do selo oficial de Menor Preço dos últimos 30 dias do Mercado Livre
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
 * Busca ofertas no Mercado Livre.
 */
export async function searchOffers(
  query: string,
  config: AppConfig
): Promise<MLOffer[]> {
  // Detecta se é a primeira execução (sem perfil de browser)
  const hasProfile = existsSync(join(BROWSER_PROFILE_DIR, 'Default'))
    || existsSync(join(BROWSER_PROFILE_DIR, 'Local State'));
  const isFirstRun = !hasProfile && process.platform === 'win32';

  if (isFirstRun) {
    console.log('');
    console.log('  ╔═══════════════════════════════════════════════════╗');
    console.log('  ║  🆕 PRIMEIRA EXECUÇÃO                             ║');
    console.log('  ║                                                   ║');
    console.log('  ║  Um browser vai abrir. Se aparecer verificação:   ║');
    console.log('  ║  1. Clique em "Já tenho conta"                    ║');
    console.log('  ║  2. Faça login na sua conta do ML                 ║');
    console.log('  ║  3. A busca de produtos vai carregar sozinha      ║');
    console.log('  ║                                                   ║');
    console.log('  ║  ⏱️  Você tem 3 minutos para completar.            ║');
    console.log('  ║  Nas próximas vezes, será automático.             ║');
    console.log('  ╚═══════════════════════════════════════════════════╝');
    console.log('');
  }

  let context: BrowserContext | null = null;

  try {
    context = await openBrowser();
    const page = context.pages()[0] || await context.newPage();

    // Constrói URL
    const searchQuery = query.replace(/\s+/g, '-');
    const url = `https://lista.mercadolivre.com.br/${encodeURIComponent(searchQuery)}`;

    console.log(`  📡 Acessando: ${url}`);

    // Navega e espera a rede estabilizar (captura redirecionamentos)
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 25000 });
    } catch {
      await page.waitForTimeout(2000);
    }

    // Espera para JS do ML renderizar os cards
    await page.waitForTimeout(2500);

    // Verifica se tem resultados
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

    if (!hasResults) {
      if (isCloud) {
        // Em Cloud (Render Linux headless), não travamos em waitForURL de 3 min!
        console.log('  ℹ️ Tentando extração direta de ofertas estáticas...');
        const directOffers = await extractOffers(page);
        if (directOffers.length > 0) {
          hasResults = true;
        }
      } else {
        console.log('  🔐 Verificação/login necessário! Complete no browser aberto...');
        try {
          await page.waitForSelector(
            '.ui-search-layout__item, [class*="poly-card"], .ui-search-results, ol.ui-search-layout',
            { timeout: 10000 }
          );
          hasResults = true;
        } catch {
          console.log('  ⏰ Tempo esgotado para esta busca.');
        }
      }
    }

    if (hasResults) {
      // Scroll para carregar mais
      await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3));
      await page.waitForTimeout(1000);

      const offers = await extractOffers(page);

      // Filtro de Relevância Estrita de Título:
      // Se for busca por marca/produto específico (ex: "iphone"), o título DEVE conter pelo menos uma das palavras-chave da busca.
      const queryLower = query.toLowerCase().trim();
      const isGenericQuery = ['ofertas do dia', 'mais vendidos', 'promoção', 'desconto', 'oferta'].includes(queryLower);

      const queryKeywords = queryLower
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length >= 3);

      const relevantOffers = offers.filter((offer) => {
        if (isGenericQuery) return true;
        const titleLower = offer.title.toLowerCase();
        // Exige que ao menos uma palavra-chave principal da busca esteja no título do produto
        return queryKeywords.some((keyword) => titleLower.includes(keyword));
      });

      console.log(`  📦 ${offers.length} no ML ➔ ${relevantOffers.length} filtrados com precisão para "${query}"`);

      await context.close();
      return relevantOffers;
    }

    await context.close();
    return [];
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error(`  ❌ Erro: ${msg}`);
    if (context) await context.close().catch(() => {});
    return [];
  }
}
/**
 * Coleta ofertas de múltiplas queries com deduplicação, filtro de histórico e seleção do menor preço.
 */
export async function collectOffers(
  queries: string[],
  config: AppConfig
): Promise<MLOffer[]> {
  const allOffers: MLOffer[] = [];
  const history = loadSentHistory();

  console.log(`\n📚 Histórico carregado: ${history.size} registros de envios anteriores (produtos não serão repetidos).`);

  for (const query of queries) {
    console.log(`\n🔍 Buscando: "${query}"...`);
    const offers = await searchOffers(query, config);

    for (const offer of offers) {
      const titleKey = normalizeTitleKey(offer.title);
      // Evita repetição: pula se a URL ou título já foram enviados recentemente
      if (history.has(offer.permalink) || history.has(titleKey)) {
        continue;
      }

      // Validação do menor preço dos últimos 30 dias (via selo oficial do ML ou histórico local de preços)
      offer.isLowest30Days = isLowestPriceIn30Days(titleKey, offer.currentPrice, offer.isLowest30Days);

      allOffers.push(offer);
    }

    if (queries.indexOf(query) < queries.length - 1) {
      await new Promise((r) => setTimeout(r, 1500));
    }
  }

  // Filtra pelas regras de preço e desconto
  const filtered = allOffers
    .filter((o) => o.currentPrice > 0)
    .filter((o) => o.discountPercent >= config.filters.minDiscount)
    .filter((o) => o.currentPrice >= config.filters.minPrice)
    .filter((o) => config.filters.maxPrice === 0 || o.currentPrice <= config.filters.maxPrice);

  // Agrupa produtos idênticos/similares e seleciona SOMENTE o de MENOR PREÇO
  const lowestPriceMap = new Map<string, MLOffer>();
  for (const offer of filtered) {
    const key = normalizeTitleKey(offer.title);
    if (!lowestPriceMap.has(key)) {
      lowestPriceMap.set(key, offer);
    } else {
      const existing = lowestPriceMap.get(key)!;
      if (offer.currentPrice < existing.currentPrice) {
        lowestPriceMap.set(key, offer); // Substitui pela opção de menor preço
      }
    }
  }

  const uniqueOffers = Array.from(lowestPriceMap.values());

  // Ordena pelo maior desconto e limita o resultado
  return uniqueOffers
    .sort((a, b) => b.discountPercent - a.discountPercent)
    .slice(0, config.filters.maxResults);
}
