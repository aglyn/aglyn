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
import { Button, EmptyState, Skeleton } from '@aglyn/mobile-ui'
import { useEffect, useMemo, useRef } from 'react'
import { View } from 'react-native'
import { MemberDetail } from './member-detail'
import { canManageTeam } from './team-api'
import { useTeam } from './use-team'

/**
 * The console's Team sections that share `/team/{segment}` with a member's
 * page (`/team/[uid]`); Next routes them first, so they are never a uid.
 * `members` has its own deep link; these two stay in the console.
 */
export const TEAM_CONSOLE_SECTIONS = new Set(['roles', 'activity'])

/** One member pushed on its own (phones, and the console's `/team/{uid}` links). */
export default function MemberScreen({ params, context }: MobileScreenProps) {
  const uid = params['uid'] ?? ''
  const consoleSection = TEAM_CONSOLE_SECTIONS.has(uid)
  const workspace = useWorkspace()
  const access = useOrgAccess(context.firestore, context.orgId, context.uid)
  const team = useTeam(context.api, consoleSection ? null : context.orgId, canManageTeam(access.role))
  const sites = useMemo(() => workspace.sites.map((site) => ({ id: site.id, name: site.name })), [workspace.sites])
  const handedOff = useRef(false)

  useEffect(() => {
    if (!consoleSection || handedOff.current) return
    handedOff.current = true
    context.openConsolePath(`/team/${uid}`, 'org')
  }, [consoleSection, uid, context])

  if (consoleSection) {
    return (
      <EmptyState
        icon="open-outline"
        title="This page is in the console"
        action={<Button title="Open it" variant="text" onPress={() => context.openConsolePath(`/team/${uid}`, 'org')} />}
      />
    )
  }
  if (!team.ready) {
    return (
      <View style={{ padding: 16, gap: 12 }} testID="member-loading">
        <Skeleton height={28} width="60%" />
        <Skeleton height={16} />
      </View>
    )
  }
  const member = team.members.find((entry) => entry.$id === uid)
  if (team.error || !member) {
    return <EmptyState icon="person-outline" title="This member is not in the workspace" body={team.error ?? undefined} />
  }
  return (
    <MemberDetail
      member={member}
      context={context}
      readerRole={access.role}
      sites={sites}
      onChanged={team.refresh}
      onRemoved={() => undefined}
    />
  )
}
