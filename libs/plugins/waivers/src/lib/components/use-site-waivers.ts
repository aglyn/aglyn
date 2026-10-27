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

import { useCallback, useEffect, useState } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import type { WaiverTemplate } from '../model/waiver'
import { useWaiversFetch } from './waivers-api'

/**
 * A site's waivers, read through the console route, with a way to read them
 * again, and the origin of the store's own site its share links open on
 * (`null` for a site with no public address).
 */
export function useSiteWaivers(hostId: string) {
  const { ready, request } = useWaiversFetch()
  const [waivers, setWaivers] = useState<WaiverTemplate[] | null>(null)
  const [signPageOrigin, setSignPageOrigin] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [revision, setRevision] = useState(0)
  useEffect(() => {
    if (!ready) return
    let live = true
    void request<{ waivers: WaiverTemplate[]; signPageOrigin?: string | null }>(WAIVERS_API_ROUTES.templates, {
      query: { hostId },
    })
      .then((answer) => {
        if (!live) return
        setWaivers(answer.waivers)
        setSignPageOrigin(answer.signPageOrigin ?? null)
        setError(null)
      })
      .catch((caught: Error) => {
        if (live) setError(caught.message)
      })
    return () => {
      live = false
    }
  }, [ready, request, hostId, revision])
  const reload = useCallback(() => setRevision((value) => value + 1), [])
  return { waivers, signPageOrigin, error, reload }
}
