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

import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useRef } from 'react'
import {
  describeCallFailure,
  resolveIdToken,
  type TokenSource,
} from '@aglyn/shared-util-http/authorized-token'

/** What one call answered with. `payload` is `{}` on an unparseable body. */
export interface SendingApiResult {
  response: Response
  payload: Record<string, any>
}

/**
 * A refusal the caller reads the same way it reads the route's own.
 *
 * `401` because that is what the request would have been answered with had it
 * gone out, and the reason travels in `payload.error`, which is the field
 * every caller already renders.
 */
const refusedForCaller = (message: string): SendingApiResult => ({
  response: {
    ok: false,
    status: 401,
    json: async () => ({ error: message }),
  } as unknown as Response,
  payload: { error: message },
})

/** One DNS record, exactly as the server issued it. */
export interface SendingDnsRecordView {
  type: 'TXT' | 'MX'
  name: string
  value: string
  priority?: number
  purpose: 'spf' | 'dkim' | 'return-path' | 'dmarc'
  required: boolean
  note: string
}

/** One org sending domain, as the domains route reports it. */
export interface SendingDomainView {
  domain: string
  status: 'requested' | 'records-issued' | 'verified' | 'failed'
  records?: SendingDnsRecordView[]
  lines?: string[]
  lastMissing?: string[] | null
  lastIssueError?: string | null
  verifiedAtMs?: number | null
  lastCheckedAtMs?: number | null
  dmarc?: {
    policy: 'reject' | 'quarantine' | 'none' | 'absent'
    record: string | null
    consequence: string
  } | null
  dmarcSuggestion?: SendingDnsRecordView | null
  pendingProvider?: boolean
  providerDetail?: string | null
}

/** What this site sends as, and what it is allowed to send as. */
export interface SendingIdentityView {
  orgId: string | null
  selected: string
  localPart: string
  identity: string
  identitySource: 'custom' | 'platform' | null
  refusal: {
    code: string
    domain: string | null
    message: string
    missing: string[]
  } | null
  options: {
    value: string
    from: string | null
    selectable: boolean
    status: string
  }[]
  domains: {
    domain: string
    status: SendingDomainView['status']
    verifiedAtMs: number | null
    lastCheckedAtMs: number | null
  }[]
  canManage: boolean
  entitled: boolean
}

/**
 * ONE AUTHORIZED CALL TO THE SENDING-IDENTITY AND SENDING-DOMAIN ROUTES.
 *
 * The same shape as `useCampaignSendApi`, including why the user is held in a
 * ref: this callback is a dependency of effects that load on open, and the
 * user object is a new object on most renders, so depending on it directly
 * would re-issue the request on every render of the surface. The token is
 * fetched at call time either way.
 *
 * The two paths are fixed here rather than taken as an argument, for the
 * reason the campaign hook gives: a hook that accepted a URL from a component
 * would be a way to post the console's credentials somewhere the console does
 * not own.
 *
 * The token is obtained under a deadline, for the reason `useCampaignApi`
 * gives: it is awaited in front of the request, so an unbounded refresh is a
 * call that never reaches `fetch` and never reports anything.
 *
 * ## An unobtainable token ANSWERS here rather than throwing
 *
 * Unlike the campaign hook, whose callers must tell a send that never left
 * the browser apart from one the route refused. Everything on this side reads
 * or edits a configuration surface, where both are the same news to the
 * reader — and every caller already renders `payload.error` on a refusal, so
 * answering in that shape is what puts the real reason on screen and leaves
 * the button that started the call usable.
 */
export function useSendingApi() {
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user

  return useCallback(
    async (options: {
      path: 'sending-identity' | 'sending-domains'
      method: 'GET' | 'POST' | 'DELETE'
      query?: Record<string, string>
      body?: Record<string, unknown>
    }): Promise<SendingApiResult> => {
      let idToken: string
      try {
        idToken = await resolveIdToken(
          userRef.current as TokenSource | null | undefined,
        )
      } catch (error) {
        return refusedForCaller(
          describeCallFailure(error, 'Your sign-in could not be confirmed'),
        )
      }
      const search = new URLSearchParams(options.query ?? {}).toString()
      const response = await fetch(
        `/api/email/${options.path}${search ? `?${search}` : ''}`,
        {
          method: options.method,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${idToken}`,
          },
          ...(options.body ? { body: JSON.stringify(options.body) } : {}),
        },
      )
      const json = await response.json().catch(() => ({}))
      return { response, payload: json as Record<string, any> }
    },
    [],
  )
}
