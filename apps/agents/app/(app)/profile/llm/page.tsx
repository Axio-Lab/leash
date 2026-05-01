'use client';

import * as React from 'react';
import { CheckIcon, ChevronDownIcon } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

type ModelTier = 'haiku' | 'sonnet' | 'opus';

type ModelInfo = {
  provider: 'anthropic';
  tier: ModelTier;
  model: string;
};

type KeyStatus = { saved: boolean; last4?: string };

const TIER_DETAILS: Record<ModelTier, { label: string; tagline: string; description: string }> = {
  haiku: {
    label: 'Haiku',
    tagline: 'Fastest · cheapest',
    description: 'Snappy turns and high-frequency tool calls. Lighter reasoning.',
  },
  sonnet: {
    label: 'Sonnet',
    tagline: 'Balanced · default',
    description: 'Strong reasoning at production throughput. Recommended for most agents.',
  },
  opus: {
    label: 'Opus',
    tagline: 'Deepest reasoning',
    description: 'Heaviest model. Slower and more expensive — use for complex planning.',
  },
};

export default function ProfileLlmPage() {
  const [keyStatus, setKeyStatus] = React.useState<KeyStatus | null>(null);
  const [key, setKey] = React.useState('');
  const [keyBusy, setKeyBusy] = React.useState(false);
  const [keyHint, setKeyHint] = React.useState<string | null>(null);
  const [keyOpen, setKeyOpen] = React.useState(false);

  const [modelInfo, setModelInfo] = React.useState<ModelInfo | null>(null);
  const [savingTier, setSavingTier] = React.useState<ModelTier | null>(null);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/llm', { credentials: 'include' });
        const j = (await res.json().catch(() => ({}))) as { saved?: boolean; last4?: string };
        const status: KeyStatus = { saved: !!j.saved, last4: j.last4 };
        setKeyStatus(status);
        // Auto-expand the key panel when the user already has a saved
        // key — they likely want to see/manage it without hunting.
        if (status.saved) setKeyOpen(true);
      } catch {
        setKeyStatus({ saved: false });
      }
    })();
  }, []);

  React.useEffect(() => {
    void (async () => {
      try {
        const res = await fetch('/api/llm/model', { credentials: 'include' });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const j = (await res.json()) as ModelInfo;
        setModelInfo(j);
      } catch {
        setModelInfo({ provider: 'anthropic', tier: 'sonnet', model: 'claude-sonnet-4-5' });
      }
    })();
  }, []);

  async function selectTier(tier: ModelTier) {
    if (modelInfo?.tier === tier) return;
    setSavingTier(tier);
    try {
      const res = await fetch('/api/llm/model', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ tier }),
      });
      if (!res.ok) {
        toast.error('Could not save model', { description: `HTTP ${res.status}` });
        return;
      }
      const j = (await res.json()) as ModelInfo;
      setModelInfo({ provider: j.provider, tier: j.tier, model: j.model });
      toast.success(`Model set to ${TIER_DETAILS[j.tier].label}`, { description: j.model });
    } finally {
      setSavingTier(null);
    }
  }

  async function testKey() {
    setKeyHint(null);
    setKeyBusy(true);
    try {
      const res = await fetch('/api/llm/test', {
        method: 'POST',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      const j = (await res.json()) as { ok?: boolean; reason?: string; models?: string[] };
      if (j.ok) {
        toast.success('Key works', { description: `${j.models?.length ?? 0} models visible` });
        setKeyHint(`OK — ${j.models?.length ?? 0} models visible`);
      } else {
        toast.error('Key check failed', { description: j.reason });
        setKeyHint(j.reason ?? 'failed');
      }
    } finally {
      setKeyBusy(false);
    }
  }

  async function saveKey() {
    setKeyHint(null);
    setKeyBusy(true);
    try {
      const res = await fetch('/api/llm', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ key }),
      });
      if (!res.ok) {
        toast.error('Save failed', { description: `HTTP ${res.status}` });
        return;
      }
      const last4 = key.slice(-4);
      setKey('');
      setKeyStatus({ saved: true, last4 });
      toast.success('Saved', { description: 'Future turns bill your Anthropic key.' });
      setKeyHint('Saved. Future turns bill your Anthropic key.');
    } finally {
      setKeyBusy(false);
    }
  }

  async function removeKey() {
    setKeyBusy(true);
    try {
      await fetch('/api/llm', { method: 'DELETE', credentials: 'include' });
      setKeyStatus({ saved: false });
      toast.success('Removed', { description: 'Using Leash platform key again.' });
      setKeyHint(null);
    } finally {
      setKeyBusy(false);
    }
  }

  return (
    <div className="space-y-6">
      <section className="rounded-xl border border-border bg-bg-elev/60 p-4 sm:p-5 space-y-5">
        <ProviderHeader />

        <TierGrid info={modelInfo} savingTier={savingTier} onSelect={selectTier} />

        <ResolvedModelLine model={modelInfo?.model ?? null} />

        <BringYourOwnKey
          open={keyOpen}
          onToggle={() => setKeyOpen((v) => !v)}
          status={keyStatus}
          keyValue={key}
          onKeyChange={setKey}
          busy={keyBusy}
          hint={keyHint}
          onTest={() => void testKey()}
          onSave={() => void saveKey()}
          onRemove={() => void removeKey()}
        />
      </section>
    </div>
  );
}

function ProviderHeader() {
  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <h2 className="text-sm font-semibold tracking-tight text-fg">Anthropic</h2>
          <p className="text-xs text-fg-muted mt-0.5">
            Claude family. Pick the compute tier your agent runs on — heavier tiers reason longer
            and cost more per call. Other providers coming soon.
          </p>
        </div>
        <div
          role="switch"
          aria-checked
          aria-disabled
          title="Anthropic only for now — more providers coming."
          className="relative inline-flex h-5 w-9 shrink-0 cursor-not-allowed items-center rounded-full bg-brand/80 transition-colors"
        >
          <span className="absolute right-0.5 size-4 rounded-full bg-bg shadow" />
        </div>
      </div>
    </div>
  );
}

function TierGrid({
  info,
  savingTier,
  onSelect,
}: {
  info: ModelInfo | null;
  savingTier: ModelTier | null;
  onSelect: (tier: ModelTier) => void | Promise<void>;
}) {
  return (
    <div className="grid gap-2 sm:grid-cols-3">
      {(['haiku', 'sonnet', 'opus'] as ModelTier[]).map((tier) => {
        const details = TIER_DETAILS[tier];
        const selected = info?.tier === tier;
        const saving = savingTier === tier;
        return (
          <button
            key={tier}
            type="button"
            onClick={() => void onSelect(tier)}
            aria-pressed={selected}
            disabled={info === null || savingTier !== null}
            className={`group text-left rounded-lg border px-4 py-3 transition-colors disabled:opacity-60 ${
              selected
                ? 'border-brand bg-brand/10'
                : 'border-border bg-bg/40 hover:border-border-strong hover:bg-bg-elev-2'
            }`}
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-semibold tracking-tight text-fg">{details.label}</span>
              {saving ? (
                <Spinner size="sm" />
              ) : selected ? (
                <span className="grid size-5 place-items-center rounded-full bg-brand text-bg">
                  <CheckIcon className="size-3.5" strokeWidth={3} />
                </span>
              ) : null}
            </div>
            <p className="mt-0.5 text-[11px] font-mono uppercase tracking-widest text-fg-subtle">
              {details.tagline}
            </p>
            <p className="mt-2 text-xs text-fg-muted leading-relaxed">{details.description}</p>
          </button>
        );
      })}
    </div>
  );
}

function ResolvedModelLine({ model }: { model: string | null }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-border bg-bg/40 px-3 py-2 text-xs">
      <span className="text-fg-muted">Resolved model id</span>
      <span className="font-mono text-fg">
        {model ?? <span className="text-fg-subtle">…</span>}
      </span>
    </div>
  );
}

function BringYourOwnKey({
  open,
  onToggle,
  status,
  keyValue,
  onKeyChange,
  busy,
  hint,
  onTest,
  onSave,
  onRemove,
}: {
  open: boolean;
  onToggle: () => void;
  status: KeyStatus | null;
  keyValue: string;
  onKeyChange: (v: string) => void;
  busy: boolean;
  hint: string | null;
  onTest: () => void;
  onSave: () => void;
  onRemove: () => void;
}) {
  const summary =
    status === null
      ? 'Checking key…'
      : status.saved
        ? `Using your key (…${status.last4 ?? '????'})`
        : 'Using Leash platform key';

  return (
    <div className="rounded-lg border border-border bg-bg/40">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <div className="min-w-0">
          <div className="text-sm font-medium text-fg">Use your own Anthropic key</div>
          <p className="mt-0.5 text-xs text-fg-muted truncate">{summary}</p>
        </div>
        <ChevronDownIcon
          className={`size-4 shrink-0 text-fg-subtle transition-transform ${open ? 'rotate-180' : ''}`}
        />
      </button>

      {open ? (
        <div className="border-t border-border px-4 py-4 space-y-3">
          {status?.saved ? (
            <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-success/40 bg-success/8 px-3 py-2 text-xs">
              <span className="text-fg">
                Billing your key (<span className="font-mono">…{status.last4}</span>)
              </span>
              <button
                type="button"
                className="text-xs text-danger hover:underline disabled:opacity-50"
                disabled={busy}
                onClick={onRemove}
              >
                Remove
              </button>
            </div>
          ) : (
            <p className="text-xs text-fg-muted">
              Your agent runs with the Leash platform key by default. Paste your own key to bill
              your Anthropic account instead.
            </p>
          )}

          <input
            type="password"
            autoComplete="off"
            value={keyValue}
            onChange={(e) => onKeyChange(e.target.value)}
            placeholder="sk-ant-…"
            className="w-full rounded-md border border-border bg-bg px-3 py-2 text-sm font-mono focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20"
          />

          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="secondary"
              disabled={busy || keyValue.length < 20}
              onClick={onTest}
            >
              {busy ? <Spinner size="sm" /> : null}
              Test
            </Button>
            <Button
              type="button"
              disabled={busy || !keyValue.startsWith('sk-ant-')}
              onClick={onSave}
            >
              {busy ? <Spinner size="sm" /> : null}
              Save
            </Button>
          </div>

          {hint ? <p className="text-xs text-fg-subtle">{hint}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
