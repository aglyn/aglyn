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

import type { ScopePlaced } from '@aglyn/aglyn/app-utils/site-placement'
import { TransferResumeImport } from '@aglyn/aglyn/app-utils/transfer-resume-import'
import {
  type AglynOrgBilling,
  checkDatasetQuota,
  checkEntitlement,
  checkQuota,
  getCustomFieldType,
  PageHeaderActions,
  PageHeaderRecord,
  pluginDocsHelp,
  scopeTokensForHost,
  useTransferLauncher,
  visibleToHost,
} from '@aglyn/aglyn'
import { nameSearchKey } from '@aglyn/aglyn/app-utils/name-search'
import { HubSections, type HubSection } from '@aglyn/shared-ui-next/components/hub-tabs'
import { AppLink, CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import { mdiArrowLeft } from '@aglyn/shared-data-mdi'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import {
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import QuotaReadoutComponent from '@aglyn/shared-ui-jsx/components/quota-readout.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Box,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  MenuItem,
  Stack,
  TextField,
  Tooltip,
  Typography,
} from '@mui/material'
import {
  collection,
  deleteDoc,
  deleteField,
  doc,
  documentId,
  endAt,
  getCountFromServer,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  startAt,
  where,
  setDoc,
  writeBatch,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import {
  useFirestore,
  useFirestoreCollection,
  useFirestoreDoc,
  useHostActivityLogger,
  useOrgDataScope,
  usePagedCollection,
  useScopeTokens,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { listQueryConstraints } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import { DatasetSchemaDialog } from './dataset-schema-dialog.component'
import { DatasetRecordDialog, DatasetRecordFieldList } from './dataset-record-dialog.component'
import { DatasetRecordSiteContext } from './dataset-field-inputs.component'
import {
  datasetRecordFilter,
  planRecordQuery,
  recordColumn,
} from './dataset-record-filter'
import { coerceDocumentValues, datasetIntegrityUpdate, datasetValueToInput, effectiveDatasetModel, formatDatasetValue, modelFromFieldEntries, validateDocument } from '../model/dataset-models'
import { fillRecordAddresses } from '../record-pages/record-pages'
import { planReferenceFixups, referencingFieldIds, restrictedDeleteMessage } from '../model/dataset-record-delete-plan'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { datasetListScope } from '../model/dataset-record-list'
import {
  DATASETS_EXPORT_REFUSAL,
  DATASETS_VIEW_RECORDS_REFUSAL,
  DATASETS_WRITE_REFUSAL,
  useDatasetWritesBlocked,
} from './use-dataset-writes-blocked'
import { DATASET_SAMPLE_RECORD_NOTE, datasetDisplayName, isSampleDatasetRecord, parseDatasetFieldEntries } from '../model/datasets'
import { datasetTransferResourceKey } from '../transfer/dataset-transfer-key'
import {
  DATASET_RAIL_GROUP_AT,
  type DatasetRailEntry,
  datasetCreatedLabel,
  datasetNameMatches,
  datasetPickerLabelsOf,
  datasetRailName,
  datasetRecordTitle,
  datasetRailSecondary,
  datasetSharingLabel,
  datasetSourceLabel,
  groupDatasetsBySharing,
  sortDatasetsByName,
} from '../model/dataset-rail'
import { useOrgSites } from './use-org-sites'

export interface HostDatasetsCardProps {
  /** Host context: resolves the owning org and logs host activity. */
  hostId?: string
  /**
   * Direct org scope (AGL-239): the org Data page renders the editor
   * without any host context. Wins over `hostId` resolution when set.
   */
  orgId?: string
  /**
   * The resolved entitlement source (org billing doc). Passed in by both
   * callers (the plugin Data page via the shell, the org Data page via its
   * own resolver) so this relocated card runs entitlement/quota checks
   * without console-app org/session hooks (AGL-395).
   */
  org?: Partial<AglynOrgBilling>
  /**
   * The Data page's own address (AGL-4047): each dataset is a tab of the
   * page's rail, at `<basePath>/<datasetId>`. Handed down by both callers —
   * the site's plugin route and the organization Data page.
   */
  basePath?: string
  /**
   * The path beneath {@link basePath}: `[datasetId]` on a dataset's tab,
   * `[datasetId, 'records', recordId]` on one of its records, and empty on the
   * bare page, which opens the first dataset.
   */
  segments?: readonly string[]
}

/**
 * The sentence that says who a NEW dataset is shared with, for the card and
 * for the site Data page's banner above it.
 *
 * `siteOnly` is true only on a site's Data page in an org whose Default
 * sharing is "Only the site they were created in". Everywhere else a new
 * dataset starts on All sites: the org Data page has no site to limit it to.
 */
/** The records walk serves no header order: every header sorts the page. */
const NO_QUERY_SORTS: never[] = []

/** The grid's own Export and Print, off for a member without "Export data" (AGL-4047). */
const EXPORT_OFF_TOOLBAR = {
  toolbar: { csvOptions: { disableToolbarButton: true }, printOptions: { disableToolbarButton: true } },
}

/** Stable, so an empty answer does not re-render the card. */
const NO_DATASETS: any[] = []

/**
 * The datasets the rail loads at a time, and the most a delete's reference
 * check walks. "Show more datasets" loads the next window, so the rail
 * reaches every dataset however many there are (AGL-4047).
 */
const DATASET_LIST_WINDOW = 100

/**
 * TODO(AGL-4047): switch to true once the `datasets (visibleTo, nameLower)`
 * index is READY and `tools/scripts/backfill-dataset-name-lower.mjs --apply`
 * has run in production. Then the rail is ordered by `nameLower` on the query
 * and the search asks a `nameLower` prefix of the server, rather than the
 * rail walking datasets in document order and matching names among the ones
 * it has loaded. Until both are confirmed, ordering on a field a dataset may
 * lack would leave that dataset off the rail.
 */
const DATASET_NAMES_ON_SERVER = false

/** A dataset read off its document, as the card's rows carry it. */
const datasetRow = (snapshot: { id: string; data(): unknown }) => ({
  $id: snapshot.id,
  ...(snapshot.data() as object),
})

export function newDatasetSharingNote(siteOnly: boolean): string {
  return siteOnly
    ? 'Datasets belong to your organization. Your default sharing starts a ' +
        'new one on this site only — use Schema to share it with more.'
    : 'Datasets belong to your organization. A new one is shared with ' +
        'every site — use Schema to narrow that.'
}

/**
 * Datasets editor (AGL-102): org-shared document collections at
 * `orgs/{orgId}/datasets` (AGL-237/239) with a `records` subcollection,
 * consumed by repeatable components (AGL-103) via `{{item.field}}`.
 * Starter+ (`data-store` flag) with per-plan dataset and record caps —
 * dark-launch rule as everywhere (no plan, no gate). The host path is
 * the pre-migration fallback for hosts not yet org-wired.
 */
export function HostDatasetsCard(props: HostDatasetsCardProps) {
  const { hostId, basePath, segments } = props
  const router = useRouter()
  // `dataScope` is null until the async org lookup settles (AGL-1061), and
  // for a host with no owning org — there is no host fallback to act on
  // any more (AGL-1050), so every path built from it is guarded rather
  // than redirected.
  const { scope: dataScope, orgId } = useOrgDataScope({
    hostId,
    orgId: props.orgId,
  })
  // Scoped sharing (AGL-1044). Required, not cosmetic: under the AGL-1041
  // rules a scoped member's UNFILTERED list is rejected outright —
  // Firestore fails the whole query if any candidate would fail — so
  // without this the Data page errors rather than showing fewer rows.
  const {
    tokens: scopeTokens,
    orgWide: viewerOrgWide,
    loaded: scopeLoaded,
  } = useScopeTokens(orgId)
  /**
   * The site whose Data page this is, or undefined on the organization Data
   * page. The explicit `orgId` is that page's own scope and already wins over
   * `hostId` when the org is resolved, so it wins here too, even if a caller
   * hands the card both.
   */
  const pageHostId = props.orgId ? undefined : hostId || undefined
  // What the VIEWER reaches: their scope tokens, or no filter for an org-wide
  // member, who reads everything. Every dataset here is an org dataset, and
  // org datasets are all scoped (AGL-1041).
  const reachScope = viewerOrgWide ? null : scopeTokens
  /**
   * What this page lists (AGL-4047): a site's Data page shows that site's and
   * the workspace-wide datasets, whoever is looking, as every other site
   * surface does. It used to ask only the viewer's reach, so an owner, who
   * reaches everything, saw every site's datasets on every site. The
   * organization Data page lists the viewer's reach.
   */
  const listScope = useMemo(
    () => datasetListScope({ hostId: pageHostId, memberScope: reachScope }),
    [pageHostId, reachScope],
  )
  // Two answers must be in before listing: the org path (AGL-1061) and the
  // viewer's scope tokens (AGL-1047). `useScopeTokens` reports org-wide
  // while loading, so without `scopeLoaded` a scoped collaborator's first
  // render sends an UNFILTERED list that the AGL-1041 rules deny per
  // document. It recovers on the next render, which is exactly what makes
  // it easy to miss: the page looks right and logs a denial every mount.
  const scopeReady = Boolean(dataScope) && scopeLoaded
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const { org } = props
  const logActivity = useHostActivityLogger(hostId)
  const { data: user } = useUser()
  /**
   * The site a dataset created here is created FROM, or undefined on the
   * organization Data page.
   *
   * `/api/orgs/datasets` stamps a new dataset with the org's Default sharing,
   * and that setting can only narrow to a site the request names — so a
   * create that names none lands on All sites whatever the org chose.
   */
  const createdFromHostId = pageHostId
  const createdFrom = useMemo(
    () => (createdFromHostId ? { hostId: createdFromHostId } : {}),
    [createdFromHostId],
  )
  /**
   * The site the record editor's Page field lists pages from (AGL-3763): the
   * site whose Data page this is, and none on the organization Data page,
   * where a dataset is no one site's.
   */
  const recordSite = useMemo(
    () => ({ hostId: createdFromHostId }),
    [createdFromHostId],
  )
  /**
   * Whether a dataset created here starts on this site alone: the org chose
   * "Only the site they were created in" and there is a site to limit it to.
   * The caption reads it so it never promises All sites to a create that
   * will not get it.
   */
  const createsSiteOnly =
    Boolean(createdFromHostId) &&
    (org as { defaultResourceScope?: 'org' | 'host' } | undefined)
      ?.defaultResourceScope === 'host'

  // Creates go through the console API (AGL-473): rules deny client-side
  // `create` on org datasets/records so quotas are server-enforced.
  // Updates/deletes stay client-direct (they don't consume quota). The
  // legacy host scope (no org resolved) keeps the old client writes.
  const callDatasetApi = useCallback(
    async (payload: Record<string, unknown>) => {
      const response = await authorizedFetch(user, '/api/orgs/datasets', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ orgId, ...payload }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(result?.error ?? 'Dataset operation failed')
      }
      return result
    },
    [user, orgId],
  )

  /**
   * Refresh the live pages showing a dataset after a write the BROWSER made
   * (AGL-3113).
   *
   * Record edits and deletes are client-direct — they consume no quota, so
   * AGL-473 left them out of the server leg — which also left them with
   * nothing to announce from. They make a page listing the rows exactly as
   * stale as a create does, so they take the same trip the create already
   * takes, through the route that already holds the org membership check.
   *
   * BEST EFFORT. The record is stored by the time this runs, and the pages
   * catch up on their own window regardless; a refused cache must never be
   * shown to somebody as a refused save.
   */
  const announceRecords = useCallback(
    async (datasetId: string) => {
      try {
        await callDatasetApi({ action: 'announce-records', datasetId })
      } catch (error) {
        console.error(error)
      }
    },
    [callDatasetApi],
  )

  /**
   * The rail's search and its Shared with filter (AGL-4047).
   *
   * The filter is a query clause: one site the reader reaches, asked by that
   * site's scope tokens in place of the page's own, which they sit inside —
   * a site the reader is a member of is one their own tokens already reach,
   * so the narrower query is still one the rules can prove. Offered on the
   * organization Data page only: a site's page already lists that site's.
   */
  const [nameSearch, setNameSearch] = useState('')
  const [sharedWith, setSharedWith] = useState('')
  const [railWindow, setRailWindow] = useState(DATASET_LIST_WINDOW)
  const railScope = useMemo(
    () => (sharedWith && !pageHostId ? scopeTokensForHost(sharedWith) : listScope),
    [sharedWith, pageHostId, listScope],
  )
  const serverNameKey = DATASET_NAMES_ON_SERVER ? nameSearchKey(nameSearch) : ''
  const { hostNames, sites: orgSites } = useOrgSites(orgId)

  const {
    data: datasetDocs,
    status: datasetsStatus,
    /**
     * The dataset rows are unconfirmed by the server (AGL-1358). The schema
     * dialog is seeded from one of them and writes the whole `model` plus
     * `visibleTo` back, so the freshness verdict belongs to THIS listener —
     * the dialog has none of its own, which is why it is handed down rather
     * than recomputed there.
     */
    fromCache: datasetsFromCache,
    listen: datasetsListen,
  } = useFirestoreCollection<any>(
    () =>
      // `scopeReady` already implies a non-null `dataScope`; testing it
      // directly is what lets the compiler see that too.
      dataScope && scopeReady
        ? query(
            collection(firestore, dataScope[0], dataScope[1], 'datasets'),
            ...(railScope
              ? [where('visibleTo', 'array-contains-any', [...railScope])]
              : []),
            /*
             * A walk that reaches every dataset (AGL-4047). The document's
             * name is on every dataset, so ordering on it leaves none out,
             * and the automatic index serves it beside the scope clause. One
             * row past the window says whether there are more.
             */
            ...(DATASET_NAMES_ON_SERVER
              ? [
                  orderBy('nameLower'),
                  ...(serverNameKey ? [startAt(serverNameKey), endAt(`${serverNameKey}\uf8ff`)] : []),
                ]
              : [orderBy(documentId())]),
            limit(railWindow + 1),
          )
        : null,
    [firestore, dataScope, railScope, scopeReady, railWindow, serverNameKey],
    { idField: '$id' },
  )
  /** The loaded window in name order: what the join dialog and the reference checks read. */
  const datasets = useMemo(
    () => sortDatasetsByName<any>([...(datasetDocs ?? [])].slice(0, railWindow)),
    [datasetDocs, railWindow],
  )
  const moreDatasets = (datasetDocs?.length ?? 0) > railWindow
  /** The rail: the loaded window, narrowed by the search among the names it holds. */
  const railDatasets = useMemo(
    () =>
      DATASET_NAMES_ON_SERVER
        ? datasets
        : datasets.filter((item: DatasetRailEntry) => datasetNameMatches(item, nameSearch)),
    [datasets, nameSearch],
  )
  /**
   * Whether the loaded window is short of everything this page lists: a
   * filter narrowed it, or there are more. A check that must see every
   * dataset — what references a record about to be deleted — reads for
   * itself then.
   */
  const railNarrowed = Boolean(pageHostId) || Boolean(sharedWith) || moreDatasets

  /**
   * The open dataset (AGL-4047): the one the address names, or, on the bare
   * page, none until the page moves to the first. The card is also mounted
   * without an address by callers outside the console's routes, which pick
   * one by state.
   */
  const routeDatasetId = basePath ? segments?.[0] : undefined
  /** The record the address opens on its own page (AGL-4047), beneath its dataset's tab. */
  const routeRecordId = basePath && segments?.[1] === 'records' ? segments?.[2] : undefined
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const wantedId = routeDatasetId ?? selectedId ?? undefined
  const listed = wantedId ? datasets.find((item) => item.$id === wantedId) : undefined
  const listAnswered = datasetDocs !== undefined
  /*
   * A dataset the address names that the loaded window does not hold — past
   * the window, outside the filter, or only just created — is read on its
   * own, live, so its tab still opens and a save still seeds from a listener.
   */
  const linkedRead = useFirestoreDoc<any>(
    () =>
      dataScope && scopeReady && wantedId && listAnswered && !listed
        ? doc(firestore, dataScope[0], dataScope[1], 'datasets', wantedId)
        : null,
    [firestore, dataScope, scopeReady, wantedId, listAnswered, Boolean(listed)],
  )
  // Keyed by the id it was read under, as the list's rows are.
  const linked = useMemo(
    () => (!listed && wantedId && linkedRead.data ? { ...linkedRead.data, $id: wantedId } : undefined),
    [listed, wantedId, linkedRead.data],
  )
  /** A site's page refuses a dataset that is not shared with the site (#2341). */
  const notSharedHere = Boolean(
    pageHostId && linked && !visibleToHost((linked as { visibleTo?: string[] }).visibleTo, pageHostId),
  )
  const notFound = Boolean(
    wantedId &&
      listAnswered &&
      !listed &&
      !linked &&
      (linkedRead.status === 'error' || (linkedRead.status !== 'loading' && !linkedRead.fromCache)),
  )
  const selected =
    listed ??
    (linked && !notSharedHere ? linked : undefined) ??
    (wantedId ? undefined : datasets[0])
  /** Which listener the open dataset came from, for the schema dialog's freshness guard. */
  const seed = listed || !linked
    ? { fromCache: datasetsFromCache, unreadable: datasetsStatus === 'error', listen: datasetsListen }
    : { fromCache: linkedRead.fromCache, unreadable: linkedRead.status === 'error', listen: linkedRead.listen }
  /** Opens a dataset: its own address on a routed page, the card's state elsewhere. */
  const openDataset = useCallback(
    (id: string | null) => {
      if (basePath) router.push(id ? `${basePath}/${id}` : basePath)
      else setSelectedId(id)
    },
    [basePath, router],
  )
  // The bare page opens the first dataset, as a hub opens its first section,
  // so the rail always has a tab lit and the address names what is open.
  const landing = basePath && !routeDatasetId && datasets[0] ? `${basePath}/${datasets[0].$id}` : null
  useEffect(() => {
    if (landing) router.replace(landing)
  }, [landing, router])
  const [schemaOpen, setSchemaOpen] = useState(false)
  // What this member may do with THIS dataset (AGL-4047): one placed on one site
  // answers to that site.
  const blocked = useDatasetWritesBlocked(orgId, selected as ScopePlaced | undefined)
  // Typed model (AGL-179): drives headers, cell rendering, and the
  // document form; v1 datasets get a derived all-text model.
  const model = useMemo(
    () => effectiveDatasetModel(selected ?? {}),
    [selected],
  )
  const fields: string[] = useMemo(() => model.order, [model])
  // The records grid's Filters panel, from the dataset's own schema.
  const recordFilter = useMemo(() => datasetRecordFilter(model), [model])

  // Guarded on BOTH the scope and a real selection (AGL-1440): with no
  // datasets, `selected` never resolves, and `datasets/-none-/records` is not
  // an empty read for everyone — the AGL-1044 scoped-sharing rules deny it
  // outright for a scoped collaborator, and a permanently denied listen is
  // reopened forever by the refusal loop.
  /**
   * The records table PAGES (AGL-2501). It used to be `limit(500)` with no
   * `orderBy`, every row rendered at once and no control anywhere.
   *
   * That was wrong twice. Five hundred documents were read and billed on
   * every mount of a card nobody had scrolled — and past five hundred the
   * remaining rows were not merely unrendered, they were UNREACHABLE, because
   * nothing showed them and nothing asked for more. Firestore answers an
   * unordered limit in document-id order over auto-ids, so which five hundred
   * a reader got was arbitrary and could differ between two loads of the same
   * dataset; `sortDatasetRecords` then sorted that sample by `order`, which
   * made the table look ordered while being a sample. The export leg
   * (AGL-2335) fixed exactly this shape for the file and left the table.
   *
   * ## Why the walk orders on the document id, and not on a field
   *
   * The usual fix is `orderBy` on the field the rows are sorted by. It cannot
   * be used here: `orderBy` matches only documents that HAVE the field, so
   * ordering on one that any writer omits does not mis-order the list, it
   * hides rows from it — a worse failure than the one being fixed, and a
   * silent one. Every candidate on this collection is omitted by some writer:
   *
   *  * `order` — set by `/api/orgs/datasets` and by `POST /v1/datasets/{id}
   *    /records`, and NOT by the tenant form-submit leg or by the workflow
   *    `appendDataset`/`updateDataset` actions, which write `values` and
   *    `createdAt` only. Ordering on it would drop every row a public form or
   *    an automation ever produced — the rows a lead dataset is mostly made
   *    of.
   *  * `createdAt` — written by all four of those, and NOT by a site import:
   *    `IMPORTABLE_FIELDS.records` is `['values', 'order']`, so a restored
   *    record carries no `createdAt` at all.
   *  * `updatedAt` — the mirror image: the import stamps it, the form and
   *    automation legs do not.
   *
   * A document's NAME is not a field and cannot be absent, so ordering on it
   * drops nothing and the walk is total: every record is reachable by paging,
   * which is the property the old query lacked. It is not insertion order —
   * ids are random — so the rows are not claimed to be in one. What they are
   * is stable, complete, and the same on every load.
   *
   * `sortDatasetRecords` is deliberately NOT applied to the page. Re-sorting a
   * window of an id-ordered walk by `order` is the same lie the old code told:
   * rows would run in one order within a page and another across pages.
   * For the same reason a header sorts THIS PAGE only, and says so
   * (AGL-3680, `recordColumnSort` below): no stored field could serve it.
   *
   * ## Filtering: every clause and the search word are on the query
   *
   * The grid's Filters panel and quick search are predicates on this same
   * walk (AGL-3321), planned by `planRecordQuery` (`./dataset-record-filter`,
   * over the shared `planListQuery`): equalities ask the record's
   * `filterValues`, and one word-level clause — a text `contains`, a list
   * member, or the search word — asks its `filterKeys`. Firestore's
   * automatic single-field indexes merge them under the same document-name
   * order, so every filter pages through every matching record exactly as
   * the plain walk pages through all of them, with no composite index and
   * no index deploy.
   *
   * Nothing is matched over the rows already loaded. What one query cannot
   * hold is not offered (ranges, negations, empty checks) or is refused by
   * name above the table (a second `contains`, a `contains` beside the
   * search), and a many-word `contains` or search says it asked the first
   * word.
   */
  const gridFilter = useListGridFilter({ selectFields: recordFilter.selectFields })
  // A clause on a field this dataset does not have (the reader switched
  // datasets) narrows nothing and is not shown.
  const recordClauses = useMemo(
    () =>
      gridFilter.clauses.filter((clause) =>
        recordFilter.fields.some((field) => field.column === clause.field),
      ),
    [gridFilter.clauses, recordFilter.fields],
  )
  const recordPlan = useMemo(
    () => planRecordQuery(model, recordFilter, recordClauses, gridFilter.searchWords),
    [model, recordFilter, recordClauses, gridFilter.searchWords],
  )
  // The query's identity: a new plan is a new walk, from page one.
  const recordPlanKey = JSON.stringify({
    filters: recordPlan.plan.filters,
    orderBy: recordPlan.plan.orderBy,
  })
  const {
    rows: records,
    hasMore: hasMoreRecords,
    page: recordPage,
    setPage: setRecordPage,
    pageSize: recordPageSize,
    setPageSize: setRecordPageSize,
  } = usePagedCollection<any>(
    (pageLimit) =>
      // A record's own page shows no table, so it reads none (AGL-4047).
      dataScope && selected?.$id && !blocked.records && !routeRecordId
        ? query(
            collection(
              firestore,
              dataScope[0],
              dataScope[1],
              'datasets',
              selected.$id,
              'records',
            ),
            ...listQueryConstraints(recordPlan.plan),
            limit(pageLimit),
          )
        : null,
    [firestore, dataScope, selected?.$id, recordPlanKey, blocked.records, routeRecordId],
    { idField: '$id' },
  )
  /**
   * The record a record's own page opens (AGL-4047), read on its own and live,
   * so a deep link to a record on no loaded page still opens and an edit shows
   * as soon as it lands. Asked only of a member who may view the records.
   */
  const routeRecordRead = useFirestoreDoc<any>(
    () =>
      dataScope && selected?.$id && routeRecordId && !blocked.records
        ? doc(firestore, dataScope[0], dataScope[1], 'datasets', selected.$id, 'records', routeRecordId)
        : null,
    [firestore, dataScope, selected?.$id, routeRecordId, blocked.records],
  )
  // Keyed by the id it was read under, as the table's rows are.
  const routeRecord = useMemo(
    () => (routeRecordId && routeRecordRead.data ? { ...routeRecordRead.data, $id: routeRecordId } : null),
    [routeRecordId, routeRecordRead.data],
  )
  const routeRecordMissing = Boolean(
    routeRecordId &&
      !routeRecord &&
      (routeRecordRead.status === 'error' || (routeRecordRead.status !== 'loading' && !routeRecordRead.fromCache)),
  )
  const recordRefusals = useMemo(
    () =>
      listQueryRefusals(recordPlan.refused, {
        fields: recordFilter.fields,
        headers: recordFilter.headers,
        options: recordFilter.options,
      }),
    [recordPlan.refused, recordFilter],
  )
  const filteringRecords =
    recordClauses.length > 0 || gridFilter.searchWords.some((word) => word.trim())
  /**
   * The two HEAD-COUNTS on this card are server aggregates, not the lengths
   * of the two capped listeners above (AGL-1716, the AGL-1706 shape).
   *
   * Both listeners are capped correctly — 100 datasets in a picker, 500 rows
   * in a table, nobody needs more streamed in. What neither may do is answer
   * "how many does this org have", and both did:
   *
   *  * `records.length` saturated at 500 and was handed to
   *    `checkQuota(org, 'recordsPerDataset', …)`. The bands are 1,000 /
   *    10,000 / 100,000 / 500,000 / 1,000,000, so on EVERY paid plan the
   *    check read 500-against-thousands and could never refuse. Worse, the
   *    importer computed its room as `limit − records.length`, so an
   *    understated count *inflated* the slots it offered.
   *  * `datasets.length` saturated at 100 and fed `checkDatasetQuota`, whose
   *    bands run to 250 / 500 / 2,000 above that window.
   *
   * `api/orgs/datasets` — the route that actually enforces both — counts with
   * `collection('datasets').count()` and `collection('records').count()` on
   * these exact paths, so this card was offering headroom the API would then
   * refuse. It now asks the same question the same way, and the console
   * billing page and the staff org page already read the dataset count with
   * this identical unscoped aggregate.
   *
   * THE LISTS KEEP THEIR CAPS. The list and the count are different
   * questions; only the count moved. A one-shot goes stale where a listener
   * refreshed for free, so both are re-read after any mutation that can move
   * them — the epochs below.
   *
   * No counting RULE moves: `checkQuota` and `checkDatasetQuota` are
   * untouched entitlement inputs, and nothing here is metered by
   * `report-usage` (it samples record counts server-side for storage, on its
   * own read). Only this card's inputs stopped being saturated.
   */
  const [datasetCountEpoch, setDatasetCountEpoch] = useState(0)
  const [recordCountEpoch, setRecordCountEpoch] = useState(0)
  const [serverDatasetCount, setServerDatasetCount] = useState<number | null>(
    null,
  )
  // TAGGED with the dataset it describes. A bare number would have to be
  // cleared when the selection changes, and clearing state from inside the
  // effect that fills it is a render loop waiting for one unstable dep;
  // tagging answers "whose count is this?" without writing state on render.
  const [serverRecordCount, setServerRecordCount] = useState<{
    datasetId: string
    count: number
  } | null>(null)
  useEffect(() => {
    if (!dataScope) return
    let active = true
    // Unscoped, exactly like `api/orgs/datasets` and the billing page: the
    // quota is about the ORG's datasets, not the subset this collaborator
    // can see. A scoped collaborator whom AGL-1044 denies the read falls
    // through to the catch and keeps the visible-rows lower bound.
    void getCountFromServer(
      collection(firestore, dataScope[0], dataScope[1], 'datasets'),
    )
      .then((snapshot) => {
        if (active) setServerDatasetCount(snapshot.data().count)
      })
      .catch(() => {
        // Falls back to the listener length below — a LOWER bound, and this
        // card's prior behaviour. Deliberately not 0: `checkDatasetQuota`
        // answers from whatever it is handed, and 0 used is a confident
        // wrong number in the flattering direction.
      })
    return () => {
      active = false
    }
  }, [firestore, dataScope, datasetCountEpoch])
  // The dataset the counts below belong to. Distinct from `selectedId`
  // above, which is the PICKER value and is null until the user chooses.
  const countedDatasetId: string | undefined = selected?.$id
  useEffect(() => {
    if (!dataScope || !countedDatasetId || blocked.records) return
    let active = true
    void getCountFromServer(
      collection(
        firestore,
        dataScope[0],
        dataScope[1],
        'datasets',
        countedDatasetId,
        'records',
      ),
    )
      .then((snapshot) => {
        if (active) {
          setServerRecordCount({
            datasetId: countedDatasetId,
            count: snapshot.data().count,
          })
        }
      })
      .catch(() => {
        // Same fallback, same reason as above.
      })
    return () => {
      active = false
    }
  }, [firestore, dataScope, countedDatasetId, recordCountEpoch, blocked.records])
  // Pending, denied, or answered about the PREVIOUS selection, the loaded
  // rows stand in. They can only UNDERSTATE (same collections, capped),
  // never overstate, so nothing these figures gate fires on a count larger
  // than the truth. Since AGL-2501 the record fallback is one PAGE, so it
  // understates by more — which moves it further in the safe direction and
  // changes nothing about which way it can be wrong.
  const datasetCount = serverDatasetCount ?? datasets.length
  const recordCount =
    serverRecordCount && serverRecordCount.datasetId === countedDatasetId
      ? serverRecordCount.count
      : records.length

  // --- Create dataset -----------------------------------------------------
  const [creator, setCreator] = useState<{
    name: string
    fields: string
  } | null>(null)
  const handleOpenCreator = useCallback(() => {
    if (!checkEntitlement(org, 'dataStore')) {
      return enqueueSnackbar(
        'Datasets require a Starter plan or higher — see Billing',
        { variant: 'warning', persist: false },
      )
    }
    // Addon-aware quota (AGL-132): purchased extra datasets raise the
    // limit up to the plan's hard max; beyond that only an upgrade helps.
    // The ORG's datasets, not the picker's window (AGL-1716).
    const quota = checkDatasetQuota(org as any, datasetCount)
    if (!quota.allowed) {
      return enqueueSnackbar(
        quota.upgradeRequired
          ? `Dataset limit reached (${quota.limit}) — upgrade in Billing`
          : `Dataset limit reached (${quota.limit}) — add extra datasets ` +
            `for $${quota.addonPriceUsd}/mo each or upgrade in Billing`,
        { variant: 'warning', persist: false },
      )
    }
    setCreator({ name: '', fields: '' })
  }, [org, datasetCount, enqueueSnackbar])
  // Entries are human names — "Roast preference" → stable id
  // `roast_preference` with the pretty name kept for headers (AGL-558).
  const creatorEntries = parseDatasetFieldEntries(creator?.fields ?? '')
  const creatorFields = creatorEntries.map((entry) => entry.id)
  const handleCreate = useCallback(async () => {
    // No org, no create. The `else` that used to sit below this was the
    // legacy host-scope client write (AGL-1050) — the one path by which a
    // dataset could be created with NO quota check, since /api/orgs/datasets
    // is where AGL-473 enforces it. The rules now deny that path outright;
    // this is the client side of the same closure. The Add button is
    // disabled without a scope, so reaching the guard means a stale closure.
    if (!creator?.name.trim() || creatorFields.length === 0 || !orgId) return
    let id: string
    try {
      const result = await callDatasetApi({
        action: 'create-dataset',
        displayName: creator.name.trim(),
        fields: creatorFields,
        // Typed model from day one (AGL-178); refine in the Schema dialog.
        model: modelFromFieldEntries(creatorEntries),
        ...createdFrom,
      })
      id = String(result.id)
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Dataset create failed', {
        variant: 'warning',
        persist: false,
      })
    }
    setCreator(null)
    openDataset(id)
    setDatasetCountEpoch((epoch) => epoch + 1)
    enqueueSnackbar(`Dataset "${creator.name.trim()}" created`, {
      variant: 'success',
      persist: false,
    })
    logActivity('Created dataset', {
      type: 'content',
      id,
      name: creator.name.trim(),
    })
  }, [creator, creatorEntries, creatorFields, orgId, createdFrom, callDatasetApi, enqueueSnackbar, logActivity, openDataset])

  // Join collection template (AGL-180): extrinsic many-to-many as a
  // visible, editable collection of FKey pairs — no magic.
  const [joiner, setJoiner] = useState<{ a: string; b: string } | null>(null)
  const handleCreateJoin = useCallback(async () => {
    if (!joiner?.a || !joiner?.b || joiner.a === joiner.b) return
    const a = datasets.find((item) => item.$id === joiner.a)
    const b = datasets.find((item) => item.$id === joiner.b)
    // A join collection is a dataset and consumes the same quota, so it
    // takes the same API-only route (AGL-1050) — the host-scope client
    // write that used to stand in for it is gone.
    if (!a || !b || !orgId) return
    const fieldFor = (target: any, fieldId: string) => ({
      name: datasetDisplayName(target) || fieldId,
      type: 'reference' as const,
      required: true,
      reference: {
        datasetId: target.$id as string,
        displayFieldId: effectiveDatasetModel(target).order[0],
        onDelete: 'setNull' as const,
      },
    })
    const payload = {
      displayName: `${datasetDisplayName(a)} ↔ ${datasetDisplayName(b)}`,
      fields: ['aRef', 'bRef'],
      model: {
        order: ['aRef', 'bRef'],
        fields: { aRef: fieldFor(a, 'aRef'), bRef: fieldFor(b, 'bRef') },
      },
    }
    let id: string
    try {
      const result = await callDatasetApi({
        action: 'create-dataset',
        ...payload,
        // A join collection is a dataset, so the same Default sharing applies.
        ...createdFrom,
      })
      id = String(result.id)
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Join create failed', {
        variant: 'warning',
        persist: false,
      })
    }
    setJoiner(null)
    openDataset(id)
    // A join collection IS a dataset and consumes the same quota.
    setDatasetCountEpoch((epoch) => epoch + 1)
    enqueueSnackbar('Join collection created', {
      variant: 'success',
      persist: false,
    })
  }, [joiner, datasets, orgId, createdFrom, callDatasetApi, enqueueSnackbar, openDataset])

  const handleDeleteDataset = useCallback(async () => {
    if (!selected) return
    const confirmed = await confirm({
      title: 'Delete this dataset?',
      description:
        `"${datasetDisplayName(selected)}"` +
        // What is actually being destroyed, not what is loaded (AGL-1716):
        // a 40,000-row dataset used to warn about "its 500 documents".
        (recordCount
          ? ` and its ${recordCount.toLocaleString()} record${recordCount === 1 ? '' : 's'}`
          : '') +
        ' will be deleted. Repeatable components and bindings that use it ' +
        'stop showing its data.',
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed || !dataScope) return
    // Deleting the dataset doc client-side would strand its `records`
    // subcollection — Firestore doesn't cascade and only the Admin SDK has
    // `recursiveDelete`, so the delete goes through the erase route
    // (AGL-945). Single-record deletes below stay client-direct.
    try {
      const response = await authorizedFetch(user, '/api/resources/erase', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          scope: dataScope[0],
          scopeId: dataScope[1],
          kind: 'datasets',
          id: selected.$id,
          // Names the site this delete was issued from, so the route can
          // refuse to destroy a dataset shared beyond it (AGL-1046). The
          // org Data page passes no host and keeps the org-wide delete.
          hostId,
        }),
      })
      const result = await response.json().catch(() => ({}))
      if (!response.ok) throw new Error(result?.error ?? 'Dataset delete failed')
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Dataset delete failed', {
        variant: 'warning',
        persist: false,
      })
    }
    openDataset(null)
    setDatasetCountEpoch((epoch) => epoch + 1)
    enqueueSnackbar('Dataset deleted', { variant: 'success', persist: false })
    logActivity('Deleted dataset', {
      type: 'content',
      id: selected.$id,
      name: datasetDisplayName(selected),
    })
  }, [
    selected,
    recordCount,
    confirm,
    dataScope,
    hostId,
    user,
    enqueueSnackbar,
    logActivity,
    openDataset,
  ])

  /**
   * What the selected dataset's references point at beyond this site's list
   * (AGL-4047). A dataset this site sees can name a target another site holds;
   * the schema dialog warns about exactly that, and a cell still labels the
   * row it points at, so the target has to be known even though the site's
   * list does not show it. Read one by one, and only when there is one; a
   * target the viewer may not read stays unknown.
   */
  const [outsideTargets, setOutsideTargets] = useState<any[]>(NO_DATASETS)
  useEffect(() => {
    let active = true
    const missing = railNarrowed
      ? [
          ...new Set(
            model.order
              .map((fieldId) => model.fields[fieldId]?.reference?.datasetId)
              .filter((id): id is string => Boolean(id)),
          ),
        ].filter((id) => !datasets.some((item) => item.$id === id))
      : []
    if (!missing.length || !dataScope) {
      setOutsideTargets(NO_DATASETS)
      return
    }
    void Promise.all(
      missing.map((id) =>
        getDoc(doc(firestore, dataScope[0], dataScope[1], 'datasets', id)).then(
          (snapshot) => (snapshot.exists() ? datasetRow(snapshot) : null),
          () => null,
        ),
      ),
    ).then((rows) => {
      if (active) setOutsideTargets(rows.filter(Boolean))
    })
    return () => {
      active = false
    }
  }, [railNarrowed, model, datasets, firestore, dataScope])
  const knownDatasets = useMemo(
    () => (outsideTargets.length ? [...datasets, ...outsideTargets] : datasets),
    [datasets, outsideTargets],
  )

  // Reference pickers (AGL-180): load target-collection rows for every
  // reference field in the model (id -> display label).
  const [refOptions, setRefOptions] = useState<
    Record<string, Array<{ id: string; label: string }>>
  >({})
  useEffect(() => {
    let active = true
    const referenceFields = model.order.filter(
      (fieldId) =>
        model.fields[fieldId]?.type === 'reference' &&
        model.fields[fieldId]?.reference?.datasetId,
    )
    if (!referenceFields.length || !dataScope) {
      setRefOptions({})
      return
    }
    void Promise.all(
      referenceFields.map(async (fieldId) => {
        const reference = model.fields[fieldId].reference as {
          datasetId: string
          displayFieldId?: string
        }
        const target = knownDatasets.find(
          (item) => item.$id === reference.datasetId,
        )
        const displayFieldId =
          reference.displayFieldId ??
          effectiveDatasetModel(target ?? {}).order[0]
        const snapshot = await getDocs(
          query(
            collection(
              firestore,
              dataScope[0],
              dataScope[1],
              'datasets',
              reference.datasetId,
              'records',
            ),
            limit(200),
          ),
        ).catch(() => null)
        const options = (snapshot?.docs ?? []).map((docSnapshot) => ({
          id: docSnapshot.id,
          label: String(
            docSnapshot.get('values')?.[displayFieldId ?? ''] ??
              docSnapshot.id,
          ),
        }))
        return [fieldId, options] as const
      }),
    ).then((entries) => {
      if (active) setRefOptions(Object.fromEntries(entries))
    })
    return () => {
      active = false
    }
  }, [model, knownDatasets, firestore, dataScope])
  /**
   * One reference target's label, or `null` when this ID resolves to nothing.
   *
   * The distinction the grid cannot draw. `referenceLabel` below falls back to
   * the raw ID, which is the only thing a cell has room for and is
   * indistinguishable from a resolved label that happens to look like an ID.
   * The record view has room to say which, so it asks the question that has a
   * `null` answer.
   *
   * Unresolvable covers more than a deleted target: `refOptions` loads at most
   * 200 rows per referenced collection, so a live target outside that window
   * reports the same way. Either way the ID is shown and neither is claimed to
   * be a working link.
   */
  const resolveReferenceLabel = useCallback(
    (fieldId: string, id: string): string | null =>
      refOptions[fieldId]?.find((option) => option.id === id)?.label ?? null,
    [refOptions],
  )
  const referenceLabel = useCallback(
    (fieldId: string, value: unknown): string => {
      const ids = Array.isArray(value) ? value : value != null ? [value] : []
      return ids
        .map((id) => resolveReferenceLabel(fieldId, String(id)) ?? String(id))
        .join(', ')
    },
    [resolveReferenceLabel],
  )
  /**
   * The record the viewer is showing, held as an ID and resolved against the
   * page the table already has.
   *
   * Holding the ID rather than the row is what keeps the view live without
   * costing a read: the same listener that draws the table re-resolves it, so
   * an edit landing underneath updates the open dialog. When the row leaves
   * the page — deleted, or paged past — this answers `null` and the dialog
   * closes, which is the honest response to a record no longer in front of
   * this reader. Nothing here queries: `records` is the page (or filter window)
   * query's answer.
   */
  const [viewerId, setViewerId] = useState<string | null>(null)
  /**
   * Opens a record (AGL-4047): on its own page beneath the dataset's tab
   * where the Data page is routed, in the View record dialog elsewhere.
   */
  const datasetHref = basePath && selected?.$id ? `${basePath}/${selected.$id}` : null
  const openRecord = useCallback(
    (id: string) => {
      if (datasetHref) router.push(`${datasetHref}/records/${encodeURIComponent(id)}`)
      else setViewerId(id)
    },
    [datasetHref, router],
  )
  const viewerRecord = useMemo(
    () =>
      viewerId
        ? (records.find((record: any) => record.$id === viewerId) ?? null)
        : null,
    [viewerId, records],
  )

  // --- Document editor (null id = new; AGL-179 typed inputs) --------------
  const [editor, setEditor] = useState<{
    id: string | null
    values: Record<string, string>
    errors: Record<string, string>
    /** A sample a site start seeded (AGL-4065): saving it makes it the owner's. */
    sample?: boolean
  } | null>(null)
  const handleOpenRecord = useCallback(
    (record?: any) => () => {
      if (!record) {
        // The dataset's documents, not the loaded window (AGL-1716).
        const quota = checkQuota(org, 'recordsPerDataset', recordCount)
        if (!quota.allowed) {
          return enqueueSnackbar(
            `Record limit reached (${quota.limit}) — see Billing to upgrade`,
            { variant: 'warning', persist: false },
          )
        }
      }
      const values: Record<string, string> = {}
      for (const fieldId of model.order) {
        const field = model.fields[fieldId]
        if (!field) continue
        if (record) {
          values[fieldId] = datasetValueToInput(
            field,
            record.values?.[fieldId],
          )
        } else if (field.default != null) {
          values[fieldId] = String(field.default)
        }
      }
      // Flag non-conforming stored values (AGL-178 policy: type changes
      // never rewrite documents; the editor surfaces the mismatch).
      const errors = record
        ? validateDocument(model, record.values ?? {})
        : {}
      setEditor({ id: record?.$id ?? null, values, errors, ...(isSampleDatasetRecord(record) ? { sample: true } : {}) })
    },
    [org, recordCount, model, enqueueSnackbar],
  )
  const handleSaveRecord = useCallback(async () => {
    if (!editor || !selected || !dataScope) return
    // The editor holds the record's WHOLE values, so an address it already
    // has stays and an empty one fills in from its source (AGL-3475).
    const coerced = fillRecordAddresses(
      model,
      coerceDocumentValues(model, editor.values),
    )
    const errors = validateDocument(model, coerced)
    if (Object.keys(errors).length) {
      return void setEditor((prev) => (prev ? { ...prev, errors } : prev))
    }
    // `values` is replaced wholesale (not merged) so orphaned values from
    // removed fields strip here, lazily, per the documented AGL-178 policy.
    try {
      if (editor.id) {
        // Updates stay client-direct (no quota consumed).
        const recordRef = doc(
          firestore,
          dataScope[0],
          dataScope[1],
          'datasets',
          selected.$id,
          'records',
          editor.id,
        )
        await setDoc(
          recordRef,
          {
            values: coerced,
            // The integrity index moves with the values it describes
            // (`datasetIntegrityUpdate`); the merging form, because clearing
            // the last reference has to REMOVE the field rather than omit it.
            ...datasetIntegrityUpdate(model, coerced, deleteField()),
            // A sample saved is the owner's row now (AGL-4065).
            ...(editor.sample ? { sample: deleteField() } : {}),
            updatedAt: Timestamp.now(),
          },
          {
            mergeFields: [
              'values',
              'referencedIds',
              'filterKeys',
              'filterValues',
              'updatedAt',
              ...(editor.sample ? ['sample'] : []),
            ],
          },
        )
        await announceRecords(selected.$id)
      } else {
        // Creates go through the quota-enforcing API (AGL-473). The legacy
        // host-scope client write that used to follow this branch is gone
        // (AGL-1050): a non-null `dataScope` is an org scope, so `orgId` is
        // set and there is no third case to fall into.
        await callDatasetApi({
          action: 'create-record',
          datasetId: selected.$id,
          values: coerced,
        })
      }
    } catch (error: any) {
      return void enqueueSnackbar(error?.message ?? 'Record save failed', {
        variant: 'warning',
        persist: false,
      })
    }
    setEditor(null)
    // A create moves the count; an update cannot. Same reason as the
    // importer: the one-shot aggregate does not refresh itself.
    if (!editor.id) setRecordCountEpoch((epoch) => epoch + 1)
    enqueueSnackbar(editor.id ? 'Record saved' : 'Record added', {
      variant: 'success',
      persist: false,
    })
    logActivity(editor.id ? 'Updated record' : 'Added record', {
      type: 'content',
      id: selected.$id,
      name: datasetDisplayName(selected),
    })
  }, [
    editor,
    selected,
    firestore,
    dataScope,
    model,
    callDatasetApi,
    announceRecords,
    enqueueSnackbar,
    logActivity,
  ])
  const handleDeleteRecord = useCallback(
    (record: any, afterDelete?: () => void) => async () => {
      // Datasets whose records this delete rewrites through a reference
      // fixup, beside the one the record belongs to. Each has pages of its
      // own to refresh (AGL-3113).
      const alsoChanged = new Set<string>()
      if (!selected || !dataScope) return
      /**
       * Delete integrity (AGL-180): every collection whose model references
       * this one is asked whether it still points at this record. `restrict`
       * blocks the delete; `setNull` strips the FKey from the holders.
       *
       * The question is a QUERY over the denormalized `referencedIds` index,
       * not a page of records filtered in the browser. A page answers for the
       * rows it happened to fetch — an unordered `limit` is answered in
       * document-id order over auto-ids, so it is an arbitrary sample — and a
       * reference held by a row outside it reads as no reference at all: the
       * delete goes through and `restrict` silently fails to restrict, leaving
       * a document pointing at something that no longer exists. `values`
       * itself cannot be queried (it carries a deliberate index exemption —
       * see `datasetIntegrityFields`), which is why the index exists.
       *
       * The query narrows to the candidates; the per-field test below keeps it
       * EXACT, since `referencedIds` is the union across every reference field
       * and one of them may point at a different collection entirely.
       *
       * ⚠️ FAILS CLOSED. A query that rejects — a missing index, a rules
       * refusal on a collection this member cannot read — refuses the delete
       * rather than treating silence as "nothing references it". A check that
       * fails open is worse than no check, because the UI then tells the user
       * the record is safe to remove.
       *
       * ⚠️ Reaches the collections in this viewer's scoped, capped window. A
       * referencing collection shared with no site this member can see is one
       * the client may not read at all, so it is not consulted; only a server
       * route could close that.
       *
       * On a site's Data page that window is NOT the list (AGL-4047). The list
       * is the site's, and a dataset another site holds can reference a row of
       * one shared with both: narrowing what the page shows must not narrow
       * what a delete protects. So the page reads the viewer's reach here, once,
       * at the moment of the delete, and refuses if it cannot.
       */
      let referencing: any[] = datasets
      if (railNarrowed) {
        try {
          const reach = await getDocs(
            query(
              collection(firestore, dataScope[0], dataScope[1], 'datasets'),
              ...(reachScope
                ? [where('visibleTo', 'array-contains-any', [...reachScope])]
                : []),
              limit(DATASET_LIST_WINDOW),
            ),
          )
          referencing = reach.docs.map(datasetRow)
        } catch {
          return void enqueueSnackbar(
            'Cannot delete: the datasets that may reference this record could ' +
              'not be checked, so removing it could break them. Nothing was ' +
              'deleted.',
            { variant: 'error' },
          )
        }
      }
      for (const other of referencing) {
        const otherModel = effectiveDatasetModel(other)
        if (!referencingFieldIds(otherModel, selected.$id).length) continue
        let snapshot
        try {
          snapshot = await getDocs(
            query(
              collection(
                firestore,
                dataScope[0],
                dataScope[1],
                'datasets',
                other.$id,
                'records',
              ),
              where('referencedIds', 'array-contains', record.$id),
            ),
          )
        } catch {
          return void enqueueSnackbar(
            `Cannot delete: "${datasetDisplayName(other)}" could not be checked for ` +
              'references, so removing this record could break it. Nothing ' +
              'was deleted.',
            { variant: 'error' },
          )
        }
        // The verdict is shared with `/api/orgs/datasets` `delete-record`
        // (`planReferenceFixups`): the per-field test keeps the query EXACT,
        // since `referencedIds` is the union across every reference field.
        const plan = planReferenceFixups(
          otherModel,
          selected.$id,
          record.$id,
          snapshot.docs.map((docSnapshot) => ({ id: docSnapshot.id, values: docSnapshot.get('values') })),
        )
        if (plan.kind === 'none') continue
        if (plan.kind === 'restricted') {
          return void enqueueSnackbar(
            restrictedDeleteMessage(plan.holders, datasetDisplayName(other)),
            { variant: 'warning', persist: false },
          )
        }
        // Chunked under Firestore's 500-writes-per-batch cap. The query is no
        // longer bounded by a page size, so the number of holders is whatever
        // the collection really holds.
        for (let start = 0; start < plan.updates.length; start += 400) {
          const batch = writeBatch(firestore)
          for (const update of plan.updates.slice(start, start + 400)) {
            const holder = snapshot.docs.find((docSnapshot) => docSnapshot.id === update.id)
            if (!holder) continue
            batch.update(holder.ref, {
              values: update.values,
              ...datasetIntegrityUpdate(otherModel, update.values, deleteField()),
            })
          }
          await batch.commit()
        }
        // The fixups rewrote rows in ANOTHER dataset, whose own pages are now
        // showing a reference that no longer resolves.
        alsoChanged.add(other.$id)
      }
      await deleteDoc(
        doc(
          firestore,
          dataScope[0],
          dataScope[1],
          'datasets',
          selected.$id,
          'records',
          record.$id,
        ),
      )
      setRecordCountEpoch((epoch) => epoch + 1)
      for (const datasetId of [selected.$id, ...alsoChanged]) {
        await announceRecords(datasetId)
      }
      enqueueSnackbar('Record deleted', { variant: 'success', persist: false })
      afterDelete?.()
    },
    [
      selected,
      datasets,
      railNarrowed,
      reachScope,
      firestore,
      dataScope,
      announceRecords,
      enqueueSnackbar,
    ],
  )

  /**
   * Import and export (AGL-3530) open the console's import wizard and export
   * dialog on this dataset (`data.dataset:<datasetId>`): the file is read,
   * matched and written on the server, through the same record writes as
   * every other create and update, and the export streams the fields the
   * person picks. Outside the console shell there is no launcher, and no
   * Import or Export to offer. Inside it, Import is on for a member who may
   * write this dataset and switched off with the permission named for one who
   * may not, and Export likewise for "Export data", for a member who can see it
   * (AGL-3546, AGL-4047) — the transfer routes' own rule.
   */
  const transfer = useTransferLauncher()
  const transferTarget = selected?.$id
    ? {
        resource: datasetTransferResourceKey(selected.$id),
        scope: 'org' as const,
        // This dataset's own answer once it is known; the workspace's until then.
        ...(blocked.known ? { importAllowed: !blocked.writes } : {}),
      }
    : null
  const canImport = Boolean(transfer && transferTarget && transfer.can('import', transferTarget))
  const canExport = Boolean(transfer && transferTarget && transfer.can('export', transferTarget))
  const handleImport = useCallback(() => {
    if (!transfer || !selected?.$id) return
    const dataset = { id: selected.$id, name: datasetDisplayName(selected) }
    transfer.openImport({
      resource: datasetTransferResourceKey(dataset.id),
      scope: 'org',
      title: dataset.name ? `Import into ${dataset.name}` : 'Import records',
      onFinished: () => {
        // An import moves the record count, and the aggregate is a one-shot.
        setRecordCountEpoch((epoch) => epoch + 1)
        logActivity('Imported records', { type: 'content', id: dataset.id, name: dataset.name })
      },
    })
  }, [transfer, selected, logActivity])
  const handleExport = useCallback(() => {
    if (!transfer || !selected?.$id) return
    const name = datasetDisplayName(selected)
    transfer.openExport({
      resource: datasetTransferResourceKey(selected.$id),
      scope: 'org',
      title: name ? `Export ${name}` : 'Export records',
      // The table's own query, re-planned on the server the way the table
      // plans it, so "the current filter" exports what the table shows.
      ...(filteringRecords
        ? {
            filter: {
              label: 'The records the table’s filters and search show',
              value: { clauses: recordClauses, search: gridFilter.searchWords },
            },
          }
        : {}),
    })
  }, [transfer, selected, filteringRecords, recordClauses, gridFilter.searchWords])

  /*
   * One column per schema field, filterable as far as `datasetRecordFilter`
   * declares it. The row OPENS the record, read-only (`onOpen`); the actions
   * column holds the keyboard's way in (`View`, a real button) beside Edit
   * and Delete, and a press anywhere in it never opens the row.
   */
  const recordGridColumns = useMemo(
    () =>
      listFilterGridColumns(
        [
          ...fields.map((fieldId, column) => {
            const field = model.fields[fieldId]
            const shown = (row: any) =>
              field?.type === 'reference'
                ? referenceLabel(fieldId, row.values?.[fieldId]) || '--'
                : field
                  ? formatDatasetValue(field, row.values?.[fieldId]) || '--'
                  : '--'
            return {
              field: recordColumn(fieldId),
              headerName: field?.name ?? fieldId,
              // Field descriptions (AGL-560) surface as header hints.
              description: field?.description,
              flex: 1,
              minWidth: 140,
              renderCell: ({ row }: { row: any }) =>
                // A sample a site start seeded says so beside its first value (AGL-4065).
                column === 0 && isSampleDatasetRecord(row) ? (
                  <Stack direction="row" spacing={1} sx={{ alignItems: 'center', height: '100%', minWidth: 0 }}>
                    <Typography variant="body2" noWrap>
                      {shown(row)}
                    </Typography>
                    <Tooltip title={DATASET_SAMPLE_RECORD_NOTE}>
                      <Chip label="Sample" size="small" variant="outlined" color="info" />
                    </Tooltip>
                  </Stack>
                ) : (
                  shown(row)
                ),
            }
          }),
          listActionsColumn(
            (record: any) => (
              <Stack
                direction="row"
                sx={{ height: '100%', alignItems: 'center', justifyContent: 'flex-end' }}
              >
                <Button size="small" onClick={() => openRecord(record.$id)}>
                  {'View'}
                </Button>
                <BlockedControl blocked={blocked.writes} reason={blocked.writesReason}>
                  <Button size="small" onClick={handleOpenRecord(record)}>
                    {'Edit'}
                  </Button>
                </BlockedControl>
                <BlockedControl blocked={blocked.writes} reason={blocked.writesReason}>
                  <Button
                    size="small"
                    color="error"
                    onClick={handleDeleteRecord(record)}
                  >
                    {'Delete'}
                  </Button>
                </BlockedControl>
              </Stack>
            ),
            { width: 220 },
          ),
        ] as Parameters<typeof listFilterGridColumns>[0],
        recordFilter.fields,
        recordFilter.options,
        recordFilter.headers,
      ),
    [
      fields,
      model,
      referenceLabel,
      handleOpenRecord,
      handleDeleteRecord,
      openRecord,
      recordFilter,
      blocked.writes,
      blocked.writesReason,
    ],
  )

  /*
   * EVERY HEADER SORTS — THE PAGE ON SCREEN (AGL-3680). A record's values are
   * per-schema and no field is on every record (see the walk above), so no
   * query can order by one; each value column sorts the loaded page by what
   * it shows (a reference by its label, a number or switch by its value) and
   * the notice says it is this page only.
   */
  const recordPageSorts = useMemo(
    () =>
      Object.fromEntries(
        fields.map((fieldId) => {
          const field = model.fields[fieldId]
          return [
            recordColumn(fieldId),
            (row: any) => {
              const value = row.values?.[fieldId]
              if (field?.type === 'reference') return referenceLabel(fieldId, value) || null
              if (typeof value === 'number' || typeof value === 'boolean') return value
              return field ? formatDatasetValue(field, value) || null : null
            },
          ]
        }),
      ),
    [fields, model, referenceLabel],
  )
  const recordSortHeaders = useMemo(
    () =>
      Object.fromEntries(
        fields.map((fieldId) => [recordColumn(fieldId), model.fields[fieldId]?.name ?? fieldId]),
      ),
    [fields, model],
  )
  const recordColumnSort = useListColumnSort<any>({
    sorts: NO_QUERY_SORTS,
    rows: records,
    pageSorts: recordPageSorts,
    headers: recordSortHeaders,
  })

  /**
   * The rail (AGL-4047): one tab per dataset, at the dataset's own address,
   * with a second line that tells two of one name apart. Past
   * {@link DATASET_RAIL_GROUP_AT} the tabs are grouped by who they are shared
   * with, and the organization page offers the Shared with filter.
   */
  const grouped = railDatasets.length > DATASET_RAIL_GROUP_AT
  const railSections = useMemo<HubSection[]>(() => {
    if (!basePath) return []
    const tab = (item: DatasetRailEntry, group?: string): HubSection => ({
      href: `${basePath}/${item.$id}`,
      label: datasetRailName(item),
      secondary: datasetRailSecondary(item, { hostNames, grouped }),
      ...(group ? { group } : {}),
    })
    if (!grouped) return railDatasets.map((item: DatasetRailEntry) => tab(item))
    return groupDatasetsBySharing(railDatasets, hostNames).flatMap((group) =>
      group.datasets.map((item) => tab(item, group.label)),
    )
  }, [basePath, railDatasets, hostNames, grouped])
  /** The join dialog's names, told apart where two match (AGL-4047). */
  const joinLabels = useMemo(() => datasetPickerLabelsOf(datasets, hostNames), [datasets, hostNames])
  const offerSharedWith =
    !pageHostId && orgSites.length > 1 && (datasets.length > DATASET_RAIL_GROUP_AT || Boolean(sharedWith))
  const sitesByName = useMemo(
    () => [...orgSites].sort((a, b) => (hostNames[a.$id] ?? '').localeCompare(hostNames[b.$id] ?? '')),
    [orgSites, hostNames],
  )
  const railHeader =
    datasets.length || nameSearch || sharedWith ? (
      <Stack spacing={1.5} sx={{ mb: 1 }}>
        <TextField
          size="small"
          fullWidth
          placeholder="Search datasets by name"
          value={nameSearch}
          onChange={(event) => setNameSearch(event.target.value)}
          slotProps={{ htmlInput: { 'aria-label': 'Search datasets by name' } }}
        />
        {offerSharedWith ? (
          <TextField
            select
            size="small"
            fullWidth
            label="Shared with"
            value={sharedWith}
            onChange={(event) => {
              setSharedWith(event.target.value)
              setRailWindow(DATASET_LIST_WINDOW)
            }}
          >
            <MenuItem value="">{'Any site'}</MenuItem>
            {sitesByName.map((site) => (
              <MenuItem key={site.$id} value={site.$id}>
                {hostNames[site.$id]}
              </MenuItem>
            ))}
          </TextField>
        ) : null}
      </Stack>
    ) : null
  const railFooter = (
    <>
      {listAnswered && datasets.length > 0 && railDatasets.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ px: 2, py: 1 }}>
          {moreDatasets ? 'None of the loaded datasets match.' : 'No datasets match.'}
        </Typography>
      ) : null}
      {moreDatasets ? (
        <Button size="small" sx={{ mt: 1 }} onClick={() => setRailWindow((window) => window + DATASET_LIST_WINDOW)}>
          {'Show more datasets'}
        </Button>
      ) : null}
    </>
  )

  /** The open dataset's facts, under its name. */
  const facts: Array<[string, string]> = selected
    ? [
        ['Shared with', datasetSharingLabel(selected, hostNames)],
        ['Fields', String(fields.length)],
        ['Records', blocked.records ? '--' : recordCount.toLocaleString()],
        ['Source', datasetSourceLabel(selected)],
        ['Created', datasetCreatedLabel(selected)],
      ]
    : []

  /** Label-over-value facts, under a heading. */
  const factsRow = (pairs: Array<[string, string]>) => (
    <Stack direction="row" spacing={3} useFlexGap sx={{ flexWrap: 'wrap', mt: 1 }}>
      {pairs.map(([label, value]) => (
        <Box key={label}>
          <Typography variant="caption" color="text.secondary" component="div">
            {label}
          </Typography>
          <Typography variant="body2" color="text.primary" component="div" sx={{ overflowWrap: 'anywhere' }}>
            {value}
          </Typography>
        </Box>
      ))}
    </Stack>
  )

  /**
   * A record's own page (AGL-4047): back to its dataset, its fields, and
   * today's record actions with today's gates. It takes the place of the View
   * record dialog where the Data page is routed.
   */
  const recordTitle = routeRecord ? datasetRecordTitle(model, routeRecord.values) : undefined
  const recordPanel =
    selected && routeRecordId ? (
      <CardDisplay
        help={pluginDocsHelp('datasets', { anchor: '#organization-data-page' })}
        header={
          <Stack spacing={1} sx={{ alignItems: 'flex-start' }}>
            {datasetHref ? (
              <Button
                size="small"
                component={AppLink}
                href={datasetHref}
                startIcon={<MdiIcon path={mdiArrowLeft.path} size={0.8} />}
              >
                {datasetRailName(selected)}
              </Button>
            ) : null}
            {recordTitle ? <span>{recordTitle}</span> : null}
          </Stack>
        }
        contentGutterX
        contentGutterY
        contentBordered="top"
        HeaderProps={{
          action: routeRecord ? (
            <Stack direction="row" spacing={1} useFlexGap sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
              <BlockedControl blocked={blocked.writes} reason={blocked.writesReason}>
                <Button size="small" onClick={handleOpenRecord(routeRecord)}>
                  {'Edit record'}
                </Button>
              </BlockedControl>
              <BlockedControl blocked={blocked.writes} reason={blocked.writesReason}>
                <Button
                  size="small"
                  color="error"
                  onClick={handleDeleteRecord(routeRecord, () => {
                    if (datasetHref) router.push(datasetHref)
                  })}
                >
                  {'Delete'}
                </Button>
              </BlockedControl>
            </Stack>
          ) : undefined,
          subheader: factsRow([
            ['Record ID', routeRecordId],
            ['Dataset', `${datasetRailName(selected)} · ${datasetSharingLabel(selected, hostNames)}`],
          ]),
        }}
      >
        <Stack spacing={1.5}>
          {blocked.records ? (
            <Typography variant="body2" color="text.secondary">
              {DATASETS_VIEW_RECORDS_REFUSAL}
            </Typography>
          ) : routeRecordMissing ? (
            <Alert severity="info">{'This record doesn’t exist, or you can’t open it.'}</Alert>
          ) : routeRecord ? (
            <DatasetRecordFieldList
              record={routeRecord}
              model={model}
              resolveReference={resolveReferenceLabel}
              divided
            />
          ) : null}
        </Stack>
      </CardDisplay>
    ) : null

  const panel = notSharedHere ? (
    <Alert severity="info">{'This dataset isn’t shared with this site.'}</Alert>
  ) : notFound ? (
    <Alert severity="info">{'This dataset doesn’t exist, or you can’t open it.'}</Alert>
  ) : recordPanel ? (
    recordPanel
  ) : !selected ? (
    listAnswered && datasets.length === 0 && !sharedWith ? (
      <CardDisplay contentGutterX contentGutterY>
        <Typography variant="body2" color="text.secondary">
          {'Create a dataset, like Products, then add a repeating section ' +
            'to any page to show one item per record.'}
        </Typography>
      </CardDisplay>
    ) : null
  ) : (
    <CardDisplay
      header={datasetRailName(selected)}
      help={pluginDocsHelp('datasets', { anchor: '#filter-records' })}
      contentGutterX
      contentGutterY
      contentBordered="top"
      HeaderProps={{
        action: (
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ alignItems: 'center', flexWrap: 'wrap', justifyContent: 'flex-end' }}
          >
            <BlockedControl blocked={blocked.writes} reason={blocked.writesReason}>
              <Button
                size="small"
                color="primary"
                onClick={handleOpenRecord()}
              >
                {'Add record'}
              </Button>
            </BlockedControl>
            <BlockedControl blocked={blocked.writes && !blocked.sharingOnly} reason={blocked.writesReason}>
              <Button size="small" onClick={() => setSchemaOpen(true)}>
                {'Schema'}
              </Button>
            </BlockedControl>
            {/* An import left unfinished, reopened where it stopped (AGL-3549). */}
            {transferTarget ? (
              <TransferResumeImport
                target={transferTarget}
                {...(selected ? { title: `Import into ${datasetDisplayName(selected)}` } : {})}
                onFinished={() => setRecordCountEpoch((epoch) => epoch + 1)}
              />
            ) : null}
            {/* Off with the permission named for a member known not to hold it,
                not hidden. Still absent while the answer is out, and where the
                launcher refuses for another reason than the key. */}
            {canImport || (transfer && transferTarget && blocked.writes) ? (
              <BlockedControl blocked={!canImport} reason={blocked.writesReason}>
                <Button size="small" onClick={handleImport}>
                  {'Import'}
                </Button>
              </BlockedControl>
            ) : null}
            {/* The real dataset size, not the loaded window (AGL-2335) —
                the export is a server stream, so a dataset whose first page
                has not landed yet is still exportable. */}
            {(canExport && (recordCount || records.length)) || (transfer && blocked.exports) ? (
              <BlockedControl blocked={blocked.exports} reason={DATASETS_EXPORT_REFUSAL}>
                <Button size="small" onClick={handleExport}>
                  {'Export'}
                </Button>
              </BlockedControl>
            ) : null}
            <BlockedControl blocked={blocked.deletes} reason={blocked.deletesReason}>
              <Button size="small" color="error" onClick={handleDeleteDataset}>
                {'Delete'}
              </Button>
            </BlockedControl>
          </Stack>
        ),
        subheader: factsRow(facts),
      }}
    >
      <Stack spacing={1.5}>
        {/* The per-dataset record cap, standing rather than only on refusal
            (AGL-2113). `recordCount` is the dataset's real size — the same
            number `handleOpenRecord` and the importer hand to `checkQuota`,
            not the loaded window (AGL-1716). */}
        {selected ? (
          <QuotaReadoutComponent
            ready={org != null}
            used={recordCount}
            limit={checkQuota(org, 'recordsPerDataset', recordCount).limit}
            noun="record"
          />
        ) : null}
        {selected && blocked.records ? (
          <Typography variant="body2" color="text.secondary">
            {DATASETS_VIEW_RECORDS_REFUSAL}
          </Typography>
        ) : selected && (records.length > 0 || recordPage > 0 || filteringRecords) ? (
          <>
          <ListFilterChips
            fields={recordFilter.fields}
            headers={recordFilter.headers}
            clauses={recordClauses}
            onChange={gridFilter.setClauses}
            options={recordFilter.options}
          />
          <ListQueryNotices
            refused={recordRefusals}
            notices={[...recordPlan.notices, ...recordColumnSort.notices]}
          />
          <ListTable
            aria-label="Records"
            // Edit and Delete stay in reach when the columns scroll sideways
            // in the panel beside the rail (AGL-4047).
            pinActions
            rows={recordColumnSort.rows}
            columnSort={recordColumnSort}
            columns={recordGridColumns}
            onOpen={(id) => openRecord(id)}
            // One page of the walk, turned by the footer below: the grid
            // neither slices nor filters it.
            hideFooter
            filterMode="server"
            filterModel={gridFilter.filterModel}
            onFilterModelChange={gridFilter.onFilterModelChange}
            quickFilter
            {...(blocked.exports ? { slotProps: EXPORT_OFF_TOOLBAR } : {})}
            noRowsLabel={
              filteringRecords ? 'No records match these filters' : 'No records yet.'
            }
          />
          {/* The count line is the PAGE's, deliberately. `recordCount` is the
              dataset's real size and it already has its own readout above —
              handing it to the footer as `count` would tell MUI the walk is
              that long and leave Next live past the end of it whenever a rule,
              a scope or a filter has narrowed what this reader may list.
              `hasMore` is a fact from the probe row, so the footer answers
              for what it is actually paging. */}
          <ListPagination
            page={recordPage}
            pageSize={recordPageSize}
            rowCount={records.length}
            hasMore={hasMoreRecords}
            onPageChange={setRecordPage}
            onPageSizeChange={setRecordPageSize}
          />
          </>
        ) : selected ? (
          <Typography variant="body2" color="text.secondary">
            {'No records yet.'}
          </Typography>
        ) : null}
      </Stack>
    </CardDisplay>
  )

  return (
    <>
      {/* The page's own actions, in the page header beside its title. */}
      <PageHeaderActions>
        <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
          <BlockedControl blocked={blocked.creates} reason={DATASETS_WRITE_REFUSAL}>
            <Button variant="outlined" color="primary" onClick={handleOpenCreator}>
              {'Add dataset'}
            </Button>
          </BlockedControl>
          {datasets.length >= 2 ? (
            <BlockedControl blocked={blocked.creates} reason={DATASETS_WRITE_REFUSAL}>
              <Button onClick={() => setJoiner({ a: '', b: '' })}>{'Add join collection'}</Button>
            </BlockedControl>
          ) : null}
        </Stack>
      </PageHeaderActions>
      {/* The open dataset ends the trail; the heading stays the page's. */}
      {/* On a record's page the trail runs dataset, linked, then record. */}
      {routeRecordId && selected && datasetHref ? (
        <PageHeaderRecord
          title={recordTitle}
          keepHeading
          parentTitle={datasetRailName(selected)}
          parentHref={datasetHref}
        />
      ) : (
        <PageHeaderRecord title={selected && routeDatasetId ? datasetRailName(selected) : undefined} keepHeading />
      )}
      <HubSections
        sections={railSections}
        navHeader="Datasets"
        railHeader={railHeader}
        railFooter={railFooter}
        scrollRail
      >
        {panel}
      </HubSections>
      <Dialog
        open={Boolean(creator)}
        onClose={() => setCreator(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'New dataset'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          {orgId ? (
            <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
              {/* Ownership and visibility are separate facts (AGL-1044), and
                  what a new dataset starts on depends on where it is made. */}
              {newDatasetSharingNote(createsSiteOnly)}
            </Typography>
          ) : null}
          <TextField
            label="Name"
            value={creator?.name ?? ''}
            onChange={(event) =>
              setCreator((prev) =>
                prev ? { ...prev, name: event.target.value } : prev,
              )
            }
            size="small"
            autoFocus
            sx={{ mt: 1 }}
            helperText="e.g. Products, Team, FAQ"
          />
          <TextField
            label="Fields"
            value={creator?.fields ?? ''}
            onChange={(event) =>
              setCreator((prev) =>
                prev ? { ...prev, fields: event.target.value } : prev,
              )
            }
            size="small"
            helperText={
              creatorEntries.length
                ? `Columns: ${creatorEntries
                    .map((entry) => entry.name)
                    .join(', ')}`
                : 'Comma-separated column names, e.g. Title, Unit price'
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setCreator(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              !scopeReady ||
              !creator?.name.trim() ||
              creatorFields.length === 0
            }
            onClick={handleCreate}
          >
            {'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      {/*
        ONE viewer for the table, not one per row. Its record is a prop out of
        the page already in hand, so opening it reads nothing — and mounting
        the table does not open a dialog per row to discover that.
      */}
      <DatasetRecordDialog
        record={viewerRecord}
        model={model}
        resolveReference={resolveReferenceLabel}
        onClose={() => setViewerId(null)}
        // Explicitly separate, and a hand-off rather than a second editor:
        // the viewer closes and the record opens in the dialog that has
        // always owned writing.
        onEdit={() => {
          const record = viewerRecord
          setViewerId(null)
          if (record) handleOpenRecord(record)()
        }}
      />
      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{editor?.id ? 'Edit record' : 'New record'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          {editor?.sample ? <Alert severity="info">{DATASET_SAMPLE_RECORD_NOTE}</Alert> : null}
          <DatasetRecordSiteContext.Provider value={recordSite}>
          {fields.map((fieldId, index) => {
            const field = model.fields[fieldId]
            if (!field) return null
            const value = editor?.values[fieldId] ?? ''
            const error = editor?.errors[fieldId]
            const label = field.required ? `${field.name} *` : field.name
            const setValue = (nextValue: string) =>
              setEditor((prev) =>
                prev
                  ? {
                      ...prev,
                      values: { ...prev.values, [fieldId]: nextValue },
                      errors: { ...prev.errors, [fieldId]: '' },
                    }
                  : prev,
              )
            const common = {
              label,
              value,
              size: 'small' as const,
              autoFocus: index === 0,
              error: Boolean(error),
              helperText: error || field.description,
              sx: index === 0 ? { mt: 1 } : undefined,
              onChange: (event: { target: { value: string } }) =>
                setValue(event.target.value),
            }
            // Custom field types (AGL-434): the declaring plugin's Input
            // takes over; values stay in input form (strings) so the
            // existing coerce/validate pipeline is unchanged.
            const customFieldType = getCustomFieldType(field.customType)
            if (customFieldType?.Input) {
              const CustomInput = customFieldType.Input
              return (
                <Stack key={fieldId} sx={index === 0 ? { mt: 1 } : undefined}>
                  <CustomInput
                    value={value}
                    label={common.label}
                    onChange={(next) => setValue(String(next ?? ''))}
                  />
                  {(error || field.description) ? (
                    <Typography
                      variant="caption"
                      color={error ? 'error' : 'text.secondary'}
                    >
                      {error || field.description}
                    </Typography>
                  ) : null}
                </Stack>
              )
            }
            // Typed inputs per FT.Tag (AGL-179).
            if (field.type === 'bool') {
              return (
                <TextField key={fieldId} {...common} select>
                  <MenuItem value="">{'—'}</MenuItem>
                  <MenuItem value="true">{'Yes'}</MenuItem>
                  <MenuItem value="false">{'No'}</MenuItem>
                </TextField>
              )
            }
            if (field.type === 'text' && field.validation?.options?.length) {
              return (
                <TextField key={fieldId} {...common} select>
                  <MenuItem value="">{'—'}</MenuItem>
                  {field.validation.options.map((option) => (
                    <MenuItem key={option} value={option}>
                      {option}
                    </MenuItem>
                  ))}
                </TextField>
              )
            }
            if (field.type === 'reference') {
              const options = refOptions[fieldId] ?? []
              const multiple = Boolean(field.reference?.multiple)
              const selectedIds = value
                .split(',')
                .map((part) => part.trim())
                .filter(Boolean)
              return (
                <TextField
                  key={fieldId}
                  {...common}
                  select
                  value={multiple ? selectedIds : value}
                  slotProps={{
                    select: multiple
                      ? {
                          multiple: true,
                          onChange: (event: any) =>
                            setValue(
                              (event.target.value as string[]).join(', '),
                            ),
                        }
                      : undefined,
                  }}
                >
                  {multiple ? null : <MenuItem value="">{'—'}</MenuItem>}
                  {options.map((option) => (
                    <MenuItem key={option.id} value={option.id}>
                      {option.label}
                    </MenuItem>
                  ))}
                </TextField>
              )
            }
            if (
              field.type === 'int32' ||
              field.type === 'int64' ||
              field.type === 'float'
            ) {
              return <TextField key={fieldId} {...common} type="number" />
            }
            if (field.type === 'timestamp') {
              return (
                <TextField
                  key={fieldId}
                  {...common}
                  type="datetime-local"
                  slotProps={{ inputLabel: { shrink: true } }}
                />
              )
            }
            if (field.type === 'coordinates') {
              return (
                <TextField
                  key={fieldId}
                  {...common}
                  helperText={error || field.description || 'lat, lon'}
                />
              )
            }
            if (field.type === 'sorted') {
              return (
                <TextField
                  key={fieldId}
                  {...common}
                  helperText={
                    error || field.description || 'Comma-separated list'
                  }
                />
              )
            }
            return <TextField key={fieldId} {...common} />
          })}
          </DatasetRecordSiteContext.Provider>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setEditor(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            onClick={handleSaveRecord}
          >
            {editor?.id ? 'Save' : 'Add'}
          </Button>
        </DialogActions>
      </Dialog>
      <Dialog
        open={Boolean(joiner)}
        onClose={() => setJoiner(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>{'New join collection'}</DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 2 }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ mt: 1 }}>
            {'Links two collections many-to-many; each row pairs one ' +
              'document from each side.'}
          </Typography>
          {(['a', 'b'] as const).map((side) => (
            <TextField
              key={side}
              select
              size="small"
              label={side === 'a' ? 'First collection' : 'Second collection'}
              value={joiner?.[side] ?? ''}
              onChange={(event) =>
                setJoiner((prev) =>
                  prev ? { ...prev, [side]: event.target.value } : prev,
                )
              }
            >
              {datasets.map((item) => (
                <MenuItem key={item.$id} value={item.$id}>
                  {/* Who it is shared with only where two share a name (AGL-4047). */}
                  {joinLabels[item.$id]}
                </MenuItem>
              ))}
            </TextField>
          ))}
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setJoiner(null)}>{'Cancel'}</Button>
          <Button
            variant="contained"
            color="primary"
            disabled={
              !scopeReady || !joiner?.a || !joiner?.b || joiner.a === joiner.b
            }
            onClick={handleCreateJoin}
          >
            {'Create'}
          </Button>
        </DialogActions>
      </Dialog>
      <DatasetSchemaDialog
        hostId={hostId}
        orgId={orgId ?? undefined}
        dataset={schemaOpen && selected ? selected : null}
        datasets={knownDatasets}
        // The dataset's documents, not the loaded window (AGL-1716) — the
        // dialog warns "N documents exist" before a narrowing type change,
        // and 500 was the cap talking, not the collection.
        recordCount={recordCount}
        seedFromCache={seed.fromCache}
        seedUnreadable={seed.unreadable}
        seedListen={seed.listen}
        canChangeSharing={!blocked.creates}
        {...(blocked.sharingOnly ? { sharingOnlyReason: blocked.writesReason } : {})}
        onClose={() => setSchemaOpen(false)}
      />
    </>
  )
}
HostDatasetsCard.displayName = 'HostDatasetsCard'

export default HostDatasetsCard
