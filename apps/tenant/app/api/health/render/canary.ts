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

/**
 * Server-side render canaries for the two pages nobody was watching
 * (AGL-2486).
 *
 * `marketing-home` and `customer-site` were the only external checks that
 * fetched a REAL PAGE. Both went to 0% on 2026-08-21 when bot protection
 * started answering Google's uptime checkers with a 429 checkpoint, and the
 * `/api/health` firewall bypass that recovered the other two cannot reach a
 * check that fetches `/`.
 *
 * So the render comes to the bypass instead. Each canary runs the SAME loader
 * the catch-all page route runs (`loadPageData`), against a real host, and
 * `renderHealth` grades what came back. There is no HTTP round trip: an
 * in-process call cannot be answered by the edge, which is the whole point —
 * a self-`fetch` of `https://aglyn.com/` would be challenged exactly like
 * Google's checker was, and would have reproduced the outage rather than
 * measured it.
 *
 * ## Two endpoints, not one
 *
 * `/api/health/render/marketing` and `/api/health/render/site` are separate
 * routes with separate status codes, so the two dead checks map one-to-one
 * onto them. A single combined endpoint would give one 503 for two very
 * different failures and hide which half broke.
 *
 * ## Both hosts are OURS, deliberately
 *
 * A canary pinned to content a customer controls pages the on-call engineer
 * for somebody else's edit. Neither host here can be taken away by a
 * customer, and neither assertion looks at page COPY — see `renderHealth`,
 * which grades a resolved host and a non-empty composed node tree and
 * nothing else.
 *
 * Both are overridable so a self-host operator can point these at their own
 * sites rather than at hosts that do not exist in their install.
 *
 * ## ⚠️ "Ours" is not the same as MAINTAINED (AGL-1617)
 *
 * This block used to claim `demo` was "the platform's own demonstration site
 * … nobody outside Aglyn can unpublish it". Only the second half was ever
 * true, and the first half is what made the endpoint misleading. An audit
 * found there is no `hosts/demo` document at all: the `demo` subdomain is
 * served by a legacy push-id host in an individual's personal org, on a
 * starter plan, holding zero seed documents and four renderer test screens.
 * It publicly served `CLICK ME`, nineteen `hello` nodes, a fake pricing table
 * and unresolved `{{Message}}` tokens — and graded GREEN throughout, because
 * nineteen nodes is a non-empty tree.
 *
 * The structural assertion was not the defect and must not be tightened into
 * a content match; `render-canary-can-go-red.spec.ts` exists to keep an
 * ordinary edit from paging on-call. The SUBJECT was the defect. A structural
 * assertion is only meaningful when something guarantees the tree, so the
 * subject belongs on a host whose content is produced by a script in version
 * control and never hand-edited: the `showcase` brand pack
 * (`tools/scripts/lib/demo-brands.mjs`), seeded into the demo org and
 * selected with `AGLYN_CANARY_SITE_HOST=showcase`.
 *
 * Deliberately NOT one of the four brand demo sites — sales edits those
 * before customer calls, which reintroduces exactly the failure above.
 *
 * The `|| 'demo'` fallback in `siteHost()` below is therefore KNOWN-WEAK and
 * is still the default on purpose. Changing it to `not-configured` (the
 * tidier shape `marketingHost()` uses) before `showcase` exists and the env
 * var is set would 503 the canary and redden the public status page. Host
 * first, env second, default third.
 */
import {
  renderHealth,
  type RenderCheck,
  type RenderOutcome,
} from '@aglyn/aglyn/server'

import { loadPageData } from '../../../[host]/[[...slug]]/load-page-data'

/**
 * Which tenant host the marketing canary renders — CONFIGURED, never a
 * literal (AGL-2486).
 *
 * This copies the AGL-1919 auth-origin precedence deliberately, for the same
 * reason it was built that way: *"so a self-host install is never pointed at
 * our origin"*. A canary hard-wired to Aglyn's own domain is dead weight on
 * someone else's deployment at best, and a permanent confusing red at worst.
 *
 *   1. `AGLYN_CANARY_MARKETING_HOST` — the explicit answer, and the escape
 *      hatch if the derivation below is ever wrong.
 *   2. `cname--{NEXT_PUBLIC_WORKSPACE_DOMAIN}` — the operator's own domain,
 *      already the established self-host knob (`.env.selfhost.example`). A
 *      custom domain reaches the loader under the middleware's `cname--`
 *      sentinel, not as the bare hostname.
 *   3. **Nothing.** There is no Aglyn fallback, so this file names no Aglyn
 *      host and the self-host ratchet has nothing to allowlist.
 *
 * Unconfigured is graded as a FAILURE (`not-configured`), never as healthy —
 * "we are not watching anything" must not read the same as "the page is
 * fine". It is not a false alarm either: nothing consumes these endpoints
 * until an operator points a monitor at one, and the code says exactly what
 * to do. The tenant's own `/api/health` does not aggregate these, so an
 * unconfigured install never goes red on the check that matters.
 */
export function marketingHost(): string | null {
  const explicit = process.env['AGLYN_CANARY_MARKETING_HOST']?.trim()
  if (explicit) return explicit
  const workspace = process.env['NEXT_PUBLIC_WORKSPACE_DOMAIN']
    ?.trim()
    .toLowerCase()
  // `includes('.')` for the same reason `media-ref.ts` screens it: a value
  // without a dot is not a domain, and `cname--localhost` resolves nothing.
  if (workspace && workspace.includes('.')) return `cname--${workspace}`
  return null
}

/**
 * Which tenant host the site canary renders.
 *
 * `demo` is a tenant host LABEL, not an Aglyn hostname — it is the middleware's
 * own default for `app.aglyn.com` and every preview deployment
 * (`AGLYN_TENANT_DEMO || 'demo'`), so this reuses the platform convention a
 * self-host install already follows rather than inventing a second one.
 */
export function siteHost(): string | null {
  const explicit = process.env['AGLYN_CANARY_SITE_HOST']?.trim()
  if (explicit) return explicit
  return process.env['AGLYN_TENANT_DEMO']?.trim() || 'demo'
}

/**
 * Five minutes, matching every sibling subsystem probe. It bounds what a
 * public unauthenticated endpoint can be made to cost — the loader reads
 * Firestore — while staying well inside the 15-minute monitor interval, so
 * the memo is never what delays a red.
 */
export const PROBE_TTL_MS = 5 * 60_000

/**
 * Run the real page loader for `host`'s home page and describe the outcome
 * structurally. Never throws: an exception here is an `unavailable` verdict,
 * because a monitoring probe must not become the outage it reports. A null
 * host — nothing configured — is `not-configured`, also a failure.
 */
export async function probeRender(host: string | null): Promise<RenderCheck> {
  // No target configured is a failure, not a pass. See `marketingHost`.
  if (!host) return renderHealth({ kind: 'not-configured' }, '', 0)
  const startedAt = Date.now()
  let outcome: RenderOutcome
  try {
    // The empty slug is the home page — the exact path both dead checks
    // fetched (`aglyn.com/` and `demo.aglyn.app/`).
    const result = await loadPageData(host, [])
    if (result && 'props' in result) {
      const props = result.props
      outcome = {
        kind: 'rendered',
        hostResolved: Boolean(props?.data?.host),
        nodeCount: Object.keys(props?.nodes ?? {}).length,
      }
    } else if (result && 'redirect' in result) {
      outcome = { kind: 'redirect' }
    } else {
      // `notFound` — and also the shape of a loader that returned nothing.
      outcome = { kind: 'not-found' }
    }
  } catch {
    outcome = { kind: 'unavailable' }
  }
  return renderHealth(outcome, host, Date.now() - startedAt)
}
