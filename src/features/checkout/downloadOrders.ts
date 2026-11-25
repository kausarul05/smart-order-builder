/**
 * The "Download orders.json" button (Part E / TC-17).
 *
 * The bytes come from the server's own export payload, so the downloaded
 * file is exactly what `GET /api/orders/export` serves - seed orders and
 * new ones together, in the shape documented in DECISIONS.md (D6).
 */

import { api } from '@/api/client';
import type { OrdersFile } from '@/domain/types';

export const ORDERS_FILE_NAME = 'orders.json';

/** Serialises the store the same way the test asserts it. */
export function serialiseOrdersFile(file: OrdersFile): string {
  return `${JSON.stringify(file, null, 2)}\n`;
}

/** Hands the file to the browser. Returns the byte count written. */
export function saveOrdersFile(file: OrdersFile): number {
  const text = serialiseOrdersFile(file);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  try {
    const link = document.createElement('a');
    link.href = url;
    link.download = ORDERS_FILE_NAME;
    link.rel = 'noopener';
    document.body.append(link);
    link.click();
    link.remove();
  } finally {
    URL.revokeObjectURL(url);
  }
  return text.length;
}

export async function downloadOrders(): Promise<OrdersFile> {
  const { file } = await api.exportOrders();
  saveOrdersFile(file);
  return file;
}
