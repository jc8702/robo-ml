import { chromium, BrowserContext, Page } from 'playwright-core';
import { join } from 'node:path';
import { existsSync, mkdirSync, writeFileSync, rmSync, unlinkSync } from 'node:fs';
import { findBrowserPath, isCloudEnvironment } from '../config/browser.js';
import type { AffiliateOffer } from '../affiliate/link-converter.js';
import { formatIndividualOffer } from '../formatter/whatsapp.js';

const WA_PROFILE_DIR = join(process.cwd(), '.wa-profile');

let context: BrowserContext | null = null;
let waPage: Page | null = null;

export async function openWhatsAppBrowser(): Promise<{ context: BrowserContext; page: Page }> {
  if (context && waPage && !waPage.isClosed()) {
    return { context, page: waPage };
  }

  if (!existsSync(WA_PROFILE_DIR)) {
    mkdirSync(WA_PROFILE_DIR, { recursive: true });
  }

  const lockFiles = ['SingletonLock', 'SingletonCookie', 'SingletonSocket', 'lockfile'];
  for (const lockFile of lockFiles) {
    const lockPath = join(WA_PROFILE_DIR, lockFile);
    if (existsSync(lockPath)) {
      try { unlinkSync(lockPath); } catch {}
    }
  }

  const isCloud = isCloudEnvironment();
  const executablePath = findBrowserPath();

  console.log(`[WA-PLAYWRIGHT] Iniciando navegador Chrome (Headless: ${isCloud})...`);

  const contextOptions: any = {
    headless: isCloud,
    viewport: { width: 1366, height: 1080 },
    userAgent:
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-blink-features=AutomationControlled',
    ],
  };

  if (executablePath && !isCloud) {
    contextOptions.executablePath = executablePath;
  }

  try {
    context = await chromium.launchPersistentContext(WA_PROFILE_DIR, contextOptions);
  } catch (launchErr) {
    console.warn('[WA-PLAYWRIGHT] Aviso ao abrir com Chrome do sistema. Expurgando lock e relançando...', launchErr);
    delete contextOptions.executablePath;
    context = await chromium.launchPersistentContext(WA_PROFILE_DIR, contextOptions);
  }

  const pages = context.pages();
  waPage = pages.length > 0 ? pages[0] : await context.newPage();

  // Interceptor global: fecha automaticamente qualquer janela de seleção de arquivo nativa do SO
  waPage.on('filechooser', async (fileChooser) => {
    console.log('[WA-PLAYWRIGHT] 🛡️ Interceptado FileChooser do SO no WhatsApp Web. Fechando janela nativa automaticamente...');
    await fileChooser.setFiles([]).catch(() => {});
  });

  console.log('[WA-PLAYWRIGHT] Navegando para https://web.whatsapp.com...');
  await waPage.goto('https://web.whatsapp.com', { waitUntil: 'domcontentloaded', timeout: 60000 });

  return { context, page: waPage };
}

export async function isWhatsAppLoggedIn(page: Page): Promise<boolean> {
  try {
    const loggedInSelector = '#pane-side, [aria-label="Lista de conversas"], [data-icon="chat"], div[contenteditable="true"]';
    const element = await page.waitForSelector(loggedInSelector, { timeout: 8000 });
    return element !== null;
  } catch {
    return false;
  }
}

export async function ensureWhatsAppLoggedIn(): Promise<Page> {
  const { page } = await openWhatsAppBrowser();

  const loggedIn = await isWhatsAppLoggedIn(page);

  if (loggedIn) {
    console.log('[WA-PLAYWRIGHT] ✅ WhatsApp Web já está logado!');
    return page;
  }

  console.log('\n========================================');
  console.log('  📱 VINCULAR WHATSAPP - PLAYWRIGHT (CHROME)');
  console.log('========================================');
  console.log('  Uma janela do Chrome foi aberta com o WhatsApp Web!');
  console.log('  1. No seu celular: WhatsApp ➔ Configurações ➔ Dispositivos vinculados');
  console.log('  2. Escaneie o QR Code na tela do Chrome (ou clique em "Vincular com número de telefone")');
  console.log('========================================\n');

  try {
    // Tenta capturar screenshot do QR code para o servidor web /qr
    const qrCanvas = await page.$('canvas');
    if (qrCanvas) {
      await page.screenshot({ path: join(process.cwd(), 'wa-qr-screenshot.png') });
    }
  } catch {}

  try {
    await page.waitForSelector('#pane-side, [aria-label="Lista de conversas"], div[contenteditable="true"]', {
      timeout: 180000,
    });
    console.log('[WA-PLAYWRIGHT] ✅ Login efetuado com sucesso! Sessão salva em .wa-profile/');
  } catch {
    console.error('[WA-PLAYWRIGHT] ⏰ Tempo limite de 3 min excedido para efetuar login.');
  }

  return page;
}

/**
 * Descarta incondicionalmente qualquer modal de mídia, preview de imagem ou editor travado no WhatsApp Web.
 * REGRA IMUTÁVEL: Se o modal persistir após tentativas de clique e teclas, executa page.reload() para
 * DESTRUIR incondicionalmente a janela de sobreposição e liberar a interface de chats.
 */
export async function selectWaGroupChat(page: Page, targetSearchTerm: string): Promise<boolean> {
  const target = (targetSearchTerm || '').trim();
  if (!target) return false;

  console.log(`[WA-PLAYWRIGHT] Selecionando conversa/grupo: "${target}"...`);

  // Se for um link de convite do WhatsApp (ex: https://chat.whatsapp.com/LFUefbB9eWkCymLxUfrj7N)
  const linkMatch = target.match(/chat\.whatsapp\.com\/([A-Za-z0-9_-]+)/);
  if (linkMatch && linkMatch[1]) {
    const inviteCode = linkMatch[1];
    console.log(`[WA-PLAYWRIGHT] 🔗 Detectado link de convite do WhatsApp (Código: ${inviteCode}). Navegando no WhatsApp Web...`);
    try {
      await page.goto(`https://web.whatsapp.com/accept?code=${inviteCode}`, { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);

      // Tenta clicar em botões de confirmação ("Entrar no grupo", "Conversar", "Entrar na conversa") se o modal aparecer
      await page.evaluate(() => {
        const btns = Array.from(document.querySelectorAll('button, div[role="button"]'));
        for (const b of btns) {
          const text = (b.textContent || '').toLowerCase();
          if (text.includes('entrar') || text.includes('conversar') || text.includes('join') || text.includes('chat')) {
            (b as HTMLElement).click();
          }
        }
      }).catch(() => {});
      await page.waitForTimeout(2000);
      return true;
    } catch (linkErr) {
      console.warn('[WA-PLAYWRIGHT] Aviso ao abrir grupo por link de convite:', linkErr);
    }
  }

  // Busca padrão por nome ou JID na caixa de pesquisa do WhatsApp Web
  const searchSelector = '#side div[contenteditable="true"], [aria-label*="Pesquisar"], [aria-placeholder*="Pesquisar"], [data-tab="3"], [title*="Pesquisar"]';
  try {
    const searchBox = await page.waitForSelector(searchSelector, { timeout: 6000 });
    if (searchBox) {
      await searchBox.click({ force: true }).catch(() => {});
      await page.waitForTimeout(300);
      await searchBox.evaluate((el: HTMLElement) => { el.innerHTML = ''; }).catch(() => {});
      await searchBox.fill('').catch(() => {});
      await searchBox.type(target, { delay: 80 }).catch(() => {});
      await page.waitForTimeout(1500);
      await page.keyboard.press('Enter').catch(() => {});
      await page.waitForTimeout(1500);
      return true;
    }
  } catch (err) {
    console.warn('[WA-PLAYWRIGHT] Aviso ao selecionar conversa/grupo:', err);
  }
  return false;
}

/**
 * Descarta incondicionalmente qualquer modal de mídia, preview de imagem ou editor travado no WhatsApp Web.
 * REGRA IMUTÁVEL: Se o modal persistir após tentativas de clique e teclas, executa page.reload() para
 * DESTRUIR incondicionalmente a janela de sobreposição e liberar a interface de chats.
 */
export async function forceClearAllWaModals(page: Page): Promise<void> {
  try {
    const hasModalInDom = await page.evaluate(() => {
      return !!document.querySelector('div[role="dialog"]') || !!document.querySelector('[data-animate-modal-popup="true"]');
    }).catch(() => false);

    if (!hasModalInDom) return;

    console.warn('[WA-PLAYWRIGHT] ⚠️ Modal/Editor detectado no DOM do WhatsApp Web. Executando limpeza...');

    for (let i = 0; i < 2; i++) {
      await page.keyboard.press('Escape').catch(() => {});
      await page.waitForTimeout(200);
      await page.evaluate(() => {
        const buttons = Array.from(document.querySelectorAll('button, div[role="button"]'));
        for (const b of buttons) {
          const txt = (b.textContent || '').toLowerCase();
          if (txt.includes('descartar') || txt.includes('discard')) {
            (b as HTMLElement).click();
          }
        }
        const xIcons = Array.from(document.querySelectorAll('div[role="dialog"] [data-icon="x"], [data-icon="x"]'));
        for (const icon of xIcons) {
          const btn = (icon.closest('button, div[role="button"]') || icon) as HTMLElement;
          if (btn) btn.click();
        }
      }).catch(() => {});
      await page.waitForTimeout(300);
    }

    // REGRA DE SEGURANÇA ABSOLUTA: Se o modal persistir, recarrega a página para garantir 0 modais travados na tela!
    const modalInDomAfter = await page.evaluate(() => !!document.querySelector('div[role="dialog"]')).catch(() => false);
    if (modalInDomAfter) {
      console.warn('[WA-PLAYWRIGHT] 🔄 Recarregando WhatsApp Web para expurgar modal travado...');
      await page.reload({ waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
      await page.waitForTimeout(3000);
    }
  } catch {
    /* ignora */
  }
}

/**
 * Envia uma oferta com foto via Playwright WhatsApp Web.
 */
export async function sendOfferWithPhotoPlaywright(
  offer: AffiliateOffer,
  targetGroupOrPhone: string
): Promise<boolean> {
  try {
    const page = await ensureWhatsAppLoggedIn();
    
    // REGRA IMUTÁVEL: Limpa preventivamente qualquer modal travado antes de iniciar
    await forceClearAllWaModals(page);

    const caption = formatIndividualOffer(offer);
    const targetSearchTerm = (targetGroupOrPhone && targetGroupOrPhone.trim()) ? targetGroupOrPhone.trim() : (process.env.WHATSAPP_GROUP_NAME || '');
    
    const selected = await selectWaGroupChat(page, targetSearchTerm);
    if (!selected) {
      console.warn(`[WA-PLAYWRIGHT] ⚠️ Não foi possível abrir a conversa: "${targetSearchTerm}"`);
      return false;
    }

    // SE WA_DIRECT_POST_MODE estiver ativo, faz o envio direto no chat principal (sem foto anexada)
    const useDirectPost = process.env.WA_DIRECT_POST_MODE === 'true' || process.env.WA_DISABLE_MEDIA_MODAL === 'true';

    if (!useDirectPost) {
      // 1. Prepara a URL da imagem (JPG em alta resolução)
      let imageUrl = (offer.thumbnail || '').trim();
      if (imageUrl.startsWith('//')) imageUrl = 'https:' + imageUrl;
      if (imageUrl.includes('mlstatic.com') || imageUrl.startsWith('http')) {
        imageUrl = imageUrl.replace(/\.webp$/i, '.jpg').replace(/-(I|V|F)\.(jpg|webp)/gi, '-O.jpg');
      }

      let tempImgPath = '';
      if (imageUrl && imageUrl.startsWith('http')) {
        try {
          const response = await fetch(imageUrl);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            if (buffer.byteLength > 1000) {
              tempImgPath = join(process.cwd(), `temp_offer_${Date.now()}.jpg`);
              writeFileSync(tempImgPath, Buffer.from(buffer));
            }
          }
        } catch (dlErr) {
          console.warn('[WA-PLAYWRIGHT] Aviso ao baixar imagem:', dlErr);
        }
      }

      // Se tivermos a imagem baixada com sucesso em disco
      if (tempImgPath && existsSync(tempImgPath)) {
        try {
          // Limpeza da caixa de texto principal antes do envio de mídia
          try {
            const mainChatBox = page.locator('#main div[contenteditable="true"]').first();
            if ((await mainChatBox.count()) > 0) {
              await mainChatBox.evaluate((el: HTMLElement) => { el.innerHTML = ''; }).catch(() => {});
            }
          } catch {}

          // Injeta o arquivo JPG na entrada de arquivos do WhatsApp Web
          let fileUploaded = false;
          const fileInputSelectors = [
            'input[type="file"][accept*="image"]',
            'input[type="file"][accept*="video"]',
            'input[type="file"]',
          ];

          for (const selector of fileInputSelectors) {
            try {
              const fileInput = page.locator(selector).first();
              if ((await fileInput.count()) > 0) {
                await fileInput.setInputFiles(tempImgPath);
                fileUploaded = true;
                console.log(`[WA-PLAYWRIGHT] ✅ Foto JPG carregada no WhatsApp Web via injetor (${selector})!`);
                break;
              }
            } catch {}
          }

          if (!fileUploaded) {
            const attachSelector = '[aria-label*="Anexar"], [title*="Anexar"], [data-icon="plus"], [data-icon="clip"]';
            try {
              const attachBtn = page.locator(attachSelector).first();
              if (await attachBtn.isVisible({ timeout: 2000 })) {
                await attachBtn.click();
                await page.waitForTimeout(500);
                const fileInput = page.locator('input[type="file"]').first();
                await fileInput.setInputFiles(tempImgPath);
                fileUploaded = true;
              }
            } catch {}
          }

          if (fileUploaded) {
            // Aguarda o modal de edição de mídia abrir (até 8s)
            const modalVisible = await page.waitForSelector('div[role="dialog"]', { timeout: 8000 })
              .then(() => true)
              .catch(() => false);

            if (modalVisible) {
              console.log('[WA-PLAYWRIGHT] 🖼️ Modal de mídia aberto com sucesso!');
              await page.waitForTimeout(800);

              // Insere a legenda no modal usando execCommand (nativo do React/Lexical)
              const captionBox = page.locator('div[role="dialog"] div[contenteditable="true"]').first();
              if (await captionBox.isVisible({ timeout: 4000 })) {
                console.log(`[WA-PLAYWRIGHT] 📝 Inserindo legenda no modal...`);

                await captionBox.evaluate((el: HTMLElement, textToInsert: string) => {
                  el.focus();
                  const sel = window.getSelection();
                  const range = document.createRange();
                  range.selectNodeContents(el);
                  sel?.removeAllRanges();
                  sel?.addRange(range);
                  document.execCommand('delete', false);
                  document.execCommand('insertText', false, textToInsert);
                }, caption).catch(() => {});

                await page.waitForTimeout(500);

                // Verificação de fallback via keyboard.insertText caso execCommand não preencha tudo
                let currentText = (await captionBox.textContent().catch(() => '')) || '';
                if (!currentText || currentText.length < 20) {
                  await captionBox.focus().catch(() => {});
                  await page.keyboard.insertText(caption).catch(() => {});
                  await page.waitForTimeout(500);
                  currentText = (await captionBox.textContent().catch(() => '')) || '';
                }

                console.log(`[WA-PLAYWRIGHT] ✅ Legenda confirmada (${currentText.length} caracteres).`);
              }

              // Clica no botão enviar
              console.log(`[WA-PLAYWRIGHT] 🚀 Disparando envio do modal de mídia...`);

              await page.evaluate(() => {
                const sendIcon = document.querySelector('div[role="dialog"] [data-icon="send"], [aria-label*="Enviar"], [aria-label*="Send"]');
                if (sendIcon) {
                  const btn = (sendIcon.closest('button, div[role="button"], span[role="button"]') || sendIcon) as HTMLElement;
                  btn.click();
                }
              }).catch(() => {});

              const sendBtn = page.locator('div[role="dialog"] [data-icon="send"], div[role="dialog"] button:has([data-icon="send"])').first();
              if ((await sendBtn.count()) > 0) {
                await sendBtn.click({ force: true }).catch(() => {});
              }

              // Aguarda o modal desanexar com tempo suficiente para o upload da foto (até 20s)
              console.log('[WA-PLAYWRIGHT] ⏳ Aguardando upload e conclusão da mídia (até 20s)...');
              const modalDetached = await page.waitForSelector('div[role="dialog"]', { state: 'detached', timeout: 20000 })
                .then(() => true)
                .catch(() => false);

              if (modalDetached) {
                console.log(`[WA-PLAYWRIGHT] ✅ FOTO JPG + LEGENDA ENVIADAS COM SUCESSO! ("${offer.title.substring(0, 30)}...")`);
                if (existsSync(tempImgPath)) try { rmSync(tempImgPath); } catch {}
                await page.waitForTimeout(2000);
                return true;
              }

              console.warn('[WA-PLAYWRIGHT] ⚠️ Modal de mídia não fechou em 20s. Forçando limpeza...');
              await forceClearAllWaModals(page);
            }
          }
        } catch (imgErr) {
          console.error('[WA-PLAYWRIGHT] Erro no envio com mídia modal:', imgErr);
          await forceClearAllWaModals(page);
        } finally {
          if (tempImgPath && existsSync(tempImgPath)) {
            try { rmSync(tempImgPath); } catch {}
          }
        }
      }
    }

    // Fallback de envio no chat principal caso a foto falhe ou WA_DIRECT_POST_MODE esteja ativo
    console.log('[WA-PLAYWRIGHT] 💬 Garantindo envio no chat principal...');
    await forceClearAllWaModals(page);
    await selectWaGroupChat(page, targetSearchTerm);

    const messageBox = await page.waitForSelector('#main div[contenteditable="true"]', { timeout: 10000 });
    if (messageBox) {
      await messageBox.click();
      await messageBox.evaluate((el: HTMLElement) => { el.innerHTML = ''; }).catch(() => {});
      await page.keyboard.insertText(caption);
      await page.waitForTimeout(2000);
      await page.keyboard.press('Enter');
      console.log(`[WA-PLAYWRIGHT] ✅ Post enviado com sucesso no WhatsApp: "${offer.title.substring(0, 30)}..."`);
      return true;
    }

    return false;
  } catch (error) {
    console.error('[WA-PLAYWRIGHT] Erro fatal no envio:', error);
    if (waPage && !waPage.isClosed()) {
      await forceClearAllWaModals(waPage).catch(() => {});
    }
    return false;
  }
}

export function checkWhatsAppSessionStatus(): { connected: boolean; profileExists: boolean } {
  const profileExists = existsSync(WA_PROFILE_DIR);
  if (!profileExists) return { connected: false, profileExists: false };
  const hasCookies = existsSync(join(WA_PROFILE_DIR, 'Default', 'Cookies')) || 
                     existsSync(join(WA_PROFILE_DIR, 'Default', 'Network', 'Cookies')) ||
                     existsSync(join(WA_PROFILE_DIR, 'Default', 'Storage'));
  return { connected: hasCookies, profileExists };
}

/**
 * Varre a lista de conversas do WhatsApp Web (#pane-side) e extrai os títulos de todos os grupos participados.
 */
export async function discoverWhatsAppGroupsPlaywright(page: Page): Promise<string[]> {
  try {
    console.log('[WA-PLAYWRIGHT] 🔍 Escaneando lista de conversas no WhatsApp Web para detectar grupos...');
    await forceClearAllWaModals(page);
    
    // Aguarda o container da lista de conversas carregar
    await page.waitForSelector('#pane-side', { timeout: 10000 }).catch(() => {});

    // Rola suavemente a lista para carregar mais chats
    await page.evaluate(() => {
      const pane = document.querySelector('#pane-side');
      if (pane) pane.scrollTop = pane.scrollHeight / 2;
    }).catch(() => {});
    await page.waitForTimeout(1000);

    const groupsFound: string[] = await page.evaluate(() => {
      const titles = new Set<string>();
      
      // Procura por todos os elementos de título no painel lateral
      const spanElements = Array.from(document.querySelectorAll('#pane-side span[title]'));
      for (const el of spanElements) {
        const title = (el.getAttribute('title') || el.textContent || '').trim();
        // Ignora contatos por telefone genéricos ou strings do sistema
        if (!title || title.length < 2) continue;
        if (/^\+?\d[\d\s-]{8,}$/.test(title)) continue; // ignora números de telefone individuais brutos
        
        // Verifica se o item possui ícone ou indicador de grupo no container pai
        const chatContainer = el.closest('div[role="listitem"], div[tabindex]') || el.parentElement?.parentElement?.parentElement;
        if (chatContainer) {
          const hasGroupIcon = !!chatContainer.querySelector('[data-icon="default-group"], [data-icon="avatar-group"], [data-icon="community-outline"]');
          const isGroupAria = (chatContainer.getAttribute('aria-label') || '').toLowerCase().includes('grupo');
          
          // Se tiver ícone de grupo, marca de grupo ou palavra indicativa no título
          if (hasGroupIcon || isGroupAria || /(grupo|gc|promo|oferta|achado|vip|desconto|clube|multirão)/i.test(title)) {
            titles.add(title);
          }
        }
      }
      return Array.from(titles);
    });

    console.log(`[WA-PLAYWRIGHT] 🔍 Escaneamento concluído: ${groupsFound.length} grupo(s) detectado(s).`);
    return groupsFound;
  } catch (err) {
    console.error('[WA-PLAYWRIGHT] Erro ao escanear grupos no WhatsApp Web:', err);
    return [];
  }
}



