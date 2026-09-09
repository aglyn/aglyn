/**
 * @license
 * Copyright 2024 Aglyn LLC
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

import dynamic from 'next/dynamic'
import { forwardRef, Fragment, useEffect, useState } from 'react'
import { LoadingContext } from '../contexts/loading.context'
import type { LoadingModalOverlayProps } from './loading-modal-overlay'

/**
 * The overlay's own loader, kept beside the `dynamic()` that wraps it so the
 * warm-up below and the render path fetch the same module.
 */
const importOverlay = () => import('./loading-modal-overlay')

const LoadingOverlay = dynamic(importOverlay, { ssr: false })

export type LoadingModalProps = LoadingModalOverlayProps

/**
 * Warms the overlay chunk once the page it sits under has painted.
 *
 * The overlay covers a slow navigation, so fetching it only at the click that
 * starts one would put a request in front of the very thing it exists to
 * cover. Idle time after first paint is the right moment instead: off the
 * billed first-paint bundle, and settled long before anyone clicks. The
 * `timeout` matters — an idle callback in a background tab can wait
 * indefinitely without one — and every path here is best-effort, because the
 * render below fetches the module on demand regardless.
 */
function useOverlayWarmUp(): void {
  useEffect(() => {
    const warm = () => {
      void importOverlay().catch(() => undefined)
    }
    const idle = (
      globalThis as typeof globalThis & {
        requestIdleCallback?: (
          callback: () => void,
          options?: { timeout: number },
        ) => number
        cancelIdleCallback?: (handle: number) => void
      }
    ).requestIdleCallback
    if (!idle) {
      const timer = setTimeout(warm, 2000)
      return () => clearTimeout(timer)
    }
    const handle = idle(warm, { timeout: 4000 })
    return () => {
      ;(
        globalThis as typeof globalThis & {
          cancelIdleCallback?: (handle: number) => void
        }
      ).cancelIdleCallback?.(handle)
    }
  }, [])
}

/**
 * The navigation overlay's mount point (AGL-594), wrapping the app's content.
 *
 * `children` render unconditionally and OUTSIDE the overlay, so what a
 * visitor reads never waits on it. The overlay itself lives in its own module
 * and arrives through `next/dynamic` (AGL-2706): MUI's `Modal` — with
 * `ModalManager`, `FocusTrap`, `Backdrop` and `Fade` behind it — plus
 * `LinearProgress`, `CircularProgress` and the 6 KB inline `AglynLogoFull`
 * were first-paint weight in both apps for a scrim that draws only while a
 * navigation is in flight, and never at all on a visit with no navigation.
 *
 * Once it has been shown it STAYS mounted, so `closeAfterTransition` still
 * has a component to run its exit against; unmounting on close would cut the
 * fade-out instead of playing it.
 */
export const LoadingModal = forwardRef<any, LoadingModalProps>((props, ref) => {
  const { open, children, ...rest } = props
  const [everShown, setEverShown] = useState(false)
  useOverlayWarmUp()

  return (
    <LoadingContext.Consumer>
      {({ loading }) => {
        const isOpen = Boolean(open || loading)

        return (
          <Fragment>
            {children}
            <OverlaySlot
              isOpen={isOpen}
              everShown={everShown}
              onShown={setEverShown}
            >
              <LoadingOverlay ref={ref} open={isOpen} {...rest} />
            </OverlaySlot>
          </Fragment>
        )
      }}
    </LoadingContext.Consumer>
  )
})
LoadingModal.displayName = 'LoadingModal'

/**
 * Holds the overlay off the tree until it is first asked for.
 *
 * A component rather than a branch in the render prop above: the "has it ever
 * opened" latch has to be a hook, and the render prop of a context consumer
 * is not a place hooks may be called.
 */
function OverlaySlot({
  isOpen,
  everShown,
  onShown,
  children,
}: {
  isOpen: boolean
  everShown: boolean
  onShown: (shown: true) => void
  children: React.ReactNode
}) {
  useEffect(() => {
    if (isOpen && !everShown) onShown(true)
  }, [isOpen, everShown, onShown])
  if (!isOpen && !everShown) return null
  return <>{children}</>
}

export default LoadingModal
