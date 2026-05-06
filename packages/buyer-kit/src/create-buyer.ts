import type {
  MppChallengeV1,
  ReceiptAny,
  ReceiptV02Mpp,
  ReceiptV1,
  RulesV1,
} from '@leashmarket/schemas';
import { ReceiptV02MppSchema } from '@leashmarket/schemas';
import {
  buildAndSignMppTransfer,
  buildMppAuthorizationHeader,
  canonicalJson,
  computeFeeAtoms,
  computeReceiptHash,
  createSvmBuyerFetch,
  currencyForAsset,
  decodePaymentResponseHeader,
  defaultFacilitatorFor,
  deriveAgentTreasuryAta,
  detectProtocol,
  evaluate,
  finalizeReceipt,
  inspectSplTokenAccount,
  KNOWN_STABLE_SYMBOLS,
  lookupTokenBySymbol,
  networkFromCaip2,
  parseLeashFeeExtra,
  paymentRequirementsHash,
  requestHash,
  TOKEN_2022_PROGRAM_ADDRESS,
  tokenProgramForMint,
  type ClientSvmSigner,
  type KnownStableSymbol,
  type LeashFetch,
  type LeashX402Network,
  type MppCredentialV1,
  type PaymentRequirements,
  type PolicyState,
  type TokenNetwork,
} from '@leashmarket/core';

export type BuyerConfig = {
  agent: string;
  rules: RulesV1;
  /** Initial spent today (decimal string). */
  spentToday?: string;
  /**
   * `@solana/kit` `TransactionSigner` used to sign x402 SPL token transfers.
   * On Node, build it via `createKeyPairSignerFromBytes(secret) via @solana/kit`. In the
   * browser, use the Privy → kit adapter (`apps/playground/lib/privy-x402-signer.ts`).
   */
  signer: ClientSvmSigner;
  /**
   * Solana clusters to register on the underlying x402Client. The buyer will
   * pay against any `paymentRequirements` whose network matches one of these.
   * Defaults to `['solana-devnet']` so dev runs never accidentally touch
   * mainnet USDC.
   */
  networks?: LeashX402Network[];
  /** Optional custom RPC URL passed to `ExactSvmScheme`. */
  rpcUrl?: string;
  /**
   * If set, payments use the Leash delegate scheme instead of the default
   * `ExactSvmScheme`: funds debit from this token account (e.g. an agent
   * treasury PDA's USDC ATA) and `signer` signs as the SPL **delegate** of
   * that account. The owner of the account must have previously approved
   * `signer.address` for at least the per-call price (see
   * `setSpendDelegation` in `@leashmarket/registry-utils`).
   *
   * Leave undefined for vanilla "signer pays from their own ATA" flow.
   */
  sourceTokenAccount?: string;
  /**
   * Facilitator label/URL written to receipts. The buyer never talks to the
   * facilitator directly — the seller does — but recording it on the receipt
   * lets explorers double-check settlement out-of-band. Defaults to
   * `'https://facilitator.svmacc.tech'` to match `@leashmarket/seller-kit`'s default.
   */
  facilitator?: string;
  /**
   * Called with every finalized receipt (allowed and denied). Use this to
   * ship receipts to the Leash runner — e.g.
   * `onReceipt: (r) => fetch(`${RUNNER}/a/${r.agent}/receipts`, { method: 'POST', body: JSON.stringify(r) })`.
   * Errors thrown here are swallowed so a runner outage never breaks a buyer call.
   *
   * Pass `false` to explicitly disable receipt publishing, even if env-
   * level defaults (LEASH_RUNNER_URL / LEASH_API_URL) are configured.
   * The receipt object is **always** still returned on
   * `BuyerCallResult.receipt` regardless of this setting.
   */
  onReceipt?: ((receipt: ReceiptAny) => void | Promise<void>) | false;
  /**
   * Optional fan-out destinations applied when `onReceipt` is undefined
   * (the implicit default). Either or both can be set; Leash also looks
   * at process env vars `LEASH_RUNNER_URL`, `LEASH_API_URL`, and
   * `LEASH_API_KEY` so the most common dev/prod setup needs zero code
   * changes — drop in a key and receipts start flowing.
   *
   * Setting `LEASH_RECEIPTS_DISABLED=1` is the global kill switch.
   */
  receipts?: ReceiptForwardConfig;
  /**
   * Optional `fetch` override (defaults to a payment-wrapped `globalThis.fetch`).
   * Pass a pre-built one when you've already constructed the x402 client (e.g.
   * for testing with a mock facilitator).
   */
  fetch?: LeashFetch;
  /**
   * Preferred stablecoin (`'USDC' | 'USDT' | 'USDG'`) to settle in when the
   * seller advertises multiple `accepts[]` entries for the same route. The
   * buyer picks the matching `paymentRequirement` (by mint), so a USDC-
   * priced endpoint can be paid in USDG as long as the seller advertised
   * USDG as an alternative. Falls back to the first matching network entry
   * when no preferred currency match is found.
   */
  preferredCurrency?: KnownStableSymbol;
};

export type BuyerCallResult = {
  response: Response;
  /**
   * Receipt for this call. v0.1 for x402 payments (kept for wire stability),
   * v0.2 with `protocol: 'mpp'` for MPP payments. Use `parseReceiptAny` to
   * read either shape; `receipt.protocol` (when present) discriminates.
   */
  receipt: ReceiptAny;
  /** Protocol detected on a 402, if any. `undefined` for non-paywall calls. */
  protocol?: 'x402' | 'mpp';
  /**
   * The price the seller actually demanded (decoded from the `payment-required`
   * header). Present whenever the seller returned 402, regardless of whether
   * settlement succeeded. Useful for the UI to say "tried to pay 5 USDC but…".
   */
  quotedPrice?: ReceiptV1['price'];
  /**
   * Human-readable reason the call did not settle. Sourced from the seller's
   * `payment-required` header `error` field on 402s where no
   * `PAYMENT-RESPONSE` came back. `undefined` on successful settlement.
   */
  failureReason?: string;
};

export type Buyer = {
  fetch(url: string, init?: RequestInit): Promise<BuyerCallResult>;
};

/**
 * Implicit forwarding destinations used when `onReceipt` is not set on
 * a `createBuyer` / `createSeller` call. Either or both may be omitted;
 * the kit also reads env vars (see `resolveDefaultReceiptSink`).
 *
 * Receipt forwarding is best-effort: a failure here never breaks the
 * caller's payment flow. Each fan-out target is invoked with its own
 * `try/catch` so one outage cannot starve the other.
 */
export type ReceiptForwardConfig = {
  /**
   * Leash runner base URL (e.g. `http://localhost:8787`). When set, the
   * buyer/seller POSTs receipts to `${url}/a/${agent}/receipts`.
   */
  runnerUrl?: string;
  /**
   * Leash API base URL (e.g. `https://api.leash.market`). When set
   * together with `apiKey`, the buyer/seller POSTs receipts to
   * `${url}/v1/receipts/${agent}` with a Bearer token.
   */
  apiUrl?: string;
  /** API key used for the API fan-out. Required if `apiUrl` is set. */
  apiKey?: string;
  /**
   * Optional `fetch` override. Test harnesses and bundlers without a
   * global fetch can supply one; production code can leave this unset.
   */
  fetch?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
};

// Imported from @leashmarket/core. Re-resolved on every createBuyer call so the
// LEASH_FACILITATOR_URL env override applies even when buyer-kit is bundled
// without process polyfills (the helper guards `typeof process`).

/**
 * Build a Leash buyer agent. The returned `fetch` enforces the policy
 * (`RulesV1`) before paying, then delegates to a real x402-on-Solana fetch
 * (`@x402/fetch` + `ExactSvmScheme`). On every call (paid or denied) it
 * emits a tamper-evident `ReceiptV1` via `onReceipt` so receipts land in
 * the explorer.
 */
export function createBuyer(cfg: BuyerConfig): Buyer {
  const networks = cfg.networks ?? (['solana-devnet'] as LeashX402Network[]);
  const facilitator = cfg.facilitator ?? defaultFacilitatorFor(networks);
  // Build the actual receipt sink. Precedence:
  //   1. Explicit `false` => no publishing, never. Receipt is still
  //      returned on `BuyerCallResult.receipt`.
  //   2. User-supplied function => used as-is (no env fallback so the
  //      author keeps total control).
  //   3. Default fan-out built from `cfg.receipts` and process env vars.
  //      Either runner, API, or both can be configured.
  const receiptSink = resolveReceiptSink(cfg.onReceipt, cfg.receipts);
  // Resolve the preferred currency to a concrete mint address so the x402
  // client selector can match seller-advertised `accepts[]` entries by asset.
  // Picks the network of the first configured cluster — buyer-kit only
  // registers schemes for `cfg.networks` so this is safe.
  const preferredAsset = resolvePreferredAsset(cfg.preferredCurrency, networks);
  const paidFetch =
    cfg.fetch ??
    createSvmBuyerFetch({
      signer: cfg.signer,
      networks,
      ...(cfg.rpcUrl ? { rpcUrl: cfg.rpcUrl } : {}),
      ...(cfg.sourceTokenAccount ? { sourceTokenAccount: cfg.sourceTokenAccount } : {}),
      ...(preferredAsset ? { preferredAsset } : {}),
    });

  const state: PolicyState = {
    rules: cfg.rules,
    spentToday: cfg.spentToday ?? '0',
    recentRequestHashes: [],
  };

  return {
    async fetch(url, init): Promise<BuyerCallResult> {
      const method = (init?.method ?? 'GET').toUpperCase();
      const body = init?.body != null ? String(init.body) : null;
      const h = requestHash({ method, url, body });
      const pol = evaluate(
        { method, url, requestHash: h, estimatedPrice: cfg.rules.budget.perCall },
        cfg.rules,
        state,
      );

      if (pol.decision === 'deny') {
        const draft = {
          v: '0.1' as const,
          kind: 'spend' as const,
          agent: cfg.agent,
          nonce: state.recentRequestHashes.length,
          ts: new Date().toISOString(),
          policy_v: cfg.rules.v,
          request: { method, url, body_hash: body ? requestHash({ method, url, body }) : null },
          decision: 'deny' as const,
          reason: pol.reason ?? 'deny',
          price: null,
          facilitator: null,
          tx_sig: null,
          response: null,
          prev_receipt_hash: null,
        };
        const receipt = finalizeReceipt(draft);
        await receiptSink(receipt);
        return {
          response: new Response(JSON.stringify({ error: pol.reason }), { status: 403 }),
          receipt,
        };
      }

      // Run the (payment-wrapped) fetch but never let a transport-layer
      // exception bubble up as an unhandled rejection — we always want to
      // emit a receipt that records *why* the call failed. Common causes:
      //   - Privy popup was cancelled (`wallet_signing_rejected`)
      //   - Facilitator returned a non-2xx response while settling
      //   - RPC is unreachable / rate-limited
      //   - `Response.error()` produced by `@x402/fetch` on bad headers
      let response: Response;
      let networkError: string | null = null;
      try {
        response = await paidFetch(url, init);
      } catch (err) {
        networkError = err instanceof Error ? err.message : String(err);
        // Synthesize a Response so callers always see a uniform shape.
        // Modern Node disallows `status: 0` (must be 200–599), so we use
        // a 599 sentinel and rely on `networkError` to flag the synthetic
        // path downstream rather than the status code alone.
        response = new Response(JSON.stringify({ error: networkError }), {
          status: 599,
          statusText: 'Network error',
        });
      }
      state.recentRequestHashes.push(h);

      // Try header-based settlement first, then fall back to mining
      // `?leash_tx=…&leash_receipt=…&leash_agent=…` query params off
      // `response.url`. The Leash seller-kit doesn't produce those today
      // (the legacy 303-redirect hook was removed), but the URL fallback
      // stays in place as defensive code in case a buyer-side proxy ever
      // re-attaches them after eating the X-Leash-* headers.
      const settlement = parseSettlement(response) ?? parseRedirectSettlement(response);

      // MPP fallback: x402's `wrapFetchWithPayment` only auto-pays 402s that
      // carry a `payment-required` header. An MPP 402 (problem+json body, no
      // header) falls through to here unchanged. Detect it, sign the SPL
      // transfer, retry — and emit a v0.2 mpp receipt instead of v0.1.
      if (!settlement && response.status === 402) {
        const mppRoute = await tryMppRouteFromResponse({ response, url, init, cfg, networks });
        if (mppRoute) {
          state.recentRequestHashes.push(h);
          const mppReceipt = buildMppReceipt({
            cfg,
            nonce: state.recentRequestHashes.length - 1,
            method,
            url,
            body,
            challenge: mppRoute.challenge,
            response: mppRoute.response,
            settlement: mppRoute.settlement,
            facilitator,
          });
          await receiptSink(mppReceipt);
          return {
            response: mppRoute.response,
            receipt: mppReceipt,
            protocol: 'mpp',
            quotedPrice: priceFromMppChallenge(mppRoute.challenge),
            ...(mppRoute.failureReason ? { failureReason: mppRoute.failureReason } : {}),
          };
        }
      }
      // `Response.error()` surfaces as `status: 0` AND `type === 'error'`.
      // **Opaque redirects** also surface as `status: 0` — but they mean the
      // request actually succeeded; the browser just stripped headers because
      // the caller asked for `redirect: 'manual'`. We MUST NOT classify
      // those as network failures, otherwise users see "request never reached
      // the seller" even though their USDC was debited.
      const isOpaqueRedirect =
        response.type === 'opaqueredirect' || (response.status === 0 && response.redirected);
      if (!networkError && response.status === 0 && !isOpaqueRedirect) {
        networkError =
          'Network error — the request did not reach the seller. The signer popup was likely cancelled, or the facilitator/RPC was unreachable.';
      }
      // Suppress the synthetic message if we now know it was a successful
      // opaque redirect (our earlier branch may have set a generic string).
      if (isOpaqueRedirect) networkError = null;

      // If the seller returned 402, decode its `payment-required` header so we
      // can record what was actually demanded and *why* it didn't settle.
      // We need to .clone() because callers will still want to read the body.
      // Pass `preferredAsset` so the quoted price reflects the entry the
      // buyer would have actually attempted (e.g. USDG) instead of the
      // seller's primary `accepts[0]` (e.g. USDC). Otherwise multi-currency
      // sellers always stamp the receipt with the primary even on a USDG
      // settlement attempt — which is technically wrong and hides the
      // real failure surface from explorers.
      const quote =
        response.status === 402 && !settlement
          ? await parsePaymentRequired(response.clone(), networks, preferredAsset)
          : null;

      const sellerReason = settlement ? null : (quote?.error ?? networkError ?? null);

      // Reclassify a generic facilitator/seller error into something the UI
      // can act on (top up the treasury vs. raise the allowance vs. pop the
      // signer again). We do this when:
      //   - the seller failed at 402 (no PAYMENT-RESPONSE),
      //   - we know the demanded price (quote.price.amount), and
      //   - we have an RPC URL to read state from.
      //
      // The source token account is resolved in this order so callers don't
      // have to plumb it manually:
      //   1. `cfg.sourceTokenAccount` (explicit override; fastest path)
      //   2. Derived from `cfg.agent` + `quote.price.asset` via
      //      {@link deriveAgentTreasuryAta} (kit-native PDA derivation;
      //      identical to what `setSpendDelegation` writes to on-chain).
      // Falling back to (2) means brand-new agents that never had their ATA
      // cached client-side still get the precise diagnostic on a 402 — UI no
      // longer surfaces the seller's raw "transaction_simulation" string.
      let preflightReason: string | null = null;
      if (!settlement && quote?.price?.amount && cfg.rpcUrl && response.status === 402) {
        let sourceAta: string | null = cfg.sourceTokenAccount ?? null;
        if (!sourceAta && quote.price.asset && cfg.agent) {
          try {
            // Pick the SPL token program from the catalogued mint so
            // Token-2022 stables (USDG today; future Token-2022 issuers
            // tomorrow) derive the correct ATA. Without this the preflight
            // checked the legacy-program ATA and reported `ata_missing`
            // even when the treasury did hold USDG.
            const program =
              tokenProgramForMint(quote.price.asset) === 'spl-token-2022'
                ? TOKEN_2022_PROGRAM_ADDRESS
                : undefined;
            const { ata } = await deriveAgentTreasuryAta({
              asset: cfg.agent,
              mint: quote.price.asset,
              ...(program ? { tokenProgram: program } : {}),
            });
            sourceAta = String(ata);
          } catch {
            /* malformed asset/agent string — fall through, no preflight */
          }
        }
        if (sourceAta) {
          try {
            const tokenState = await inspectSplTokenAccount({
              rpcUrl: cfg.rpcUrl,
              address: sourceAta,
            });
            const required = BigInt(quote.price.amount);
            if (!tokenState) {
              preflightReason = 'ata_missing';
            } else if (tokenState.amount < required) {
              preflightReason = 'insufficient_balance';
            } else if (!tokenState.delegate) {
              preflightReason = 'no_delegate';
            } else if (tokenState.delegate !== String(cfg.signer.address)) {
              preflightReason = 'wrong_delegate';
            } else if (tokenState.delegatedAmount < required) {
              preflightReason = 'insufficient_allowance';
            }
          } catch {
            /* RPC hiccup — keep the seller-reported reason */
          }
        }
      }

      // When pre-flight is more specific than the seller, prefer it but keep
      // the seller string as breadcrumb (e.g. "insufficient_balance:
      // transaction_simulation"). UI panels match on the prefix so the
      // suffix is purely diagnostic.
      const failureReason = preflightReason
        ? sellerReason && sellerReason !== preflightReason
          ? `${preflightReason}: ${sellerReason}`
          : preflightReason
        : sellerReason;

      const settled = settlement?.txSig != null && settlement.txSig.length > 0;
      const callFailed =
        networkError != null || response.status === 402 || (response.status >= 400 && !settled);
      const decision: 'allow' | 'rejected' = callFailed ? 'rejected' : 'allow';

      const draft = {
        v: '0.1' as const,
        kind: 'spend' as const,
        agent: cfg.agent,
        nonce: state.recentRequestHashes.length - 1,
        ts: new Date().toISOString(),
        policy_v: cfg.rules.v,
        request: { method, url, body_hash: body ? requestHash({ method, url, body }) : null },
        decision,
        // Surface the seller / facilitator / network error verbatim so
        // receipts carry a usable failure reason ("insufficient_funds",
        // "facilitator_error", "Network error — …") instead of a silent
        // null.
        reason: failureReason,
        // Order of precedence:
        //   1. Settled price (truth)                   ← from PAYMENT-RESPONSE
        //   2. Seller-quoted price on a failed 402     ← from payment-required
        //   3. null (we never made a quote-able call)
        // Falling back to `rules.budget.perCall` (the previous behaviour) was a
        // bug — it stamped the policy ceiling on the receipt as if it were the
        // demanded price.
        price: settlement?.price ?? quote?.price ?? null,
        facilitator,
        tx_sig: settlement?.txSig ?? null,
        payment_requirements_hash: settlement?.requirementsHash ?? quote?.requirementsHash ?? null,
        response: { status: response.status, body_hash: null },
        prev_receipt_hash: null,
      };
      const receipt = finalizeReceipt(draft);
      await receiptSink(receipt);
      return {
        response,
        receipt,
        protocol: 'x402',
        quotedPrice: quote?.price,
        failureReason: failureReason ?? undefined,
      };
    },
  };
}

type Settlement = {
  txSig: string | null;
  price: ReceiptV1['price'];
  requirementsHash: string | null;
};

/**
 * Pull the real Solana signature and matched `paymentRequirements` out of the
 * `PAYMENT-RESPONSE` / `X-PAYMENT-RESPONSE` header that the seller sets after
 * the facilitator settles. We try v2 (`PAYMENT-RESPONSE`) first, then v1.
 */
function parseSettlement(response: Response): Settlement | null {
  const header =
    response.headers.get('PAYMENT-RESPONSE') ??
    response.headers.get('X-PAYMENT-RESPONSE') ??
    response.headers.get('payment-response');
  if (!header) return null;
  let decoded: unknown;
  try {
    decoded = decodePaymentResponseHeader(header);
  } catch {
    return null;
  }
  if (!decoded || typeof decoded !== 'object') return null;
  const obj = decoded as {
    transaction?: string;
    paymentRequirements?: PaymentRequirements;
  };
  const txSig =
    typeof obj.transaction === 'string' && obj.transaction.length > 0 ? obj.transaction : null;
  const requirements = obj.paymentRequirements ?? null;
  const requirementsHash = paymentRequirementsHash(requirements);
  const price = priceFromRequirements(requirements);
  return { txSig, price, requirementsHash };
}

/**
 * Build a `ReceiptV1['price']` from a `PaymentRequirements`, enriching
 * with Leash protocol fee fields when the seller advertised a
 * `extra['leash.fee']` block. Mirrors {@link computeLeashFeeForRequirements}'s
 * math so the receipt's `gross / fee / net` matches what the buyer
 * actually signed on the wire.
 */
function priceFromRequirements(
  requirements: PaymentRequirements | null | undefined,
): ReceiptV1['price'] {
  if (!requirements) return null;
  const feeExtra = parseLeashFeeExtra(
    (requirements.extra ?? null) as Record<string, unknown> | null,
  );
  const netAtomic = BigInt(requirements.amount);
  const feeAtomic = feeExtra ? computeFeeAtoms(netAtomic, feeExtra.bps) : 0n;
  const grossAtomic = netAtomic + feeAtomic;
  return {
    amount: requirements.amount,
    currency: currencyForAsset(requirements.asset, tokenNetworkFromCaip2(requirements.network)),
    network: networkFromCaip2(requirements.network) ?? requirements.network,
    asset: requirements.asset,
    ...(feeExtra
      ? {
          fee: feeAtomic.toString(),
          gross: grossAtomic.toString(),
          feeBps: feeExtra.bps,
          feeAuthority: feeExtra.feeAuthority,
        }
      : {}),
  };
}

type Quote = {
  price: ReceiptV1['price'];
  requirementsHash: string | null;
  error: string | null;
};

/**
 * Decode the seller's `payment-required` header on a failed 402 so we can
 * record the *actual* demanded price and any facilitator-side error (e.g.
 * `insufficient_funds`) on the receipt.
 *
 * The header is the base64url-encoded JSON of `PaymentRequired` per x402 v2.
 * If the seller also returned a JSON error body (e.g.
 * `{ "error": "..." }`), we prefer the body's message because facilitator
 * errors land there after a failed `processSettlement`.
 *
 * Picks the first `accepts[i]` whose `network` matches one we're configured to
 * pay on (so we report the price the buyer would have actually attempted, not
 * an entry on a chain we wouldn't touch).
 */
async function parsePaymentRequired(
  response: Response,
  networks: LeashX402Network[],
  preferredAsset?: string | null,
): Promise<Quote | null> {
  let headerError: string | null = null;
  let bodyError: string | null = null;
  let chosen: PaymentRequirements | null = null;

  const header =
    response.headers.get('payment-required') ?? response.headers.get('PAYMENT-REQUIRED');
  if (header) {
    try {
      const decoded = decodeBase64Json(header) as {
        error?: string;
        accepts?: PaymentRequirements[];
      } | null;
      if (decoded) {
        if (typeof decoded.error === 'string' && decoded.error.length > 0) {
          headerError = decoded.error;
        }
        const list = Array.isArray(decoded.accepts) ? decoded.accepts : [];
        // Prefer the buyer's chosen mint (so the receipt records what we
        // actually attempted), then any entry on a configured network,
        // then fall back to the first entry. Without this, multi-currency
        // sellers always report `accepts[0]` (the primary, often USDC)
        // even when the buyer attempted USDG.
        const onConfiguredNetwork = list.filter((p) => networkMatches(p.network, networks));
        const matchByAsset = preferredAsset
          ? onConfiguredNetwork.find((p) => p.asset === preferredAsset)
          : null;
        chosen = matchByAsset ?? onConfiguredNetwork[0] ?? list[0] ?? null;
      }
    } catch {
      /* malformed header — ignore */
    }
  }

  // The seller's JSON body usually carries the most precise failure text
  // when settlement (not parsing) failed. We try it as a best-effort enrichment.
  try {
    const text = await response.text();
    if (text) {
      const parsed = JSON.parse(text) as { error?: string };
      if (parsed && typeof parsed.error === 'string' && parsed.error.length > 0) {
        bodyError = parsed.error;
      }
    }
  } catch {
    /* not JSON — fine */
  }

  if (!chosen && !headerError && !bodyError) return null;

  const price = priceFromRequirements(chosen);

  return {
    price,
    requirementsHash: paymentRequirementsHash(chosen),
    error: bodyError ?? headerError,
  };
}

/**
 * Extract a {@link Settlement} from `response.url` query params. Leash's
 * own seller-kit doesn't emit these anymore (the legacy `redirect_url`
 * hook was removed in favour of `wrap_receipt` + `webhook_url` +
 * X-Leash-* headers), but we keep this fallback in case a buyer-side
 * proxy attaches `?leash_tx=…&leash_receipt=…&leash_agent=…` after the
 * fact. Returns `null` for the common case (no params present).
 */
function parseRedirectSettlement(response: Response): Settlement | null {
  const rawUrl = response.url;
  if (!rawUrl) return null;
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return null;
  }
  const txSig = parsed.searchParams.get('leash_tx');
  const receiptHash = parsed.searchParams.get('leash_receipt');
  if (!txSig && !receiptHash) return null;
  return {
    txSig: txSig && txSig.length > 0 ? txSig : null,
    price: null,
    requirementsHash: null,
  };
}

function networkMatches(headerNetwork: string, configured: LeashX402Network[]): boolean {
  // The seller sends CAIP-2 form (`solana:<genesis-prefix>`); our config uses
  // friendly slugs like `solana-devnet`. Match leniently on the cluster word.
  const lower = headerNetwork.toLowerCase();
  return configured.some((c) => {
    const slug = String(c).toLowerCase();
    if (slug === lower) return true;
    if (slug.includes('devnet') && lower.includes('etwtrabz')) return true; // devnet genesis prefix
    if (slug.includes('mainnet') && lower.includes('5eykt4u')) return true; // mainnet-beta genesis prefix
    return false;
  });
}

function decodeBase64Json(input: string): unknown {
  // x402 uses base64url; tolerate both standard and URL variants.
  const normalized = input.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  const raw =
    typeof globalThis.atob === 'function'
      ? globalThis.atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
  return JSON.parse(raw);
}

/**
 * Map a CAIP-2 chain id ("solana:5eykt4u…", "solana-devnet") to the
 * `TokenNetwork` bucket used by the registry. Falls back to `'devnet'`
 * because the playground default is devnet — pinning unknowns to mainnet
 * could trigger an incorrect mint lookup.
 */
function tokenNetworkFromCaip2(input: string | null | undefined): TokenNetwork {
  const slug = networkFromCaip2(input);
  if (slug === 'solana-mainnet') return 'mainnet';
  return 'devnet';
}

/**
 * Resolve a buyer-supplied `preferredCurrency` (e.g. `'USDG'`) to the mint
 * address on the first configured network. Returns `null` when the mint
 * isn't in the registry for that network — the underlying x402 client will
 * then fall back to the default selector (first matching `accepts[]`).
 */
function resolvePreferredAsset(
  symbol: KnownStableSymbol | undefined,
  networks: LeashX402Network[],
): string | null {
  if (!symbol) return null;
  const network = networks[0] === 'solana-mainnet' ? 'mainnet' : 'devnet';
  return lookupTokenBySymbol(symbol, network)?.mint ?? null;
}

// Touched to silence "unused import" when consumers strip-tree-shake.
void KNOWN_STABLE_SYMBOLS;

/**
 * Resolve the effective `(receipt) => void` sink given the
 * buyer/seller's `onReceipt` field and any explicit `ReceiptForwardConfig`.
 * Lives here (not in `@leashmarket/core`) so the buyer/seller kits can drop
 * the env fallback at bundle time when targeted at the browser.
 *
 * The returned function:
 *   - Returns immediately when receipts are explicitly disabled
 *     (`onReceipt: false` or `LEASH_RECEIPTS_DISABLED=1`).
 *   - Calls a user-provided callback when one is set.
 *   - Otherwise fans out to every configured destination
 *     (runner + API). All fan-outs are best-effort; an outage on one
 *     never blocks the other.
 */
export function resolveReceiptSink(
  onReceipt: ((receipt: ReceiptAny) => void | Promise<void>) | false | undefined,
  forward: ReceiptForwardConfig | undefined,
): (receipt: ReceiptAny) => Promise<void> {
  if (onReceipt === false || envFlag('LEASH_RECEIPTS_DISABLED')) {
    return async () => {};
  }
  if (typeof onReceipt === 'function') {
    return async (receipt) => {
      try {
        await onReceipt(receipt);
      } catch {
        // Intentionally swallowed.
      }
    };
  }
  const env = readEnvForwardConfig();
  const merged: ReceiptForwardConfig = {
    runnerUrl: forward?.runnerUrl ?? env.runnerUrl,
    apiUrl: forward?.apiUrl ?? env.apiUrl,
    apiKey: forward?.apiKey ?? env.apiKey,
    ...(forward?.fetch ? { fetch: forward.fetch } : {}),
  };
  const fetchImpl = merged.fetch ?? globalThis.fetch;
  return async (receipt) => {
    const tasks: Promise<unknown>[] = [];
    if (merged.runnerUrl) {
      tasks.push(forwardToRunner(merged.runnerUrl, fetchImpl, receipt));
    }
    if (merged.apiUrl && merged.apiKey) {
      tasks.push(forwardToApi(merged.apiUrl, merged.apiKey, fetchImpl, receipt));
    }
    if (tasks.length === 0) return;
    const settled = await Promise.allSettled(tasks);
    for (const r of settled) {
      if (r.status === 'rejected') {
        // Best-effort: log to console for local dev diagnostics, but
        // never propagate. Runner/API outages must not poison a buyer
        // call that already debited USDC.
        console.warn('[buyer-kit] receipt forward failed:', (r.reason as Error).message);
      }
    }
  };
}

function forwardToRunner(
  runnerUrl: string,
  fetchImpl: NonNullable<ReceiptForwardConfig['fetch']>,
  receipt: ReceiptAny,
): Promise<void> {
  const url = `${runnerUrl.replace(/\/+$/, '')}/a/${encodeURIComponent(receipt.agent)}/receipts`;
  return doPost(fetchImpl, url, receipt);
}

function forwardToApi(
  apiUrl: string,
  apiKey: string,
  fetchImpl: NonNullable<ReceiptForwardConfig['fetch']>,
  receipt: ReceiptAny,
): Promise<void> {
  const url = `${apiUrl.replace(/\/+$/, '')}/v1/receipts/${encodeURIComponent(receipt.agent)}`;
  return doPost(fetchImpl, url, receipt, { authorization: `Bearer ${apiKey}` });
}

async function doPost(
  fetchImpl: NonNullable<ReceiptForwardConfig['fetch']>,
  url: string,
  receipt: ReceiptAny,
  extraHeaders: Record<string, string> = {},
): Promise<void> {
  const res = await fetchImpl(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...extraHeaders },
    body: JSON.stringify(receipt),
  });
  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    throw new Error(`POST ${url} -> ${res.status}: ${detail.slice(0, 200)}`);
  }
}

/**
 * MPP route: the x402 client already ran and returned a 402 it couldn't
 * pay (because the body, not the header, carried the challenge — the MPP
 * wire shape). Detect MPP on the response, sign the SPL transfer, retry
 * with `Authorization: PaymentScheme`. Returns null when the response is
 * not an MPP 402 (caller emits the existing x402 reject receipt).
 *
 * Avoids a wasted pre-flight GET: we reuse the x402 client's 402 response.
 * The retry is the only extra wire call.
 */
async function tryMppRouteFromResponse(args: {
  response: Response;
  url: string;
  init: RequestInit | undefined;
  cfg: BuyerConfig;
  networks: LeashX402Network[];
}): Promise<{
  response: Response;
  challenge: MppChallengeV1;
  settlement: MppSettlementProof | null;
  failureReason?: string;
} | null> {
  const { response, url, init, cfg, networks } = args;

  const det = await detectProtocol(response);
  if (det.protocol !== 'mpp') return null;

  const challenge = det.challenge;
  if (!networks.map(String).includes(challenge.request.network)) {
    return {
      response,
      challenge,
      settlement: null,
      failureReason: `mpp_network_unsupported: ${challenge.request.network}`,
    };
  }

  let signedTx: string;
  try {
    signedTx = await buildAndSignMppTransfer({
      challenge,
      signer: cfg.signer,
      ...(cfg.sourceTokenAccount ? { sourceTokenAccount: cfg.sourceTokenAccount } : {}),
      ...(cfg.rpcUrl ? { rpcUrl: cfg.rpcUrl } : {}),
    });
  } catch (e) {
    return {
      response,
      challenge,
      settlement: null,
      failureReason: `mpp_sign_failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const credential: MppCredentialV1 = {
    v: '1',
    challengeId: challenge.challengeId,
    signedTx,
  };
  const headers = new Headers((init?.headers ?? {}) as Record<string, string> | Headers);
  headers.set('authorization', buildMppAuthorizationHeader(credential));

  let settled: Response;
  try {
    settled = await globalThis.fetch(url, { ...(init ?? {}), headers });
  } catch (e) {
    return {
      response,
      challenge,
      settlement: null,
      failureReason: `mpp_retry_failed: ${e instanceof Error ? e.message : String(e)}`,
    };
  }

  const settlement = parseMppSettlementHeaders(settled);
  return { response: settled, challenge, settlement };
}

type MppSettlementProof = {
  settlementTx: string;
  settlementSlot: string | number;
};

/**
 * Read seller-stamped settlement headers off the MPP retry response.
 * The seller-kit (Phase 4) sets `x-payment-receipt: <b64-json>` carrying
 * `{ tx, slot }` after the facilitator confirms.
 */
function parseMppSettlementHeaders(response: Response): MppSettlementProof | null {
  const header =
    response.headers.get('x-payment-receipt') ?? response.headers.get('X-PAYMENT-RECEIPT') ?? null;
  if (!header) return null;
  try {
    const padded = header.replace(/-/g, '+').replace(/_/g, '/');
    const json =
      typeof globalThis.atob === 'function'
        ? globalThis.atob(padded)
        : Buffer.from(padded, 'base64').toString('utf8');
    const parsed = JSON.parse(json) as { tx?: string; slot?: string | number };
    if (!parsed.tx) return null;
    return { settlementTx: parsed.tx, settlementSlot: parsed.slot ?? '0' };
  } catch {
    return null;
  }
}

/**
 * Build a `ReceiptV02` (mpp variant) for a settled MPP call. We skip the
 * shared `finalizeReceipt` helper (which is hard-coded to ReceiptDraft of
 * v0.1) and compute the hash ourselves over the canonical body so the
 * receipt chain semantics carry over verbatim.
 */
function buildMppReceipt(args: {
  cfg: BuyerConfig;
  nonce: number;
  method: string;
  url: string;
  body: string | null;
  challenge: MppChallengeV1;
  response: Response;
  settlement: MppSettlementProof | null;
  facilitator: string;
}): ReceiptV02Mpp {
  const { cfg, nonce, method, url, body, challenge, response, settlement, facilitator } = args;
  const settled = settlement?.settlementTx != null && settlement.settlementTx.length > 0;
  const decision: 'allow' | 'rejected' =
    settled && response.status >= 200 && response.status < 400 ? 'allow' : 'rejected';
  const draft = {
    v: '0.2' as const,
    protocol: 'mpp' as const,
    kind: 'spend' as const,
    agent: cfg.agent,
    nonce,
    ts: new Date().toISOString(),
    policy_v: cfg.rules.v,
    request: { method, url, body_hash: body ? requestHash({ method, url, body }) : null },
    decision,
    reason: settled ? null : ('mpp_settlement_pending' as const),
    price: priceFromMppChallenge(challenge),
    facilitator,
    response: { status: response.status, body_hash: null },
    prev_receipt_hash: null,
    mpp_challenge_id: challenge.challengeId,
    mpp_credential_type: 'crypto' as const,
    mpp_settlement_tx: settlement?.settlementTx ?? '',
    mpp_settlement_slot: settlement?.settlementSlot ?? '0',
    tx_sig: settlement?.settlementTx ?? null,
  } satisfies Omit<ReceiptV02Mpp, 'receipt_hash'>;
  const receipt_hash = computeReceiptHash(draft);
  return ReceiptV02MppSchema.parse({ ...draft, receipt_hash });
}

function priceFromMppChallenge(challenge: MppChallengeV1): ReceiptV1['price'] {
  return {
    amount: challenge.request.amount,
    currency: challenge.request.currency,
    network: challenge.request.network,
    asset: challenge.request.asset,
  };
}

// Touch helpers re-exported from core to keep tree-shaking honest when
// downstream bundlers evaluate `import * as`.
void canonicalJson;

function readEnvForwardConfig(): ReceiptForwardConfig {
  if (typeof process === 'undefined' || !process.env) return {};
  const env = process.env;
  return {
    ...(env.LEASH_RUNNER_URL ? { runnerUrl: env.LEASH_RUNNER_URL } : {}),
    ...(env.LEASH_API_URL ? { apiUrl: env.LEASH_API_URL } : {}),
    ...(env.LEASH_API_KEY ? { apiKey: env.LEASH_API_KEY } : {}),
  };
}

function envFlag(name: string): boolean {
  if (typeof process === 'undefined' || !process.env) return false;
  const raw = process.env[name];
  if (!raw) return false;
  return raw === '1' || raw.toLowerCase() === 'true';
}
