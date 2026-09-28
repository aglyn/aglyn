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

import { pluginDocsHelp, type ConsolePluginOrgMount } from '@aglyn/aglyn'
// A deep import, NOT the plugin barrel (AGL-1151): the barrel is the entry
// point the tenant's loader dynamically imports to activate the marketing
// plugin's SITE half, so a console card named there ships to every published
// page. The component path reaches the same module without crossing it.
import { InboxRecordAttributionZone } from './inbox-attribution-zone'
// The CRM's route builder by its leaf path, not the plugin barrel: the barrel
// carries the plugin registration, and a link needs only the address grammar.
import { pluginRecordHref } from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { scopeTokensForHost } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  mdiAccountArrowRight,
  mdiAccountRemoveOutline,
  mdiBullhornOutline,
} from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import {
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  useFirestore,
  useOrgDataScope,
  useScopeTokens,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import { collection } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  LEAD_FILTER_HEADERS,
  LEAD_LIST_QUERY,
  LEAD_SOURCE_OPTIONS,
  ORG_LEAD_LIST_QUERY,
  SITE_MEMBER_FILTER_HEADERS,
  SITE_MEMBER_LIST_QUERY,
  leadListBase,
  LEAD_ADDRESS_SEARCH_COLUMN,
  LEAD_ADDRESS_SEARCH_NOTICE,
  leadListQueryFor,
  leadSourceLabel,
} from '../constants/list-queries'
import { orgSiteNames } from './inbox-org-sites'
import { useRecordRouteContext } from './use-record-route-context'

/** Which of the two collections the card lists. */
export type ContactsView = 'members' | 'leads'

/** The organization's Inbox's Source and Site are picked, so the panel shows selects. */
const ORG_LEAD_SELECT_FIELDS = ['sources', 'capturedByHostIds']
const NO_SELECT_FIELDS: readonly string[] = []

/**
 * Every surface a lead was captured by: `sources`, which every capture
 * `arrayUnion`s, or the single `source` a lead written before it carries.
 */
const leadSources = (lead: any): string[] =>
  Array.isArray(lead?.sources)
    ? lead.sources.filter((source: unknown): source is string => typeof source === 'string')
    : typeof lead?.source === 'string' && lead.source
      ? [lead.source]
      : []

/**
 * The Members & leads section of the Inbox (AGL-109): the people a site
 * collected — its members, who signed up to it, and its leads, whom a form,
 * a booking or a teammate captured.
 *
 * ## Two lists, one table (AGL-3321)
 *
 * Members and leads are two collections, and the table shows one at a time,
 * chosen by the toggle above it. Each is its own Firestore query, every
 * filter and search word on it, paged by the server — so a page is a page of
 * the answer, and a site with thousands of either reaches all of them.
 *
 * It used to read the two hundred newest of each and interleave them, hiding
 * a lead whose address matched a member. That dedupe is only correct while
 * both reads are whole, which is exactly what a paged query is not, so it is
 * gone: a person who left their address and later signed up is a lead in one
 * list and a member in the other, which is what they are in each collection.
 *
 * On the organization's Inbox (`hostId: null`, AGL-3303) it lists the
 * organization's leads with the sites each was captured by. A member signs up
 * to ONE site and lives under it, so Members waits for a site to be picked,
 * which is the page handing this card that site.
 */
export function ContactsCard({
  hostId,
  orgMount,
}: {
  hostId: string | null
  /** The organization and its sites — present exactly when `hostId` is `null`. */
  orgMount?: ConsolePluginOrgMount
}) {
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  // Where a lead is WORKED (AGL-2608). This card lists leads; the CRM's
  // Leads section gives each one a status, an owner and a conversion.
  const routeContext = useRecordRouteContext()
  const leadHref = (contact: { $id?: unknown }): string | null =>
    routeContext
      ? pluginRecordHref('lead', routeContext, String(contact.$id))
      : null

  /*
   * The list shown. Members exist only under a site, so the organization's
   * Inbox shows leads whatever was chosen, and the toggle says why.
   */
  const [chosen, setChosen] = useState<ContactsView>('members')
  const view: ContactsView = hostId ? chosen : 'leads'
  const [searchWords, setSearchWords] = useState<string[]>([])
  const gridFilter = useListGridFilter({
    selectFields: view === 'leads' && hostId == null ? ORG_LEAD_SELECT_FIELDS : NO_SELECT_FIELDS,
    search: { words: searchWords, onChange: setSearchWords },
  })
  /*
   * A switch of list starts it clean: the two lists filter by different
   * fields, and a clause carried across would be one the other list cannot
   * ask — refused on arrival, for a question the reader asked of the list
   * they just left.
   */
  const switchView = (next: ContactsView | null) => {
    if (!next || next === view) return
    gridFilter.setClauses([])
    setSearchWords([])
    setChosen(next)
  }
  const request = { clauses: gridFilter.clauses, search: gridFilter.searchWords }

  /*==========================================
   * SITE MEMBERS — `hosts/{hostId}/siteMembers`, newest first
   * (`SITE_MEMBER_LIST_QUERY`). `createdAt` is safe to order on:
   * `membership-register.ts` is the only writer that CREATES a site member
   * and stamps it inside its transaction, and the collection is not in
   * `IMPORTABLE_FIELDS`. No query opens while the other list is shown.
   *=========================================*/
  const members = useListQuery<any>({
    collection:
      hostId && view === 'members'
        ? collection(firestore, 'hosts', hostId, 'siteMembers')
        : null,
    declaration: SITE_MEMBER_LIST_QUERY,
    request: view === 'members' ? request : { clauses: [] },
    deps: [firestore, hostId, view],
    idField: '$id',
  })

  /*==========================================
   * LEADS — `orgs/{orgId}/leads`, newest first (`LEAD_LIST_QUERY`). The
   * silo is the org's (AGL-3275), narrowed to this site by `visibleTo`;
   * reading `hosts/{hostId}/leads` showed a site its pre-migration rows and
   * nothing captured since. `addHostLead`, every lead door's one writer,
   * stamps `createdAt` on every create.
   *
   * Every site's, on the organization's Inbox: an org-wide member reads the
   * collection unscoped — the rules short-circuit on their reach, as for the
   * CRM's own org list — so a clause there would only narrow what they may
   * already read.
   *=========================================*/
  const { orgId } = useOrgDataScope({
    hostId: hostId ?? undefined,
    orgId: hostId == null ? orgMount?.orgId : undefined,
  })
  /*
   * Whether the search may fold into the scope clause (`scopedSearch`): a
   * query without `visibleTo` is one the rules prove only for an ORG-WIDE
   * member. Anyone else keeps the clause, and the plan refuses their search
   * by name rather than sending a query the rules deny. Until the reach has
   * answered, the answer is no. Asked only while Leads is shown: the member
   * document is a read, and Members has no scope to fold into.
   */
  const reach = useScopeTokens(hostId && orgId && view === 'leads' ? orgId : undefined)
  const foldsScope = hostId == null || (reach.loaded && reach.orgWide)
  const leadDeclaration = hostId ? LEAD_LIST_QUERY : ORG_LEAD_LIST_QUERY
  const leadBase = useMemo(
    () => leadListBase(hostId ? scopeTokensForHost(hostId) : null),
    [hostId],
  )
  const leadQuery = useMemo(
    () =>
      leadListQueryFor(
        leadDeclaration,
        foldsScope,
        view === 'leads' ? { ...request, base: leadBase } : { clauses: [] },
      ),
    // The request is data; its JSON is its identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [leadDeclaration, foldsScope, view, leadBase, JSON.stringify(request)],
  )
  const leads = useListQuery<any>({
    collection:
      orgId && view === 'leads' ? collection(firestore, 'orgs', orgId, 'leads') : null,
    declaration: leadQuery.declaration,
    request: leadQuery.request,
    deps: [firestore, orgId, hostId, view],
    idField: '$id',
  })

  const shown = view === 'members' ? members : leads
  const declaration = view === 'members' ? SITE_MEMBER_LIST_QUERY : leadDeclaration
  const headers = view === 'members' ? SITE_MEMBER_FILTER_HEADERS : LEAD_FILTER_HEADERS
  const options = useMemo<Readonly<Record<string, readonly ListFilterOption[]>>>(
    () =>
      view === 'leads' && hostId == null
        ? {
            sources: LEAD_SOURCE_OPTIONS,
            capturedByHostIds: (orgMount?.hosts ?? []).map((host) => ({
              value: host.id,
              label: host.name || host.id,
            })),
          }
        : {},
    [view, hostId, orgMount],
  )
  /*
   * A site collaborator's search rides the query as an address-prefix clause
   * (`leadListQueryFor`); a refusal of it is the search's, and when it is
   * served the list says what it matched and how it is now ordered.
   */
  const refusals = useMemo(
    () =>
      listQueryRefusals(
        shown.plan.refused.map((entry) =>
          entry.clause !== 'search' && entry.clause.field === LEAD_ADDRESS_SEARCH_COLUMN
            ? { ...entry, clause: 'search' as const }
            : entry,
        ),
        { fields: declaration.fields, headers, options },
      ),
    [shown.plan.refused, declaration, headers, options],
  )
  const addressSearched =
    view === 'leads' &&
    leadQuery.addressSearch &&
    leads.plan.served.some((clause) => clause.field === LEAD_ADDRESS_SEARCH_COLUMN)
  const notices = useMemo(
    () => (addressSearched ? [...shown.plan.notices, LEAD_ADDRESS_SEARCH_NOTICE] : shown.plan.notices),
    [addressSearched, shown.plan.notices],
  )
  const filtering =
    gridFilter.clauses.length > 0 || gridFilter.searchWords.some((word) => word.trim())

  /*
   * REMOVED BY THE ROUTE THAT OWNS MEMBER ACCOUNTS (AGL-3308), not by a
   * client delete. A member's password hash lives in a document no client can
   * reach, so deleting the profile from here would leave it behind: the route
   * deletes both, and the rules refuse a client delete of any member that
   * has one.
   */
  const handleDeleteMember = useCallback(
    (member: any) => async () => {
      // Members are listed only under a site, so there is one to delete from.
      if (!hostId) return
      const confirmed = await confirm({
        title: 'Remove this member?',
        description: `"${member.email}" can no longer sign in to your site.`,
        confirmationText: 'Remove',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!confirmed) return
      try {
        const response = await authorizedFetch(user, '/api/membership/admin-remove', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ hostId, memberId: member.$id }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'The member was not removed', {
            variant: 'warning',
            allowDuplicate: true,
          })
        }
        enqueueSnackbar('Member removed', { variant: 'success', persist: false })
      } catch {
        enqueueSnackbar('The member was not removed', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
    },
    [confirm, user, hostId, enqueueSnackbar],
  )

  /*
   * WHERE A LEAD CAME FROM, on request.
   *
   * A lead is a table row with no page of its own, and the attribution is one
   * keyed document read — cheap on its own, and the page size times cheap in
   * a column. So it is an overflow action that opens a dialog: the reader who
   * wants the answer pays for it, and the reader who came to scan the list
   * does not.
   */
  const [leadOrigin, setLeadOrigin] = useState<any | null>(null)
  /*
   * The site a lead's attribution is asked of. Under a site it is that site;
   * across every site a lead is one org row that several sites may have met,
   * and the credit is filed by the site whose capture made it — the first in
   * `capturedByHostIds`, the site the CRM's own lead page asks as well.
   */
  const originSite = (contact: any): string | null => {
    if (hostId) return hostId
    const first = Array.isArray(contact?.capturedByHostIds)
      ? contact.capturedByHostIds[0]
      : null
    return typeof first === 'string' && first ? first : null
  }
  const leadOriginSite = leadOrigin ? originSite(leadOrigin) : null

  const memberActions = (member: any): RowActionsMenuItem[] => [
    {
      key: 'remove',
      label: 'Remove member',
      icon: <MdiIcon path={mdiAccountRemoveOutline.path} size={0.8} />,
      destructive: true,
      onClick: () => void handleDeleteMember(member)(),
    },
  ]
  const leadActions = (lead: any): RowActionsMenuItem[] => [
    // Offered only where a plugin publishes a lead's address: text-less
    // rather than a link to a page this workspace cannot open.
    ...(leadHref(lead)
      ? [
          {
            key: 'crm',
            label: 'Open in CRM',
            icon: <MdiIcon path={mdiAccountArrowRight.path} size={0.8} />,
            href: leadHref(lead) as string,
          },
        ]
      : []),
    // A lead no site captured has no site to ask for its campaign.
    ...(originSite(lead)
      ? [
          {
            key: 'origin',
            label: 'Where this came from',
            icon: <MdiIcon path={mdiBullhornOutline.path} size={0.8} />,
            onClick: () => setLeadOrigin(lead),
          },
        ]
      : []),
  ]

  const columns: GridColDef[] = [
    {
      field: 'email',
      headerName: 'Email',
      flex: 1,
      minWidth: 240,
      /*
        The name beside the address — a member's `displayName`, and the name
        the lead writer stores (AGL-2303) — because a list of bare addresses is
        a list nobody recognizes anyone in.
       */
      renderCell: ({ row: contact }) => {
        const name = view === 'members' ? contact.displayName : contact.name
        return (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'baseline', minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {contact.email}
            </Typography>
            {name ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                {name}
              </Typography>
            ) : null}
          </Stack>
        )
      },
    },
    /*
      WHERE A LEAD CAME FROM (AGL-2338): every surface that captured the
      person — a form, a booking, a lead added by hand — one chip each. A lead
      written before `sources` carries the one `source` it was captured by,
      and a row with neither simply shows none.
     */
    ...(view === 'leads'
      ? [
          {
            field: 'sources',
            headerName: 'Source',
            width: 200,
            sortable: false,
            valueGetter: (_value: unknown, lead: any) =>
              leadSources(lead).map(leadSourceLabel).join(', '),
            renderCell: ({ row: lead }: { row: any }) => (
              <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', height: '100%' }}>
                {[...new Set(leadSources(lead).map(leadSourceLabel))].map((label) => (
                  <Chip key={label} label={label} size="small" variant="outlined" />
                ))}
              </Stack>
            ),
          } satisfies GridColDef,
        ]
      : []),
    /*
      KNOWN BY, on the organization's Inbox: every site that captured the
      person, as the CRM's organization Leads list names them. A lead is one
      org row, so "which site" is a set, never one answer.
     */
    ...(view === 'leads' && hostId == null
      ? [
          {
            field: 'capturedByHostIds',
            headerName: 'Site',
            flex: 1,
            minWidth: 160,
            sortable: false,
            renderCell: ({ row: contact }: { row: any }) =>
              orgSiteNames(orgMount, contact.capturedByHostIds),
          } satisfies GridColDef,
        ]
      : []),
    {
      field: 'createdAt',
      headerName: view === 'members' ? 'Joined' : 'Captured',
      width: 200,
      renderCell: ({ row: contact }) =>
        contact.createdAt?.toDate?.().toLocaleString() ?? '--',
    },
    listActionsColumn(
      (contact) => (
        <ListRowActions
          label={String(contact.email ?? contact.$id)}
          items={view === 'members' ? memberActions(contact) : leadActions(contact)}
        />
      ),
      { width: 72 },
    ),
  ]

  const empty = shown.rows.length === 0 && !shown.hasMore && !filtering
  const emptyLabel =
    view === 'members'
      ? 'No members yet — visitors can join at /signup on your site.'
      : hostId == null
        ? 'No leads on any site yet.'
        : 'No leads yet — the forms and bookings that file leads add them here.'

  return (
    <>
      <CardDisplay
        header={hostId == null ? 'Leads' : 'Site Members & Leads'}
        help={pluginDocsHelp('forms', {
          anchor: '#filter-the-inbox',
        })}
        contentGutterX
        contentGutterY
        contentBordered="all"
      >
        <Stack spacing={1.5}>
          <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
            <ToggleButtonGroup
              exclusive
              size="small"
              value={view}
              onChange={(_event, next: ContactsView | null) => switchView(next)}
              aria-label="Which people to list"
            >
              {/*
                Disabled on the organization's Inbox rather than hidden: a
                member signs up to one site, and the line beside the toggle
                says how to reach a site's members, where a missing button
                would say nothing.
               */}
              <ToggleButton value="members" disabled={hostId == null}>
                {'Members'}
              </ToggleButton>
              <ToggleButton value="leads">{'Leads'}</ToggleButton>
            </ToggleButtonGroup>
            {hostId == null ? (
              <Typography variant="body2" color="text.secondary">
                {'Every site’s leads, newest first. Members sign up to one ' +
                  'site each — choose a site to list its members.'}
              </Typography>
            ) : null}
          </Stack>
          {empty ? (
            <Typography variant="body2" color="text.secondary">
              {emptyLabel}
            </Typography>
          ) : (
            <>
              <ListFilterChips
                fields={declaration.fields}
                headers={headers}
                clauses={gridFilter.clauses}
                onChange={gridFilter.setClauses}
                options={options}
              />
              <ListQueryNotices refused={refusals} notices={notices} />
              <ListTable
                // One grid per list, so the other list's search box and
                // panel state never carry across the toggle.
                key={view}
                aria-label={view === 'members' ? 'Site members' : 'Leads'}
                rows={shown.rows}
                columns={listFilterGridColumns(columns, declaration.fields, options, headers)}
                rowHeight={TABLE_ROW_HEIGHT}
                // Paged by the footer below, so the grid must not also slice.
                hideFooter
                // The panel and the search go to the query; the grid neither
                // filters nor sorts the page it holds.
                filterMode="server"
                filterModel={gridFilter.filterModel}
                onFilterModelChange={gridFilter.onFilterModelChange}
                quickFilter
                disableColumnSorting
                noRowsLabel={
                  view === 'members'
                    ? 'No members match these filters'
                    : 'No leads match these filters'
                }
              />
              <ListPagination
                page={shown.page}
                pageSize={shown.pageSize}
                rowCount={shown.rows.length}
                hasMore={shown.hasMore}
                onPageChange={shown.setPage}
                onPageSizeChange={shown.setPageSize}
              />
            </>
          )}
        </Stack>
      </CardDisplay>
      {/*
        WHERE A LEAD CAME FROM.

        Its own dialog rather than a column, for the reason the state above
        gives: one keyed read, paid by the reader who asked the question. A
        lead has no page of its own to put this on, and giving it one to carry
        a single line would be a new record surface rather than attribution.
       */}
      <Dialog
        open={Boolean(leadOrigin)}
        onClose={() => setLeadOrigin(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{leadOrigin?.email ?? 'Lead'}</DialogTitle>
        <DialogContent>
          {leadOrigin?.$id && leadOriginSite ? (
            <InboxRecordAttributionZone
              hostId={leadOriginSite}
              recordKind="lead"
              recordId={String(leadOrigin.$id)}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button variant="contained" onClick={() => setLeadOrigin(null)}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}
ContactsCard.displayName = 'ContactsCard'

export default ContactsCard
