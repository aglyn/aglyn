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
import { useCallback, useMemo } from 'react'
import { ACCOUNTING_API_ROUTES } from '../constants/api-routes'
import type {
  AccountingConnectionView,
  AccountingLogResponse,
  AccountingMapping,
  AccountingOptionsResponse,
  AccountingProviderId,
  AccountingRefusalReason,
  AccountingStatusResponse,
} from '../model/accounting.types'

/** A route's refusal, with its sentence and its stable reason. */
export class AccountingRouteError extends Error {
  readonly reason: AccountingRefusalReason | 'unreachable'
  readonly status: number

  constructor(message: string, reason: AccountingRouteError['reason'], status: number) {
    super(message)
    this.name = 'AccountingRouteError'
    this.reason = reason
    this.status = status
  }

  /** "You can't use this here", rather than something that went wrong. */
  get refused(): boolean {
    return ['permission', 'entitlement', 'not-org-wide', 'not-a-member', 'not-found'].includes(this.reason)
  }
}

/** The routes, as the Accounting page calls them. */
export interface AccountingApi {
  status(): Promise<AccountingStatusResponse>
  connect(provider: AccountingProviderId): Promise<{ url: string }>
  completeConnect(input: { code: string; state: string; realmId?: string }): Promise<{ connection: AccountingConnectionView }>
  selectTenant(tenantId: string): Promise<{ connection: AccountingConnectionView }>
  options(): Promise<AccountingOptionsResponse>
  saveSettings(mapping: AccountingMapping): Promise<{ connection: AccountingConnectionView }>
  log(input: { filter: 'all' | 'attention'; before?: number | null }): Promise<AccountingLogResponse>
  retry(input: { itemId: string } | { all: true }): Promise<{ retried: number }>
  disconnect(): Promise<{ disconnected: boolean; revoked?: boolean }>
}

export function useAccountingApi(orgId: string | null): AccountingApi {
  const { data: user } = useUser()

  const call = useCallback(
    async <T>(route: string, init: { method: 'GET' | 'POST'; query?: Record<string, string>; body?: Record<string, unknown> }) => {
      if (!orgId) throw new AccountingRouteError('Open an organization first.', 'org-required', 400)
      const query = new URLSearchParams({ orgId, ...(init.query ?? {}) }).toString()
      const path = init.method === 'GET' ? `/api/${route}?${query}` : `/api/${route}`
      let response: Response
      try {
        response = await authorizedFetch(user, path, {
          method: init.method,
          ...(init.method === 'POST'
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ orgId, ...init.body }) }
            : {}),
        })
      } catch {
        throw new AccountingRouteError('Accounting could not be reached. Try again.', 'unreachable', 0)
      }
      const payload = (await response.json().catch(() => null)) as { error?: string; reason?: string } | null
      if (!response.ok) {
        throw new AccountingRouteError(
          payload?.error ?? 'Something went wrong. Try again.',
          (payload?.reason as AccountingRefusalReason | undefined) ?? (response.status === 404 ? 'not-found' : 'invalid-request'),
          response.status,
        )
      }
      return payload as T
    },
    [orgId, user],
  )

  return useMemo<AccountingApi>(
    () => ({
      status: () => call(ACCOUNTING_API_ROUTES.status, { method: 'GET' }),
      connect: (provider) => call(ACCOUNTING_API_ROUTES.connect, { method: 'POST', body: { provider } }),
      completeConnect: (input) => call(ACCOUNTING_API_ROUTES.connectComplete, { method: 'POST', body: { ...input } }),
      selectTenant: (tenantId) => call(ACCOUNTING_API_ROUTES.selectTenant, { method: 'POST', body: { tenantId } }),
      options: () => call(ACCOUNTING_API_ROUTES.options, { method: 'GET' }),
      saveSettings: (mapping) => call(ACCOUNTING_API_ROUTES.settings, { method: 'POST', body: { mapping } }),
      log: ({ filter, before }) =>
        call(ACCOUNTING_API_ROUTES.log, {
          method: 'GET',
          query: { filter, ...(before ? { before: String(before) } : {}) },
        }),
      retry: (input) => call(ACCOUNTING_API_ROUTES.retry, { method: 'POST', body: { ...input } }),
      disconnect: () => call(ACCOUNTING_API_ROUTES.disconnect, { method: 'POST' }),
    }),
    [call],
  )
}
