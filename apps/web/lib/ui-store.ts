'use client';

import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Global *client UI* state only (spec section 1: "Zustand only for global UI
 * state when necessary"). All server data lives in TanStack Query.
 */
interface UiState {
  sidebarCollapsed: boolean;
  mobileNavOpen: boolean;
  commandPaletteOpen: boolean;
  activeProjectId: string | null;
  toggleSidebar: () => void;
  setMobileNav: (open: boolean) => void;
  setCommandPalette: (open: boolean) => void;
  setActiveProject: (projectId: string | null) => void;
}

export const useUiStore = create<UiState>()(
  persist(
    (set) => ({
      sidebarCollapsed: false,
      mobileNavOpen: false,
      commandPaletteOpen: false,
      activeProjectId: null,
      toggleSidebar: () => set((state) => ({ sidebarCollapsed: !state.sidebarCollapsed })),
      setMobileNav: (open) => set({ mobileNavOpen: open }),
      setCommandPalette: (open) => set({ commandPaletteOpen: open }),
      setActiveProject: (projectId) => set({ activeProjectId: projectId }),
    }),
    {
      name: 'engloop-ui',
      partialize: (state) => ({
        sidebarCollapsed: state.sidebarCollapsed,
        activeProjectId: state.activeProjectId,
      }),
    },
  ),
);
