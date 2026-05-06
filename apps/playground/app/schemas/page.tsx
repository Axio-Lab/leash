'use client';

import * as React from 'react';
import { CheckCircle2, AlertTriangle, Wand2 } from 'lucide-react';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Textarea } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { JsonViewer } from '@/components/json-viewer';
import { PageHeader } from '@/components/page-header';
import { InlineCode } from '@/components/ui/code';

type SchemaName = 'ReceiptV1' | 'RulesV1' | 'RegistrationV1' | 'LeashBlockV1';

type ValidateRes =
  | { ok: true; value: unknown }
  | { ok: false; issues: Array<{ path: string; message: string; code: string }> };

const TEMPLATES: Record<SchemaName, string> = {
  ReceiptV1: JSON.stringify(
    {
      v: '0.1',
      kind: 'spend',
      agent: '11111111111111111111111111111111',
      nonce: 0,
      ts: new Date().toISOString(),
      policy_v: '0.1',
      request: { method: 'POST', url: 'https://example.com/echo', body_hash: null },
      decision: 'allow',
      reason: null,
      price: { amount: '0.01', currency: 'USDC' },
      facilitator: 'local',
      tx_sig: null,
      response: { status: 200, body_hash: null },
      prev_receipt_hash: null,
      receipt_hash: 'replace-me-with-a-hash',
    },
    null,
    2,
  ),
  RulesV1: JSON.stringify(
    {
      v: '0.1',
      budget: { daily: '1.00', perCall: '0.01', currency: 'USDC' },
      hosts: { allow: ['localhost', '127.0.0.1'] },
      triggers: [{ type: 'interval', seconds: 30 }],
    },
    null,
    2,
  ),
  RegistrationV1: JSON.stringify(
    {
      type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
      name: 'Demo agent',
      description: 'Built with Leash',
      image: 'https://example.com/img.png',
      services: [{ name: 'echo', endpoint: 'https://example.com/echo', version: '1.0.0' }],
      active: true,
    },
    null,
    2,
  ),
  LeashBlockV1: JSON.stringify(
    {
      v: '0.1',
      rules_uri: 'ipfs://bafy...',
      rules_hash: 'sha256-...',
    },
    null,
    2,
  ),
};

export default function SchemasPage() {
  const [schema, setSchema] = React.useState<SchemaName>('ReceiptV1');
  const [text, setText] = React.useState(TEMPLATES.ReceiptV1);
  const [result, setResult] = React.useState<ValidateRes | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [parseErr, setParseErr] = React.useState<string | null>(null);

  function loadTemplate(name: SchemaName) {
    setSchema(name);
    setText(TEMPLATES[name]);
    setResult(null);
    setParseErr(null);
  }

  async function validate() {
    setLoading(true);
    setResult(null);
    setParseErr(null);
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch (err) {
      setParseErr((err as Error).message);
      setLoading(false);
      return;
    }
    try {
      const res = await fetch('/api/schemas/validate', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ schema, payload }),
      });
      const json = (await res.json()) as ValidateRes;
      setResult(json);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <PageHeader
        eyebrow="@leashmarket/schemas"
        title="Schemas"
        description="Paste any JSON, pick a schema, and validate against the live Zod schemas shipped from `@leashmarket/schemas`."
      />

      <Card>
        <CardHeader>
          <CardTitle>Live validator</CardTitle>
          <CardDescription>
            We POST your JSON to <InlineCode>/api/schemas/validate</InlineCode>, which runs{' '}
            <InlineCode>{`Schema.safeParse(payload)`}</InlineCode> server-side and returns either
            the parsed value or the list of Zod issues.
          </CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(TEMPLATES) as SchemaName[]).map((name) => (
              <button
                key={name}
                type="button"
                onClick={() => loadTemplate(name)}
                className={`rounded-md border px-3 h-8 text-xs ${
                  schema === name
                    ? 'border-brand bg-brand-soft text-brand-strong'
                    : 'border-border bg-bg-elev text-fg-muted hover:text-fg'
                }`}
              >
                {name}
              </button>
            ))}
            <Button variant="ghost" size="sm" onClick={() => loadTemplate(schema)}>
              <Wand2 className="size-3.5" /> Reset template
            </Button>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="payload">JSON payload</Label>
              <Textarea
                id="payload"
                value={text}
                spellCheck={false}
                onChange={(e) => setText(e.target.value)}
                className="min-h-[360px]"
              />
              <Button onClick={validate} disabled={loading}>
                {loading ? 'Validating…' : `Validate against ${schema}`}
              </Button>
              {parseErr && <p className="text-xs text-danger">JSON parse error: {parseErr}</p>}
            </div>

            <div className="flex flex-col gap-2">
              <Label>Result</Label>
              {!result && (
                <div className="rounded-md border border-dashed border-border p-6 text-center text-sm text-fg-muted">
                  Validation result appears here.
                </div>
              )}
              {result?.ok && (
                <>
                  <div className="flex items-center gap-2 text-sm text-success">
                    <CheckCircle2 className="size-4" /> Valid {schema}
                  </div>
                  <JsonViewer data={result.value} maxHeight="22rem" />
                </>
              )}
              {result && !result.ok && (
                <>
                  <div className="flex items-center gap-2 text-sm text-danger">
                    <AlertTriangle className="size-4" /> {result.issues.length} issue
                    {result.issues.length === 1 ? '' : 's'}
                  </div>
                  <ul className="flex flex-col divide-y divide-border rounded-md border border-border bg-bg-elev">
                    {result.issues.map((i, idx) => (
                      <li key={`${i.path}-${idx}`} className="flex flex-col gap-1 p-3 text-xs">
                        <div className="flex items-center gap-2">
                          <Badge variant="danger">{i.code}</Badge>
                          {i.path && (
                            <code className="font-mono text-[11px] text-fg">{i.path}</code>
                          )}
                        </div>
                        <p className="text-fg-muted">{i.message}</p>
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
