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
  canManageOrg,
  type AglynOrgCustomRole,
} from '@aglyn/aglyn'
import {
  groupOrgPermissions,
  offeredOrgPermissions,
  permissionChoice,
  searchOrgPermissions,
  withPermissionChoice,
} from '@aglyn/aglyn/app-utils/org-permission-editor'
import type { OrgPermissionDefinition } from '@aglyn/aglyn/app-utils/org-permissions'
import {
  PermissionChoiceList,
  type PermissionChoiceSection,
} from '@aglyn/shared-ui-jsx/components/permission-choice-list.component'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { docsHelp } from '../constants/docs-links'
import { useOrgScope } from '../hooks/use-org-scope'
import { useReleaseFlags } from '../hooks/use-release-flags'

interface RoleDraft extends AglynOrgCustomRole {
  $id?: string
  name?: string
}

const ROLE_WORDS = { owner: 'Owner', admin: 'Admin', editor: 'Editor', viewer: 'Viewer' } as const

/** What "inherit" means for a key in a custom role: the org roles that hold it by default. */
function inheritHint(definition: OrgPermissionDefinition): string {
  const holders = (Object.keys(ROLE_WORDS) as Array<keyof typeof ROLE_WORDS>)
    .filter((role) => definition.roleDefaults[role])
    .map((role) => ROLE_WORDS[role])
  return holders.length
    ? `Inherit: allowed for ${holders.join(', ')} by default`
    : 'Inherit: no org role holds it by default'
}

/** The editor's sections: the offered keys a search keeps, grouped, with the draft's choices. */
function roleSections(
  offered: readonly OrgPermissionDefinition[],
  search: string,
  permissions: Partial<Record<string, boolean>> | undefined,
): PermissionChoiceSection[] {
  return groupOrgPermissions(searchOrgPermissions(offered, search)).map((section) => ({
    id: section.group.id,
    label: section.group.label,
    items: section.permissions.map((definition) => ({
      key: definition.key,
      label: definition.label,
      description: definition.description,
      choice: permissionChoice(permissions, definition.key),
      inheritHint: inheritHint(definition),
    })),
  }))
}

/**
 * Custom org roles manager (AGL-243): named permission sets stored at
 * `orgs/{orgId}/roles`, assigned to members from the roster. A custom
 * role's map overrides the member's org-role defaults key-by-key — e.g.
 * a "Billing editor" that grants billing.view to an editor.
 */
export function OrgRolesCard() {
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const orgId = currentOrg?.$id
  const canManage = canManageOrg(currentOrg?.role)
  const [roles, setRoles] = useState<Array<RoleDraft & { $id: string }>>([])
  const [editor, setEditor] = useState<RoleDraft | null>(null)
  const [busy, setBusy] = useState(false)
  const [search, setSearch] = useState('')
  const theme = useTheme()
  const phone = useMediaQuery(theme.breakpoints.down('sm'))
  const releaseFlags = useReleaseFlags()
  // The one catalog (AGL-4047): the core keys and every key the workspace's
  // plugins declare, a plugin's keys only while it is on and released here.
  const offered = useMemo(
    () =>
      offeredOrgPermissions({
        org: currentOrg as { enabledPlugins?: string[] } | null,
        isFlagOn: (flagKey) =>
          (releaseFlags.flags as Record<string, { released?: boolean } | undefined>)[flagKey]?.released !== false,
        staffBypass: releaseFlags.isStaff,
      }),
    [currentOrg, releaseFlags.flags, releaseFlags.isStaff],
  )

  const request = useCallback(
    async (method: string, body?: Record<string, unknown>) => {
      if (!orgId) return null
      const response = await authorizedFetch(
        user,
        method === 'GET' ? `/api/orgs/roles?orgId=${orgId}` : '/api/orgs/roles',
        {
          method,
          headers: { 'Content-Type': 'application/json' },
          ...(body ? { body: JSON.stringify({ ...body, orgId }) } : {}),
        },
      )
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Role request failed', {
          variant: 'warning',
          persist: false,
        })
        return null
      }
      return payload
    },
    [orgId, user, enqueueSnackbar],
  )

  const refresh = useCallback(async () => {
    const payload = await request('GET')
    if (payload?.roles) setRoles(payload.roles)
  }, [request])

  useEffect(() => {
    if (orgId && user) void refresh()
  }, [orgId, user, refresh])

  const handleSave = async () => {
    if (!editor?.name?.trim() || busy) return
    setBusy(true)
    try {
      const saved = await request('POST', {
        action: 'save',
        ...(editor.$id ? { roleId: editor.$id } : {}),
        name: editor.name.trim(),
        description: editor.description ?? '',
        permissions: editor.permissions ?? {},
      })
      if (saved) {
        enqueueSnackbar('Role saved', { variant: 'success', persist: false })
        setEditor(null)
        await refresh()
      }
    } finally {
      setBusy(false)
    }
  }

  const handleDelete = async (role: RoleDraft & { $id: string }) => {
    // confirm() resolves on accept and REJECTS on cancel (it carries no
    // boolean) — so a catch is the cancel path, not a falsy return value.
    try {
      await confirm({
        title: 'Delete role?',
        description: `Members assigned "${role.name ?? role.$id}" fall back to their org role's default permissions.`,
        confirmationButtonProps: { color: 'error' },
      })
    } catch {
      return
    }
    const deleted = await request('POST', {
      action: 'delete',
      roleId: role.$id,
    })
    if (deleted) {
      enqueueSnackbar('Role deleted', { variant: 'success', persist: false })
      await refresh()
    }
  }

  if (!currentOrg || !canManage) return null

  return (
    <CardDisplay
      header={'Custom roles'}
      help={docsHelp('customRoles', { anchor: '#create-a-custom-role' })}
      HeaderProps={{
        action: (
          <Button
            size="small"
            color="primary"
            variant="contained"
            onClick={() => setEditor({ name: '', permissions: {} })}
          >
            {'New role'}
          </Button>
        ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Fine-tune what members can do beyond the four org roles — e.g. ' +
            'an editor who can also view billing, a viewer who can run the ' +
            'point of sale, or an admin without billing access. Assign roles ' +
            'from the members table.'}
        </Typography>
        <Stack useFlexGap direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {roles.map((role) => (
            <Chip
              key={role.$id}
              label={role.name ?? role.$id}
              onClick={() => setEditor({ ...role })}
              onDelete={() => void handleDelete(role)}
            />
          ))}
          {roles.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No custom roles yet.'}
            </Typography>
          ) : null}
        </Stack>
      </Stack>
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="md"
        fullWidth
        fullScreen={phone}
        slotProps={{ transition: { onExited: () => setSearch('') } }}
      >
        <DialogTitle>{editor?.$id ? 'Edit role' : 'New role'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5 }}
        >
          <TextField
            size="small"
            label="Name"
            required
            value={editor?.name ?? ''}
            onChange={(event) =>
              setEditor((draft) =>
                draft ? { ...draft, name: event.target.value } : draft,
              )
            }
          />
          <TextField
            size="small"
            label="Description"
            value={editor?.description ?? ''}
            onChange={(event) =>
              setEditor((draft) =>
                draft ? { ...draft, description: event.target.value } : draft,
              )
            }
          />
          <Typography variant="subtitle2">{'Permissions'}</Typography>
          <Typography variant="caption" color="text.secondary">
            {'Allow or deny a permission for everyone on this role, or leave it on ' +
              'Inherit to use each member’s org role default.'}
          </Typography>
          <PermissionChoiceList
            sections={roleSections(offered, search, editor?.permissions)}
            search={search}
            onSearchChange={setSearch}
            groupActions
            disabled={busy}
            onChange={(keys, choice) =>
              setEditor((draft) =>
                draft
                  ? { ...draft, permissions: withPermissionChoice(draft.permissions as Record<string, boolean>, keys, choice) }
                  : draft,
              )
            }
          />
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEditor(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            disabled={busy || !editor?.name?.trim()}
            onClick={() => void handleSave()}
          >
            {busy ? 'Saving…' : 'Save role'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
OrgRolesCard.displayName = 'OrgRolesCard'

export default OrgRolesCard
