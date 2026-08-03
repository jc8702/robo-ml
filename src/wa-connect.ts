/**
 * Script de Conexão Nível Enterprise do WhatsApp (via Playwright / Chrome).
 *
 * Uso: npm run wa:connect
 *
 * - Abre uma janela do Chrome diretamente na sua tela com o WhatsApp Web oficial.
 * - Permite escaneamento do QR Code ou clique em "Vincular com número de telefone".
 * - Salva a sessão permanentemente em .wa-profile/ (nunca expira ou desloga).
 * - Imune a erros de protocolo Baileys 401 / 440 / 515.
 */
import 'dotenv/config';
import { ensureWhatsAppLoggedIn as ensureWa } from './whatsapp/wa-playwright.js';

async function main() {
  console.log('');
  console.log('╔══════════════════════════════════════════════════════════╗');
  console.log('║     🟢  CONECTOR WHATSAPP OFICIAL (PLAYWRIGHT CHROME)   ║');
  console.log('╚══════════════════════════════════════════════════════════╝');
  console.log('');

  try {
    await ensureWa();
    console.log('');
    console.log('📌 Sessão salva permanentemente em: .wa-profile/');
    console.log('📌 A sessão é reutilizada 24/7 sem nunca deslogar.');
    console.log('📌 Pressione Ctrl+C para encerrar esta janela.');
    console.log('');
  } catch (err) {
    console.error('❌ Erro de conexão:', err);
    process.exit(1);
  }
}

main();
