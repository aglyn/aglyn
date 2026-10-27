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

import { ORG_PERMISSIONS } from '@aglyn/aglyn'
import {
  groupOrgPermissions,
  overrideChangesBetween,
  permissionChoice,
  searchOrgPermissions,
  withPermissionChoice,
} from '@aglyn/aglyn/app-utils/org-permission-editor'
import { AppLink } from '@aglyn/shared-ui-jsx'
import {
  PermissionChoiceList,
  type PermissionChoiceSection,
} from '@aglyn/shared-ui-jsx/components/permission-choice-list.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  LinearProgress,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import { buildRoute, Route } from '../constants/route-links'
import { useOrgSlug } from '../hooks/use-org-scope'

/** A row of the site's collaborators roster. */
export interface SitePermissionsMember {
  $id: string
  email?: string
  role?: string
  status?: string
  uid?: string
}

/** What `GET /api/hosts/members/permissions` answers. */
interface SitePermissionsState {
  orgWide: boolean
  role: string | null
  keys: string[]
  stored: Record<string, boolean>
  defaults: Record<string, boolean>
}

const SITE_ROLE_WORDS: Record<string, string> = {
  admin: 'Admin',
  editor: 'Editor',
  author: 'Author',
  viewer: 'Viewer',
}

/**
 * One collaborator's permissions on THIS site (AGL-4047): every key a plugin
 * declared per site — the AI keys among them — each Allow / Deny / Inherit,
 * where Inherit is their site access's default. Read and saved through
 * `/api/hosts/members/permissions`, the door the collaborators card already
 * holds; a member who reaches the whole workspace is set on the Team page.
 */
export function SitePermissionsDialog(props: {
  hostId: string
  member: SitePermissionsMember | null
  canManage: boolean
  onClose: () => void
}) {
  const { hostId, member, canManage, onClose } = props
  const { data: user } = useUser()
  const orgSlug = useOrgSlug()
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<SitePermissionsState | null>(null)
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState<string | null>(null)
  const memberId = member?.$id

  useEffect(() => {
    if (!memberId || !user) return
    let active = true
    setState(null)
    setFailed(null)
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          `/api/hosts/members/permissions?hostId=${encodeURIComponent(hostId)}&memberId=${encodeURIComponent(memberId)}`,
        )
        const payload = await response.json().catch(() => ({}))
        if (!active) return
        if (!response.ok) {
          setFailed(payload?.error ?? 'These permissions could not be read')
          return
        }
        setState(payload as SitePermissionsState)
        setDraft({ ...(payload?.stored ?? {}) })
      } catch (error) {
        console.error(error)
        if (active) setFailed('These permissions could not be read')
      }
    })()
    return () => {
      active = false
    }
  }, [hostId, memberId, user])

  const roleWord = SITE_ROLE_WORDS[state?.role ?? ''] ?? 'site'
  const definitions = ORG_PERMISSIONS.filter((definition) => state?.keys.includes(definition.key))
  const sections: PermissionChoiceSection[] = groupOrgPermissions(searchOrgPermissions(definitions, search)).map(
    (section) => ({
      id: section.group.id,
      label: section.group.label,
      items: section.permissions.map((definition) => {
        const choice = permissionChoice(draft, definition.key)
        const fallback = state?.defaults[definition.key] === true
        return {
          key: definition.key,
          label: definition.label,
          description: definition.description,
          choice,
          effective: {
            granted: choice === 'inherit' ? fallback : choice === 'grant',
            source: choice === 'inherit' ? `from the ${roleWord} site access` : 'set for this site',
          },
          inheritHint: `Inherit: ${fallback ? 'allowed' : 'not allowed'} for ${roleWord} site access`,
          lockedReason: canManage ? undefined : 'Only site admins can change permissions',
        }
      }),
    }),
  )
  const changes = overrideChangesBetween(state?.stored, draft)
  const dirty = Object.keys(changes).length > 0

  const handleSave = async () => {
    if (!dirty || busy || !memberId) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/hosts/members/permissions', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hostId, memberId, permissions: changes }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Saving permissions failed', { variant: 'warning', persist: false })
        return
      }
      enqueueSnackbar('Permissions saved', { variant: 'success', persist: false })
      onClose()
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Saving permissions failed', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={Boolean(member)}
      onClose={onClose}
      maxWidth="sm"
      fullWidth
      slotProps={{ transition: { onExited: () => setSearch('') } }}
    >
      <DialogTitle>{`Permissions on this site — ${member?.email ?? ''}`}</DialogTitle>
      <DialogContent>
        {failed ? (
          <Alert severity="warning">{failed}</Alert>
        ) : !state ? (
          <LinearProgress aria-label="Loading permissions" />
        ) : state.orgWide ? (
          <Alert severity="info">
            {'This member works across the whole workspace, so their permissions are set on the '}
            <AppLink href={buildRoute(Route.MANAGE_TEAM, { orgSlug })} color="primary">
              {'Team page'}
            </AppLink>
            {'.'}
          </Alert>
        ) : definitions.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {'No permission is set per site yet.'}
          </Typography>
        ) : (
          <PermissionChoiceList
            sections={sections}
            search={definitions.length > 6 ? search : undefined}
            onSearchChange={definitions.length > 6 ? setSearch : undefined}
            disabled={busy}
            onChange={(keys, choice) => setDraft((current) => withPermissionChoice(current, keys, choice))}
          />
        )}
      </DialogContent>
      <DialogActions>
        <Button color="inherit" onClick={onClose}>
          {dirty ? 'Cancel' : 'Close'}
        </Button>
        {canManage && state && !state.orgWide ? (
          <Button variant="contained" disabled={!dirty || busy} onClick={() => void handleSave()}>
            {busy ? 'Saving…' : 'Save permissions'}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
SitePermissionsDialog.displayName = 'SitePermissionsDialog'

export default SitePermissionsDialog
