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
  isOrgWideMember,
  orgPermissionLabel,
  type AglynOrgCustomRole,
  type AglynOrgMember,
} from '@aglyn/aglyn'
import {
  explainOrgPermissions,
  groupOrgPermissions,
  offeredOrgPermissions,
  overrideChangesBetween,
  permissionChoice,
  searchOrgPermissions,
  withPermissionChoice,
  type ExplainedPermission,
} from '@aglyn/aglyn/app-utils/org-permission-editor'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  PermissionChoiceList,
  type PermissionChoiceSection,
} from '@aglyn/shared-ui-jsx/components/permission-choice-list.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { useUser } from '@aglyn/tenant-feature-instance'
import { Alert, Button, DialogActions, DialogContent, Stack, Typography } from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { useOrgScope } from '../hooks/use-org-scope'
import { useReleaseFlags } from '../hooks/use-release-flags'

/** A roster row as `/api/orgs/members` answers it. */
export type PermissionsMember = Partial<AglynOrgMember> & {
  $id: string
  roleId?: string | null
  permissions?: Partial<Record<string, boolean>>
  displayName?: string
  email?: string
}

const ROLE_WORDS: Record<string, string> = {
  owner: 'Owner',
  admin: 'Admin',
  editor: 'Editor',
  viewer: 'Viewer',
}

/** Where an effective verdict came from, in a sentence's words. */
function sourceWords(
  explained: ExplainedPermission,
  roleWord: string,
  customRoleName: string | undefined,
): string {
  // A finer key held back by the broader one it refines (AGL-4047): the
  // allow stored for it waits on that key.
  if (explained.heldBy) return `needs "${orgPermissionLabel(explained.heldBy)}"`
  if (explained.source === 'override') return 'set for this member'
  if (explained.source === 'customRole') return `from the "${customRoleName ?? 'custom'}" role`
  if (explained.source === 'refines' && explained.refines) {
    return `follows "${orgPermissionLabel(explained.refines)}"`
  }
  return `from the ${roleWord} role`
}

/** What Inherit falls back to for this member: the custom role's verdict, else the org role's. */
function inheritWords(explained: ExplainedPermission, roleWord: string, customRoleName: string | undefined): string {
  if (typeof explained.customRole === 'boolean') {
    return `Inherit: ${explained.customRole ? 'allowed' : 'denied'} by the "${customRoleName ?? 'custom'}" role`
  }
  if (explained.refines) return `Inherit: follows "${orgPermissionLabel(explained.refines)}"`
  return `Inherit: ${explained.roleDefault ? 'allowed' : 'not allowed'} for the ${roleWord} role`
}

/**
 * A member's own permissions (AGL-4047): every key the workspace is offered,
 * grouped and searchable, each Allow / Deny / Inherit, with the verdict they
 * end up with and the layer it came from (their org role, their custom role,
 * or this override). Saves through `/api/orgs/members` `permissions`, which
 * holds the owner, self-changes and grants beyond the actor's own.
 *
 * `layout="card"` draws it as the member page's card with Save in the header;
 * `layout="dialog"` fills a dialog's content and actions, for the roster's
 * quick view.
 */
export function MemberPermissionsEditor(props: {
  member: PermissionsMember
  roles: ReadonlyArray<{ $id: string; name?: string; permissions?: AglynOrgCustomRole['permissions'] }>
  canManage: boolean
  layout: 'card' | 'dialog'
  onSaved?: () => void
  onClose?: () => void
}) {
  const { member, roles, canManage, layout } = props
  const { data: user } = useUser()
  const { currentOrg } = useOrgScope()
  const { enqueueSnackbar } = useSnackbar()
  const releaseFlags = useReleaseFlags()
  const [draft, setDraft] = useState<Record<string, boolean>>({})
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const stored = useMemo(() => {
    const values: Record<string, boolean> = {}
    for (const [key, value] of Object.entries(member.permissions ?? {})) {
      if (typeof value === 'boolean') values[key] = value
    }
    return values
  }, [member.permissions])
  useEffect(() => setDraft(stored), [stored])

  const customRole = member.roleId ? (roles.find((role) => role.$id === member.roleId) ?? null) : null
  const isOwner = member.role === 'owner'
  const orgWide = isOrgWideMember(member)
  const roleWord = ROLE_WORDS[member.role ?? 'viewer'] ?? 'Viewer'
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
  // The verdict as it would be with the draft saved.
  const explained = explainOrgPermissions({ ...member, permissions: draft }, customRole, offered)
  const sections: PermissionChoiceSection[] = groupOrgPermissions(searchOrgPermissions(offered, search)).map(
    (section) => ({
      id: section.group.id,
      label: section.group.label,
      items: section.permissions.map((definition) => {
        const verdict = explained[definition.key]
        return {
          key: definition.key,
          label: definition.label,
          description: definition.description,
          choice: permissionChoice(draft, definition.key),
          effective: verdict
            ? { granted: verdict.granted, source: sourceWords(verdict, roleWord, customRole?.name) }
            : undefined,
          inheritHint: verdict ? inheritWords(verdict, roleWord, customRole?.name) : undefined,
          lockedReason: isOwner
            ? 'The owner keeps every permission'
            : !canManage
              ? 'Only members who manage people can change permissions'
              : undefined,
        }
      }),
    }),
  )
  const changes = overrideChangesBetween(stored, draft)
  const dirty = Object.keys(changes).length > 0

  const handleSave = async () => {
    if (!dirty || busy || !currentOrg?.$id) return
    setBusy(true)
    try {
      const response = await authorizedFetch(user, '/api/orgs/members', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId: currentOrg.$id, action: 'permissions', uid: member.$id, permissions: changes }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        enqueueSnackbar(payload?.error ?? 'Saving permissions failed', { variant: 'warning', persist: false })
        return
      }
      enqueueSnackbar('Permissions saved', { variant: 'success', persist: false })
      props.onSaved?.()
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Saving permissions failed', { variant: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const body = !orgWide ? (
    <Alert severity="info">
      {'This member works on named sites. What they can do there follows their site role, ' +
        'and a site admin adjusts it per site under the site’s collaborators.'}
    </Alert>
  ) : (
    <Stack spacing={1.5}>
      <Typography variant="body2" color="text.secondary">
        {`${roleWord} role` +
          (customRole?.name ? ` with the "${customRole.name}" custom role` : '') +
          '. Allow or deny a permission for this member alone, or leave it on Inherit.'}
      </Typography>
      <PermissionChoiceList
        sections={sections}
        search={search}
        onSearchChange={setSearch}
        groupActions={canManage && !isOwner}
        disabled={busy}
        onChange={(keys, choice) => setDraft((current) => withPermissionChoice(current, keys, choice))}
      />
    </Stack>
  )
  const saveButton =
    canManage && orgWide && !isOwner ? (
      <Button variant="contained" size="small" disabled={!dirty || busy} onClick={() => void handleSave()}>
        {busy ? 'Saving…' : 'Save permissions'}
      </Button>
    ) : null

  if (layout === 'dialog') {
    return (
      <>
        <DialogContent>{body}</DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={props.onClose}>
            {dirty ? 'Cancel' : 'Close'}
          </Button>
          {saveButton}
        </DialogActions>
      </>
    )
  }
  return (
    <CardDisplay
      header={'Permissions'}
      help={docsHelp('customRoles', { anchor: '#per-member-overrides' })}
      HeaderProps={saveButton ? { action: saveButton } : undefined}
      contentGutterX
      contentGutterY
    >
      {body}
    </CardDisplay>
  )
}
MemberPermissionsEditor.displayName = 'MemberPermissionsEditor'

export default MemberPermissionsEditor
