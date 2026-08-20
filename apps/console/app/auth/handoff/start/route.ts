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

import {
  HANDOFF_PENDING_TTL_MS,
  HANDOFF_VERIFIER_COOKIE,
  resolveConsoleDomain,
  safeContinuePath,
  startConsoleHandoff,
} from '@aglyn/tenant-data-admin'
// The workspace apex in ONE place. Re-declaring it here is the shape of the
// AGL-1135 bug: the value could differ between the code that grants a session
// and the code that decides who may ask for one.
import { WORKSPACE_DOMAIN } from '../../../../constants/workspace-domain'

// lockdown-423: exempt — the first leg of signing in, like its two siblings.
// The lockdown gate for auth is on the session mint this flow ends at.

/**
 * `GET /auth/handoff/start` — where a custom console domain begins a sign-in
 * (AGL-1902, D1).
 *
 * Unauthenticated by definition: the visitor has no session here, which is why
 * they are here. Nothing about a `pending` record is a capability — it names a
 * host and holds a hash, and until the auth host authorizes it there is
 * nothing to redeem.
 *
 * Two things leave this route, and they take different channels on purpose:
 *
 * - the **verifier** `V` goes into a host-only `HttpOnly` cookie on the custom
 *   domain, proving later that redemption came from the browser that started
 *   here;
 * - the **request id** goes in the query string of a 303 to the auth host,
 *   because it is only a pointer.
 *
 * The return secret does not exist yet. It is minted at authorize and reaches
 * this browser through a URL fragment, never through a header, a query string
 * or a log.
 *
 * `targetHost` is taken from the `Host` the request actually arrived on and
 * never from a parameter. That is what makes the origin check at redemption
 * mean anything.
 */

export const dynamic = 'force-dynamic'

async function handler(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const host = String(request.headers.get('host') ?? '').split(':')[0]
  const continuePath = safeContinuePath(url.searchParams.get('continue'))
  const secure =
    (request.headers.get('x-forwarded-proto') ?? '')
      .split(',')[0]
      .trim()
      .toLowerCase() === 'https' || url.protocol === 'https:'

  const verdict = await resolveConsoleDomain(host)
  if (!verdict.servable) {
    // Send them somewhere that works rather than leaving them on a dead
    // hostname — the same call the middleware makes, and for the same reason.
    // A `degraded` verdict lands here too: minting a session on a domain we
    // could not confirm is live is the opposite trade from serving a page on
    // one, and they still have a workspace subdomain.
    const fallback = verdict.orgSlug
      ? `https://${verdict.orgSlug}.${WORKSPACE_DOMAIN}/`
      : `https://app.${WORKSPACE_DOMAIN}/`
    return Response.redirect(`${fallback}?console-domain=inactive`, 307)
  }

  let started: Awaited<ReturnType<typeof startConsoleHandoff>>
  try {
    started = await startConsoleHandoff({
      targetHost: host,
      orgSlug: verdict.orgSlug,
      continuePath,
    })
  } catch (error) {
    console.error('[auth/handoff/start]', error)
    started = null
  }
  if (!started) {
    return Response.redirect(
      `https://app.${WORKSPACE_DOMAIN}/?console-domain=inactive`,
      307,
    )
  }

  // The auth host's own sign-in page, with its EXISTING `continue` parameter
  // pointing at the leg that authorizes. No change to the sign-in page: the
  // authorize call happens after it has finished, on a page of its own, which
  // is also what makes D5's ordering natural — the `.aglyn.com` `__session`
  // mint is awaited there, before the cross-origin navigation, rather than
  // racing it (the AGL-466 loop).
  const authContinue = `/auth/handoff/continue?handoff=${encodeURIComponent(started.requestId)}`
  const destination =
    `https://app.${WORKSPACE_DOMAIN}/signin` +
    `?continue=${encodeURIComponent(authContinue)}`

  const response = new Response(null, {
    status: 303,
    headers: { Location: destination, 'Cache-Control': 'no-store' },
  })
  response.headers.append(
    'Set-Cookie',
    [
      `${HANDOFF_VERIFIER_COOKIE}=${started.verifier}`,
      'Path=/',
      `Max-Age=${Math.floor(HANDOFF_PENDING_TTL_MS / 1000)}`,
      'HttpOnly',
      'SameSite=Lax',
      // Host-only: NO `Domain` attribute. A `Domain=.acme-agency.com` cookie
      // would be readable by every sibling host the customer runs, which is
      // precisely the shadowing this design defends against elsewhere.
      ...(secure ? ['Secure'] : []),
    ].join('; '),
  )
  return response
}

export { handler as GET }
