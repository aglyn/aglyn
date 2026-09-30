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

import {
  lockdownRefusalText,
  parseLockdownRefusal,
  type ConsoleTemplateInstallStatusZoneProps,
} from '@aglyn/aglyn'
import { mdiDownloadOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  useFirestore,
  useFirestoreDoc,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { Chip, Tooltip } from '@mui/material'
import { doc } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import { TEMPLATE_SOURCE_TYPE } from '../constants/template-source'
import { resolveUpdateState } from '../model/update-state'

/**
 * "Update available" on a template this plugin installed (AGL-671) — the
 * `templateInstallStatus` zone on a row of a site's Templates library, drawn
 * here since AGL-3080.
 *
 * The comparison needs no new data: the listing records `latestVersion`, the
 * installed template records the version it came from, and
 * `resolveUpdateState` is the one comparison every marketplace surface asks.
 * A listing that is gone, unpublished or unreadable offers nothing rather
 * than a wrong chip, and so does a template installed from somewhere else.
 *
 * Updating RE-INSTALLS: `marketplace/install-template` replaces the bundle
 * with the latest version, so a copy the site edited since installing it
 * (AGL-681) loses those edits — which is asked first. Pages already created
 * from the template are ordinary screens and are never touched.
 */
export function TemplateInstallStatus(
  props: ConsoleTemplateInstallStatusZoneProps,
) {
  const { hostId, template } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { confirm } = useConfirmationContext()
  const { enqueueSnackbar } = useSnackbar()
  const [updating, setUpdating] = useState(false)

  const source = template['source'] as
    | { type?: unknown; listingId?: unknown }
    | undefined
  const listingId =
    source?.type === TEMPLATE_SOURCE_TYPE && typeof source.listingId === 'string'
      ? source.listingId
      : ''
  // A public read, keyed by the listing the template was installed from.
  const { data: listing } = useFirestoreDoc<any>(
    () => (listingId ? doc(firestore, 'marketplaceListings', listingId) : null),
    [firestore, listingId],
  )
  const status = useMemo(
    () =>
      listing && !listing.deletedAt
        ? resolveUpdateState(template as never, listing, 'template')
        : null,
    [template, listing],
  )

  const displayName = String(template['displayName'] ?? template['$id'] ?? '')
  const handleUpdate = useCallback(async () => {
    if (!listingId || updating) return
    if (template['editedAt']) {
      const confirmed = await confirm({
        title: 'Replace your edited copy?',
        description:
          `You have edited "${displayName}" since installing it. Updating ` +
          'replaces it with the publisher’s latest version, and your changes ' +
          'to this template are lost. Pages you already created from it are ' +
          'unaffected.',
        confirmationText: 'Replace',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
    }
    setUpdating(true)
    try {
      const response = await authorizedFetch(
        user,
        '/api/marketplace/install-template',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ listingId, hostId }),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        // An installs lock is not a broken template (AGL-1532).
        const locked = parseLockdownRefusal(response.status, payload)
        if (locked) {
          return void enqueueSnackbar(lockdownRefusalText(locked), {
            variant: 'warning',
            persist: true,
          })
        }
        return void enqueueSnackbar(payload?.error ?? 'Update failed', {
          variant: response.status === 402 ? 'warning' : 'error',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar(
        `Updated to v${payload.version} — pages you already created are ` +
          'unchanged.',
        { variant: 'success', persist: false },
      )
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Update failed', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setUpdating(false)
    }
  }, [
    listingId,
    updating,
    template,
    displayName,
    confirm,
    user,
    hostId,
    enqueueSnackbar,
  ])

  if (status?.state !== 'update-available') return null
  return (
    <Tooltip
      title={`You have v${status.installedVersion} · v${status.availableVersion} available`}
    >
      <Chip
        size="small"
        variant="outlined"
        color="info"
        icon={<MdiIcon path={mdiDownloadOutline.path} size={0.7} />}
        label={updating ? 'Updating…' : 'Update available'}
        aria-label={`Update ${displayName}`}
        disabled={updating}
        // A library row opens the template when clicked; this press is
        // aimed at the update, not at the row.
        onClick={(event) => {
          event.stopPropagation()
          void handleUpdate()
        }}
      />
    </Tooltip>
  )
}

export default TemplateInstallStatus
