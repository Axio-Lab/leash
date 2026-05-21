'use client';

export const ACTIVE_AGENT_STORAGE_KEY = 'leash:active-agent-mint';
export const ACTIVE_AGENT_EVENT = 'leash:active-agent-mint:change';

export function getStoredActiveAgentMint(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(ACTIVE_AGENT_STORAGE_KEY);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function setStoredActiveAgentMint(mint: string | null): void {
  if (typeof window === 'undefined') return;
  try {
    if (mint) window.localStorage.setItem(ACTIVE_AGENT_STORAGE_KEY, mint);
    else window.localStorage.removeItem(ACTIVE_AGENT_STORAGE_KEY);
  } catch {
    // localStorage can throw under privacy modes.
  }
  window.dispatchEvent(new CustomEvent<string | null>(ACTIVE_AGENT_EVENT, { detail: mint }));
}
