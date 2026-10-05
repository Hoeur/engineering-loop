# Live Docker runtime gate

From the repository root, with a Linux Docker daemon running:

```sh
docker build --tag engloop-runtime-test:local apps/worker/test/docker-runtime
pnpm --filter @engloop/worker test:docker
```

This explicit opt-in gate is separate from the ordinary unit suite. Missing Docker,
an unavailable daemon, a missing image, or a failed containment assertion fails
the command; no prerequisite failure is converted to a skipped test.
`ENGLOOP_DOCKER_TEST_IMAGE` can select a prebuilt compatible image.

Fixtures use temporary real linked Git worktrees and the real `CommandRunner`.
The image contains Node, Git and `tail`; no provider CLI, credentials, login state
or external provider request is involved. The placeholder key exercises the
runtime contract only. Tests clean up their own containers and fixture paths.
They cover assigned mount boundaries, inaccessible host/repository/sibling paths,
symlink escapes, private Git metadata, create/start failure, cancel, release and
shutdown. This gate does not establish provider egress, disk quotas or orphan
recovery readiness.
