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

import { useCallback } from 'react'
import { WAIVERS_API_ROUTES } from '../constants/bundle-common'
import { formatDayKey } from '../model/waiver'
import { useWaiversFetch } from './waivers-api'

/**
 * A signing on staff's own device (AGL-4042): the window's tablet and the
 * register's check-in both send it through the console route that records
 * who handed the device over.
 */
export function useWindowSigning(hostId: string) {
  const { request } = useWaiversFetch()
  return useCallback(
    async (payload: Record<string, unknown>) => {
      const { signature } = await request<{
        signature: { signerName: string; minors: Array<{ name: string }>; validThroughDayKey: string; dayKey: string; email: string }
      }>(WAIVERS_API_ROUTES.signAtWindow, { body: { ...payload, hostId } })
      return {
        people: [signature.signerName, ...signature.minors.map((minor) => minor.name)],
        window:
          signature.dayKey === signature.validThroughDayKey
            ? `Good for ${formatDayKey(signature.dayKey)}`
            : `Good ${formatDayKey(signature.dayKey)} through ${formatDayKey(signature.validThroughDayKey)}`,
        emailed: Boolean(signature.email),
      }
    },
    [request, hostId],
  )
}
