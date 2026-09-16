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

import {
  MEMBER_EMAIL_ALIASES_ROUTE,
  type MemberEmailAliasRow,
} from '@aglyn/aglyn/app-utils/member-email-aliases'
import {
  authorizedFetch,
  type TokenSource,
} from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useRef, useState } from 'react'

/** What one change answered: done, with what the route said, or refused and why. */
export type MemberEmailAliasChange =
  | { ok: true; payload: Record<string, any> }
  | { ok: false; error: string }

export interface MemberEmailAliases {
  status: 'idle' | 'loading' | 'ready' | 'error'
  aliases: MemberEmailAliasRow[]
  /** The address the member signs in with, which already counts as theirs. */
  signInEmail: string | null
  error: string | null
  /** True while a change is in flight. */
  busy: boolean
  add: (address: string) => Promise<MemberEmailAliasChange>
  resend: (address: string) => Promise<MemberEmailAliasChange>
  remove: (address: string) => Promise<MemberEmailAliasChange>
  /** Confirms the address a link was sent for; the token names the workspace. */
  confirm: (token: string) => Promise<MemberEmailAliasChange>
}

const LOAD_FAILED = 'Your addresses could not be loaded.'
const CHANGE_FAILED = 'That change could not be made.'

/**
 * The signed-in member's own addresses in one workspace (AGL-2975), from
 * the core route every surface shares. A list the member keeps for
 * themselves, so it is read through the route rather than a listener: the
 * rules close the collection to every client.
 *
 * Every change re-reads the list, so a row's state is always the stored
 * one — an add that could not send its email still shows the address,
 * waiting, with a way to send again. The page the member is on rides along
 * as the path the confirmation link should land on.
 */
export function useMemberEmailAliases(
  orgId: string | null,
  options: { enabled: boolean },
): MemberEmailAliases {
  const { enabled } = options
  const { data: user } = useUser()
  const userRef = useRef(user)
  userRef.current = user
  const [state, setState] = useState<
    Pick<MemberEmailAliases, 'status' | 'aliases' | 'signInEmail' | 'error'>
  >({ status: 'idle', aliases: [], signInEmail: null, error: null })
  const [busy, setBusy] = useState(false)

  const request = useCallback(
    async (method: 'GET' | 'POST' | 'DELETE', body?: Record<string, unknown>) => {
      const url =
        method === 'GET'
          ? `${MEMBER_EMAIL_ALIASES_ROUTE}?orgId=${encodeURIComponent(orgId ?? '')}`
          : MEMBER_EMAIL_ALIASES_ROUTE
      const response = await authorizedFetch(
        userRef.current as TokenSource | null | undefined,
        url,
        {
          method,
          ...(body
            ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }
            : {}),
        },
      )
      const payload = (await response.json().catch(() => ({}))) as Record<string, any>
      return { response, payload }
    },
    [orgId],
  )

  const load = useCallback(async () => {
    if (!orgId) return
    try {
      const { response, payload } = await request('GET')
      if (!response.ok) {
        setState((prior) => ({ ...prior, status: 'error', error: String(payload['error'] ?? LOAD_FAILED) }))
        return
      }
      setState({
        status: 'ready',
        aliases: Array.isArray(payload['aliases']) ? (payload['aliases'] as MemberEmailAliasRow[]) : [],
        signInEmail: typeof payload['signInEmail'] === 'string' ? payload['signInEmail'] : null,
        error: null,
      })
    } catch (cause) {
      console.error(cause)
      setState((prior) => ({ ...prior, status: 'error', error: LOAD_FAILED }))
    }
  }, [orgId, request])

  useEffect(() => {
    if (!enabled || !orgId) return
    setState((prior) => ({ ...prior, status: prior.status === 'ready' ? 'ready' : 'loading' }))
    void load()
  }, [enabled, orgId, load])

  const change = useCallback(
    async (
      method: 'POST' | 'DELETE',
      body: Record<string, unknown>,
    ): Promise<MemberEmailAliasChange> => {
      setBusy(true)
      try {
        const { response, payload } = await request(method, body)
        // A refused change and an accepted one both move the stored list —
        // an add whose email could not leave is still on it.
        await load()
        if (!response.ok && payload['ok'] !== true) {
          return { ok: false, error: String(payload['error'] ?? CHANGE_FAILED) }
        }
        if (payload['sent'] === false) {
          return { ok: false, error: String(payload['error'] ?? CHANGE_FAILED) }
        }
        return { ok: true, payload }
      } catch (cause) {
        console.error(cause)
        return { ok: false, error: CHANGE_FAILED }
      } finally {
        setBusy(false)
      }
    },
    [request, load],
  )

  const returnPath = () => (typeof window === 'undefined' ? '/' : window.location.pathname)

  const add = useCallback(
    (address: string) => change('POST', { orgId, action: 'add', address, returnPath: returnPath() }),
    [change, orgId],
  )
  const resend = useCallback(
    (address: string) => change('POST', { orgId, action: 'resend', address, returnPath: returnPath() }),
    [change, orgId],
  )
  const remove = useCallback(
    (address: string) => change('DELETE', { orgId, address }),
    [change, orgId],
  )
  const confirm = useCallback(
    (token: string) => change('POST', { action: 'confirm', token }),
    [change],
  )

  return { ...state, busy, add, resend, remove, confirm }
}

export default useMemberEmailAliases
