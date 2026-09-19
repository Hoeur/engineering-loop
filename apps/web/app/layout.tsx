import type { Metadata, Viewport } from 'next';
import type * as React from 'react';
import './globals.css';
import { Providers } from './providers';
import { AppShell } from '@/components/shell/app-shell';

export const metadata: Metadata = {
  title: {
    default: 'EngLoop — engineering control plane',
    template: '%s · EngLoop',
  },
  description:
    'Multi-agent AI engineering orchestration: plan, implement, verify, review and ship with a bounded agent loop.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#ffffff' },
    { media: '(prefers-color-scheme: dark)', color: '#0f131b' },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }): React.JSX.Element {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="min-h-dvh">
        <Providers>
          <AppShell>{children}</AppShell>
        </Providers>
      </body>
    </html>
  );
}
