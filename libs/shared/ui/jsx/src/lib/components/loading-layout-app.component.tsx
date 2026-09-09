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

import { forwardRef, type ReactNode } from 'react'
import { LoadingProviderComponent } from '../contexts/loading.context'
import { LoadingModal, type LoadingModalProps } from './loading-modal'

/**
 * The loading overlay host, for the App Router.
 *
 * A Pages Router sibling stood beside this one until AGL-2706, wiring
 * `RouterLoading` on `router.events` — an API the App Router does not have,
 * from a `next/router` module that throws when it is imported there. Nothing
 * had rendered it since the app moved, and a `next/router` import inside a
 * shared library is reachable by anything that ever names the file, so it is
 * gone rather than kept for a router this repo no longer serves.
 *
 * Navigation intent no longer comes from a link-click heuristic. Every
 * `<Link>` (through {@link NextLink}) renders a `LinkNavigationReporter` that
 * drives this overlay off the link's real navigation transition
 * (`useLinkStatus`) — so the overlay stays up until the destination route is
 * genuinely ready, instead of settling on URL commit (AGL-459 originally
 * settled on `usePathname`/`useSearchParams`, which fired before a slow
 * segment finished fetching/compiling and flashed the modal away early).
 *
 * Dropping `useSearchParams` from this host also removes the ISR/SSG
 * `BAILOUT_TO_CLIENT_SIDE_RENDERING` hazard it once needed a Suspense
 * boundary to contain (AGL-594). Imperative `useLoading().queueLoading()`
 * calls still render the modal.
 */
export interface LoadingLayoutAppComponentProps
  extends Omit<Partial<LoadingModalProps>, 'children'> {
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
          {/* Fragment keeps LoadingModal's single-ReactElement child contract
              (children is a ReactNode — string/array otherwise won't type). */}
          <>{children}</>
        </LoadingModal>
      </LoadingProviderComponent>
    )
  },
)
LoadingLayoutAppComponent.displayName = 'LoadingLayoutAppComponent'
LoadingLayoutAppComponent.aglyn = true

export { LoadingLayoutAppComponent }
export default LoadingLayoutAppComponent
