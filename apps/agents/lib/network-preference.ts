'use client';

import * as React from 'react';

import { SOLANA_NETWORK, type SolanaNetwork } from './env';

const STORAGE_KEY = 'leash:network-preference';
const EVENT_NAME = 'leash:network-preference:change';

function isNetwork(value: unknown): value is SolanaNetwork {
  return value === 'solana-mainnet' || value === 'solana-devnet';
}

/**
 * Read the user's preferred default network from `localStorage`.
 *
 * Falls back to the env-derived `SOLANA_NETWORK` so a brand-new visitor
 * sees the operator-configured cluster (rather than always mainnet).
 *
 * Safe to call from server contexts: returns `SOLANA_NETWORK` when
 * `window` is not defined.
 */
export function getStoredNetwork(): SolanaNetwork {
  if (typeof window === 'undefined') return SOLANA_NETWORK;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (isNetwork(raw)) return raw;
  } catch {
    // localStorage can throw under privacy modes / Safari ITP.
  }
  return SOLANA_NETWORK;
}

/**
 * Persist the user's network choice and notify other components in the
 * same tab (the standard `storage` event only fires across tabs).
 */
export function setStoredNetwork(network: SolanaNetwork): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(STORAGE_KEY, network);
  } catch {
    // ignore — see getStoredNetwork()
  }
  window.dispatchEvent(new CustomEvent<SolanaNetwork>(EVENT_NAME, { detail: network }));
}

/**
 * React hook returning the current preferred network and a setter that
 * persists the choice to `localStorage` + broadcasts to every other
 * `useSelectedNetwork` mount in the page.
 *
 * Initial render uses the env default to keep server-rendered HTML and
 * the first client paint identical; the stored value is hydrated in an
 * effect to avoid SSR mismatch warnings.
 */
export function useSelectedNetwork(): readonly [SolanaNetwork, (n: SolanaNetwork) => void] {
  const [network, setNetwork] = React.useState<SolanaNetwork>(SOLANA_NETWORK);

  React.useEffect(() => {
    setNetwork(getStoredNetwork());
    function onCustom(e: Event) {
      const detail = (e as CustomEvent<SolanaNetwork>).detail;
      if (isNetwork(detail)) setNetwork(detail);
    }
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY) return;
      if (isNetwork(e.newValue)) setNetwork(e.newValue);
    }
    window.addEventListener(EVENT_NAME, onCustom);
    window.addEventListener('storage', onStorage);
    return () => {
      window.removeEventListener(EVENT_NAME, onCustom);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  const update = React.useCallback((next: SolanaNetwork) => {
    setStoredNetwork(next);
    setNetwork(next);
  }, []);

  return [network, update] as const;
}
