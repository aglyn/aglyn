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

import type { HostAccessRole } from '@aglyn/aglyn/foundation/definitions/organization.types'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Checkbox, FormControlLabel, Stack } from '@mui/material'
import { useCallback, useState } from 'react'
import {
  AI_PERMISSION_KEYS,
  HOST_ROLE_AI_PERMISSIONS,
  type AiPermission,
  type AiPermissionVerdict,
} from '../model/ai-permissions'

/** A roster row as the collaborators table hands it to a column. */
interface CollaboratorRow {
  $id?: string
  uid?: string
  role?: string
  status?: string
  aiPermissions?: Partial<AiPermissionVerdict>
}

/** What each toggle is called in the row. */
const TOGGLE_LABELS: Record<AiPermission, string> = {
  'ai.use': 'Assist',
  'ai.generate': 'Generate',
}

/**
 * A collaborator's AI verdict on the site, as the row shows it: the roster
 * copy the toggle door wrote, else the host role's default — which is what
 * the doors resolve for a member document the toggle has never touched, so
 * a row never shows a state the server does not hold.
 */
export function collaboratorAiPermissions(member: CollaboratorRow | undefined): AiPermissionVerdict {
  const role = (member?.role ?? 'editor') as HostAccessRole
  const base = HOST_ROLE_AI_PERMISSIONS[role] ?? HOST_ROLE_AI_PERMISSIONS.viewer
  const stored = member?.aiPermissions
  return {
    'ai.use': stored?.['ai.use'] ?? base['ai.use'],
    'ai.generate': stored?.['ai.generate'] ?? base['ai.generate'],
  }
}

/**
 * THE COLLABORATORS TABLE'S AI COLUMN (AGL-2927, AGL-2984): whether this
 * person may open the AI doors ON THIS SITE, through the `hostMembers`
 * zone. The host role sets the default; the boxes refine it, and the doors
 * read the same answer, so an unticked box is a closed door rather than a
 * hidden button. The owner is decided by the org role, and says so.
 */
export function AiCollaboratorPermissionsCell(props: {
  hostId?: string
  canManage?: boolean
  member?: CollaboratorRow
}) {
  const { hostId, canManage, member } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const memberId = member?.$id

  const handleToggle = useCallback(
    (key: AiPermission) => async (_event: unknown, checked: boolean) => {
      if (!memberId || !hostId) return
      setBusy(true)
      try {
        const response = await authorizedFetch(user, '/api/ai/host-permissions', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, memberId, aiPermissions: { [key]: checked } }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          enqueueSnackbar(payload?.error ?? 'Member operation failed', {
            variant: 'warning',
            persist: false,
          })
          return
        }
        enqueueSnackbar('AI access updated', { variant: 'success', persist: false })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Member operation failed', { variant: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, memberId, enqueueSnackbar],
  )

  if (member?.role === 'owner') return <>{'By org role'}</>
  const verdict = collaboratorAiPermissions(member)
  return (
    // An invited row has no member document to carry a toggle yet; it
    // becomes settable once the invite is accepted, which is when the person
    // gains the role the default derives from.
    <Stack direction="row" spacing={0}>
      {AI_PERMISSION_KEYS.map((key) => (
        <FormControlLabel
          key={key}
          label={TOGGLE_LABELS[key]}
          slotProps={{ typography: { variant: 'caption' } }}
          control={
            <Checkbox
              size="small"
              checked={verdict[key]}
              onChange={handleToggle(key)}
              disabled={busy || !canManage || member?.status === 'invited'}
              slotProps={{
                input: { 'aria-label': `${TOGGLE_LABELS[key]} with AI` },
              }}
            />
          }
        />
      ))}
    </Stack>
  )
}
AiCollaboratorPermissionsCell.displayName = 'AiCollaboratorPermissionsCell'
