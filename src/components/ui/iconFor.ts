import type { IconName } from './Icon';

const KNOWN = new Set<IconName>([
  'bread', 'egg', 'protein', 'extras', 'sauce', 'dish', 'search', 'grid',
  'list', 'clock', 'lock', 'edit', 'close', 'chat', 'box', 'receipt',
  'download', 'trash', 'plus', 'minus', 'cart',
]);

/**
 * Resolves the glyph a menu fixture names. Unknown names fall back to a
 * generic dish, so a fixture can carry any label without breaking the rail.
 */
export function iconFor(name: string | undefined): IconName {
  return name !== undefined && KNOWN.has(name as IconName) ? (name as IconName) : 'dish';
}
