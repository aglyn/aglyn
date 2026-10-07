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
import type { FunnelInventory } from '../model/funnel-inventory'
import type { FunnelDefinition, FunnelResult } from '../model/funnels.types'

/**
 * The card's calls to the plugin's own console doors (AGL-3605). Each answers
 * the payload, or throws an `Error` whose message is the door's sentence.
 */

type User = Parameters<typeof authorizedFetch>[0]

async function post<T>(user: User, path: string, body: Record<string, unknown>): Promise<T> {
  const response = await authorizedFetch(user, `/api/funnels/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const payload = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(String(payload?.error ?? 'Something went wrong. Try again.'))
  }
  return payload as T
}

export const fetchFunnelInventory = (user: User, hostId: string) =>
  post<{ inventory: FunnelInventory }>(user, 'inventory', { hostId }).then((body) => body.inventory)

export const saveFunnel = (
  user: User,
  hostId: string,
  funnel: FunnelDefinition,
  funnelId?: string | null,
) =>
  post<{ funnelId: string; recordingChanged: boolean }>(user, 'save', {
    hostId,
    funnel,
    ...(funnelId ? { funnelId } : {}),
  })

export const deleteFunnel = (user: User, hostId: string, funnelId: string) =>
  post<{ deleted: boolean; recordingChanged: boolean }>(user, 'delete', { hostId, funnelId })

export const fetchFunnelResult = (
  user: User,
  hostId: string,
  funnelId: string,
  from: string,
  to: string,
  fresh = false,
) =>
  post<{ result: FunnelResult }>(user, 'results', { hostId, funnelId, from, to, fresh }).then(
    (body) => body.result,
  )

export const proposeFunnel = (user: User, hostId: string, brief: string) =>
  post<{ draft: FunnelDefinition; dropped: string[] }>(user, 'propose', { hostId, brief })

export const draftDropOffAutomation = (
  user: User,
  hostId: string,
  funnelId: string,
  step: number,
  afterHours: number,
  action: 'email' | 'task',
) =>
  post<{ automationId: string; name: string; replayed: boolean }>(user, 'act', {
    hostId,
    funnelId,
    step,
    afterHours,
    action,
  })

/** The last `days` UTC days, ending today, as the results door reads a range. */
export function recentRange(days: number, now: number = Date.now()): { from: string; to: string } {
  const day = (ms: number) => new Date(ms).toISOString().slice(0, 10)
  return { from: day(now - (days - 1) * 86_400_000), to: day(now) }
}
