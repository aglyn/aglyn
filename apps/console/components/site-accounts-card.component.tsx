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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import {
  collection,
  limit,
  orderBy,
  query,
} from 'firebase/firestore'
import { useMemo, useState } from 'react'
import { useFirestore } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import SiteMemberDrawer from './site-member-drawer.component'

const PAGE_SIZE = 25

/**
 * Site users section (AGL-350): the visitor accounts created through the
 * storefront sign-up (AGL-109), searchable and paged — previously only a
 * dashboard afterthought. Newest first. Rows open the member detail
 * drawer (AGL-546) with orders, subscriptions, the lifetime purchase
 * total, and suspend/reactivate; the old `purchaseCents` column read a
 * field nothing writes, so totals moved to the drawer where they are
 * computed from the order docs.
 */
export function SiteAccountsCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE)
  const [search, setSearch] = useState('')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const { data: memberDocs } = useFirestoreCollection<any>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'siteMembers'),
        orderBy('createdAt', 'desc'),
        limit(pageLimit),
      ),
    [firestore, hostId, pageLimit],
    { idField: '$id' },
  )

  const visible = useMemo(() => {
    const term = search.trim().toLowerCase()
    if (!term) return memberDocs ?? []
    return (memberDocs ?? []).filter(
      (member: any) =>
        String(member.email ?? '')
          .toLowerCase()
          .includes(term) ||
        String(member.displayName ?? member.name ?? '')
          .toLowerCase()
          .includes(term),
    )
  }, [memberDocs, search])

  // Resolved from the live docs so the drawer reflects rule-side updates.
  const selectedMember =
    (memberDocs ?? []).find((member: any) => member.$id === selectedId) ?? null

  return (
    <CardDisplay
      header={'Site users'}
      help={docsHelp('members', {
        anchor: '#4-manage-members-from-the-console',
        excerpt:
          'Visitors who signed up on your live site — open a row for ' +
          'orders, subscriptions, and suspend/reactivate.',
      })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <TextField
            size="small"
            placeholder="Search email or name…"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        ),
      }}
    >
      {visible.length ? (
        <Stack spacing={1}>
          <Table size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Email'}</TableCell>
                <TableCell>{'Name'}</TableCell>
                <TableCell>{'Joined'}</TableCell>
                <TableCell align="right">{'Status'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((member: any) => (
                <TableRow
                  key={member.$id}
                  hover
                  onClick={() => setSelectedId(member.$id)}
                  sx={{ cursor: 'pointer' }}
                >
                  <TableCell>{member.email ?? member.$id}</TableCell>
                  <TableCell>
                    {member.displayName ?? member.name ?? '—'}
                  </TableCell>
                  <TableCell>
                    {member.createdAt?.toDate?.()
                      ? member.createdAt.toDate().toLocaleDateString()
                      : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {member.suspended === true ? (
                      <Chip label="Suspended" size="small" color="error" />
                    ) : (
                      <Chip label="Active" size="small" variant="outlined" />
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {(memberDocs?.length ?? 0) >= pageLimit ? (
            <Button
              size="small"
              onClick={() => setPageLimit((prev) => prev + PAGE_SIZE)}
            >
              {'Load more'}
            </Button>
          ) : null}
        </Stack>
      ) : (
        <Typography variant="body2" color="text.secondary">
          {search
            ? 'No site users match the search.'
            : 'No site accounts yet — they appear when visitors sign up ' +
              'on your site.'}
        </Typography>
      )}
      <SiteMemberDrawer
        hostId={hostId}
        member={selectedMember}
        onClose={() => setSelectedId(null)}
      />
    </CardDisplay>
  )
}
SiteAccountsCard.displayName = 'SiteAccountsCard'

export default SiteAccountsCard
