/** Paragraph- and punctuation-aware segmentation for Iraqi Arabic voiceovers.
 * Preserves all words in their original order; normalizes whitespace only.
 */
export function splitScript(input, maximum = 170, minimum = 65) {
  if (!Number.isInteger(maximum) || maximum < 50 || maximum > 220) throw new RangeError('max range: 50..220');
  const cleaned = String(input || '').replace(/\s+/gu, ' ').trim();
  if (!cleaned) return [];
  const words = cleaned.split(' ');
  const output = [];
  let current = '';
  const flush = () => {if (current) {output.push(current); current = '';}};
  for (const word of words) {
    if (word.length > maximum) throw new RangeError('A single word is longer than the segment limit.');
    if (current.length + (current ? 1 : 0) + word.length > maximum) flush();
    current += (current ? ' ' : '') + word;
    // Prefer a complete spoken sentence; don't fragment short sentences.
    if (current.length >= minimum && /[.!؟؛…:]$/u.test(word)) flush();
  }
  flush();
  return output;
}
