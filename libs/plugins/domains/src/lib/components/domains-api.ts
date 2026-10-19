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
import type { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import type { DomainRegistrationView } from '../model/registration'

export type DomainsRoute = (typeof DOMAINS_API_ROUTES)[keyof typeof DOMAINS_API_ROUTES]

/** A refusal the card shows as it is, with the route's code to branch on. */
export class DomainsRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly payload: Record<string, unknown>,
  ) {
    super(message)
    this.name = 'DomainsRequestError'
  }
  get code(): string {
    return String(this.payload['code'] ?? '')
  }
}

/** The member's own token, JSON both ways, the route's sentence on a refusal. */
export function useDomainsFetch() {
  const { data: user } = useUser()
  return useCallback(
    async <T,>(
      route: DomainsRoute,
      options: { query?: Record<string, string>; body?: unknown } = {},
    ): Promise<T> => {
      const query = options.query ? `?${new URLSearchParams(options.query).toString()}` : ''
      const response = await authorizedFetch(user, `/api/${route}${query}`, {
        method: options.body === undefined ? 'GET' : 'POST',
        headers: options.body === undefined ? {} : { 'Content-Type': 'application/json' },
        ...(options.body === undefined ? {} : { body: JSON.stringify(options.body) }),
      })
      const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
      if (!response.ok) {
        throw new DomainsRequestError(
          String(payload['error'] ?? 'Something went wrong. Try again.'),
          response.status,
          payload,
        )
      }
      return payload as T
    },
    [user],
  )
}

export interface DomainOfferView {
  domain: string
  available: boolean
  firstYearCents: number
  listFirstYearCents: number
  renewalCents: number
  freeFirstYear: boolean
}

export interface RegistrationsAnswer {
  configured: boolean
  billingPermission: boolean
  canBuy: boolean
  refusal: { code: string; message: string } | null
  freeYearAvailable: boolean
  registrations: DomainRegistrationView[]
  unassigned: DomainRegistrationView[]
  contactDefaults: { firstName: string; lastName: string; email: string }
}

export function formatMoney(cents: number): string {
  return `$${(Math.max(0, cents) / 100).toFixed(2)}`
}

export function formatDay(ms: number | null | undefined): string {
  if (!ms) return ''
  return new Date(ms).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  })
}
