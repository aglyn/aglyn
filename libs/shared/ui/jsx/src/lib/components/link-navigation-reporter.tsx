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

import { useLinkStatus } from 'next/link'
import { useEffect, useRef } from 'react'
import { useLoading } from '../contexts/loading.context'

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
 */
export function LinkNavigationReporter(): null {
  const { pending } = useLinkStatus()
  const { queueLoading } = useLoading()
  const dequeueRef = useRef<(() => void) | null>(null)

  useEffect(() => {
    if (pending) {
      // Guard against re-queuing while a navigation is already in flight.
      if (!dequeueRef.current) dequeueRef.current = queueLoading()
    } else {
      dequeueRef.current?.()
      dequeueRef.current = null
    }
  }, [pending, queueLoading])

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
