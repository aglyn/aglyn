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

import { useLoading } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useCallback } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'

/**
 * Shared install/buy handlers for community listings (AGL-95): used by the
 * browse grid and the listing detail page. Install copies the pinned
 * version snapshot server-side (/api/community/install); buy opens a
 * Stripe checkout (/api/community/checkout) when configured.
 */
export function useCommunityActions(hostId: string) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()

  const install = useCallback(
    async (listing: any) => {
      const dequeue = queueLoading()
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/community/install', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ listingId: listing.$id, hostId }),
        })
        const payload = await response.json()
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Install failed', {
            variant: response.status === 402 ? 'warning' : 'error',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar(
          payload.updated
            ? `Updated "${listing.displayName}" to v${payload.version}`
            : `Installed "${listing.displayName}" — find it under Your components`,
          { variant: 'success', persist: false },
        )
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeue()
      }
    },
    [user, hostId, queueLoading, enqueueSnackbar],
  )

  const buy = useCallback(
    async (listing: any) => {
      const dequeue = queueLoading()
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/community/checkout', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ listingId: listing.$id, hostId }),
        })
        const payload = await response.json()
        if (response.status === 501) {
          return void enqueueSnackbar(
            'Purchases are not configured on this deployment',
            { variant: 'info', persist: false },
          )
        }
        if (!response.ok || !payload?.url) {
          return void enqueueSnackbar(payload?.error ?? 'Checkout failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
        window.location.assign(payload.url)
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        dequeue()
      }
    },
    [user, hostId, queueLoading, enqueueSnackbar],
  )

  return { install, buy }
}

export default useCommunityActions
