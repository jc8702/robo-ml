import { writeFile, mkdir } from 'node:fs/promises';
import { join } from 'node:path';

/**
 * Copia texto para o clipboard do sistema.
 * Usa clipboardy (cross-platform).
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    const { default: clipboardy } = await import('clipboardy');
    await clipboardy.write(text);
    return true;
  } catch {
    console.warn('⚠️  Não foi possível copiar para o clipboard.');
    console.warn('   Instale clipboardy ou copie manualmente do arquivo gerado.');
    return false;
  }
}

/**
 * Salva mensagens em arquivo texto para histórico.
 */
export async function saveToFile(
  messages: string[],
  outputDir: string
): Promise<string> {
  await mkdir(outputDir, { recursive: true });

  const now = new Date();
  const timestamp = now
    .toISOString()
    .replace(/[:.]/g, '-')
    .slice(0, 16);

  const filename = `ofertas-${timestamp}.txt`;
  const filepath = join(outputDir, filename);

  const content = messages.join('\n\n' + '═'.repeat(40) + '\n\n');
  await writeFile(filepath, content, 'utf-8');

  return filepath;
}

/**
 * Exibe preview das mensagens no terminal.
 */
export async function printPreview(messages: string[]): Promise<void> {
  let chalk: typeof import('chalk');
  try {
    chalk = await import('chalk');
  } catch {
    // Fallback sem cores
    for (let i = 0; i < messages.length; i++) {
      console.log(`\n--- Mensagem ${i + 1} de ${messages.length} ---\n`);
      console.log(messages[i]);
    }
    return;
  }

  for (let i = 0; i < messages.length; i++) {
    console.log(
      chalk.default.cyan(`\n┌─── Mensagem ${i + 1} de ${messages.length} ${'─'.repeat(30)}┐\n`)
    );
    console.log(messages[i]);
    console.log(
      chalk.default.cyan(`\n└${'─'.repeat(50)}┘`)
    );
  }
}
