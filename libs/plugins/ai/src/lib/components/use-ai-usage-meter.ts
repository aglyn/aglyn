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
import { useCallback, useEffect, useState } from 'react'
import type { AiUsageMeterWire } from '../usage/ai-usage-wire'

/**
 * THE USAGE STRIP'S STORE (AGL-2942).
 *
 * Every AI door answers with a `meter` envelope — the chat door's `done`
 * event, the copy assistant's JSON, each refusal — and the surface that sent
 * the request hands it here. Every strip mounted for the same person and the
 * same workspace — the panel's, a dialog's — reads the latest one, so a
 * rewrite in the besigner moves the panel's strip too, and no strip ever
 * reads anything itself.
 *
 * The last envelope is kept in the browser for the rest of its month, so a
 * reload shows where the reader stood at their last request rather than an
 * empty strip until the next one. It is labeled as of that request by
 * construction: nothing refreshes it but a door's answer.
 *
 * Keyed on WHO is signed in, never on the user object, whose identity a
 * provider may hand back fresh on every render.
 */

type Listener = (meter: AiUsageMeterWire | null) => void

const meters = new Map<string, AiUsageMeterWire | null>()
const listeners = new Map<string, Set<Listener>>()

const keyOf = (uid: string, orgId: string): string => `${uid}\x00${orgId}`
const storageKey = (uid: string, orgId: string): string => `aglyn-ai-meter:${uid}:${orgId}`
const monthNow = (): string => new Date().toISOString().slice(0, 7)

/** Whether a value is an envelope a strip can render. */
export function isAiUsageMeterWire(value: unknown): value is AiUsageMeterWire {
  const meter = value as Partial<AiUsageMeterWire> | null
  return Boolean(
    meter &&
      typeof meter === 'object' &&
      typeof meter.month === 'string' &&
      typeof meter.pool?.used === 'number' &&
      typeof meter.mine?.used === 'number' &&
      typeof meter.state === 'string',
  )
}

function hydrate(uid: string, orgId: string): AiUsageMeterWire | null {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(uid, orgId))
    const parsed: unknown = raw ? JSON.parse(raw) : null
    return isAiUsageMeterWire(parsed) && parsed.month === monthNow() ? parsed : null
  } catch {
    return null
  }
}

/** Hand a door's envelope to every strip for this reader and workspace. */
export function publishAiUsageMeter(
  uid: string | null | undefined,
  orgId: string | null | undefined,
  meter: unknown,
): void {
  if (!uid || !orgId || !isAiUsageMeterWire(meter)) return
  const key = keyOf(uid, orgId)
  meters.set(key, meter)
  try {
    globalThis.localStorage?.setItem(storageKey(uid, orgId), JSON.stringify(meter))
  } catch {
    // Full or blocked storage keeps the strip for this page only.
  }
  for (const listener of listeners.get(key) ?? []) listener(meter)
}

/** Forget every envelope; specs start each case from nothing. */
export function resetAiUsageMetersForTests(): void {
  meters.clear()
  listeners.clear()
}

/** The latest envelope for the signed-in reader in one workspace. */
export function useAiUsageMeter(orgId: string | null | undefined): AiUsageMeterWire | null {
  const { data: user } = useUser()
  const uid = user?.uid ?? null
  const key = uid && orgId ? keyOf(uid, orgId) : null
  const [meter, setMeter] = useState<AiUsageMeterWire | null>(() =>
    key ? (meters.get(key) ?? null) : null,
  )
  useEffect(() => {
    if (!key || !uid || !orgId) {
      setMeter(null)
      return undefined
    }
    if (!meters.has(key)) meters.set(key, hydrate(uid, orgId))
    setMeter(meters.get(key) ?? null)
    const subscribed = listeners.get(key) ?? new Set<Listener>()
    listeners.set(key, subscribed)
    subscribed.add(setMeter)
    return () => {
      subscribed.delete(setMeter)
    }
  }, [key, uid, orgId])
  return meter
}

/** A stable publisher bound to the signed-in reader and one workspace. */
export function usePublishAiUsageMeter(
  orgId: string | null | undefined,
): (meter: unknown) => void {
  const { data: user } = useUser()
  const uid = user?.uid ?? null
  return useCallback((meter: unknown) => publishAiUsageMeter(uid, orgId, meter), [uid, orgId])
}
