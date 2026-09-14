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

import { aiUsageMonthKeys } from '../model/ai-usage-by-user'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { OrgAiUsageTableWire } from '../usage/ai-usage-wire'

/**
 * Loading, answered, refused, or failed — four states, never three
 * (AGL-2928).
 *
 * `refused` is its own state because three surfaces read this and only one
 * of them is gated on the permission the route checks: the roster and the
 * site collaborators card are open to a member who manages people and may
 * not see billing, and for them a 403 is the ordinary answer — the column
 * renders a dash, not an error. Folding it into `error` would paint a
 * warning on every team page whose admin lacks `billing.view`.
 */
export type OrgAiUsageStatus = 'loading' | 'ready' | 'refused' | 'error'

export interface OrgAiUsageState {
  status: OrgAiUsageStatus
  data: OrgAiUsageTableWire | null
  /** The month the table describes, whether or not it has answered yet. */
  month: string
  /** The months a reader may pick, newest first. */
  months: string[]
  /** Credits by uid for the month — the roster column's join. */
  creditsByUid: Map<string, number>
  /** Credits on the named site by uid, when a site was named. */
  hostCreditsByUid: Map<string, number>
  /** Reads the month again, for every mount sharing it. */
  reload: () => void
}

interface OrgAiUsageRead {
  status: OrgAiUsageStatus
  data: OrgAiUsageTableWire | null
}

/**
 * One read of one month, shared by every mount that asks for it.
 *
 * A roster column is mounted once per ROW, so a read per mount would send
 * one request per member for the same table. Mounts of the same reader, org,
 * month and site subscribe to one entry instead: the first subscriber reads,
 * the rest take its answer, and `reload` reads again for all of them. An
 * answer that arrives after a newer read has started is dropped.
 */
interface SharedRead {
  read: OrgAiUsageRead
  listeners: Set<(read: OrgAiUsageRead) => void>
  generation: number
}

const LOADING: OrgAiUsageRead = { status: 'loading', data: null }

const sharedReads = new Map<string, SharedRead>()

/** Forget every shared read; specs start each case from nothing. */
export function resetOrgAiUsageReadsForTests(): void {
  sharedReads.clear()
}

function publish(entry: SharedRead, read: OrgAiUsageRead): void {
  entry.read = read
  for (const listener of entry.listeners) listener(read)
}

async function readInto(
  entry: SharedRead,
  user: Parameters<typeof authorizedFetch>[0],
  query: string,
): Promise<void> {
  entry.generation += 1
  const generation = entry.generation
  publish(entry, { status: 'loading', data: entry.read.data })
  try {
    const response = await authorizedFetch(user, `/api/ai/usage?${query}`)
    if (generation !== entry.generation) return
    if (response.status === 403) {
      publish(entry, { status: 'refused', data: null })
      return
    }
    const payload = await response.json().catch(() => null)
    if (generation !== entry.generation) return
    if (!response.ok || !payload) {
      publish(entry, { status: 'error', data: null })
      return
    }
    publish(entry, { status: 'ready', data: payload as OrgAiUsageTableWire })
  } catch {
    if (generation === entry.generation) publish(entry, { status: 'error', data: null })
  }
}

/**
 * One month of the per-user rollup for one org, through `/api/ai/usage`.
 *
 * Pass `hostId` to have each row carry its credits on that site. Pass
 * `enabled: false` to hold the read — a card that is not yet sure of its
 * org id, or a viewer the gate has already refused.
 */
export function useOrgAiUsage(
  orgId: string | null | undefined,
  options: { month?: string; hostId?: string; enabled?: boolean } = {},
): OrgAiUsageState {
  const { data: user } = useUser()
  // The read is keyed on WHO is signed in, not on the user object's identity:
  // a provider (or a test double) that hands back a fresh object per render
  // would otherwise re-run the effect on every paint and never settle.
  const uid = user?.uid ?? null
  const userRef = useRef(user)
  userRef.current = user
  const fallbackMonths = useMemo(() => aiUsageMonthKeys(), [])
  const month = options.month ?? fallbackMonths[0]
  const hostId = options.hostId ?? ''
  const enabled = options.enabled !== false
  const key = orgId && uid && enabled ? [uid, orgId, month, hostId].join('\x00') : null
  const query = useMemo(() => {
    if (!orgId) return ''
    const params = new URLSearchParams({ orgId, month })
    if (hostId) params.set('hostId', hostId)
    return params.toString()
  }, [orgId, month, hostId])
  const [read, setRead] = useState<OrgAiUsageRead>(
    () => (key ? sharedReads.get(key)?.read : undefined) ?? LOADING,
  )

  useEffect(() => {
    const signedIn = userRef.current
    if (!key || !signedIn) return undefined
    let entry = sharedReads.get(key)
    if (!entry) {
      entry = { read: LOADING, listeners: new Set(), generation: 0 }
      sharedReads.set(key, entry)
    }
    const shared = entry
    const first = shared.listeners.size === 0
    shared.listeners.add(setRead)
    setRead(shared.read)
    if (first) void readInto(shared, signedIn, query)
    return () => {
      shared.listeners.delete(setRead)
    }
  }, [key, query])

  const reload = useCallback(() => {
    const signedIn = userRef.current
    const entry = key ? sharedReads.get(key) : undefined
    if (entry && signedIn) void readInto(entry, signedIn, query)
  }, [key, query])

  const creditsByUid = useMemo(
    () => new Map((read.data?.rows ?? []).map((row) => [row.uid, row.credits])),
    [read.data],
  )
  const hostCreditsByUid = useMemo(
    () =>
      new Map(
        (read.data?.rows ?? []).map((row) => [row.uid, row.hostCredits ?? 0]),
      ),
    [read.data],
  )

  return {
    status: key ? read.status : 'loading',
    data: key ? read.data : null,
    month,
    months: read.data?.months ?? fallbackMonths,
    creditsByUid,
    hostCreditsByUid,
    reload,
  }
}

export default useOrgAiUsage
