'use client'

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
import { useUser } from '@aglyn/tenant-feature-instance'
import { useMemo } from 'react'
import { PHONE_API_ROUTES } from '../constants/api-routes'
import type {
  PhoneCall,
  PhoneCompliance,
  PhoneComplianceForm,
  PhoneMessage,
  PhoneNumberKind,
  PhoneNumberRecord,
  PhonePortRequest,
  PhoneSettings,
  PhoneThread,
} from '../model/phone.types'

/** A refusal from a Phone route, with the stable reason the page branches on. */
export class PhoneRouteError extends Error {
  constructor(
    message: string,
    readonly reason: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'PhoneRouteError'
  }
}

export interface PhoneStatus {
  configured: boolean
  hasAccount: boolean
  numbers: PhoneNumberRecord[]
  compliance: PhoneCompliance | null
  settings: PhoneSettings
  ports: PhonePortRequest[]
  /** The signed-in member's own cell, as they last gave it to Call. */
  myCell: string | null
  canManage: boolean
}

export interface PhoneAvailableNumber {
  e164: string
  friendlyName: string
  locality: string | null
  region: string | null
}

export interface PhoneApi {
  status(): Promise<PhoneStatus>
  searchNumbers(query: { kind: PhoneNumberKind; areaCode?: string; contains?: string }): Promise<PhoneAvailableNumber[]>
  buyNumber(input: { e164: string; kind: PhoneNumberKind; hostId: string; label: string }): Promise<PhoneNumberRecord>
  updateNumber(input: { numberId: string; label?: string; hostId?: string }): Promise<PhoneNumberRecord>
  releaseNumber(numberId: string): Promise<void>
  threads(options?: { archived?: boolean; before?: number | null }): Promise<PhoneThread[]>
  thread(threadId: string): Promise<{ thread: PhoneThread; messages: PhoneMessage[]; calls: PhoneCall[] }>
  archiveThread(threadId: string, archived: boolean): Promise<void>
  send(input: { threadId?: string; to?: string; numberId?: string; body: string }): Promise<{ thread: PhoneThread; message: PhoneMessage }>
  saveSettings(settings: PhoneSettings): Promise<PhoneSettings>
  saveCompliance(form: PhoneComplianceForm, submit: boolean): Promise<PhoneCompliance>
  refreshCompliance(): Promise<PhoneCompliance | null>
  requestPort(input: Record<string, unknown>): Promise<PhonePortRequest>
  calls(): Promise<PhoneCall[]>
  placeCall(input: { to: string; memberCell: string; numberId?: string }): Promise<PhoneCall>
}

async function readAnswer<T>(response: Response): Promise<T> {
  const body = (await response.json().catch(() => null)) as Record<string, unknown> | null
  if (!response.ok) {
    throw new PhoneRouteError(
      typeof body?.['error'] === 'string' ? body['error'] : 'Phone could not be reached. Try again.',
      response.status === 404 ? 'not-found' : typeof body?.['reason'] === 'string' ? body['reason'] : 'unreachable',
      response.status,
    )
  }
  return (body ?? {}) as T
}

/** Phone's routes for one workspace, as the console pages call them. */
export function usePhoneApi(orgId: string | null): PhoneApi | null {
  const { data: user } = useUser()
  return useMemo(() => {
    if (!orgId || !user) return null
    const get = async <T>(route: string, query: Record<string, string> = {}) => {
      const search = new URLSearchParams({ orgId, ...query }).toString()
      return readAnswer<T>(await authorizedFetch(user, `/api/${route}?${search}`, { method: 'GET' }))
    }
    const post = async <T>(route: string, body: Record<string, unknown>) =>
      readAnswer<T>(
        await authorizedFetch(user, `/api/${route}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ orgId, ...body }),
        }),
      )
    const r = PHONE_API_ROUTES
    return {
      status: () => get<PhoneStatus>(r.status),
      searchNumbers: async (query) => (await post<{ numbers: PhoneAvailableNumber[] }>(r.numbersSearch, query)).numbers,
      buyNumber: async (input) => (await post<{ number: PhoneNumberRecord }>(r.numbersBuy, input)).number,
      updateNumber: async (input) => (await post<{ number: PhoneNumberRecord }>(r.numbersUpdate, input)).number,
      releaseNumber: async (numberId) => {
        await post(r.numbersRelease, { numberId })
      },
      threads: async (options = {}) =>
        (
          await get<{ threads: PhoneThread[] }>(r.threads, {
            ...(options.archived ? { archived: '1' } : {}),
            ...(options.before ? { before: String(options.before) } : {}),
          })
        ).threads,
      thread: (threadId) => get(r.thread, { threadId }),
      archiveThread: async (threadId, archived) => {
        await post(r.threadArchive, { threadId, archived })
      },
      send: (input) => post(r.send, input),
      saveSettings: async (settings) => (await post<{ settings: PhoneSettings }>(r.settings, { settings })).settings,
      saveCompliance: async (form, submit) =>
        (await post<{ compliance: PhoneCompliance }>(r.compliance, { form, submit })).compliance,
      refreshCompliance: async () => (await post<{ compliance: PhoneCompliance | null }>(r.complianceRefresh, {})).compliance,
      requestPort: async (input) => (await post<{ port: PhonePortRequest }>(r.ports, input)).port,
      calls: async () => (await get<{ calls: PhoneCall[] }>(r.calls)).calls,
      placeCall: async (input) => (await post<{ call: PhoneCall }>(r.callsPlace, input)).call,
    } satisfies PhoneApi
  }, [orgId, user])
}
