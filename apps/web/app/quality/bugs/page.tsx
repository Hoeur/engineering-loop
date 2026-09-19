'use client';

import type * as React from 'react';
import { Bug } from 'lucide-react';
import { FindingsScreen } from '@/components/common/findings-screen';

export default function BugsPage(): React.JSX.Element {
  return (
    <FindingsScreen
      title="Bugs"
      description="Correctness and testing findings raised by reviewer agents, with the fix each one requires."
      icon={Bug}
      categories={['CORRECTNESS', 'TESTING', 'MAINTAINABILITY']}
      emptyTitle="No open correctness findings"
      emptyDescription="Reviewer agents have not flagged any correctness or testing issues under these filters."
    />
  );
}
