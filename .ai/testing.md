# Testing

## Layers

| Layer          | Tool                     | What it proves                                          |
| -------------- | ------------------------ | ------------------------------------------------------- |
| Domain units   | Vitest                   | State machine, workflow routing, schemas, runner safety |
| API contract   | Vitest + Supertest       | The response envelope and error codes                   |
| Frontend units | Vitest + Testing Library | States, responsive table, formatters                    |
| End-to-end     | Playwright               | Navigation and no horizontal overflow at six widths     |

## Rules

- A behaviour worth a bug report is worth a test.
- Test the decision, not the plumbing: `decideEngineeringStep` is tested directly
  because it is where the loop's safety lives.
- Prove the negative: illegal transitions, disallowed commands, approvals with
  open blocking findings.
- Never assert on a hardcoded timestamp or a random id.

## Commands

```bash
pnpm test              # all suites
pnpm test:e2e          # Playwright (needs a running web app)
pnpm --filter @engloop/workflow test
```
