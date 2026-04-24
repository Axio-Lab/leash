'use server';

import { cookies } from 'next/headers';
import { revalidatePath } from 'next/cache';
import { isNetwork, type Network } from '@/lib/network';

export async function setNetworkAction(value: string): Promise<void> {
  const next: Network = isNetwork(value) ? value : 'devnet';
  const jar = await cookies();
  jar.set('leash_network', next, {
    path: '/',
    httpOnly: false,
    sameSite: 'lax',
    maxAge: 60 * 60 * 24 * 365,
  });
  revalidatePath('/');
}
