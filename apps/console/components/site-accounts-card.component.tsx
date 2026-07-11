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
import useFirestoreCollection from '../hooks/use-firestore-collection'

const PAGE_SIZE = 25

/**
 * Site users section (AGL-350): the visitor accounts created through the
 * storefront sign-up (AGL-109), searchable and paged — previously only a
 * dashboard afterthought. Newest first.
 */
export function SiteAccountsCard(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const [pageLimit, setPageLimit] = useState(PAGE_SIZE)
  const [search, setSearch] = useState('')
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
        String(member.name ?? '')
          .toLowerCase()
          .includes(term),
    )
  }, [memberDocs, search])

  return (
    <CardDisplay
      header={'Site users'}
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
                <TableCell align="right">{'Purchases'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {visible.map((member: any) => (
                <TableRow key={member.$id} hover>
                  <TableCell>{member.email ?? member.$id}</TableCell>
                  <TableCell>{member.name ?? '—'}</TableCell>
                  <TableCell>
                    {member.createdAt?.toDate?.()
                      ? member.createdAt.toDate().toLocaleDateString()
                      : '—'}
                  </TableCell>
                  <TableCell align="right">
                    {member.purchaseCents
                      ? `$${(Number(member.purchaseCents) / 100).toFixed(2)}`
                      : '—'}
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
    </CardDisplay>
  )
}
SiteAccountsCard.displayName = 'SiteAccountsCard'

export default SiteAccountsCard
