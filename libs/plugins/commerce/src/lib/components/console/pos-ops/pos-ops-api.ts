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

/** The register's operations routes (AGL-3609). */
export type PosOpsRoute = 'pos-shift' | 'pos-staff-pin' | 'pos-customer' | 'pos-return'

export interface PosOpsAnswer<T = Record<string, any>> {
  ok: boolean
  status: number
  body: T & { error?: string }
}

/**
 * One call to a register route, answered as data — a refusal is a status and
 * a sentence for the cashier, never a throw the register has to catch. A
 * network failure answers status 0.
 */
export async function callPosOps<T = Record<string, any>>(
  user: unknown,
  route: PosOpsRoute,
  body: Record<string, unknown>,
  options: { idempotencyKey?: string } = {},
): Promise<PosOpsAnswer<T>> {
  try {
    const response = await authorizedFetch(user as any, `/api/commerce/${route}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
      },
      body: JSON.stringify(body),
    })
    const parsed = (await response.json().catch(() => ({}))) as T & { error?: string }
    return { ok: response.ok, status: response.status, body: parsed }
  } catch {
    return {
      ok: false,
      status: 0,
      body: { error: 'The register is offline. Check the connection and try again.' } as T & {
        error?: string
      },
    }
  }
}

/** A fresh attempt id for one tap that moves money or cash. */
export function newPosAttemptKey(): string {
  const random =
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`
  return random.replace(/[^A-Za-z0-9_-]/g, '')
}

/** Dollars typed at the register → whole cents, or `null` for not-an-amount. */
export function parsePosDollars(value: string): number | null {
  const trimmed = String(value ?? '').replace(/[$,\s]/g, '')
  if (!trimmed) return null
  if (!/^\d+(\.\d{0,2})?$/.test(trimmed)) return null
  return Math.round(Number(trimmed) * 100)
}
