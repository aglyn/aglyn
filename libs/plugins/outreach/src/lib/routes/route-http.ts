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
 * The few shapes every settings, sequence and enrollment route answers in
 * (AGL-2980): a `200` with a body, a refusal with a sentence and a stable
 * reason, and a JSON body read without trusting it. Nothing is cached — an
 * answer about a workspace's sending is stale the moment it is written.
 */

import type {
  OutreachRouteRefusal,
  OutreachRouteRefusalReason,
} from '../model/outreach-api'

const NO_STORE = { 'Cache-Control': 'no-store' }

/** A `200` carrying `body`. */
export function outreachOk(body: unknown): Response {
  return Response.json(body, { status: 200, headers: NO_STORE })
}

/** A refusal in the one shape the routes answer with. */
export function outreachRefusal(
  status: number,
  reason: OutreachRouteRefusalReason,
  error: string,
  extra?: Omit<OutreachRouteRefusal, 'error' | 'reason'>,
): Response {
  const body: OutreachRouteRefusal = { error, reason, ...(extra ?? {}) }
  return Response.json(body, { status, headers: NO_STORE })
}

export function outreachMethodNotAllowed(allow: string): Response {
  return Response.json(
    { error: 'Method not allowed', reason: 'method-not-allowed' } satisfies OutreachRouteRefusal,
    { status: 405, headers: { ...NO_STORE, Allow: allow } },
  )
}

/** The request's JSON object, or `{}` for a body that is not one. */
export async function readOutreachJsonBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body)
    ? (body as Record<string, unknown>)
    : {}
}

/** A document id as a request may name one: a plain path segment. */
const DOCUMENT_ID = /^[A-Za-z0-9_-]{1,128}$/

/** `value` when it is a plain document id, else `null`. */
export function readOutreachDocumentId(value: unknown): string | null {
  const id = typeof value === 'string' ? value.trim() : ''
  return DOCUMENT_ID.test(id) ? id : null
}
