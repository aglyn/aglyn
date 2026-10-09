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
import {
  mdiDeleteOutline,
  mdiPageNextOutline,
  mdiPencilOutline,
} from '@aglyn/shared-data-mdi'
import {
  AppLink,
  CardDisplay,
  MdiIcon,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
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
import type { ListFilterField } from '@aglyn/shared-ui-jsx/const/list-filter'
import {
  type ListFilterClause,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import {
  type ListQueryPlan,
  planListQuery,
} from '@aglyn/shared-ui-jsx/const/list-query-plan'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { nameSearchNormalizers } from '@aglyn/aglyn/app-utils/name-search'
import {
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_ROW_HEIGHT,
} from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { ceilingedWindow } from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
import { listQueryConstraints } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  useFirestore,
  useFirestoreCollection,
  useHostResourceApi,
  useHostVersionApi,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import type { GridColDef, GridSortModel } from '@mui/x-data-grid'
import {
  type ListPageSort,
  sortListRows,
} from '@aglyn/shared-util-tools/list-query/list-column-sort'
import { collection, doc, limit, query, updateDoc } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  EMAIL_TEMPLATE_BASE,
  EMAIL_TEMPLATE_FILTER_HEADERS,
  EMAIL_TEMPLATE_QUERY,
} from '../constants/list-queries'
import { templateProvenance } from '../model/template-provenance'
import { createEmailScreen } from '../utils/create-email-screen'
import { emailTemplateSoftDelete } from '../utils/email-template-soft-delete'
import {
  OrgSiteSelect,
  orgSiteEmailsPath,
  orgSiteName,
  orgSitePageLabel,
  useEmailOrgMount,
  useOrgSitePage,
  type EmailOrgMount,
} from './email-org-mount'

/**
 * How many of one site's templates the organization's list reads.
 *
 * Lower than the site's own list, because this one reads a page of sites at
 * once: a site with more than this is named under the table, with a link to
 * its own Templates page, which reads its whole set.
 */
export const ORG_TEMPLATE_CEILING = 50

/*
 * What the organization's templates grid's Filters panel offers (AGL-3321).
 *
 * The template clauses and the search are the site list's own
 * (`EMAIL_TEMPLATE_QUERY`): ONE plan, put on EVERY site's query, so each
 * site's read is already the answer and nothing is matched in the browser.
 * Site is not a field of a screen but a choice of WHICH sites' queries run:
 * a Site clause reads exactly the sites it names, whichever page of sites
 * they are on. Origin (yours or installed) is not offered, for the reason the
 * declaration gives: a query cannot ask for a field to be absent.
 */
const SITE_FIELD: ListFilterField = {
  column: 'site',
  kind: 'exact',
  path: 'hostId',
  operators: ['equals', 'isAnyOf'],
}
const ORG_TEMPLATE_FILTER_FIELDS: readonly ListFilterField[] = [
  ...EMAIL_TEMPLATE_QUERY.fields,
  SITE_FIELD,
]
const ORG_TEMPLATE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  ...EMAIL_TEMPLATE_FILTER_HEADERS,
  site: 'Site',
}

/** The sites a Site clause names, or null when none is in force. */
export function orgTemplateSiteScope(
  clauses: readonly ListFilterClause[],
): string[] | null {
  const named = clauses
    .filter((clause) => clause.field === SITE_FIELD.column)
    .map((clause) =>
      clause.value
        .split(',')
        .map((entry) => entry.trim())
        .filter(Boolean),
    )
  if (!named.length) return null
  // Several Site clauses all hold: a site must be named by each.
  return named.reduce((kept, next) => kept.filter((id) => next.includes(id)))
}

/** How each header orders the matches in hand (AGL-3680). */
const ORG_TEMPLATE_SORTS: Readonly<Record<string, ListPageSort<Record<string, any>>>> = {
  displayName: (row) => String(row['displayName'] ?? 'Untitled template'),
  site: (row) => row['siteName'],
  origin: (row) =>
    templateProvenance(row).origin === 'installed' ? 'installed' : 'local',
}

/** One site's read, as the table assembles it. */
interface SiteRead {
  rows: Array<Record<string, any>>
  /** The site holds more templates than {@link ORG_TEMPLATE_CEILING}. */
  truncated: boolean
  /** The read has answered — rows or none. */
  settled: boolean
}

/**
 * ONE SITE'S EMAIL TEMPLATES, read while the organization's list is on screen.
 *
 * A component rather than a hook in a loop, because the number of sites
 * changes and a hook's call count may not: each mounted reader is one
 * listener, and a page of sites mounts one per site on it.
 *
 * Every predicate is on the QUERY — the email scope, every clause and the
 * search word, one plan for all the sites (AGL-3321) — so a site's read is
 * its first templates THAT MATCH, by name, and a site with a thousand pages
 * reads its matching emails and nothing else. It reads one past the ceiling,
 * so the table can say when a site holds more matches than it listed.
 */
function SiteTemplatesReader(props: {
  hostId: string
  plan: ListQueryPlan
  onRead: (hostId: string, read: SiteRead) => void
}) {
  const { hostId, plan, onRead } = props
  const firestore = useFirestore()
  const planKey = JSON.stringify({ filters: plan.filters, orderBy: plan.orderBy })
  const { data, status } = useFirestoreCollection<Record<string, any>>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'screens'),
        ...listQueryConstraints(plan),
        limit(ORG_TEMPLATE_CEILING + 1),
      ),
    [firestore, hostId, planKey],
    { idField: '$id' },
  )
  // One window per snapshot, so a re-render that brings no new snapshot hands
  // the table the same rows it already holds.
  const window = useMemo(
    () => ceilingedWindow(data, ORG_TEMPLATE_CEILING),
    [data],
  )
  useEffect(() => {
    onRead(hostId, {
      rows: window.rows,
      truncated: window.truncated,
      settled: status !== 'loading',
    })
  }, [window, status, hostId, onRead])
  return null
}
SiteTemplatesReader.displayName = 'SiteTemplatesReader'

/**
 * THE ORGANIZATION'S TEMPLATES: every site's reusable email designs, in one
 * table.
 *
 * A template is a screen on ONE site — its besigner, its assets and the
 * messages built from it are that site's — so this table reads each site in
 * turn and names the site on every row. A row opens the template's page on
 * its own site, where its report and its recipients are; nothing here is an
 * organization-level template page, because there is no such thing.
 *
 * The reads are one listener per site, over one page of sites at a time —
 * ordered by name — each its site's query for the clauses and search in
 * force, capped at {@link ORG_TEMPLATE_CEILING} matches. The shared footer
 * pages the matches in hand; an organization with more sites than one page
 * chooses which page of sites is read with the Sites picker above the
 * table, or names sites with the Site filter. Both caps say so on screen when
 * they bite, so a missing template is never mistaken for one that does not
 * exist.
 *
 * "New template" asks which site the design is made on — the besigner opens
 * on a site — and skips the question when the org has one site.
 */
export function OrgEmailTemplatesCard() {
  const mount = useEmailOrgMount()
  return mount ? <OrgEmailTemplatesTable mount={mount} /> : null
}
OrgEmailTemplatesCard.displayName = 'OrgEmailTemplatesCard'

function OrgEmailTemplatesTable(props: { mount: EmailOrgMount }) {
  const { mount } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const createHostResource = useHostResourceApi()
  const createHostVersion = useHostVersionApi()
  const sitePage = useOrgSitePage(mount)
  const gridFilter = useListGridFilter({ selectFields: [SITE_FIELD.column] })
  /*
   * Which sites are read: the ones a Site clause names, else the page of
   * sites. The other clauses and the search are ONE plan every site's query
   * carries.
   */
  const siteScope = useMemo(
    () => orgTemplateSiteScope(gridFilter.clauses),
    [gridFilter.clauses],
  )
  const sites = useMemo(
    () =>
      siteScope
        ? mount.hosts.filter((host) => siteScope.includes(host.id))
        : sitePage.sites,
    [siteScope, mount.hosts, sitePage.sites],
  )
  const plan = useMemo(
    () =>
      planListQuery(
        EMAIL_TEMPLATE_QUERY,
        {
          clauses: gridFilter.clauses.filter(
            (clause) => clause.field !== SITE_FIELD.column,
          ),
          search: gridFilter.searchWords,
          base: EMAIL_TEMPLATE_BASE,
        },
        nameSearchNormalizers,
      ),
    [gridFilter.clauses, gridFilter.searchWords],
  )
  const filtering =
    gridFilter.clauses.length > 0 || gridFilter.searchWords.some((word) => word.trim())
  const refusals = useMemo(
    () =>
      listQueryRefusals(plan.refused, {
        fields: ORG_TEMPLATE_FILTER_FIELDS,
        headers: ORG_TEMPLATE_FILTER_HEADERS,
      }),
    [plan.refused],
  )

  const [reads, setReads] = useState<Record<string, SiteRead>>({})
  const onRead = useCallback(
    (hostId: string, read: SiteRead) =>
      setReads((current) => {
        const previous = current[hostId]
        // An answer the table already holds changes nothing to draw.
        if (
          previous &&
          previous.rows === read.rows &&
          previous.truncated === read.truncated &&
          previous.settled === read.settled
        ) {
          return current
        }
        return { ...current, [hostId]: read }
      }),
    [],
  )

  /*
   * One row per template, named by site. The row id joins the site to the
   * screen id: two sites can hold a screen with the same id, and a grid that
   * keyed on the screen alone would draw one of them twice. Every row is an
   * answer some site's query gave; the sort only interleaves the sites'
   * answers by the name each was already ordered by.
   */
  const rows = useMemo(
    () =>
      sites
        .flatMap((site) =>
          (reads[site.id]?.rows ?? []).map((screen) => ({
            ...screen,
            $id: `${site.id}:${screen['$id']}`,
            screenId: String(screen['$id']),
            hostId: site.id,
            siteName: orgSiteName(mount, site.id),
          })),
        )
        .sort(
          (a, b) =>
            String(a['nameLower'] ?? '').localeCompare(String(b['nameLower'] ?? '')) ||
            orgSiteName(mount, a.hostId).localeCompare(
              orgSiteName(mount, b.hostId),
            ),
        ),
    [sites, reads, mount],
  )
  const settled = sites.every((site) => reads[site.id]?.settled)
  const crowded = sites.filter((site) => reads[site.id]?.truncated)

  /*
   * The matches in hand, a page at a time on the shared footer. Choosing
   * another page of sites, or another question, starts from the first page:
   * page four of one answer is not a position in another.
   */
  const filterOptions = useMemo(
    () => ({
      // Every site the organization has: a Site clause reads the sites it
      // names wherever they sit in the page of sites.
      site: mount.hosts.map((site) => ({ value: site.id, label: orgSiteName(mount, site.id) })),
    }),
    [mount],
  )
  /*
   * EVERY HEADER SORTS (AGL-3680), over EVERY match in hand rather than the
   * page on screen: the rows are all loaded (each site capped, and the cap
   * says so above), so the sort is exact and the footer pages the sorted
   * whole. Site sorts by the name the column shows, not the site id.
   */
  const [sortModel, setSortModel] = useState<GridSortModel>([])
  const sorted = useMemo(() => {
    const [first] = sortModel
    const value = first?.sort ? ORG_TEMPLATE_SORTS[first.field] : undefined
    return value && first?.sort ? sortListRows(rows, value, first.sort) : rows
  }, [rows, sortModel])
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const planKey = JSON.stringify({ filters: plan.filters, orderBy: plan.orderBy })
  const siteKey = sites.map((site) => site.id).join(',')
  const sortKey = JSON.stringify(sortModel)
  // A new answer, or a new order, starts again at its first page.
  useEffect(() => setPage(0), [siteKey, planKey, sortKey])
  const shown = useMemo(
    () => sorted.slice(page * pageSize, page * pageSize + pageSize),
    [sorted, page, pageSize],
  )
  const sitePageCount = Math.ceil(sitePage.count / sitePage.pageSize)

  const templateName = (row: Record<string, any>) =>
    String(row['displayName'] ?? 'Untitled template')
  /** The template's own page, on the site that holds it. */
  const templateHref = (row: Record<string, any>) =>
    orgSiteEmailsPath(mount, row['hostId'], `templates/${row['screenId']}`)
  const siteSubdomain = (hostId: string) =>
    mount.hosts.find((site) => site.id === hostId)?.subdomain ?? null
  const besignerHref = (
    hostId: string,
    screenId: string,
    versionId: unknown,
  ) => {
    const subdomain = siteSubdomain(hostId)
    return subdomain && versionId
      ? buildRoute(Route.SCREEN_BESIGNER, {
          orgSlug: mount.orgSlug,
          host: subdomain,
          screenId,
          versionId: String(versionId),
        })
      : null
  }

  const handleDelete = async (row: Record<string, any>) => {
    const confirmed = await confirm({
      title: 'Delete this template?',
      description:
        `"${templateName(row)}" will be removed from ` +
        `${orgSiteName(mount, row['hostId'])}. Emails already sent from it ` +
        'keep their reports.',
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    await updateDoc(
      doc(firestore, 'hosts', row['hostId'], 'screens', row['screenId']),
      emailTemplateSoftDelete(),
    )
  }

  const rowActions = (row: Record<string, any>): RowActionsMenuItem[] => {
    const page = templateHref(row)
    const editor = besignerHref(
      row['hostId'],
      row['screenId'],
      row['versionId'],
    )
    const unlinkedReason =
      'This site has no console address yet, so it cannot be linked to.'
    return [
      {
        key: 'details',
        label: 'Open details',
        icon: <MdiIcon path={mdiPageNextOutline.path} size={0.8} />,
        href: page ?? undefined,
        disabled: !page,
        disabledReason: unlinkedReason,
      },
      {
        key: 'besigner',
        label: 'Edit in besigner',
        icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
        href: editor ?? undefined,
        disabled: !editor,
        disabledReason: row['versionId']
          ? unlinkedReason
          : 'This template has never been saved in the besigner. Open it from its page.',
      },
      {
        key: 'delete',
        label: 'Delete',
        icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
        destructive: true,
        onClick: () => void handleDelete(row),
      },
    ]
  }

  const columns: GridColDef[] = [
    {
      field: 'displayName',
      headerName: 'Template',
      flex: 1,
      minWidth: 220,
      valueGetter: (_value, row) => templateName(row),
      renderCell: ({ row, value }) => {
        const href = templateHref(row)
        return href ? (
          <AppLink
            href={href}
            // The row's own handler would fire too and push the same route
            // twice — one history entry per back press.
            onClick={(event: { stopPropagation: () => void }) =>
              event.stopPropagation()
            }
          >
            {value}
          </AppLink>
        ) : (
          value
        )
      },
    },
    {
      field: 'site',
      headerName: 'Site',
      width: 170,
      valueGetter: (_value, row) => row.hostId,
      renderCell: ({ row }) => row.siteName,
    },
    {
      // Whose template this is, as on a site's own list.
      field: 'origin',
      headerName: 'Origin',
      width: 130,
      valueGetter: (_value, row) =>
        templateProvenance(row).origin === 'installed' ? 'installed' : 'local',
      renderCell: ({ value }) =>
        value === 'installed' ? (
          <Chip size="small" label="Installed" />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'Yours'}
          </Typography>
        ),
    },
    listActionsColumn(
      (row) => (
        <ListRowActions label={templateName(row)} items={rowActions(row)} />
      ),
      { width: 72 },
    ),
  ]

  /*==========================================
   * CREATE, ON A SITE.
   *
   * The same document a site's own list creates — `createEmailScreen`
   * through the quota-enforcing resources route — made as the chosen site,
   * then straight into that site's besigner. One site answers the question
   * itself; otherwise the dialog asks, defaulting to the session's pick.
   *=========================================*/
  const [choosing, setChoosing] = useState(false)
  const [createHostId, setCreateHostId] = useState('')
  const [creating, setCreating] = useState(false)

  const create = async (hostId: string) => {
    if (creating || !hostId) return
    setCreating(true)
    try {
      const { screenId, versionId } = await createEmailScreen(
        hostId,
        createHostResource,
        createHostVersion,
      )
      setChoosing(false)
      const editor = besignerHref(hostId, screenId, versionId)
      if (editor) {
        void router.push(editor)
      } else {
        enqueueSnackbar(
          `Template created on ${orgSiteName(mount, hostId)}. Open it from ` +
            'that site’s Emails page.',
          { variant: 'success' },
        )
      }
    } catch (error: any) {
      console.error(error)
      enqueueSnackbar(error?.message ?? 'Creating the template failed', {
        variant: 'error',
      })
    } finally {
      setCreating(false)
    }
  }

  const handleNew = () => {
    if (mount.hosts.length === 1) return void create(mount.hosts[0].id)
    setCreateHostId(mount.pickedHostId ?? '')
    setChoosing(true)
  }

  const noSites = mount.hostsReady && mount.hosts.length === 0

  return (
    <CardDisplay
      header={'Templates'}
      help={pluginDocsHelp('emailCampaigns', { anchor: '#organization-emails-page' })}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Button
            size="small"
            variant="contained"
            disabled={noSites || creating}
            onClick={handleNew}
          >
            {creating ? 'Creating…' : 'New template'}
          </Button>
        ),
      }}
    >
      {sites.map((site) => (
        <SiteTemplatesReader
          key={site.id}
          hostId={site.id}
          plan={plan}
          onRead={onRead}
        />
      ))}
      <Stack spacing={1.5}>
        {/*
          WHICH SITES' TEMPLATES ARE LISTED, when there are more sites than
          one page holds. Only the chosen page's sites are read; a template on
          a site of another page is one choice away, not missing. It picks
          what is read, a scope, so it is not one of the grid's filters.
         */}
        {sitePageCount > 1 && !siteScope ? (
          <TextField
            select
            size="small"
            label="Sites"
            value={sitePage.page}
            onChange={(event) => sitePage.setPage(Number(event.target.value))}
            sx={{ maxWidth: 260 }}
          >
            {Array.from({ length: sitePageCount }, (_, index) => (
              <MenuItem key={index} value={index}>
                {orgSitePageLabel({
                  from: index * sitePage.pageSize + 1,
                  to: Math.min((index + 1) * sitePage.pageSize, sitePage.count),
                  count: sitePage.count,
                })}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
        {noSites ? (
          <Typography variant="body2" color="text.secondary">
            {'This organization has no sites yet. A template is designed on ' +
              'a site, in its besigner, so it appears here once there is one.'}
          </Typography>
        ) : rows.length === 0 && !filtering ? (
          <Typography variant="body2" color="text.secondary">
            {settled
              ? 'None of these sites has an email template yet. Design one ' +
                'here, then send it from a campaign — a new template opens in ' +
                'the besigner with email-safe components only.'
              : 'Loading templates…'}
          </Typography>
        ) : (
          <>
            <ListFilterChips
              fields={ORG_TEMPLATE_FILTER_FIELDS}
              headers={ORG_TEMPLATE_FILTER_HEADERS}
              clauses={gridFilter.clauses}
              onChange={gridFilter.setClauses}
              options={filterOptions}
            />
            <ListQueryNotices refused={refusals} notices={plan.notices} />
            <ListTable
              aria-label="Email templates"
              rows={shown}
              columns={listFilterGridColumns(
                columns,
                ORG_TEMPLATE_FILTER_FIELDS,
                filterOptions,
                ORG_TEMPLATE_FILTER_HEADERS,
              )}
              rowHeight={TABLE_ROW_HEIGHT}
              // Paged by the footer below, so the grid must not also slice.
              hideFooter
              // The panel and the search go to every site's query; a header
              // sorts every match in hand before the footer pages it.
              filterMode="server"
              filterModel={gridFilter.filterModel}
              onFilterModelChange={gridFilter.onFilterModelChange}
              quickFilter
              sortingMode="server"
              sortModel={sortModel}
              onSortModelChange={setSortModel}
              noRowsLabel="No templates match these filters"
              onOpen={(_id, row) => {
                const href = templateHref(row)
                if (href) router.push(href)
              }}
            />
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={shown.length}
              count={rows.length}
              onPageChange={setPage}
              onPageSizeChange={setPageSize}
            />
          </>
        )}
        {crowded.map((site) => {
          const href = orgSiteEmailsPath(mount, site.id, 'templates')
          return (
            <Alert key={site.id} severity="info">
              {`${orgSiteName(mount, site.id)} has more than ` +
                `${ORG_TEMPLATE_CEILING} ${filtering ? 'matching templates' : 'templates'}, ` +
                'and only the first of them are listed here. '}
              {href ? (
                <AppLink href={href}>{'See all of its templates'}</AppLink>
              ) : null}
            </Alert>
          )
        })}
      </Stack>

      <Dialog
        open={choosing}
        onClose={creating ? undefined : () => setChoosing(false)}
        fullWidth
        maxWidth="xs"
      >
        <DialogTitle>{'New template'}</DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            {'A template is designed on one site, in its besigner, and is ' +
              'sent from that site’s campaigns.'}
          </DialogContentText>
          <OrgSiteSelect
            mount={mount}
            label="Site"
            value={createHostId}
            onChange={setCreateHostId}
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setChoosing(false)} disabled={creating}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={!createHostId || creating}
            onClick={() => void create(createHostId)}
          >
            {creating ? 'Creating…' : 'Create and open'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
OrgEmailTemplatesTable.displayName = 'OrgEmailTemplatesTable'

export default OrgEmailTemplatesCard
