'use client';

import type * as React from 'react';
import { ErrorState } from '@/components/common/states';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}): React.JSX.Element {
  return (
    <div className="py-10">
      <ErrorState error={error} onRetry={reset} />
    </div>
  );
}
