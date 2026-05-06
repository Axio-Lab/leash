import { NextResponse } from 'next/server';
import {
  ReceiptV1Schema,
  RulesV1Schema,
  RegistrationV1Schema,
  LeashBlockV1Schema,
} from '@leashmarket/schemas';
import { z } from 'zod';

export const dynamic = 'force-dynamic';

const SCHEMAS = {
  ReceiptV1: ReceiptV1Schema,
  RulesV1: RulesV1Schema,
  RegistrationV1: RegistrationV1Schema,
  LeashBlockV1: LeashBlockV1Schema,
} as const;

export type SchemaName = keyof typeof SCHEMAS;

const Body = z.object({
  schema: z.enum(['ReceiptV1', 'RulesV1', 'RegistrationV1', 'LeashBlockV1']),
  payload: z.unknown(),
});

export async function POST(req: Request) {
  let body: z.infer<typeof Body>;
  try {
    body = Body.parse(await req.json());
  } catch (err) {
    return NextResponse.json({ error: (err as Error).message }, { status: 400 });
  }
  const schema = SCHEMAS[body.schema];
  const result = schema.safeParse(body.payload);
  if (result.success) {
    return NextResponse.json({ ok: true, value: result.data });
  }
  return NextResponse.json({
    ok: false,
    issues: result.error.issues.map((i) => ({
      path: i.path.join('.'),
      message: i.message,
      code: i.code,
    })),
  });
}
