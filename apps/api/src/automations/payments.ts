import type { AutomationRow } from '../storage/automations.js';
import type { DbClient } from '../storage/turso.js';
import { execute } from '../storage/turso.js';

export type AutomationPaymentRequest = {
  url: string | null;
  currency: string;
  amountUsd: number;
};

export type AutomationPaymentEvaluation = {
  status: 'none' | 'requires_approval' | 'blocked';
  requests: AutomationPaymentRequest[];
  totalUsd: number;
  message?: string;
};

function parseCap(value: string): number {
  const n = Number.parseFloat(value);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

function amountAtomicToUsd(amountAtomic: unknown): number {
  const raw = typeof amountAtomic === 'string' ? amountAtomic : String(amountAtomic ?? '');
  if (!/^\d+$/.test(raw)) return 0;
  return Number(raw) / 1_000_000;
}

function extractPaymentRequests(artifacts: unknown[]): AutomationPaymentRequest[] {
  const out: AutomationPaymentRequest[] = [];
  for (const artifact of artifacts) {
    if (!artifact || typeof artifact !== 'object') continue;
    const a = artifact as Record<string, unknown>;
    if (a.kind !== 'payment_request') continue;
    const payload =
      a.payload && typeof a.payload === 'object' ? (a.payload as Record<string, unknown>) : {};
    const preview =
      payload.preview && typeof payload.preview === 'object'
        ? (payload.preview as Record<string, unknown>)
        : {};
    out.push({
      url: typeof payload.url === 'string' ? payload.url : null,
      currency: typeof preview.currency === 'string' ? preview.currency : 'USDC',
      amountUsd: amountAtomicToUsd(preview.amount_atomic),
    });
  }
  return out;
}

async function spentSince(db: DbClient, ownerPrivyId: string, sinceIso: string): Promise<number> {
  const res = await execute(
    db,
    `SELECT SUM(CAST(spend_usd AS REAL)) AS total
     FROM automation_runs
     WHERE owner_privy_id = ? AND created_at >= ?`,
    [ownerPrivyId, sinceIso],
  );
  const total = Number((res.rows[0] as Record<string, unknown> | undefined)?.total ?? 0);
  return Number.isFinite(total) ? total : 0;
}

export async function evaluateAutomationPayments(
  db: DbClient,
  automation: AutomationRow,
  artifacts: unknown[],
  now = new Date(),
): Promise<AutomationPaymentEvaluation> {
  const requests = extractPaymentRequests(artifacts);
  if (requests.length === 0) return { status: 'none', requests: [], totalUsd: 0 };

  const totalUsd = requests.reduce((sum, r) => sum + r.amountUsd, 0);
  const perRunCap = parseCap(automation.budgetPerRun);
  if (perRunCap <= 0 || totalUsd > perRunCap) {
    return {
      status: 'blocked',
      requests,
      totalUsd,
      message: `Payment requests total $${totalUsd.toFixed(6)}, above the per-run cap of $${perRunCap.toFixed(6)}.`,
    };
  }

  const perDayCap = parseCap(automation.budgetPerDay);
  if (perDayCap <= 0) {
    return {
      status: 'blocked',
      requests,
      totalUsd,
      message: 'Payment requests are blocked because the per-day cap is zero.',
    };
  }
  const dayStart = new Date(now);
  dayStart.setUTCHours(0, 0, 0, 0);
  const spentToday = await spentSince(db, automation.ownerPrivyId, dayStart.toISOString());
  if (spentToday + totalUsd > perDayCap) {
    return {
      status: 'blocked',
      requests,
      totalUsd,
      message: `Payment requests would bring today to $${(spentToday + totalUsd).toFixed(6)}, above the per-day cap of $${perDayCap.toFixed(6)}.`,
    };
  }

  return {
    status: 'requires_approval',
    requests,
    totalUsd,
    message:
      'Payment requests are under automation caps, but settlement still requires an approved signer.',
  };
}
