'use client';

import * as React from 'react';
import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { usePrivy } from '@privy-io/react-auth';
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js';
import { toast } from 'sonner';
import {
  CheckCircle2Icon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ImageIcon,
  PlusIcon,
  RefreshCwIcon,
  TrashIcon,
  UploadCloudIcon,
  XIcon,
} from 'lucide-react';

import { LEASH_AGENT_MODEL, SOLANA_NETWORK, SOLANA_RPC } from '@/lib/env';
import { formatChainError } from '@/lib/format-chain-error';
import { mintAgentBrowserSide } from '@/lib/mint-agent';
import { delegateAgentSpend, provisionAgentTreasury } from '@/lib/onboarding';
import { usePrivyUmi } from '@/lib/use-privy-umi';
import { Button } from '@/components/ui/button';
import { Spinner } from '@/components/ui/spinner';

const SKIP_KEY = 'leash:onboarding_skipped';
const MAX_IMAGE_BYTES = 1_500_000;
const ALLOWED_IMAGE_MIMES = new Set([
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'image/svg+xml',
]);

function skipStorageKey(privyId: string): string {
  return `${SKIP_KEY}:${privyId}`;
}

export function readOnboardingSkipped(privyId: string): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(skipStorageKey(privyId)) === '1';
}

type ExecutorMode = 'connected' | 'provided' | 'generated';

type Service = { name: string; endpoint: string };

type Stage =
  | { kind: 'form' }
  | { kind: 'minting'; status: string }
  | { kind: 'persisting'; status: string; mint: string; treasury: string }
  | { kind: 'provisioning'; status: string; mint: string; treasury: string }
  | { kind: 'delegating'; status: string; mint: string; treasury: string }
  | { kind: 'done'; mint: string; treasury: string };

type StepId = 'identity' | 'services' | 'operator';

const STEPS: Array<{ id: StepId; label: string; hint: string }> = [
  { id: 'identity', label: 'Identity', hint: 'Name, image, description' },
  { id: 'services', label: 'Services', hint: 'EIP-8004 endpoints' },
  { id: 'operator', label: 'Operator', hint: 'Who signs payments' },
];

export function OnboardingGate({
  fullPage = false,
  onDone,
}: {
  fullPage?: boolean;
  onDone?: () => void;
}) {
  const { user } = usePrivy();
  const { umi, wallet, ready } = usePrivyUmi();
  const router = useRouter();

  const [step, setStep] = React.useState<StepId>('identity');
  const [name, setName] = React.useState('');
  const [description, setDescription] = React.useState('');
  const [imageUrl, setImageUrl] = React.useState<string | null>(null);
  const [imageDataPreview, setImageDataPreview] = React.useState<string | null>(null);
  const [imageUploading, setImageUploading] = React.useState(false);
  const [services, setServices] = React.useState<Service[]>([]);

  const [stage, setStage] = React.useState<Stage>({ kind: 'form' });
  const [error, setError] = React.useState<string | null>(null);
  const [solBalance, setSolBalance] = React.useState<number | null>(null);

  const [executorMode, setExecutorMode] = React.useState<ExecutorMode>('connected');
  const [providedExecutor, setProvidedExecutor] = React.useState('');
  const [generatedExecutor, setGeneratedExecutor] = React.useState<{
    address: string;
    secretBase64: string;
  } | null>(null);

  const privyId = user?.id ?? '';

  React.useEffect(() => {
    let cancelled = false;
    async function load() {
      if (!wallet?.address) return;
      try {
        const conn = new Connection(SOLANA_RPC, 'confirmed');
        const lamports = await conn.getBalance(new PublicKey(wallet.address));
        if (!cancelled) setSolBalance(lamports / LAMPORTS_PER_SOL);
      } catch {
        if (!cancelled) setSolBalance(null);
      }
    }
    void load();
    return () => {
      cancelled = true;
    };
  }, [wallet?.address]);

  function generateExecutor() {
    const kp = Keypair.generate();
    const address = kp.publicKey.toBase58();
    const secretBase64 =
      typeof window !== 'undefined' && typeof window.btoa === 'function'
        ? window.btoa(String.fromCharCode(...kp.secretKey))
        : Buffer.from(kp.secretKey).toString('base64');
    setGeneratedExecutor({ address, secretBase64 });
    toast.success('Operator keypair generated', {
      description: 'Save the secret somewhere safe — we only show it once.',
    });
  }

  function resolveExecutor(): { ok: true; address: string } | { ok: false; reason: string } {
    if (executorMode === 'connected') {
      if (!wallet?.address) return { ok: false, reason: 'Connect a Solana wallet first.' };
      return { ok: true, address: wallet.address };
    }
    if (executorMode === 'provided') {
      const trimmed = providedExecutor.trim();
      if (!trimmed) return { ok: false, reason: 'Paste the operator address you want to use.' };
      try {
        new PublicKey(trimmed);
      } catch {
        return { ok: false, reason: 'That operator address is not a valid Solana public key.' };
      }
      return { ok: true, address: trimmed };
    }
    if (!generatedExecutor) {
      return { ok: false, reason: 'Generate an operator keypair first.' };
    }
    return { ok: true, address: generatedExecutor.address };
  }

  async function handleImageFile(file: File) {
    if (!ALLOWED_IMAGE_MIMES.has(file.type)) {
      toast.error('Unsupported image', {
        description: 'PNG, JPEG, WebP, GIF, or SVG only.',
      });
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      toast.error('Image too large', {
        description: `Max 1.5 MB. Yours is ${(file.size / 1024).toFixed(0)} KB.`,
      });
      return;
    }
    setImageUploading(true);
    try {
      const dataUrl = await fileToDataUrl(file);
      setImageDataPreview(dataUrl);
      const res = await fetch('/api/uploads/image', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ data_url: dataUrl }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`http ${res.status}: ${txt.slice(0, 200)}`);
      }
      const json = (await res.json()) as { url?: string; hash?: string };
      if (!json.url) throw new Error('upload returned no url');
      setImageUrl(json.url);
      toast.success('Image uploaded', { description: 'It will be embedded in the agent record.' });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      toast.error('Image upload failed', { description: msg });
      setImageDataPreview(null);
    } finally {
      setImageUploading(false);
    }
  }

  function clearImage() {
    setImageUrl(null);
    setImageDataPreview(null);
  }

  function addService() {
    setServices((s) => [...s, { name: '', endpoint: '' }]);
  }
  function updateService(i: number, key: keyof Service, value: string) {
    setServices((s) => s.map((row, idx) => (idx === i ? { ...row, [key]: value } : row)));
  }
  function removeService(i: number) {
    setServices((s) => s.filter((_, idx) => idx !== i));
  }

  function validateStep(target: StepId): string | null {
    if (target === 'identity') {
      if (name.trim().length === 0) return 'Give your agent a name.';
      if (description.trim().length === 0) return 'Add a short description.';
      if (description.trim().length > 2048) return 'Description must be under 2048 characters.';
    }
    if (target === 'services') {
      for (const [i, s] of services.entries()) {
        if (!s.name.trim() || !s.endpoint.trim()) {
          return `Service #${i + 1} needs both a name and an endpoint URL.`;
        }
        try {
          new URL(s.endpoint);
        } catch {
          return `Service #${i + 1}: endpoint must be a valid URL.`;
        }
      }
    }
    return null;
  }

  function gotoNext() {
    const v = validateStep(step);
    if (v) {
      setError(v);
      return;
    }
    setError(null);
    if (step === 'identity') setStep('services');
    else if (step === 'services') setStep('operator');
  }

  function gotoBack() {
    setError(null);
    if (step === 'operator') setStep('services');
    else if (step === 'services') setStep('identity');
  }

  async function onMint() {
    if (!umi || !wallet?.address) {
      setError(!wallet ? 'Connect a Solana wallet first.' : 'Wallet not ready.');
      return;
    }
    const idV = validateStep('identity');
    if (idV) {
      setError(idV);
      setStep('identity');
      return;
    }
    const svcV = validateStep('services');
    if (svcV) {
      setError(svcV);
      setStep('services');
      return;
    }
    const executor = resolveExecutor();
    if (!executor.ok) {
      setError(executor.reason);
      return;
    }
    setError(null);

    const cleanServices: Service[] = services.map((s) => ({
      name: s.name.trim(),
      endpoint: s.endpoint.trim(),
    }));

    let mint = '';
    let treasury = '';

    try {
      setStage({ kind: 'minting', status: 'Signing the mint transaction in your wallet…' });
      const minted = await mintAgentBrowserSide({
        umi,
        wallet: wallet.address,
        name: name.trim(),
        description: description.trim(),
        image: imageUrl ?? '',
        services: cleanServices,
        network: SOLANA_NETWORK,
      });
      mint = minted.mint;
      treasury = minted.treasury;

      setStage({
        kind: 'persisting',
        status: 'Saving agent record…',
        mint,
        treasury,
      });
      const systemPrompt = `You are ${name.trim()}. ${description.trim()}`;
      const res = await fetch('/api/agents', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({
          mint,
          treasury,
          name: name.trim(),
          description: description.trim(),
          image_url: imageUrl,
          services: cleanServices,
          network: SOLANA_NETWORK,
          model: LEASH_AGENT_MODEL,
          system_prompt: systemPrompt,
          capabilities: [],
          budget: { per_action: '10', per_task: '50', per_day: '100' },
          llm_provider: 'platform',
        }),
      });
      if (!res.ok) {
        const txt = await res.text();
        throw new Error(`http ${res.status}: ${txt.slice(0, 200)}`);
      }

      setStage({
        kind: 'provisioning',
        status: 'Confirming agent on the network…',
        mint,
        treasury,
      });
      await provisionAgentTreasury({
        umi,
        agentMint: mint,
        network: SOLANA_NETWORK,
        onProgress: (msg) =>
          setStage((prev) => (prev.kind === 'provisioning' ? { ...prev, status: msg } : prev)),
      });

      setStage({
        kind: 'delegating',
        status: 'Approving spend allowance for the operator…',
        mint,
        treasury,
      });
      await delegateAgentSpend({
        umi,
        agentMint: mint,
        executive: executor.address,
        network: SOLANA_NETWORK,
        onProgress: (msg) =>
          setStage((prev) => (prev.kind === 'delegating' ? { ...prev, status: msg } : prev)),
      });

      setStage({ kind: 'done', mint, treasury });
      toast.success('Agent ready', { description: 'Treasury and spend allowance are wired up.' });
      onDone?.();
      setTimeout(() => router.push('/profile/agent'), fullPage ? 1200 : 800);
    } catch (e) {
      const friendly = formatChainError(e);
      setError(friendly);
      if (mint) {
        toast.error('Agent created, but setup did not finish', {
          description: `${friendly} Open Profile → Agent to retry.`,
        });
        setStage({ kind: 'done', mint, treasury });
        onDone?.();
        setTimeout(() => router.push('/profile/agent'), fullPage ? 1200 : 800);
      } else {
        toast.error('Could not create agent', { description: friendly });
        setStage({ kind: 'form' });
      }
    }
  }

  function onSkip() {
    if (privyId) localStorage.setItem(skipStorageKey(privyId), '1');
    onDone?.();
    router.push('/agents');
  }

  const lowSol = solBalance !== null && solBalance < 0.05 && SOLANA_NETWORK === 'solana-devnet';

  const wrapCls = fullPage ? 'min-h-dvh flex items-center justify-center p-6' : '';
  const cardCls = fullPage
    ? 'w-full max-w-2xl rounded-xl border border-border bg-bg-elev p-6 sm:p-8 space-y-5'
    : 'w-full rounded-xl border border-border bg-bg-elev/60 p-5 sm:p-6 space-y-5';

  return (
    <div className={wrapCls}>
      <div className={cardCls}>
        <div>
          <h2 className="text-lg sm:text-xl font-semibold tracking-tight">
            Create your on-chain agent
          </h2>
          <p className="text-sm text-fg-muted mt-1">
            Network: <span className="font-mono text-fg">{SOLANA_NETWORK}</span> · metadata follows
            the{' '}
            <a
              href="https://eips.ethereum.org/EIPS/eip-8004"
              target="_blank"
              rel="noreferrer"
              className="text-brand hover:underline"
            >
              EIP-8004 RegistrationV1
            </a>{' '}
            schema
          </p>
        </div>

        {lowSol ? (
          <div className="rounded-lg border border-warning/40 bg-warning/8 px-3 py-2 text-xs text-warning">
            Low SOL ({solBalance?.toFixed(4)}). Fund devnet from a faucet so mint + ATA txs succeed.
            <a
              href="https://faucet.solana.com/"
              target="_blank"
              rel="noreferrer"
              className="ml-2 underline"
            >
              faucet.solana.com
            </a>
          </div>
        ) : null}

        {stage.kind === 'form' ? (
          <>
            <Stepper current={step} />

            {step === 'identity' ? (
              <IdentityStep
                name={name}
                onName={setName}
                description={description}
                onDescription={setDescription}
                imageUrl={imageUrl}
                imageDataPreview={imageDataPreview}
                imageUploading={imageUploading}
                onPickImage={handleImageFile}
                onClearImage={clearImage}
                wallet={wallet?.address ?? ''}
              />
            ) : null}

            {step === 'services' ? (
              <ServicesStep
                services={services}
                onAdd={addService}
                onUpdate={updateService}
                onRemove={removeService}
              />
            ) : null}

            {step === 'operator' ? (
              <OperatorStep
                executorMode={executorMode}
                onExecutorMode={setExecutorMode}
                providedExecutor={providedExecutor}
                onProvidedExecutor={setProvidedExecutor}
                generatedExecutor={generatedExecutor}
                onGenerate={generateExecutor}
              />
            ) : null}

            {error ? (
              <div className="rounded-md border border-danger/40 bg-danger/8 px-3 py-2 text-xs text-danger">
                {error}
              </div>
            ) : null}

            <StepActions
              step={step}
              ready={ready}
              executorReady={executorMode !== 'generated' ? true : Boolean(generatedExecutor)}
              onBack={gotoBack}
              onNext={gotoNext}
              onMint={() => void onMint()}
              onSkip={onSkip}
            />
          </>
        ) : stage.kind === 'done' ? (
          <DonePanel mint={stage.mint} treasury={stage.treasury} />
        ) : (
          <WorkingPanel status={(stage as { status: string }).status} />
        )}

        <p className="text-[11px] text-fg-subtle leading-snug">
          Three signed transactions: <span className="font-mono">mint</span>,{' '}
          <span className="font-mono">treasury ATAs</span> (USDC + USDT + USDG), and{' '}
          <span className="font-mono">spend delegation</span> (one Approve per stablecoin).
        </p>
      </div>
    </div>
  );
}

function Stepper({ current }: { current: StepId }) {
  const idx = STEPS.findIndex((s) => s.id === current);
  return (
    <div className="flex items-center gap-2">
      {STEPS.map((s, i) => {
        const isActive = s.id === current;
        const isDone = i < idx;
        return (
          <React.Fragment key={s.id}>
            <div
              className={`flex items-center gap-2 px-3 py-1.5 rounded-full text-xs border transition-colors ${
                isActive
                  ? 'border-brand bg-brand/15 text-fg'
                  : isDone
                    ? 'border-success/40 bg-success/10 text-fg'
                    : 'border-border bg-bg-elev/40 text-fg-muted'
              }`}
            >
              <span
                className={`flex items-center justify-center size-5 rounded-full text-[10px] font-medium ${
                  isActive
                    ? 'bg-brand text-white'
                    : isDone
                      ? 'bg-success text-white'
                      : 'bg-bg text-fg-muted'
                }`}
              >
                {isDone ? <CheckCircle2Icon className="size-3" /> : i + 1}
              </span>
              <span className="font-medium">{s.label}</span>
              <span className="hidden sm:inline text-fg-subtle text-[10px]">{s.hint}</span>
            </div>
            {i < STEPS.length - 1 ? (
              <div className="flex-1 h-px bg-border min-w-2" aria-hidden />
            ) : null}
          </React.Fragment>
        );
      })}
    </div>
  );
}

function IdentityStep({
  name,
  onName,
  description,
  onDescription,
  imageUrl,
  imageDataPreview,
  imageUploading,
  onPickImage,
  onClearImage,
  wallet,
}: {
  name: string;
  onName: (v: string) => void;
  description: string;
  onDescription: (v: string) => void;
  imageUrl: string | null;
  imageDataPreview: string | null;
  imageUploading: boolean;
  onPickImage: (file: File) => Promise<void>;
  onClearImage: () => void;
  wallet: string;
}) {
  const fileRef = React.useRef<HTMLInputElement | null>(null);
  const preview = imageDataPreview ?? imageUrl;
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-4">
        <div
          className="relative size-20 sm:size-24 rounded-xl border border-border bg-bg-elev/40 overflow-hidden flex items-center justify-center shrink-0"
          aria-label="Agent image preview"
        >
          {preview ? (
            <Image
              src={preview}
              alt="Agent preview"
              fill
              sizes="96px"
              className="object-cover"
              unoptimized
            />
          ) : imageUploading ? (
            <Spinner size="md" brand />
          ) : (
            <ImageIcon className="size-6 text-fg-subtle" />
          )}
        </div>
        <div className="flex-1 min-w-0 space-y-2">
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => fileRef.current?.click()}
              disabled={imageUploading}
            >
              <UploadCloudIcon className="size-3.5" />
              {preview ? 'Replace image' : 'Upload image'}
            </Button>
            {preview ? (
              <Button type="button" variant="ghost" size="sm" onClick={onClearImage}>
                <XIcon className="size-3.5" />
                Remove
              </Button>
            ) : null}
          </div>
          <p className="text-[11px] text-fg-subtle leading-snug">
            Optional. PNG / JPEG / WebP / GIF / SVG, ≤ 1.5 MB.
          </p>
          <input
            ref={fileRef}
            type="file"
            accept={Array.from(ALLOWED_IMAGE_MIMES).join(',')}
            className="hidden"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void onPickImage(f);
              e.target.value = '';
            }}
          />
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-sm">
          <span className="text-fg-muted text-xs uppercase tracking-widest">Name</span>
          <input
            className="mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20"
            value={name}
            onChange={(e) => onName(e.target.value)}
            placeholder="e.g. Ops Copilot"
            maxLength={64}
          />
        </label>
        <label className="block text-sm">
          <span className="text-fg-muted text-xs uppercase tracking-widest">Owner wallet</span>
          <div
            className="mt-1.5 w-full rounded-lg border border-border bg-bg/40 px-3 py-2 text-sm font-mono text-fg-muted truncate"
            title={wallet}
          >
            {wallet || 'not connected'}
          </div>
        </label>
      </div>

      <label className="block text-sm">
        <span className="text-fg-muted text-xs uppercase tracking-widest">Description</span>
        <textarea
          className="mt-1.5 w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20 resize-y"
          rows={3}
          value={description}
          onChange={(e) => onDescription(e.target.value)}
          placeholder="What should this agent optimize for?"
          maxLength={2048}
        />
        <span className="block text-[10px] text-fg-subtle mt-1">
          {description.trim().length} / 2048
        </span>
      </label>
    </div>
  );
}

function ServicesStep({
  services,
  onAdd,
  onUpdate,
  onRemove,
}: {
  services: Service[];
  onAdd: () => void;
  onUpdate: (i: number, key: keyof Service, value: string) => void;
  onRemove: (i: number) => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm">
          Optional <span className="font-mono">services[]</span> entries published in the
          agent&apos;s on-chain registration. These are the URLs the agent advertises so other
          agents (and marketplaces) can discover what it does.
        </p>
        <p className="text-[11px] text-fg-subtle">
          A <span className="font-mono">receipts</span> service is auto-injected by Leash — you
          don&apos;t need to add it.
        </p>
      </div>

      {services.length === 0 ? (
        <div className="rounded-lg border border-dashed border-border bg-bg-elev/30 p-4 text-center text-xs text-fg-subtle">
          No services yet. You can always add them later from the agent profile.
        </div>
      ) : (
        <div className="space-y-2">
          {services.map((s, i) => (
            <div
              key={i}
              className="grid grid-cols-[minmax(0,7rem)_minmax(0,1fr)_auto] gap-2 items-start rounded-lg border border-border bg-bg-elev/30 p-2.5"
            >
              <input
                value={s.name}
                onChange={(e) => onUpdate(i, 'name', e.target.value)}
                placeholder="web"
                maxLength={64}
                className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs font-mono focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20"
              />
              <input
                value={s.endpoint}
                onChange={(e) => onUpdate(i, 'endpoint', e.target.value)}
                placeholder="https://web.agentxyz.com/"
                maxLength={500}
                className="rounded-md border border-border bg-bg px-2.5 py-1.5 text-xs font-mono focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20"
              />
              <button
                type="button"
                onClick={() => onRemove(i)}
                className="rounded-md border border-border bg-bg-elev hover:border-danger/40 hover:bg-danger/10 hover:text-danger size-8 flex items-center justify-center text-fg-muted transition-colors"
                aria-label={`Remove service ${i + 1}`}
              >
                <TrashIcon className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}

      <Button type="button" variant="outline" size="sm" onClick={onAdd}>
        <PlusIcon className="size-3.5" />
        Add service
      </Button>
    </div>
  );
}

function OperatorStep({
  executorMode,
  onExecutorMode,
  providedExecutor,
  onProvidedExecutor,
  generatedExecutor,
  onGenerate,
}: {
  executorMode: ExecutorMode;
  onExecutorMode: (m: ExecutorMode) => void;
  providedExecutor: string;
  onProvidedExecutor: (v: string) => void;
  generatedExecutor: { address: string; secretBase64: string } | null;
  onGenerate: () => void;
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <p className="text-sm">
          The operator signs payments and tool calls on behalf of the agent. You can change this
          later from Profile → Agent.
        </p>
        <p className="text-[11px] text-fg-subtle">
          Today the agent app routes every payment through your Privy wallet (you tap{' '}
          <span className="text-fg">Authorize</span> in chat). Provide / Generate options are parked
          for headless executor support and won't sign for you yet.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
        <ExecutorOption
          active={executorMode === 'connected'}
          onClick={() => onExecutorMode('connected')}
          title="Privy wallet"
          subtitle="Your embedded Privy wallet — also the agent owner"
          badge="Recommended"
        />
        <ExecutorOption
          active={executorMode === 'provided'}
          onClick={() => onExecutorMode('provided')}
          title="Provide an address"
          subtitle="Delegate to a wallet you'll plug in later"
          badge="Advanced"
        />
        <ExecutorOption
          active={executorMode === 'generated'}
          onClick={() => onExecutorMode('generated')}
          title="Generate keypair"
          subtitle="Create a fresh operator keypair (in-browser)"
          badge="Advanced"
        />
      </div>

      {executorMode === 'provided' ? (
        <input
          value={providedExecutor}
          onChange={(e) => onProvidedExecutor(e.target.value.trim())}
          placeholder="Operator Solana address…"
          className="w-full rounded-lg border border-border bg-bg px-3 py-2 text-sm font-mono focus:border-brand focus:outline-none focus:ring-[3px] focus:ring-brand/20"
        />
      ) : null}

      {executorMode === 'generated' ? (
        <div className="space-y-2">
          {!generatedExecutor ? (
            <Button type="button" variant="outline" size="sm" onClick={onGenerate}>
              <RefreshCwIcon className="size-3.5" />
              Generate keypair
            </Button>
          ) : (
            <div className="rounded-lg border border-border bg-bg/40 p-3 space-y-2 text-xs">
              <div>
                <span className="text-fg-subtle uppercase tracking-widest text-[10px]">
                  Address
                </span>
                <div className="font-mono break-all">{generatedExecutor.address}</div>
              </div>
              <div>
                <span className="text-fg-subtle uppercase tracking-widest text-[10px]">
                  Secret (base64) — copy &amp; save NOW
                </span>
                <div className="font-mono break-all bg-bg/60 rounded p-2 mt-1 max-h-24 overflow-auto scrollbar-thin">
                  {generatedExecutor.secretBase64}
                </div>
              </div>
              <p className="text-fg-subtle">
                We never store this. Lose it and you lose spend authority for this agent.
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}

function StepActions({
  step,
  ready,
  executorReady,
  onBack,
  onNext,
  onMint,
  onSkip,
}: {
  step: StepId;
  ready: boolean;
  executorReady: boolean;
  onBack: () => void;
  onNext: () => void;
  onMint: () => void;
  onSkip: () => void;
}) {
  const isFirst = step === 'identity';
  const isLast = step === 'operator';
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
      <div className="flex items-center gap-2">
        {!isFirst ? (
          <Button type="button" variant="outline" size="sm" onClick={onBack}>
            <ChevronLeftIcon className="size-3.5" />
            Back
          </Button>
        ) : (
          <Button type="button" variant="ghost" size="sm" onClick={onSkip}>
            Skip for now
          </Button>
        )}
      </div>
      <div className="flex items-center gap-2">
        {!ready ? <span className="text-[11px] text-fg-subtle">Waiting for wallet…</span> : null}
        {isLast ? (
          <Button type="button" disabled={!ready || !executorReady} onClick={onMint}>
            Mint &amp; save
          </Button>
        ) : (
          <Button type="button" onClick={onNext}>
            Next
            <ChevronRightIcon className="size-3.5" />
          </Button>
        )}
      </div>
    </div>
  );
}

function ExecutorOption({
  active,
  onClick,
  title,
  subtitle,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  subtitle: string;
  badge?: 'Recommended' | 'Advanced';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`relative rounded-lg border px-3 py-2.5 text-left transition-colors ${
        active
          ? 'border-brand bg-brand/10 shadow-[inset_0_0_0_1px_oklch(0.66_0.19_268/0.4)]'
          : 'border-border bg-bg-elev/40 hover:border-border-strong'
      }`}
    >
      <div className="flex items-center justify-between gap-1">
        <div className="text-xs font-medium">{title}</div>
        {badge ? (
          <span
            className={`text-[9px] uppercase tracking-widest font-semibold rounded px-1.5 py-0.5 ${
              badge === 'Recommended'
                ? 'bg-brand/20 text-brand'
                : 'bg-bg/60 text-fg-subtle border border-border'
            }`}
          >
            {badge}
          </span>
        ) : null}
      </div>
      <div className="text-[10px] text-fg-muted leading-snug mt-0.5">{subtitle}</div>
    </button>
  );
}

function WorkingPanel({ status }: { status: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-10">
      <Spinner size="lg" brand />
      <p className="text-xs text-fg-muted text-center max-w-xs leading-snug">{status}</p>
    </div>
  );
}

function DonePanel({ mint, treasury }: { mint: string; treasury: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 py-8 text-center">
      <CheckCircle2Icon className="size-8 text-success" />
      <p className="text-sm font-medium">Agent ready.</p>
      <p className="text-[11px] text-fg-muted">
        Mint{' '}
        <span className="font-mono">
          {mint.slice(0, 4)}…{mint.slice(-4)}
        </span>{' '}
        · treasury{' '}
        <span className="font-mono">
          {treasury.slice(0, 4)}…{treasury.slice(-4)}
        </span>
      </p>
      <p className="text-[11px] text-fg-subtle">Redirecting to your profile…</p>
    </div>
  );
}

function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ''));
    reader.onerror = () => reject(reader.error ?? new Error('file read error'));
    reader.readAsDataURL(file);
  });
}
