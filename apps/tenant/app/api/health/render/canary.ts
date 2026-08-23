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
 * for somebody else's edit. `demo` is the platform's own demonstration site,
 * which is why the middleware falls back to it for `app.aglyn.com` and every
 * preview deployment; nobody outside Aglyn can unpublish it. The marketing
 * host is Aglyn's own site. Neither can be taken away by a customer, and
 * neither assertion looks at page COPY — see `renderHealth`, which grades a
 * resolved host and a non-empty composed node tree and nothing else.
 *
 * Both are overridable so a self-host operator can point these at their own
 * sites rather than at hosts that do not exist in their install.
 */
import {
  renderHealth,
  type RenderCheck,
  type RenderOutcome,
} from '@aglyn/aglyn/server'

import { loadPageData } from '../../../[host]/[[...slug]]/load-page-data'

/**
 * Aglyn's own marketing site. A custom domain reaches the loader under the
 * middleware's `cname--{hostname}` sentinel, not as the bare hostname.
 */
export const MARKETING_HOST =
  process.env['AGLYN_CANARY_MARKETING_HOST']?.trim() || 'cname--aglyn.com'

/**
 * The platform demonstration site — the same host the middleware serves for
 * `app.aglyn.com` and preview URLs (`AGLYN_TENANT_DEMO`, default `demo`).
 */
export const SITE_HOST =
  process.env['AGLYN_CANARY_SITE_HOST']?.trim() ||
  process.env['AGLYN_TENANT_DEMO']?.trim() ||
  'demo'

/**
 * Five minutes, matching every sibling subsystem probe. It bounds what a
 * public unauthenticated endpoint can be made to cost — the loader reads
 * Firestore — while staying well inside the 15-minute monitor interval, so
 * the memo is never what delays a red.
 */
export const PROBE_TTL_MS = 5 * 60_000

/**
 * Run the real page loader for `host`'s home page and describe the outcome
 * structurally. Never throws: an exception here is a `unavailable` verdict,
 * because a monitoring probe must not become the outage it reports.
 */
export async function probeRender(host: string): Promise<RenderCheck> {
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
