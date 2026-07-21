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

import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Stack, Typography } from '@mui/material'
import {
  collection,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../../constants/docs-links'
import { buildRoute, Route } from '../../constants/route-links'
import { useHostSubdomain } from '../../components/host-id-provider'
import { useOrgSlug } from '../../hooks/use-org-scope'
import useFirestoreCollection from '../../hooks/use-firestore-collection'

/**
 * Dashboard glance at the newest site users (AGL-350): loads exactly
 * five so the dashboard stays light; the Users section owns the full,
 * searchable list.
 */
export function NewestSiteUsersCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const host = useHostSubdomain()
  const { data: memberDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'siteMembers'),
        orderBy('createdAt', 'desc'),
        limit(5),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )

  return (
    <CardDisplay
      header={'Newest site users'}
      help={docsHelp('members', {
        anchor: '#4-manage-members-from-the-console',
        excerpt:
          'The five newest visitor accounts on this site — the Users page ' +
          'has the full, searchable list.',
      })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            component={AppLink as any}
            {...({ componentVariant: 'naked' } as any)}
            href={buildRoute(Route.HOST_USERS, { orgSlug,  host })}
            size="small"
            color="secondary"
          >
            {'View all'}
          </Button>
        ),
      }}
    >
      {memberDocs?.length ? (
        <Stack spacing={0.75}>
          {memberDocs.map((member: any) => (
            <Stack
              key={member.$id}
              direction="row"
              spacing={1}
              sx={{ justifyContent: 'space-between', alignItems: 'center' }}
            >
              <Typography variant="body2" noWrap sx={{ minWidth: 0 }}>
                {member.name || member.email || member.$id}
              </Typography>
              <Typography variant="caption" color="text.secondary" noWrap>
                {member.createdAt?.toDate?.()
                  ? member.createdAt.toDate().toLocaleDateString()
                  : ''}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {'No site accounts yet — they appear when visitors sign up on ' +
            'your site.'}
        </Typography>
      )}
    </CardDisplay>
  )
}
NewestSiteUsersCard.displayName = 'NewestSiteUsersCard'

export default NewestSiteUsersCard
