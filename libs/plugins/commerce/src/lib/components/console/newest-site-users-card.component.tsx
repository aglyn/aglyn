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

import { buildRoute, pluginDocsHelp, Route } from '@aglyn/aglyn'
import { AppLink, CardDisplay } from '@aglyn/shared-ui-jsx'
import { Button, Stack, Typography } from '@mui/material'
import { collection, limit, orderBy, query } from 'firebase/firestore'
import { useParams } from 'next/navigation'
import { useFirestore, useFirestoreCollection } from '@aglyn/tenant-feature-instance'

/**
 * Dashboard glance at the newest site users (AGL-350).
 *
 * ## Why this card lives in the commerce package and registers as `accounts`
 *
 * It is a card about visitor ACCOUNTS, and the accounts capability is a
 * switch a site turns on rather than a bundle that loads: the member blocks
 * and every `membership/*` handler ship inside commerce, which is why
 * `ACCOUNTS_PLUGIN_ID` has no manifest entry of its own. Registering the
 * widget under that id is what puts the card behind the same switch as the
 * `/signin` page it describes — the console dashboard used to import it
 * directly, so a site that has never turned member accounts on still had
 * `Newest site users` on its dashboard, permanently empty, advertising a
 * feature it does not serve.
 *
 * ## Five, and no footer
 *
 * A deliberate preview, not a window that got cut short: the Users section
 * owns the full, searchable, paged list and the header links to it. The
 * pagination sweep records the same reading in `table-footer-consistency`.
 *
 * `orderBy('createdAt', 'desc')` is safe to name, checked against the writers
 * rather than assumed — an `orderBy` DROPS documents missing the field, so a
 * newest-first list can quietly become a some-of-them list. Every path that
 * creates a member stamps it (`membership-register.ts` writes a
 * `serverTimestamp()` on the only sign-up route, the seed and e2e fixtures
 * stamp their own), and `siteMembers` is absent from `IMPORTABLE_FIELDS`, so
 * no site-bundle restore can mint one without it.
 */
export function NewestSiteUsersCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const { orgSlug, host } = useParams<{ orgSlug: string; host: string }>()
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
      help={pluginDocsHelp('membersOnly', {
        anchor: '#manage-your-members',
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
            {...({ componentVariant: 'naked', nativeButton: false } as any)}
            href={buildRoute(Route.HOST_USERS, { orgSlug, host })}
            size="small"
            color="primary"
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
                {/*
                  `displayName` first: that is the field sign-up writes, and a
                  member document has never carried `name` — the tenant's
                  campaign sender says so where it merges recipients. Reading
                  `name` first meant every account rendered as an email
                  address while the site knew the person's name.
                 */}
                {member.displayName || member.name || member.email || member.$id}
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
