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

import { useOrgAccess, useWorkspace } from '@aglyn/mobile-core'
import type { MobileScreenProps } from '@aglyn/mobile-plugin-host'
import { Button, Chip, EmptyState, ListRow, Skeleton, SplitView, Text, useLayout } from '@aglyn/mobile-ui'
import { useMemo, useState } from 'react'
import { SectionList, View } from 'react-native'
import { WORKSPACE_MEMBER_SCREEN } from '../screen-ids'
import { confirmAction, showNotice, showRefusal } from '../shared/actions'
import { titleCase } from '../shared/format'
import { InviteSheet } from './invite-sheet'
import { MemberDetail } from './member-detail'
import {
  canManageTeam,
  memberAccessLabel,
  memberName,
  memberTypeLabel,
  resendInvite,
  revokeInvite,
  type OrgInvite,
  type OrgMember,
} from './team-api'
import { useTeam } from './use-team'

type Row = { kind: 'member'; member: OrgMember } | { kind: 'invite'; invite: OrgInvite }

/*==========================================
 * TEAM AND USERS.
 *
 * The workspace's members with their roles and reach, and, for an owner or
 * admin, the pending invites with Resend and Revoke and an Add or invite
 * sheet: the console's Members card. A member's row opens the member, whose
 * changes are made there.
 *=========================================*/

export default function TeamScreen({ context }: MobileScreenProps) {
  const { split } = useLayout()
  const workspace = useWorkspace()
  const access = useOrgAccess(context.firestore, context.orgId, context.uid)
  const canManage = canManageTeam(access.role)
  const team = useTeam(context.api, context.orgId, canManage)
  const [selected, setSelected] = useState<string | null>(null)
  const [inviting, setInviting] = useState(false)
  const [busyInvite, setBusyInvite] = useState<string | null>(null)
  const sites = useMemo(() => workspace.sites.map((site) => ({ id: site.id, name: site.name })), [workspace.sites])

  const sections = [
    { title: 'Members', data: team.members.map((member): Row => ({ kind: 'member', member })) },
    ...(canManage && team.invites.length
      ? [{ title: 'Pending invites', data: team.invites.map((invite): Row => ({ kind: 'invite', invite })) }]
      : []),
  ]

  const openMember = (member: OrgMember) => {
    if (split) setSelected(member.$id)
    else context.navigate(WORKSPACE_MEMBER_SCREEN, { uid: member.$id })
  }

  const revoke = async (invite: OrgInvite) => {
    const confirmed = await confirmAction({
      title: 'Revoke this invite?',
      message: `${invite.email ?? 'They'} can no longer use it to join.`,
      confirmLabel: 'Revoke',
      destructive: true,
    })
    if (!confirmed || !context.orgId) return
    setBusyInvite(invite.$id)
    try {
      await revokeInvite(context.api, context.orgId, invite.$id)
      await team.refresh()
    } catch (error) {
      showRefusal('Could not revoke the invite', error)
    } finally {
      setBusyInvite(null)
    }
  }

  const resend = async (invite: OrgInvite) => {
    const confirmed = await confirmAction({
      title: 'Send the invite again?',
      message: invite.email ? `To ${invite.email}.` : undefined,
      confirmLabel: 'Resend',
    })
    if (!confirmed || !context.orgId) return
    setBusyInvite(invite.$id)
    try {
      const payload = await resendInvite(context.api, context.orgId, invite.$id)
      showNotice(
        payload?.emailed ? `Invite re-sent to ${invite.email}` : `Couldn't email ${invite.email}`,
        payload?.emailed ? undefined : 'Check the workspace email settings.',
      )
    } catch (error) {
      showRefusal('Could not resend the invite', error)
    } finally {
      setBusyInvite(null)
    }
  }

  const current = team.members.find((member) => member.$id === selected) ?? null

  const list = !team.ready ? (
    <View style={{ padding: 16, gap: 12 }} testID="team-loading">
      <Skeleton height={44} />
      <Skeleton height={44} />
    </View>
  ) : team.error ? (
    <EmptyState
      icon="warning-outline"
      title="The team could not be loaded"
      body={team.error}
      action={<Button title="Try again" variant="text" onPress={() => void team.refresh()} />}
    />
  ) : (
    <SectionList
      testID="team-list"
      sections={sections}
      keyExtractor={(row) => (row.kind === 'member' ? `m:${row.member.$id}` : `i:${row.invite.$id}`)}
      ListHeaderComponent={
        canManage && context.orgId ? (
          <View style={{ padding: 16, flexDirection: 'row', justifyContent: 'flex-end' }}>
            <Button testID="team-invite" title="Add or invite" icon="person-add-outline" onPress={() => setInviting(true)} />
          </View>
        ) : null
      }
      ListEmptyComponent={<EmptyState icon="people-outline" title="No members yet" />}
      renderSectionHeader={({ section }) => (
        <Text variant="label" tone="secondary" style={{ paddingHorizontal: 16, paddingTop: 12, paddingBottom: 4 }}>
          {section.title}
        </Text>
      )}
      renderItem={({ item }) =>
        item.kind === 'member' ? (
          <ListRow
            testID={`member-${item.member.$id}`}
            icon="person-circle-outline"
            title={memberName(item.member)}
            subtitle={`${titleCase(item.member.role ?? 'viewer')} · ${memberAccessLabel(item.member)} · ${memberTypeLabel(item.member)}`}
            selected={split && item.member.$id === selected}
            onPress={() => openMember(item.member)}
          />
        ) : (
          <View>
            <ListRow
              testID={`invite-${item.invite.$id}`}
              icon="mail-outline"
              title={item.invite.email ?? item.invite.$id}
              subtitle={item.invite.handoff ? 'New owner (handoff) · no seat reserved' : `${titleCase(item.invite.role ?? 'viewer')} · ${memberTypeLabel(item.invite)}`}
              trailing={<Chip label="Pending" tone="warning" />}
            />
            <View style={{ flexDirection: 'row', justifyContent: 'flex-end', gap: 8, paddingHorizontal: 16, paddingBottom: 8 }}>
              <Button
                testID={`invite-resend-${item.invite.$id}`}
                title="Resend"
                variant="text"
                disabled={busyInvite === item.invite.$id}
                onPress={() => void resend(item.invite)}
              />
              <Button
                testID={`invite-revoke-${item.invite.$id}`}
                title="Revoke"
                variant="text"
                disabled={busyInvite === item.invite.$id}
                onPress={() => void revoke(item.invite)}
              />
            </View>
          </View>
        )
      }
    />
  )

  return (
    <>
      <SplitView
        list={<View style={{ flex: 1 }}>{list}</View>}
        detail={
          current ? (
            <MemberDetail
              key={current.$id}
              member={current}
              context={context}
              readerRole={access.role}
              sites={sites}
              onChanged={team.refresh}
              onRemoved={() => setSelected(null)}
            />
          ) : (
            <EmptyState icon="people-outline" title="Pick a member to see them here" />
          )
        }
      />
      {canManage && context.orgId ? (
        <InviteSheet
          visible={inviting}
          onClose={() => setInviting(false)}
          onDone={() => {
            setInviting(false)
            void team.refresh()
          }}
          api={context.api}
          orgId={context.orgId}
          sites={sites}
        />
      ) : null}
    </>
  )
}
