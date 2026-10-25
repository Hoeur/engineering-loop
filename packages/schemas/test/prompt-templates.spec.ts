import { describe, expect, it } from 'vitest';
import {
  createPromptTemplateSchema,
  revisePromptTemplateSchema,
  promptVariables,
  promptContext,
  renderPrompt,
  validatePromptOutput,
  promptOutputValidationIssues,
  promptRevisionNumberSchema,
} from '../src/prompt-templates';

describe('Prompt templates', () => {
  it('bounds contract errors to field paths and messages without copying the submitted output', () => {
    try {
      validatePromptOutput('DOCUMENTATION', {
        summary: 'Docs',
        documents: Array.from({ length: 30 }, () => ({})),
      });
      throw new Error('Expected invalid documentation output');
    } catch (error) {
      const issues = promptOutputValidationIssues(error);
      expect(issues).toHaveLength(20);
      expect(issues?.[0]).toEqual({ path: ['documents', '0', 'path'], message: 'Required' });
      expect(
        issues?.every((issue) =>
          Object.keys(issue).every((key) => ['path', 'message'].includes(key)),
        ),
      ).toBe(true);
    }
    expect(promptOutputValidationIssues(new Error('Output too large'))).toBeUndefined();
  });
  it('bounds revision route parameters to positive database integers', () => {
    expect(promptRevisionNumberSchema.parse('2')).toBe(2);
    for (const value of ['0', '-1', '1.5', '2147483648', 'NaN'])
      expect(promptRevisionNumberSchema.safeParse(value).success).toBe(false);
  });
  it('accepts fixed role contracts and unique supported variables', () => {
    expect(promptVariables('{{ task.title }} / {{role}} / {{task.title}}')).toEqual([
      'task.title',
      'role',
    ]);
    expect(
      createPromptTemplateSchema.parse({
        name: 'Task',
        role: 'IMPLEMENTER',
        body: '{{task.objective}}',
      }).body,
    ).toBe('{{task.objective}}');
  });
  it.each([
    '{{provider.credential}}',
    '{{unknown}}',
    '{{task.title',
    '{{ task[title] }}',
    '{{}}',
    '{{task.title}} }}',
  ])('rejects unsupported or malformed placeholder %s', (body) => {
    expect(
      createPromptTemplateSchema.safeParse({ name: 'Task', role: 'IMPLEMENTER', body }).success,
    ).toBe(false);
  });
  it('rejects unsupported contracts, extra configuration and excessive bodies', () => {
    for (const dto of [
      { role: 'QA', body: 'test' },
      { role: 'PRODUCT', body: 'test' },
      { role: 'IMPLEMENTER', body: 'x'.repeat(20001) },
      { role: 'IMPLEMENTER', body: 'test', permissions: ['deploy'] },
    ])
      expect(createPromptTemplateSchema.safeParse({ name: 'Prompt', ...dto }).success).toBe(false);
    expect(
      revisePromptTemplateSchema.safeParse({ expectedRevision: 0, body: 'test' }).success,
    ).toBe(false);
  });
  it('rejects missing context, renders literal substitution and bounds expansion', () => {
    expect(() => renderPrompt('{{phase.objective}}', {})).toThrow('Unresolved');
    expect(
      renderPrompt('{{task.title}} {{role}}', {
        'task.title': '{{provider.credential}} $&',
        role: 'IMPLEMENTER',
      }),
    ).toBe('{{provider.credential}} $& IMPLEMENTER');
    expect(() => renderPrompt('{{task.title}}', { 'task.title': 'x'.repeat(100001) })).toThrow(
      'exceeds',
    );
  });
  it('treats blank values as unresolved', () => {
    expect(() => renderPrompt('{{task.description}}', { 'task.description': '' })).toThrow(
      'Unresolved prompt variable: task.description',
    );
    expect(() => renderPrompt('{{project.objective}}', { 'project.objective': '  ' })).toThrow(
      'Unresolved',
    );
  });
  it('builds render context without empty values', () => {
    expect(
      promptContext({
        task: { title: 'Cart', description: '', objective: null, acceptanceCriteria: [] },
        project: { name: 'Shop', contractObjective: null },
        phase: { objective: '  ' },
        role: 'IMPLEMENTER',
      }),
    ).toEqual({ 'task.title': 'Cart', 'project.name': 'Shop', role: 'IMPLEMENTER' });
    expect(
      promptContext({
        task: { title: 'Cart', acceptanceCriteria: ['Adds tax'] },
        project: { name: 'Shop', contractObjective: 'Sell' },
        phase: { objective: 'Checkout' },
        role: 'PLANNER',
      }),
    ).toMatchObject({
      'task.acceptanceCriteria': '["Adds tax"]',
      'project.objective': 'Sell',
      'phase.objective': 'Checkout',
    });
  });
  it('validates the existing role contract, rejecting incorrect and oversized output', () => {
    expect(validatePromptOutput('DOCUMENTATION', { summary: 'Docs', documents: [] })).toMatchObject(
      { summary: 'Docs' },
    );
    expect(() => validatePromptOutput('DOCUMENTATION', { summary: '' })).toThrow();
    expect(() => validatePromptOutput('PLANNER', { summary: 'Docs', documents: [] })).toThrow();
    expect(() => validatePromptOutput('DOCUMENTATION', { summary: 'x'.repeat(200001) })).toThrow();
  });
});
