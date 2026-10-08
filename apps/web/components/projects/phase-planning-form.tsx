'use client';

import * as React from 'react';
import { AgentRole, type ProjectPhaseSummary } from '@engloop/types';
import { createProjectPhaseSchema, type CreateProjectPhaseDto } from '@engloop/schemas';
import { Button, Input } from '@engloop/ui';
import { linesToItems, PlanningText } from './planning-fields';

export const PhasePlanningForm = ({
  phase,
  phases,
  pending,
  disabled,
  save,
  cancel,
}: {
  phase: ProjectPhaseSummary | null;
  phases: ProjectPhaseSummary[];
  pending: boolean;
  disabled: boolean;
  save: (fields: CreateProjectPhaseDto) => void;
  cancel: () => void;
}): React.JSX.Element => {
  const [name, setName] = React.useState(phase?.name ?? '');
  const [description, setDescription] = React.useState(phase?.description ?? '');
  const [objective, setObjective] = React.useState(phase?.objective ?? '');
  const [deliverables, setDeliverables] = React.useState((phase?.deliverables ?? []).join('\n'));
  const [criteria, setCriteria] = React.useState((phase?.acceptanceCriteria ?? []).join('\n'));
  const [roles, setRoles] = React.useState<AgentRole[]>(phase?.requiredRoles ?? []);
  const [dependencies, setDependencies] = React.useState<string[]>(phase?.dependencyIds ?? []);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3 rounded-md border border-border p-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = createProjectPhaseSchema.safeParse({
          name,
          description: description.trim() || null,
          objective: objective.trim() || null,
          deliverables: linesToItems(deliverables),
          acceptanceCriteria: linesToItems(criteria),
          requiredRoles: roles,
          dependencyIds: dependencies,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Invalid phase.');
          return;
        }
        setError(null);
        save(parsed.data);
      }}
    >
      <h3 className="text-xs font-medium">{phase ? 'Edit phase' : 'Add phase'}</h3>
      <label className="block space-y-1 text-xs">
        Phase name
        <Input
          required
          maxLength={160}
          value={name}
          disabled={pending || disabled}
          onChange={(event) => setName(event.target.value)}
        />
      </label>
      <PlanningText
        label="Description"
        value={description}
        onChange={setDescription}
        disabled={pending || disabled}
      />
      <PlanningText
        label="Phase objective"
        value={objective}
        onChange={setObjective}
        disabled={pending || disabled}
      />
      <PlanningText
        label="Deliverables (one per line)"
        value={deliverables}
        onChange={setDeliverables}
        disabled={pending || disabled}
        maxLength={100000}
      />
      <PlanningText
        label="Phase acceptance criteria (one per line)"
        value={criteria}
        onChange={setCriteria}
        disabled={pending || disabled}
        maxLength={100000}
      />
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Required roles</legend>
        <div className="flex flex-wrap gap-3">
          {Object.values(AgentRole).map((role) => (
            <label key={role} className="flex min-h-8 cursor-pointer items-center gap-2 text-xs">
              <input
                type="checkbox"
                checked={roles.includes(role)}
                disabled={pending || disabled}
                onChange={(event) =>
                  setRoles(
                    event.target.checked ? [...roles, role] : roles.filter((item) => item !== role),
                  )
                }
              />
              {role}
            </label>
          ))}
        </div>
      </fieldset>
      <fieldset className="space-y-2">
        <legend className="text-xs font-medium">Phase dependencies</legend>
        <p className="text-xs text-muted-foreground">
          Planning dependencies only; these selections do not start or schedule work.
        </p>
        {phases
          .filter((item) => item.id !== phase?.id)
          .map((item) => (
            <label
              key={item.id}
              className="flex min-h-8 min-w-0 cursor-pointer items-center gap-2 text-xs"
            >
              <input
                className="mt-0.5 shrink-0"
                type="checkbox"
                checked={dependencies.includes(item.id)}
                disabled={pending || disabled}
                onChange={(event) =>
                  setDependencies(
                    event.target.checked
                      ? [...dependencies, item.id]
                      : dependencies.filter((id) => id !== item.id),
                  )
                }
              />
              <span className="break-words">{item.name}</span>
            </label>
          ))}
        {phases.filter((item) => item.id !== phase?.id).length === 0 ? (
          <p className="text-xs text-muted-foreground">No other phases available.</p>
        ) : null}
      </fieldset>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending || disabled || !name.trim()}>
          {phase ? 'Save phase' : 'Add phase'}
        </Button>
        {phase ? (
          <Button type="button" size="sm" variant="outline" disabled={pending} onClick={cancel}>
            Cancel edit
          </Button>
        ) : null}
      </div>
    </form>
  );
};
