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

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'

/** The console's door to returns: `POST /api/commerce/returns`. */
export const RETURNS_ROUTE = '/api/commerce/returns'

/** What the route answered, or why it did not. */
export interface ReturnActionOutcome {
  ok: boolean
  /** The route's answer; empty when it refused. */
  payload: Record<string, any>
  /** Words for a failure; empty on success. */
  message: string
  /** A 4xx: the route refused and wrote nothing. */
  refused: boolean
}

/**
 * Posts one returns action — `{ hostId, action, … }` — with the member's ID
 * token, and words a failure the way the order dialog does: a 4xx carries the
 * route's own reason and wrote nothing; a 500 with the route's word is a
 * rolled-back transaction, safe to retry; an answer with no word, or none at
 * all, leaves the outcome unknown.
 */
export async function postReturnAction(
  user: unknown,
  body: Record<string, unknown>,
): Promise<ReturnActionOutcome> {
  let response: Response
  try {
    response = await authorizedFetch(user as never, RETURNS_ROUTE, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  } catch (error) {
    console.error(error)
    return {
      ok: false,
      payload: {},
      refused: false,
      message:
        'The request did not complete, so it is not known whether the return changed. ' +
        'Reopen it to check — retrying is safe.',
    }
  }
  const payload: any = await response.json().catch(() => ({}))
  if (response.ok) return { ok: true, payload: payload ?? {}, message: '', refused: false }
  if (payload?.error) {
    return {
      ok: false,
      payload: {},
      refused: response.status < 500,
      message:
        response.status < 500
          ? String(payload.error)
          : `${payload.error} Nothing changed.`,
    }
  }
  return {
    ok: false,
    payload: {},
    refused: false,
    message: `The return could not be updated (${response.status}), and it is not known whether it changed. Reopen it to check — retrying is safe.`,
  }
}

/** A money amount in the store's currency. */
export function formatMoney(cents: number, currency: string): string {
  try {
    return new Intl.NumberFormat('en-US', { style: 'currency', currency }).format(cents / 100)
  } catch {
    return `$${(cents / 100).toFixed(2)}`
  }
}
