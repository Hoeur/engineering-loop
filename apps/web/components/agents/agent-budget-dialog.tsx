'use client';

import * as React from 'react';
import { Loader2, Sliders } from 'lucide-react';
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
} from '@engloop/ui';
import { ApiError } from '@/lib/api-client';
import { useUpdateAgent } from '@/lib/queries';
import type { AgentSummary, UpdateAgentInput } from '@/lib/types';

const errorMessage = (error: unknown): string =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Could not update the agent limits';

interface BudgetForm {
  maxTokens: string;
  maxCostUsd: string;
  timeoutMs: string;
  maxRetries: string;
}

const toForm = (agent: AgentSummary): BudgetForm => ({
  maxTokens: String(agent.maxTokens),
  maxCostUsd: String(Number(agent.maxCostUsd)),
  timeoutMs: String(agent.timeoutMs),
  maxRetries: String(agent.maxRetries),
});

/** Mirrors `updateAgentSchema` so mistakes show before a round trip. */
export const validateBudget = (form: BudgetForm): string | null => {
  const tokens = Number(form.maxTokens);
  if (!Number.isInteger(tokens) || tokens < 1) {
    return 'Token limit must be a whole number of at least 1.';
  }
  const cost = Number(form.maxCostUsd);
  if (!Number.isFinite(cost) || cost < 0) return 'Cost limit must be 0 or more.';
  const timeout = Number(form.timeoutMs);
  if (!Number.isInteger(timeout) || timeout < 1) {
    return 'Timeout must be a whole number of milliseconds.';
  }
  const retries = Number(form.maxRetries);
  if (!Number.isInteger(retries) || retries < 0 || retries > 10) {
    return 'Retries must be a whole number from 0 to 10.';
  }
  return null;
};

export interface AgentBudgetDialogProps {
  agent: AgentSummary;
}

/**
 * Edits one agent's execution limits.
 *
 * These bound the run itself: the worker passes them as the run's budget and
 * the CLI adapter fails the run when usage exceeds either ceiling.
 */
export const AgentBudgetDialog = ({ agent }: AgentBudgetDialogProps): React.JSX.Element => {
  const [open, setOpen] = React.useState(false);
  const [form, setForm] = React.useState<BudgetForm>(() => toForm(agent));
  const [error, setError] = React.useState<string | null>(null);
  const update = useUpdateAgent();

  const onOpenChange = (next: boolean): void => {
    setOpen(next);
    if (next) {
      // Re-seed from the server's current values each time it opens.
      setForm(toForm(agent));
      setError(null);
    }
  };

  const field = (key: keyof BudgetForm) => (event: React.ChangeEvent<HTMLInputElement>) =>
    setForm((current) => ({ ...current, [key]: event.target.value }));

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const invalid = validateBudget(form);
    if (invalid) {
      setError(invalid);
      return;
    }
    setError(null);
    const body: UpdateAgentInput = {
      maxTokens: Number(form.maxTokens),
      maxCostUsd: Number(form.maxCostUsd),
      timeoutMs: Number(form.timeoutMs),
      maxRetries: Number(form.maxRetries),
    };
    try {
      await update.mutateAsync({ id: agent.id, ...body });
      setOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <Sliders className="mr-1.5 h-3 w-3" />
        Edit limits
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <form onSubmit={(event) => void submit(event)}>
            <DialogHeader>
              <DialogTitle>{agent.name} limits</DialogTitle>
              <DialogDescription>
                A run stops when it passes either ceiling. Cost usually binds first, so keep the
                two consistent with the model this agent uses.
              </DialogDescription>
            </DialogHeader>

            <div className="grid gap-3 py-4 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="agent-max-tokens">Token limit</Label>
                <Input
                  id="agent-max-tokens"
                  inputMode="numeric"
                  value={form.maxTokens}
                  onChange={field('maxTokens')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-max-cost">Cost limit (USD)</Label>
                <Input
                  id="agent-max-cost"
                  inputMode="decimal"
                  value={form.maxCostUsd}
                  onChange={field('maxCostUsd')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-timeout">Timeout (ms)</Label>
                <Input
                  id="agent-timeout"
                  inputMode="numeric"
                  value={form.timeoutMs}
                  onChange={field('timeoutMs')}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="agent-retries">Retries</Label>
                <Input
                  id="agent-retries"
                  inputMode="numeric"
                  value={form.maxRetries}
                  onChange={field('maxRetries')}
                />
              </div>
            </div>

            {error ? <p className="pb-2 text-[11px] text-destructive">{error}</p> : null}

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setOpen(false)}
                disabled={update.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={update.isPending}>
                {update.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                Save limits
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
