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

// NO `'use client'` (AGL-52) and no `@aglyn/aglyn` barrel import (AGL-1550):
// this module is reached from `site-analytics.tsx` and from the shared
// advertising mount, and must stay a leaf.
import { useSyncExternalStore } from 'react'

/**
 * "The page has loaded and the main thread is idle" — the moment third-party
 * tags are allowed to start (AGL-3581).
 *
 * ## Why tags wait for this and not for hydration
 *
 * `next/script` at `afterInteractive` injects a tag as soon as the component
 * that renders it commits, which on a published page is DURING hydration. On
 * `aglyn.com/` that put ~390 ms of vendor long tasks (fbevents, two gtag
 * containers, Meta's signals config) on top of ~350 ms of React's own, and
 * the two together were the whole of the page's Total Blocking Time. Neither
 * the visitor nor the measurement gains anything from the tag executing in
 * that window: GA's `page_view` describes the page whenever it is sent, and
 * `web-vitals-rum.ts` already holds early metrics for a late tag.
 *
 * ## Why it is a gate on RENDERING the `<Script>` and not `lazyOnload`
 *
 * `next/script`'s `lazyOnload` schedules the injection when the element first
 * mounts and never cancels it. A visitor who withdraws consent inside that
 * window would find the tag arriving AFTER the withdrawal teardown ran — an
 * element the teardown never saw, executing under a state the visitor just
 * refused. Gating the render instead keeps the consent machinery exactly as
 * it was: a tag the gate has since closed is simply never rendered, and once
 * this flips the elements mount at `afterInteractive` as before, in the same
 * order, boot before library.
 *
 * ## Why there is a cap
 *
 * Pageviews must still be recorded for a visitor who stays a couple of
 * seconds, and neither signal is guaranteed to arrive promptly: `load` waits
 * for every image on an image-heavy page, and an idle callback can be starved
 * on a busy main thread. So each wait has a ceiling, and the tag starts when
 * the ceiling is reached whichever signal is late. Interaction is
 * deliberately NOT a trigger: a visitor who reads without scrolling is still
 * a pageview.
 *
 * Once reached, it stays reached for the life of the document — a client-side
 * navigation is not a new page load and does not wait again.
 */

/** Longest wait for the window `load` event before moving on without it. */
export const PAGE_LOAD_WAIT_CAP_MS = 3000
/** Longest wait for an idle period once the page has loaded. */
export const PAGE_IDLE_WAIT_CAP_MS = 1000

let reached = false
let started = false
const listeners = new Set<() => void>()

function markReached(): void {
  if (reached) return
  reached = true
  for (const listener of [...listeners]) listener()
}

function afterIdle(callback: () => void): void {
  const win = window as Window & {
    requestIdleCallback?: (
      cb: () => void,
      options?: { timeout: number },
    ) => number
  }
  if (typeof win.requestIdleCallback === 'function') {
    win.requestIdleCallback(callback, { timeout: PAGE_IDLE_WAIT_CAP_MS })
  } else {
    // Safari has no idle callback. A macrotask after `load` still lands
    // behind whatever the load event itself queued.
    setTimeout(callback, 1)
  }
}

function start(): void {
  if (started || typeof window === 'undefined') return
  started = true
  let idleRequested = false
  const requestIdle = () => {
    if (idleRequested) return
    idleRequested = true
    window.removeEventListener('load', requestIdle)
    afterIdle(markReached)
  }
  if (document.readyState === 'complete') {
    requestIdle()
    return
  }
  window.addEventListener('load', requestIdle)
  setTimeout(requestIdle, PAGE_LOAD_WAIT_CAP_MS)
}

/** Has the page loaded and gone idle? Always false on the server. */
export function pageIdle(): boolean {
  return reached
}

/** The server snapshot, for `useSyncExternalStore`. */
export function pageNotIdle(): boolean {
  return false
}

/**
 * Subscribe to the moment the page goes idle, starting the wait on first
 * use. Shaped for `useSyncExternalStore`: every component that gates on it
 * reads ONE store, so the GA pair and the advertising pairs flip in the same
 * render — which is what keeps the AGL-2681 shared-library declaration true.
 */
export function subscribePageIdle(listener: () => void): () => void {
  listeners.add(listener)
  start()
  return () => {
    listeners.delete(listener)
  }
}

/**
 * The hook form. False on the server and through hydration, so the cached
 * HTML never carries a tag; true from the first render after the page idles.
 */
export function usePageIdle(): boolean {
  return useSyncExternalStore(subscribePageIdle, pageIdle, pageNotIdle)
}

/** Test seam: forget that the page went idle. */
export function resetPageIdleForTests(): void {
  reached = false
  started = false
  listeners.clear()
}
