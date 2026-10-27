'use client';

import * as React from 'react';
import { AgentRole, PermissionLevel } from '@engloop/types';
import { updateAgentSchema, upsertAgentSchema } from '@engloop/schemas';
import {
  Button,
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  Input,
  Label,
  Textarea,
} from '@engloop/ui';
import { useCurrentUser, useProjects, useProviders } from '@/lib/queries';
import { useAgentEditor, useSaveAgent, type AgentEditorDetails } from '@/lib/agent-editing';
import { QueryBoundary } from '@/components/common/states';
import type { AgentSummary } from '@/lib/types';

interface Draft {
  name: string;
  role: AgentRole;
  providerKey: string;
  model: string;
  enabled: boolean;
  systemPrompt: string;
  permissionLevel: PermissionLevel;
  allowedCommands: string;
  maxTokens: string;
  maxCostUsd: string;
  timeoutMs: string;
  maxRetries: string;
  projectId: string;
}
const draftFrom = (agent?: AgentEditorDetails): Draft => ({
  name: agent?.name ?? '',
  role: agent?.role ?? AgentRole.IMPLEMENTER,
  providerKey: agent?.provider.key ?? '',
  model: agent?.model ?? '',
  enabled: agent?.enabled ?? true,
  systemPrompt: agent?.systemPrompt ?? '',
  permissionLevel: agent?.permissionLevel ?? PermissionLevel.LEVEL_3_PR,
  allowedCommands: agent?.allowedCommands.join('\n') ?? '',
  maxTokens: String(agent?.maxTokens ?? 200000),
  maxCostUsd: String(agent?.maxCostUsd ?? 5),
  timeoutMs: String(agent?.timeoutMs ?? 900000),
  maxRetries: String(agent?.maxRetries ?? 2),
  projectId: agent?.projectId ?? '',
});
const selectClass = 'h-9 w-full rounded-md border border-input bg-background px-2 text-xs';

export const AgentEditDialog = ({ agent }: { agent?: AgentSummary }): React.JSX.Element => {
  const user = useCurrentUser();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  if (user.data?.role !== 'OWNER' && user.data?.role !== 'ADMIN') return <></>;
  return (
    <>
      <Button size="sm" variant={agent ? 'outline' : 'default'} onClick={() => setOpen(true)}>
        {agent ? 'Edit agent' : 'New agent'}
      </Button>
      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!busy) setOpen(next);
        }}
      >
        {open ? (
          <AgentEditor
            key={agent?.id ?? 'new'}
            id={agent?.id}
            close={() => setOpen(false)}
            busy={busy}
            onBusyChange={setBusy}
          />
        ) : null}
      </Dialog>
    </>
  );
};

const AgentEditor = ({
  id,
  close,
  busy,
  onBusyChange,
}: {
  id?: string;
  close: () => void;
  busy: boolean;
  onBusyChange: (value: boolean) => void;
}): React.JSX.Element => {
  const query = useAgentEditor(id);
  if (id)
    return (
      <DialogContent className="max-w-2xl" hideClose={busy}>
        <DialogHeader>
          <DialogTitle>Edit agent</DialogTitle>
          <DialogDescription>Load saved settings before editing.</DialogDescription>
        </DialogHeader>
        <QueryBoundary
          query={{ ...query, isError: query.isError && query.data === undefined }}
          entity="Agent"
          loadingLabel="Loading agent settings…"
        >
          {(agent) => (
            <AgentForm
              initial={agent}
              close={close}
              onBusyChange={onBusyChange}
              reload={async () => {
                const result = await query.refetch({ throwOnError: true });
                return result.data;
              }}
            />
          )}
        </QueryBoundary>
      </DialogContent>
    );
  return (
    <DialogContent className="max-w-2xl" hideClose={busy}>
      <DialogHeader>
        <DialogTitle>New agent</DialogTitle>
        <DialogDescription>Configure an agent for future task executions.</DialogDescription>
      </DialogHeader>
      <AgentForm close={close} onBusyChange={onBusyChange} />
    </DialogContent>
  );
};

const AgentForm = ({
  initial,
  close,
  reload,
  onBusyChange,
}: {
  initial?: AgentEditorDetails;
  close: () => void;
  reload?: () => Promise<AgentEditorDetails | undefined>;
  onBusyChange: (value: boolean) => void;
}): React.JSX.Element => {
  const providers = useProviders();
  const projects = useProjects();
  const user = useCurrentUser();
  const save = useSaveAgent();
  const [baseline, setBaseline] = React.useState(initial);
  const [draft, setDraft] = React.useState(() => draftFrom(initial));
  const [error, setError] = React.useState<string | null>(null);
  const [reloading, setReloading] = React.useState(false);
  const submitted = React.useRef(false);
  const busy = save.isPending || reloading;
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) =>
    setDraft((current) => ({ ...current, [key]: value }));
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (busy || submitted.current) return;
    setError(null);
    if (
      [draft.maxTokens, draft.maxCostUsd, draft.timeoutMs, draft.maxRetries].some(
        (value) => !value.trim(),
      )
    ) {
      setError('Complete each execution limit with a number.');
      return;
    }
    const { projectId, ...fields } = draft;
    const values = {
      ...fields,
      name: fields.name.trim(),
      allowedCommands: fields.allowedCommands
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
      maxTokens: Number(fields.maxTokens),
      maxCostUsd: Number(fields.maxCostUsd),
      timeoutMs: Number(fields.timeoutMs),
      maxRetries: Number(fields.maxRetries),
    };
    const input = baseline
      ? updateAgentSchema.safeParse({
          ...Object.fromEntries(
            Object.entries(values).filter(([key, value]) => {
              const previous =
                key === 'providerKey'
                  ? baseline.provider.key
                  : key === 'systemPrompt' || key === 'model'
                    ? (baseline[key] ?? '')
                    : key === 'maxCostUsd'
                      ? Number(baseline.maxCostUsd)
                      : baseline[key as keyof AgentEditorDetails];
              return JSON.stringify(value) !== JSON.stringify(previous);
            }),
          ),
          expectedUpdatedAt: baseline.updatedAt,
        })
      : upsertAgentSchema.safeParse({
          ...values,
          organizationId: user.data?.organizationId,
          ...(projectId ? { projectId } : {}),
        });
    if (!input.success) {
      setError(
        input.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; '),
      );
      return;
    }
    if (baseline && Object.keys(input.data).length === 1) {
      setError('No changes to save.');
      return;
    }
    submitted.current = true;
    try {
      if (baseline)
        await save.mutateAsync({ id: baseline.id, body: updateAgentSchema.parse(input.data) });
      else await save.mutateAsync({ body: upsertAgentSchema.parse(input.data) });
      close();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save agent');
    } finally {
      submitted.current = false;
    }
  };
  const reloadSaved = async () => {
    if (!reload || busy) return;
    setReloading(true);
    try {
      const agent = await reload();
      if (agent) {
        setBaseline(agent);
        setDraft(draftFrom(agent));
        setError(null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not reload agent');
    } finally {
      setReloading(false);
    }
  };
  React.useEffect(() => {
    onBusyChange(busy);
    return () => onBusyChange(false);
  }, [busy, onBusyChange]);
  return (
    <form className="min-w-0 space-y-4" onSubmit={(event) => void submit(event)} noValidate>
      <p className="text-xs text-muted-foreground">
        Execution settings apply to future work. Finish or cancel active project work before
        changing role, provider, model, prompt or execution policy.
      </p>
      <fieldset
        disabled={busy}
        className="m-0 max-h-[53vh] min-w-0 space-y-3 overflow-y-auto border-0 p-0 pr-1 disabled:opacity-70"
      >
        <div className="space-y-1.5">
          <Label htmlFor="agent-name">Name</Label>
          <Input
            id="agent-name"
            value={draft.name}
            maxLength={80}
            onChange={(event) => set('name', event.target.value)}
          />
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div className="space-y-1.5">
            <Label htmlFor="agent-role">Role</Label>
            <select
              id="agent-role"
              className={selectClass}
              value={draft.role}
              onChange={(event) => set('role', event.target.value as AgentRole)}
            >
              {Object.values(AgentRole).map((role) => (
                <option key={role} value={role}>
                  {role.replace(/_/g, ' ')}
                </option>
              ))}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="agent-provider">Provider</Label>
            <select
              id="agent-provider"
              className={selectClass}
              value={draft.providerKey}
              onChange={(event) => set('providerKey', event.target.value)}
            >
              <option value="">Choose provider</option>
              {providers.data?.items
                .filter((provider) => provider.enabled || provider.key === baseline?.provider.key)
                .map((provider) => (
                  <option key={provider.key} value={provider.key} disabled={!provider.enabled}>
                    {provider.displayName}
                    {provider.enabled ? '' : ' (disabled)'}
                  </option>
                ))}
            </select>
          </div>
        </div>
        {providers.isLoading ? (
          <p role="status">Loading providers…</p>
        ) : providers.isError ? (
          <p role="alert">
            Could not load providers.{' '}
            <Button type="button" variant="outline" onClick={() => void providers.refetch()}>
              Retry providers
            </Button>
          </p>
        ) : !providers.data?.items.some((provider) => provider.enabled) ? (
          <p role="status">Enable a provider before creating an agent.</p>
        ) : null}
        <div className="space-y-1.5">
          <Label htmlFor="agent-model">Model</Label>
          <Input
            id="agent-model"
            value={draft.model}
            maxLength={120}
            placeholder="Provider default"
            onChange={(event) => set('model', event.target.value)}
          />
        </div>
        {!baseline ? (
          <div className="space-y-1.5">
            <Label htmlFor="agent-project">Project scope</Label>
            <select
              id="agent-project"
              className={selectClass}
              value={draft.projectId}
              onChange={(event) => set('projectId', event.target.value)}
            >
              <option value="">Organization-wide</option>
              {projects.data?.items.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
            {projects.isError ? (
              <p role="alert">
                Could not load projects.{' '}
                <Button type="button" variant="outline" onClick={() => void projects.refetch()}>
                  Retry projects
                </Button>
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-xs text-muted-foreground">
            Scope: {baseline.projectId ? 'Project-specific (fixed)' : 'Organization-wide'}
          </p>
        )}
        <label className="flex items-center gap-2 text-xs">
          <input
            type="checkbox"
            checked={draft.enabled}
            onChange={(event) => set('enabled', event.target.checked)}
          />
          Enabled
        </label>
        <div className="space-y-1.5">
          <Label htmlFor="agent-prompt">System prompt</Label>
          <Textarea
            id="agent-prompt"
            rows={4}
            maxLength={20000}
            value={draft.systemPrompt}
            onChange={(event) => set('systemPrompt', event.target.value)}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-permission">Permission ceiling</Label>
          <select
            id="agent-permission"
            className={selectClass}
            value={draft.permissionLevel}
            onChange={(event) => set('permissionLevel', event.target.value as PermissionLevel)}
          >
            {Object.values(PermissionLevel).map((level) => (
              <option key={level} value={level}>
                {level.replace(/_/g, ' ')}
              </option>
            ))}
          </select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="agent-commands">Allowed commands (one per line)</Label>
          <Textarea
            id="agent-commands"
            rows={2}
            value={draft.allowedCommands}
            onChange={(event) => set('allowedCommands', event.target.value)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3">
          {(
            [
              ['maxTokens', 'Token limit'],
              ['maxCostUsd', 'Cost limit (USD)'],
              ['timeoutMs', 'Timeout (ms)'],
              ['maxRetries', 'Retries'],
            ] as const
          ).map(([key, label]) => (
            <div className="space-y-1.5" key={key}>
              <Label htmlFor={`agent-${key}`}>{label}</Label>
              <Input
                id={`agent-${key}`}
                type="number"
                step={key === 'maxCostUsd' ? 'any' : 1}
                value={draft[key]}
                onChange={(event) => set(key, event.target.value)}
              />
            </div>
          ))}
        </div>
      </fieldset>
      {error ? (
        <p role="alert" className="break-words text-sm text-danger-strong">
          {error}
        </p>
      ) : null}
      <DialogFooter className="flex-wrap gap-2">
        {reload ? (
          <Button
            type="button"
            variant="outline"
            disabled={busy}
            onClick={() => void reloadSaved()}
          >
            Reload saved agent
          </Button>
        ) : null}
        <Button type="button" variant="outline" disabled={busy} onClick={close}>
          Cancel
        </Button>
        <Button type="submit" disabled={busy || providers.isLoading || providers.isError}>
          {save.isPending ? 'Saving…' : baseline ? 'Save agent' : 'Create agent'}
        </Button>
      </DialogFooter>
    </form>
  );
};
