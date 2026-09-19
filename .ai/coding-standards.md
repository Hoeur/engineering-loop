# Coding standards

- TypeScript strict. `any` is an error; prefer `unknown` plus narrowing.
- Controllers translate HTTP. Services hold logic. Repositories are Prisma calls
  inside services.
- Prefer pure functions for decisions (see `decideEngineeringStep`) so they can
  be tested without mocks.
- Name things for what they mean in the domain: `reviewCycle`, not `count2`.
- Keep functions short enough to read without scrolling.
- Comment only where the reasoning is non-obvious — a race, a security
  constraint, a deliberate trade-off.
- Never widen a type to make an error go away; fix the shape.
- Use `satisfies` to keep literal inference while checking a shape.
