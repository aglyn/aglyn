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
 * The lockdown notice page (AGL-1501): a REAL **503** with `Retry-After`,
 * served by the middleware rewrite for every path of a locked host.
 *
 * A route handler rather than a page because the App Router gives pages no
 * status-code lever (`notFound()` is the only non-200), and a takedown that
 * answers 200 tells crawlers and uptime checks the site is fine. The HTML
 * is self-contained — no scripts, no assets that could themselves be
 * cached or blocked — and never cached (`no-store`): the moment the
 * lockdown lifts, the middleware stops rewriting here and the next request
 * renders the real site.
 *
 * The verdict is RE-DERIVED from the host param rather than trusted from
 * query fields, so a visitor navigating here directly can neither forge a
 * takedown notice for a healthy site (they just get the generic body with
 * nothing site-specific in it) nor read anything the sanitized notice
 * doesn't already say.
 */

import {
  lockdownNotice,
  lockdownRetryAfterSeconds,
  normalizeHostLockdown,
  normalizeOrgLockdown,
  resolveLockdown,
  type LockdownState,
} from '@aglyn/aglyn/server'
import { getPlatformLockdown } from '@aglyn/tenant-data-admin'
import { getHost } from '../../../utils/get-host'
import { getOrgBilling } from '../../../utils/get-org-billing'

export const dynamic = 'force-dynamic'

const escapeHtml = (value: string): string =>
  value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')

function noticeHtml(state: LockdownState | null): string {
  const notice = state
    ? lockdownNotice(state)
    : {
        title: 'Temporarily unavailable',
        body: 'This site is temporarily unavailable. Please check back shortly.',
        contact: undefined as string | undefined,
      }
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${escapeHtml(notice.title)}</title>
<style>
  body { margin: 0; font-family: system-ui, -apple-system, sans-serif;
         background: #fafafa; color: #1a1a1a; }
  main { max-width: 420px; margin: 22vh auto 0; padding: 24px;
         text-align: center; }
  h1 { font-size: 1.4rem; margin: 0 0 12px; }
  p { line-height: 1.55; margin: 0 0 10px; color: #444; }
  a { color: inherit; }
</style>
</head>
<body>
<main>
<h1>${escapeHtml(notice.title)}</h1>
<p>${escapeHtml(notice.body)}</p>
${
  notice.contact
    ? `<p>Questions? <a href="mailto:${escapeHtml(notice.contact)}">${escapeHtml(notice.contact)}</a></p>`
    : ''
}
</main>
</body>
</html>`
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  // The header first: a route handler behind the middleware rewrite sees
  // the ORIGINAL request URL (`/home`, no query), so the middleware sends
  // the resolved host as `x-aglyn-tenant-host` — the same contract the SEO
  // routes use. The query form serves direct calls.
  const host =
    request.headers.get('x-aglyn-tenant-host') ??
    url.searchParams.get('host') ??
    ''
  let state: LockdownState | null = null
  try {
    if (host && !host.includes('/')) {
      const hostRes = await getHost({ host })
      if (hostRes.host) {
        const orgRes = await getOrgBilling({ hostId: hostRes.host.$id })
        state = resolveLockdown(
          {
            platform: await getPlatformLockdown(),
            org: normalizeOrgLockdown(orgRes.org as never),
            host: normalizeHostLockdown(hostRes.host as never),
          },
          Date.now(),
        )
      }
    }
  } catch (error) {
    console.error('[locked] verdict re-derivation failed', error)
  }
  const retryAfter = state ? lockdownRetryAfterSeconds(state, Date.now()) : undefined
  return new Response(noticeHtml(state), {
    status: 503,
    headers: {
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
      // Default 60: matches the middleware verdict memo — a crawler told to
      // come back in a minute will see the lift about when visitors do.
      'Retry-After': String(retryAfter ?? 60),
    },
  })
}
