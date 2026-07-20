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

import { usePathname, useSearchParams } from 'next/navigation'
import {
  forwardRef,
  type ReactNode,
  Suspense,
  useEffect,
  useRef,
} from 'react'
import {
  LoadingProviderComponent,
  useLoading,
} from '../contexts/loading.context'
import { LoadingModal } from './loading-modal'
import type { LoadingLayoutComponentProps } from './loading-layout.component'

/** Never wedge the UI when a navigation is interrupted/cancelled. */
const NAVIGATION_OVERLAY_MAX_MS = 10_000

/**
 * App Router replacement for the Pages Router `router.events` wiring
 * (AGL-459): the App Router has no transition events, so navigation intent
 * is detected from same-origin link clicks (capture phase catches every
 * `next/link`), and the overlay is dropped when the rendered route actually
 * changes (`usePathname`/`useSearchParams`), on `popstate`, or after a
 * safety timeout.
 */
function RouterLoadingApp({ children }: { children?: ReactNode }) {
  const { queueLoading } = useLoading()
  const pathname = usePathname()
  const searchParams = useSearchParams()
  const dequeueRef = useRef<(() => void) | null>(null)

  const settle = () => {
    dequeueRef.current?.()
    dequeueRef.current = null
  }
  const settleRef = useRef(settle)
  settleRef.current = settle

  // The route the app actually renders changed — navigation completed.
  useEffect(() => {
    settleRef.current()
  }, [pathname, searchParams])

  useEffect(() => {
    const handleClick = (event: MouseEvent) => {
      if (event.defaultPrevented || event.button !== 0) return
      if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) {
        return
      }
      const anchor = (event.target as Element | null)?.closest?.('a[href]')
      if (!(anchor instanceof HTMLAnchorElement)) return
      if (anchor.target && anchor.target !== '_self') return
      if (anchor.hasAttribute('download')) return
      const url = new URL(anchor.href, window.location.href)
      if (url.origin !== window.location.origin) return
      if (
        url.pathname === window.location.pathname &&
        url.search === window.location.search
      ) {
        return
      }
      if (!dequeueRef.current) dequeueRef.current = queueLoading()
      window.setTimeout(() => settleRef.current(), NAVIGATION_OVERLAY_MAX_MS)
    }
    const handlePopState = () => settleRef.current()

    document.addEventListener('click', handleClick, true)
    window.addEventListener('popstate', handlePopState)
    return () => {
      document.removeEventListener('click', handleClick, true)
      window.removeEventListener('popstate', handlePopState)
      settleRef.current()
    }
  }, [queueLoading])

  return children ?? null
}
RouterLoadingApp.displayName = 'RouterLoadingApp'
RouterLoadingApp.aglyn = true

/**
 * App Router variant of {@link LoadingLayoutComponent}. The Pages Router
 * version wires `RouterLoading` on `router.events`, which does not exist in
 * the App Router (and `useRouter()` from `next/router` throws there) —
 * {@link RouterLoadingApp} covers navigations via link-click detection
 * instead, and imperative `useLoading().queueLoading()` calls still render
 * the modal.
 */
export interface LoadingLayoutAppComponentProps
  extends Omit<LoadingLayoutComponentProps, 'children'> {
  /** Per-site branding for the overlay (AGL-594) — see LoadingModal. */
  brandLogoUrl?: string
  brandName?: string
  /** Any renderable children — the tenant layout passes a ReactNode. */
  children?: ReactNode
}

const LoadingLayoutAppComponent = forwardRef<
  any,
  LoadingLayoutAppComponentProps
>(
  (props, ref) => {
    const { children, ...rest } = props

    return (
      <LoadingProviderComponent>
        <LoadingModal ref={ref} {...rest}>
          {/* The listener holds useSearchParams(), which MUST sit under
              its own Suspense boundary or ISR/SSG routes 500 at request
              time (BAILOUT_TO_CLIENT_SIDE_RENDERING — took the tenant
              down, AGL-594). Children stay OUTSIDE the boundary so site
              pages keep their server-rendered HTML; only the
              null-rendering listener client-renders. */}
          <>
            <Suspense fallback={null}>
              <RouterLoadingApp />
            </Suspense>
            {children}
          </>
        </LoadingModal>
      </LoadingProviderComponent>
    )
  },
)
LoadingLayoutAppComponent.displayName = 'LoadingLayoutAppComponent'
LoadingLayoutAppComponent.aglyn = true

export { LoadingLayoutAppComponent }
export default LoadingLayoutAppComponent
