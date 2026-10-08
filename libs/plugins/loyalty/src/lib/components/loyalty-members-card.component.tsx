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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  Button,
  List,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { LOYALTY_API_ROUTES } from '../constants/api-routes'
import { formatLoyaltyCents, formatPoints } from '../model/loyalty-math'
import type { LoyaltyMemberView } from '../model/loyalty-member'
import { useLoyaltyFetch } from './loyalty-api'
import { LoyaltyAdjustDialog, LoyaltyMemberDialog } from './loyalty-member-dialog.component'

type Sort = 'recent' | 'points' | 'email'

const SORT_LABELS: Record<Sort, string> = {
  recent: 'Newest',
  points: 'Most points',
  email: 'Email',
}

interface MembersAnswer {
  members: LoyaltyMemberView[]
  next: string | null
}

/**
 * THE MEMBERS, under the store's Promotions (AGL-3640): every customer with a
 * rewards balance, newest first, or by points, or found by the start of their
 * email. Each search and sort is the server's query, paged by cursor, so page
 * two is page two of the store's members — never a page narrowed afterwards.
 *
 * Opening a member shows their codes and history and adjusts their balance;
 * "Give store credit" in the header does the same for any email, enrolling it.
 */
export function LoyaltyMembersCard(props: { hostId: string; canEdit?: boolean }) {
  const { hostId } = props
  const request = useLoyaltyFetch()
  const [sort, setSort] = useState<Sort>('recent')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  /** The cursor each page opens after: page 0 opens at the start. */
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [answer, setAnswer] = useState<MembersAnswer | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [openId, setOpenId] = useState<string | null>(null)
  const [adjusting, setAdjusting] = useState(false)
  const [revision, setRevision] = useState(0)

  // A typed search settles before it is asked.
  useEffect(() => {
    const timer = setTimeout(() => setQuery(search.trim()), 300)
    return () => clearTimeout(timer)
  }, [search])

  // Any change of what is asked starts again at the first page.
  useEffect(() => {
    setPage(0)
    setCursors([null])
  }, [sort, query, pageSize, hostId])

  useEffect(() => {
    let live = true
    const after = cursors[page]
    request<MembersAnswer>(LOYALTY_API_ROUTES.members, {
      query: {
        hostId,
        limit: String(pageSize),
        ...(query ? { q: query } : { sort }),
        ...(after ? { after } : {}),
      },
    })
      .then((next) => {
        if (!live) return
        setAnswer(next)
        setError(null)
        setCursors((prior) => {
          const copy = prior.slice(0, page + 1)
          copy[page + 1] = next.next
          return copy
        })
      })
      .catch((cause: Error) => live && setError(cause.message))
    return () => {
      live = false
    }
    // `cursors` is written here; reading it through `page` is enough.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hostId, request, sort, query, page, pageSize, revision])

  const refresh = useCallback(() => setRevision((value) => value + 1), [])
  const members = answer?.members ?? []

  return (
    <CardDisplay
      header="Rewards members"
      help={pluginDocsHelp('loyalty', {
        anchor: '#members-and-store-credit',
        excerpt: 'Find a member, see their history, and add or take away points and store credit.',
      })}
      HeaderProps={{
        action:
          props.canEdit === false ? null : (
            <Button variant="contained" onClick={() => setAdjusting(true)}>
              {'Give store credit'}
            </Button>
          ),
      }}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <TextField
            label="Find by email"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            size="small"
            fullWidth
            slotProps={{ htmlInput: { 'data-testid': 'loyalty-members-search' } }}
          />
          <TextField
            label="Sort"
            value={query ? 'email' : sort}
            onChange={(event) => setSort(event.target.value as Sort)}
            size="small"
            select
            disabled={Boolean(query)}
            sx={{ minWidth: 180 }}
          >
            {(Object.keys(SORT_LABELS) as Sort[]).map((value) => (
              <MenuItem key={value} value={value}>
                {SORT_LABELS[value]}
              </MenuItem>
            ))}
          </TextField>
        </Stack>
        {error ? (
          <Typography variant="body2" color="error">
            {error}
          </Typography>
        ) : members.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {!answer
              ? 'Loading members…'
              : query
                ? 'No member’s email starts with that.'
                : 'No members yet. A customer joins with their first order once rewards are on, or when you give them store credit.'}
          </Typography>
        ) : (
          <List disablePadding data-testid="loyalty-members-list">
            {members.map((member) => (
              <ListItemButton key={member.id} divider onClick={() => setOpenId(member.id)}>
                <ListItemText
                  primary={member.name ? `${member.name} · ${member.email}` : member.email}
                  secondary={`${formatPoints(member.points)} points · ${formatLoyaltyCents(member.creditCents)} store credit · ${formatPoints(
                    member.ordersCount,
                  )} ${member.ordersCount === 1 ? 'order' : 'orders'}`}
                />
              </ListItemButton>
            ))}
          </List>
        )}
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={members.length}
          hasMore={Boolean(answer?.next)}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </Stack>
      {openId ? (
        <LoyaltyMemberDialog
          hostId={hostId}
          memberId={openId}
          canEdit={props.canEdit !== false}
          onClose={() => setOpenId(null)}
          onChanged={refresh}
        />
      ) : null}
      {adjusting ? (
        <LoyaltyAdjustDialog
          hostId={hostId}
          member={null}
          onClose={() => setAdjusting(false)}
          onDone={() => {
            setAdjusting(false)
            refresh()
          }}
        />
      ) : null}
    </CardDisplay>
  )
}

export default LoyaltyMembersCard
