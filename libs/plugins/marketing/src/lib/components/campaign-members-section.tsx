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
  pluginRecordHref,
  pluginRecordListHref,
} from '@aglyn/aglyn/plugin-manager/plugin-record-routes'
import { AppLink } from '@aglyn/shared-ui-jsx'
import {
  Figure,
  Section,
} from '@aglyn/shared-ui-jsx/components/measured-figures.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  buildRoute,
  readContainerIds,
  Route,
  type FormStats,
  type FormStatsTotals,
} from '@aglyn/aglyn'
import { Alert, Stack, Typography } from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  documentId,
  limit,
  orderBy,
  query,
  where,
} from 'firebase/firestore'
import { useCallback, useMemo } from 'react'
import {
  useConsoleHostRoute,
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import {
  campaignFormsRollup,
  campaignFormTotals,
  campaignPeriodRange,
  isWindowedRange,
  type CampaignFormsRollup,
} from '../model/campaign-membership-figures'
import { CAMPAIGN_KIND, CAMPAIGN_MEMBERSHIP_FIELD } from '../model/campaign-kind'
import {
  CAMPAIGN_MEMBERS_QUERY,
  CAMPAIGN_MEMBERS_SEARCH_NOTICE,
  campaignMembersBase,
  campaignMembersSearchClause,
  type CampaignMemberCollection,
} from '../model/campaign-members-query'

/**
 * How many forms the holdings figures add up.
 *
 * The tables page through every member; the figures are a sum, read from a
 * window of their own. One document past it is asked for, so "the figures
 * cover some of the forms" is a fact rather than a guess — the same probe
 * the emails figures on this page make.
 */
const FIGURES_CEILING = 25

export interface CampaignMembersSectionProps {
  hostId: string
  /**
   * The site's name, when the section is one of several — the org hub draws
   * one per site the campaign is placed on, and each heading says whose
   * forms and screens it lists.
   */
  siteName?: string
  campaignId: string
  /** The campaign's first day, when it has one. */
  startAtMs?: number | null
  /** The campaign's last day, when it has one. */
  endAtMs?: number | null
}

/** One row, whatever collection it came out of. */
interface MemberRow {
  id: string
  name: string
  href: string | null
  /** Why there is no link, when there is none. */
  hrefReason?: string
  /** The member's own counters, for a kind that carries them. */
  totals?: FormStatsTotals
  /** Campaigns the member is filed under, this one included. */
  campaigns?: number
}

/**
 * WHAT ELSE IS IN THIS CAMPAIGN — the landing pages and forms assigned to it,
 * and what those forms have collected.
 *
 * ## Declared, and therefore different from every section above it
 *
 * The conversions, revenue and destinations sections are EVIDENCE: they join
 * on the campaign's send ids and report what visitors did BECAUSE of this
 * campaign's mail. This one is a statement the merchant made — a screen or a
 * form carries this campaign's id in {@link CAMPAIGN_MEMBERSHIP_FIELD} — plus
 * the counters those records carry on their own documents.
 *
 * The distinction survives into the wording, because the arithmetic will not
 * enforce it. A form's submissions are the form's; filing the form under a
 * campaign does not make them the campaign's, and a heading that said
 * "this campaign produced 40 leads" over a number meaning "the forms filed
 * here have 40 leads" would be a worse page than one showing nothing. So the
 * figures are labeled as what the forms HOLD, they sit in their own block
 * under their own disclaimer, and no total on this page adds them to an
 * attributed one.
 *
 * ## Three ways the forms' counters could mislead, each answered
 *
 *  1. **They are lifetime.** `stats.submissions` has counted since the form
 *     existed, including every submission from before anybody filed it here.
 *     Where the campaign carries dates, the figures are summed from the
 *     monthly `stats.periods` series over those months instead, and the
 *     caption says which of the two a reader is looking at. Months are whole,
 *     so a campaign starting mid-month includes that month entire — stated,
 *     not rounded away.
 *  2. **A form can be in twenty campaigns.** `campaignIds` is an array, so
 *     the same submissions count toward every campaign the form is filed
 *     under. Rows say so and the total refuses to present itself as
 *     exclusive.
 *  3. **A counter nobody wrote is not a zero.** `stats.leads` is counted
 *     only for a form whose `routing.lead` is set, and `stats.views` only by
 *     the analytics beacon. Both reach the shared `Figure`, which draws an em
 *     dash and the words "not recorded" rather than a confident 0.
 *
 * ## Screens carry no counter, and this section will not invent one
 *
 * A form's counters ride on the form document, so the query this section
 * already makes pays for them. A screen's traffic does not: it is one
 * document per screen per day in `hosts/{hostId}/screenAnalytics`, with no
 * lifetime total anywhere, so a views column here would cost a range read
 * across screens times days on every open of this page — and the display of
 * those figures is a paid entitlement this section does not resolve. The
 * screens block names the absence and links to the surface that does measure
 * it, which is a smaller lie than a number nobody can stand behind.
 *
 * ## The join is `array-contains`, on the member's own document
 *
 * A campaign holds no member list. Each record names the campaigns it is in,
 * which is what makes deleting one record leave nothing behind and what lets
 * a record's own page draw its campaigns without a query. The query here is
 * the other direction of the same field.
 *
 * ## Each kind is a table paged by its own query (AGL-3321)
 *
 * The screens and the forms are each a list a reader pages and searches, so
 * the membership, the soft delete and the search word are all on the
 * table's Firestore query (`campaign-members-query.ts`), and every member is
 * reachable a page at a time. Nothing is matched over rows already read: a
 * deleted screen is left out by `deletedAt == null`, which every screen
 * stores, and the search is a prefix range on the stored `nameLower`.
 *
 * Unsearched, a table walks the document name, which every record has — a
 * form carries `updatedAt` only if some writer stamped one, and ordering on a
 * field a writer may omit does not mis-sort the list, it drops rows from it.
 *
 * The forms' HOLDINGS are a sum, not a list, so they read a window of their
 * own — the first {@link FIGURES_CEILING} forms by document name — and say
 * when the campaign holds more, as the mail figures on this page do.
 *
 * ## Contacts are named here and NOT listed, and the reason is a query limit
 *
 * A contact is org-scoped and shared between the sites that captured it, so
 * every client read of the collection has to carry
 * `visibleTo array-contains-any` — that is what makes the read provable
 * per-document under the rules. Firestore permits ONE array clause per query,
 * and that is it: there is no client query that filters contacts by campaign
 * as well, so there is no pre-filtered address to link to either. The link
 * offered goes to the Contacts page and says it arrives unfiltered; the
 * assignment is real, is set from the contact's own drawer, and a count of it
 * would cost a scan of the collection the customer is billed on.
 */
export function CampaignMembersSection(props: CampaignMembersSectionProps) {
  const { hostId, siteName, campaignId, startAtMs, endAtMs } = props
  const firestore = useFirestore()
  const { orgSlug, subdomain: host } = useConsoleHostRoute(hostId)

  /*
   * The window the holdings figures add up: the forms filed here, by
   * document name, one past the ceiling as the probe. A form has no soft
   * delete — it is deleted outright — so every document this returns is a
   * form in use or a retired one, and both hold what they collected.
   */
  const { data: figureDocs } = useFirestoreCollection<Record<string, unknown>>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'forms'),
        where(CAMPAIGN_MEMBERSHIP_FIELD, 'array-contains', campaignId),
        orderBy(documentId()),
        limit(FIGURES_CEILING + 1),
      ),
    [firestore, hostId, campaignId],
    { idField: '$id' },
  )

  /*
   * The months the campaign's dates cover, or nothing where it has neither.
   * Derived from props the detail card already holds, so asking what a
   * figure covers costs no read.
   */
  const range = useMemo(
    () => campaignPeriodRange({ startAtMs, endAtMs }),
    [startAtMs, endAtMs],
  )
  const windowed = isWindowedRange(range)

  const screenRow = useCallback(
    (row: Record<string, unknown>): MemberRow => {
      const id = String(row['$id'])
      const versionId = String(row['versionId'] ?? '')
      return {
        id,
        name: String(row['displayName'] ?? id),
        /*
         * A screen with no saved version has no detail address to build —
         * the route carries a version — so it stays plain text rather than
         * linking somewhere that 404s. The screens list applies the same
         * guard to its own name column.
         */
        href:
          versionId && orgSlug && host
            ? buildRoute(Route.SCREEN_DETAILS, {
                orgSlug,
                host,
                screenId: id,
                versionId,
              })
            : null,
        hrefReason: versionId
          ? 'This site’s console URL has not resolved yet'
          : 'This page has no saved version yet',
        campaigns: readContainerIds(row, CAMPAIGN_KIND).length,
      }
    },
    [orgSlug, host],
  )

  /*
   * The counters ride on the form documents, so each row's figures are paid
   * for by the read that lists it.
   */
  const formRow = useCallback(
    (row: Record<string, unknown>): MemberRow => {
      const id = String(row['$id'])
      return {
        id,
        name: String(row['displayName'] ?? id),
        href: orgSlug && host ? pluginRecordHref('form', { orgSlug, host }, id) : null,
        hrefReason: 'This site’s console URL has not resolved yet',
        totals: campaignFormTotals(row['stats'] as FormStats | undefined, range),
        campaigns: readContainerIds(row, CAMPAIGN_KIND).length,
      }
    },
    [orgSlug, host, range],
  )

  const figureForms = useMemo(
    () => (figureDocs ?? []).slice(0, FIGURES_CEILING).map(formRow),
    [figureDocs, formRow],
  )
  const figuresTruncated = (figureDocs ?? []).length > FIGURES_CEILING
  const rollup = useMemo(
    () =>
      campaignFormsRollup(
        figureForms.map((row) => ({
          totals: row.totals as FormStatsTotals,
          campaigns: row.campaigns ?? 1,
        })),
      ),
    [figureForms],
  )

  const analyticsHref =
    orgSlug && host
      ? buildRoute(Route.HOST_ANALYTICS, { orgSlug, host })
      : null
  const contactsHref =
    orgSlug && host ? pluginRecordListHref('contact', { orgSlug, host }) : null

  return (
    <Section
      title={
        siteName
          ? `Assigned to this campaign on ${siteName}`
          : 'Assigned to this campaign'
      }
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'The pages and forms somebody put in this campaign. Assignment is ' +
            'a grouping — what the campaign was credited with is measured ' +
            'above, from the links its emails carried.'}
        </Typography>
        <MemberTable
          heading="Pages"
          noun="page"
          collectionName="screens"
          hostId={hostId}
          campaignId={campaignId}
          toRow={screenRow}
        />
        {/*
          The absence, named where a reader would look for the number.

          A screen's traffic is not on the screen document — it is a day doc
          per screen in `screenAnalytics` — so a views column here would be a
          read across screens times days on every open, for figures whose
          display is a paid entitlement this section does not resolve. The
          page that does both is linked instead.
         */}
        <Typography variant="caption" color="text.secondary">
          {'Page views are not shown here. A page keeps no running total ' +
            'on its own record — traffic is stored a day at a time — so ' +
            'counting it would be a fresh read of the site’s history every ' +
            'time this view opens. '}
          {analyticsHref ? (
            <AppLink href={analyticsHref}>
              {'The site’s analytics measures it by page.'}
            </AppLink>
          ) : (
            'The site’s analytics view measures it by page.'
          )}
        </Typography>
        <MemberTable
          heading="Forms"
          noun="form"
          collectionName="forms"
          hostId={hostId}
          campaignId={campaignId}
          toRow={formRow}
          figures
        />
        {/*
          THE MEMBERSHIP TOTAL, fenced off from the attributed ones above.

          Same `Figure` primitive as the mail rollup, deliberately different
          words: it says what the forms HOLD, and the caption beneath refuses
          the reading a merchant will reach for first.
         */}
        {figureForms.length ? (
          <FormsHoldings
            rollup={rollup}
            windowed={windowed}
            from={range.from ?? null}
            to={range.to ?? null}
            truncated={figuresTruncated}
          />
        ) : null}
        {/*
          The people, named rather than omitted.

          A contact CAN be filed under a campaign and this page cannot list
          them — see the module comment for the query rule that decides it.
          Leaving the heading out entirely would read as "contacts cannot be
          assigned", which is the one thing it does not mean.
         */}
        <Stack spacing={0.5}>
          <Typography variant="overline" color="text.secondary">
            {'Contacts'}
          </Typography>
          <Typography variant="body2" color="text.secondary">
            {'Contacts are filed under a campaign from the contact’s own ' +
              'panel on the Contacts page. They are not listed or counted ' +
              'here: a contact belongs to the organization rather than to ' +
              'this site, so the query that reads them is already spending ' +
              'its one array filter on which sites may see the person. '}
            {contactsHref ? (
              <AppLink href={contactsHref}>{'Open Contacts'}</AppLink>
            ) : null}
            {contactsHref
              ? ' — it opens unfiltered, because that same rule leaves no ' +
                'campaign filter for the address to carry.'
              : ''}
          </Typography>
        </Stack>
      </Stack>
    </Section>
  )
}

/**
 * What the campaign's forms have collected — and what that is NOT.
 *
 * Two sentences do the whole job of keeping this apart from the attributed
 * figures, and both are load-bearing:
 *
 *  - The first refuses causation outright. A merchant reading a number under
 *    a campaign's heading will assume the campaign caused it unless told
 *    otherwise in the same breath.
 *  - The second says which months the number covers. A lifetime total under a
 *    campaign that ran for six weeks is the same lie one step quieter.
 *
 * `shared` is stated as a count rather than folded into the arithmetic. There
 * is no honest way to divide a submission between two campaigns a form is
 * filed under, so the total is left whole and the overlap is disclosed.
 */
function FormsHoldings(props: {
  rollup: CampaignFormsRollup
  windowed: boolean
  from: string | null
  to: string | null
  /** The campaign holds more forms than the figures add up. */
  truncated: boolean
}) {
  const { rollup, windowed, from, to, truncated } = props
  const note = (recorded: number) =>
    recorded < rollup.members
      ? `across ${recorded} of ${rollup.members} forms`
      : `across ${rollup.members} form${rollup.members === 1 ? '' : 's'}`
  const span = windowed
    ? `the campaign’s months (${from ?? 'the first month recorded'} to ${
        to ?? 'now'
      })`
    : 'each form’s whole history'
  return (
    <Stack spacing={1}>
      <Typography variant="overline" color="text.secondary">
        {'What these forms hold'}
      </Typography>
      <Stack useFlexGap direction="row" spacing={3} sx={{ flexWrap: 'wrap' }}>
        <Figure
          label="Views"
          value={rollup.views.value}
          note={note(rollup.views.recorded)}
        />
        <Figure
          label="Started"
          value={rollup.starts.value}
          note={note(rollup.starts.recorded)}
        />
        <Figure
          label="Submissions"
          value={rollup.submissions.value}
          note={note(rollup.submissions.recorded)}
        />
        <Figure
          label="Leads"
          value={rollup.leads.value}
          note={note(rollup.leads.recorded)}
        />
      </Stack>
      <Typography variant="caption" color="text.secondary">
        {'These are the forms’ own counters, not this campaign’s results. ' +
          'A submission is counted here because somebody filed the form ' +
          'under this campaign, whether or not this campaign’s mail sent ' +
          `the visitor. Counted over ${span}.`}
      </Typography>
      {windowed ? (
        <Typography variant="caption" color="text.secondary">
          {'Whole calendar months: a campaign that started or ended mid-' +
            'month takes that month entire, and a form counting nothing in ' +
            'those months adds nothing here even where its lifetime total ' +
            'is large.'}
        </Typography>
      ) : (
        <Typography variant="caption" color="text.secondary">
          {'This campaign has no dates, so nothing narrows the figures to ' +
            'it. They are lifetime totals and include everything from ' +
            'before the forms were put in this campaign. Give the campaign ' +
            'a start and an end to count only its months.'}
        </Typography>
      )}
      {truncated ? (
        <Alert severity="info">
          {`These figures add up the first ${FIGURES_CEILING} forms in this ` +
            'campaign, in document order. It holds more; the table above ' +
            'lists every one of them.'}
        </Alert>
      ) : null}
      {rollup.shared ? (
        <Typography variant="caption" color="text.secondary">
          {`${rollup.shared} of these ${rollup.members} forms ${
            rollup.shared === 1 ? 'is' : 'are'
          } filed under another campaign too, so the same submissions are ` +
            'counted there as well. This total is not exclusive to this ' +
            'campaign.'}
        </Typography>
      ) : null}
    </Stack>
  )
}
FormsHoldings.displayName = 'FormsHoldings'

/** A counter as a cell: an em dash where nothing was recorded, never a zero. */
function statCell(value: number | null | undefined) {
  return value === null || value === undefined ? '—' : value.toLocaleString()
}

/** The counters a form carries on its own document, in the order they are read. */
const MEMBER_FIGURES = [
  ['views', 'Views'],
  ['starts', 'Started'],
  ['submissions', 'Submissions'],
  ['leads', 'Leads'],
] as const

/** How the search reads on a notice: the box, not a column. */
const MEMBER_SEARCH_HEADERS: Readonly<Record<string, string>> = {
  name: 'Search',
}

/**
 * One kind's members, as a record list in the shared grid, paged by its own
 * query (AGL-3321).
 *
 * The membership, the soft delete and the search word are predicates on the
 * query (`campaign-members-query.ts`); the grid neither filters nor sorts
 * the page it is handed. The search box is the grid's quick filter, turned
 * into "name starts with" because the membership holds the query's one
 * array clause; the Filters panel is not offered, because every column
 * beside it would need an index of its own for a list this size.
 *
 * `figures` adds the counter columns for a kind that carries them on its own
 * document. It is a prop rather than two lists because the row grammar — the
 * name cell, the reason a member has no link, the footer — is the part that
 * has to stay identical between screens and forms.
 */
function MemberTable(props: {
  heading: string
  noun: string
  collectionName: CampaignMemberCollection
  hostId: string
  campaignId: string
  toRow: (row: Record<string, unknown>) => MemberRow
  figures?: boolean
}) {
  const { heading, noun, collectionName, hostId, campaignId, toRow, figures } =
    props
  const firestore = useFirestore()
  const gridFilter = useListGridFilter({})
  const search = campaignMembersSearchClause(gridFilter.searchWords)
  const page = useListQuery<Record<string, unknown>>({
    collection: collection(firestore, 'hosts', hostId, collectionName),
    declaration: CAMPAIGN_MEMBERS_QUERY,
    request: {
      clauses: search ? [search] : [],
      base: campaignMembersBase(collectionName, campaignId),
    },
    deps: [firestore, hostId, collectionName, campaignId],
    idField: '$id',
  })
  const rows = useMemo(() => page.rows.map(toRow), [page.rows, toRow])
  // Nothing typed and nothing on the first page: the campaign holds none,
  // which is said in words rather than as an empty grid.
  const none = !search && page.page === 0 && rows.length === 0
  const columns = useMemo<GridColDef<MemberRow>[]>(
    () => [
      {
        field: 'name',
        headerName: 'Name',
        flex: 1,
        minWidth: 240,
        renderCell: ({ row }) => (
          <Stack sx={{ py: 1, minWidth: 0 }}>
            {row.href ? (
              <AppLink href={row.href}>{row.name}</AppLink>
            ) : (
              <>
                <Typography variant="body2">{row.name}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {row.hrefReason}
                </Typography>
              </>
            )}
            {/*
              The overlap, on the row that causes it. A reader comparing two
              campaigns has to be able to see which rows they have in common
              without opening either.
             */}
            {(row.campaigns ?? 1) > 1 ? (
              <Typography variant="caption" color="text.secondary">
                {`Also in ${(row.campaigns ?? 1) - 1} other campaign${
                  (row.campaigns ?? 1) - 1 === 1 ? '' : 's'
                }`}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      ...(figures
        ? MEMBER_FIGURES.map(
            ([figure, headerName]): GridColDef<MemberRow> => ({
              field: figure,
              headerName,
              type: 'number',
              align: 'right',
              headerAlign: 'right',
              width: 120,
              valueGetter: (_value, row) => row.totals?.[figure] ?? null,
              renderCell: ({ row }) => statCell(row.totals?.[figure]),
            }),
          )
        : []),
    ],
    [figures],
  )
  return (
    <Stack spacing={0.5}>
      <Typography variant="overline" color="text.secondary">
        {heading}
      </Typography>
      {none ? (
        <Typography variant="body2" color="text.secondary">
          {page.status === 'loading'
            ? `Reading this campaign’s ${noun}s…`
            : `No ${noun} is in this campaign. Open a ${noun} and pick this ` +
              'campaign on its own page to put it in one.'}
        </Typography>
      ) : (
        <>
          <ListQueryNotices
            refused={listQueryRefusals(page.plan.refused, {
              fields: CAMPAIGN_MEMBERS_QUERY.fields,
              headers: MEMBER_SEARCH_HEADERS,
            })}
            notices={
              search
                ? [CAMPAIGN_MEMBERS_SEARCH_NOTICE, ...page.plan.notices]
                : page.plan.notices
            }
          />
          <ListTable
            aria-label={heading}
            rows={rows}
            columns={columns}
            getRowId={(row: MemberRow) => row.id}
            rowHeight={TABLE_ROW_HEIGHT}
            // A member's name carries why it has no link, and the other
            // campaigns it is in, beneath it.
            getRowHeight={() => 'auto'}
            loading={page.status === 'loading'}
            filterMode="server"
            filterModel={gridFilter.filterModel}
            onFilterModelChange={gridFilter.onFilterModelChange}
            quickFilter
            disableColumnFilter
            disableColumnSorting
            hideFooter
            noRowsLabel={`No ${noun} in this campaign starts with that`}
          />
          <ListPagination
            page={page.page}
            pageSize={page.pageSize}
            rowCount={rows.length}
            hasMore={page.hasMore}
            onPageChange={page.setPage}
            onPageSizeChange={page.setPageSize}
          />
        </>
      )}
    </Stack>
  )
}

CampaignMembersSection.displayName = 'CampaignMembersSection'

export default CampaignMembersSection
