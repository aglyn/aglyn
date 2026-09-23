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
import { OUTREACH_COLLECTIONS } from '../model/outreach.types'
import { recordOutreachSequenceTouch } from './campaign-credit'
import {
  isOutreachLinkId,
  readOutreachClickToken,
  readOutreachStoredLink,
  type OutreachClickTarget,
} from './click-link'
import { recordOutreachClick } from './click-events'
import type { OutreachRuntimeDeps } from './runtime-deps'
// The plain page both recipient-facing routes answer with: no theme, no
// session, the reader's own colors. It lives beside the first route that
// needed one rather than being copied for the second.
import { outreachUnsubscribePage } from './unsubscribe-route'

/**
 * A LINK IN A TRACKED SEQUENCE EMAIL (AGL-3239, AGL-3297): the short
 * `GET /api/outreach/l/<id>` every send carries now, and the signed
 * `GET /api/outreach/click?t=…` the emails sent before it carry.
 *
 * ## The redirect happens first, and it happens for everyone
 *
 * The signed link carries its destination and needs no read; the short one
 * needs exactly one, of the document that names it. Then the 302 goes out. Recording is awaited after
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

type ClickRouteDeps = Pick<OutreachRuntimeDeps, 'firestore' | 'now' | 'timeline' | 'campaignCredit'>

const methodNotAllowed = () =>
  new Response('Method not allowed', { status: 405, headers: { Allow: 'GET, HEAD' } })

const brokenLink = () =>
  outreachUnsubscribePage(
    {
      title: 'This link doesn’t work',
      body: 'This link isn’t valid, or it has been changed since it was sent. Try opening it from the original email.',
    },
    400,
  )

/**
 * The redirect, then the recording — the half both routes share once they
 * know where the link goes.
 */
async function followOutreachClick(
  deps: ClickRouteDeps,
  request: Request,
  target: OutreachClickTarget,
): Promise<Response> {
  /*
   * Built by hand rather than with `Response.redirect`, which seals its
   * headers: the three above are the point of the answer as much as the
   * `Location` is. `target.url` is `URL.href` of an http(s) URL — both
   * readers return nothing else — so it is a header value that cannot carry
   * a newline into the response.
   */
  const redirect = new Response(null, {
    status: 302,
    headers: { ...REDIRECT_HEADERS, Location: target.url },
  })
  try {
    const outcome = await recordOutreachClick(deps, {
      target,
      method: request.method,
      userAgent: request.headers.get('user-agent'),
    })
    /*
     * A person's click — never a scanner's — on a sequence in a campaign
     * is their last campaign touch on the site (AGL-3254), so the booking
     * or the form they go on to make is credited to the sequence's
     * campaign by the door that credits every other one.
     */
    if (outcome.human && outcome.enrollment) {
      await recordOutreachSequenceTouch(deps, { enrollment: outcome.enrollment, atMs: deps.now() })
    }
  } catch (error) {
    // The visit already has its answer. A click we failed to count is a
    // missing number; a redirect we failed to send is a broken email.
    console.error('[outreach] a click could not be recorded', error)
  }
  return redirect
}

/** The signed link, `?t=…` — every tracked email sent before AGL-3297. */
export function createOutreachClickRoute(deps: ClickRouteDeps): PluginWebApiHandler {
  return async (request) => {
    // `HEAD` is answered because a gateway often sends one before the `GET`
    // a person makes; it is redirected and counted as the machine it is.
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed()
    const target = readOutreachClickToken(new URL(request.url).searchParams.get('t'))
    if (!target) return brokenLink()
    return followOutreachClick(deps, request, target)
  }
}

/**
 * THE SHORT LINK (AGL-3297): `GET /api/outreach/l/<id>`.
 *
 * One read of `outreachLinks/<id>` stands where the signature check stood,
 * and everything after it is the signed route's: the same redirect, the same
 * headers, the same recording, scanners redirected and counted apart.
 *
 * The destination comes only from that document. An id that is malformed or
 * names nothing is answered with the plain page, never followed; a read that
 * FAILS is answered with a page saying to try again, because there is
 * nowhere honest to send them either.
 */
export function createOutreachShortLinkRoute(deps: ClickRouteDeps): PluginWebApiHandler {
  return async (request) => {
    if (request.method !== 'GET' && request.method !== 'HEAD') return methodNotAllowed()
    // The id is the last path segment: `/api/outreach/l/<id>`.
    const linkId = new URL(request.url).pathname.split('/').pop()
    if (!isOutreachLinkId(linkId)) return brokenLink()
    let target: OutreachClickTarget | null
    try {
      const snapshot = await deps.firestore().collection(OUTREACH_COLLECTIONS.links).doc(linkId).get()
      target = snapshot.exists ? readOutreachStoredLink(snapshot.data()) : null
    } catch (error) {
      console.error('[outreach] a short link could not be read', error)
      return outreachUnsubscribePage(
        {
          title: 'This link isn’t working right now',
          body: 'Something went wrong on our side. Try the link again in a minute.',
        },
        503,
      )
    }
    if (!target) return brokenLink()
    return followOutreachClick(deps, request, target)
  }
}
