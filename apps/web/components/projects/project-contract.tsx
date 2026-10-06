'use client';

import * as React from 'react';
import { OrgRole, type ProjectContract as ProjectContractData } from '@engloop/types';
import { replaceProjectContractSchema } from '@engloop/schemas';
import { Button } from '@engloop/ui';
import { QueryBoundary } from '@/components/common/states';
import { useCurrentUser } from '@/lib/queries';
import { useProjectContract, useSaveProjectContract } from '@/lib/project-contract';
import { linesToItems, PlanningList, PlanningText } from './planning-fields';

const ContractEditor = ({
  data,
  pending,
  save,
  cancel,
}: {
  data: ProjectContractData;
  pending: boolean;
  save: (body: ProjectContractData) => void;
  cancel: () => void;
}): React.JSX.Element => {
  const [objective, setObjective] = React.useState(data.objective ?? '');
  const [requirements, setRequirements] = React.useState(data.requirements.join('\n'));
  const [nonGoals, setNonGoals] = React.useState(data.nonGoals.join('\n'));
  const [criteria, setCriteria] = React.useState(data.acceptanceCriteria.join('\n'));
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = replaceProjectContractSchema.safeParse({
          objective: objective.trim() || null,
          requirements: linesToItems(requirements),
          nonGoals: linesToItems(nonGoals),
          acceptanceCriteria: linesToItems(criteria),
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Invalid project contract.');
          return;
        }
        setError(null);
        save(parsed.data);
      }}
    >
      <PlanningText
        label="Project objective"
        value={objective}
        onChange={setObjective}
        disabled={pending}
      />
      <PlanningText
        label="Requirements (one per line)"
        value={requirements}
        onChange={setRequirements}
        disabled={pending}
        maxLength={100000}
      />
      <PlanningText
        label="Non-goals (one per line)"
        value={nonGoals}
        onChange={setNonGoals}
        disabled={pending}
        maxLength={100000}
      />
      <PlanningText
        label="Project acceptance criteria (one per line)"
        value={criteria}
        onChange={setCriteria}
        disabled={pending}
        maxLength={100000}
      />
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending}>
          Save contract
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={cancel}>
          Cancel contract edit
        </Button>
      </div>
    </form>
  );
};

export const ProjectContract = ({ projectId }: { projectId: string }): React.JSX.Element => {
  const query = useProjectContract(projectId);
  const mutation = useSaveProjectContract(projectId);
  const user = useCurrentUser();
  const canManage = user.data?.role === OrgRole.OWNER || user.data?.role === OrgRole.ADMIN;
  const [editing, setEditing] = React.useState(false);
  return (
    <section
      className="mt-6 min-w-0 space-y-3 rounded-md border border-border p-3"
      aria-label="Project contract"
    >
      <h2 className="text-sm font-semibold">Project contract</h2>
      <p className="text-xs text-muted-foreground">
        Draft requirements for human review. Saving these fields does not accept a project or start
        work.
      </p>
      <QueryBoundary
        query={query}
        entity="Project contract"
        loadingLabel="Loading project contract…"
      >
        {(data) =>
          editing && canManage ? (
            <ContractEditor
              data={data}
              pending={mutation.isPending}
              cancel={() => {
                setEditing(false);
                mutation.reset();
              }}
              save={(body) => mutation.mutate(body, { onSuccess: () => setEditing(false) })}
            />
          ) : (
            <div className="space-y-3">
              <div className="space-y-1 text-xs">
                <h3 className="font-medium">Project objective</h3>
                <p className="break-words">{data.objective ?? 'No objective specified.'}</p>
              </div>
              <PlanningList title="Requirements" items={data.requirements} />
              <PlanningList title="Non-goals" items={data.nonGoals} />
              <PlanningList title="Project acceptance criteria" items={data.acceptanceCriteria} />
              {canManage ? (
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => {
                    mutation.reset();
                    setEditing(true);
                  }}
                >
                  Edit contract
                </Button>
              ) : null}
            </div>
          )
        }
      </QueryBoundary>
      {mutation.isPending ? (
        <p role="status" className="text-xs">
          Saving project contract…
        </p>
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="break-words text-xs text-danger">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Could not save project contract.'}
        </p>
      ) : null}
    </section>
  );
};
