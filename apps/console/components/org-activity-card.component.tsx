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
  List,
  ListItem,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useParams } from 'next/navigation'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  activityHref,
  activityPrimaryText,
} from '@aglyn/aglyn/app-utils/activity-presenter'
import { docsHelp } from '../constants/docs-links'

export interface OrgActivityCardProps {
  orgId: string
  max?: number
  header?: string
  /** Show only entries by this actor (member detail page, AGL-364). */
  actorId?: string
  /** Show only entries whose target is this id — changes made TO a
   * member/host/screen (AGL-389). */
  targetId?: string
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
 * collection, not its newest page. The client sort below then dutifully
 * ordered that sample by `createdAt` and sliced 20 off the top, which made the
 * result look right and be wrong: past 200 entries, a change made a minute ago
 * could simply never appear.
 *
 * It degrades exactly as an org grows into needing it, and this card is the
 * ONLY audit surface a customer admin has — it is also what the member-detail
 * page filters by `actorId` to answer "what has this person done", a question
 * a random sample cannot answer at all.
 *
 * The sibling `HostActivityTable` has always ordered its query; this is the
 * same one line. `createdAt` alone needs no composite index — Firestore
 * maintains single-field indexes in both directions automatically — so this
 * does not move `firestore.indexes.json`.
 *
 * The client-side sort is KEPT rather than replaced. It is no longer what
 * makes the feed newest-first, but the window can still contain a just-written
 * entry whose `serverTimestamp()` has not resolved locally, and sorting a
 * 200-item array costs nothing.
 */
export function OrgActivityCard(props: OrgActivityCardProps) {
  const { orgId, max = 20, header = 'Recent Activity', actorId, targetId } = props
  const { orgSlug } = useParams<{ orgSlug: string }>()
  const { data: user } = useUser()
  const [entries, setEntries] = useState<any[] | null>(null)
  // The user object's IDENTITY changes on every render of the provider above,
  // so depending on it re-runs the effect, which sets state, which renders,
  // which re-runs the effect — a fetch loop that only shows up under load.
  // The effect keys on the UID and reads the live object through a ref.
  const userRef = useRef(user)
  userRef.current = user
  const uid = (user as any)?.uid ?? null
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
   * nobody opens a console is not one. The window, the ordering and the
   * client tie-break sort below are unchanged — they moved, they were not
   * redesigned.
   *=========================================*/
  useEffect(() => {
    let live = true
    void (async () => {
      const idToken = await (userRef.current as any)?.getIdToken?.()
      if (!idToken) return
      try {
        const response = await fetch(
          `/api/orgs/activity?orgId=${encodeURIComponent(orgId)}`,
          { headers: { Authorization: `Bearer ${idToken}` } },
        )
        // A 403 is a real answer — this member's role does not carry
        // `org.auditLog` — and it must read as an empty feed rather than as a
        // feed still loading, or the card spins forever on a denial.
        const payload = response.ok ? await response.json() : { entries: [] }
        if (live) setEntries(payload?.entries ?? [])
      } catch {
        if (live) setEntries([])
      }
    })()
    return () => {
      live = false
    }
  }, [orgId, uid])
  // Filters (wave v5): free-text over action/actor plus a type select
  // when the entries carry one.
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
          (!actorId || entry.actorId === actorId) &&
          (!targetId ||
            entry.target?.id === targetId ||
            entry.targetId === targetId) &&
          (!typeFilter || entry.type === typeFilter) &&
          (!term ||
            [entry.action, entry.actorEmail]
              .filter(Boolean)
              .join(' ')
              .toLowerCase()
              .includes(term)),
      )
      .sort(
        (a, b) => (b.createdAt?.seconds ?? 0) - (a.createdAt?.seconds ?? 0),
      )
      .slice(0, max)
  }, [entries, max, filter, typeFilter, actorId, targetId])

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
      {(entries ?? []).length > 5 ? (
        <Stack direction="row" spacing={1} sx={{ mb: 1 }}>
          <TextField
            size="small"
            label="Filter"
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
      {items.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {(entries ?? []).length
            ? 'Nothing matches the filter.'
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
                secondary={`${entry.actorEmail ?? 'Someone'} · ${
                  entry.createdAt?.toDate?.().toLocaleString() ?? ''
                }`}
              />
            </ListItem>
            )
          })}
        </List>
      )}
    </CardDisplay>
  )
}
OrgActivityCard.displayName = 'OrgActivityCard'

export default OrgActivityCard
