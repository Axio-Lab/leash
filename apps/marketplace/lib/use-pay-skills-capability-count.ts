'use client';

import useSWR from 'swr';

import { capabilityCount, paySkillsProviderPath, type CapabilityCountInput } from './capabilities';

type PaySkillsProviderCount = {
  endpoints?: unknown[];
};

const fetcher = async (url: string): Promise<PaySkillsProviderCount> => {
  const res = await fetch(url, { credentials: 'include' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json() as Promise<PaySkillsProviderCount>;
};

export function useCapabilityCount(item: CapabilityCountInput & { slug: string }): {
  count: number;
  isHydrating: boolean;
} {
  const initial = capabilityCount(item);
  const shouldHydrate = item.source === 'pay-skills' && initial <= 1;
  const { data, isLoading } = useSWR<PaySkillsProviderCount>(
    shouldHydrate ? paySkillsProviderPath(item.slug) : null,
    fetcher,
    { revalidateOnFocus: false },
  );
  const hydrated = data?.endpoints?.length;
  return {
    count: typeof hydrated === 'number' && hydrated > 0 ? hydrated : initial,
    isHydrating: shouldHydrate && isLoading,
  };
}
