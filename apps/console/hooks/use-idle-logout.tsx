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

import { continueParam } from '@aglyn/shared-util-next'
import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useRef } from 'react'

const IDLE_TIMEOUT_MINUTES = Number(
  process.env.NEXT_PUBLIC_AUTH_IDLE_TIMEOUT_MINUTES ?? '60',
)
const IDLE_TIMEOUT_MS = IDLE_TIMEOUT_MINUTES * 60_000
const IDLE_CHECK_INTERVAL_MS = 60_000
const ACTIVITY_WRITE_THROTTLE_MS = 30_000
/**
 * The server heartbeat is a network call, so it is throttled more coarsely
 * than the local write. Sub-minute granularity is irrelevant against an
 * hour-long idle window.
 */
const SERVER_HEARTBEAT_THROTTLE_MS = 60_000
const ACTIVITY_STORAGE_KEY = 'aglyn:last-activity-at'
const ACTIVITY_ENDPOINT = '/api/auth/activity'
const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
] as const

/**
 * Same-origin fast path: localStorage keeps sibling tabs on THIS origin in
 * sync without a round-trip, so the common "user is actively clicking this
 * tab" check never touches the network.
 *
 * Cross-subdomain activity is NOT synced here anymore. The old parent-domain
 * `aglyn_last_activity` cookie could only be written `Domain=.aglyn.io` from
 * a tab already on the workspace domain — from dev or a tenant origin it was
 * host-only and invisible to `.aglyn.io` tabs, so one untouched tab retired
 * the shared session for every subdomain (AGL-697). The authoritative
 * session-wide last-seen now lives server-side (`/api/auth/activity`), which
 * every `.aglyn.io` origin's heartbeats reach, and is consulted before any
 * global sign-out.
 */
function writeActivity(now: number): void {
  try {
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now))
  } catch {
    // Storage may be unavailable (private mode); the server heartbeat still
    // records activity and the idle check falls back to it.
  }
}

function readLocalActivity(): number {
  try {
    return Number(window.localStorage.getItem(ACTIVITY_STORAGE_KEY)) || 0
  } catch {
    return 0
  }
}

/** Fire-and-forget heartbeat; the server stamps the session-wide last-seen. */
function sendHeartbeat(): void {
  try {
    void fetch(ACTIVITY_ENDPOINT, { method: 'POST', keepalive: true }).catch(
      () => undefined,
    )
  } catch {
    // fetch may be unavailable in exotic environments; ignore.
  }
}

/** Reads the server-authoritative last-seen (epoch ms), or 0 if unknown. */
async function readServerActivity(): Promise<number> {
  try {
    const response = await fetch(ACTIVITY_ENDPOINT, { cache: 'no-store' })
    if (!response.ok) return 0
    const body = (await response.json()) as { at?: unknown }
    return typeof body.at === 'number' && body.at > 0 ? body.at : 0
  } catch {
    return 0
  }
}

/**
 * Idle session expiry (AGL-464): after `NEXT_PUBLIC_AUTH_IDLE_TIMEOUT_MINUTES`
 * (default 60, ≤0 disables) without user activity, route to /signout with the
 * current path as the `continue` param — the signout page retires the shared
 * session cookie and forwards the param to /signin, so re-authenticating
 * resumes where the user left off. Checks run on an interval and when the tab
 * becomes visible again, so a laptop waking from sleep expires immediately
 * rather than waiting a full tick.
 *
 * Because that sign-out is GLOBAL — it retires the cross-subdomain `__session`
 * cookie for every `.aglyn.io` tab — a tab that looks idle locally must first
 * confirm the WHOLE session is idle with the server before pulling the trigger
 * (AGL-697). A sibling tab or subdomain the local store can't see may still be
 * active; only when no origin has beaten for the timeout window does the
 * session genuinely expire, preserving AGL-464's intent.
 */
export function useIdleLogout(enabled: boolean): void {
  const router = useRouter()
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  useEffect(() => {
    if (!enabled || IDLE_TIMEOUT_MS <= 0) return
    let expired = false
    let checking = false
    let lastLocalWrite = 0
    let lastHeartbeat = 0

    const recordActivity = () => {
      if (expired) return
      const now = Date.now()
      if (now - lastLocalWrite >= ACTIVITY_WRITE_THROTTLE_MS) {
        lastLocalWrite = now
        writeActivity(now)
      }
      if (now - lastHeartbeat >= SERVER_HEARTBEAT_THROTTLE_MS) {
        lastHeartbeat = now
        sendHeartbeat()
      }
    }

    const expire = () => {
      if (expired) return
      expired = true
      const path = pathnameRef.current || '/'
      router.push(`/signout?${continueParam(encodeURIComponent(path))}`)
    }

    const check = async () => {
      if (expired || checking) return
      // A missing local record (fresh storage, blocked cookies) must not read
      // as "idle since epoch" — this mount's recordActivity() below guarantees
      // a baseline before the first check can run.
      const localLast = readLocalActivity() || Date.now()
      if (Date.now() - localLast <= IDLE_TIMEOUT_MS) return
      // Local signal says idle. Before the GLOBAL sign-out, confirm with the
      // server that no other tab/subdomain has been active (AGL-697).
      checking = true
      try {
        const serverLast = await readServerActivity()
        if (serverLast && Date.now() - serverLast <= IDLE_TIMEOUT_MS) {
          // Someone is active elsewhere. Adopt the server timestamp so this
          // tab stops re-checking against its stale local baseline.
          writeActivity(serverLast)
          return
        }
      } finally {
        checking = false
      }
      expire()
    }

    recordActivity()
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, recordActivity, { passive: true })
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void check()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    const interval = window.setInterval(() => void check(), IDLE_CHECK_INTERVAL_MS)
    return () => {
      for (const event of ACTIVITY_EVENTS) {
        window.removeEventListener(event, recordActivity)
      }
      document.removeEventListener('visibilitychange', handleVisibility)
      window.clearInterval(interval)
    }
  }, [enabled, router])
}

export default useIdleLogout
