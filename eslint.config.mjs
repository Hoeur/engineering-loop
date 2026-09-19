import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: [
      '**/node_modules/**',
      '**/dist/**',
      '**/.next/**',
      '**/coverage/**',
      '**/generated/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '.run/**',
      '**/*.d.ts',
      'workspace/**',
      // The worker clones the repositories agents work on here (WORKSPACE_ROOT=./workspace).
      'apps/*/workspace/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { ...globals.node, ...globals.es2023 },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': [
        'warn',
        { prefer: 'type-imports', fixStyle: 'inline-type-imports' },
      ],
      '@typescript-eslint/no-empty-object-type': 'off',
      'no-console': ['error', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
    },
  },
  {
    files: ['**/*.spec.ts', '**/*.test.ts', '**/*.e2e-spec.ts', 'packages/testing/**'],
    rules: { '@typescript-eslint/no-explicit-any': 'off', 'no-console': 'off' },
  },
  {
    files: ['scripts/**', '**/seed.ts', '**/*.mjs', '**/*.config.*'],
    rules: { 'no-console': 'off', '@typescript-eslint/no-require-imports': 'off' },
  },
  {
    // NestJS resolves constructor dependencies from `design:paramtypes`, which
    // TypeScript only emits for imports that survive to runtime. A type-only
    // import of an injected class silently degrades the metadata to `Object`
    // and the container then fails with "Nest can't resolve dependencies".
    // The rule cannot tell the two cases apart, so it is off for the API.
    files: ['apps/api/**/*.ts'],
    rules: { '@typescript-eslint/consistent-type-imports': 'off' },
  },
  {
    files: ['apps/web/**'],
    languageOptions: { globals: { ...globals.browser, ...globals.node } },
  },
  prettier,
);
