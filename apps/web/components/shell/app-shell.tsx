'use client';

import type * as React from 'react';
import { usePathname } from 'next/navigation';
import { AuthGate } from '@/components/auth/auth-gate';
import { CommandPalette } from './command-palette';
import { Sidebar } from './sidebar';
import { Topbar } from './topbar';

export const AppShell = ({ children }: { children: React.ReactNode }): React.JSX.Element => {
  const pathname = usePathname();

  return (
    <AuthGate>
      {pathname === '/login' ? (
        <main className="min-h-dvh">{children}</main>
      ) : (
        <>
          <div className="flex min-h-dvh w-full">
            <Sidebar />
            <div className="flex min-w-0 flex-1 flex-col">
              <Topbar />
              <main className="min-w-0 flex-1 px-3 py-4 sm:px-5 sm:py-6 lg:px-6">
                <div className="mx-auto w-full max-w-[1400px]">{children}</div>
              </main>
            </div>
          </div>
          <CommandPalette />
        </>
      )}
    </AuthGate>
  );
};
