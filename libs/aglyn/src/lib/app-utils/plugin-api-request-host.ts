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

/*==========================================
 * WHICH SITE A PLUGIN API REQUEST IS ABOUT (AGL-3360).
 *
 * Both plugin API dispatchers gate a request on its site — per-site plugin
 * enablement, the org/host lockdown, the visitor rate limit — and then hand
 * the request to a handler that reads the site AGAIN, its own way. The two
 * readings disagreed in two ways, and each let a suspended site take money:
 *
 * 1. `?hostId=` won over the body. A checkout posted with
 *    `?hostId=<any open site>` and `{"hostId": "<suspended site>"}` was
 *    gated on the open site and charged for the suspended one: every
 *    storefront, booking and reservation handler reads `body.hostId`.
 * 2. Only a JSON body was read. A urlencoded body parsed to nothing here,
 *    so no gate ran at all, while `pluginRequestFromWeb` hands the handler
 *    the form fields as an object and `body.hostId` is right there.
 *
 * This reads the request exactly as `pluginRequestFromWeb` will present it
 * to the handler — form fields for urlencoded, JSON for anything that
 * parses as JSON (handlers `JSON.parse` a string body themselves) — and
 * collects EVERY hostId the request names. More than one distinct site is
 * a conflict the dispatcher refuses: no honest caller names two sites, and
 * any single choice between them is a guess an attacker gets to make.
 *
 * Coerced with `String(value ?? '')`, the handlers' own coercion, so the
 * site gated is the site charged byte for byte.
 *=========================================*/

export interface PluginApiRequestHost {
  /** The one site the request names, or '' when it names none. */
  hostId: string
  /** True when the query and the body (or repeated params) disagree. */
  conflict: boolean
}

function bodyHostId(raw: string, contentType: string): string {
  if (!raw) return ''
  if (contentType.includes('application/x-www-form-urlencoded')) {
    return String(new URLSearchParams(raw).get('hostId') ?? '')
  }
  try {
    const parsed = JSON.parse(raw) as { hostId?: unknown } | null
    return parsed && typeof parsed === 'object'
      ? String(parsed.hostId ?? '')
      : ''
  } catch {
    return ''
  }
}

/**
 * Every site the request names, read off a clone so the handler still gets
 * the untouched stream. Never throws: an unreadable body names no site.
 */
export async function pluginApiRequestHost(
  request: Request,
): Promise<PluginApiRequestHost> {
  const named = new Set<string>()
  const url = new URL(request.url)
  for (const value of url.searchParams.getAll('hostId')) {
    if (value) named.add(value)
  }
  const method = (request.method ?? 'GET').toUpperCase()
  if (method !== 'GET' && method !== 'HEAD') {
    try {
      const raw = await request.clone().text()
      const fromBody = bodyHostId(
        raw,
        request.headers.get('content-type') ?? '',
      )
      if (fromBody) named.add(fromBody)
    } catch {
      // An unreadable body names no site; the handler cannot read one either.
    }
  }
  const [first = ''] = named
  return { hostId: named.size === 1 ? first : '', conflict: named.size > 1 }
}

/** The dispatcher's answer to a conflict: refuse, and say why. */
export function conflictingHostIdResponse(): Response {
  return Response.json(
    { error: 'The request names more than one site.' },
    { status: 400 },
  )
}
