import { chromium, type BrowserContext, type Page } from 'playwright-core';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, readFileSync, unlinkSync, readdirSync } from 'node:fs';
import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { formatFacebookOffer, formatFacebookWaComment } from '../formatter/facebook.js';
import { findBrowserPath, isCloudEnvironment } from '../config/browser.js';
import { getDbPool } from '../db/index.js';

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

  const context = await chromium.launchPersistentContext(FB_PROFILE_DIR, {
    headless: isCloud,
    executablePath,
    locale: 'pt-BR',
    viewport: { width: 1366, height: 768 },
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--disable-infobars',
      '--disable-dev-shm-usage',
    ],
    ignoreDefaultArgs: ['--enable-automation'],
  });

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
    console.log(`  📘 Navegando para grupo: ${groupUrl}`);

    await page.goto(groupUrl, { waitUntil: 'domcontentloaded', timeout: 30000 });
    await randomDelay(3000, 5000);

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
      console.log(`  ⚠️ Não conseguiu abrir campo de publicação no grupo. Pulando...`);
      return false;
    }

    await randomDelay(2000, 4000);

    // 1. UPLOAD DA IMAGEM DO PRODUTO EM 1º LUGAR (Anexa a foto ANTES de colar o texto com os links)
    // Isso garante que o post entre no modo Mídia/Foto e a foto do produto do Mercado Livre seja o destaque principal.
    // IMPORTANTE: NUNCA chama btn.click() sem interceptar o 'filechooser', para NUNCA abrir a janela nativa do Windows Explorer ("Abrir").
    let photoUploaded = false;
    if (offer.thumbnail && offer.thumbnail.startsWith('http')) {
      const imgPath = await downloadImageToTemp(offer.thumbnail, offerIndex);
      if (imgPath) {
        try {
          // A) Injeta o arquivo diretamente no input[type=file] do modal via protocolo CDP (SEM ABRIR JANELA NATIVA)
          const directFileInput = page.locator('div[role="dialog"] input[type="file"], input[accept*="image"]').first();
          if (await directFileInput.count() > 0) {
            try {
              await directFileInput.setInputFiles(imgPath);
              console.log(`  📸 Foto do produto do Mercado Livre carregada diretamente em 1º lugar!`);
              photoUploaded = true;
            } catch {
              photoUploaded = false;
            }
          }

          // B) Se o input direto não encontrou ou falhou, clica no botão "Foto/vídeo" INTERCEPTANDO O FILECHOOSER
          // O Promise.all com page.waitForEvent('filechooser') IMPEDE a abertura da janela Explorer do Windows no SO!
          if (!photoUploaded) {
            const photoButtonSelectors = [
              'div[role="dialog"] [aria-label="Foto/vídeo"]',
              'div[role="dialog"] [aria-label="Photo/video"]',
              'div[role="dialog"] [aria-label*="foto"]',
              'div[role="dialog"] [aria-label*="photo"]',
            ];

            for (const sel of photoButtonSelectors) {
              try {
                const btn = page.locator(sel).first();
                if (await btn.isVisible({ timeout: 2000 })) {
                  const [fileChooser] = await Promise.all([
                    page.waitForEvent('filechooser', { timeout: 4000 }).catch(() => null),
                    btn.click(),
                  ]);

                  if (fileChooser) {
                    await fileChooser.setFiles(imgPath);
                    console.log(`  📸 Imagem do produto carregada via FileChooser em 1º lugar`);
                    photoUploaded = true;
                  } else {
                    // Fallback silencioso no DOM sem disparar diálogo nativo
                    const fallbackInput = page.locator('div[role="dialog"] input[type="file"]').first();
                    if (await fallbackInput.count() > 0) {
                      await fallbackInput.setInputFiles(imgPath);
                      photoUploaded = true;
                    }
                  }
                  break;
                }
              } catch { /* próximo seletor */ }
            }
          }

          if (photoUploaded) {
            await randomDelay(3000, 5000); // Espera o preview da foto processar no dialog
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
      console.log(`  ⚠️ Campo de texto não encontrado. Pulando grupo...`);
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

    // 3. SE O FACEBOOK TENTAR GERAR CARTÃO DE PRÉVIA DO LINK (ex: do whatsapp) APÓS O TEXTO,
    // E REMOVER A FOTO DO PRODUTO: detecta e clica em "Remover prévia" se houver prévia de link concorrente
    try {
      const removePreviewSelectors = [
        'div[role="dialog"] [aria-label="Remover prévia"]',
        'div[role="dialog"] [aria-label="Remove preview"]',
        'div[role="dialog"] [aria-label="Remover cartão de prévia"]',
      ];
      for (const removeSel of removePreviewSelectors) {
        try {
          const removeBtn = page.locator(removeSel).first();
          if (await removeBtn.isVisible({ timeout: 1500 })) {
            console.log('  ⚠️ Detectada prévia de link gerada sobre o texto. Removendo prévia de link...');
            await removeBtn.click();
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
      console.log(`  ⚠️ Botão "Publicar" não encontrado. Post pode não ter sido enviado.`);
      return false;
    }

    // Espera publicação processar
    await randomDelay(3000, 5000);

    // 4. ENVIA O PRIMEIRO COMENTÁRIO EXCLUSIVAMENTE NA PUBLICAÇÃO QUE FOI ENVIADA AGORA
    try {
      console.log('  💬 Localizando a postagem criada para inserir o 1º comentário...');
      await randomDelay(2000, 3500);

      // Verificação de post pendente para aprovação dos moderadores do grupo
      const pendingApproval = page.locator('text="aprovação", text="pendente", text="pending approval"');
      if (await pendingApproval.isVisible({ timeout: 1500 }).catch(() => false)) {
        console.log('  ℹ️ O post foi enviado para a fila de aprovação dos administradores do grupo. (Comentário será adicionado após aprovação)');
        return true;
      }

      // Título ou trecho da oferta para identificar o post exato no feed
      const titleKeywords = offer.title.split(' ').slice(0, 3).join(' ');
      const titleSnippet = offer.title.substring(0, 20);

      // Filtra artigos no feed que contenham o título da oferta postada
      let targetArticle = page.locator('div[role="article"]').filter({ hasText: titleSnippet }).first();
      let foundMyPost = await targetArticle.isVisible({ timeout: 3000 }).catch(() => false);

      if (!foundMyPost) {
        targetArticle = page.locator('div[role="article"]').filter({ hasText: titleKeywords }).first();
        foundMyPost = await targetArticle.isVisible({ timeout: 3000 }).catch(() => false);
      }

      // Se o feed não tiver atualizado a tempo, faz rolagem suave para encontrar o post
      if (!foundMyPost) {
        await page.mouse.wheel(0, 300);
        await randomDelay(1000, 1500);
        foundMyPost = await targetArticle.isVisible({ timeout: 2000 }).catch(() => false);
      }

      if (foundMyPost) {
        console.log(`  🎯 Postagem própria identificada no feed! Inserindo comentário com link VIP...`);

        // Busca o campo de comentário ESPECIFICAMENTE dentro do artigo da oferta postada
        const commentBoxSelectors = [
          'div[contenteditable="true"][aria-label*="comentá"]',
          'div[contenteditable="true"][aria-label*="Escreva"]',
          'div[contenteditable="true"][aria-label*="comment"]',
          'div[contenteditable="true"]',
          '[role="textbox"]',
        ];

        let commentBox = null;
        for (const sel of commentBoxSelectors) {
          try {
            const el = targetArticle.locator(sel).first();
            if (await el.isVisible({ timeout: 2000 })) {
              commentBox = el;
              break;
            }
          } catch { /* próximo */ }
        }

        if (commentBox) {
          await commentBox.scrollIntoViewIfNeeded();
          await commentBox.click();
          await randomDelay(800, 1200);

          const waCommentText = formatFacebookWaComment(waGroupLink);

          // Digitação direta no campo exclusivo do post próprio
          await page.keyboard.type(waCommentText, { delay: 10 });
          await randomDelay(1000, 1500);

          // Pressiona Enter para enviar o comentário
          await page.keyboard.press('Enter');
          console.log('  ✅ 1º Comentário com link do WhatsApp publicado no post correto!');
          await randomDelay(2000, 3000);
        } else {
          console.log('  ℹ️ Campo de comentário não encontrado dentro da postagem da oferta.');
        }
      } else {
        console.log('  ⚠️ Não foi possível isolar o post próprio no feed. O comentário não foi inserido em posts de terceiros por segurança.');
      }
    } catch (commentErr) {
      console.log(`  ⚠️ Aviso ao enviar comentário: ${commentErr}`);
    }

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

    // 🔍 AUTO-JOIN: Busca e entra automaticamente em novos grupos se habilitado
    const autoJoinEnabled = process.env.FB_AUTO_JOIN !== 'false';
    if (autoJoinEnabled) {
      await autoDiscoverAndJoinFacebookGroups(page, 1);
    }

    // Recarrega dinamicamente a lista de grupos e o limite do .env atualizados
    if (existsSync(join(process.cwd(), '.env'))) {
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

    const groupsToPostFinal = groupUrls.slice(0, maxGroupsPerCycle);
    console.log(`\n📘 Facebook: Postando em ${groupsToPostFinal.length} grupo(s)...`);

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
 * Atualiza tanto FB_GROUP_URLS quanto FB_MAX_GROUPS_PER_CYCLE com o total de grupos encontrados.
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

    // Atualiza FB_MAX_GROUPS_PER_CYCLE para igualar ao total de grupos encontrados
    const maxMatch = content.match(/^FB_MAX_GROUPS_PER_CYCLE=(\d+)$/m);
    if (maxMatch) {
      content = content.replace(/^FB_MAX_GROUPS_PER_CYCLE=.*$/m, `FB_MAX_GROUPS_PER_CYCLE=${totalGroupsCount}`);
    } else {
      content += `\nFB_MAX_GROUPS_PER_CYCLE=${totalGroupsCount}`;
    }

    writeFileSync(envFile, content, 'utf-8');

    // Atualiza variáveis em memória
    process.env.FB_GROUP_URLS = updatedGroupUrlsStr;
    process.env.FB_MAX_GROUPS_PER_CYCLE = String(totalGroupsCount);

    console.log(`\n✅ [SYNC] SUCESSO! GRUPOS DO SEU PERFIL SINCRONIZADOS NO .ENV:`);
    console.log(`  📊 Total de Grupos Encontrados: ${totalGroupsCount}`);
    console.log(`  🔗 FB_GROUP_URLS atualizado no .env com todas as URLs`);
    console.log(`  🎯 FB_MAX_GROUPS_PER_CYCLE atualizado para ${totalGroupsCount} no .env\n`);

    return { totalGroups: totalGroupsCount, updated: true };
  } catch (error) {
    console.error(`  ❌ [SYNC] Erro ao sincronizar grupos do perfil:`, error);
    return { totalGroups: 0, updated: false };
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

  console.log(`\n🎉 [AUTO-JOIN] NOVO GRUPO DO FACEBOOK ADICIONADO AO .ENV!`);
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

      // Tenta fechar/enviar popups de perguntas de entrada se surgirem
      try {
        const submitQuestionsBtn = page.locator('[aria-label="Enviar"], [aria-label="Submit"], [aria-label="Concluir"], [role="button"]:has-text("Enviar"), [role="button"]:has-text("Concluir")');
        if (await submitQuestionsBtn.first().isVisible({ timeout: 3000 })) {
          await submitQuestionsBtn.first().click();
          await randomDelay(2000, 3000);
        }
      } catch { /* sem modal de perguntas */ }

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
