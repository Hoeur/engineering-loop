'use client';

import type * as React from 'react';
import { Gauge } from 'lucide-react';
import { FindingsScreen } from '@/components/common/findings-screen';

export default function PerformancePage(): React.JSX.Element {
  return (
    <FindingsScreen
      title="Performance"
      description="Performance and architecture findings raised during review."
      icon={Gauge}
      categories={['PERFORMANCE', 'ARCHITECTURE']}
      emptyTitle="No open performance findings"
      emptyDescription="Reviewers have not flagged performance or architectural concerns under these filters."
    />
  );
}
