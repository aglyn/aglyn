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

import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import { readOutreachClickToken } from './click-link'
import { recordOutreachClick } from './click-events'
import type { OutreachRuntimeDeps } from './runtime-deps'
// The plain page both recipient-facing routes answer with: no theme, no
// session, the reader's own colors. It lives beside the first route that
// needed one rather than being copied for the second.
import { outreachUnsubscribePage } from './unsubscribe-route'

/**
 * A LINK IN A TRACKED SEQUENCE EMAIL (AGL-3239): `GET /api/outreach/click?t=…`.
 *
 * ## The redirect happens first, and it happens for everyone
 *
 * The destination is in the token, so answering needs no read: the handler
 * verifies the signature, and the 302 goes out. Recording is awaited after
 * the answer is built and never gates it — a Firestore that is slow or down
 * costs a number, not a visit.
 *
 * A link scanner is redirected exactly as a person is. Refusing one, or
 * answering it differently, is how a security gateway learns to report the
 * link as broken and the message as suspicious; it is counted apart instead
 * (`../engine/click-tracking.ts`).
 *
 * ## No session, and no release gate
 *
 * Registered as a recipient link, like the one-click unsubscribe. The
 * signature in the token is the whole of the authority, and a link that is
 * already in somebody's inbox has to keep working whether or not Outreach is
 * released to that organization today.
 *
 * ## A token that does not verify is not followed
 *
 * There is nowhere to send them: the destination WAS the thing that failed
 * the check. So it answers the same plain page the unsubscribe route
 * answers, rather than guessing — an endpoint that redirects to an unsigned
 * URL is an open redirect, whatever it is called.
 *
 * ## What the recipient's browser is told
 *
 * `no-store`, so a gateway's copy is never served to the person after it;
 * `no-referrer`, so the destination never learns the token; and `noindex`,
 * because a tracking link that reached a crawler should not be in an index.
 */

const REDIRECT_HEADERS = {
  'Cache-Control': 'no-store, no-cache, must-revalidate',
  'Referrer-Policy': 'no-referrer',
  'X-Robots-Tag': 'noindex, nofollow',
}

export function createOutreachClickRoute(
  deps: Pick<OutreachRuntimeDeps, 'firestore' | 'now' | 'timeline'>,
): PluginWebApiHandler {
  return async (request) => {
    // `HEAD` is answered because a gateway often sends one before the `GET`
    // a person makes; it is redirected and counted as the machine it is.
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      return new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })
    }
    const target = readOutreachClickToken(new URL(request.url).searchParams.get('t'))
    if (!target) {
      return outreachUnsubscribePage(
        {
          title: 'This link doesn’t work',
          body: 'This link isn’t valid, or it has been changed since it was sent. Try opening it from the original email.',
        },
        400,
      )
    }
    /*
     * Built by hand rather than with `Response.redirect`, which seals its
     * headers: the three above are the point of the answer as much as the
     * `Location` is. `target.url` is `URL.href` of an http(s) URL — the
     * token reader will return nothing else — so it is a header value that
     * cannot carry a newline into the response.
     */
    const redirect = new Response(null, {
      status: 302,
      headers: { ...REDIRECT_HEADERS, Location: target.url },
    })
    try {
      await recordOutreachClick(deps, {
        target,
        method: request.method,
        userAgent: request.headers.get('user-agent'),
      })
    } catch (error) {
      // The visit already has its answer. A click we failed to count is a
      // missing number; a redirect we failed to send is a broken email.
      console.error('[outreach] a click could not be recorded', error)
    }
    return redirect
  }
}
