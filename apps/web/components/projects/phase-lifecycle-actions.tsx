'use client';

import * as React from 'react';
import { ProjectPhaseStatus, type ProjectPhaseSummary } from '@engloop/types';
import { Button } from '@engloop/ui';
import type { PhaseChange } from '@/lib/project-phases';

export const PhaseLifecycleActions = ({
  phase,
  pending,
  change,
}: {
  phase: ProjectPhaseSummary;
  pending: boolean;
  change: (input: PhaseChange) => void;
}): React.JSX.Element | null => {
  const [confirming, setConfirming] = React.useState(false);
  React.useEffect(() => setConfirming(false), [phase.status]);
  if (phase.status === ProjectPhaseStatus.ACCEPTED) return null;
  const activate = phase.status === ProjectPhaseStatus.DRAFT;
  const action = activate ? 'Activate phase' : 'Reopen draft';
  return (
    <div className="space-y-2 text-xs">
      {confirming ? (
        <>
          <p>
            {activate
              ? `Activate ${phase.name}? All prerequisite phases must be accepted. This locks metadata, position and task membership without starting work.`
              : `Reopen ${phase.name} as a draft? Linked tasks must be idle. Planning edits will become available again.`}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              disabled={pending}
              onClick={() =>
                change({
                  kind: activate ? 'activate' : 'reopen',
                  phaseId: phase.id,
                })
              }
            >
              {activate ? 'Confirm activation' : 'Confirm reopen'}
            </Button>
            <Button
              size="sm"
              variant="outline"
              disabled={pending}
              onClick={() => setConfirming(false)}
            >
              Cancel
            </Button>
          </div>
        </>
      ) : (
        <Button size="sm" variant="outline" disabled={pending} onClick={() => setConfirming(true)}>
          {action}
        </Button>
      )}
    </div>
  );
};
