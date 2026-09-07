# Backfills, migrations and seeds

`tools/scripts` holds 158 scripts. Around 130 of them are named by
`package.json`, a workflow or `tools/gate.sh`, so what they are for is
answered by what runs them. The 39 shaped as one-shots — `backfill-*`,
`migrate-*`, `seed-*`, `bootstrap-*` — are not, and exactly one
(`seed-e2e.mjs`, as `npm run seed:e2e`) is wired to anything at all.

**Nothing runs these, and that is not the same as nothing needing them.**
Several are the only tool that closes a gap the live path leaves open; a few
have already converged and would report a zero; one refuses to run and is
right to. Without somewhere to say which is which, the only way to find out
is to read 400 lines of a script and then go and check its target against the
codebase — per script, every time somebody wonders. This file is that answer,
so the next reader inherits it.

Each script documents itself properly in its own header; this is the index,
not a replacement. Two of them are large enough to have earned their own
page: [`COMMERCE_BACKFILLS.md`](COMMERCE_BACKFILLS.md) and
[`CRM_LIFECYCLE_BACKFILL.md`](CRM_LIFECYCLE_BACKFILL.md).

## The lifecycle, and why this list should shrink

A one-shot is finished when its dry run reports a zero, and a finished one-shot
is **deleted by the commit that confirms it**:

    write  →  run  →  dry run reports zero  →  delete, same commit

Kept past that point it is not documentation, it is a file the next reader has
to re-derive the status of. Git holds it, and this index holds what it did.

⚠️ A zero is only evidence when the script can still FIND input. A zero from a
script whose source collection is retired proves nothing, which is why the
table below says what each one scanned rather than only what it would change.

⛔ Moving these into a subdirectory is not the fix. Every row here that is not
converged is an open gap in production data, and a tidier listing would hide
the queue rather than drain it.

## How to read a row

| State | Means |
| --- | --- |
| **Outstanding** | The corpus still holds records it would fix. Running it does work. |
| **Converged** | The live path now writes what it filled, or it has already run. Expect a zero — which is worth having, because a zero from a script that can still find input is evidence, where a zero from a script that cannot is a blindfold. |
| **Repeatable** | A seeder or reconciler with no end state. Run it whenever the question comes up. |
| **Blocked** | It refuses `--apply` until a precondition it reads out of the tree is met. The refusal is the feature. |

Almost all of them are dry run by default and idempotent; the table calls out
only the ones where that is not the whole story. The flag is usually
`--apply`, sometimes `--commit` or `--write` — the header of each says which,
and an unrecognized argument exits 2 having written nothing.

## Seeds and fixtures

Every one is repeatable by construction, and none is a migration. Zero
automation references is the expected state for all of them.

| Script | What to know |
| --- | --- |
| `seed-e2e.mjs` | `npm run seed:e2e`. The local authenticated e2e corpus — [`E2E_LOCAL.md`](E2E_LOCAL.md). The only one of the 39 with a wiring. |
| `seed-demo-org.mjs` | One org, one host per brand pack. [`DEMO_DATA.md`](DEMO_DATA.md). Refuses a non-emulator run without `--create-hosts`, because a direct host write goes around the plan's site quota. It is also step one of the canary fix in [`UPTIME_AND_SLA.md`](UPTIME_AND_SLA.md), and the order there matters. |
| `seed-demo-host.mjs` | One host from one brand pack. ⛔ Never against `demo` in production (AGL-1617): the prune only removes `seed-` ids, that host has none, so the run merges a competing home screen over live fixtures and removes nothing. |
| `seed-scope-fixture.mjs` | The `visibleTo` fixture set, in every state including absent. Emulator only — it refuses without both `FIRESTORE_EMULATOR_HOST` and `FIREBASE_AUTH_EMULATOR_HOST`. Deliberately exempt from the "seeds stamp scope" rule, since unstamped documents are the point. |
| `seed-approved-image-hosts.mjs` | Harvests the image hosts a site already loads into `approvedImageHosts`. Report-only unless `--write`, and the merge is additive. A reconciler, not a one-shot: sites keep accumulating hotlinks. |
| `seed-marketing-screens.mjs` | Creates whichever aglyn.com marketing screens are missing. Converged in practice — a dry run reports that they all exist. Checks slug, prior slugs and display name before creating, so a screen whose slug moved is not duplicated. |
| `seed-changelog.mjs` | Repeatable, but the 12 entries are an editorial snapshot ending in July 2026. Against production it merges that snapshot over the live changelog. Emulator-safe; content-stale otherwise. |

## Provisioning

| Script | State | What to know |
| --- | --- | --- |
| `bootstrap-platform.mjs` | Repeatable | Four independent sections, each skipped when its credential is absent — [`PLATFORM_PROVISIONING.md`](PLATFORM_PROVISIONING.md). It does **not** converge bucket CORS or the App Check allowlist; both are applied by hand afterwards ([`STORAGE_MANUAL_CONFIG.md`](STORAGE_MANUAL_CONFIG.md)). |

## Org, billing and identity

| Script | State | What to know |
| --- | --- | --- |
| `backfill-host-memberships.mjs` | Repeatable | The `users/{uid}/hostMemberships` projection. The runtime fan-out keeps it in step on every membership change; this is the bulk repair path beside it. |
| `backfill-stripe-org-identity.mjs` | Repeatable | Stamps the org onto the Stripe customer. Reads Firestore, writes only Stripe. The webhook self-heals active orgs; this covers cancelled and annual ones. A console spec executes this file and diffs its parameters against the TypeScript original, so it cannot drift. |
| `backfill-org-billing.mjs` | ⚠️ Outstanding | The `--seed-empty` half is safe and idempotent. The **copy** half merges any inline `subscription` on the org document into `billing/stripe` — and the inline copy is no longer maintained, so where one survives it is stale and copying it can overwrite a current subscription with an older one. Establish which orgs still carry inline fields (`drop-inline-org-billing.mjs`, dry run) before applying. |
| `migrate-enterprise-plan.mjs` | ⚠️ Outstanding | Sets `plan: 'enterprise'` and writes an audit row. Its refusal on a dead subscription reads `subscription.status` off the **org document**, where that field no longer lives, so the status resolves to null and the refusal passes vacuously on a cancelled org. Confirm the subscription by hand until that guard reads `orgs/{id}/billing/stripe`. Named by two specs as the only writer of `orgs.enterprise` in the product. |
| `backfill-platform-revenue.mjs` | Outstanding | The invoices that settled before the revenue mirror existed. Feeds `/admin/revenue` and the Texas return, so it derives every figure with the same function the webhook uses, stops rather than inferring a tax split, and writes with `create()` — it structurally cannot modify an existing revenue row. |
| `backfill-site-user-accounts.mjs` | Outstanding | Grandfathers the sites already using member accounts into the per-site opt-in. **Deploy order:** run it with `--commit`, then promote — otherwise the day the gate ships is the day every live members-only site loses `/signin`. Plans, guards and re-reads in three phases. |
| `backfill-reconstructed-activity.mjs` | Outstanding | Rebuilds the activity entries three template surfaces never wrote. Attributes an actor only where the host has exactly one member, and marks every such row inferred. [`PLATFORM_PROVISIONING.md`](PLATFORM_PROVISIONING.md). |
| `backfill-subdomain-redirects.mjs` | Repeatable | Upserts the platform-subdomain edge redirect for hosts that attached a domain before the attach route registered one. Carries the same serving check the attach route applies, so it does not register a redirect at a domain that no longer answers. |

## CRM, consent and email

| Script | State | What to know |
| --- | --- | --- |
| `backfill-consent-host.mjs` | ⚑ Outstanding | **Do not remove.** `marketing-consent.ts` and `scope-tokens.ts` both name this file as the migration that scopes an unscoped grant, and strict consent depends on it having run. Moves each basis to the host that captured it, and reports rather than guesses where no host can be derived. |
| `backfill-marketing-consent.mjs` | Outstanding, stage one | Asserts an operator basis over the pre-release corpus and stamps provenance, so a backfilled grant stays distinguishable from one a person gave. It writes the **unscoped** field, which grants to no host on its own — `backfill-consent-host.mjs` is stage two and scopes it. Never touches a stored refusal. `test:deploy-args` reads this file to prove it parses its own arguments. |
| `backfill-crm-lifecycle-stages.mjs` | Outstanding | Stages, historical leads and company counts — [`CRM_LIFECYCLE_BACKFILL.md`](CRM_LIFECYCLE_BACKFILL.md), which records the production dry runs. The apply has not been made. Guarded by `test:crm-lifecycle-backfill`. |
| `backfill-form-ids.mjs` | Outstanding | Stamps `formId` onto the submissions an adopted form already collected, matching on the `(formName, path)` pair and leaving anything ambiguous alone. The lifecycle backfill's form attribution reads what this stamps. |
| `backfill-list-member-keys.mjs` | Outstanding | Reconciles the two derivations of a list-member id. It never deletes a membership, so a split person's list count stays inflated until a separate, deliberate cleanup — that trade is the design, not an oversight. |
| `backfill-email-created-at.mjs` | Outstanding | `createdAtMs` on campaigns that predate the stamp, derived from the earliest later date on the record and marked as an estimate. **Not yet run in production.** The console reads correctly either way; server-side `orderBy('createdAtMs')` is what waits on it. |
| `backfills/` (4 scripts) | Outstanding | The commerce money-record repairs — [`COMMERCE_BACKFILLS.md`](COMMERCE_BACKFILLS.md). Dry run recorded, nothing applied. Run order is 1745 → 1752 → 1753. Guarded by `test:backfill-core`. |

## Media

| Script | State | What to know |
| --- | --- | --- |
| `backfill-media-variants.mjs` | ⚠️ Outstanding | Generates the WebP variants an asset advertises. It reads the source width from `dimensions.width`, which media documents do not carry — they store `width` at the top level — so the source width is always absent and the documented "an 800px logo is skipped, not upscaled" rule never fires. Nothing is upscaled in fact, but it writes more objects than it reports and labels them with widths the source never had. |

## Besigner and canvas

| Script | State | What to know |
| --- | --- | --- |
| `backfill-node-interactions.mjs` | Outstanding | Moves element-scoped actions onto their nodes. `interactions-provider` states in code that a legacy action row keeps working and stays editable **until this backfill moves it**, so this is genuinely unfinished work rather than a converged migration. The only one here that soft-deletes its source, and it has no self-test. |
| `backfill-node-plugin-ids.mjs` | Outstanding | Rewrites the `pluginId` copied onto a node at insert time after a bundle move. A stale value costs a first-paint round trip, never correctness. A forms spec parses this script's own table and diffs it against the live registries. |
| `backfill-scheme-dark.mjs` | Outstanding | Generates the dark-scheme `sx` slices. Slices are recomputed from the light base every run, so it self-corrects. ⚠️ `--open-gate` is the flag to be careful with: it is host-wide and publishes dark mode across every page at once. Same coverage set as the icon backfill. |
| `backfill-theme-history.mjs` | **Blocked** | Moves the theme undo buffer into a subcollection. Two preconditions, both read out of the tree: the rules must deny clients the new collection (satisfied), and the revert action must read the new location (**not** satisfied — it still reads the host field, and the marker this leaves has no reader). It refuses `--apply` until both hold. Do not work around the refusal: the buffer it relocates is the theme a site was wearing before the swap. |

## Plugins and marketplace

| Script | State | What to know |
| --- | --- | --- |
| `backfill-install-counts.mjs` | Repeatable | Reconciles listing and version install counts from the pins. Not a one-shot: the request path only heals a listing somebody opens, so unvisited listings drift indefinitely. Run `audit-install-counters.mjs` either side of it. |
| `backfill-plugin-id-crm.mjs` | Converged | The `contacts` → `crm` plugin-id rename. Its header records that it ran against the live project and found zero documents, and the alias it unblocked has since been retired. Kept deliberately: it is the shape the next plugin-id rename copies, and the way to re-check that zero. |

## What was removed, and the standard for removing more

Four scripts were deleted under AGL-2670. Each had zero automation references
— but so does almost everything above, so that was the reason to look, never
the reason to delete. The standard is the one AGL-1839 set when it deleted
`backfill-contacts.mjs`: **a script goes only when running it could not do
the work it claims.** Each commit carries the evidence.

- `backfill-orgs.mjs` and `migrate-org-data.mjs` — both read a schema
  AGL-238/445/446 retired, so neither can find input again. The first still
  rewrote `hostIndex` and the `memberRoles` projection from a rule that
  predates scope tokens; the second wrote documents with no `visibleTo`,
  which every reader fails closed on.
- `migrate-binding-tokens.mjs` — recursed only into plain objects, so it was
  structurally blind to the compressed node trees that are the majority of
  its corpus, and reported a clean zero for them. The publish-time rewrite
  replaced it and is storage-form aware.
- `migrate-blog-covers.mjs` — wrote a media URL where the live picker writes
  a `media:` reference, which is the direction stored covers were migrated
  in, not out of.

They are not archived to a subtree. Git carries them, an archived `.mjs`
under `tools/` is still discovered by the guards that walk that tree, and
"never run this" held by a README is a convention where a deletion is a fact.

**Adding one:** give it a header saying what it writes and what it refuses to
guess, make it dry run by default, and add a row above. A script whose target
the live path now writes is converged, not dead — say so in the row, because
the next reader's first question is whether the zero it reports is evidence
or a blindfold.
