import type * as React from 'react';
import { NotFoundState } from '@/components/common/states';

export default function NotFound(): React.JSX.Element {
  return (
    <div className="py-10">
      <NotFoundState entity="Page" />
    </div>
  );
}
