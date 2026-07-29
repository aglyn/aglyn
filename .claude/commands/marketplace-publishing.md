---
description: Continue the Marketplace publishing experience arc (AGL-1076..1081 + AGL-1008)
---

Continue the **Marketplace publishing experience** project in Linear
(`https://linear.app/aglyn/project/marketplace-publishing-experience-0ba745279db5`).
Read the project description first — it explains why these issues exist together.

Work the issues in Linear. Mark each **In Progress** when you start it and
**Done** when it lands. One conventional commit per AGL-###, committed with
`git commit --only <paths>` directly to `main`. Push when everything is
committed. Do **not** open a production PR unless I ask in that turn.

## Where this came from

AGL-969 shipped (in production): a six-item publisher attestation, enforced in
`publish-plugin` with a **428**, stored on the version doc as
`publisherAttestation` pinned to sha256, and shown to staff on the review page.
Putting it in front of publishing is what exposed everything below — the
checklist asks a publisher to confirm things the form never collects, in a
dialog that cannot tell a first publish from an update, with no way to watch
what happens next.

Verified working end to end: `Office Hours` (listing `ChiOYRKDeI`, private,
Aglyn LLC) was published through the real form and the review page shows
*"Stated by zachary.w.gover@gmail.com … against this version's exact bytes"*,
5/6 with the update-only changelog item correctly not asked. Its source is
`examples/plugins/office-hours/` — a kept, working example, no build step.

## Suggested order

1. **AGL-1076** — collect the repository URL at publish. Smallest fix, and it
   closes an attestation that currently has no subject. Do this first: it is
   the only one that makes an already-shipped claim honest.
2. **AGL-1077** — the publisher agreement. Nothing in the codebase has ever
   recorded acceptance of anything. Needs a drafted document (Drive, attorney-
   review banner, **not** the repo) before the code half is worth writing, so
   start it early even if it lands later.
3. **AGL-1078** — publish becomes a page at
   `/[orgSlug]/marketplace/publish/plugin`. Unblocks the next two.
4. **AGL-1080** — `MarkdownVisualEditor` for the README, real helper text for
   the changelog. Trivial once there is a page to put them on.
5. **AGL-1008** — the update path: "Publish new version" from the listing,
   pre-bound, so updating stops being something publishers have to infer.
6. **AGL-1079** — publisher-facing review status: version timeline, which
   version installs today vs which is newest, the rejection reason in place.
7. **AGL-1081** — spike only, and the default answer is *no*. Write the
   recommendation, don't build an importer.

## Things that will bite you

- **There is no Git integration and never was.** No Octokit, no
  `api.github.com`. `repositoryUrl` is a link a human clicks. Don't go looking
  for a half-built importer.
- **The console (`scope:app`) may not import `aglyn:addons`.** That is why the
  attestation model lives in `@aglyn/aglyn/app-utils/publisher-attestation` —
  both the console and `libs/plugins/community` can reach a core lib. Put
  anything else shared between the publish API and the console there too, not
  in the community plugin's model.
- **`nx test` leaks the root `.env`.** Run bare `npx jest --config <project
  jest.config.ts>`; `nx test` goes green on tests that fail under plain jest.
- **A clean `npm run typecheck` does not prove null safety** —
  `strictNullChecks` is off repo-wide. Re-run `npx tsc -p <project> --noEmit
  --strictNullChecks` and grep for your own symbols; ~1128 pre-existing errors
  are noise.
- **`nx-ci` has not run since 2026-07-06.** Build the console locally
  (`npx nx build console`) before promoting anything.
- **Verify with a negative control.** For any gate you add, break it
  deliberately and confirm the test fails. AGL-969's server specs were
  validated that way and it is the only reason they mean anything.
- **The dev server on :4200 runs against real Firebase (`aglyn-main`).**
  Publishing writes a real listing and an immutable bucket object. Publish
  **private** and say so.
- **Switching accounts staled the session** mid-work and every server read got
  denied — the console shows a "session needs refreshing" banner and I cannot
  fix it. If pages go empty, sign out and back in first.
- **File upload from the browser tools is sandboxed off.** To drive a file
  input, copy the file into `apps/console/public/` temporarily, `fetch` it from
  the page, and set `input.files` via `DataTransfer` + a bubbling `change`
  event. Delete the temp files afterwards, and check `git status` — something
  auto-stages untracked files.
- **`computer type` drops characters** on long strings. Set controlled inputs
  with the native value setter plus a bubbling `input` event instead.

## Standing rules

- Keep docs in sync in the **same** change — `apps/docs/docs/developers/plugins/`
  and `DOCS_HELP_TOPICS`; re-run `node tools/scripts/generate-docs-help.mjs`
  when you add or rename a heading.
- Never `--amend` on `main`; a concurrent session shares it.
- Never squash-merge.
- File new Linear issues as things surface, in this project.
