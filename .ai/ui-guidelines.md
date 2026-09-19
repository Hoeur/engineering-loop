# UI guidelines

## Feel

Clean, dense but readable, developer-focused. Strong information hierarchy,
subtle borders, no decorative gradients. Light mode is primary; dark mode is
fully supported through the same CSS-variable token set.

## Rules

- Every screen has loading, empty and error states. Use `QueryBoundary`.
- Status colour is semantic and centralised in `lib/status.ts`.
- Tables use `DataTable`: real table from `md` up, stacked cards below.
- Nothing scrolls horizontally at 375px. Wide content scrolls inside its own
  container.
- Numeric columns use `tabular-nums` and a monospace face.
- Interactive targets are at least 32px tall.
- Every icon-only control has an `aria-label`.

## Breakpoints tested

1440, 1024, 768, 430, 390, 375.
