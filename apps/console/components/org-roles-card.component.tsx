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
  ORG_PERMISSIONS,
  type AglynOrgCustomRole,
} from '@aglyn/aglyn'
import { CardDisplay, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Checkbox,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import { useOrgScope } from '../hooks/use-org-scope'

interface RoleDraft extends AglynOrgCustomRole {
  $id?: string
  name?: string
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

  const request = useCallback(
    async (method: string, body?: Record<string, unknown>) => {
      if (!orgId) return null
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch(
        method === 'GET' ? `/api/orgs/roles?orgId=${orgId}` : '/api/orgs/roles',
        {
          method,
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
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
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Fine-tune what members can do beyond the four org roles — e.g. ' +
            'an editor who can also view billing, or an admin without ' +
            'billing access. Assign roles from the members table.'}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          {roles.map((role) => (
            <Chip
              key={role.$id}
              label={role.name ?? role.$id}
              onClick={() => setEditor({ ...role })}
              onDelete={() => void handleDelete(role)}
            />
          ))}
          <Button
            size="small"
            color="secondary"
            variant="contained"
            onClick={() => setEditor({ name: '', permissions: {} })}
          >
            {'New role'}
          </Button>
        </Stack>
      </Stack>
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{editor?.$id ? 'Edit role' : 'New role'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
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
          {ORG_PERMISSIONS.map((definition) => {
            const value = editor?.permissions?.[definition.key]
            return (
              <FormControlLabel
                key={definition.key}
                control={
                  <Checkbox
                    checked={value === true}
                    indeterminate={value === undefined}
                    onChange={() =>
                      setEditor((draft) => {
                        if (!draft) return draft
                        const permissions = { ...(draft.permissions ?? {}) }
                        // Cycle: inherit → granted → denied → inherit.
                        const current = permissions[definition.key]
                        if (current === undefined) {
                          permissions[definition.key] = true
                        } else if (current === true) {
                          permissions[definition.key] = false
                        } else {
                          delete permissions[definition.key]
                        }
                        return { ...draft, permissions }
                      })
                    }
                  />
                }
                label={
                  <Stack>
                    <Typography variant="body2">
                      {definition.label}
                      {value === false ? ' (denied)' : ''}
                      {value === undefined ? ' (inherit)' : ''}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                      {definition.description}
                    </Typography>
                  </Stack>
                }
              />
            )
          })}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEditor(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="secondary"
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
