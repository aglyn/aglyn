/**
 * @license
 * Copyright 2026 Aglyn LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *   http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { execFileSync } from 'child_process'
import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Self-host ratchet: Aglyn's own hostnames may not appear in runtime code
 * except where it is written down WHY (AGL-2195).
 *
 * Zach's rule: *"the self hosted owner should not have to edit the source to
 * update aglyn branded items urls or personal identification items, should
 * move these to env vars"*. `NEXT_PUBLIC_TENANT_DOMAIN` and
 * `NEXT_PUBLIC_WORKSPACE_DOMAIN` exist and are honoured by `TENANT_APEX` and
 * `WORKSPACE_DOMAIN` — and were then ignored by four surfaces that re-derived
 * the apex by hand, including the JSON-LD a published site emits. A
 * self-hoster who set the variable got a deployment that honoured it in the
 * revalidation path and printed OUR apex into their sites' structured data.
 *
 * ## Why an exact count per file rather than a file allowlist
 *
 * A file allowlist is satisfiable by adding a new hard-coding to a file that
 * is already listed — which is precisely how the fourth copy of the apex got
 * in. The count is the guard. It is meant to be brittle: changing it is a
 * decision, and the reason string is where the decision is recorded.
 *
 * ## What it reads, and what it deliberately cannot see
 *
 * Enumerated from `git ls-files`, never a filesystem walk (AGL-2116): a walk
 * sweeps `.next/` and `dist/`, which inline every constant and would report a
 * different repo depending on whether the reader had built. Comments are
 * stripped first, so the docblocks explaining these decisions — this one
 * included — cannot themselves trip it. Stripping `//` inside a string
 * literal can HIDE a match but never invent one, so the guard errs strict.
 *
 * Out of scope on purpose:
 *  - `*.spec.*` / `specs/` — fixtures naming our hosts are fixtures.
 *  - `assist-docs-index.generated.ts` — a build artefact of `apps/docs`, whose
 *    prose is Aglyn's own documentation and is regenerated, not edited.
 *  - `apps/docs/**`, `*.md`, `.env*.example`, `constants/legal/**` — prose and
 *    published legal snapshots, which are Aglyn's own by construction
 *    (`feedback_legal_snapshots_are_publication_first`).
 */
const REPO_ROOT = resolve(__dirname, '../../../../..')

/** Word-bounded so `this.store.aglyn.components` is not an `aglyn.com`. */
const AGLYN_HOST = /aglyn\.(app|com|io)\b/g

const SOURCE = /\.(ts|tsx|js|jsx|mjs|cjs)$/
const NOT_A_TEST = /\.spec\.|\.e2e\.|\.test\.|\/specs\//
const GENERATED = /assist-docs-index\.generated\./

/**
 * Comments removed, so the prose explaining a decision cannot pass for the
 * decision.
 *
 * The line-comment pass refuses to fire on `://`, and that clause is the whole
 * guard. Written the obvious way — `/\/\/.*$/gm` — it ate the scheme separator
 * of every URL literal, so `` `https://${host.subdomain}.aglyn.app` `` stripped
 * down to `` `https: `` and the hardest-hitting hard-coding in the repo was
 * invisible. Verified by reverting the AGL-2195 fix in a scratch worktree and
 * watching this stay GREEN; a guard that cannot see a URL is a guard that
 * certifies its absence.
 *
 * Erring the other way is safe: a `//` inside a string that is NOT a URL now
 * survives, which can only add matches, never remove them.
 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1 ')
}

/**
 * Every remaining occurrence, with the reason it is allowed to stay.
 *
 * `count` is the number of surviving occurrences after comments are stripped.
 * A reason of the form "…must be fixed…" is a debt marker, not an approval:
 * it names the issue that will remove it.
 */
const ALLOWED: Array<{ file: string; count: number; reason: string }> = [
  {
    file: 'libs/tenant/data/admin/src/lib/server/upload-cors-reconcile.ts',
    count: 1,
    reason:
      "AGL-1452. The upload-CORS reconcile. The literal is the PLATFORM's own console origin, held as the one entry the reconcile refuses to release on detach — a self-host operator's bucket needs their own origin, which is derived from their Vercel project, not this constant. Removing it would let a detach withdraw the platform's own permission to upload.",
  },
  {
    file: 'tools/scripts/check-upload-cors.mjs',
    count: 1,
    reason:
      'AGL-1452. The daily upload-CORS drift checker. The literal is the default project fallback for a build tool that is never shipped; a self-host operator runs it against their own project id.',
  },
  {
    file: 'apps/console/utils/stripe-dunning-schedule.ts',
    count: 1,
    reason:
      'AGL-2430. A documentation constant recording the exact URL a human pastes into the LIVE Stripe Dashboard so card-failure emails reach a page where the card can be changed. Grepped for importers: there are none — it never executes, and a self-host operator resolves nothing from it. It names `app.` deliberately, not the apex, which is the fact being recorded.',
  },
  {
    file: 'tools/scripts/check-external-facts.mjs',
    count: 6,
    reason:
      'AGL-2193. The daily external-fact checker. Its hostnames are the checker\'s OWN self-test fixtures — including deliberate negative controls such as `aglyn.com.evil.net` that must NOT match. A build tool, never shipped, and the literals are the test data.',
  },
  {
    file: 'tools/scripts/stripe-connect-reversal-drill.mjs',
    count: 1,
    reason:
      'AGL-1956. `business_profile[url]` on a TEST-MODE Stripe drill account. A drill script, never shipped and never run against live.',
  },
  {
    file: 'apps/console/app/(app)/[orgSlug]/marketplace/[listingId]/listing-social-card.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_CONSOLE_URL; the literal is its default.',
  },
  {
    file: 'apps/console/app/(app)/[orgSlug]/settings/page.tsx',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_WORKSPACE_DOMAIN with the same default.',
  },
  {
    file: 'apps/console/app/api/_lib/auth-action-url.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_CONSOLE_URL; the literal is its default.',
  },
  {
    file: 'apps/console/app/api/_lib/render-system-email.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_CONSOLE_URL; the literal is its default.',
  },
  {
    file: 'apps/console/app/api/_lib/security-alerts.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_CONSOLE_URL; the literal is its default.',
  },
  {
    file: 'apps/console/app/api/_lib/success-manager.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_CONSOLE_URL; the literal is its default.',
  },
  {
    file: 'apps/console/app/api/_lib/usage-alert-email.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_CONSOLE_URL; the literal is its default.',
  },
  {
    file: 'apps/console/app/api/admin/email-health/route.ts',
    count: 1,
    reason:
      'EXPECTED_FROM_DOMAIN derives from operatorIdentity().supportEmail; the literal is the not-yet-configured fallback.',
  },
  {
    file: 'apps/console/app/api/admin/enterprise-billing/route.ts',
    count: 1,
    reason:
      'Request origin, then NEXT_PUBLIC_APP_URL, then the literal — a third-order fallback.',
  },
  {
    file: 'apps/console/app/api/auth/activity/route.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_WORKSPACE_DOMAIN with the same default.',
  },
  {
    file: 'apps/console/app/api/errors/route.ts',
    count: 2,
    reason:
      'DOCS_ORIGIN reads NEXT_PUBLIC_AGLYN_DOCS_URL / NEXT_PUBLIC_DOCS_ORIGIN; the second literal is the malformed-value fallback.',
  },
  {
    file: 'apps/console/app/api/health/billing/route.ts',
    count: 1,
    reason:
      'Reader of STRIPE_WEBHOOK_URL; the literal is its default.',
  },
  {
    file: 'apps/console/app/layout.tsx',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_CONSOLE_URL; the literal is its default.',
  },
  {
    file: 'apps/console/components/create-org-dialog.component.tsx',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_WORKSPACE_DOMAIN with the same default.',
  },
  {
    file: 'apps/console/components/editor-hint-cookie.component.tsx',
    count: 2,
    reason:
      'AGL-2197 — `aglyn.io` stays as an Aglyn alias apex, included ONLY while WORKSPACE_DOMAIN is still ours.',
  },
  {
    file: 'apps/console/components/org-switcher-nav.component.tsx',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_WORKSPACE_DOMAIN with the same default.',
  },
  {
    file: 'apps/console/constants/cookie-inventory.ts',
    count: 3,
    reason:
      'Reader of NEXT_PUBLIC_CONSOLE_URL, NEXT_PUBLIC_WORKSPACE_DOMAIN and NEXT_PUBLIC_TENANT_DOMAIN; the three literals are their defaults. This registry feeds the Cookie Policy, so a self-hosted deployment must be able to name its OWN surfaces rather than publish a compliance document naming Aglyn hosts (AGL-2412).',
  },
  {
    file: 'apps/console/constants/docs-links.ts',
    count: 1,
    reason:
      'DOCS_BASE_URL — the ONE reader of NEXT_PUBLIC_DOCS_ORIGIN (and the ' +
      'legacy NEXT_PUBLIC_AGLYN_DOCS_URL); the literal is its default. ' +
      'Assist citations re-export it rather than reading again (AGL-2014).',
  },
  {
    file: 'apps/console/constants/workspace-domain.ts',
    count: 1,
    reason:
      'WORKSPACE_DOMAIN — the console reader of NEXT_PUBLIC_WORKSPACE_DOMAIN.',
  },
  {
    file: 'apps/console/utils/auth-delegation.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_WORKSPACE_DOMAIN with the same default.',
  },
  {
    file: 'apps/console/utils/server/org-lockdown.ts',
    count: 1,
    reason:
      'Server-side reader of NEXT_PUBLIC_TENANT_DOMAIN, same default.',
  },
  {
    file: 'apps/console/utils/tenant-dns.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME; the literal is its default.',
  },
  {
    file: 'apps/docs/docusaurus.config.ts',
    count: 1,
    reason:
      'Reader of DOCS_URL; the literal is its default (a docs build, not runtime).',
  },
  {
    file: 'apps/tenant/app/[host]/[[...slug]]/site-analytics.tsx',
    count: 1,
    reason:
      'AGL-1731. CONSOLE_ORIGIN — reader of NEXT_PUBLIC_CONSOLE_URL, the same ' +
      'variable and the same default as the three other tenant-runtime ' +
      'readers, and documented as such under `NEXT_PUBLIC_CONSOLE_URL` in ' +
      'apps/docs/docs/developers/self-hosting.md. It is the campaign-hop ' +
      'ALLOWLIST, not a destination: the one origin whose links get a ' +
      '`utm_*` put on them, so widening it is what would leak. ' +
      '`campaign-forwarding.ts` itself writes no host and invents no default ' +
      "— it normalises the caller's origin and returns a no-op uninstaller " +
      'when that yields nothing, so an operator who configures the variable ' +
      'to their own console never reaches this literal, and one who sets it ' +
      'empty gets forwarding switched off rather than links decorated toward ' +
      'us. Landed unlisted in 9e1ade2fc, which left this ratchet red on main.',
  },
  {
    file: 'apps/tenant/app/[host]/admin-bar/admin-bar-slot.tsx',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_CONSOLE_URL; the literal is its default.',
  },
  {
    file: 'apps/tenant/app/api/edit-context/route.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_CONSOLE_URL; the literal is its default.',
  },
  {
    file: 'apps/tenant/app/api/edit-hint/set/route.ts',
    count: 2,
    reason:
      'consoleReturnAllowlist prefers NEXT_PUBLIC_CONSOLE_URL and falls back to our two console origins ONLY when nothing is configured (AGL-2016).',
  },
  {
    file: 'apps/tenant/middleware.ts',
    count: 10,
    reason:
      'Vercel-only host routing gated on IS_VERCEL, plus the NEXT_PUBLIC_CONSOLE_URL default. The edge bundle cannot import TENANT_APEX; a self-host serves its apex through the AGLYN_TENANT_HOST_CNAME branch above it. Widening that to a wildcard is AGL-2202.',
  },
  {
    file: 'libs/aglyn/src/lib/app-utils/docs-help.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_DOCS_ORIGIN; the literal is its default.',
  },
  {
    file: 'libs/shared/util/email/src/lib/email-media-src.ts',
    count: 1,
    reason:
      "The email mirror of TENANT_APEX. `shared-util-email` is tagged scope:shared and cannot import @aglyn/aglyn, so the copy is structural; apps/console/specs/email-media-src-drift.spec.ts holds the two to the same answer, including under a configured apex.",
  },
  {
    file: 'libs/aglyn/src/lib/app-utils/host-naming.ts',
    count: 1,
    reason:
      'TENANT_APEX — the one reader of NEXT_PUBLIC_TENANT_DOMAIN; the literal is its default.',
  },
  {
    file: 'libs/aglyn/src/lib/app-utils/media-ref.ts',
    count: 3,
    reason:
      'First-party media hosts. NOT a bare list: `operatorFirstPartyApexes()` merges the operator TENANT_APEX, console host and workspace domain into it, so an operator\'s own hosts are first-party too. This is the pattern the others should copy.',
  },
  {
    file: 'libs/aglyn/src/lib/app-utils/platform-brand.ts',
    count: 2,
    reason:
      'PLATFORM_SUPPORT_URL — last fallback after the operator support ' +
      'address. Plus PLATFORM_HOME_URL, the badge destination, whose literal ' +
      'is reached ONLY when `isAglynOperatedBrand()` — a renamed self-host ' +
      'deployment resolves it to null and gets an unlinked badge rather than ' +
      'a link advertising us on its own customers\' sites.',
  },
  {
    file: 'libs/aglyn/src/lib/app-utils/published-legal-pages.ts',
    count: 1,
    reason:
      'LEGAL_ORIGIN — the one reader of NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN. ' +
      "The console's constants/shared.ts imports this rather than reading " +
      'the variable a second time (AGL-2014).',
  },
  {
    file: 'libs/aglyn/src/lib/foundation/constants/_internal.ts',
    count: 1,
    reason:
      'The startup banner Apache-2.0 authorship line, which points at the software itself rather than at the operator. Deliberate — the support line beside it IS operator-driven.',
  },
  {
    file: 'libs/besigner/feature/designer/src/lib/utils/docs-help.ts',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_DOCS_ORIGIN; the literal is its default.',
  },
  {
    file: 'libs/shared/util/email/src/lib/system-email-catalog.ts',
    count: 2,
    reason:
      'The SAMPLE_CONSOLE_ORIGIN / SAMPLE_SUPPORT_URL defaults for the staff email-designer preview. The ten literal samples now build on them (AGL-2202).',
  },
  {
    file: 'libs/shared/util/next/src/lib/use-continue-url.ts',
    count: 1,
    reason:
      'Shared-lib reader of NEXT_PUBLIC_WORKSPACE_DOMAIN; cannot import the console constant.',
  },
  {
    file: 'libs/tenant/data/admin/src/lib/server/platform-domain-names.ts',
    count: 3,
    reason:
      'RESERVED_DOMAIN_SUFFIXES — a BLOCKLIST of names nobody may claim as a custom console or site domain. Naming our own there is correct in both deployment shapes, and the SELF-HOST apex is covered separately by reading TENANT_APEX at call time rather than by adding it here (AGL-1430). Moved out of console-domains.ts so both domain surfaces read one list.',
  },
  {
    file: 'libs/tenant/data/admin/src/lib/server/workspace-domains.ts',
    count: 1,
    reason:
      'The server-side twin of WORKSPACE_DOMAIN — same env, same default.',
  },
  {
    file: 'tools/deploy/verify-production-aliases.mjs',
    count: 4,
    reason:
      'Verifies Aglyn own Vercel aliases after a promotion. Meaningless anywhere else and never shipped.',
  },
  {
    file: 'tools/e2e/starter-root-wire.mjs',
    count: 1,
    reason:
      'An e2e assertion message naming the host the tenant must NOT redirect to.',
  },
  {
    file: 'tools/lint-rules/no-remote-image-service.mjs',
    count: 2,
    reason:
      'A lint rule\'s first-party host list. Build-time only, never shipped, and additive.',
  },
  {
    file: 'tools/plugin-loader/origin/api/load.mjs',
    count: 3,
    reason:
      'The CONSOLE_ORIGIN / TENANT_APEX defaults, which PLUGIN_LOADER_CONSOLE_URL and PLUGIN_LOADER_TENANT_DOMAIN override (AGL-2196).',
  },
  {
    file: 'tools/scripts/backfill-subdomain-redirects.mjs',
    count: 1,
    reason:
      'Reader of AGLYN_TENANT_APEX; the literal is its default.',
  },
  {
    file: 'tools/scripts/check-contact-addresses.mjs',
    count: 3,
    reason:
      "AGL-2400. The contact-address guard's own output: two verdict strings " +
      'naming the domain it swept, and the Groups admin URL ' +
      '(`groups.google.com/a/aglyn.com/g/<name>/members`) printed in the ' +
      'remediation hint, which is an instruction to a human, not a fetch. ' +
      'The script makes NO network call of any kind — deliberately, so it ' +
      'needs no credential — so it cannot reach our infrastructure from ' +
      "anyone's deployment, which is the AGL-2124 failure this ratchet " +
      'exists to prevent. Internal CI guard over this repo\'s tracked files; ' +
      'a self-hoster never runs it. Landed unlisted in 94b6a011c, which left ' +
      'this ratchet red on main.',
  },
  {
    file: 'tools/scripts/check-legal-index-dates.mjs',
    count: 1,
    reason:
      'Reader of NEXT_PUBLIC_OPERATOR_LEGAL_ORIGIN; the literal is its ' +
      'default. Internal tool — a self-hoster runs it against their own ' +
      'origin.',
  },
  {
    file: 'tools/scripts/check-week-one-preflight.mjs',
    count: 12,
    reason:
      "Aglyn's own launch-week pre-flight (AGL-1617). Never shipped and never imported by an app: it reads OUR Drive folder, OUR five live legal pages and the five demo hosts by name, because the thing it checks IS our launch. A self-hoster has no use for it, so there is nothing here to make configurable. Landed unlisted in 3247f379b, which left this ratchet red on main until AGL-1617 added this entry.",
  },
  {
    file: 'tools/scripts/check-retired-colours.mjs',
    count: 1,
    reason:
      'Reader of a base-URL argument; the literal is its default. Internal tool.',
  },
  {
    file: 'tools/scripts/generate-blog-covers.mjs',
    count: 1,
    reason:
      'Renders Aglyn own marketing blog covers. Internal tool.',
  },
  {
    file: 'tools/scripts/legal-doc-diff.mjs',
    count: 1,
    reason:
      'A path inside Aglyn own Google shared drive, plus our legal origin. Internal tool.',
  },
  {
    file: 'tools/scripts/check-pricing-drift.mjs',
    count: 1,
    reason:
      'The mount path of Aglyn own Google shared drive, where the pricing source-of-truth doc lives. Internal tool, and the leg that reads it is skipped entirely when the drive is not mounted (AGL-1885).',
  },
  {
    file: 'tools/scripts/lib/contact-addresses.mjs',
    count: 22,
    reason:
      'AGL-2400. The registry of which @aglyn.com addresses are provisioned ' +
      'to RECEIVE mail: sixteen intake addresses, one sender, and five ' +
      'inside the `UNVERIFIED_PROVISIONING` provenance rows (one of which ' +
      'is `docs.aglyn.com/trust`, naming the page that publishes `help@`). ' +
      'These literals are the SUBJECT of the comparison, not a destination — ' +
      'the file constructs no URL, makes no network call, and is imported ' +
      'only by check-contact-addresses.mjs and its node:test suite. Nothing ' +
      'here is configurable because there is nothing to configure: the list ' +
      "answers 'which addresses has Aglyn provisioned', so parameterising it " +
      'would empty it of meaning. A self-hoster who forks and wants the same ' +
      'guard over their own addresses replaces the list, exactly as with ' +
      'lib/uptime-targets.mjs. ' +
      "⚠️ The sweep's own domain is hardcoded a 23rd time in `ADDRESS_RE`, " +
      'which this ratchet cannot see: the source reads `aglyn\\.com` and the ' +
      "backslash defeats AGLYN_HOST's literal dot. Recorded so a future " +
      'reader is not misled into thinking 22 is the whole story. Landed ' +
      'unlisted in 94b6a011c, which left this ratchet red on main.',
  },
  {
    file: 'tools/scripts/lib/firewall-posture.mjs',
    count: 1,
    reason:
      "One `serves` label — 'every customer site on *.aglyn.app and their custom domains' — naming which Aglyn-operated Vercel project a posture row is about. Internal ops tool: it asserts the WAF configuration of Aglyn's OWN Vercel projects through the Vercel API, so a self-hoster has nothing for it to check and never runs it. The hostname is report text for a human reading the output, not an input to any behaviour. RATCHETED 5 -> 1 on 2026-08-23 (AGL-2486): the AGL-2483 pass moved the other four into prose that `stripComments` removes. The ratchet compares EXACTLY, so a decrease fails too — deliberately, because an allowance nobody tightens stops describing the file it guards (AGL-2483).",
  },
  {
    file: 'tools/scripts/lib/stripe-webhook-health.mjs',
    count: 1,
    reason:
      'Reader of STRIPE_WEBHOOK_URL, the same variable the console health route honours; the literal is its default (AGL-2202).',
  },
  {
    file: 'tools/scripts/lib/uptime-targets.mjs',
    count: 2,
    reason:
      "The uptime probe's two default targets, moved out of probe-uptime.mjs so a test can read them without firing a production sweep (AGL-1617). Overridable on the command line and by CONSOLE_BASE_URL / TENANT_BASE_URL. Internal tool.",
  },
  {
    file: 'tools/scripts/reap-plugin-artifacts.mjs',
    count: 1,
    reason:
      'Reader of CONSOLE_BASE_URL; the literal is its default.',
  },
  {
    file: 'tools/scripts/reconcile-workspace-domains.mjs',
    count: 2,
    reason:
      'Internal ops script against Aglyn production; one occurrence is a reader of NEXT_PUBLIC_WORKSPACE_DOMAIN.',
  },
  {
    file: 'tools/scripts/reverify-plugin-versions.mjs',
    count: 1,
    reason:
      'Reader of CONSOLE_BASE_URL; the literal is its default.',
  },
]

function trackedSourceFiles(): string[] {
  return execFileSync('git', ['ls-files', 'apps', 'libs', 'cloud', 'tools'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((file) => SOURCE.test(file))
    .filter((file) => !NOT_A_TEST.test(file))
    .filter((file) => !GENERATED.test(file))
}

/** file → surviving occurrences, comments removed. */
function observed(): Map<string, number> {
  const found = new Map<string, number>()
  for (const file of trackedSourceFiles()) {
    let source: string
    try {
      source = readFileSync(resolve(REPO_ROOT, file), 'utf8')
    } catch {
      continue
    }
    const matches = stripComments(source).match(AGLYN_HOST)
    if (matches?.length) found.set(file, matches.length)
  }
  return found
}

describe("Aglyn's own hostnames in runtime code (self-host ratchet)", () => {
  const found = observed()
  const allowed = new Map(ALLOWED.map((entry) => [entry.file, entry.count]))

  it('every allowlist entry states a reason', () => {
    for (const entry of ALLOWED) {
      expect(entry.reason.trim().length).toBeGreaterThan(20)
    }
  })

  it('no file hard-codes an Aglyn hostname without an allowlist entry', () => {
    const unlisted = [...found.keys()]
      .filter((file) => !allowed.has(file))
      .sort()
    expect(unlisted).toEqual([])
  })

  it('no allowlist entry is stale — every listed file still has one', () => {
    const stale = [...allowed.keys()].filter((file) => !found.has(file)).sort()
    expect(stale).toEqual([])
  })

  it('no allowlisted file gained an occurrence', () => {
    const drifted = [...found]
      .filter(([file, count]) => allowed.has(file) && allowed.get(file) !== count)
      .map(([file, count]) => `${file}: allowed ${allowed.get(file)}, found ${count}`)
      .sort()
    expect(drifted).toEqual([])
  })
})
