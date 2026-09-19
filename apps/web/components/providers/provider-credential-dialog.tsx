'use client';

import * as React from 'react';
import { KeyRound, Loader2 } from 'lucide-react';
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
import { useUpsertProvider } from '@/lib/queries';
import type { AgentProviderSummary } from '@/lib/types';

const errorMessage = (error: unknown): string =>
  error instanceof ApiError || error instanceof Error
    ? error.message
    : 'Could not save the provider credential';

export interface ProviderCredentialDialogProps {
  provider: AgentProviderSummary;
  organizationId: string;
}

/**
 * Sets or clears one provider's API key.
 *
 * The field is write-only: a stored key is never sent to the browser, so the
 * input always starts empty and an unchanged field leaves the key alone. The
 * redacted preview returned on save is shown once and never persisted.
 */
export const ProviderCredentialDialog = ({
  provider,
  organizationId,
}: ProviderCredentialDialogProps): React.JSX.Element => {
  const [open, setOpen] = React.useState(false);
  const [credential, setCredential] = React.useState('');
  const [preview, setPreview] = React.useState<string | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const upsert = useUpsertProvider();

  const reset = (): void => {
    setCredential('');
    setPreview(null);
    setError(null);
  };

  const onOpenChange = (next: boolean): void => {
    setOpen(next);
    if (!next) reset();
  };

  const base = {
    organizationId,
    key: provider.key,
    displayName: provider.displayName,
    kind: provider.kind,
    enabled: provider.enabled,
    availableModels: provider.availableModels,
    configuration: {},
    ...(provider.defaultModel ? { defaultModel: provider.defaultModel } : {}),
  };

  const submit = async (event: React.FormEvent): Promise<void> => {
    event.preventDefault();
    const value = credential.trim();
    if (!value) {
      setError('Paste an API key, or use “Clear stored key” to remove the current one.');
      return;
    }
    setError(null);
    try {
      const saved = await upsert.mutateAsync({ ...base, credential: value });
      // Drop the plaintext as soon as it has been sent.
      setCredential('');
      setPreview(saved.credentialPreview);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  const clear = async (): Promise<void> => {
    setError(null);
    try {
      await upsert.mutateAsync({ ...base, clearCredential: true });
      reset();
      setOpen(false);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  };

  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)}>
        <KeyRound className="mr-1.5 h-3 w-3" />
        {provider.hasCredential ? 'Replace key' : 'Set key'}
      </Button>

      <Dialog open={open} onOpenChange={onOpenChange}>
        <DialogContent>
          <form onSubmit={(event) => void submit(event)}>
            <DialogHeader>
              <DialogTitle>{provider.displayName} API key</DialogTitle>
              <DialogDescription>
                Stored encrypted and never shown again. Without a key this provider runs on the
                CLI&rsquo;s own login.
              </DialogDescription>
            </DialogHeader>

            <div className="space-y-1.5 py-4">
              <Label htmlFor="provider-credential">API key</Label>
              <Input
                id="provider-credential"
                type="password"
                autoComplete="off"
                spellCheck={false}
                value={credential}
                placeholder={provider.hasCredential ? '••••••••  (a key is stored)' : 'sk-…'}
                onChange={(event) => setCredential(event.target.value)}
              />
              {preview ? (
                <p className="text-[11px] text-muted-foreground">
                  Saved <span className="font-mono">{preview}</span>. It will not be shown again.
                </p>
              ) : null}
              {error ? <p className="text-[11px] text-destructive">{error}</p> : null}
            </div>

            <DialogFooter>
              {provider.hasCredential ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  disabled={upsert.isPending}
                  onClick={() => void clear()}
                >
                  Clear stored key
                </Button>
              ) : null}
              <Button type="submit" disabled={upsert.isPending}>
                {upsert.isPending ? <Loader2 className="mr-1.5 h-3 w-3 animate-spin" /> : null}
                Save key
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
};
