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
  mdiEyeOutline,
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
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { inMemoryListField } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListRowsFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-rows-filter'
import {
  TABLE_PAGE_SIZE_DEFAULT,
  TABLE_ROW_HEIGHT,
} from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  ceilingedWindow,
  collectionCeiling,
} from '@aglyn/tenant-feature-instance/hooks/host-collection-queries'
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
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  doc,
  query,
  Timestamp,
  updateDoc,
  where,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { templateProvenance } from '../model/template-provenance'
import { createEmailScreen } from '../utils/create-email-screen'
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
 * What the organization's templates grid's Filters panel offers (AGL-3317).
 * The table holds every template its page of sites read, so it answers the
 * panel over all of them before the footer's slice. Site offers the sites on
 * that page; Origin reads `originKey`, the provenance the column draws.
 */
const ORG_TEMPLATE_FILTER_FIELDS = [
  inMemoryListField('displayName', 'text', 'templateName'),
  inMemoryListField('site', 'select', 'hostId'),
  inMemoryListField('origin', 'select', 'originKey'),
]
const ORG_TEMPLATE_FILTER_HEADERS: Readonly<Record<string, string>> = {
  displayName: 'Template',
  site: 'Site',
  origin: 'Origin',
}
const ORIGIN_OPTIONS = [
  { value: 'local', label: 'Yours' },
  { value: 'installed', label: 'Installed' },
]
const ORG_TEMPLATE_SEARCH_FIELDS = ['templateName', 'siteName'] as const

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
 * The equality filter is on the QUERY, so a site with a thousand pages reads
 * its emails and nothing else. `collectionCeiling` orders on the document
 * name, which an equality predicate composes onto without a composite index.
 */
function SiteTemplatesReader(props: {
  hostId: string
  onRead: (hostId: string, read: SiteRead) => void
}) {
  const { hostId, onRead } = props
  const firestore = useFirestore()
  const { data, status } = useFirestoreCollection<Record<string, any>>(
    () =>
      collectionCeiling(
        query(
          collection(firestore, 'hosts', hostId, 'screens'),
          where('kind', '==', 'email'),
        ),
        ORG_TEMPLATE_CEILING,
      ),
    [firestore, hostId],
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
 * ordered by name — each capped at {@link ORG_TEMPLATE_CEILING} templates.
 * The shared footer pages the templates in hand, as a site's own list does;
 * an organization with more sites than one page chooses which page of sites
 * is read with the Sites filter above the table, and only that page's sites
 * are read. Both caps say so on screen when they bite, so a missing template
 * is never mistaken for one that does not exist.
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
  const { sites } = sitePage

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
   * keyed on the screen alone would draw one of them twice.
   */
  const rows = useMemo(
    () =>
      sites
        .flatMap((site) =>
          (reads[site.id]?.rows ?? [])
            .filter((screen) => !screen['deletedAt'])
            .map((screen) => ({
              ...screen,
              $id: `${site.id}:${screen['$id']}`,
              screenId: String(screen['$id']),
              hostId: site.id,
              templateName: String(screen['displayName'] ?? 'Untitled template'),
              siteName: orgSiteName(mount, site.id),
              originKey:
                templateProvenance(screen).origin === 'installed' ? 'installed' : 'local',
            })),
        )
        .sort(
          (a, b) =>
            String(a['displayName'] ?? '').localeCompare(
              String(b['displayName'] ?? ''),
            ) ||
            orgSiteName(mount, a.hostId).localeCompare(
              orgSiteName(mount, b.hostId),
            ),
        ),
    [sites, reads, mount],
  )
  const settled = sites.every((site) => reads[site.id]?.settled)
  const crowded = sites.filter((site) => reads[site.id]?.truncated)

  /*
   * The templates in hand, a page at a time on the shared footer. Choosing
   * another page of sites starts the templates from their first page: page
   * four of one set of sites is not a position in another.
   */
  const filterOptions = useMemo(
    () => ({
      site: sites.map((site) => ({ value: site.id, label: orgSiteName(mount, site.id) })),
      origin: ORIGIN_OPTIONS,
    }),
    [sites, mount],
  )
  const templateFilter = useListRowsFilter({
    rows,
    fields: ORG_TEMPLATE_FILTER_FIELDS,
    options: filterOptions,
    headers: ORG_TEMPLATE_FILTER_HEADERS,
    search: ORG_TEMPLATE_SEARCH_FIELDS,
  })
  const matched = templateFilter.rows
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const searchKey = templateFilter.gridFilter.searchWords.join(' ')
  // A narrowed list starts again at its first page.
  useEffect(
    () => setPage(0),
    [sitePage.page, templateFilter.gridFilter.clauses, searchKey],
  )
  const shown = useMemo(
    () => matched.slice(page * pageSize, page * pageSize + pageSize),
    [matched, page, pageSize],
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
      { deletedAt: Timestamp.now() },
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
        icon: <MdiIcon path={mdiEyeOutline.path} size={0.8} />,
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
      valueGetter: (_value, row) => row.originKey,
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
      help={pluginDocsHelp('designedEmails', { anchor: '#find-a-template' })}
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
        <SiteTemplatesReader key={site.id} hostId={site.id} onRead={onRead} />
      ))}
      <Stack spacing={1.5}>
        {/*
          WHICH SITES' TEMPLATES ARE LISTED, when there are more sites than
          one page holds. Only the chosen page's sites are read; a template on
          a site of another page is one choice away, not missing. It picks
          what is read, a scope, so it is not one of the grid's filters.
         */}
        {sitePageCount > 1 ? (
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
        ) : rows.length === 0 ? (
          <Typography variant="body2" color="text.secondary">
            {settled
              ? 'None of these sites has an email template yet. Design one ' +
                'here, then send it from a campaign — a new template opens in ' +
                'the besigner with email-safe components only.'
              : 'Loading templates…'}
          </Typography>
        ) : (
          <>
            <ListFilterChips {...templateFilter.chipsProps} />
            <ListTable
              aria-label="Email templates"
              rows={shown}
              columns={templateFilter.filterColumns(columns)}
              rowHeight={TABLE_ROW_HEIGHT}
              // Paged by the footer below, so the grid must not also slice.
              hideFooter
              // The panel and the search are the grid's; the table answers
              // them over every template it read, before the footer's slice.
              {...templateFilter.gridProps}
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
              count={matched.length}
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
                `${ORG_TEMPLATE_CEILING} templates, and only the first of them ` +
                'are listed here. '}
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
