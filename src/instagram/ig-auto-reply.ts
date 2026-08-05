import { IgApiClient } from 'instagram-private-api';
import { dbGetSettings, dbSaveMultipleSettings } from '../db/index.js';
import { loadConfigAsync } from '../config/settings.js';
import { getSentOffersHistoryFromDb } from '../collector/history.js';
import { openInstagramBrowser, humanType } from './ig-poster.js';
import { commentMatchesTrigger } from './ig-trigger.js';

// Cache em memória de comentários já processados. O banco é usado para persistir entre reinícios.
const processedCommentIds = new Set<string>();

async function loadProcessedCommentsFromDb(): Promise<void> {
  try {
    const settings = await dbGetSettings().catch(() => ({} as Record<string, string>));
    if (!settings.IG_PROCESSED_COMMENTS_V2) return;
    const ids: unknown = JSON.parse(settings.IG_PROCESSED_COMMENTS_V2);
    if (Array.isArray(ids)) ids.filter((id): id is string => typeof id === 'string').forEach((id) => processedCommentIds.add(id));
  } catch {
    // Um histórico inválido não pode impedir a leitura dos comentários atuais.
  }
}

async function saveProcessedCommentsToDb(): Promise<void> {
  try {
    await dbSaveMultipleSettings({ IG_PROCESSED_COMMENTS_V2: JSON.stringify(Array.from(processedCommentIds).slice(-500)) });
  } catch {
    // O bot continua funcionando sem persistência local/Neon.
  }
}

function formatDmMessage(template: string, offerTitle: string, offerLink: string, offerPrice?: string): string {
  let msg = template || 'Olá! Aqui está o seu link exclusivo com desconto para {title}: {link} 🎁';
  msg = msg.replace(/\{title\}/gi, offerTitle).replace(/\{link\}/gi, offerLink);
  if (offerPrice) msg = msg.replace(/\{price\}/gi, offerPrice);
  return msg;
}

function dmTextForPost(baseText: string, post: any): string {
  const caption = post?.caption?.text || post?.edge_media_to_caption?.edges?.[0]?.node?.text || '';
  const link = caption.match(/https?:\/\/[^\s)]+/i)?.[0]?.replace(/[.,!?]+$/, '');
  return link ? baseText.replace(/https?:\/\/\S+/g, link) : baseText;
}

type CommentLike = { pk?: string | number; text?: string; user?: { username?: string; pk?: string | number } };
type MonitorResult = { processedCount: number; repliesCount: number; errors: string[]; postsScanned: number; commentsScanned: number; triggerWord?: string };
type OfficialComment = { id: string; text?: string; username?: string; timestamp?: string; from?: { id?: string; username?: string } };

const OFFICIAL_REPLY_DELAY_MS = 1200;

async function officialGraphRequest<T>(url: string, token: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload?.error) {
    const detail = payload?.error?.message || payload?.error?.error_user_msg || `HTTP ${response.status}`;
    throw new Error(`Meta Graph API: ${detail}`);
  }
  return payload as T;
}

async function processOfficialComments(
  accessToken: string,
  userId: string,
  graphVersion: string,
  trigger: string,
  ownerUsername: string,
  dmText: string,
  result: MonitorResult,
): Promise<void> {
  const base = `https://graph.instagram.com/${encodeURIComponent(graphVersion)}`;
  const mediaFields = 'id,caption,comments.limit(100){id,text,username,timestamp,from}';
  let mediaUrl: string | undefined = `${base}/${encodeURIComponent(userId)}/media?fields=${encodeURIComponent(mediaFields)}&limit=25`;

  while (mediaUrl) {
    const mediaPage: { data?: any[]; paging?: { next?: string } } = await officialGraphRequest<{ data?: any[]; paging?: { next?: string } }>(mediaUrl, accessToken);
    for (const media of mediaPage.data || []) {
      result.postsScanned++;
      let commentsPage = media.comments;
      while (commentsPage) {
        const comments = (commentsPage.data || []) as OfficialComment[];
        result.commentsScanned += comments.length;
        for (const comment of comments) {
          result.processedCount++;
          const username = comment.username || comment.from?.username || '';
          const commentId = String(comment.id || '');
          const timestamp = comment.timestamp ? Date.parse(comment.timestamp) : NaN;
          const isRecent = !Number.isFinite(timestamp) || Date.now() - timestamp <= 7 * 24 * 60 * 60 * 1000;
          const matches = commentMatchesTrigger(comment.text || '', trigger) || commentMatchesTrigger(comment.text || '', 'PASSE');
          if (!commentId || !username || username.toLowerCase() === ownerUsername.toLowerCase() || !matches || !isRecent || processedCommentIds.has(commentId)) continue;

          try {
            const sent = await officialGraphRequest<{ message_id?: string }>(
              `${base}/${encodeURIComponent(userId)}/messages`,
              accessToken,
              { method: 'POST', body: JSON.stringify({ recipient: { comment_id: commentId }, message: { text: dmTextForPost(dmText, media) } }) },
            );
            if (!sent.message_id) throw new Error('Meta não retornou message_id; envio não confirmado');
            processedCommentIds.add(commentId);
            result.repliesCount++;
            console.log(`  📩 Private reply confirmado para @${username} (comentário ${commentId})`);
          } catch (err: any) {
            result.errors.push(`Private reply para @${username}: ${err?.message || String(err)}`);
          }
          await new Promise((resolve) => setTimeout(resolve, OFFICIAL_REPLY_DELAY_MS));
        }
        commentsPage = commentsPage.paging?.next ? await officialGraphRequest<any>(commentsPage.paging.next, accessToken) : undefined;
      }
    }
    mediaUrl = mediaPage.paging?.next;
  }
}

function isOtherUserComment(comment: CommentLike, ownerUsername: string): boolean {
  return Boolean(comment.user?.username) && comment.user!.username!.toLowerCase() !== ownerUsername.toLowerCase();
}

/** Processa os comentários recebidos de qualquer adaptador do Instagram. */
async function processComments(
  comments: CommentLike[],
  mediaId: string,
  trigger: string,
  ownerUsername: string,
  sendDm: (commentId: string, userPk: string, username: string, text: string) => Promise<void>,
  replyPublicly: (text: string, commentId: string) => Promise<void>,
  dmText: string,
  result: MonitorResult,
): Promise<void> {
  for (const comment of comments) {
    result.processedCount++;
    const commentId = comment.pk == null ? '' : String(comment.pk);
    const commenterUsername = comment.user?.username || '';
    const commenterPk = comment.user?.pk == null ? '' : String(comment.user.pk);
    // PASSE permanece aceito como compatibilidade para instalações que ainda têm QUERO salvo no banco.
    const matchesTrigger = commentMatchesTrigger(comment.text || '', trigger) || commentMatchesTrigger(comment.text || '', 'PASSE');
    if (!commentId || !isOtherUserComment(comment, ownerUsername) || !matchesTrigger || processedCommentIds.has(commentId)) continue;

    console.log(`✨ [IG AUTO-DM] Gatilho "${trigger}" detectado de @${commenterUsername} no post ${mediaId}: "${comment.text}"`);
    if (!commenterPk) {
      result.errors.push(`Comentário ${commentId} sem identificador do usuário`);
      continue;
    }

    try {
      await sendDm(commentId, commenterPk, commenterUsername, dmText);
      result.repliesCount++;
      console.log(`  📩 Direct enviado com sucesso para @${commenterUsername}!`);
      try {
        await replyPublicly(`@${commenterUsername} Te mandei o link com desconto no Direct! Confira suas mensagens/solicitações 📥🔥`, commentId);
      } catch (err: any) {
        result.errors.push(`Resposta pública para @${commenterUsername}: ${err?.message || String(err)}`);
      }
      // Só grava como processado depois que o Direct foi confirmado.
      processedCommentIds.add(commentId);

      // Delay humano entre envios para evitar bloqueio anti-spam (15s a 35s)
      const delayMs = Math.floor(Math.random() * 20000) + 15000;
      console.log(`  ⏱️ Pausa de segurança humana (${Math.round(delayMs / 1000)}s) antes da próxima resposta...`);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    } catch (err: any) {
      const msg = err?.message || String(err);
      result.errors.push(`Direct para @${commenterUsername}: ${msg}`);
      console.warn(`  ⚠️ Direct não enviado para @${commenterUsername}; será tentado novamente:`, msg);
    }
  }
}

async function processApiComments(
  ig: IgApiClient,
  posts: any[],
  trigger: string,
  username: string,
  dmText: string,
  result: MonitorResult,
): Promise<void> {
  for (const post of posts.slice(0, 10)) {
    const mediaId = String(post.pk);
    const commentsFeed = ig.feed.mediaComments(mediaId);
    let comments: any[] = [];
    for (let page = 0; page < 3; page++) {
      const next = await commentsFeed.items();
      comments.push(...next);
      if (!(commentsFeed as any).isMoreAvailable()) break;
    }
    result.postsScanned++;
    result.commentsScanned += comments.length;
    await processComments(
      comments,
      mediaId,
      trigger,
      username,
      async (_commentId, userPk, _username, text) => { await ig.entity.directThread([userPk]).broadcastText(text); },
      async (text, commentId) => { await ig.media.comment({ mediaId, text, replyToCommentId: commentId }); },
      dmTextForPost(dmText, post),
      result,
    );
  }
}

type WebComment = CommentLike;

/** Usa a sessão já autenticada do navegador. Este era o fallback vazio que fazia o bot “não reconhecer” comentários. */
async function processBrowserComments(
  username: string,
  password: string | undefined,
  trigger: string,
  dmText: string,
  result: MonitorResult,
): Promise<void> {
  const context = await openInstagramBrowser();
  const page = context.pages()[0] || await context.newPage();
  await page.goto('https://www.instagram.com/accounts/login/', { waitUntil: 'domcontentloaded', timeout: 30000 }).catch(() => {});
  const loginInput = page.locator('input[name="username"], input[autocomplete="username"]').first();
  if (await loginInput.isVisible({ timeout: 2500 }).catch(() => false)) {
    if (!password) throw new Error('Sessão do Instagram não autenticada e senha não configurada.');
    await loginInput.fill(username);
    await page.locator('input[name="password"], input[autocomplete="current-password"]').first().fill(password);
    await page.locator('button[type="submit"], button:has-text("Entrar"), button:has-text("Log in")').first().click();
    await page.waitForTimeout(5000);
    if (await loginInput.isVisible({ timeout: 1500 }).catch(() => false)) throw new Error('Instagram não concluiu o login automático; faça login na janela do Instagram.');
  }
  await page.goto(`https://www.instagram.com/${encodeURIComponent(username)}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
  await page.waitForTimeout(2500);

  const data = await page.evaluate(async (owner) => {
    const csrf = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1] || '';
    const headers: Record<string, string> = { 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest', 'X-CSRFToken': decodeURIComponent(csrf) };
    async function get(path: string): Promise<any> {
      const response = await fetch(path, { credentials: 'include', headers });
      const contentType = response.headers.get('content-type') || '';
      if (!response.ok) throw new Error(`Instagram ${response.status} em ${path}`);
      if (!contentType.includes('application/json')) throw new Error('Sessão do Instagram não autenticada para envio de Direct (Instagram retornou a tela de login).');
      return response.json();
    }
    const profile = await get(`/api/v1/users/web_profile_info/?username=${encodeURIComponent(owner)}`);
    const user = profile?.data?.user;
    let nodes = user?.edge_owner_to_timeline_media?.edges?.map((edge: any) => edge.node).filter(Boolean).slice(0, 10) || [];
    if (nodes.length === 0 && user?.id) {
      const feed = await get(`/api/v1/feed/user/${user.id}/?count=12`);
      nodes = (feed?.items || []).slice(0, 10);
    }
    const output: Array<{ mediaId: string; caption: string; comments: WebComment[] }> = [];
    for (const node of nodes) {
      const mediaId = String(node.pk || node.id || '');
      if (!mediaId) continue;
      const comments = await get(`/api/v1/media/${mediaId}/comments/?can_support_threading=true&permalink_enabled=false&count=100&include_carousel_comments=true`);
      const embedded = node?.edge_media_to_parent_comment?.edges?.map((edge: any) => edge.node).filter(Boolean) || [];
      output.push({ mediaId, caption: node?.caption?.text || node?.edge_media_to_caption?.edges?.[0]?.node?.text || '', comments: comments?.comments || comments?.thread_items || embedded });
    }
    return output;
  }, username);

  for (const post of data) {
    result.postsScanned++;
    result.commentsScanned += post.comments.length;
    await processComments(
      post.comments,
      post.mediaId,
      trigger,
      username,
      async (_commentId, userPk, commenterUsername, text) => {
        try {
          await page.evaluate(async ({ userPk, text }) => {
          const csrf = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1] || '';
          const clientContext = crypto.randomUUID();
          const body = new URLSearchParams({
            recipient_users: JSON.stringify([[userPk]]),
            text,
            action: 'send_item',
            client_context: clientContext,
            mutation_token: clientContext,
          });
          const response = await fetch('/api/v1/direct_v2/threads/broadcast/text/', { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': decodeURIComponent(csrf), 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
          const payload = await response.json().catch(() => ({}));
          if (!response.ok || payload?.status !== 'ok') throw new Error(`Instagram Direct não confirmado (HTTP ${response.status}, status ${payload?.status || 'ausente'}${payload?.message ? `: ${payload.message}` : ''})`);
          }, { userPk, text });
        } catch (apiErr: any) {
          console.warn(`[IG AUTO-DM] Endpoint de Direct falhou para @${commenterUsername}; tentando pela interface:`, apiErr?.message || apiErr);
          await page.goto(`https://www.instagram.com/${encodeURIComponent(commenterUsername)}/`, { waitUntil: 'domcontentloaded', timeout: 30000 });
          await page.waitForTimeout(1800);
          const messageButton = page.locator('button:has-text("Mensagem"), button:has-text("Enviar mensagem"), button:has-text("Message"), button:has-text("Send message"), div[role="button"]:has-text("Mensagem"), div[role="button"]:has-text("Enviar mensagem"), div[role="button"]:has-text("Message"), div[role="button"]:has-text("Send message")').first();
          if (!(await messageButton.isVisible({ timeout: 5000 }).catch(() => false))) throw new Error(`Botão Mensagem não localizado no perfil @${commenterUsername}`);
          await messageButton.click({ force: true });
          const composer = page.locator('textarea[placeholder*="Mensagem"], textarea[placeholder*="Message"], div[contenteditable="true"]').last();
          await composer.waitFor({ state: 'visible', timeout: 10000 });
          await humanType(page, composer, text);
          await composer.press('Enter');
          await page.waitForTimeout(2000);
          const bodyText = await page.locator('body').innerText().catch(() => '');
          if (!bodyText.includes(text.slice(0, Math.min(30, text.length)))) throw new Error(`Mensagem não apareceu na conversa com @${commenterUsername}`);
        }
      },
      async (text, commentId) => {
        await page.evaluate(async ({ mediaId, text, commentId }) => {
          const csrf = document.cookie.match(/(?:^|; )csrftoken=([^;]+)/)?.[1] || '';
          const body = new URLSearchParams({ comment_text: text, reply_to_comment_id: commentId });
          const response = await fetch(`/api/v1/media/${mediaId}/comments/`, { method: 'POST', credentials: 'include', headers: { 'X-CSRFToken': decodeURIComponent(csrf), 'X-IG-App-ID': '936619743392459', 'X-Requested-With': 'XMLHttpRequest', 'Content-Type': 'application/x-www-form-urlencoded' }, body });
          if (!response.ok) throw new Error(`Instagram resposta ${response.status}`);
        }, { mediaId: post.mediaId, text, commentId });
      },
      dmTextForPost(dmText, post),
      result,
    );
  }
}

export async function checkAndReplyInstagramComments(options?: {
  triggerWord?: string;
  dmTemplate?: string;
  username?: string;
  password?: string;
}): Promise<MonitorResult> {
  console.log('\n🤖 [IG AUTO-DM] Iniciando verificação de comentários recentes no Instagram...');
  await loadProcessedCommentsFromDb();
  const config = await loadConfigAsync();
  const dbSettings = await dbGetSettings().catch(() => ({} as Record<string, string>));
  const trigger = (options?.triggerWord || config.instagram.triggerWord || 'PASSE').trim();
  const template = options?.dmTemplate || config.instagram.dmTemplate;
  const username = options?.username || config.instagram.username || dbSettings.INSTAGRAM_USERNAME || 'clickmarido';
  const password = options?.password || config.instagram.password || dbSettings.INSTAGRAM_PASSWORD;
  const history = await getSentOffersHistoryFromDb().catch(() => []);
  const latestOffer = history[0];
  const dmText = formatDmMessage(template, latestOffer?.title || 'Produto em Promoção no Mercado Livre', latestOffer?.permalink || latestOffer?.link || 'https://www.mercadolivre.com.br');
  const result: MonitorResult = { processedCount: 0, repliesCount: 0, errors: [], postsScanned: 0, commentsScanned: 0, triggerWord: trigger };

  // Quando configurada, a API oficial é a fonte única do envio: ela exige o
  // comment_id e confirma a entrega com message_id. Isso evita o erro comum de
  // tentar abrir uma conversa pelo userPk do comentário.
  const officialAccessToken = config.instagram.accessToken || dbSettings.INSTAGRAM_ACCESS_TOKEN || process.env.INSTAGRAM_ACCESS_TOKEN || '';
  const officialUserId = config.instagram.userId || dbSettings.INSTAGRAM_USER_ID || process.env.INSTAGRAM_USER_ID || '';
  const officialGraphVersion = config.instagram.graphVersion || dbSettings.INSTAGRAM_GRAPH_VERSION || process.env.INSTAGRAM_GRAPH_VERSION || 'v23.0';
  if (officialAccessToken || officialUserId) {
    if (!officialAccessToken || !officialUserId) {
      result.errors.push('API oficial incompleta: informe INSTAGRAM_ACCESS_TOKEN e INSTAGRAM_USER_ID.');
      return result;
    }
    try {
      console.log('[IG AUTO-DM] Meta Graph API: lendo comentários e enviando private replies por comment_id...');
      await processOfficialComments(officialAccessToken, officialUserId, officialGraphVersion, trigger, username, dmText, result);
      await saveProcessedCommentsToDb();
      console.log(`[IG AUTO-DM] 🏁 Concluído via API oficial: ${result.repliesCount} envio(s) confirmado(s).`);
      return result;
    } catch (err: any) {
      result.errors.push(`API oficial: ${err?.message || String(err)}`);
      await saveProcessedCommentsToDb();
      return result;
    }
  }

  if (password) {
    try {
      const ig = new IgApiClient();
      ig.state.generateDevice(username);
      if (dbSettings.IG_SESSION_STATE_JSON) await ig.state.deserialize(dbSettings.IG_SESSION_STATE_JSON).catch(() => {});
      console.log(`[IG AUTO-DM] 📲 Autenticando conta @${username} via API...`);
      const authUser = await ig.account.login(username, password);
      const posts = await ig.feed.user(authUser.pk).items();
      await processApiComments(ig, posts, trigger, username, dmText, result);
      await saveProcessedCommentsToDb();
      console.log(`[IG AUTO-DM] 🏁 Concluído via API: ${result.repliesCount} Direct(s) enviado(s).`);
      return result;
    } catch (err: any) {
      const msg = err?.message || String(err);
      console.warn('[IG AUTO-DM] ⚠️ API Mobile indisponível; usando sessão do navegador:', msg);
      result.errors.push(`API Error: ${msg}`);
    }
  }

  try {
    console.log('[IG AUTO-DM] 🌐 Lendo comentários pela sessão autenticada do navegador...');
    await processBrowserComments(username, password, trigger, dmText, result);
  } catch (err: any) {
    const msg = err?.message || String(err);
    console.error('[IG AUTO-DM] Erro no monitor via navegador:', msg);
    result.errors.push(`Browser Error: ${msg}`);
  }
  await saveProcessedCommentsToDb();
  if (result.postsScanned === 0) result.errors.push('Instagram não retornou nenhuma publicação para a conta monitorada.');
  if (result.postsScanned > 0 && result.commentsScanned === 0) result.errors.push('Publicações encontradas, mas o Instagram retornou zero comentários para elas.');
  console.log(`[IG AUTO-DM] 🏁 Concluído: ${result.repliesCount} Direct(s) enviado(s).`);
  return result;
}
