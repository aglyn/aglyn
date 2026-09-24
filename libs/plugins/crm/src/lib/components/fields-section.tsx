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
  CONTACT_FIELD_TYPE_LABELS,
  CONTACT_FIELD_TYPES,
  type ConsolePluginPageProps,
  createResourceUid,
  CRM_COLLECTIONS,
  CRM_FIELD_OBJECT_LABELS,
  CRM_FIELD_OBJECTS,
  type CrmFieldObject,
  isCrmFieldObject,
  newResourceScopeFields,
  ORG_SCOPE_TOKEN,
  pluginDocsHelp,
} from '@aglyn/aglyn'
import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import {
  ListRowActions,
  ListTable,
  listActionsColumn,
} from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  mdiArchiveArrowUpOutline,
  mdiArchiveOutline,
  mdiArrowDown,
  mdiArrowUp,
  mdiDeleteOutline,
  mdiPencilOutline,
} from '@aglyn/shared-data-mdi'
import {
  CardDisplay,
  MdiIcon,
  SrOnly,
  useConfirmationContext,
} from '@aglyn/shared-ui-jsx'
import type { RowActionsMenuItem } from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import {
  filterListRows,
  inMemoryListField,
  type ListFilterOption,
  listFilterGridColumns,
} from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useUser,
  writeGuardedBySeed,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  IconButton,
  Stack,
  Tab,
  Tabs,
  Tooltip,
  Typography,
} from '@mui/material'
import type { GridColDef, GridSortModel } from '@mui/x-data-grid'
import {
  collection,
  deleteDoc,
  doc,
  setDoc,
  updateDoc,
  writeBatch,
} from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  type ContactFieldDefinitionDoc,
  useContactFieldDefinitions,
} from '../hooks/use-contact-field-definitions'
import { useCrmScope } from '../hooks/use-crm-scope'
import ContactFieldDrawer, { type ContactFieldDraft } from './contact-field-drawer'
import { LeadSourceValuesCard } from './lead-source-values-card'
import { recomputeAllCrmNextActivity } from '../model/next-activity-api'
import { crmTaskCallScope } from '../model/task-routes'

export type ContactsFieldsSectionProps = Pick<ConsolePluginPageProps, 'hostId' | 'org'>

/** What each tab says the fields are for, above its list. */
const OBJECT_INTRO: Record<CrmFieldObject, string> = {
  contact:
    'The custom fields on a contact — text, number, date, choice, ' +
    'checkbox or link. They show on every contact, as columns on the ' +
    'list, and a form field can save into one.',
  company:
    'The custom fields on a company. They show on every company’s page ' +
    'and its edit form, as columns on the companies list, and a CSV ' +
    'import can fill them.',
  deal:
    'The custom fields on a deal. They show on every deal’s page and ' +
    'its edit form, and as columns on the deals table.',
  lead:
    'The custom fields on a lead. They show on every lead’s page and the ' +
    'New lead drawer, and as columns on the leads list. They stay on the ' +
    'lead when it converts — a contact’s fields are its own.',
}

/** The noun each tab's empty state and captions use. */
const OBJECT_NOUN: Record<CrmFieldObject, string> = {
  contact: 'contact',
  company: 'company',
  deal: 'deal',
  lead: 'lead',
}

/** One definition as the list table draws it. */
interface FieldRow {
  $id: string
  label: string
  key: string
  type: string
  /** `required` or `optional`, the value the Required filter picks. */
  required: 'required' | 'optional'
  /** Where the stored order puts it, from zero. */
  position: number
  definition: ContactFieldDefinitionDoc
}

/** What the grid's Filters panel offers: the type and whether it is required. */
const FIELD_FILTER_FIELDS = [
  inMemoryListField('type', 'select'),
  inMemoryListField('required', 'select'),
]
const FIELD_FILTER_HEADERS: Readonly<Record<string, string>> = {
  type: 'Type',
  required: 'Required',
}
const FIELD_FILTER_OPTIONS: Readonly<Record<string, readonly ListFilterOption[]>> = {
  type: CONTACT_FIELD_TYPES.map((type) => ({
    value: type,
    label: CONTACT_FIELD_TYPE_LABELS[type],
  })),
  required: [
    { value: 'required', label: 'Required' },
    { value: 'optional', label: 'Optional' },
  ],
}
/** The quick search reads a field's name and its key. */
const FIELD_SEARCH_PATHS = ['label', 'key'] as const

/** Why the arrows are off while the list is not in its stored order. */
export const FIELD_REORDER_LOCKED_REASON = 'Clear sorting and filters to reorder'

const typeLabel = (type: unknown) =>
  CONTACT_FIELD_TYPE_LABELS[type as keyof typeof CONTACT_FIELD_TYPE_LABELS] ?? String(type ?? '')

interface FieldsTableProps {
  /** One tab's definitions, in the stored order. */
  definitions: readonly ContactFieldDefinitionDoc[]
  /** A field being written; every arrow waits for it. */
  busyId: string
  onMove: (definition: ContactFieldDefinitionDoc, direction: -1 | 1) => void
  rowActions: (definition: ContactFieldDefinitionDoc) => RowActionsMenuItem[]
}

/**
 * One tab's field definitions in the console's list table (AGL-3335): the
 * toolbar's columns, filters, export and search, sorting by Field, Key and
 * Type, and the shared footer.
 *
 * ## Order is data, not a sort
 *
 * The stored `order` is where each field appears on every record and form,
 * so the arrows that move it are kept, and are live only while the table
 * shows that order: no sort, no filter and no search. Under any of them the
 * row above a field on screen is not the field above it in the stored
 * order, and a move would land somewhere the reader cannot see; the arrows
 * say so rather than disappear.
 *
 * The panel and the search narrow the rows here, over the tab's whole list
 * (`filterListRows`), and the grid sorts and pages what it is handed.
 */
function FieldsTable(props: FieldsTableProps) {
  const { definitions, busyId, onMove, rowActions } = props
  const gridFilter = useListGridFilter({ selectFields: ['type', 'required'] })
  const [sortModel, setSortModel] = useState<GridSortModel>([])
  const searching = gridFilter.searchWords.some((word) => word.trim() !== '')
  const reorderLocked =
    sortModel.length > 0 || gridFilter.clauses.length > 0 || searching

  const allRows = useMemo<FieldRow[]>(
    () =>
      definitions.map((definition, position) => ({
        $id: definition.$id,
        label: definition.label,
        key: definition.key,
        type: definition.type,
        required: definition.required ? 'required' : 'optional',
        position,
        definition,
      })),
    [definitions],
  )
  const searchKey = gridFilter.searchWords.join(' ')
  const rows = useMemo(
    () =>
      filterListRows(allRows, FIELD_FILTER_FIELDS, gridFilter.clauses, {
        paths: FIELD_SEARCH_PATHS,
        words: gridFilter.searchWords,
      }),
    // `searchKey` stands for the words, which are a new array each render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [allRows, gridFilter.clauses, searchKey],
  )

  const columns = useMemo<GridColDef[]>(
    () =>
      listFilterGridColumns(
        [
          {
            field: 'position',
            headerName: 'Order',
            width: 132,
            sortable: false,
            filterable: false,
            hideable: false,
            disableColumnMenu: true,
            renderCell: ({ row }: { row: FieldRow }) => {
              const arrows = (
                <Stack direction="row" spacing={0} sx={{ alignItems: 'center' }}>
                  <Typography
                    variant="body2"
                    color="text.secondary"
                    sx={{ minWidth: 24, textAlign: 'right', mr: 0.5 }}
                  >
                    {row.position + 1}
                  </Typography>
                  <IconButton
                    size="small"
                    disabled={reorderLocked || row.position === 0 || Boolean(busyId)}
                    onClick={() => onMove(row.definition, -1)}
                  >
                    <MdiIcon path={mdiArrowUp.path} size={0.7} />
                    <SrOnly>{`Move ${row.label} up`}</SrOnly>
                  </IconButton>
                  <IconButton
                    size="small"
                    disabled={
                      reorderLocked || row.position === definitions.length - 1 || Boolean(busyId)
                    }
                    onClick={() => onMove(row.definition, 1)}
                  >
                    <MdiIcon path={mdiArrowDown.path} size={0.7} />
                    <SrOnly>{`Move ${row.label} down`}</SrOnly>
                  </IconButton>
                </Stack>
              )
              return reorderLocked ? (
                <Tooltip title={FIELD_REORDER_LOCKED_REASON}>
                  {/* A disabled button emits no events; the span carries the tooltip. */}
                  <span>{arrows}</span>
                </Tooltip>
              ) : (
                arrows
              )
            },
          },
          {
            field: 'label',
            headerName: 'Field',
            flex: 1,
            minWidth: 180,
            renderCell: ({ row }: { row: FieldRow }) => (
              <Stack
                direction="row"
                spacing={1}
                sx={{ flexWrap: 'wrap', alignItems: 'center' }}
              >
                <Typography variant="body2">{row.label}</Typography>
                {row.definition.retiredAt ? (
                  <Chip size="small" variant="outlined" color="warning" label="Retired" />
                ) : null}
              </Stack>
            ),
          },
          {
            field: 'key',
            headerName: 'Key',
            flex: 1,
            minWidth: 160,
            renderCell: ({ row }: { row: FieldRow }) => (
              <Typography
                variant="body2"
                color="text.secondary"
                sx={{ fontFamily: 'monospace' }}
              >
                {row.key}
              </Typography>
            ),
          },
          {
            field: 'type',
            headerName: 'Type',
            width: 170,
            // By what the type reads as, not by its stored key.
            sortComparator: (a: unknown, b: unknown) =>
              typeLabel(a).localeCompare(typeLabel(b)),
            renderCell: ({ row }: { row: FieldRow }) => (
              <Typography variant="body2">
                {typeLabel(row.type)}
                {row.definition.type === 'select' && row.definition.options?.length
                  ? ` · ${row.definition.options.length} choices`
                  : ''}
              </Typography>
            ),
          },
          {
            field: 'required',
            headerName: 'Required',
            width: 120,
            sortable: false,
            renderCell: ({ row }: { row: FieldRow }) => (
              <Typography variant="body2" color="text.secondary">
                {row.required === 'required' ? 'Yes' : '—'}
              </Typography>
            ),
          },
          listActionsColumn(
            (row: FieldRow) => (
              <ListRowActions label={row.label} items={rowActions(row.definition)} />
            ),
            { width: 72 },
          ),
        ],
        FIELD_FILTER_FIELDS,
        FIELD_FILTER_OPTIONS,
        FIELD_FILTER_HEADERS,
      ),
    [reorderLocked, busyId, onMove, rowActions, definitions.length],
  )

  return (
    <Stack spacing={1}>
      <ListFilterChips
        fields={FIELD_FILTER_FIELDS}
        headers={FIELD_FILTER_HEADERS}
        clauses={gridFilter.clauses}
        onChange={gridFilter.setClauses}
        options={FIELD_FILTER_OPTIONS}
        marksServed={false}
      />
      <ListTable
        aria-label="Fields"
        rows={rows}
        columns={columns}
        sortModel={sortModel}
        onSortModelChange={setSortModel}
        // The rows above are already narrowed; the grid only draws them.
        filterMode="server"
        filterModel={gridFilter.filterModel}
        onFilterModelChange={gridFilter.onFilterModelChange}
        quickFilter
        noRowsLabel="No fields match these filters"
        getRowClassName={({ row }: { row: FieldRow }) =>
          row.definition.retiredAt ? 'field-retired' : ''
        }
        sx={{ '& .field-retired': { opacity: 0.6 } }}
      />
    </Stack>
  )
}
FieldsTable.displayName = 'FieldsTable'

/**
 * `/crm/fields` — the custom fields a holder keeps on a person (AGL-2601),
 * since AGL-2661 on a company and a deal too, and since AGL-3272 on a lead:
 * one tab each, and every CRM record describable in the org's own words.
 *
 * Definitions live in `orgs/{orgId}/contactFields`, one document per field,
 * and the VALUES live under each contact facet's `custom` keyed by the
 * definition's `key`. That split decides everything this section does:
 *
 *  - A field is RETIRED, not deleted, while values may exist under it. A
 *    retired field leaves every form and every column, but an export can
 *    still read what was written, and a restore brings it back intact.
 *    Delete is offered only on a retired field, because retiring is the step
 *    where the author had to look at what they were losing.
 *  - The KEY never changes. It is the map key every value sits under; a
 *    rename is a new field and a retire.
 *  - Order is a stored `order` on each document, moved with the arrows here,
 *    and every reader sorts by it — the profile card, the columns, an export.
 *    The list table sorts, filters and searches a tab too (AGL-3335), and
 *    the arrows wait while it does — see `FieldsTable`.
 *
 * ## What is NOT on this page
 *
 * How many contacts carry a value under each field. That count is a read of
 * every contact document in the org — the expensive-read shape this codebase
 * has a standing rule against — and it would be paid on every visit to a
 * settings page. The list says so rather than showing a number it cannot
 * afford to keep true.
 *
 * Definitions are ORG-WIDE (`visibleTo: ['org']`): a field is a fact about
 * how this business describes people, and every site in the org files
 * people into the same address book. `hostId` records which site defined it.
 */
export function ContactsFieldsSection(props: ContactsFieldsSectionProps) {
  const { hostId, org } = props
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const { confirm } = useConfirmationContext()
  // The org root from the one scope hook (AGL-2614), which also answers at
  // the organization level (AGL-2630). A definition is org-wide either way;
  // the defining site it records is the mounted one, or the picked one, or
  // none for a field defined over the whole org before any pick.
  const { scope, ready: scopeReady, createHostId } = useCrmScope({ hostId, org })
  const orgId = scope?.[1] ?? null
  /*
   * ONE TAB PER OBJECT (AGL-2661). The list, the drawer and every write
   * below are about the tab's object: the hook narrows the org's one
   * definition list to it, a new field is stamped with it, and the drawer
   * refuses a key only against the keys THIS object already uses — a
   * company and a contact may both define `region`.
   */
  const [object, setObject] = useState<CrmFieldObject>('contact')
  const { definitions, ready, fromCache } = useContactFieldDefinitions(orgId, object)
  const noun = OBJECT_NOUN[object]

  /*
   * MAINTENANCE: recompute every record's next activity (AGL-2661). The
   * figure is kept by every task write, so this is for the records written
   * before it existed and for whatever a write that could not reach the
   * route left behind. A console action rather than a script, because the
   * person who notices a stale column is the person who should be able to
   * fix it.
   */
  const { data: user } = useUser()
  const [recomputing, setRecomputing] = useState(false)
  const recomputeNextActivity = useCallback(async () => {
    const callScope = crmTaskCallScope(hostId, orgId)
    if (!callScope || recomputing) return
    const confirmed = await confirm({
      title: 'Recompute next activity?',
      description:
        'Every contact, company and deal in this organization gets its ' +
        '"Next activity" recomputed from its open tasks. Safe to run any time; ' +
        'it only rewrites a figure the task list already implies.',
      confirmationText: 'Recompute',
    })
      .then(() => true)
      .catch(() => false)
    if (!confirmed) return
    setRecomputing(true)
    try {
      const result = await recomputeAllCrmNextActivity(user, callScope)
      enqueueSnackbar(
        `Next activity recomputed: ${result.records.toLocaleString()} record${result.records === 1 ? '' : 's'} ` +
          `from ${(result.tasks ?? 0).toLocaleString()} open task${result.tasks === 1 ? '' : 's'}` +
          (result.truncated
            ? ' — the first batch of open tasks only; nothing stale was cleared'
            : ''),
        { variant: 'success' },
      )
    } catch (cause) {
      enqueueSnackbar(
        cause instanceof Error ? cause.message : 'The next activity could not be recomputed.',
        { variant: 'warning' },
      )
    } finally {
      setRecomputing(false)
    }
  }, [hostId, orgId, recomputing, confirm, user, enqueueSnackbar])

  const [drawerOpen, setDrawerOpen] = useState(false)
  const [editing, setEditing] = useState<ContactFieldDefinitionDoc | null>(null)
  const [busyId, setBusyId] = useState('')

  const fieldRef = useCallback(
    (id: string) => {
      if (!scope) throw new Error('a contact field needs an organization')
      return doc(firestore, scope[0], scope[1], CRM_COLLECTIONS.contactFields, id)
    },
    [firestore, scope],
  )

  const openCreate = useCallback(() => {
    setEditing(null)
    setDrawerOpen(true)
  }, [])
  const openEdit = useCallback((definition: ContactFieldDefinitionDoc) => {
    setEditing(definition)
    setDrawerOpen(true)
  }, [])

  /**
   * Create, or save the editable half of an existing field.
   *
   * On create the document carries everything a reader expects: the key,
   * an `order` past every existing one so it lands last, an explicit
   * `retiredAt: null` so a `where('retiredAt', '==', null)` can find it, the
   * defining site, and the org-wide scope stamp the rules require. On edit
   * only the label, the choices and the required flag move — the key and
   * the type are the drawer's disabled inputs, and this writer does not
   * take them either.
   */
  const handleSubmit = useCallback(
    async (draft: ContactFieldDraft) => {
      if (!scope) return
      const now = new Date()
      if (editing) {
        const verdict = await writeGuardedBySeed(
          { subject: 'field', fromCache },
          async () => {
            await updateDoc(fieldRef(editing.$id), {
              label: draft.label,
              ...(editing.type === 'select' ? { options: draft.options } : {}),
              required: draft.required,
              updatedAt: now,
            })
          },
        )
        if (!verdict.ok) {
          return void enqueueSnackbar(verdict.message, {
            variant: 'warning',
            persist: false,
          })
        }
        enqueueSnackbar('Field saved', { variant: 'success', persist: false })
      } else {
        const order =
          definitions.reduce(
            (highest, definition) => Math.max(highest, Number(definition.order) || 0),
            -1,
          ) + 1
        await setDoc(
          doc(
            collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.contactFields),
            createResourceUid(),
          ),
          {
            key: draft.key,
            label: draft.label,
            type: draft.type,
            ...(draft.type === 'select' ? { options: draft.options } : {}),
            required: draft.required,
            order,
            retiredAt: null,
            // Which record the field describes — the tab it was made on.
            object,
            hostId: createHostId,
            ...newResourceScopeFields([ORG_SCOPE_TOKEN]),
            createdAt: now,
            updatedAt: now,
          },
        )
        enqueueSnackbar(`Field "${draft.label}" added`, {
          variant: 'success',
          persist: false,
        })
      }
      setDrawerOpen(false)
      setEditing(null)
    },
    [scope, editing, fromCache, fieldRef, enqueueSnackbar, definitions, firestore, createHostId, object],
  )

  /**
   * Move a field one place up or down.
   *
   * Writes `order` as the POSITION for every row whose stored order is not
   * already its position, in one batch. Swapping two numbers would be enough
   * on a list whose orders are already distinct, and wrong on one where they
   * are not — every field created before this section existed carries the
   * same `order`, and a swap of two equal numbers moves nothing. Renumbering
   * what is out of place makes the first move on such a list also the one
   * that normalizes it, at the cost of a batch that is at most the list.
   */
  const move = useCallback(
    async (definition: ContactFieldDefinitionDoc, direction: -1 | 1) => {
      if (!scope || busyId) return
      const index = definitions.findIndex((entry) => entry.$id === definition.$id)
      const target = index + direction
      if (index < 0 || target < 0 || target >= definitions.length) return
      const next = [...definitions]
      next[index] = definitions[target]
      next[target] = definitions[index]
      setBusyId(definition.$id)
      try {
        const verdict = await writeGuardedBySeed(
          { subject: 'field order', fromCache },
          async () => {
            const batch = writeBatch(firestore)
            const now = new Date()
            next.forEach((entry, position) => {
              if (entry.order === position) return
              batch.update(fieldRef(entry.$id), { order: position, updatedAt: now })
            })
            await batch.commit()
          },
        )
        if (!verdict.ok) {
          enqueueSnackbar(verdict.message, { variant: 'warning', persist: false })
        }
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
      } finally {
        setBusyId('')
      }
    },
    [scope, busyId, definitions, fromCache, firestore, fieldRef, enqueueSnackbar],
  )

  /**
   * Retire a field, or bring one back.
   *
   * Retiring is asked about because it takes a control off every contact
   * form and a column off the list; restoring is not, because it puts a
   * choice back and is undone by retiring again. Neither touches a value.
   */
  const toggleRetired = useCallback(
    async (definition: ContactFieldDefinitionDoc) => {
      if (!scope || busyId) return
      if (!definition.retiredAt) {
        const accepted = await confirm({
          title: `Retire “${definition.label}”?`,
          description:
            `It leaves every ${noun} form, column and form-field mapping. ` +
            'Values already saved under it are kept and still export, and ' +
            'you can restore the field at any time.',
          confirmationText: 'Retire',
        })
          // `confirm` resolves with no value and REJECTS on cancel, so gating
          // on the resolved value alone would always fall through.
          .then(() => true)
          .catch(() => false)
        if (!accepted) return
      }
      setBusyId(definition.$id)
      try {
        await updateDoc(fieldRef(definition.$id), {
          retiredAt: definition.retiredAt ? null : Date.now(),
          updatedAt: new Date(),
        })
        enqueueSnackbar(definition.retiredAt ? 'Field restored' : 'Field retired', {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
      } finally {
        setBusyId('')
      }
    },
    [scope, busyId, confirm, fieldRef, enqueueSnackbar, noun],
  )

  /**
   * Delete a RETIRED field's definition.
   *
   * The values under its key are not touched — they sit on contact documents
   * this page does not read — so what is destroyed is the ability to show
   * them anywhere. The dialog says exactly that, and the key stays taken for
   * as long as the list can see it, which after this write it cannot; a new
   * field with the same key would read the orphaned values back as its own.
   */
  const handleDelete = useCallback(
    async (definition: ContactFieldDefinitionDoc) => {
      if (!scope || busyId || !definition.retiredAt) return
      const accepted = await confirm({
        title: `Delete “${definition.label}”?`,
        description:
          'The definition is removed for good. Values saved under its key ' +
          `(${definition.key}) stay on the ${noun}s that carry them but ` +
          'nothing will show them again — and a new field created with the ' +
          'same key would read them as its own.',
        confirmationText: 'Delete field',
        confirmationButtonProps: { color: 'error' },
      })
        .then(() => true)
        .catch(() => false)
      if (!accepted) return
      setBusyId(definition.$id)
      try {
        await deleteDoc(fieldRef(definition.$id))
        enqueueSnackbar('Field deleted', { variant: 'success', persist: false })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', { variant: 'error', allowDuplicate: true })
      } finally {
        setBusyId('')
      }
    },
    [scope, busyId, confirm, fieldRef, enqueueSnackbar, noun],
  )

  /*
   * Stable across renders, as the table's columns are built from them: a
   * fresh function each render would rebuild every column on every render.
   */
  const rowActions = useCallback(
    (definition: ContactFieldDefinitionDoc): RowActionsMenuItem[] => [
      {
        key: 'edit',
        label: 'Edit field',
        icon: <MdiIcon path={mdiPencilOutline.path} size={0.8} />,
        onClick: () => openEdit(definition),
      },
      {
        key: 'retire',
        label: definition.retiredAt ? 'Restore' : 'Retire',
        icon: (
          <MdiIcon
            path={definition.retiredAt ? mdiArchiveArrowUpOutline.path : mdiArchiveOutline.path}
            size={0.8}
          />
        ),
        destructive: !definition.retiredAt,
        disabled: Boolean(busyId),
        disabledReason: busyId ? 'Another field is being saved' : undefined,
        onClick: () => void toggleRetired(definition),
      },
      ...(definition.retiredAt
        ? [
            {
              key: 'delete',
              label: 'Delete',
              icon: <MdiIcon path={mdiDeleteOutline.path} size={0.8} />,
              destructive: true,
              disabled: Boolean(busyId),
              disabledReason: busyId ? 'Another field is being saved' : undefined,
              onClick: () => void handleDelete(definition),
            } satisfies RowActionsMenuItem,
          ]
        : []),
    ],
    [openEdit, toggleRetired, handleDelete, busyId],
  )
  const onMove = useCallback(
    (definition: ContactFieldDefinitionDoc, direction: -1 | 1) =>
      void move(definition, direction),
    [move],
  )

  return (
    <CardDisplay
      header={'Fields'}
      help={pluginDocsHelp('contactFields', { anchor: '#define-a-field' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        action: scope ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <Button size="small" onClick={() => void recomputeNextActivity()} disabled={recomputing}>
              {recomputing ? 'Recomputing…' : 'Recompute next activity'}
            </Button>
            <Button variant="contained" onClick={openCreate}>
              {'New field'}
            </Button>
          </Stack>
        ) : null,
      }}
    >
      <Stack spacing={2}>
        <Tabs
          value={object}
          onChange={(_event, next) => {
            if (isCrmFieldObject(next)) setObject(next)
          }}
          aria-label="Fields by record"
        >
          {CRM_FIELD_OBJECTS.map((entry) => (
            <Tab key={entry} value={entry} label={CRM_FIELD_OBJECT_LABELS[entry]} />
          ))}
        </Tabs>
        <Typography variant="body2" color="text.secondary">
          {`${OBJECT_INTRO[object]} Fields are shared across every site in this ` +
            'organization, like the records themselves.'}
        </Typography>
        {scopeReady && !scope ? (
          <Typography variant="body2" color="text.secondary">
            {`This site has no organization, so it has no ${noun} fields.`}
          </Typography>
        ) : !ready ? null : definitions.length === 0 ? (
          <EmptyStateComponent
            label={`No custom ${noun} fields yet`}
            description={`A field you define here is kept on every ${noun} and shows on its page.`}
            action={
              scope ? (
                <Button variant="contained" onClick={openCreate}>
                  {'New field'}
                </Button>
              ) : undefined
            }
          />
        ) : (
          /*
            Keyed by the tab, so a sort, a filter or a search made on one
            record's fields does not follow the reader onto another's.
          */
          <FieldsTable
            key={object}
            definitions={definitions}
            busyId={busyId}
            onMove={onMove}
            rowActions={rowActions}
          />
        )}
        {definitions.length ? (
          <Typography variant="caption" color="text.secondary">
            {`How many ${noun}s carry a value under each field is not ` +
              `counted — that would read every ${noun} in the organization ` +
              'each time this page opened.'}
          </Typography>
        ) : null}
        {/*
          Lead source (AGL-3298) — a standard lead field whose CHOICES are the
          org's, Salesforce's Lead Source picklist — kept on the Leads tab
          beside the custom lead fields.
        */}
        {object === 'lead' && scope ? (
          <LeadSourceValuesCard hostId={hostId} orgId={orgId} createHostId={createHostId} />
        ) : null}
      </Stack>
      <ContactFieldDrawer
        open={drawerOpen}
        onClose={() => setDrawerOpen(false)}
        definition={editing}
        object={object}
        takenKeys={definitions.map((definition) => definition.key)}
        onSubmit={handleSubmit}
      />
    </CardDisplay>
  )
}
ContactsFieldsSection.displayName = 'ContactsFieldsSection'

export default ContactsFieldsSection
