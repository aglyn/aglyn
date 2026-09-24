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

import {
  AppLink,
  CardDisplay,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import {
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Box,
  Button,
  Chip,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  doc,
  documentId,
  getCountFromServer,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { docsHelp } from '../constants/docs-links'
import { checkHostCollaboratorSeatQuota } from '../constants/entitlements'
import { buildRoute, Route } from '../constants/route-links'
import { TABLE_ROW_HEIGHT } from '../constants/shared'
import {
  HOST_MEMBER_FILTER_FIELDS,
  HOST_MEMBER_FILTER_HEADERS,
  HOST_MEMBER_LIST_QUERY,
  hostMemberListRequest,
} from '../utils/host-member-filters'
import { listQueryRefusalNotices } from '../utils/list-query-refusals'
import MemberAvatar from './member-avatar.component'
import {
  pluginGridColumns,
  useStablePluginColumns,
} from './plugin-grid-columns.component'
import { usePluginListColumns } from './plugin-list-columns.component'
import PluginWidgetSlot from './plugin-widget-slot.component'
import { useOrgSlug } from '../hooks/use-org-scope'
import useCurrentOrg from '../hooks/use-current-org'
import useFirestoreCollection from '../hooks/use-firestore-collection'
import useFirestoreDoc from '../hooks/use-firestore-doc'
import useOrgPermissions from '../hooks/use-org-permissions'

/**
 * Site-collaborator roles, weakest first.
 *
 * `Author` (AGL-2334) is the one the agency guide's worked example asks for —
 * *"a client who may edit content but not publish"*. It is `Editor` minus
 * publication: it edits screens, layouts, components and collection entries,
 * and it cannot register a route, move a live version pointer, schedule
 * either for later, or publish an entry. Enforced in the Firestore security
 * rules, which is where publishing actually happens (the console writes those
 * documents directly from the browser), not in a route.
 */
const ROLE_OPTIONS = [
  { value: 'viewer', label: 'Viewer', hint: 'Can look, cannot change anything' },
  {
    value: 'author',
    label: 'Author',
    hint: 'Can edit content, cannot publish it',
  },
  {
    value: 'editor',
    label: 'Editor',
    hint: 'Can edit content and publish it',
  },
  { value: 'admin', label: 'Admin', hint: 'Full control, including people' },
]

/** The Site access filter's choices: the roles above, by their labels. */
const ROLE_FILTER_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  role: ROLE_OPTIONS.map(({ value, label }) => ({ value, label })),
}

/** The owner's row, drawn above the roster; no roster document has this id. */
const OWNER_ROW_ID = '__owner__'

/** A plugin column's header sorts nothing here: the roster keeps its order. */
const NO_PLUGIN_SORT = () => undefined

/** Keys typed into a cell's picker are the picker's, not the grid's. */
const stopGridKeys = (event: { stopPropagation: () => void }) =>
  event.stopPropagation()

export interface HostMembersCardProps {
  hostId: string
}

/**
 * Host user manager (AGL-107): manual add-by-email with a role, role
 * changes, and removal — all through /api/hosts/members (Admin SDK: email →
 * uid lookup, `memberRoles` sync, member-seat quota AGL-112). Roles
 * beyond admin/non-admin are recorded now and enforced with granular rules
 * (AGL-108 follow-up); the card says so instead of overpromising.
 */
export function HostMembersCard(props: HostMembersCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const orgSlug = useOrgSlug()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org, ready: orgReady } = useCurrentOrg()
  const { permissions } = useOrgPermissions()
  const canManage = permissions.manageMembers
  // Columns a plugin contributes to this table (AGL-2940), between the site
  // access and the actions; cards a plugin adds render under the table.
  const { columns: pluginColumns } = usePluginListColumns('hostMembers')
  const [email, setEmail] = useState('')
  const [role, setRole] = useState('editor')
  const [busy, setBusy] = useState(false)

  const { data: host } = useFirestoreDoc<any>(
    () => doc(firestore, 'hosts', hostId),
    [firestore, hostId],
    { idField: '$id' },
  )
  /*
   * Paging (AGL-1124), now the console's shared one (AGL-2501). This used to
   * be a bare `limit(100)` with nothing saying so, which is the worst of
   * both: a site with 120 collaborators showed 100 and looked complete. Then
   * it grew a page at a time behind a "Load more", which is a third control
   * where the console already had too many — and one that can only ever go
   * forward.
   *
   * ## The window is ORDERED, and the page is not re-sorted
   *
   * The page carried no `orderBy` and was then sorted BY EMAIL in the
   * browser. Firestore answers an unordered limit in document-id order and a
   * member's id is a generated uid, so page one was ten arbitrary
   * collaborators arranged alphabetically — which reads as the alphabetical
   * first ten, and is not. Nobody was hidden (an id walk is total, so every
   * member is reachable by paging) but the order the list appeared to be in
   * was not the order it was in.
   *
   * `email` is safe to order on, which is the question `orderBy` always
   * raises: it matches only documents that HAVE the field, so ordering on one
   * a writer omits hides rows instead of arranging them. This collection has
   * exactly one creator — `POST /api/hosts/members` — and it writes `email`
   * unconditionally on the same `set` that brings the document into
   * existence. There is no client write path (the rules make host
   * subcollection membership server-only) and no import path (`members` is
   * not in the site-bundle allow-list), so a member document without an email
   * cannot be produced.
   *
   * The rows are handed on as they arrive. Sorting a server-ordered page in
   * the browser is what produced the old illusion, and it would produce a
   * subtler one here: Firestore collates by UTF-8 bytes, `localeCompare` does
   * not, so the two disagree on case and accents and the page would be
   * arranged differently from the walk it was cut from.
   *
   * ## Filtered beneath that order, by the query (AGL-3321)
   *
   * Every clause is the query's own, planned together (`planListQuery`
   * through `useListQuery`): Site access (`role` equality or `in`) and the
   * quick search, which is a prefix of the stored, lower-cased address — a
   * range on `email`, the field the roster is already ordered by. A filtered
   * page is therefore a page of the filtered roster, never the rows on screen
   * narrowed, and whatever the plan cannot put on the query is refused by
   * name above the grid rather than applied to some rows. See
   * `utils/host-member-filters.ts` for the index each shape reads. A new
   * filter is a new walk, and the pager starts over.
   */
  const gridFilter = useListGridFilter({ selectFields: ['role'] })
  const listRequest = useMemo(
    () => hostMemberListRequest(gridFilter.clauses, gridFilter.searchWords),
    [gridFilter.clauses, gridFilter.searchWords],
  )
  const {
    rows: members,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    plan,
  } = useListQuery<any>({
    collection: collection(firestore, 'hosts', hostId, 'members'),
    declaration: HOST_MEMBER_LIST_QUERY,
    request: listRequest,
    deps: [firestore, hostId],
    idField: '$id',
  })
  /**
   * SEATS USED is a server aggregate, not the length of the page window
   * (AGL-1716, the AGL-1706 shape).
   *
   * `members` is one PAGE — 25 rows, growing 25 at a time on "Load more" —
   * and it was being handed to `checkOrgSeatQuota` as the site's seat count
   * and printed verbatim as "N of M member seats used". `membersPerHost`
   * runs 50 / 75 / 100 / 250 from Business up, all above the window, so a
   * site with 60 collaborators on Business read "25 of 50 member seats
   * used": under its band, with the extra-seat upsell suppressed, while it
   * was actually over. The API still refused the next add — the card just
   * offered headroom that did not exist and then failed the action.
   *
   * The paging comment above exists *because* an unannounced `limit(100)`
   * once made a 120-collaborator site look complete (AGL-1124). The list
   * got the fix; the count that sits beside it did not.
   *
   * The window stays exactly as it is. The list and the count are different
   * questions: one aggregate read per mount, re-read after any mutation
   * that can move the number.
   */
  const [seatCountEpoch, setSeatCountEpoch] = useState(0)
  const [serverMemberCount, setServerMemberCount] = useState<number | null>(
    null,
  )
  useEffect(() => {
    let active = true
    void getCountFromServer(collection(firestore, 'hosts', hostId, 'members'))
      .then((snapshot) => {
        if (active) setServerMemberCount(snapshot.data().count)
      })
      .catch(() => {
        // Falls back to the page length below — a LOWER bound, and this
        // card's prior behaviour. Deliberately not 0: `checkOrgSeatQuota`
        // answers from whatever it is handed (AGL-1422), and 0 seats used
        // is a confident wrong number in the flattering direction.
      })
    return () => {
      active = false
    }
  }, [firestore, hostId, seatCountEpoch])
  // Pending or denied, the page window stands in. It can only UNDERSTATE,
  // never overstate, so nothing this figure gates fires on a count larger
  // than the truth.
  const memberSeatsUsed = serverMemberCount ?? members.length
  /**
   * THE PER-SITE quota, not the org-level one (AGL-2439).
   *
   * `checkOrgSeatQuota(org, 'members', …)` answers the PLAN's allowance with
   * no purchased seats in it, because `seatAddons.members` is an org POOL now
   * and `org.collaboratorAllocations` says which site holds each seat. Using
   * it here would quote a site a cap BELOW the one enforcement applies and
   * suppress an Add the org has paid for — the mirror image of the bug being
   * fixed, and the reason the host-scoped helper exists.
   */
  const seatQuota = checkHostCollaboratorSeatQuota(org, hostId, memberSeatsUsed)

  // The owner row is the ORG's owner (AGL-1123). It used to render the
  // signed-in `user` whenever they happened to be an admin on this host, so
  // the row badged "Owner" was really "whoever is looking at this page" — it
  // never showed the owner, and an ownership transfer appeared not to have
  // taken. The owner's address comes from their org-member doc; a failed or
  // absent read falls back to the generic label rather than to the viewer.
  const orgId = (org as any)?.$id as string | undefined
  const ownerUid = (org as any)?.ownerUid as string | undefined
  const { data: ownerMember } = useFirestoreDoc<any>(
    () =>
      orgId && ownerUid
        ? doc(firestore, 'orgs', orgId, 'members', ownerUid)
        : null,
    [firestore, orgId, ownerUid],
  )
  const ownerLabel =
    (ownerMember?.email as string | undefined) ??
    (ownerMember?.displayName as string | undefined) ??
    'Account owner'


  // A member's photo lives on their ORG member doc, not here (AGL-1126).
  //
  // These rows come from `hosts/{hostId}/members`, a different collection
  // whose only writer sets an explicit field list with no `photoURL` on it —
  // so `member.photoURL` was `undefined` for every row and MemberAvatar fell
  // through to Gravatar (since removed, AGL-1683 — the fallback is initials
  // now). That went unnoticed because the OWNER row reads its org member doc
  // directly (just above) and therefore did render a stored photo: the one
  // row that worked was the one being looked at.
  //
  // Joining rather than copying the field onto the host doc keeps one source
  // of truth for a member's face, which is what AGL-1126 was for. One `in`
  // query covers a whole page — Firestore allows 30 and the page is 25.
  const memberUids = useMemo(
    () =>
      Array.from(
        new Set(
          members
            .map((member) => member.uid as string | undefined)
            .filter((uid): uid is string => Boolean(uid)),
        ),
      ),
    [members],
  )
  /*
   * Firestore allows 30 values in an `in`, and a page can hold 50.
   *
   * This was one query over `uids.slice(0, 30)`, which was exactly right
   * while the page was 25 and silently wrong the moment a reader chose a
   * larger one: members past the thirtieth kept their row and lost their
   * face, with nothing to say why. Two fixed queries cover the largest page
   * the size menu offers. Fixed, not mapped — a hook count that changed with
   * the roster would change between renders.
   */
  const uidChunks = useMemo(
    () => [memberUids.slice(0, 30), memberUids.slice(30, 60)],
    [memberUids],
  )
  const orgMembersIn = (chunk: string[]) =>
    orgId && chunk.length
      ? query(
          collection(firestore, 'orgs', orgId, 'members'),
          where(documentId(), 'in', chunk),
        )
      : null
  const { data: orgMemberDocsA } = useFirestoreCollection<any>(
    () => orgMembersIn(uidChunks[0]),
    [firestore, orgId, uidChunks[0].join(',')],
    { idField: '$id' },
  )
  const { data: orgMemberDocsB } = useFirestoreCollection<any>(
    () => orgMembersIn(uidChunks[1]),
    [firestore, orgId, uidChunks[1].join(',')],
    { idField: '$id' },
  )
  const photoByUid = useMemo(() => {
    const map = new Map<string, string>()
    for (const doc of [...(orgMemberDocsA ?? []), ...(orgMemberDocsB ?? [])]) {
      const photo = doc?.photoURL as string | undefined
      if (photo) map.set(doc.$id as string, photo)
    }
    return map
  }, [orgMemberDocsA, orgMemberDocsB])

  const request = useCallback(
    async (method: string, body: Record<string, unknown>) => {
      setBusy(true)
      try {
        const response = await authorizedFetch(user, '/api/hosts/members', {
          method,
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, ...body }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          enqueueSnackbar(payload?.error ?? 'Member operation failed', {
            variant: 'warning',
            persist: false,
          })
          return null
        }
        // An add or a remove moves the seat count, and the aggregate above
        // is a one-shot — the listener refreshes the LIST for free, the
        // count has to be asked again or the caption drifts stale for the
        // rest of the session. A role change cannot move it; re-reading
        // anyway is a single aggregate and keeps this off the caller.
        setSeatCountEpoch((epoch) => epoch + 1)
        return payload
      } catch (error) {
        console.error(error)
        enqueueSnackbar('Member operation failed', { variant: 'error' })
        return null
      } finally {
        setBusy(false)
      }
    },
    [user, hostId, enqueueSnackbar],
  )

  const handleAdd = useCallback(async () => {
    const value = email.trim().toLowerCase()
    if (!value) return
    const payload = await request('POST', { email: value, role })
    if (!payload) return
    enqueueSnackbar(
      payload.status === 'invited'
        ? `Invited ${value} — access starts when they sign up`
        : `Added ${value}`,
      { variant: 'success', persist: false },
    )
    setEmail('')
  }, [email, role, request, enqueueSnackbar])

  const handleRoleChange = useCallback(
    (member: any) => async (event: { target: { value: string } }) => {
      const payload = await request('PATCH', {
        memberId: member.$id,
        role: event.target.value,
      })
      if (!payload) return
      enqueueSnackbar('Site access updated', {
        variant: 'success',
        persist: false,
      })
    },
    [request, enqueueSnackbar],
  )

  const handleRemove = useCallback(
    (member: any) => async () => {
      const confirmed = await confirm({
        title: 'Remove this member?',
        description: `"${member.email}" loses access to this host.`,
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      const payload = await request('DELETE', { memberId: member.$id })
      if (!payload) return
      enqueueSnackbar('Member removed', { variant: 'success', persist: false })
    },
    [confirm, request, enqueueSnackbar],
  )

  /*
   * The owner leads every page, as a row of its own: it is the ORG's owner,
   * not a roster document, so no query reaches it. Under a filter it stays
   * only while it answers every clause the query SERVED — the row reads
   * Admin, and its address is keyed the way the plan keys the prefix it asks
   * the roster for.
   */
  const ownerEmail = nameSearchNormalizers.key(String(ownerMember?.email ?? ''))
  const ownerShown = plan.served.every((clause) => {
    if (clause.field === 'role') {
      return clause.value
        .split(',')
        .map((entry) => entry.trim())
        .includes('admin')
    }
    if (clause.field === 'email') {
      return (
        ownerEmail !== '' &&
        ownerEmail.startsWith(nameSearchNormalizers.key(clause.value))
      )
    }
    return false
  })
  const rows = useMemo(
    () => [
      ...(ownerShown ? [{ $id: OWNER_ROW_ID, owner: true }] : []),
      ...members,
    ],
    [ownerShown, members],
  )

  /*
   * Columns a plugin contributes to this table (AGL-2940), between the role
   * and the actions. Each cell is handed its member beside the zone's props;
   * the owner's row hands the owner, when the org names one.
   */
  const stablePluginColumns = useStablePluginColumns(pluginColumns)
  const pluginMemberColumns = useMemo(
    () =>
      pluginGridColumns<any>(stablePluginColumns, {
        slotProps: { orgId, hostId, canManage },
        sortedBy: null,
        onSort: NO_PLUGIN_SORT,
        rowProps: (row) =>
          row.owner
            ? { member: { $id: ownerUid, uid: ownerUid, role: 'owner' } }
            : { member: row },
      }).map((column) => ({
        ...column,
        // With no owner named, the owner's row has no one to hand a cell.
        renderCell: (params: any) =>
          params.row.owner && !ownerUid ? null : column.renderCell?.(params),
      })),
    [stablePluginColumns, orgId, hostId, canManage, ownerUid],
  )

  const columns = useMemo(
    (): GridColDef[] =>
      listFilterGridColumns(
        [
          {
            field: 'email',
            headerName: 'Member',
            flex: 1.4,
            minWidth: 240,
            filterable: false,
            valueGetter: (_value, row: any) =>
              row.owner ? ownerLabel : String(row.email ?? row.$id),
            renderCell: ({ row: member }: any) =>
              member.owner ? (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', height: '100%' }}
                >
                  {/* The owner is a member row like any other, so it gets a
                      face too — otherwise the top row reads as broken beside
                      the ones that have one. Photo and email come from the
                      owner's org-member doc (AGL-1123), never from the
                      viewer. */}
                  <MemberAvatar
                    photoURL={ownerMember?.photoURL}
                    email={ownerMember?.email}
                    name={ownerLabel}
                    size={28}
                  />
                  <span>{ownerLabel}</span>
                  <Chip label="Owner" color="primary" size="small" />
                  {ownerUid && ownerUid === user?.uid ? (
                    <Chip label="you" size="small" variant="outlined" />
                  ) : null}
                </Stack>
              ) : (
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ alignItems: 'center', height: '100%' }}
                >
                  {/* No avatar here at all before AGL-1126. An invited row
                      still gets one — the initial comes off the email's
                      local part, which is all an invite has. */}
                  <MemberAvatar
                    photoURL={
                      member.uid ? photoByUid.get(member.uid) : undefined
                    }
                    email={member.email}
                    name={member.displayName}
                    size={28}
                  />
                  {/* Into the member's detail page, like the org Team
                      table (AGL-1124) — this list was a dead end, with no
                      way through to the person it names. An INVITED row
                      has no account behind it yet, so it stays plain text
                      rather than linking to a member page that cannot
                      exist. */}
                  {member.status === 'invited' ? (
                    <span>{member.email}</span>
                  ) : (
                    <AppLink
                      href={buildRoute(Route.MANAGE_TEAM_MEMBER, {
                        orgSlug,
                        uid: member.$id,
                      })}
                      color="inherit"
                      underline="hover"
                    >
                      {member.email || member.$id}
                    </AppLink>
                  )}
                  {member.status === 'invited' ? (
                    <Chip label="Invited" size="small" variant="outlined" />
                  ) : null}
                </Stack>
              ),
          },
          {
            /* "Site access", not "Role" (AGL-1125). The org Team table's
               Role column is the ORG role; this one is access to THIS
               site. Two tables using one word for two different answers
               was the same confusion AGL-1125 fixed within the Team
               table, one page over. */
            field: 'role',
            headerName: 'Site access',
            flex: 0.8,
            minWidth: 150,
            valueGetter: (_value, row: any) =>
              row.owner ? 'admin' : (row.role ?? 'editor'),
            renderCell: ({ row: member }: any) =>
              member.owner ? (
                'Admin'
              ) : (
                <Box
                  onKeyDown={stopGridKeys}
                  sx={{ display: 'flex', alignItems: 'center', height: '100%' }}
                >
                  <TextField
                    select
                    size="small"
                    variant="standard"
                    value={member.role ?? 'editor'}
                    onChange={handleRoleChange(member)}
                    disabled={busy || !canManage}
                  >
                    {ROLE_OPTIONS.map((option) => (
                      <MenuItem key={option.value} value={option.value}>
                        {option.label}
                      </MenuItem>
                    ))}
                  </TextField>
                </Box>
              ),
          },
          ...pluginMemberColumns,
          listActionsColumn((member: any) =>
            member.owner ? (
              '--'
            ) : (
              <Button
                size="small"
                color="error"
                disabled={busy || !canManage}
                onClick={handleRemove(member)}
              >
                {'Remove'}
              </Button>
            ),
          ),
        ],
        HOST_MEMBER_FILTER_FIELDS,
        ROLE_FILTER_OPTIONS,
        HOST_MEMBER_FILTER_HEADERS,
      ),
    [
      ownerLabel,
      ownerMember,
      ownerUid,
      user?.uid,
      photoByUid,
      orgSlug,
      handleRoleChange,
      handleRemove,
      busy,
      canManage,
      pluginMemberColumns,
    ],
  )

  return (
    <CardDisplay
      header={'Users'}
      help={docsHelp('team', {
        anchor: '#site-collaborators',
        excerpt:
          'Teammates with console access to this site — add by email ' +
          'with a role; membership uses your plan’s member seats.',
      })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      <Stack spacing={1.5}>
        <Typography variant="caption" color="text.secondary">
          {'Site users are organization members scoped to this site — the '}
          <AppLink href={buildRoute(Route.MANAGE_TEAM, { orgSlug })} color="primary">
            {'organization Team page'}
          </AppLink>
          {' manages everyone in one place.'}
        </Typography>
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            size="small"
            label="Email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            sx={{ flexGrow: 1 }}
          />
          <TextField
            select
            size="small"
            label="Site access"
            value={role}
            onChange={(event) => setRole(event.target.value)}
            // The role names alone do not say what an Author cannot do, and
            // "edit content but not publish" is the whole reason to pick it.
            helperText={
              ROLE_OPTIONS.find((option) => option.value === role)?.hint ?? ' '
            }
            sx={{ minWidth: 150 }}
          >
            {ROLE_OPTIONS.map((option) => (
              <MenuItem key={option.value} value={option.value}>
                {option.label}
              </MenuItem>
            ))}
          </TextField>
          <Button
            size="small"
            variant="contained"
            color="primary"
            disabled={busy || !email.trim() || !canManage}
            onClick={handleAdd}
          >
            {'Add'}
          </Button>
        </Stack>
        {/* AGL-1422, the per-site twin of the org roster's seat line:
            `checkOrgSeatQuota(undefined, …)` resolves the FREE tier, so the
            loading window told a paying site it was over a limit it is
            nowhere near. Only a loaded plan may quote a seat count. */}
        {orgReady && Number.isFinite(seatQuota.limit) ? (
          <>
            {/*
              The shared readout (AGL-2113/2439), so this line and every other
              per-site quota in the console say the number the same way. The
              count is the site's collaborators, not this page of them
              (AGL-1716), and the denominator is the PER-SITE cap: the plan's
              allowance plus the pool seats assigned to this site.
            */}
            <QuotaReadoutComponent
              ready={orgReady}
              used={memberSeatsUsed}
              limit={seatQuota.limit}
              noun="collaborator"
              period="on this site"
            />
            {/*
              WHAT THE ORG HAS, beside what the cap is — the whole point of
              the readout being here rather than only in Billing. A site that
              holds pool seats should be able to see that it does, or the
              add-on it paid for is invisible at the surface it acts on.
            */}
            {seatQuota.assignedSeats > 0 ? (
              <Typography variant="caption" color="text.secondary" component="div">
                {`Includes ${seatQuota.assignedSeats} purchased seat${
                  seatQuota.assignedSeats === 1 ? '' : 's'
                } assigned to this site · `}
                <AppLink
                  href={`${buildRoute(Route.MANAGE_BILLING, { orgSlug })}#collaborator-seats`}
                >
                  {'Move seats'}
                </AppLink>
              </Typography>
            ) : null}
            {/*
              THE GRANDFATHER, said out loud (AGL-2439). A site above its cap
              keeps everyone on it — nothing removes a collaborator for being
              over a cap — and is only refused the next add. Without this line
              an admin reads the refusal as "somebody was removed", which is
              the one wrong conclusion available.
            */}
            {seatQuota.retainedOverCap > 0 ? (
              <Typography variant="caption" color="text.secondary" component="div">
                {`${seatQuota.retainedOverCap} over the limit — everyone keeps their access, but this site can’t take on another collaborator until it’s back under.`}
              </Typography>
            ) : null}
            <Typography variant="caption" color="text.secondary" component="div">
              {seatQuota.upgradeRequired ? (
                'Upgrade your plan for more collaborators per site.'
              ) : seatQuota.addonPriceUsd != null ? (
                <>
                  {`Extra seats $${seatQuota.addonPriceUsd}/mo each, assigned per site, in `}
                  <AppLink
                    href={`${buildRoute(Route.MANAGE_BILLING, { orgSlug })}#collaborator-seats`}
                  >
                    {'Billing'}
                  </AppLink>
                </>
              ) : null}
            </Typography>
          </>
        ) : null}
        <ListFilterChips
          fields={HOST_MEMBER_FILTER_FIELDS}
          headers={HOST_MEMBER_FILTER_HEADERS}
          clauses={gridFilter.clauses}
          onChange={gridFilter.setClauses}
          options={ROLE_FILTER_OPTIONS}
        />
        <ListQueryNotices
          refused={listQueryRefusalNotices(
            plan.refused,
            HOST_MEMBER_FILTER_HEADERS,
            ROLE_FILTER_OPTIONS,
          )}
          notices={plan.notices}
        />
        <ListTable
          aria-label="Site collaborators"
          rows={rows}
          columns={columns}
          // A row holds a role picker, so it is as tall as what it holds.
          rowHeight={TABLE_ROW_HEIGHT}
          // The roster's own order (by address); the grid's sort would be a
          // second order over one page of it.
          disableColumnSorting
          // The query answers the panel and the search; see its comment.
          filterMode="server"
          filterModel={gridFilter.filterModel}
          onFilterModelChange={gridFilter.onFilterModelChange}
          // The search box is served: its words become the address prefix
          // the plan puts on the query (`hostMemberListRequest`).
          quickFilter
          noRowsLabel="No collaborators match these filters"
          // Paged by the footer below, so the grid must not also slice.
          hideFooter
        />
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={members.length}
          hasMore={hasMore}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
          /*
           * The owner's row is pinned above every page and read from the
           * org, not from the roster the pager walks, so the pager's own
           * figures leave it out: three rows on screen read "1–2 of 2". The
           * owner is counted once, as the list's first row (AGL-3321).
           */
          {...(ownerShown
            ? {
                labelDisplayedRows: ({ from, to, count }: { from: number; to: number; count: number }) =>
                  `${page === 0 ? 1 : from + 1}–${to + 1} of ${
                    count === -1 ? `more than ${to + 1}` : count + 1
                  }`,
              }
            : {})}
        />
        <Typography variant="caption" color="text.secondary">
          {'Admins get full console access to this site. An Author can edit ' +
            'every kind of content and cannot publish any of it — no route, ' +
            'no live version, no schedule, no published entry. Remaining ' +
            'per-role restrictions for editors and viewers roll out with ' +
            'granular permissions.'}
        </Typography>
        <PluginWidgetSlot slot="hostMembers" hostId={hostId} canManage={canManage} />
      </Stack>
    </CardDisplay>
  )
}
HostMembersCard.displayName = 'HostMembersCard'

export default HostMembersCard
