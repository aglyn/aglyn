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
    case 'datasetSchema':
      return 'community/install-dataset-schema'
    case 'emailTemplate':
      return 'community/install-email-template'
    default:
      return 'community/install'
  }
}

/**
 * Artifact types whose install deliberately does NOT touch the running site
 * (AGL-669/671/657) — the copy must not imply otherwise. Templates and layouts
 * land in the Templates library; an email template lands as an inactive
 * version the owner still has to activate.
 */
function landingMessage(
  artifactType: string,
  displayName: string,
): string | null {
  switch (artifactType) {
    case 'template':
    case 'layout':
      return (
        `Saved "${displayName}" to your Templates — nothing is live until ` +
        'you use it.'
      )
    case 'emailTemplate':
      return (
        `Saved "${displayName}" as a draft version — activate it in the ` +
        'email designer to start sending it.'
      )
    case 'datasetSchema':
      return `Created "${displayName}" as a new, empty dataset.`
    default:
      return null
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
        // Types that land inert must not read as "your site changed".
        const landed = landingMessage(artifactType, listing.displayName)
        enqueueSnackbar(
          landed ??
            (payload.updated
              ? `Updated "${listing.displayName}" to v${payload.version}`
              : `Installed "${listing.displayName}" — find it under Your components`),
          { variant: 'success', persist: false },
        )
        // A schema whose reference fields couldn't be relinked installs with
        // those fields degraded to text — silently changing a field's type
        // would be the kind of thing you discover much later (AGL-657).
        if (payload.degradedFieldIds?.length) {
          enqueueSnackbar(
            `${payload.degradedFieldIds.length} reference field(s) became ` +
              'plain text — the datasets they pointed at are not in this ' +
              'organization.',
            { variant: 'info', persist: false },
          )
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

  /**
   * Fans an install-targeting plan out to the install routes (AGL-773). Each
   * step is either a single org pin or a host pin on a named site; org steps
   * resolve the org from the acting `hostId`. One summary snackbar reports the
   * whole plan rather than N toasts. Use `resolveInstallPlan` (model) to turn
   * an All-sites / Selected-sites choice into these steps.
   */
  const installPlan = useCallback(
    async (
      listing: any,
      steps: readonly InstallPlanStep[],
      options?: {
        /**
         * Re-pinning something already installed (AGL-1017). Only the wording
         * changes — the route is the same, because moving a pin forward IS
         * installing — but "Installed on 1 site" is the wrong sentence to read
         * after pressing Update.
         */
        intent?: 'install' | 'update'
        /** The version being moved to, for the update summary. */
        version?: string | number | null
      },
    ) => {
      if (!steps.length) return
      const dequeue = queueLoading()
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const artifactType = listingArtifactType(listing)
        const endpoint = endpointForArtifact(artifactType)
        let installed = 0
        const errors: string[] = []
        /**
         * Surfaced separately from success (AGL-1017/429): the pin is written
         * either way — it is an explicit choice — but a bundle built for a
         * different host ABI will not load, and a green "Updated" toast alone
         * would leave the workspace believing it did.
         */
        const abiWarnings = new Set<string>()
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
          if (response.ok) {
            installed += 1
            if (payload?.hostAbiWarning) {
              abiWarnings.add(String(payload.hostAbiWarning))
            }
          } else errors.push(payload?.error ?? 'Install failed')
        }
        const orgWide = steps.some((step) => step.scope === 'org')
        const updating = options?.intent === 'update'
        const noun = updating
          ? 'Updated'
          : landingMessage(artifactType, '')
            ? 'Saved'
            : 'Installed'
        const toVersion =
          updating && options?.version != null ? ` to v${options.version}` : ''
        if (installed && !errors.length) {
          enqueueSnackbar(
            orgWide
              ? `${noun} "${listing.displayName}"${toVersion} for the whole organization`
              : `${noun} "${listing.displayName}"${toVersion} on ${installed} site` +
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
        for (const warning of abiWarnings) {
          enqueueSnackbar(warning, { variant: 'warning', allowDuplicate: true })
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

  /**
   * Uninstall a plugin listing from the listing detail (AGL-881) — the same
   * `action:'uninstall'` the installed add-ons card uses, so it removes the
   * pin (and the switchboard entry when nothing else pins it) and decrements
   * activeInstalls. Only plugins have a removable pin; other artifact types
   * land in a library and have nothing to uninstall.
   */
  const uninstall = useCallback(
    async (
      listing: any,
      scope?: 'org' | 'host',
      // Which site's pin to drop (AGL-997). Without this the call always
      // targeted the acting host, so at org scope "uninstall" could only
      // mean "the whole org pin" or "whichever site happened to be acting"
      // — removing the plugin from ONE of several sites was unreachable.
      targetHostId?: string,
    ) => {
      const dequeue = queueLoading()
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/community/install-plugin', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            listingId: listing.$id,
            hostId: targetHostId ?? hostId,
            action: 'uninstall',
            ...(scope ? { scope } : {}),
          }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'Uninstall failed', {
            variant: 'error',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar(`Removed "${listing.displayName}"`, {
          variant: 'success',
          persist: false,
        })
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

  return { install, installPlan, buy, uninstall }
}

export default useCommunityActions
