import { cookies } from 'next/headers';
import { networkFromCookie, type Network } from './network';

export async function getNetwork(): Promise<Network> {
  const jar = await cookies();
  return networkFromCookie(jar.get('leash_network')?.value);
}
