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
import { EDIT_PARAM, readStoredEditToken } from './admin-bar-shared'

// The bar proper is a SEPARATE chunk, requested only after something below
// arms it. An anonymous visitor pays for this stub alone: two listeners and
// an idle callback, no fetch, no UI, no bar code.
const AdminBar = dynamic(() => import('./admin-bar'), { ssr: false })

export interface AdminBarStubProps {
  hostId: string
  consoleOrigin: string
}

/**
 * Idle-armed trigger for the tenant admin bar (admin edit bar, AGL-1302
 * follow-on). Renders NOTHING (no SSR output, no layout shift) until one of
 * three explicit signals fires:
 *
 * 1. a still-valid token from an earlier connect sits in sessionStorage —
 *    returning editors get the bar back without re-consenting;
 * 2. the page was visited with `?aglyn-edit` — the shareable opt-in;
 * 3. the Cmd/Ctrl+Shift+E chord — the habit path, and a real user gesture,
 *    which the popup the bar opens later will need anyway.
 *
 * Anonymous visitors hit none of these, so the bar chunk is never fetched
 * and no auth question is ever asked.
 */
export default function AdminBarStub({ hostId, consoleOrigin }: AdminBarStubProps) {
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    if (armed) return undefined
    const arm = () => setArmed(true)

    // Off the critical path: don't even touch sessionStorage until idle.
    const idleCheck = () => {
      if (readStoredEditToken(hostId)) return arm()
      if (new URLSearchParams(window.location.search).has(EDIT_PARAM)) {
        return arm()
      }
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
        arm()
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
  return <AdminBar hostId={hostId} consoleOrigin={consoleOrigin} />
}
