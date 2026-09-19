import type * as React from 'react';
import { LoadingState } from '@/components/common/states';

export default function Loading(): React.JSX.Element {
  return <LoadingState rows={5} />;
}
