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

import type { MobilePluginContext } from '@aglyn/mobile-plugin-host'
import { Button, Card, Chip, ChipRow, Field, Screen, Sheet, Text } from '@aglyn/mobile-ui'
import { useState } from 'react'
import { View } from 'react-native'
import { confirmAction, showRefusal } from '../shared/actions'
import { titleCase } from '../shared/format'
import { SiteAccessPicker, type SiteAccessDraft } from './site-access-picker'
import {
  ASSIGNABLE_ROLES,
  canEditMember,
  changeRole,
  isStaffMember,
  memberAccessLabel,
  memberName,
  memberTypeLabel,
  removeMember,
  setSiteAccess,
  type AssignableRole,
  type OrgMember,
  type SiteRole,
} from './team-api'

const draftOf = (member: OrgMember): SiteAccessDraft => ({
  allHosts: member.allHosts === true,
  hostAccess: { ...(member.hostAccess ?? {}) } as Record<string, SiteRole>,
})

const ROLE_CHIPS = ASSIGNABLE_ROLES.map((value) => ({ value, label: titleCase(value) }))

/*==========================================
 * ONE MEMBER.
 *
 * Their role, their reach and the seat it makes them, as the console's
 * roster row shows them. A reader who manages the team (owner, admin) may
 * change the role, the site access and remove them, on every row but the
 * owner's, which the console never offers to change and the route refuses:
 * the workspace always keeps its owner. Each change is asked first.
 *=========================================*/

export function MemberDetail({
  member,
  context,
  readerRole,
  sites,
  onChanged,
  onRemoved,
}: {
  member: OrgMember
  context: MobilePluginContext
  readerRole: string | null
  sites: ReadonlyArray<{ id: string; name: string }>
  onChanged: () => Promise<void> | void
  onRemoved: () => void
}) {
  const [busy, setBusy] = useState<string | null>(null)
  const [editingAccess, setEditingAccess] = useState(false)
  const [access, setAccess] = useState<SiteAccessDraft>(() => draftOf(member))
  const orgId = context.orgId as string
  const editable = canEditMember(readerRole, member)
  const role = member.role ?? 'viewer'
  const name = memberName(member)
  const siteNames = Object.entries(member.hostAccess ?? {}).map(([hostId, siteRole]) => ({
    name: sites.find((site) => site.id === hostId)?.name ?? hostId,
    role: siteRole,
  }))

  const run = async (key: string, title: string, write: () => Promise<unknown>, after?: () => void) => {
    setBusy(key)
    try {
      await write()
      await onChanged()
      after?.()
    } catch (error) {
      showRefusal(title, error)
    } finally {
      setBusy(null)
    }
  }

  const pickRole = async (next: AssignableRole) => {
    if (next === role) return
    const confirmed = await confirmAction({
      title: `Make ${name} ${next === 'admin' ? 'an admin' : `a ${next}`}?`,
      message:
        next === 'admin'
          ? 'Admins manage the whole workspace, every site and its people.'
          : 'Their site access stays as it is.',
      confirmLabel: 'Change role',
    })
    if (!confirmed) return
    await run('role', 'Could not change the role', () => changeRole(context.api, orgId, member, next))
  }

  const saveAccess = async () => {
    const confirmed = await confirmAction({
      title: `Save site access for ${name}?`,
      message: access.allHosts
        ? 'They reach every site in this workspace.'
        : `They reach ${Object.keys(access.hostAccess).length} site(s).`,
      confirmLabel: 'Save access',
    })
    if (!confirmed) return
    await run('access', 'Could not save the access', () => setSiteAccess(context.api, orgId, member, access), () =>
      setEditingAccess(false),
    )
  }

  const remove = async () => {
    const confirmed = await confirmAction({
      title: 'Remove member?',
      message: `${member.email ?? member.$id} loses access to every site in this organization.`,
      confirmLabel: 'Remove',
      destructive: true,
    })
    if (!confirmed) return
    await run('remove', 'Could not remove them', () => removeMember(context.api, orgId, member.$id), onRemoved)
  }

  return (
    <Screen>
      <Card title={name} actions={<Chip label={titleCase(role)} testID="member-role" />}>
        {member.email && member.email !== name ? <Text tone="secondary">{member.email}</Text> : null}
        {member.title ? <Field label="Title" value={member.title} /> : null}
        <Field label="Access" value={memberAccessLabel(member)} testID="member-access" />
        <Field label="Seat" value={memberTypeLabel(member)} />
        {isStaffMember(member) ? <Chip label="Platform staff · no seat" /> : null}
        {siteNames.length && !(member.allHosts || role === 'admin' || role === 'owner')
          ? siteNames.map((site) => (
              <Text key={site.name} variant="caption" tone="secondary">
                {`${site.name}: ${titleCase(site.role)}`}
              </Text>
            ))
          : null}
      </Card>

      {editable ? (
        <Card title="Role">
          <ChipRow testID="member-role-picker" options={ROLE_CHIPS} value={role as AssignableRole} onChange={(next) => void pickRole(next)} />
          <Text variant="caption" tone="secondary">
            Owners and admins manage the whole organization; editors and viewers can be limited to specific sites.
          </Text>
        </Card>
      ) : null}

      {editable && role !== 'admin' ? (
        <Card
          title="Site access"
          actions={
            <Button
              testID="member-edit-access"
              title="Edit"
              variant="text"
              onPress={() => {
                setAccess(draftOf(member))
                setEditingAccess(true)
              }}
            />
          }
        >
          <Text tone="secondary">{memberAccessLabel(member)}</Text>
        </Card>
      ) : null}

      {editable ? (
        <Button
          testID="member-remove"
          title="Remove from workspace"
          variant="outlined"
          icon="person-remove-outline"
          busy={busy === 'remove'}
          onPress={() => void remove()}
        />
      ) : null}

      <Sheet visible={editingAccess} onClose={() => setEditingAccess(false)} title={`Site access — ${name}`}>
        <View style={{ gap: 12, paddingBottom: 16 }}>
          <SiteAccessPicker value={access} onChange={setAccess} sites={sites} roleLabel={role} />
          <View style={{ paddingHorizontal: 16 }}>
            <Button testID="member-save-access" title="Save access" busy={busy === 'access'} onPress={() => void saveAccess()} />
          </View>
        </View>
      </Sheet>
    </Screen>
  )
}
