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
import {
  type InstallPlanStep,
  listingArtifactType,
} from '../model/community'

/**
 * Each artifact type has its own installer route (AGL-672): routing
 * everything to the component one silently installed the wrong thing or
 * 404'd. `listingArtifactType` tolerates the legacy `type`/`kind`
 * discriminators (AGL-654).
 */
function endpointForArtifact(artifactType: string): string {
  switch (artifactType) {
    case 'template':
      return 'community/install-template'
    case 'layout':
      return 'community/install-layout'
    case 'plugin':
      return 'community/install-plugin'
    default:
      return 'community/install'
  }
}

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

  // `scope` is only meaningful for artifact types that HAVE an org-scoped
  // pin — see INSTALL_TARGETS. Passing it for a template would be ignored
  // server-side, so callers ask the model rather than guessing.
  const install = useCallback(
    async (listing: any, scope?: 'org' | 'host') => {
      const dequeue = queueLoading()
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const artifactType = listingArtifactType(listing)
        const endpoint = endpointForArtifact(artifactType)
        const response = await fetch(`/api/${endpoint}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            listingId: listing.$id,
            hostId,
            ...(scope ? { scope } : {}),
          }),
        })
        const payload = await response.json()
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Install failed', {
            variant: response.status === 402 ? 'warning' : 'error',
            allowDuplicate: true,
          })
        }
        // Templates and layouts land in the library and publish nothing
        // (AGL-669), so the message must not imply the site changed.
        const landsInLibrary =
          artifactType === 'template' || artifactType === 'layout'
        enqueueSnackbar(
          landsInLibrary
            ? `Saved "${listing.displayName}" to your Templates — nothing is ` +
              'live until you use it.'
            : payload.updated
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

  /**
   * Fans an install-targeting plan out to the install routes (AGL-773). Each
   * step is either a single org pin or a host pin on a named site; org steps
   * resolve the org from the acting `hostId`. One summary snackbar reports the
   * whole plan rather than N toasts. Use `resolveInstallPlan` (model) to turn
   * an All-sites / Selected-sites choice into these steps.
   */
  const installPlan = useCallback(
    async (listing: any, steps: readonly InstallPlanStep[]) => {
      if (!steps.length) return
      const dequeue = queueLoading()
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const artifactType = listingArtifactType(listing)
        const endpoint = endpointForArtifact(artifactType)
        let installed = 0
        const errors: string[] = []
        for (const step of steps) {
          // Org steps still need a host to resolve the org server-side, so
          // fall back to the acting host; host steps target their own site.
          const targetHostId = step.scope === 'host' ? step.hostId : hostId
          const response = await fetch(`/api/${endpoint}`, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
            },
            body: JSON.stringify({
              listingId: listing.$id,
              hostId: targetHostId,
              ...(step.scope === 'org' ? { scope: 'org' } : {}),
            }),
          })
          const payload = await response.json().catch(() => ({}))
          if (response.ok) installed += 1
          else errors.push(payload?.error ?? 'Install failed')
        }
        const orgWide = steps.some((step) => step.scope === 'org')
        const landsInLibrary =
          artifactType === 'template' || artifactType === 'layout'
        const noun = landsInLibrary ? 'Saved' : 'Installed'
        if (installed && !errors.length) {
          enqueueSnackbar(
            orgWide
              ? `${noun} "${listing.displayName}" for the whole organization`
              : `${noun} "${listing.displayName}" on ${installed} site` +
                (installed === 1 ? '' : 's'),
            { variant: 'success', persist: false },
          )
        } else if (installed && errors.length) {
          enqueueSnackbar(
            `${noun} on ${installed} site(s); ${errors.length} failed — ${errors[0]}`,
            { variant: 'warning', allowDuplicate: true },
          )
        } else {
          enqueueSnackbar(errors[0] ?? 'Install failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
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

  return { install, installPlan, buy }
}

export default useCommunityActions
