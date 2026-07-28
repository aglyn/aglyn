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
import { useCallback, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import type { ArtifactChange } from '../model'

/** The server's answer to "what would this update do to my copy?" (AGL-1018). */
export interface ArtifactUpdatePreview {
  artifactType: string
  installedVersion: string | null
  availableVersion: string | null
  mergeable: boolean
  reason?: string
  safe: ArtifactChange[]
  kept: ArtifactChange[]
  conflicts: ArtifactChange[]
  unchanged: number
  identical: boolean
  schema?: {
    added: string[]
    removed: string[]
    retyped: string[]
    additiveOnly: boolean
    recordCount: number
  }
}

/**
 * Preview-then-apply for a copied artifact (AGL-1018).
 *
 * Deliberately separate from `useCommunityActions`: install writes the
 * publisher's version, and an update reconciles it with a copy that has
 * diverged. Sharing one call would put the destructive path one forgotten
 * argument away from the safe one.
 */
export function useArtifactUpdate(hostId: string) {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { queueLoading } = useLoading()
  const [preview, setPreview] = useState<ArtifactUpdatePreview | null>(null)
  const [loading, setLoading] = useState(false)

  const post = useCallback(
    async (listingId: string, body: Record<string, unknown>) => {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/community/update-artifact', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ listingId, hostId, ...body }),
      })
      return { response, payload: await response.json().catch(() => ({})) }
    },
    [user, hostId],
  )

  /** Ask what an update would do. Writes nothing. */
  const loadPreview = useCallback(
    async (listingId: string) => {
      setLoading(true)
      setPreview(null)
      try {
        const { response, payload } = await post(listingId, {
          action: 'preview',
        })
        if (!response.ok) {
          enqueueSnackbar(payload?.error ?? 'Could not read this update', {
            variant: 'error',
            allowDuplicate: true,
          })
          return null
        }
        setPreview(payload.preview)
        return payload.preview as ArtifactUpdatePreview
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
        return null
      } finally {
        setLoading(false)
      }
    },
    [post, enqueueSnackbar],
  )

  /**
   * Write the update. `mode: 'merge'` takes the safe changes plus whatever
   * conflicts were explicitly picked; `mode: 'copy'` installs the new version
   * fresh and detaches the customised one.
   */
  const applyUpdate = useCallback(
    async (
      listingId: string,
      options: {
        mode: 'merge' | 'copy'
        takePaths?: string[]
        confirmDestructive?: boolean
      },
    ): Promise<boolean> => {
      const dequeue = queueLoading()
      try {
        const { response, payload } = await post(listingId, {
          action: 'apply',
          ...options,
        })
        if (!response.ok) {
          enqueueSnackbar(payload?.error ?? 'Update failed', {
            variant: payload?.needsConfirmation ? 'warning' : 'error',
            allowDuplicate: true,
          })
          return false
        }
        if (options.mode === 'copy') {
          enqueueSnackbar(
            `Installed v${payload.version} as a new copy — your customised ` +
              'version is kept, no longer linked to the listing.',
            { variant: 'success', persist: false },
          )
        } else {
          // The summary is the point of the whole flow: it says what moved and,
          // just as importantly, what was left alone.
          const skipped = payload.skipped?.length ?? 0
          enqueueSnackbar(
            `Updated to v${payload.version} — ${payload.applied} change(s) ` +
              `applied, ${payload.keptLocal} of yours kept` +
              (skipped ? `, ${skipped} conflict(s) left as yours` : '') +
              '.',
            { variant: 'success', persist: false },
          )
        }
        return true
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
        return false
      } finally {
        dequeue()
      }
    },
    [post, queueLoading, enqueueSnackbar],
  )

  return { preview, loading, loadPreview, applyUpdate, setPreview }
}

export default useArtifactUpdate
