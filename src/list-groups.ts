import { listGroups } from './whatsapp/client.js';

async function main() {
  console.log('🔍 Conectando ao WhatsApp para listar seus grupos...\n');
  await listGroups();
  process.exit(0);
}

main().catch((err) => {
  console.error('❌ Erro:', err);
  process.exit(1);
});
