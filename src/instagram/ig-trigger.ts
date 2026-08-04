/** Verifica a palavra-chave como termo isolado, respeitando acentos e pontuação. */
export function commentMatchesTrigger(commentText: string, triggerWord: string): boolean {
  const text = (commentText || '').normalize('NFKC').toLocaleUpperCase('pt-BR');
  const trigger = (triggerWord || 'PASSE').trim().normalize('NFKC').toLocaleUpperCase('pt-BR');
  if (!trigger) return false;
  const escaped = trigger.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text);
}
