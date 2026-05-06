import type { ReceiptV1 } from '@leashmarket/schemas';

export type ReceiptStore = {
  append(receipt: ReceiptV1): Promise<void>;
};
