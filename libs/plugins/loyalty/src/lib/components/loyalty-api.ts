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
'use client'

import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback } from 'react'
import { LOYALTY_API_ROUTES } from '../constants/api-routes'

/**
 * The console half's one way to the routes (AGL-3640): the member's own
 * token, JSON both ways, and the route's sentence thrown on a refusal so a
 * card can show it as is.
 */

export type LoyaltyRoute = (typeof LOYALTY_API_ROUTES)[keyof typeof LOYALTY_API_ROUTES]

export interface LoyaltyRequestOptions {
  query?: Record<string, string>
  body?: unknown
  /** One press of one button: a retried press is the same change. */
  idempotencyKey?: string
}

export function useLoyaltyFetch() {
  const { data: user } = useUser()
  return useCallback(
    async <T,>(route: LoyaltyRoute, options: LoyaltyRequestOptions = {}): Promise<T> => {
      const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : ''
      const post = options.body !== undefined
      const response = await authorizedFetch(user, `/api/${route}${query}`, {
        method: post ? 'POST' : 'GET',
        headers: {
          ...(post ? { 'Content-Type': 'application/json' } : {}),
          ...(options.idempotencyKey ? { 'Idempotency-Key': options.idempotencyKey } : {}),
        },
        ...(post ? { body: JSON.stringify(options.body) } : {}),
      })
      const payload = (await response.json().catch(() => ({}))) as T & { error?: string }
      if (!response.ok) throw new Error(payload?.error ?? 'Something went wrong. Try again.')
      return payload
    },
    [user],
  )
}

/** A fresh key for one press of one button. */
export function newLoyaltyAttemptKey(): string {
  return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`
}

/** A dollar amount the merchant typed, as whole cents; `null` when it is not one. */
export function centsFromDollars(value: string): number | null {
  const trimmed = String(value ?? '').trim().replace(/[$,\s]/g, '')
  if (!trimmed) return 0
  if (!/^-?\d+(\.\d{0,2})?$/.test(trimmed)) return null
  return Math.round(Number(trimmed) * 100)
}

/** Whole cents as the dollars a field shows: `12.50`. */
export function dollarsFromCents(cents: number): string {
  return (Math.trunc(Number(cents) || 0) / 100).toFixed(2)
}
