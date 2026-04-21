import type { ReceiptV1 } from '@leash/schemas';

export type ReceiptStore = {
  append(receipt: ReceiptV1): Promise<void>;
};
