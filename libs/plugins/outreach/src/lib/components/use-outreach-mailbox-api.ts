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
import { OUTREACH_API_ROUTES } from '../constants/api-routes'
import type {
  OutreachApiRefusalReason,
  OutreachConnectCompleteResponse,
  OutreachConnectResponse,
  OutreachMailboxAvailability,
  OutreachMailboxDisconnectResponse,
  OutreachMailboxResponse,
  OutreachMailboxSettingsRequest,
  OutreachMailboxTestResponse,
} from '../mailboxes/mailbox-api'

/** A mailbox route's refusal, carrying the sentence and the stable reason. */
export class OutreachApiError extends Error {
  readonly reason: OutreachApiRefusalReason | 'unreachable'
  readonly status: number

  constructor(message: string, reason: OutreachApiRefusalReason | 'unreachable', status: number) {
    super(message)
    this.name = 'OutreachApiError'
    this.reason = reason
    this.status = status
  }
}

/** The mailbox routes, as the Mailboxes panel calls them. */
export interface OutreachMailboxApi {
  availability(): Promise<OutreachMailboxAvailability>
  /** Google's consent address for a new connect, or a reconnect. */
  connect(): Promise<string>
  complete(input: { code: string; state: string; timezone?: string }): Promise<OutreachConnectCompleteResponse>
  saveSettings(
    input: Omit<OutreachMailboxSettingsRequest, 'orgId'>,
  ): Promise<OutreachMailboxResponse>
  setPaused(mailboxId: string, paused: boolean): Promise<OutreachMailboxResponse>
  sendTest(mailboxId: string): Promise<OutreachMailboxTestResponse>
  disconnect(mailboxId: string): Promise<OutreachMailboxDisconnectResponse>
}

/**
 * The Mailboxes panel's one door to the mailbox routes (AGL-2978), with the
 * member's session attached and the organization named on every call — the
 * dispatcher's release gate reads it. A refusal is thrown as an
 * {@link OutreachApiError} carrying the route's own sentence, which is
 * written for the person reading it.
 */
export function useOutreachMailboxApi(orgId: string | null): OutreachMailboxApi {
  const { data: user } = useUser()

  const call = useCallback(
    async <T>(route: string, init: { method: 'GET' | 'POST'; body?: Record<string, unknown> }): Promise<T> => {
      if (!orgId) throw new OutreachApiError('Open an organization first.', 'org-required', 400)
      const path =
        init.method === 'GET'
          ? `/api/${route}?orgId=${encodeURIComponent(orgId)}`
          : `/api/${route}`
      const response = await authorizedFetch(user, path, {
        method: init.method,
        ...(init.method === 'POST'
          ? {
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ orgId, ...init.body }),
            }
          : {}),
      })
      const payload = (await response.json().catch(() => null)) as
        | (T & { error?: undefined })
        | { error?: string; reason?: OutreachApiRefusalReason }
        | null
      if (!response.ok || !payload) {
        const refusal = (payload ?? {}) as { error?: string; reason?: OutreachApiRefusalReason }
        throw new OutreachApiError(
          refusal.error || 'Sequences could not be reached. Try again.',
          refusal.reason ?? 'unreachable',
          response.status,
        )
      }
      return payload as T
    },
    [user, orgId],
  )

  return useMemo<OutreachMailboxApi>(
    () => ({
      availability: () =>
        call<OutreachMailboxAvailability>(OUTREACH_API_ROUTES.mailboxesAvailability, { method: 'GET' }),
      connect: async () =>
        (await call<OutreachConnectResponse>(OUTREACH_API_ROUTES.mailboxesConnect, { method: 'POST' })).url,
      complete: (input) =>
        call<OutreachConnectCompleteResponse>(OUTREACH_API_ROUTES.mailboxesConnectComplete, {
          method: 'POST',
          body: input,
        }),
      saveSettings: (input) =>
        call<OutreachMailboxResponse>(OUTREACH_API_ROUTES.mailboxesSettings, {
          method: 'POST',
          body: input as unknown as Record<string, unknown>,
        }),
      setPaused: (mailboxId, paused) =>
        call<OutreachMailboxResponse>(OUTREACH_API_ROUTES.mailboxesStatus, {
          method: 'POST',
          body: { mailboxId, paused },
        }),
      sendTest: (mailboxId) =>
        call<OutreachMailboxTestResponse>(OUTREACH_API_ROUTES.mailboxesTest, {
          method: 'POST',
          body: { mailboxId },
        }),
      disconnect: (mailboxId) =>
        call<OutreachMailboxDisconnectResponse>(OUTREACH_API_ROUTES.mailboxesDisconnect, {
          method: 'POST',
          body: { mailboxId },
        }),
    }),
    [call],
  )
}
