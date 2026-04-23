'use client';

import * as React from 'react';

/**
 * Drives the collapsible navigation rail.
 *
 * - `collapsed` controls the desktop rail (full-width vs icons-only) and is
 *   persisted to `localStorage` so the user's preference survives reloads.
 * - `mobileOpen` controls the off-canvas drawer rendered on `<md` widths;
 *   it intentionally *isn't* persisted so the drawer always starts closed
 *   on a fresh page load.
 *
 * The provider is mounted at the root layout so the topbar's hamburger and
 * the sidebar itself can share state without prop-drilling.
 */
type SidebarState = {
  collapsed: boolean;
  setCollapsed: (next: boolean) => void;
  toggleCollapsed: () => void;
  mobileOpen: boolean;
  setMobileOpen: (next: boolean) => void;
  toggleMobileOpen: () => void;
};

const SidebarContext = React.createContext<SidebarState | null>(null);

const STORAGE_KEY = 'leash:sidebar:collapsed';

export function SidebarProvider({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsedState] = React.useState(false);
  const [mobileOpen, setMobileOpenState] = React.useState(false);

  // Hydrate persisted preference once on mount. We avoid `useSyncExternalStore`
  // because the value is harmless to flash-unset on first paint (the rail is
  // hidden on mobile anyway and `collapsed: false` is the friendlier default).
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw === '1') setCollapsedState(true);
    } catch {
      // Private mode / disabled storage — fall back to the default.
    }
  }, []);

  const setCollapsed = React.useCallback((next: boolean) => {
    setCollapsedState(next);
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const toggleCollapsed = React.useCallback(() => {
    setCollapsed(!collapsed);
  }, [collapsed, setCollapsed]);

  const setMobileOpen = React.useCallback((next: boolean) => {
    setMobileOpenState(next);
  }, []);

  const toggleMobileOpen = React.useCallback(() => {
    setMobileOpenState((prev) => !prev);
  }, []);

  // Lock body scroll while the mobile drawer is open so background pages
  // don't scroll under the overlay on iOS Safari etc.
  React.useEffect(() => {
    if (typeof document === 'undefined') return;
    const original = document.body.style.overflow;
    document.body.style.overflow = mobileOpen ? 'hidden' : original;
    return () => {
      document.body.style.overflow = original;
    };
  }, [mobileOpen]);

  // Auto-close the mobile drawer when the viewport grows past the `md`
  // breakpoint (768px) so resizing into desktop doesn't leave the overlay
  // floating without a way to dismiss it.
  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    const mql = window.matchMedia('(min-width: 768px)');
    const onChange = () => {
      if (mql.matches) setMobileOpenState(false);
    };
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  }, []);

  const value = React.useMemo<SidebarState>(
    () => ({
      collapsed,
      setCollapsed,
      toggleCollapsed,
      mobileOpen,
      setMobileOpen,
      toggleMobileOpen,
    }),
    [collapsed, setCollapsed, toggleCollapsed, mobileOpen, setMobileOpen, toggleMobileOpen],
  );

  return <SidebarContext.Provider value={value}>{children}</SidebarContext.Provider>;
}

export function useSidebar(): SidebarState {
  const ctx = React.useContext(SidebarContext);
  if (!ctx) {
    throw new Error('useSidebar must be used inside <SidebarProvider>');
  }
  return ctx;
}
