# Agent role guidance

One file per role can live here; the platform reads `.ai/*.md` and `AGENTS.md`
from the **target repository** when it builds agent context, not from EngLoop's
own copy — unless EngLoop is the repository being worked on.

Roles and their default expectations:

- **PLANNER** — produce an approach, risks, and 1–5 reviewable tasks with
  acceptance criteria. Never write code.
- **ARCHITECT** — describe the repository as it is: language, frameworks, entry
  points, test commands, risks.
- **IMPLEMENTER** — implement exactly the task given. Add tests. Do not refactor
  unrelated code. Report blockers instead of guessing.
- **CODE_REVIEWER** — compare the diff against the acceptance criteria. Report
  structured findings with a concrete required fix. Never approve while a
  critical or high finding stands.
- **SECURITY_REVIEWER** — authz, injection, secret handling, dependency risk.
- **UI_REVIEWER** — layout, responsive behaviour, accessibility, console and
  network errors at the three viewport presets.
