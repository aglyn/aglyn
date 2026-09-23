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
  PLATFORM_CONSENT_COOKIE,
  platformConsentPosture,
} from '@aglyn/aglyn/app-utils/platform-visitor-consent'
import { readRequestGeo } from '@aglyn/aglyn/app-utils/request-geo'
import { parseStoredVisitorConsent } from '@aglyn/aglyn/app-utils/visitor-consent'
import { firstTouchScript } from '@aglyn/shared-util-first-touch/first-touch-script'
import { firstPartyOrigin, resolveFirstPartyHosts } from './first-party-hosts'
import { openFirstTouch, sealFirstTouch } from './first-touch-handoff'

/**
 * `/api/first-touch` — the one URL a surface needs to capture first touches
 * (AGL-3289). The console and the tenant each serve it from this module:
 *
 * - **GET** is the capture itself: the kit's source with this install's host
 *   registry, this endpoint as its hand-off URL, and a storage default for
 *   this visitor. A plain page includes it as one script tag.
 * - **POST** seals a record for a hop to a host the cookie cannot reach
 *   (`{ seal }`), or opens one a hop brought (`{ open }`). Only for an origin
 *   on a registered host; the body is plain text so a cross-origin call needs
 *   no preflight.
 *
 * ## The storage default
 *
 * The platform's own consent posture, decided at the edge for a surface that
 * has no consent code of its own: the visitor's recorded answer when the
 * `aglyn_consent` mirror carries one, a refusal when the browser sends Global
 * Privacy Control, and otherwise the region's posture — granted where implied
 * consent is lawful, pending where the law asks first. A surface that runs
 * its own consent tool marks its tag `data-consent="pending"` and forwards its
 * own answer, which then wins.
 */

/** The path both apps serve the capture at. */
export const FIRST_TOUCH_ROUTE_PATH = '/api/first-touch'

function cookieValue(header: string | null, name: string): string | null {
  for (const pair of String(header ?? '').split(';')) {
    const cut = pair.indexOf('=')
    if (cut < 0 || pair.slice(0, cut).trim() !== name) continue
    try {
      return decodeURIComponent(pair.slice(cut + 1).trim())
    } catch {
      return null
    }
  }
  return null
}

/** Whether this visitor's capture may use device storage, before any page code runs. */
export function firstTouchStorageDefault(headers: Headers): boolean | null {
  const recorded = parseStoredVisitorConsent(
    cookieValue(headers.get('cookie'), PLATFORM_CONSENT_COOKIE),
  )
  if (recorded) return recorded.analytics
  if (headers.get('sec-gpc') === '1') return false
  return platformConsentPosture(readRequestGeo(headers).country) === 'opt-out' ? true : null
}

/** The public origin a request was addressed to. */
function requestOrigin(request: Request): string {
  const url = new URL(request.url)
  const forwardedHost = request.headers.get('x-forwarded-host')
  const forwardedProto = request.headers.get('x-forwarded-proto')
  const host = forwardedHost?.split(',')[0].trim() || url.host
  const proto = (forwardedProto?.split(',')[0].trim() || url.protocol.replace(':', '')).toLowerCase()
  return `${proto === 'http' ? 'http' : 'https'}://${host}`
}

/** GET — the capture script. */
export async function firstTouchScriptResponse(request: Request): Promise<Response> {
  const hosts = await resolveFirstPartyHosts()
  const script = firstTouchScript({
    hosts,
    storage: firstTouchStorageDefault(request.headers),
    handoffUrl: `${requestOrigin(request)}${FIRST_TOUCH_ROUTE_PATH}`,
  })
  return new Response(script, {
    status: 200,
    headers: {
      'content-type': 'text/javascript; charset=utf-8',
      // Per visitor: the storage default reads their consent cookie and
      // their region, so no shared cache may hand one visitor's answer to
      // another.
      'cache-control': 'private, no-store',
      'x-content-type-options': 'nosniff',
    },
  })
}

function corsHeaders(origin: string | null): Record<string, string> {
  return origin
    ? {
        'access-control-allow-origin': origin,
        'access-control-allow-methods': 'POST, OPTIONS',
        'access-control-allow-headers': 'content-type',
        'access-control-max-age': '600',
        vary: 'Origin',
      }
    : { vary: 'Origin' }
}

/** OPTIONS — only for a client that sends a header plain text would not. */
export async function firstTouchPreflightResponse(request: Request): Promise<Response> {
  const origin = firstPartyOrigin(request.headers.get('origin'), await resolveFirstPartyHosts())
  return new Response(null, { status: origin ? 204 : 403, headers: corsHeaders(origin) })
}

/** POST — seal a record for a hop, or open one a hop brought. */
export async function firstTouchHandoffResponse(request: Request): Promise<Response> {
  const origin = firstPartyOrigin(request.headers.get('origin'), await resolveFirstPartyHosts())
  const headers = { ...corsHeaders(origin), 'cache-control': 'no-store' }
  // Browsers name the origin on every POST a page makes. A request that
  // names none, or one that is not ours, is not a hop between our hosts.
  if (!origin) return Response.json({ error: 'Not a first-party origin' }, { status: 403, headers })
  let body: Record<string, unknown> | null = null
  try {
    const text = await request.text()
    body = text.length <= 8192 ? JSON.parse(text) : null
  } catch {
    body = null
  }
  if (body && 'seal' in body) {
    const sealed = sealFirstTouch(body['seal'])
    return sealed
      ? Response.json(sealed, { status: 200, headers })
      : Response.json({ error: 'Nothing to seal' }, { status: 400, headers })
  }
  if (body && 'open' in body) {
    const touch = openFirstTouch(body['open'])
    return touch
      ? Response.json({ touch }, { status: 200, headers })
      : Response.json({ error: 'Not a valid hand-off' }, { status: 400, headers })
  }
  return Response.json({ error: 'Expected seal or open' }, { status: 400, headers })
}
