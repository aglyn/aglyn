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
import { useEffect, useRef } from 'react'
import { editorHintCookieDomain } from './editor-hint-cookie.component'

/**
 * The `*.aglyn.app` half of the editor-presence hint (AGL-1842).
 *
 * `EditorHintCookie` covers the hosts that are same-site with the console —
 * `Domain=.aglyn.com`/`.aglyn.io` — but `*.aglyn.app`, where every platform
 * subdomain site lives, is a DIFFERENT registrable domain, and no cookie set
 * from here can reach it. The one channel that can is a top-level
 * navigation: this component, once per {@link EDIT_HINT_BOUNCE_INTERVAL_MS}
 * per browser while signed in, fetches a seconds-lived signed blob from
 * `/api/edit-hint/blob` and bounces the browser through the tenant app's
 * `console.aglyn.app/api/edit-hint/set`, which plants the hint cookies on
 * `.aglyn.app` first-party and sends the browser straight back here.
 *
 * The cost is one redirect flash, paid only by signed-in console editors —
 * an anonymous site visitor never sees any of this machinery. Guards, each
 * of which must hold before anything moves:
 *
 * - auth resolved to a real user (an unknown verdict neither bounces nor
 *   clears the throttle);
 * - top-level window — the `/edit-access` silent probe embeds console pages
 *   in an iframe, where a navigation would kill the probe and the cookie
 *   write would be partitioned into uselessness anyway;
 * - not the `/edit-access` page itself — that page is mid-handshake with a
 *   tenant site (popup or probe) and must never be navigated away;
 * - a first-party console host (`editorHintCookieDomain` non-null) — a
 *   white-label console on a customer's domain must not leak its editors
 *   through our bounce, and localhost has no `.aglyn.app` to reach;
 * - the throttle stamp is stale, and STORABLE: the stamp is written before
 *   navigating, so a browser that refuses storage skips the bounce rather
 *   than looping through it on every load.
 *
 * Sign-out clears the stamp so the next sign-in re-plants promptly. It
 * cannot clear the `.aglyn.app` cookies from here — that boundary again —
 * so a signed-out editor's hint dies by expiry, and sooner than that by the
 * exchange failing closed server-side (removed membership, disabled
 * account). A stale hint costs one refused, invisible POST.
 */

/** The reserved tenant-app host the bounce lands on. `console` is in
 * `RESERVED_SUBDOMAINS` (host-naming.ts), so no customer can ever own it;
 * `/api/*` is outside the tenant middleware's matcher, so the endpoint
 * serves there no matter how tenant resolution treats the hostname. */
export const EDIT_HINT_BOUNCE_ORIGIN = 'https://console.aglyn.app'

export const EDIT_HINT_BOUNCE_STAMP_KEY = 'aglyn-edit-hint-bounce-at'

/** Once a day per browser; the planted cookie lives 7, so a weekly console
 * visit keeps the hint alive continuously. */
export const EDIT_HINT_BOUNCE_INTERVAL_MS = 24 * 60 * 60 * 1000

export interface EditHintBounceProps {
  /** Test seam: performs the top-level navigation. */
  navigate?: (url: string) => void
}

export default function EditHintBounce({
  navigate,
}: EditHintBounceProps): null {
  const { data: user } = useUser()
  // One attempt per mount — auth state re-emits must not re-fire the work.
  const startedRef = useRef(false)

  useEffect(() => {
    if (user === undefined) return
    if (user === null) {
      // Signed out: drop the throttle so the NEXT sign-in bounces at once
      // instead of waiting out a stamp from the previous session.
      try {
        window.localStorage.removeItem(EDIT_HINT_BOUNCE_STAMP_KEY)
      } catch {
        // Nothing to clear where nothing could be stored.
      }
      return
    }
    if (startedRef.current) return
    if (window.top !== window) return
    if (window.location.pathname === '/edit-access') return
    if (!editorHintCookieDomain(window.location.hostname)) return

    let lastBounceAt = 0
    try {
      lastBounceAt =
        Number(window.localStorage.getItem(EDIT_HINT_BOUNCE_STAMP_KEY)) || 0
    } catch {
      // Unreadable storage means an unwritable stamp: bounce nothing, or
      // every console load becomes a redirect.
      return
    }
    if (Date.now() - lastBounceAt < EDIT_HINT_BOUNCE_INTERVAL_MS) return
    startedRef.current = true
    try {
      // BEFORE the navigation, deliberately: a bounce that fails after this
      // point costs one silent miss until the next window, never a loop.
      window.localStorage.setItem(
        EDIT_HINT_BOUNCE_STAMP_KEY,
        String(Date.now()),
      )
    } catch {
      return
    }

    void (async () => {
      try {
        const idToken = await user.getIdToken()
        const response = await fetch('/api/edit-hint/blob', {
          method: 'POST',
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!response.ok) return
        const payload = (await response.json()) as { blob?: string }
        if (!payload?.blob) return
        const url =
          `${EDIT_HINT_BOUNCE_ORIGIN}/api/edit-hint/set` +
          `?sig=${encodeURIComponent(payload.blob)}` +
          `&return=${encodeURIComponent(window.location.href)}`
        const go = navigate ?? ((target: string) => window.location.assign(target))
        go(url)
      } catch {
        // Silent by design; the next throttle window retries.
      }
    })()
  }, [user, navigate])

  return null
}
