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
import { useCallback, useEffect, useRef, useState } from 'react'
import type { AiStepKind } from '../providers/catalog'
import type { AiModelOption } from '../providers/model-choice'

/**
 * THE MODEL SWITCH'S STATE (AGL-2942): the reader's pick for one surface,
 * remembered per person per workspace per surface, and the options the
 * server lists for it — fetched when the switch is OPENED, never on mount,
 * because the panel mounts on every console page.
 *
 * `null` is Auto. A remembered pick the server no longer lists — the plan
 * changed, a manager narrowed an allowlist — falls back to Auto the moment
 * the options arrive, and a door would have run the request on Auto anyway:
 * the server decides again inside each request, so the remembered value is
 * a preference, never a grant.
 */

/** Where a pick is remembered: the chat, the copy rewrite, a section, a job. */
export type AiModelSurface = 'assist' | 'copy' | 'section' | 'jobs'

export interface AiModelOptionsWire {
  kind: AiStepKind
  auto: (AiModelOption & { model: string }) | null
  options: AiModelOption[]
  measured: boolean
}

export type AiModelOptionsStatus = 'idle' | 'loading' | 'ready' | 'refused' | 'error'

interface Remembered {
  id: string
  label: string
}

const storageKey = (uid: string, orgId: string, surface: AiModelSurface) =>
  `aglyn-ai-model:${uid}:${orgId}:${surface}`

function readRemembered(uid: string, orgId: string, surface: AiModelSurface): Remembered | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(uid, orgId, surface))
    const parsed = raw ? (JSON.parse(raw) as Partial<Remembered>) : null
    return parsed && typeof parsed.id === 'string' && typeof parsed.label === 'string'
      ? { id: parsed.id, label: parsed.label }
      : null
  } catch {
    return null
  }
}

function writeRemembered(
  uid: string,
  orgId: string,
  surface: AiModelSurface,
  value: Remembered | null,
): void {
  try {
    const key = storageKey(uid, orgId, surface)
    if (value) globalThis.localStorage?.setItem(key, JSON.stringify(value))
    else globalThis.localStorage?.removeItem(key)
  } catch {
    // A pick that cannot be remembered still applies to this page.
  }
}

/** One options read per reader, workspace, site and kind, shared by every mount. */
const optionReads = new Map<string, Promise<{ status: AiModelOptionsStatus; data: AiModelOptionsWire | null }>>()

/** Forget every read; specs start each case from nothing. */
export function resetAiModelOptionReadsForTests(): void {
  optionReads.clear()
}

export interface AiModelChoiceState {
  /** The pick to send, or `null` for Auto. */
  model: string | null
  /** The pick's label as last listed, for the button before options load. */
  label: string
  options: AiModelOptionsWire | null
  status: AiModelOptionsStatus
  /** Read the options — the switch calls this when it opens. */
  load: () => void
  select: (option: { id: string; label: string } | null) => void
}

export function useAiModelChoice(input: {
  orgId?: string | null
  hostId?: string | null
  surface: AiModelSurface
  kind: AiStepKind
}): AiModelChoiceState {
  const { orgId, surface, kind } = input
  const hostId = input.hostId ?? ''
  const { data: user } = useUser()
  const uid = user?.uid ?? null
  const userRef = useRef(user)
  userRef.current = user
  const [remembered, setRemembered] = useState<Remembered | null>(null)
  const [options, setOptions] = useState<AiModelOptionsWire | null>(null)
  const [status, setStatus] = useState<AiModelOptionsStatus>('idle')

  useEffect(() => {
    setRemembered(uid && orgId ? readRemembered(uid, orgId, surface) : null)
    setOptions(null)
    setStatus('idle')
  }, [uid, orgId, surface])

  const select = useCallback(
    (option: { id: string; label: string } | null) => {
      const value = option ? { id: option.id, label: option.label } : null
      setRemembered(value)
      if (uid && orgId) writeRemembered(uid, orgId, surface, value)
    },
    [uid, orgId, surface],
  )

  const load = useCallback(() => {
    const signedIn = userRef.current
    if (!uid || !orgId || !signedIn) return
    const key = [uid, orgId, hostId, kind].join('\x00')
    let read = optionReads.get(key)
    if (!read) {
      const params = new URLSearchParams({ orgId, kind })
      if (hostId) params.set('hostId', hostId)
      read = authorizedFetch(signedIn, `/api/ai/models?${params.toString()}`)
        .then(async (response) => {
          if (response.status === 403) return { status: 'refused' as const, data: null }
          const payload = (await response.json().catch(() => null)) as AiModelOptionsWire | null
          return response.ok && payload
            ? { status: 'ready' as const, data: payload }
            : { status: 'error' as const, data: null }
        })
        .catch(() => ({ status: 'error' as const, data: null }))
      optionReads.set(key, read)
      // A failed read is not cached: the next open asks again.
      void read.then((result) => {
        if (result.status === 'error') optionReads.delete(key)
      })
    }
    setStatus((current) => (current === 'ready' ? current : 'loading'))
    void read.then((result) => {
      setStatus(result.status)
      setOptions(result.data)
    })
  }, [uid, orgId, hostId, kind])

  // A remembered pick the server no longer lists is Auto again.
  useEffect(() => {
    if (status !== 'ready' || !options || !remembered) return
    if (!options.options.some((option) => option.id === remembered.id)) select(null)
  }, [status, options, remembered, select])

  return {
    model: remembered?.id ?? null,
    label: remembered?.label ?? 'Auto',
    options,
    status,
    load,
    select,
  }
}
