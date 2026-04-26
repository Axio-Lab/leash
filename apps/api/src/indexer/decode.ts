/**
 * Transaction decoder.
 *
 * The Solana RPC log stream is the most stable contract Metaplex
 * programs expose — the IDL bytes shift with every program release, but
 * `Program 1DREG…` log lines and the `Program log: Instruction: …`
 * messages are part of the program's public interface. We classify
 * events by matching those log strings, then enrich the row with
 * derived data (mint, amount, treasury) using the parsed
 * `tokenBalanceDeltas` and `lamportDeltas`.
 *
 * This is intentionally conservative: when the decoder cannot pin an
 * event down it returns `null` rather than guessing. The indexer logs
 * unknown signatures so the explorer still shows them, but they don't
 * pretend to be a known event kind.
 */

import type { EventKind } from '../storage/events.js';
import type { RpcParsedTransaction } from './rpc.js';
import { KNOWN_PROGRAMS } from './programs.js';

export type DecodedEvent = {
  kind: EventKind;
  signature: string;
  slot: number;
  blockTime: number | null;
  agentAsset: string | null;
  /**
   * Mint of the SPL token whose balance changed for the agent treasury,
   * if applicable. `null` for SOL transfers and non-treasury flows.
   */
  mint: string | null;
  /**
   * Atomic amount as a base-10 string. Always the *negative* delta of
   * the treasury balance for withdraw events (so a withdraw of 1 USDC
   * is `"1000000"`, not `"-1000000"`).
   */
  amountAtomic: string | null;
  metadata: Record<string, unknown>;
};

export type DecodeContext = {
  /**
   * Pubkey of the watched address that surfaced this signature. Lets
   * the decoder know which role to attribute (asset vs treasury) when
   * a single transaction touches both.
   */
  watchedAddress: string;
  watchedKind: 'asset' | 'treasury' | 'treasury_ata' | 'leash_fee_ata';
  /**
   * For `'asset' | 'treasury' | 'treasury_ata'` rows this is the
   * mpl-core asset pubkey of the agent. For `'leash_fee_ata'` rows
   * the agent column carries the **fee authority** pubkey (the SPL
   * owner of the fee ATA) — it's not a real agent, but the decoder
   * uses it the same way to look up the SPL owner for delta keying.
   */
  agentAsset: string;
  /**
   * Treasury PDA owned by `agentAsset`. Required when
   * `watchedKind === 'treasury_ata'`: the ATA itself is in the tx
   * account list (so the signature surfaces) but the deltas we need
   * are keyed by the ATA's owner (= the PDA). The indexer derives
   * this once per agent and passes it down so the decoder doesn't
   * need a Umi instance.
   *
   * For `'leash_fee_ata'` rows we re-use the same field to carry the
   * fee-authority pubkey (which is the ATA owner), so the inflow
   * detection branch doesn't need a separate plumbing path.
   */
  treasuryAddress?: string;
};

/**
 * Decode a single parsed transaction into 0..n normalized events.
 *
 * Why 0..n: a single signature can fan out into multiple Leash events
 * (e.g. a multi-mint treasury withdraw bundle emits one
 * `agent.treasury.withdraw` per mint). Returning an array keeps the
 * caller code uniform.
 */
export function decodeTransaction(tx: RpcParsedTransaction, ctx: DecodeContext): DecodedEvent[] {
  const events: DecodedEvent[] = [];
  const logs = tx.logs;
  const isFailed = tx.err != null;

  // ---- Identity program ----
  if (tx.programIds.includes(KNOWN_PROGRAMS.identity)) {
    if (logsMatch(logs, KNOWN_PROGRAMS.identity, 'CreateIdentity')) {
      events.push(baseEvent('agent.identity.register', tx, ctx));
    } else if (logsMatch(logs, KNOWN_PROGRAMS.identity, 'UpdateIdentity')) {
      events.push({
        ...baseEvent('agent.identity.register', tx, ctx),
        metadata: { update: true },
      });
    }
  }

  // ---- Tools program: executive + delegation ----
  if (tx.programIds.includes(KNOWN_PROGRAMS.tools)) {
    if (logsMatch(logs, KNOWN_PROGRAMS.tools, 'CreateExecutive')) {
      events.push(baseEvent('agent.executive.register', tx, ctx));
    }
    if (
      logsMatch(logs, KNOWN_PROGRAMS.tools, 'AddDelegate') ||
      logsMatch(logs, KNOWN_PROGRAMS.tools, 'AddTrustedDelegate')
    ) {
      events.push(baseEvent('agent.executive.delegate', tx, ctx));
    }
    if (logsMatch(logs, KNOWN_PROGRAMS.tools, 'SetAgentToken')) {
      events.push(baseEvent('agent.token.set', tx, ctx));
    }
  }

  // ---- SPL Approve / Revoke (delegation set/revoke) ----
  // The SDK's `prepareSetSpendDelegation` always boils down to an SPL
  // Token `Approve` instruction with the agent's executive PDA as the
  // delegate. `Revoke` is the inverse. We detect by program log.
  if (
    tx.programIds.includes(KNOWN_PROGRAMS.splToken) ||
    tx.programIds.includes(KNOWN_PROGRAMS.token2022)
  ) {
    const splProgramId = tx.programIds.includes(KNOWN_PROGRAMS.token2022)
      ? KNOWN_PROGRAMS.token2022
      : KNOWN_PROGRAMS.splToken;
    if (logsMatch(logs, splProgramId, 'Approve')) {
      events.push({
        ...baseEvent('agent.delegation.set', tx, ctx),
        metadata: { token_program: splProgramId },
      });
    }
    if (logsMatch(logs, splProgramId, 'Revoke')) {
      events.push({
        ...baseEvent('agent.delegation.revoke', tx, ctx),
        metadata: { token_program: splProgramId },
      });
    }
  }

  // ---- mpl-core Execute (treasury withdraws + ATA provisioning) ----
  // `Execute` is the only path the agent's treasury PDA signs through,
  // so any `Execute` log on the asset is by definition a treasury
  // operation. We then use balance deltas to decide whether it's an SPL
  // withdraw, SOL withdraw, or ATA provisioning (no balance change but
  // a new account created).
  if (
    tx.programIds.includes(KNOWN_PROGRAMS.core) &&
    logsMatch(logs, KNOWN_PROGRAMS.core, 'Execute')
  ) {
    // SOL withdraw: treasury PDA's lamport balance went *down*.
    const solOut = tx.lamportDeltas.find(
      (d) => d.pubkey === ctx.watchedAddress && BigInt(d.delta) < 0n,
    );
    if (ctx.watchedKind === 'treasury' && solOut) {
      events.push({
        ...baseEvent('agent.treasury.withdraw_sol', tx, ctx),
        amountAtomic: (-BigInt(solOut.delta)).toString(),
        metadata: { destination_lamports_delta: solOut.delta },
      });
    }

    // SPL withdraw: treasury (owner) lost some token amount.
    const splOuts = tx.tokenBalanceDeltas.filter(
      (d) => d.owner === ctx.watchedAddress && BigInt(d.delta) < 0n,
    );
    for (const d of splOuts) {
      events.push({
        ...baseEvent('agent.treasury.withdraw', tx, ctx),
        mint: d.mint,
        amountAtomic: (-BigInt(d.delta)).toString(),
      });
    }

    // ATA provisioning: no balance change, but the watched address is
    // the asset (owner role) and we saw an `splAssociatedToken Create`
    // line. Best-effort detection.
    if (
      events.length === 0 &&
      logs.some((l) => l.includes('Create') && l.includes('AssociatedTokenAccount'))
    ) {
      events.push(baseEvent('agent.treasury.provision', tx, ctx));
    }
  }

  // ---- Leash protocol fee inflows ----
  // Watchlist rows with `kind='leash_fee_ata'` track the fee
  // treasury's ATAs directly. Any positive token delta on the
  // configured fee authority is a protocol-fee collection; we emit
  // one `protocol.fee.collected` event per (mint, signature) pair.
  // The receipt-side ingest path emits the same event with
  // richer context (receipt_hash, gross/net split). To avoid
  // duplicates the chain-event writer dedups on
  // `(network, signature, kind, mint)` — see `ingestChainEvent`.
  if (ctx.watchedKind === 'leash_fee_ata') {
    const feeAuthority = ctx.treasuryAddress ?? ctx.agentAsset;
    const splIns = tx.tokenBalanceDeltas.filter(
      (d) => d.owner === feeAuthority && BigInt(d.delta) > 0n,
    );
    for (const d of splIns) {
      events.push({
        ...baseEvent('protocol.fee.collected', tx, ctx),
        agentAsset: null, // fee authority is not a real agent
        mint: d.mint,
        amountAtomic: BigInt(d.delta).toString(),
        metadata: {
          fee_amount: BigInt(d.delta).toString(),
          fee_ata: ctx.watchedAddress,
          fee_authority: feeAuthority,
          source: 'on_chain',
        },
      });
    }
    // Fee ATAs only carry inflow signal — short-circuit the rest of
    // the decoder so we don't accidentally double-classify.
    if (isFailed) {
      for (const e of events) {
        e.metadata = { ...e.metadata, on_chain_failed: true, on_chain_err: tx.err };
      }
    }
    return events;
  }

  // ---- Treasury funding (incoming transfers) ----
  // Whenever the watched treasury *receives* funds — owner top-ups,
  // x402 settlements landing in the seller's treasury, third-party
  // donations, anything — the parsed transaction shows a positive
  // balance delta on the treasury PDA. We classify those as
  // `agent.treasury.fund` (SPL) or `agent.treasury.fund_sol` (native).
  //
  // Two surface paths:
  //   - `watchedKind === 'treasury'`     — the PDA itself appeared in
  //     the tx (e.g. SOL transfer where the PDA is `to`, or rare
  //     contracts that pass the PDA explicitly).
  //   - `watchedKind === 'treasury_ata'` — a stable ATA owned by the
  //     PDA appeared in the tx (every plain SPL `TransferChecked`
  //     deposit goes through this path). For these rows the PDA is
  //     never in the account list, so we resolve it from
  //     `ctx.treasuryAddress`.
  //
  // Mutual exclusion with the withdraw branch above is automatic for
  // the SPL case (the treasury can't be both sender and receiver of a
  // single transfer of the same mint). The `events.some(...)` guards
  // additionally protect against races where an Execute that sweeps
  // multiple mints could otherwise produce a phantom fund row.
  const treasuryAddrForFund =
    ctx.watchedKind === 'treasury'
      ? ctx.watchedAddress
      : ctx.watchedKind === 'treasury_ata'
        ? ctx.treasuryAddress
        : undefined;

  if (treasuryAddrForFund) {
    const splInsAlreadyHandled = events.some((e) => e.kind === 'agent.treasury.withdraw');
    if (!splInsAlreadyHandled) {
      const splIns = tx.tokenBalanceDeltas.filter(
        (d) => d.owner === treasuryAddrForFund && BigInt(d.delta) > 0n,
      );
      for (const d of splIns) {
        events.push({
          ...baseEvent('agent.treasury.fund', tx, ctx),
          mint: d.mint,
          amountAtomic: BigInt(d.delta).toString(),
        });
      }
    }

    // SOL fund detection only makes sense for the PDA watch — an SPL
    // ATA has its own lamport balance for rent and we don't want to
    // surface that as a deposit.
    if (ctx.watchedKind === 'treasury') {
      const solInAlreadyHandled = events.some((e) => e.kind === 'agent.treasury.withdraw_sol');
      if (!solInAlreadyHandled) {
        const solIn = tx.lamportDeltas.find(
          (d) => d.pubkey === treasuryAddrForFund && BigInt(d.delta) > 0n,
        );
        // Skip dust: a treasury PDA's lamport balance can wobble by a few
        // lamports during ATA rent rebates without representing a real
        // deposit. Anything below 5_000 lamports (a typical fee) is noise.
        if (solIn && BigInt(solIn.delta) >= 5_000n) {
          events.push({
            ...baseEvent('agent.treasury.fund_sol', tx, ctx),
            amountAtomic: BigInt(solIn.delta).toString(),
            metadata: { source_lamports_delta: solIn.delta },
          });
        }
      }
    }
  }

  // Mark failed events with phase/error in metadata so the writer can
  // promote them to `phase=failed` with full visibility on the
  // explorer feed.
  if (isFailed) {
    for (const e of events) {
      e.metadata = { ...e.metadata, on_chain_failed: true, on_chain_err: tx.err };
    }
  }

  return events;
}

function logsMatch(logs: string[], programId: string, instruction: string): boolean {
  // Examples we match:
  //   `Program 1DREG... invoke [1]`
  //   `Program log: Instruction: CreateIdentity`
  //   `Program TLREG... success`
  // Looking for the logical pair (`invoke` line + `Instruction: <name>`
  // line) inside a single transaction is good enough here — we don't
  // need to model the full nested invocation tree.
  let inProgram = false;
  for (const line of logs) {
    if (line.startsWith('Program ') && line.includes(programId) && line.endsWith(' [1]')) {
      inProgram = true;
      continue;
    }
    if (line.startsWith('Program ') && line.includes(' success')) {
      inProgram = false;
      continue;
    }
    if (inProgram && line.startsWith('Program log: Instruction: ') && line.endsWith(instruction)) {
      return true;
    }
    // SPL token program emits unprefixed `Program log: Instruction: Approve`
    // even when invoked CPI; relax the strict `inProgram` check for SPL.
    if (
      (programId === KNOWN_PROGRAMS.splToken || programId === KNOWN_PROGRAMS.token2022) &&
      line === `Program log: Instruction: ${instruction}`
    ) {
      return true;
    }
  }
  return false;
}

function baseEvent(kind: EventKind, tx: RpcParsedTransaction, ctx: DecodeContext): DecodedEvent {
  return {
    kind,
    signature: tx.signature,
    slot: tx.slot,
    blockTime: tx.blockTime,
    agentAsset: ctx.agentAsset,
    mint: null,
    amountAtomic: null,
    metadata: {},
  };
}
