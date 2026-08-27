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
import {
  Alert,
  Button,
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useParams } from 'next/navigation'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  activityHref,
  activityPrimaryText,
} from '@aglyn/aglyn/app-utils/activity-presenter'
import { docsHelp } from '../constants/docs-links'
import { formatWireTimestamp } from '../utils/staff-timestamps'

export interface OrgActivityCardProps {
  orgId: string
  /** Rows per page. */
  pageSize?: number
  header?: string
  /** Show only entries whose target is this id — changes made TO a
   * member/host/screen (AGL-389). Applied by the route, not here. */
  targetId?: string
  /**
   * Include the org's SITES, not just its org-level events (AGL-1490).
   *
   * Off by default because the two existing callers depend on the narrower
   * feed: "Changes to this member" filters org entries by target, and folding
   * site activity in would file a member's own page edits under a heading
   * about changes made TO them.
   *
   * This scope is a fan-out merged by date rather than one collection, so it
   * has no cursor to continue from and the pager below stays hidden for it.
   */
  orgWide?: boolean
}

/**
 * Org-level counterpart to `HostActivityCard` (AGL-118): newest-first feed
 * from `orgs/{orgId}/activity`, populated by the org settings/members/
 * invites API routes.
 *
 * ## The window has to be ORDERED, not merely capped (AGL-2292)
 *
 * This docblock said "newest-first" while the query was `limit(200)` with no
 * `orderBy`. Firestore then returns documents in DOCUMENT-ID order, and
 * `logOrgActivity` creates entries with `.add()`, so the ids are effectively
 * random — meaning the 200 rows fetched were a pseudo-random SAMPLE of the
 * collection, not its newest page. The client sort then dutifully ordered
 * that sample by `createdAt` and sliced 20 off the top, which made the result
 * look right and be wrong: past 200 entries, a change made a minute ago could
 * simply never appear.
 *
 * ## And it has to be a PAGE, not a window
 *
 * Ordering the query fixed which 200 were fetched; it did not make more than
 * twenty of them reachable. The card read 200 documents and rendered the
 * newest 20, so rows 21 through 200 were paid for and never shown, and entry
 * 201 could not be reached at all. An audit log whose history stops at an
 * arbitrary depth answers "who changed this, and when" only for changes
 * recent enough not to need asking about.
 *
 * The route serves a cursor page now, so the reader walks back through the
 * whole history and each step costs `pageSize + 1` reads instead of 200.
 *
 * ## The filters below are page-scoped, and say so
 *
 * Free text and type filter the rows ON SCREEN. They are a way to pick a row
 * out of the page in front of you, not a search across the feed — which is
 * why an empty result says so in those words rather than claiming there is
 * nothing to find. `targetId` is the opposite kind of filter and belongs to
 * the query: filtering it here would let a page of 25 entries contribute two
 * rows and still call itself the page.
 */
export function OrgActivityCard(props: OrgActivityCardProps) {
  const {
    orgId,
    pageSize = 20,
    header = 'Recent Activity',
    targetId,
    orgWide,
  } = props
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const { data: user } = useUser()
  // The user object's IDENTITY changes on every render of the provider above,
  // so depending on it re-runs the effect, which sets state, which renders,
  // which re-runs the effect — a fetch loop that only shows up under load.
  // The effect keys on the UID and reads the live object through a ref.
  const userRef = useRef(user)
  userRef.current = user
  const uid = (user as { uid?: string } | undefined)?.uid ?? null

  const [entries, setEntries] = useState<any[] | null>(null)
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  const [nextCursor, setNextCursor] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  /*
   * "Could not look" is not "found nothing" (AGL-2486). A denial IS a real
   * answer — this member's role does not carry `org.auditLog` — and reads as
   * an empty feed, because it truthfully is one for them. A read that FAILED
   * says so instead of presenting itself as a clean record.
   */
  const [unreadable, setUnreadable] = useState(false)

  /*==========================================
   * READ THROUGH THE ROUTE, not the client SDK (AGL-2444).
   *
   * This was a live `orgs/{orgId}/activity` listener, and the security rule
   * behind it gated on `isOrgWideMember()` — the ROSTER question. The
   * `org.auditLog` permission was consulted only by the team page deciding
   * whether to mount this card, so revoking it hid the card and changed
   * nothing about who could read the feed. `/api/orgs/activity` checks the
   * permission with the Admin SDK and the rule now denies members outright,
   * which is what turns that check into enforcement.
   *
   * The live listener is what is lost, and knowingly: an audit feed is read
   * deliberately rather than watched, and a permission that only holds while
   * nobody opens a console is not one.
   *=========================================*/
  const loadPage = useCallback(
    async (targetPage: number, cursor: string | null) => {
      setLoading(true)
      try {
        const idToken = await (
          userRef.current as { getIdToken?: () => Promise<string> } | undefined
        )?.getIdToken?.()
        if (!idToken) return
        const url = new URL('/api/orgs/activity', window.location.origin)
        url.searchParams.set('orgId', orgId)
        if (orgWide) {
          url.searchParams.set('scope', 'org-wide')
          url.searchParams.set('limit', String(pageSize))
        } else {
          url.searchParams.set('pageSize', String(pageSize))
          if (targetId) url.searchParams.set('targetId', targetId)
          if (cursor) url.searchParams.set('cursor', cursor)
        }
        const response = await fetch(url.toString(), {
          headers: { Authorization: `Bearer ${idToken}` },
        })
        if (!response.ok) {
          // 403 is the permission answering, and the honest render of it is
          // an empty feed. Anything else means the read broke.
          setUnreadable(response.status !== 403)
          setEntries([])
          setNextCursor(null)
          return
        }
        const payload = (await response.json()) as {
          entries?: any[]
          nextCursor?: string | null
        }
        setUnreadable(false)
        setEntries(payload?.entries ?? [])
        setNextCursor(payload?.nextCursor ?? null)
        setPage(targetPage)
      } catch {
        setUnreadable(true)
        setEntries([])
        setNextCursor(null)
      } finally {
        setLoading(false)
      }
    },
    [orgId, orgWide, pageSize, targetId],
  )

  useEffect(() => {
    setCursors([null])
    void loadPage(0, null)
  }, [uid, loadPage])

  // Filters (wave v5): free-text over action/actor plus a type select
  // when the entries carry one. Both are page-scoped; see the docblock.
  const [filter, setFilter] = useState('')
  const [typeFilter, setTypeFilter] = useState('')
  const types = useMemo(
    () =>
      [
        ...new Set(
          (entries ?? [])
            .map((entry: any) => String(entry.type ?? ''))
            .filter(Boolean),
        ),
      ].sort(),
    [entries],
  )
  const items = useMemo(() => {
    const term = filter.trim().toLowerCase()
    return [...(entries ?? [])]
      .filter(
        (entry: any) =>
          (!typeFilter || entry.type === typeFilter) &&
          (!term ||
            [entry.action, entry.actorEmail]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(term)),
      )
      /*
       * The route orders the query, so this no longer decides the order. It
       * is kept for the entry whose `serverTimestamp()` has not resolved yet:
       * a row written moments ago arrives with no `createdAt` and would
       * otherwise sit wherever the server left it.
       */
      .sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
      )
  }, [entries, filter, typeFilter])

  // A pager on a single-page feed is furniture. It appears once there is
  // somewhere to go — and never for the org-wide fan-out, which has no
  // cursor to offer.
  const paged = !orgWide && (page > 0 || Boolean(nextCursor))

  return (
    <CardDisplay
      header={header}
      help={docsHelp('inviteTeammates', {
        anchor: '#activity-log',
        excerpt:
          'Who changed what in this organization — settings, members, ' +
          'invites, and site-level changes.',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        {(entries ?? []).length > 5 ? (
          <Stack direction="row" spacing={1}>
            <TextField
              size="small"
              label="Filter this page"
              value={filter}
              onChange={(event) => setFilter(event.target.value)}
              sx={{ maxWidth: 240, flexGrow: 1 }}
            />
            {types.length > 1 ? (
              <TextField
                select
                size="small"
                label="Type"
                value={typeFilter}
                onChange={(event) => setTypeFilter(event.target.value)}
                sx={{ minWidth: 130 }}
              >
                <MenuItem value="">{'All'}</MenuItem>
                {types.map((type) => (
                  <MenuItem key={type} value={type}>
                    {type}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </Stack>
        ) : null}
        {unreadable ? (
          <Stack spacing={1.5} sx={{ alignItems: 'flex-start' }}>
            <Alert severity="warning" sx={{ width: '100%' }}>
              {'Could not read the activity log. This is NOT the same as ' +
                'nothing having happened — do not read this as an empty ' +
                'history.'}
            </Alert>
            <Button size="small" onClick={() => void loadPage(page, cursors[page] ?? null)}>
              {'Try again'}
            </Button>
          </Stack>
        ) : items.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {(entries ?? []).length
              ? 'Nothing on this page matches the filter.'
              : loading
                ? 'Loading…'
                : 'No activity yet — changes made in the console appear here.'}
          </Typography>
        ) : (
          <List dense disablePadding>
            {items.map((entry) => {
              const href = activityHref(entry, { orgSlug })
              const label = activityPrimaryText(entry)
              return (
                <ListItem key={entry.$id} disableGutters dense>
                  <ListItemText
                    primary={
                      href ? (
                        <AppLink href={href} color="inherit" underline="hover">
                          {label}
                        </AppLink>
                      ) : (
                        label
                      )
                    }
                    secondary={`${
                      entry.actorEmail ?? 'Someone'
                    } · ${formatWireTimestamp(entry.createdAt)}`}
                  />
                </ListItem>
              )
            })}
          </List>
        )}
        {paged ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button
              size="small"
              color="primary"
              disabled={loading || page === 0}
              onClick={() => {
                const previous = cursors[page - 1] ?? null
                setCursors((current) => current.slice(0, page))
                void loadPage(page - 1, previous)
              }}
            >
              {'Previous'}
            </Button>
            <Typography variant="caption" color="text.secondary">
              {loading ? 'Loading…' : `Page ${page + 1}`}
            </Typography>
            <Button
              size="small"
              color="primary"
              disabled={loading || !nextCursor}
              onClick={() => {
                const cursor = nextCursor
                setCursors((current) => [...current, cursor])
                void loadPage(page + 1, cursor)
              }}
            >
              {'Next'}
            </Button>
          </Stack>
        ) : null}
      </Stack>
    </CardDisplay>
  )
}
OrgActivityCard.displayName = 'OrgActivityCard'

export default OrgActivityCard
