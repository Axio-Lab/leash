/**
 * Helpers for "is this thing actually on the other cluster?".
 *
 * Detail pages (tx / receipt / event / agent) are scoped to the current
 * network cookie. When a user lands on `/tx/abc…` while the cookie says
 * `mainnet`, but the row only exists on `devnet`, the page would
 * otherwise look like a hard 404 — confusing because the data does
 * exist, just on the other cluster.
 *
 * Each `probe*` function checks the *opposite* network for the same
 * identifier and reports whether the record exists there. The view
 * layer then renders a `WrongNetworkNotice` banner with a one-click
 * switch instead of a generic empty state.
 *
 * All probes are best-effort: they swallow `DbUnavailableError` and
 * never throw, so the primary view is never blocked by a side-channel
 * lookup failure.
 */

import {
  DbUnavailableError,
  getEventById,
  getReceiptByHash,
  listEvents,
  listEventsForSignature,
  listReceipts,
} from './db';
import { otherNetwork, type Network } from './network';

export type CrossNetworkProbe = {
  /** The cluster the user is currently looking at. */
  current: Network;
  /** The cluster we probed for the same identifier. */
  other: Network;
  /** True when the record exists on `other` but not on `current`. */
  foundOnOther: boolean;
};

async function safe<T>(fn: () => Promise<T>): Promise<T | null> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof DbUnavailableError) return null;
    throw err;
  }
}

export async function probeTxOnOtherNetwork(
  current: Network,
  signature: string,
): Promise<CrossNetworkProbe> {
  const other = otherNetwork(current);
  const rows = await safe(() => listEventsForSignature(other, signature));
  return { current, other, foundOnOther: !!rows && rows.length > 0 };
}

export async function probeReceiptOnOtherNetwork(
  current: Network,
  hash: string,
): Promise<CrossNetworkProbe> {
  const other = otherNetwork(current);
  const r = await safe(() => getReceiptByHash(other, hash));
  return { current, other, foundOnOther: r != null };
}

export async function probeEventOnOtherNetwork(
  current: Network,
  id: string,
): Promise<CrossNetworkProbe> {
  const other = otherNetwork(current);
  const row = await safe(() => getEventById(other, id));
  return { current, other, foundOnOther: row != null };
}

/**
 * "Has this agent ever produced any events or receipts on the other
 * cluster?" Used by the agent page when the current-network feeds are
 * empty. We probe both event + receipt feeds because a brand-new agent
 * may have receipts but zero events yet (or vice versa).
 */
export async function probeAgentOnOtherNetwork(
  current: Network,
  agent: string,
): Promise<CrossNetworkProbe> {
  const other = otherNetwork(current);
  const [events, receipts] = await Promise.all([
    safe(() => listEvents({ network: other, agent, limit: 1 })),
    safe(() => listReceipts({ network: other, agent, limit: 1 })),
  ]);
  const hasEvents = events != null && events.items.length > 0;
  const hasReceipts = receipts != null && receipts.items.length > 0;
  return { current, other, foundOnOther: hasEvents || hasReceipts };
}
