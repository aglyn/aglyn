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
const ACTIVITY_STORAGE_KEY = 'aglyn:last-activity-at'
const ACTIVITY_COOKIE = 'aglyn_last_activity'
const ACTIVITY_EVENTS = [
  'pointerdown',
  'pointermove',
  'keydown',
  'wheel',
  'touchstart',
] as const
const WORKSPACE_DOMAIN = process.env.NEXT_PUBLIC_WORKSPACE_DOMAIN ?? 'aglyn.io'

/**
 * Activity is recorded in two places: localStorage keeps sibling tabs on
 * THIS origin in sync, and a parent-domain cookie keeps sibling
 * {org}.aglyn.io workspaces in sync — otherwise an idle app.aglyn.io tab
 * would expire the shared `__session` cookie out from under a workspace
 * tab the user is actively working in.
 */
function writeActivity(now: number): void {
  try {
    window.localStorage.setItem(ACTIVITY_STORAGE_KEY, String(now))
  } catch {
    // Storage may be unavailable (private mode); the cookie still works.
  }
  const { hostname, protocol } = window.location
  const onWorkspaceDomain =
    hostname === WORKSPACE_DOMAIN || hostname.endsWith(`.${WORKSPACE_DOMAIN}`)
  document.cookie = [
    `${ACTIVITY_COOKIE}=${now}`,
    'Path=/',
    'Max-Age=86400',
    'SameSite=Lax',
    ...(onWorkspaceDomain ? [`Domain=.${WORKSPACE_DOMAIN}`] : []),
    ...(protocol === 'https:' ? ['Secure'] : []),
  ].join('; ')
}

function readActivityCookie(): number {
  for (const pair of document.cookie.split(';')) {
    const index = pair.indexOf('=')
    if (index < 0) continue
    if (pair.slice(0, index).trim() === ACTIVITY_COOKIE) {
      return Number(pair.slice(index + 1).trim()) || 0
    }
  }
  return 0
}

function readLastActivity(): number {
  let stored = 0
  try {
    stored = Number(window.localStorage.getItem(ACTIVITY_STORAGE_KEY)) || 0
  } catch {
    // fall through to the cookie
  }
  return Math.max(stored, readActivityCookie())
}

/**
 * Idle session expiry (AGL-464): after `NEXT_PUBLIC_AUTH_IDLE_TIMEOUT_MINUTES`
 * (default 60, ≤0 disables) without user activity in any tab, route to
 * /signout with the current path as the `continue` param — the signout
 * page retires the shared session cookie and forwards the param to
 * /signin, so re-authenticating resumes where the user left off.
 * Checks run on an interval and when the tab becomes visible again, so
 * a laptop waking from sleep expires immediately rather than waiting a
 * full tick.
 */
export function useIdleLogout(enabled: boolean): void {
  const router = useRouter()
  const pathname = usePathname()
  const pathnameRef = useRef(pathname)
  pathnameRef.current = pathname

  useEffect(() => {
    if (!enabled || IDLE_TIMEOUT_MS <= 0) return
    let expired = false
    let lastWrite = 0
    const recordActivity = () => {
      const now = Date.now()
      if (expired || now - lastWrite < ACTIVITY_WRITE_THROTTLE_MS) return
      lastWrite = now
      writeActivity(now)
    }
    const check = () => {
      if (expired) return
      // A missing record (fresh storage, blocked cookies) must not read
      // as "idle since epoch" — this mount's recordActivity() below
      // guarantees a baseline before the first check can run.
      const last = readLastActivity() || Date.now()
      if (Date.now() - last <= IDLE_TIMEOUT_MS) return
      expired = true
      const path = pathnameRef.current || '/'
      router.push(`/signout?${continueParam(encodeURIComponent(path))}`)
    }
    recordActivity()
    for (const event of ACTIVITY_EVENTS) {
      window.addEventListener(event, recordActivity, { passive: true })
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') check()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    const interval = window.setInterval(check, IDLE_CHECK_INTERVAL_MS)
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
