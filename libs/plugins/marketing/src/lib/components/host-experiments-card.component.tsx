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
  type AglynOrgBilling,
  checkEntitlement,
  createResourceUid,
  HOST_EVENT_TYPES,
  isScreenGroup,
  pluginDocsHelp,
  SITE_EVENT_TYPES,
} from '@aglyn/aglyn'
import { nameSearchFields } from '@aglyn/aglyn/app-utils/name-search'
import { describeVariantComparison, experimentResultRows, validateExperiment, type ExperimentTarget, type ExperimentVariant, type HostExperiment } from '../model'
import { EXPERIMENT_LIST_QUERY } from '../model/experiment-list-query'
import {
  mdiChartBar,
  mdiDeleteOutline,
  mdiPause,
  mdiPencilOutline,
  mdiPlay,
} from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon, useConfirmationContext } from '@aglyn/shared-ui-jsx'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import type { ListQuerySort } from '@aglyn/shared-ui-jsx/const/list-query-plan'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { Timestamp } from '@aglyn/shared-util-timestamp'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  MenuItem,
  Stack,
  Switch,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  doc,
  getDocs,
  limit,
  query,
  where,
} from 'firebase/firestore'
import { useMemo, useState } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
  useHostActivityLogger,
  writeGuardedBySeed,
  useUser,
} from '@aglyn/tenant-feature-instance'
import { writeSiteWideChange } from '@aglyn/tenant-feature-instance/hooks/helpers/site-wide-change'
import { useListQuery } from '@aglyn/tenant-feature-instance/hooks/use-list-query'
import {
  ExperimentResultZone,
  ExperimentVariantsZone,
  marketingExperimentVariantDrafts,
  type MarketingExperimentVariantDraft,
} from './experiment-zones'

export interface HostExperimentsCardProps {
  hostId: string
  /** Resolved entitlement source (AGL-395). */
  org?: Partial<AglynOrgBilling>
}

type ExperimentDraft = HostExperiment & { $id?: string }

/** An experiment's status as a chip color, in every list of experiments. */
export const EXPERIMENT_STATUS_COLORS: Record<
  string,
  'default' | 'success' | 'info' | 'warning'
> = {
  draft: 'default',
  running: 'success',
  paused: 'warning',
  done: 'info',
}

/*
 * What the experiments grid's Filters panel offers: the fields of the list's
 * query declaration (`EXPERIMENT_LIST_QUERY`), every one served by Firestore
 * (AGL-3321).
 */
const EXPERIMENT_FILTER_FIELDS = EXPERIMENT_LIST_QUERY.fields
const EXPERIMENT_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Experiment',
  target: 'Tests',
  status: 'Status',
}
/** What each stored `target` reads as; the stored value stays `screen`. */
const EXPERIMENT_TARGET_NOUNS: Readonly<Record<string, string>> = {
  screen: 'page',
  section: 'section',
  email: 'email',
}
const EXPERIMENT_FILTER_OPTIONS = {
  target: [
    { value: 'screen', label: 'Page' },
    { value: 'section', label: 'Section' },
    { value: 'email', label: 'Email' },
  ],
  status: Object.keys(EXPERIMENT_STATUS_COLORS).map((status) => ({
    value: status,
    label: status.charAt(0).toUpperCase() + status.slice(1),
  })),
}

/** Tests is drawn from the target and the variant count: it sorts the page (AGL-3680). */
const EXPERIMENT_PAGE_SORTS = {
  target: (experiment: ExperimentDraft) =>
    `${EXPERIMENT_TARGET_NOUNS[experiment.target] ?? experiment.target} ${(experiment.variants ?? []).length}`,
}
const EXPERIMENT_PAGE_SORT_HEADERS = { target: 'Tests' }

/**
 * Experiments manager (AGL-252): create screen/section/email A/B tests
 * with weighted variants and a conversion goal; start/pause/finish them
 * and read exposures/conversions per variant. Business tier
 * (`ab-testing`).
 */
export function HostExperimentsCard(props: HostExperimentsCardProps) {
  const { hostId } = props
  const firestore = useFirestore()
  const { data: user } = useUser()
  const { org } = props
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  const logActivity = useHostActivityLogger(hostId)
  const entitled = checkEntitlement(org, 'abTesting')

  /*
   * The Filters panel and the search box are the grid's; the clauses and the
   * words go onto ONE query over the site's experiments, ordered by name, and
   * each page is a page of that query's matches (AGL-3321). A clause the
   * query cannot hold beside the others is not applied, and the notice above
   * the list says which and why — never answered over the experiments that
   * happen to be loaded.
   */
  const gridFilter = useListGridFilter({ selectFields: ['target', 'status'] })
  // Experiment and Status order the query, Tests the page (AGL-3680).
  const [askedSort, setAskedSort] = useState<ListQuerySort | null>(null)
  const filtering =
    gridFilter.clauses.length > 0 || gridFilter.searchWords.some((word) => word.trim())
  const {
    rows: experimentRows,
    hasMore: hasMoreExperiments,
    page: experimentPage,
    setPage: setExperimentPage,
    pageSize: experimentPageSize,
    setPageSize: setExperimentPageSize,
    status: experimentsStatus,
    /**
     * The rows this editor is seeded from are unconfirmed by the server
     * (AGL-1358). Editing spreads a whole stored experiment into `editor`
     * and writes all of it back, so `merge: true` protects nothing — every
     * field is in the payload. `status` is the one that bites: it is
     * otherwise only ever moved by the start/pause/finish controls below, so
     * a cached seed can quietly restart a finished test, or stop a running
     * one, along with reverting its variant weights and goal.
     */
    fromCache: experimentsFromCache,
    plan: experimentPlan,
  } = useListQuery<ExperimentDraft>({
    collection: collection(firestore, 'hosts', hostId, 'experiments'),
    /*
     * Ordered by the server and paged (AGL-2501, AGL-2292): the declaration's
     * one order is `name`, which every writer sets — the editor refuses a save
     * without one (`validateExperiment`), the besigner's section shortcut
     * names its draft, the two send-path readers only ever write the stats
     * beneath an experiment, and `experiments` is not in `IMPORTABLE_FIELDS`.
     * There is no writer that can produce a nameless experiment for `orderBy`
     * to drop.
     *
     * Nothing is dropped after the query either. An experiment is never
     * soft-deleted — Delete below is a `deleteDoc` — so every row the query
     * returns is live, and a page holds as many rows as its size.
     */
    declaration: EXPERIMENT_LIST_QUERY,
    request: { clauses: gridFilter.clauses, search: gridFilter.searchWords, sort: askedSort },
    deps: [firestore, hostId],
    idField: '$id',
  })
  const experimentSort = useListColumnSort<ExperimentDraft>({
    sorts: EXPERIMENT_LIST_QUERY.sorts,
    defaultSort: EXPERIMENT_LIST_QUERY.sorts[0],
    sort: askedSort,
    onSortChange: setAskedSort,
    orderBy: experimentPlan.orderBy,
    rows: experimentRows,
    pageSorts: EXPERIMENT_PAGE_SORTS,
    headers: EXPERIMENT_PAGE_SORT_HEADERS,
  })
  const experiments: ExperimentDraft[] = experimentSort.rows as ExperimentDraft[]
  const experimentColumnsFor = (columns: GridColDef[]) =>
    listFilterGridColumns(
      columns,
      EXPERIMENT_FILTER_FIELDS,
      EXPERIMENT_FILTER_OPTIONS,
      EXPERIMENT_FILTER_HEADERS,
    )
  const experimentRefusals = useMemo(
    () =>
      listQueryRefusals(experimentPlan.refused, {
        fields: EXPERIMENT_FILTER_FIELDS,
        headers: EXPERIMENT_FILTER_HEADERS,
        options: EXPERIMENT_FILTER_OPTIONS,
      }),
    [experimentPlan.refused],
  )
  const [editor, setEditor] = useState<ExperimentDraft | null>(null)
  /*
   * The screens and their versions fill the EDITOR's pickers and nothing
   * else on the card, so they are read while the editor is open and not
   * before: a reader who came to see which tests are running pays for the
   * experiments list alone, not for a hundred screens they never pick from.
   */
  const editorOpen = editor !== null
  const { data: screenDocs } = useFirestoreCollection<any>(
    () =>
      editorOpen
        ? query(collection(firestore, 'hosts', hostId, 'screens'), limit(100))
        : null,
    [firestore, hostId, editorOpen],
    { idField: '$id' },
  )
  // A page group (AGL-3463) has no versions to test against each other.
  const screenOptions = [...(screenDocs ?? [])]
    .filter((screen: any) => !screen.deletedAt && !isScreenGroup(screen))
    .map((screen: any) => ({
      id: screen.$id as string,
      name: (screen.displayName ?? screen.name ?? screen.$id) as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))

  // Versions of the screen under test (AGL-253): variants pin one each.
  const { data: versionDocs } = useFirestoreCollection<any>(
    () =>
      editor?.screenId
        ? query(
            collection(
              firestore,
              'hosts',
              hostId,
              'screens',
              editor.screenId,
              'versions',
            ),
            limit(50),
          )
        : null,
    [firestore, hostId, editor?.screenId],
    { idField: '$id' },
  )
  const versionOptions = [...(versionDocs ?? [])]
    .filter((version: any) => !version.deletedAt)
    .map((version: any) => ({
      id: version.$id as string,
      name: (version.name ?? version.displayName ?? version.$id) as string,
    }))
    .sort((a, b) => a.name.localeCompare(b.name))
  const [results, setResults] = useState<{
    experiment: ExperimentDraft
    stats: Record<string, { exposures?: number; conversions?: number }>
  } | null>(null)

  const patch = (partial: Partial<ExperimentDraft>) =>
    setEditor((previous) =>
      previous ? { ...previous, ...partial } : previous,
    )
  /**
   * What a widget in the variants zone proposes, put into the editor's own
   * fields as unsaved changes. Only the variants the editor already holds are
   * filled, in order: the test's shape — how many arms, their ids, their
   * weights, the version each screen variant pins — is the person's, and a
   * proposal that could add or drop an arm would be changing the test rather
   * than writing copy for it. A field a widget left empty is left alone, so
   * a proposal for an email's subject does not blank a body someone typed.
   */
  const proposeVariants = (
    proposed: readonly MarketingExperimentVariantDraft[],
  ) =>
    setEditor((previous) =>
      previous
        ? {
            ...previous,
            variants: previous.variants.map((variant, index) => {
              const draft = proposed[index]
              if (!draft) return variant
              return {
                ...variant,
                ...(draft.name ? { name: draft.name } : {}),
                ...(draft.subject ? { subject: draft.subject } : {}),
                ...(draft.body ? { body: draft.body } : {}),
                // A draft version a widget made for this variant (AGL-3603),
                // pinned unsaved like a version picked from the list.
                ...(draft.versionId && previous.target !== 'email' ? { versionId: draft.versionId } : {}),
              }
            }),
          }
        : previous,
    )
  const patchVariant = (index: number, partial: Partial<ExperimentVariant>) =>
    setEditor((previous) =>
      previous
        ? {
            ...previous,
            variants: previous.variants.map((variant, index2) =>
              index2 === index ? { ...variant, ...partial } : variant,
            ),
          }
        : previous,
    )

  const newExperiment = (): ExperimentDraft => ({
    name: '',
    status: 'draft',
    target: 'screen' as ExperimentTarget,
    variants: [
      { id: 'a', name: 'A (control)', weight: 1 },
      { id: 'b', name: 'B', weight: 1 },
    ],
    goal: { event: 'formSubmission' },
  })

  const handleSave = async () => {
    if (!editor) return
    const problem = validateExperiment(editor)
    if (problem) {
      return void enqueueSnackbar(problem, {
        variant: 'warning',
        persist: false,
      })
    }
    const id = editor.$id ?? createResourceUid()
    const { $id: _ignored, ...payload } = editor
    try {
      /**
       * Refuse an EDIT whose seed the server never confirmed (AGL-1358).
       *
       * `merge: true` is here so a cleared end date or auto-winner overwrites
       * (AGL-273), not to protect untouched fields — there are none, because
       * the payload is the whole stored row spread into `editor`. `status`
       * and `winnerVariantId` ride along with it, and those are otherwise
       * only moved by `setStatus`, so a cached seed can restart a test the
       * owner finished or halt one that is splitting live traffic.
       *
       * Only the edit path. A NEW experiment comes from `newExperiment()` at
       * a fresh uid and can overwrite nothing, and the first snapshot of any
       * listener is `fromCache: true`, so guarding a create would refuse a
       * save that was never unsafe.
       *
       * The guard WRAPS the write, and the activity log with it: a logged
       * "Updated experiment" whose write never happened leaves the history
       * disagreeing with the experiment it claims to explain.
       */
      const verdict = await writeGuardedBySeed(
        {
          subject: 'experiment',
          unreadable: Boolean(editor.$id) && experimentsStatus === 'error',
          fromCache: Boolean(editor.$id) && experimentsFromCache,
        },
        async () => {
          await writeSiteWideChange({
            firestore,
            user,
            hostId,
            write: (batch) =>
              batch.set(
                doc(firestore, 'hosts', hostId, 'experiments', id),
                {
                  ...JSON.parse(JSON.stringify(payload)),
                  /*
                   * The name's search keys, from the name being written — the
                   * list's Experiment filter and its search box read them
                   * (AGL-3321). After the payload, so keys copied from the stored
                   * row cannot outlive a rename.
                   */
                  ...nameSearchFields(editor.name ?? ''),
                  // Clearing the end date / auto-winner must overwrite — a
                  // merge-set keeps absent keys otherwise (AGL-273).
                  endAtMs: editor.endAtMs ?? null,
                  autoWinner: editor.autoWinner ?? null,
                  updatedAt: Timestamp.now(),
                  ...(editor.$id ? {} : { createdAt: Timestamp.now() }),
                },
                { merge: true },
              ),
          })
          logActivity(
            editor.$id ? 'Updated experiment' : 'Created experiment',
            { type: 'content', id, name: editor.name },
          )
        },
      )
      // A refusal keeps the editor open with everything that was typed.
      if (!verdict.ok) {
        return void enqueueSnackbar(verdict.message, {
          variant: 'warning',
          persist: false,
        })
      }
      enqueueSnackbar('Experiment saved', {
        variant: 'success',
        persist: false,
      })
      setEditor(null)
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', { variant: 'error' })
    }
  }

  const setStatus = async (
    experiment: ExperimentDraft,
    status: HostExperiment['status'],
    winnerVariantId?: string,
  ) => {
    if (!experiment.$id) return
    /*
     * One running experiment per screen (AGL-265): the page runner only
     * serves the first, so a second would silently never split traffic.
     *
     * Asked of Firestore, not of the rows on screen: the list is one page of
     * a query the reader may have narrowed, and the running test on the same
     * screen is as likely to be on another page, or filtered out, as on this
     * one. Two equalities, served by merging their single-field indexes.
     */
    if (status === 'running' && experiment.screenId) {
      const running = await getDocs(
        query(
          collection(firestore, 'hosts', hostId, 'experiments'),
          where('status', '==', 'running'),
          where('screenId', '==', experiment.screenId),
          limit(2),
        ),
      )
      const clash = running.docs
        .map((entry) => ({ ...(entry.data() as HostExperiment), $id: entry.id }))
        .find((candidate) => candidate.$id !== experiment.$id)
      if (clash) {
        return void enqueueSnackbar(
          `"${clash.name}" is already running on that page — pause or ` +
            'finish it first',
          { variant: 'warning', persist: false },
        )
      }
    }
    await writeSiteWideChange({
      firestore,
      user,
      hostId,
      write: (batch) =>
        batch.set(
          doc(firestore, 'hosts', hostId, 'experiments', experiment.$id),
          {
            status,
            ...(winnerVariantId ? { winnerVariantId } : {}),
            updatedAt: Timestamp.now(),
          },
          { merge: true },
        ),
    })
    logActivity(`Experiment ${status}`, {
      type: 'content',
      id: experiment.$id,
      name: experiment.name,
    })
  }

  const handleDelete = async (experiment: ExperimentDraft) => {
    if (!experiment.$id) return
    const accepted = await confirm({
      title: 'Delete experiment?',
      description: `"${experiment.name}" and its results are removed.`,
      confirmationText: 'Delete',
      confirmationButtonProps: { color: 'error' },
    })
      // Resolves with no value and rejects on cancel — gating on the
      // resolved value alone made this always return (AGL-950).
      .then(() => true)
      .catch(() => false)
    if (!accepted) return
    await writeSiteWideChange({
      firestore,
      user,
      hostId,
      write: (batch) =>
        batch.delete(
          doc(firestore, 'hosts', hostId, 'experiments', experiment.$id),
        ),
    })
  }

  const openResults = async (experiment: ExperimentDraft) => {
    if (!experiment.$id) return
    const snapshot = await getDocs(
      collection(
        firestore,
        'hosts',
        hostId,
        'experiments',
        experiment.$id,
        'stats',
      ),
    )
    const stats: Record<string, any> = {}
    snapshot.forEach((entry) => {
      stats[entry.id] = entry.data()
    })
    setResults({ experiment, stats })
  }

  /*
   * One row per experiment. The row opens its results, the one thing every
   * experiment has to show; starting, pausing, editing and deleting it are in
   * the row's menu rather than a row of buttons one mis-click from each other.
   */
  const experimentActions = (experiment: ExperimentDraft): RowActionsMenuItem[] => [
    ...(experiment.status === 'running'
      ? [
          {
            key: 'pause',
            label: 'Pause',
            icon: <MdiIcon path={mdiPause.path} size={0.8} />,
            onClick: () => void setStatus(experiment, 'paused'),
          },
        ]
      : experiment.status !== 'done'
        ? [
            {
              key: 'start',
              label: 'Start',
              icon: <MdiIcon path={mdiPlay.path} size={0.8} />,
              onClick: () => void setStatus(experiment, 'running'),
            },
          ]
        : []),
    {
      key: 'edit',
      label: 'Edit',
      icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
      onClick: () => setEditor({ ...experiment }),
    },
    {
      key: 'delete',
      label: 'Delete',
      icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
      destructive: true,
      onClick: () => void handleDelete(experiment),
    },
  ]
  const experimentColumns: GridColDef<ExperimentDraft>[] = [
    { field: 'name', headerName: 'Experiment', flex: 1, minWidth: 200 },
    {
      field: 'target',
      headerName: 'Tests',
      flex: 1,
      minWidth: 200,
      valueGetter: (_value, experiment) =>
        `${EXPERIMENT_TARGET_NOUNS[experiment.target] ?? experiment.target} · ${(experiment.variants ?? []).length} variants`,
    },
    {
      field: 'status',
      headerName: 'Status',
      width: 130,
      renderCell: ({ row: experiment }) => (
        <Chip
          size="small"
          color={EXPERIMENT_STATUS_COLORS[experiment.status] ?? 'default'}
          label={experiment.status}
        />
      ),
    },
    listActionsColumn(
      (experiment: ExperimentDraft) => (
        <ListRowActions
          label={experiment.name || 'this experiment'}
          quick={{
            icon: mdiChartBar.path,
            label: 'Results',
            onClick: () => void openResults(experiment),
          }}
          items={experimentActions(experiment)}
        />
      ),
    ),
  ]

  return (
    <CardDisplay
      header="Experiments"
      help={pluginDocsHelp('emailCampaigns', { anchor: '#experiments' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {!entitled ? (
        <Alert severity="info">
          {'A/B experiments are included in the Business plan — see ' +
            'Billing to upgrade.'}
        </Alert>
      ) : (
        <Stack spacing={1.5}>
          <Typography variant="body2" color="text.secondary">
            {'Split traffic between variants of a page, a section, or a ' +
              'campaign email, and measure which one converts. Visitors ' +
              'are assigned deterministically, so everyone keeps seeing ' +
              'the same variant.'}
          </Typography>
          <Button
            size="small"
            variant="contained"
            color="primary"
            sx={{ alignSelf: 'flex-start' }}
            onClick={() => setEditor(newExperiment())}
          >
            {'New experiment'}
          </Button>
          {experiments.length === 0 && !hasMoreExperiments && experimentPage === 0 && !filtering ? null : (
            <>
            <ListFilterChips
              fields={EXPERIMENT_FILTER_FIELDS}
              headers={EXPERIMENT_FILTER_HEADERS}
              clauses={gridFilter.clauses}
              onChange={gridFilter.setClauses}
              options={EXPERIMENT_FILTER_OPTIONS}
            />
            <ListQueryNotices
              refused={experimentRefusals}
              notices={[...experimentPlan.notices, ...experimentSort.notices]}
            />
            <ListTable
              aria-label="Experiments"
              rows={experiments}
              columns={experimentColumnsFor(experimentColumns as GridColDef[])}
              rowHeight={TABLE_ROW_HEIGHT}
              onOpen={(_id, experiment) => void openResults(experiment)}
              // Paged by the footer below, so the grid must not also slice.
              hideFooter
              // Experiment and Status order the query; Tests sorts the page
              // and says so (AGL-3680).
              columnSort={experimentSort}
              /*
               * The panel and the search are the grid's; every clause and the
               * search word are on the list's query (AGL-3321), so the grid
               * never narrows the page it is handed.
               */
              filterMode="server"
              filterModel={gridFilter.filterModel}
              onFilterModelChange={gridFilter.onFilterModelChange}
              quickFilter
              noRowsLabel="No experiments match these filters"
            />
            <ListPagination
              page={experimentPage}
              pageSize={experimentPageSize}
              rowCount={experiments.length}
              hasMore={hasMoreExperiments}
              onPageChange={setExperimentPage}
              onPageSizeChange={setExperimentPageSize}
            />
            </>
          )}
        </Stack>
      )}

      <Dialog
        open={Boolean(editor)}
        onClose={() => setEditor(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>
          {editor?.$id ? 'Edit experiment' : 'New experiment'}
        </DialogTitle>
        <DialogContent
          sx={{ display: 'flex', flexDirection: 'column', gap: 1.5, pt: 1 }}
        >
          <TextField
            size="small"
            label="Name"
            required
            value={editor?.name ?? ''}
            onChange={(event) => patch({ name: event.target.value })}
            sx={{ mt: 1 }}
          />
          <Stack direction="row" spacing={1}>
            <TextField
              select
              size="small"
              label="Tests"
              value={editor?.target ?? 'screen'}
              onChange={(event) =>
                patch({ target: event.target.value as ExperimentTarget })
              }
              sx={{ minWidth: 140 }}
            >
              <MenuItem value="screen">{'A page'}</MenuItem>
              <MenuItem value="section">{'A section'}</MenuItem>
              <MenuItem value="email">{'An email'}</MenuItem>
            </TextField>
            {editor?.target !== 'email' ? (
              <TextField
                select
                size="small"
                label="Page"
                value={editor?.screenId ?? ''}
                onChange={(event) => patch({ screenId: event.target.value })}
                sx={{ flex: 1 }}
              >
                {screenOptions.map((option) => (
                  <MenuItem key={option.id} value={option.id}>
                    {option.name}
                  </MenuItem>
                ))}
              </TextField>
            ) : null}
          </Stack>
          {editor?.target === 'section' ? (
            <TextField
              size="small"
              label="Element id"
              helperText="The canvas element the variants swap (from the besigner)"
              value={editor?.nodeId ?? ''}
              onChange={(event) => patch({ nodeId: event.target.value })}
            />
          ) : null}
          <TextField
            select
            size="small"
            label="Conversion goal"
            value={editor?.goal?.event ?? 'formSubmission'}
            onChange={(event) =>
              patch({ goal: { ...editor?.goal, event: event.target.value } })
            }
            sx={{ maxWidth: 260 }}
          >
            {[...HOST_EVENT_TYPES, ...SITE_EVENT_TYPES].map((eventType) => (
              <MenuItem key={eventType} value={eventType}>
                {eventType}
              </MenuItem>
            ))}
          </TextField>
          {/* Schedule + auto-winner (AGL-273). */}
          <Stack
            useFlexGap
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            <TextField
              size="small"
              type="datetime-local"
              label="Ends at (optional)"
              slotProps={{ inputLabel: { shrink: true } }}
              value={
                editor?.endAtMs
                  ? new Date(
                      editor.endAtMs -
                        new Date().getTimezoneOffset() * 60000,
                    )
                      .toISOString()
                      .slice(0, 16)
                  : ''
              }
              onChange={(event) => {
                const ms = event.target.value
                  ? new Date(event.target.value).getTime()
                  : undefined
                patch({
                  endAtMs: Number.isFinite(ms as number) ? ms : undefined,
                })
              }}
              helperText="Past this, visitors get the default"
            />
            <FormControlLabel
              control={
                <Switch
                  size="small"
                  checked={Boolean(editor?.autoWinner)}
                  onChange={(event) =>
                    patch({
                      autoWinner: event.target.checked
                        ? { minExposures: 200, confidence: 0.95 }
                        : undefined,
                    })
                  }
                />
              }
              label="Auto-declare winner"
            />
            {editor?.autoWinner ? (
              <>
                <TextField
                  size="small"
                  type="number"
                  label="Min exposures / variant"
                  value={editor.autoWinner.minExposures}
                  onChange={(event) =>
                    patch({
                      autoWinner: {
                        ...editor.autoWinner!,
                        minExposures: Number(event.target.value),
                      },
                    })
                  }
                  sx={{ width: 170 }}
                />
                <TextField
                  select
                  size="small"
                  label="Confidence"
                  value={String(editor.autoWinner.confidence)}
                  onChange={(event) =>
                    patch({
                      autoWinner: {
                        ...editor.autoWinner!,
                        confidence: Number(event.target.value),
                      },
                    })
                  }
                  sx={{ width: 120 }}
                >
                  <MenuItem value="0.9">{'90%'}</MenuItem>
                  <MenuItem value="0.95">{'95%'}</MenuItem>
                  <MenuItem value="0.99">{'99%'}</MenuItem>
                </TextField>
              </>
            ) : null}
          </Stack>
          <Typography variant="subtitle2">{'Variants'}</Typography>
          {(editor?.variants ?? []).map((variant, index) => (
            <Stack key={variant.id} spacing={1}>
              <Stack direction="row" spacing={1}>
                <TextField
                  size="small"
                  label={`Variant ${variant.id.toUpperCase()}`}
                  value={variant.name ?? ''}
                  onChange={(event) =>
                    patchVariant(index, { name: event.target.value })
                  }
                  sx={{ flex: 1 }}
                />
                <TextField
                  size="small"
                  type="number"
                  label="Weight"
                  value={variant.weight ?? 1}
                  onChange={(event) =>
                    patchVariant(index, { weight: Number(event.target.value) })
                  }
                  sx={{ width: 100 }}
                />
                {editor?.target !== 'email' ? (
                  // Screen/section variants pin a screen version
                  // (AGL-253); empty = the published version.
                  <TextField
                    select
                    size="small"
                    label="Version"
                    value={variant.versionId ?? ''}
                    onChange={(event) =>
                      patchVariant(index, { versionId: event.target.value })
                    }
                    sx={{ minWidth: 160 }}
                  >
                    <MenuItem value="">{'Published (control)'}</MenuItem>
                    {versionOptions.map((option) => (
                      <MenuItem key={option.id} value={option.id}>
                        {option.name}
                      </MenuItem>
                    ))}
                  </TextField>
                ) : null}
              </Stack>
              {editor?.target === 'email' ? (
                // Email variants override the campaign copy (AGL-255).
                <Stack direction="row" spacing={1}>
                  <TextField
                    size="small"
                    label="Subject override"
                    value={variant.subject ?? ''}
                    onChange={(event) =>
                      patchVariant(index, { subject: event.target.value })
                    }
                    sx={{ width: 220 }}
                  />
                  <TextField
                    size="small"
                    label="Body override"
                    value={variant.body ?? ''}
                    onChange={(event) =>
                      patchVariant(index, { body: event.target.value })
                    }
                    multiline
                    maxRows={3}
                    sx={{ flex: 1 }}
                  />
                </Stack>
              ) : null}
            </Stack>
          ))}
          {/*
            Beneath the variants, never above them: a widget here writes copy
            FOR the list that precedes it, and the list is what the person
            came to the dialog for.
          */}
          {editor ? (
            <ExperimentVariantsZone
              hostId={hostId}
              experimentId={editor.$id ?? ''}
              name={editor.name ?? ''}
              target={editor.target ?? 'screen'}
              goal={editor.goal?.event ?? ''}
              screenId={editor.target === 'email' ? '' : (editor.screenId ?? '')}
              nodeId={editor.target === 'section' ? (editor.nodeId ?? '') : ''}
              variants={marketingExperimentVariantDrafts(editor.variants)}
              proposeVariants={proposeVariants}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setEditor(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            color="primary"
            onClick={() => void handleSave()}
          >
            {'Save'}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={Boolean(results)}
        onClose={() => setResults(null)}
        maxWidth="xs"
        fullWidth
      >
        <DialogTitle>
          {`Results — ${results?.experiment.name ?? ''}`}
          {results?.experiment.autoCompleted ? (
            // The track pipeline decided this one (AGL-273).
            <Chip
              size="small"
              color="success"
              label="Auto-completed"
              sx={{ ml: 1 }}
            />
          ) : null}
        </DialogTitle>
        <DialogContent>
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Variant'}</TableCell>
                <TableCell>{'Exposures'}</TableCell>
                <TableCell>{'Conversions'}</TableCell>
                <TableCell>{'Rate'}</TableCell>
                <TableCell>{'vs control'}</TableCell>
                <TableCell align="right" />
              </TableRow>
            </TableHead>
            <TableBody>
              {/* Lift + z-test confidence vs the first variant (AGL-265). */}
              {(results
                ? experimentResultRows(results.experiment, results.stats)
                : []
              ).map(({ variant, summary, comparison, leader, winner }) => (
                <TableRow key={variant.id} selected={leader}>
                  <TableCell>
                    {variant.name ?? variant.id.toUpperCase()}
                    {winner ? ' 🏆' : leader ? ' ▲' : ''}
                  </TableCell>
                  <TableCell>{summary.exposures}</TableCell>
                  <TableCell>{summary.conversions}</TableCell>
                  <TableCell>{`${(summary.rate * 100).toFixed(1)}%`}</TableCell>
                  <TableCell>{describeVariantComparison(comparison)}</TableCell>
                  <TableCell align="right">
                    {results?.experiment.status !== 'done' ? (
                      <Button
                        size="small"
                        onClick={() => {
                          if (results) {
                            void setStatus(results.experiment, 'done', variant.id)
                            setResults(null)
                          }
                        }}
                      >
                        {'Pick winner'}
                      </Button>
                    ) : null}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
          {/*
            Below the figures, so anything a widget says about this test is
            read after the counts it is talking about, and the test is named
            as the results reader labels it — its name, or its id where it has
            none, which is the same fallback that reader takes.
          */}
          {results ? (
            <ExperimentResultZone
              hostId={hostId}
              experimentId={results.experiment.$id ?? ''}
              test={results.experiment.name?.trim() || (results.experiment.$id ?? '')}
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setResults(null)}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
HostExperimentsCard.displayName = 'HostExperimentsCard'

export default HostExperimentsCard
