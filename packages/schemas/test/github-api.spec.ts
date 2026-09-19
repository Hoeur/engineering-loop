import { describe, expect, it } from 'vitest';
import {
  githubAuthorizationCompleteSchema,
  githubImportRepositorySchema,
  repositoryCredentialSchema,
} from '../src';

describe('GitHub API schemas', () => {
  it('requires proof-bearing authorization completion input', () => {
    expect(
      githubAuthorizationCompleteSchema.safeParse({ state: 'x'.repeat(30), installationId: '42' })
        .success,
    ).toBe(false);
    expect(
      githubAuthorizationCompleteSchema.safeParse({
        code: 'code',
        state: 'x'.repeat(30),
        installationId: 'not-numeric',
      }).success,
    ).toBe(false);
    expect(
      githubAuthorizationCompleteSchema.safeParse({
        code: 'code',
        state: 'x'.repeat(30),
        installationId: '42',
      }).success,
    ).toBe(true);
  });

  it('accepts completion without an installation id for an already-installed App', () => {
    expect(
      githubAuthorizationCompleteSchema.safeParse({ code: 'code', state: 'x'.repeat(30) }).success,
    ).toBe(true);
  });

  it('accepts canonical repository import identifiers', () => {
    expect(
      githubImportRepositorySchema.parse({ installationId: '99', repositoryId: '123' }),
    ).toEqual({ installationId: '99', repositoryId: '123' });
  });

  it('rejects empty repository credentials', () => {
    expect(
      repositoryCredentialSchema.safeParse({ name: 'token', kind: 'pat', value: '' }).success,
    ).toBe(false);
  });
});
