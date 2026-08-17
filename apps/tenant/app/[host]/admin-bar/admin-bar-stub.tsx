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

import dynamic from 'next/dynamic'
import { useEffect, useState } from 'react'
import {
  clearEditOptOut,
  EDIT_PARAM,
  hasEditorHint,
  isEditOptedOut,
  readStoredEditToken,
} from './admin-bar-shared'

// The bar proper is a SEPARATE chunk, requested only after something below
// arms it. An anonymous visitor pays for this stub alone: two listeners and
// an idle callback, no fetch, no UI, no bar code.
const AdminBar = dynamic(() => import('./admin-bar'), { ssr: false })

export interface AdminBarStubProps {
  hostId: string
  consoleOrigin: string
}

/** How the bar was armed; decides its no-token behaviour (AGL-1829). */
export type AdminBarArmMode = 'manual' | 'auto'

/**
 * Idle-armed trigger for the tenant admin bar (admin edit bar, AGL-1302
 * follow-on; auto-appearance AGL-1829). Renders NOTHING (no SSR output, no
 * layout shift) until one of four signals fires:
 *
 * 1. a still-valid token from an earlier connect sits in storage —
 *    returning editors get the bar back without re-consenting;
 * 2. the page was visited with `?aglyn-edit` — the shareable opt-in, which
 *    also outranks a remembered disconnect;
 * 3. the Cmd/Ctrl+Shift+E chord — the habit path, likewise outranking a
 *    disconnect, and a real user gesture for the popup it may need;
 * 4. AUTO (AGL-1829): the console's same-site editor-presence hint cookie
 *    is here and this editor hasn't disconnected — the bar then runs the
 *    silent iframe probe and appears only if the console proves access. On
 *    cross-site hosts (`*.aglyn.app`, customer domains) the hint is
 *    invisible by construction and this signal simply never fires.
 *
 * Anonymous visitors hit none of these, so the bar chunk is never fetched,
 * no request is ever made, and no auth question is ever asked.
 */
export default function AdminBarStub({ hostId, consoleOrigin }: AdminBarStubProps) {
  const [armed, setArmed] = useState<AdminBarArmMode | null>(null)

  useEffect(() => {
    if (armed) return undefined
    const arm = (mode: AdminBarArmMode) => setArmed(mode)

    // Off the critical path: don't even touch storage until idle.
    const idleCheck = () => {
      if (readStoredEditToken(hostId)) return arm('manual')
      if (new URLSearchParams(window.location.search).has(EDIT_PARAM)) {
        // The explicit opt-in outranks a remembered disconnect.
        clearEditOptOut(hostId)
        return arm('manual')
      }
      if (hasEditorHint() && !isEditOptedOut(hostId)) return arm('auto')
      return undefined
    }
    const hasIdleCallback = typeof window.requestIdleCallback === 'function'
    const idleHandle = hasIdleCallback
      ? window.requestIdleCallback(idleCheck)
      : window.setTimeout(idleCheck, 1500)

    const onKeyDown = (event: KeyboardEvent) => {
      if (
        (event.metaKey || event.ctrlKey) &&
        event.shiftKey &&
        event.code === 'KeyE'
      ) {
        event.preventDefault()
        clearEditOptOut(hostId)
        arm('manual')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      if (hasIdleCallback) window.cancelIdleCallback(idleHandle)
      else window.clearTimeout(idleHandle)
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [armed, hostId])

  if (!armed) return null
  return (
    <AdminBar
      hostId={hostId}
      consoleOrigin={consoleOrigin}
      autoConnect={armed === 'auto'}
    />
  )
}
