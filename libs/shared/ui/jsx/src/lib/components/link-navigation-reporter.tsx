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

import { type LinkProps, useLinkStatus } from 'next/link'
import { type RefObject, useEffect, useRef } from 'react'
import { useLoading } from '../contexts/loading.context'

/**
 * Whether following `href` from `here` only jumps within the page that is
 * already showing: a `#fragment` link, or one whose path and query are the
 * current page's with a fragment on the end.
 *
 * Such a click is not a navigation anyone waits for, so it must never raise
 * the loading overlay. The overlay is a MUI `Modal`: it takes focus when it
 * opens and hands it back to the clicked link when it closes, and handing it
 * back scrolls that link into view. Next has scrolled to the fragment by
 * then, so the page jumped down and straight back up, and every "See what's
 * included" or "Tell us about your business" button on a published site
 * looked dead in Chrome, which focuses a link on mouse down.
 *
 * Only a string href or a hash-only `UrlObject` is judged; anything else is
 * treated as a real navigation, which is what it was before.
 */
export function isSameDocumentJump(
  href: LinkProps['href'] | undefined,
  here: { href: string },
): boolean {
  if (href && typeof href === 'object') {
    const { hash, pathname, search, query, host, hostname, href: whole } = href
    return (
      Boolean(hash) &&
      !pathname &&
      !search &&
      !query &&
      !host &&
      !hostname &&
      !whole
    )
  }
  if (typeof href !== 'string' || !href.includes('#')) return false
  try {
    const current = new URL(here.href)
    const target = new URL(href, current)
    return (
      target.origin === current.origin &&
      target.pathname === current.pathname &&
      target.search === current.search
    )
  } catch {
    return false
  }
}

export interface LinkNavigationReporterProps {
  /**
   * Set by the enclosing link on each click: `true` when that click was a
   * same-page jump (see {@link isSameDocumentJump}), so the transition it
   * starts must not queue the overlay. Read when the link goes pending,
   * because by then Next may already have written the new URL.
   */
  sameDocumentRef?: RefObject<boolean>
}

/**
 * Bridges a Next.js `<Link>`'s real navigation transition state
 * (`useLinkStatus`, Next 15.3+/16) to the global loading overlay.
 *
 * Rendered as a child of every `<Link>` (via {@link NextLink}). `useLinkStatus`
 * reads the *enclosing* link's own status context, so only the clicked link's
 * reporter goes `pending` — exactly one overlay is queued per navigation, and
 * it stays queued until the destination route is genuinely ready (through slow
 * dev compiles / RSC fetches).
 *
 * This replaces the old `usePathname`/`useSearchParams` heuristic, which
 * settled the overlay on URL *commit* — before a slow segment had finished
 * fetching/compiling — so the modal flashed away while the user was still
 * waiting for the real 200.
 *
 * `useLoading()` returns a no-op context when no `LoadingProvider` sits above
 * it, so this is safe for links rendered outside an app shell.
 *
 * A same-page `#fragment` jump never queues the overlay; see
 * {@link isSameDocumentJump} for why it must not.
 */
export function LinkNavigationReporter(
  props: LinkNavigationReporterProps = {},
): null {
  const { sameDocumentRef } = props
  const { pending } = useLinkStatus()
  const { queueLoading } = useLoading()
  const dequeueRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (pending) {
      if (sameDocumentRef?.current) return
      // Guard against re-queuing while a navigation is already in flight.
      if (!dequeueRef.current) dequeueRef.current = queueLoading()
    } else {
      dequeueRef.current?.()
      dequeueRef.current = null
    }
  }, [pending, queueLoading, sameDocumentRef])

  // If the link unmounts mid-navigation, never leave the overlay wedged.
  useEffect(
    () => () => {
      dequeueRef.current?.()
      dequeueRef.current = null
    },
    [],
  )

  return null
}

LinkNavigationReporter.displayName = 'LinkNavigationReporter'
LinkNavigationReporter.aglyn = true

export default LinkNavigationReporter
