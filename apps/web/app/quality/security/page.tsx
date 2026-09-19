'use client';

import type * as React from 'react';
import { ShieldCheck } from 'lucide-react';
import { FindingsScreen } from '@/components/common/findings-screen';

export default function SecurityPage(): React.JSX.Element {
  return (
    <FindingsScreen
      title="Security"
      description="Security findings from code review and scheduled security scans."
      icon={ShieldCheck}
      categories={['SECURITY']}
      emptyTitle="No open security findings"
      emptyDescription="Nothing flagged. Scheduled security scans create a task whenever they find something."
    />
  );
}
