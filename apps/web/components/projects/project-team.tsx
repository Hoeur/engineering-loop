'use client';

import * as React from 'react';
import { AgentRole, OrgRole } from '@engloop/types';
import type { ProjectTeam as Team, RoleCoverage } from '@engloop/types';
import { replaceProjectTeamSchema } from '@engloop/schemas';
import type { ReplaceProjectTeamDto } from '@engloop/schemas';
import { Button } from '@engloop/ui';
import { QueryBoundary } from '@/components/common/states';
import { useCurrentUser } from '@/lib/queries';
import { useProjectTeam, useSaveProjectTeam } from '@/lib/project-team';

function Coverage({ name, data }: { name: string; data: RoleCoverage }) {
  return (
    <div className="break-words text-xs">
      <h3 className="font-medium">{name}</h3>
      <p>Required roles: {data.requiredRoles.join(', ') || 'None specified'}</p>
      <p>Covered roles: {data.coveredRoles.join(', ') || 'None'}</p>
      <p>Missing roles: {data.missingRoles.join(', ') || 'None'}</p>
    </div>
  );
}

function TeamEditor({
  data,
  pending,
  save,
  cancel,
}: {
  data: Team;
  pending: boolean;
  save: (body: ReplaceProjectTeamDto) => void;
  cancel: () => void;
}) {
  const [memberIds, setMembers] = React.useState(data.memberIds);
  const [expectedVersion] = React.useState(data.version);
  const [requiredRoles, setRoles] = React.useState(data.coverage.requiredRoles);
  const [error, setError] = React.useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={(event) => {
        event.preventDefault();
        const parsed = replaceProjectTeamSchema.safeParse({
          expectedVersion,
          memberIds,
          requiredRoles,
        });
        if (!parsed.success) {
          setError(parsed.error.issues[0]?.message ?? 'Invalid team');
          return;
        }
        setError(null);
        save(parsed.data);
      }}
    >
      <fieldset disabled={pending} className="space-y-2">
        <legend className="text-xs font-medium">Team members</legend>
        {!data.agents.length ? (
          <p className="text-xs">No project or organization agents available.</p>
        ) : null}
        {data.agents.map((agent) => (
          <label key={agent.id} className="flex items-start gap-2 break-words text-xs">
            <input
              type="checkbox"
              className="mt-0.5 shrink-0"
              checked={memberIds.includes(agent.id)}
              disabled={!agent.eligible && !memberIds.includes(agent.id)}
              onChange={(event) =>
                setMembers(
                  event.target.checked
                    ? [...memberIds, agent.id]
                    : memberIds.filter((id) => id !== agent.id),
                )
              }
            />
            <span className="min-w-0">
              {agent.name} ({agent.role})
              {agent.unavailableReason ? ` — ${agent.unavailableReason}` : ''}
            </span>
          </label>
        ))}
      </fieldset>
      <fieldset disabled={pending} className="space-y-2">
        <legend className="text-xs font-medium">Required team roles</legend>
        <div className="grid gap-2 sm:grid-cols-2">
          {Object.values(AgentRole).map((role) => (
            <label key={role} className="flex items-start gap-2 text-xs">
              <input
                type="checkbox"
                checked={requiredRoles.includes(role)}
                onChange={(event) =>
                  setRoles(
                    event.target.checked
                      ? [...requiredRoles, role]
                      : requiredRoles.filter((item) => item !== role),
                  )
                }
              />
              <span className="min-w-0 break-words">{role}</span>
            </label>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button size="sm" disabled={pending}>
          Save team
        </Button>
        <Button type="button" size="sm" variant="outline" disabled={pending} onClick={cancel}>
          Cancel team edit
        </Button>
      </div>
    </form>
  );
}

export function ProjectTeam({ projectId }: { projectId: string }) {
  const query = useProjectTeam(projectId);
  const mutation = useSaveProjectTeam(projectId);
  const user = useCurrentUser();
  const canManage = user.data?.role === OrgRole.OWNER || user.data?.role === OrgRole.ADMIN;
  const [editing, setEditing] = React.useState(false);
  return (
    <section
      className="mt-6 min-w-0 space-y-3 rounded-md border border-border p-3"
      aria-label="Project team"
    >
      <h2 className="text-sm font-semibold">Project team</h2>
      <p className="text-xs text-muted-foreground">
        Choose agents for this project. Roles describe responsibilities; agent permissions stay
        separate. Coverage uses enabled members and providers. Saving configures this roster for
        future runs; uncovered roles cannot run. Saving does not start work.
      </p>
      <QueryBoundary query={query} entity="Project team" loadingLabel="Loading project team…">
        {(data) => (
          <>
            {!data.configured ? (
              <p className="text-xs">
                Team not configured. Legacy role assignments apply until you save a team.
              </p>
            ) : null}
            {!data.editable ? (
              <p className="text-xs">
                Team edits are locked while a phase is active or work is live.
              </p>
            ) : null}
            {editing && canManage && data.editable ? (
              <TeamEditor
                data={data}
                pending={mutation.isPending}
                save={(body) => mutation.mutate(body, { onSuccess: () => setEditing(false) })}
                cancel={() => {
                  setEditing(false);
                  mutation.reset();
                }}
              />
            ) : (
              <div className="space-y-3">
                {!data.memberIds.length ? (
                  <p className="text-xs">No team members assigned.</p>
                ) : (
                  <ul className="space-y-1 text-xs">
                    {data.memberIds.map((id) => {
                      const agent = data.agents.find((item) => item.id === id);
                      return (
                        <li key={id} className="break-words">
                          {agent
                            ? `${agent.name} (${agent.role})${agent.unavailableReason ? ` — ${agent.unavailableReason}` : ''}`
                            : 'Unavailable member'}
                          {agent?.configuration
                            ? ` · configuration v${agent.configuration.version}`
                            : ''}
                        </li>
                      );
                    })}
                  </ul>
                )}
                <Coverage name="Team coverage" data={data.coverage} />
                {data.phases.map((phase) => (
                  <Coverage key={phase.id} name={`Phase coverage: ${phase.name}`} data={phase} />
                ))}
                {canManage && data.editable ? (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      mutation.reset();
                      setEditing(true);
                    }}
                  >
                    Edit team
                  </Button>
                ) : null}
              </div>
            )}
          </>
        )}
      </QueryBoundary>
      {mutation.isPending ? (
        <p role="status" className="text-xs">
          Saving project team…
        </p>
      ) : null}
      {mutation.isError ? (
        <p role="alert" className="break-words text-xs text-danger">
          {mutation.error instanceof Error
            ? mutation.error.message
            : 'Could not save project team.'}
        </p>
      ) : null}
    </section>
  );
}
