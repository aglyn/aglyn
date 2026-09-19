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
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AiAllotmentMode } from '../model/ai-allotments'
import type { AiAllotmentsWire } from '../usage/ai-usage-wire'

/**
 * The AI allotments a card shows, through `/api/ai/allotments` (AGL-2942).
 *
 * Loading, answered, refused or failed — four states, for the reason
 * `use-org-ai-usage.ts` gives: the member page and the collaborators card are
 * open to people who may not read billing, and for them a 403 is the
 * ordinary answer, rendered as no card rather than a warning.
 *
 * One read per reader and question, shared by every mount that asks it — a
 * collaborators column mounts once per ROW — and every read is taken again
 * after a save, so the column, the site card and the Billing section agree
 * the moment one of them writes.
 */

export type AiAllotmentsStatus = 'loading' | 'ready' | 'refused' | 'error'

export interface AiAllotmentsState {
  status: AiAllotmentsStatus
  data: AiAllotmentsWire | null
  reload: () => void
}

interface Read {
  status: AiAllotmentsStatus
  data: AiAllotmentsWire | null
}

interface SharedRead {
  read: Read
  listeners: Set<(read: Read) => void>
  generation: number
  query: string
  user: Parameters<typeof authorizedFetch>[0]
}

const LOADING: Read = { status: 'loading', data: null }
const sharedReads = new Map<string, SharedRead>()

/** Forget every shared read; specs start each case from nothing. */
export function resetAiAllotmentReadsForTests(): void {
  sharedReads.clear()
}

function publish(entry: SharedRead, read: Read): void {
  entry.read = read
  for (const listener of entry.listeners) listener(read)
}

async function readInto(entry: SharedRead): Promise<void> {
  entry.generation += 1
  const generation = entry.generation
  publish(entry, { status: 'loading', data: entry.read.data })
  try {
    const response = await authorizedFetch(entry.user, `/api/ai/allotments?${entry.query}`)
    if (generation !== entry.generation) return
    if (response.status === 403 || response.status === 404) {
      publish(entry, { status: 'refused', data: null })
      return
    }
    const payload = (await response.json().catch(() => null)) as AiAllotmentsWire | null
    if (generation !== entry.generation) return
    publish(
      entry,
      response.ok && payload ? { status: 'ready', data: payload } : { status: 'error', data: null },
    )
  } catch {
    if (generation === entry.generation) publish(entry, { status: 'error', data: null })
  }
}

/** Read every allotments question again — after a save. */
export function reloadAllAiAllotments(): void {
  for (const entry of sharedReads.values()) {
    if (entry.listeners.size) void readInto(entry)
  }
}

export function useAiAllotments(input: {
  orgId?: string | null
  hostId?: string | null
  uid?: string | null
  enabled?: boolean
}): AiAllotmentsState {
  const { data: user } = useUser()
  const signedInUid = user?.uid ?? null
  const userRef = useRef(user)
  userRef.current = user
  const orgId = input.orgId ?? ''
  const hostId = input.hostId ?? ''
  const subjectUid = input.uid ?? ''
  const enabled = input.enabled !== false && Boolean(orgId || hostId)
  const key =
    signedInUid && enabled ? [signedInUid, orgId, hostId, subjectUid].join('\x00') : null
  const query = useMemo(() => {
    const params = new URLSearchParams()
    if (orgId) params.set('orgId', orgId)
    if (hostId) params.set('hostId', hostId)
    if (subjectUid) params.set('uid', subjectUid)
    return params.toString()
  }, [orgId, hostId, subjectUid])
  const [read, setRead] = useState<Read>(() => (key ? sharedReads.get(key)?.read : undefined) ?? LOADING)

  useEffect(() => {
    const signedIn = userRef.current
    if (!key || !signedIn) return undefined
    let entry = sharedReads.get(key)
    if (!entry) {
      entry = { read: LOADING, listeners: new Set(), generation: 0, query, user: signedIn }
      sharedReads.set(key, entry)
    }
    const shared = entry
    shared.user = signedIn
    const first = shared.listeners.size === 0
    shared.listeners.add(setRead)
    setRead(shared.read)
    if (first) void readInto(shared)
    return () => {
      shared.listeners.delete(setRead)
    }
  }, [key, query])

  const reload = useCallback(() => {
    const entry = key ? sharedReads.get(key) : undefined
    if (entry) void readInto(entry)
  }, [key])

  return { status: key ? read.status : 'loading', data: key ? read.data : null, reload }
}

/** One allotment a save sets. */
export interface AiAllotmentSetInput {
  subject: string
  credits: number | null
  mode: AiAllotmentMode
  models: string[] | null
}

/** Set, remove, or set on every site — then every card reads again. */
export async function saveAiAllotments(
  user: Parameters<typeof authorizedFetch>[0],
  body: {
    orgId: string
    set?: AiAllotmentSetInput[]
    remove?: string[]
    everySite?: Omit<AiAllotmentSetInput, 'subject'> | null
  },
): Promise<{ ok: boolean; error: string | null }> {
  try {
    const response = await authorizedFetch(user, '/api/ai/allotments', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    const payload = (await response.json().catch(() => null)) as { error?: string } | null
    if (!response.ok) {
      return { ok: false, error: payload?.error ?? 'The allotment could not be saved — try again.' }
    }
    reloadAllAiAllotments()
    return { ok: true, error: null }
  } catch {
    return { ok: false, error: 'The allotment could not be saved — check your connection and try again.' }
  }
}
