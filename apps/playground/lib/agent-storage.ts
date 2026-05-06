/**
 * Browser-resident agent index.
 *
 * Persists per-agent metadata (label, network, owner, behaviour rules) to
 * `localStorage` keyed by Core asset mint. **No private keys live here.**
 *
 * In Leash's playground every on-behalf-of-agent action is signed by the
 * connected Privy wallet acting as the agent's registered Executive,
 * per Metaplex's "Run an Agent" docs:
 *
 *   https://www.metaplex.com/docs/agents/run-an-agent
 *
 * That means the user (1) mints the agent (becoming its owner), (2)
 * registers their wallet as an Executive once via
 * {@link registerExecutiveV1}, and (3) delegates execution per-agent via
 * {@link delegateExecutionV1}. After that the wallet can sign Core
 * `Execute` instructions on the agent's behalf without further owner
 * involvement.
 *
 * The buyer cockpit reads behaviour rules from this layer to enforce the
 * policy gate. The seller payment-link builder reads the agent index to
 * pick a receiving agent.
 */

import { z } from 'zod';
import { RulesV1Schema, type RulesV1 } from '@leashmarket/schemas';

const KEY_PREFIX = 'leash:agent:';
const REGISTRY_KEY = 'leash:agents:index';
/**
 * Old key the v0 playground used. We migrate entries on first read so
 * existing users don't lose their tracked agents.
 */
const LEGACY_KEY = 'leash:web:agents';

const LegacyAgentSchema = z.object({
  mint: z.string(),
  label: z.string().optional(),
  capability: z.enum(['buyer', 'seller', 'both']).optional(),
  createdAt: z.string().optional(),
});

const StoredAgentSchema = z.object({
  mint: z.string(),
  label: z.string().optional(),
  network: z.string(),
  owner: z.string().optional(),
  /** Behaviour rules. `null` ⇒ "limitless" (no policy gate). */
  rules: z.union([RulesV1Schema, z.null()]),
  /**
   * The agent treasury's USDC ATA, set when {@link setSpendDelegation} runs.
   * Buyers pass this to `createBuyer({ sourceTokenAccount })` so funds debit
   * from the agent PDA instead of the executive's personal wallet.
   */
  sourceTokenAccount: z.string().optional(),
  /** Mint backing {@link sourceTokenAccount}. Defaults to USDC devnet. */
  fundingMint: z.string().optional(),
  /**
   * The agent treasury (Asset Signer PDA). Mirrors what
   * `findAssetSignerPda(asset)` returns; cached so the dashboard can show
   * it without an extra RPC call.
   */
  treasury: z.string().optional(),
  /**
   * The most recent SPL Approve cap we set on the treasury ATA, recorded
   * in **atomic units** (string to keep bigint compat through JSON).
   *
   * On-chain we only see `delegated_amount`, which decreases with every
   * settled transfer. Caching the original cap lets the UI show
   * "used / remaining" + a progress bar instead of just the bare remaining
   * value. Re-approving overwrites this; revoking clears it.
   */
  allowanceCap: z.string().optional(),
  /** ISO timestamp of the last setSpendDelegation. */
  allowanceUpdatedAt: z.string().optional(),
  createdAt: z.string(),
});

/**
 * Persisted shape. We re-export `rules` as the canonical `RulesV1 | null`
 * (instead of the zod-inferred clone) so consumers reusing
 * `@leashmarket/schemas` don't get the "two different types with the same name"
 * structural-mismatch error.
 */
export type StoredAgent = Omit<z.infer<typeof StoredAgentSchema>, 'rules'> & {
  rules: RulesV1 | null;
};

function safeWindow(): Storage | null {
  if (typeof window === 'undefined') return null;
  try {
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(storage: Storage, key: string, schema: z.ZodType<T>): T | null {
  const raw = storage.getItem(key);
  if (!raw) return null;
  try {
    return schema.parse(JSON.parse(raw));
  } catch {
    return null;
  }
}

function writeJson(storage: Storage, key: string, value: unknown): void {
  storage.setItem(key, JSON.stringify(value));
}

let migrated = false;
function maybeMigrateLegacy(storage: Storage): void {
  if (migrated) return;
  migrated = true;
  const raw = storage.getItem(LEGACY_KEY);
  if (!raw) return;
  let legacy: z.infer<typeof LegacyAgentSchema>[];
  try {
    legacy = z.array(LegacyAgentSchema).parse(JSON.parse(raw));
  } catch {
    return;
  }
  const idx = readJson(storage, REGISTRY_KEY, z.array(z.string())) ?? [];
  const idxSet = new Set(idx);
  for (const a of legacy) {
    if (idxSet.has(a.mint)) continue;
    const stored: StoredAgent = {
      mint: a.mint,
      label: a.label,
      // We have no idea what network these were created on; assume devnet
      // (the only network the v0 playground recommended).
      network: 'solana-devnet',
      rules: null,
      createdAt: a.createdAt ?? new Date().toISOString(),
    };
    writeJson(storage, KEY_PREFIX + a.mint, stored);
    idxSet.add(a.mint);
  }
  writeJson(storage, REGISTRY_KEY, [...idxSet]);
}

/**
 * List every agent the user has tracked on this device. Returns mint
 * addresses + minimal metadata.
 */
export function listAgents(): Array<Pick<StoredAgent, 'mint' | 'label' | 'network' | 'createdAt'>> {
  const s = safeWindow();
  if (!s) return [];
  maybeMigrateLegacy(s);
  const idx = readJson(s, REGISTRY_KEY, z.array(z.string())) ?? [];
  const out: Array<Pick<StoredAgent, 'mint' | 'label' | 'network' | 'createdAt'>> = [];
  for (const mint of idx) {
    const a = readJson(s, KEY_PREFIX + mint, StoredAgentSchema);
    if (a) out.push({ mint: a.mint, label: a.label, network: a.network, createdAt: a.createdAt });
  }
  return out.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Load the full record for one agent. */
export function loadAgent(mint: string): StoredAgent | null {
  const s = safeWindow();
  if (!s) return null;
  maybeMigrateLegacy(s);
  return readJson(s, KEY_PREFIX + mint, StoredAgentSchema);
}

/** Persist or update an agent record. */
export function saveAgent(input: {
  mint: string;
  label?: string;
  network: string;
  owner?: string;
  rules?: RulesV1 | null;
  sourceTokenAccount?: string;
  fundingMint?: string;
  treasury?: string;
  allowanceCap?: string;
  allowanceUpdatedAt?: string;
}): StoredAgent {
  const s = safeWindow();
  if (!s) throw new Error('localStorage unavailable');

  const existing = loadAgent(input.mint);
  const stored: StoredAgent = {
    mint: input.mint,
    label: input.label ?? existing?.label,
    network: input.network,
    owner: input.owner ?? existing?.owner,
    rules: input.rules ?? null,
    sourceTokenAccount: input.sourceTokenAccount ?? existing?.sourceTokenAccount,
    fundingMint: input.fundingMint ?? existing?.fundingMint,
    treasury: input.treasury ?? existing?.treasury,
    allowanceCap: input.allowanceCap ?? existing?.allowanceCap,
    allowanceUpdatedAt: input.allowanceUpdatedAt ?? existing?.allowanceUpdatedAt,
    createdAt: existing?.createdAt ?? new Date().toISOString(),
  };
  writeJson(s, KEY_PREFIX + input.mint, stored);

  const idx = readJson(s, REGISTRY_KEY, z.array(z.string())) ?? [];
  if (!idx.includes(input.mint)) {
    idx.unshift(input.mint);
    writeJson(s, REGISTRY_KEY, idx);
  }
  return stored;
}

/** Update behaviour rules without touching anything else. */
export function updateRules(mint: string, rules: RulesV1 | null): StoredAgent | null {
  const s = safeWindow();
  if (!s) return null;
  const a = loadAgent(mint);
  if (!a) return null;
  const next: StoredAgent = { ...a, rules };
  writeJson(s, KEY_PREFIX + mint, next);
  return next;
}

/** Forget an agent. Cannot be undone. */
export function deleteAgent(mint: string): void {
  const s = safeWindow();
  if (!s) return;
  s.removeItem(KEY_PREFIX + mint);
  const idx = readJson(s, REGISTRY_KEY, z.array(z.string())) ?? [];
  writeJson(
    s,
    REGISTRY_KEY,
    idx.filter((m) => m !== mint),
  );
}

/** Default "limitless" rules used when the user opts out at creation. */
export function isLimitless(rules: RulesV1 | null): boolean {
  return rules === null;
}

/**
 * Concrete `RulesV1` we hand to `createBuyer` when the user picked
 * "limitless". The kit requires a `RulesV1` so we fabricate one that
 * always decides `allow`:
 *   - empty `hosts.allow` → no allow-list = every host passes
 *   - giant budget ceilings → never breached on devnet
 *   - no triggers → no scheduler kicks in
 */
export const LIMITLESS_RULES: RulesV1 = {
  v: '0.1',
  budget: { daily: '1000000', perCall: '1000', currency: 'USDC' },
  hosts: {},
  triggers: [],
};

/** Resolve the rules to evaluate for `mint`. Returns LIMITLESS_RULES when stored rules are `null`. */
export function effectiveRules(mint: string): RulesV1 {
  const a = loadAgent(mint);
  if (!a || a.rules === null) return LIMITLESS_RULES;
  return a.rules;
}
