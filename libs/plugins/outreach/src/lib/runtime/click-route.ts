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

import { readClientIp } from '@aglyn/aglyn/app-utils/request-ip'
import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import { OUTREACH_COLLECTIONS } from '../model/outreach.types'
import { recordOutreachSequenceTouch } from './campaign-credit'
import {
  isOutreachLinkId,
  isOutreachStoredOpen,
  readOutreachClickToken,
  readOutreachStoredLink,
  readOutreachStoredOpen,
  type OutreachClickTarget,
  type OutreachOpenTarget,
} from './click-link'
import { recordOutreachClick } from './click-events'
import { recordOutreachOpen } from './open-events'
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
  // A link in a test of a step (AGL-3325) is followed and never counted:
  // the member clicking their own test is not a recipient acting.
  if (target.test) return redirect
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

/**
 * A transparent 1×1 GIF: the tracking image (AGL-3395). The smallest image
 * every mail client renders, and the one that draws nothing if it is shown.
 */
const PIXEL_GIF = Uint8Array.from(
  Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64'),
)

/**
 * The image, then the recording (AGL-3395).
 *
 * Every fetch gets the same image — a person, a mail privacy proxy and a
 * gateway alike, and an image whose document is unreadable too — because a
 * broken image in a one-to-one email is a visible fault and a missing open
 * is only a number. `no-store` asks every cache not to keep it, so a later
 * open fetches again; a proxy that caches anyway (Gmail's does) is why the
 * first open is the one the rate is taken over.
 */
async function answerOutreachOpen(
  deps: ClickRouteDeps,
  request: Request,
  target: OutreachOpenTarget | null,
): Promise<Response> {
  const image = new Response(request.method === 'HEAD' ? null : PIXEL_GIF, {
    status: 200,
    headers: {
      'Content-Type': 'image/gif',
      'Content-Length': String(PIXEL_GIF.byteLength),
      'Cache-Control': 'no-store, no-cache, must-revalidate, private',
      'X-Robots-Tag': 'noindex, nofollow',
    },
  })
  if (!target || target.test) return image
  try {
    await recordOutreachOpen(deps, {
      target,
      method: request.method,
      userAgent: request.headers.get('user-agent'),
      // Read for the network it belongs to (AGL-3488), and never stored.
      address: readClientIp(request.headers),
    })
  } catch (error) {
    console.error('[outreach] an open could not be recorded', error)
  }
  return image
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
 * The same route answers a tracking image (AGL-3395) — an `outreachLinks`
 * document of kind `open` — with the image instead of a redirect, so the
 * image lives on the same host and path as every link.
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
    let data: unknown
    try {
      const snapshot = await deps.firestore().collection(OUTREACH_COLLECTIONS.links).doc(linkId).get()
      data = snapshot.exists ? snapshot.data() : undefined
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
    // The id names a tracking image (AGL-3395): the image, not a redirect.
    if (isOutreachStoredOpen(data)) return answerOutreachOpen(deps, request, readOutreachStoredOpen(data))
    const target = readOutreachStoredLink(data)
    if (!target) return brokenLink()
    return followOutreachClick(deps, request, target)
  }
}
