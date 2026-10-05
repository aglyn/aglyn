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
  CRM_COLLECTIONS,
  type CrmCompany,
  crmPicklistKey,
  pluginDocsHelp,
  crmMemberPickerLabel,
} from '@aglyn/aglyn'
import { mdiPlus } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { listFilterColumn } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import ListQueryNotices, {
  listQueryRefusals,
} from '@aglyn/shared-ui-jsx/components/list-query-notices.component'
import { useCrmSavedView } from '../hooks/use-crm-saved-view'
import { useCrmViewGrid } from '../hooks/use-crm-view-grid'
import { CRM_LIST_SLOTS, CrmColumnOrderProvider } from './crm-column-menu'
import {
  CRM_NEXT_ACTIVITY_FILTER_FIELD,
  CRM_NEXT_ACTIVITY_FILTER_HEADER,
  nextActivityColumn,
} from './crm-next-activity-column'
import { useCrmFoldsScope, useCrmListQuery } from '../hooks/use-crm-list-query'
import ListFilterChips from '@aglyn/shared-ui-jsx/components/list-filter-chips.component'
import { listFilterGridColumns } from '@aglyn/shared-ui-jsx/const/list-grid-filter'
import { useListGridFilter } from '@aglyn/shared-ui-jsx/hooks/use-list-grid-filter'
import CrmViewsControl from './crm-views-control'
import { CrmListActions, CrmListToolbar } from './crm-list-toolbar'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import { Button, Chip, Stack, Typography } from '@mui/material'
import {
  getGridSingleSelectOperators,
  type GridColDef,
} from '@mui/x-data-grid'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import {
  COMPANY_LIST_DECLARATION,
  COMPANY_LIST_FILTER_FIELDS,
  COMPANY_PICKLIST_FILTERS,
  COMPANY_PREFIX_SEARCH,
} from '../constants/company-filters'
import { useCompanyPicklists } from '../hooks/use-company-picklists'
import { formatMoney } from '../model/deal-board-model'
import { useContactFieldDefinitions } from '../hooks/use-contact-field-definitions'
import { useCrmScope } from '../hooks/use-crm-scope'
import { useOrgMemberOptions } from '../hooks/use-org-member-options'
import { CRM_COMPANIES_RESOURCE } from '../transfer/fields'
import { crmRoutes } from '../model/crm-routes'
import CompaniesBulkBar from './companies-bulk-bar'
import CompanyEditDrawer from './company-edit-drawer'
import { CrmExportButton, CrmImportButton } from './crm-transfer-buttons'
import { customFieldColumns } from './contact-custom-columns'

export interface CompaniesSectionProps {
  /** The site the list is read under, or `null` at the organization level. */
  hostId: string | null
  org?: Partial<AglynOrgBilling>
  /** The CRM hub URL, which every company route hangs beneath. */
  basePath: string
}

type CompanyRow = Partial<CrmCompany> & { $id: string; updatedAt?: any }

/** What the companies grid's panel offers — every field the query asks. */
const COMPANY_GRID_FILTER_FIELDS = COMPANY_LIST_FILTER_FIELDS
const COMPANY_GRID_FILTER_HEADERS: Readonly<Record<string, string>> = {
  name: 'Company',
  ownerUid: 'Owner',
  [CRM_NEXT_ACTIVITY_FILTER_FIELD.column]: CRM_NEXT_ACTIVITY_FILTER_HEADER,
  ...Object.fromEntries(COMPANY_PICKLIST_FILTERS.map((entry) => [entry.column, entry.header])),
}

/** The grid's select columns — the owner and each picklist — as the filter hook names them. */
const COMPANY_SELECT_FIELDS = ['ownerUid', ...COMPANY_PICKLIST_FILTERS.map((entry) => entry.column)]

/**
 * Salesforce's Account columns (AGL-3514), optional: a reader turns one on
 * from the column menu, and a view that shows it stores it by name.
 */
const COMPANY_HIDDEN_COLUMNS: Readonly<Record<string, boolean>> = {
  type: false,
  industry: false,
  rating: false,
  accountSource: false,
  numberOfEmployees: false,
  annualRevenueCents: false,
}

/** A text cell that reads as a dash when empty. */
function textCell(value: unknown) {
  const text = value === null || value === undefined ? '' : String(value)
  return text ? (
    <Typography variant="body2" noWrap>
      {text}
    </Typography>
  ) : (
    <Typography variant="body2" color="text.secondary">
      {'—'}
    </Typography>
  )
}

/**
 * `/crm/companies` — the organizations behind the people (AGL-2597).
 *
 * A section of its own rather than a column on the contact list, because a
 * company is known by several contacts and carries records of its own: a
 * domain the email suggestion keys on, an address, an owner, and the deals
 * and tasks filed against it. The row opens `/crm/companies/{id}`, where all
 * of that lives; this list is the cheaper surface and reads nothing a row
 * does not show.
 *
 * ## What the listener carries
 *
 * Paged and ordered by the server — `updatedAt desc`, so a company somebody
 * just touched is on page one — and SCOPED by the same `visibleTo
 * array-contains-any` predicate the contact list runs. That predicate is what
 * the rules evaluate: a filtered query is provable per document, and an
 * unfiltered one is refused rather than quietly returning the whole org's
 * accounts to a site that may see one client's.
 *
 * ## What a filter may be
 *
 * Every clause and the search word are on the one query (AGL-3321): the
 * search reads the name's and the domain's word prefixes, the name is also
 * an exact match and a prefix, the owner a choice from the roster, and "No
 * next activity" a `null` — each reaching the whole collection, which is
 * the property a filter must have: a company on page four is found, not
 * reported missing. `COMPANY_LIST_DECLARATION` states what the query asks.
 *
 * ## Creating is a drawer
 *
 * "New company" opens the same eight-field drawer the company's page edits
 * with, and the new record's page opens when it is saved. A form above a
 * list has nowhere to grow, and this one has an address in it.
 *
 * ## Selection, the bar and the file (AGL-2621)
 *
 * The rows are selectable, and a selection raises `CompaniesBulkBar` over
 * the table. Import and Export open the console's import wizard and
 * export dialog on `crm.companies` (AGL-3527): the export over the
 * selection, the list's own query, or every company.
 */
export function CompaniesSection(props: CompaniesSectionProps) {
  const { hostId, org, basePath } = props
  const routes = crmRoutes(basePath)
  const router = useRouter()
  const { scope, orgId, visibleTo } = useCrmScope({ hostId, org })
  /*
   * The team, read once for this surface: the Owner column names a person
   * from a uid, and the create drawer picks from the same roster. One fetch
   * serves both, which is why the drawer takes it as a prop.
   */
  const members = useOrgMemberOptions(orgId)
  // The org's company fields, for the optional columns below (AGL-2661).
  const companyFields = useContactFieldDefinitions(orgId, 'company')
  // The lists behind Type, Industry and Rating, for their filters (AGL-3514).
  const picklists = useCompanyPicklists(orgId)

  /*
   * The clauses are the saved VIEW'S (AGL-2617), beside its columns and
   * sort; the grid's panel and the chips edit them, and the query answers
   * every one and the search word together (AGL-3321).
   */
  const views = useCrmSavedView({ section: 'companies', hostId, org, basePath })
  const viewFilters = views.state.filters
  const [searchWords, setSearchWords] = useState<string[]>([])
  const foldsScope = useCrmFoldsScope(orgId, visibleTo)
  const {
    rows: companies,
    status,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
    plan,
  } = useCrmListQuery<CompanyRow>({
    scope,
    collection: CRM_COLLECTIONS.companies,
    visibleTo,
    foldsScope,
    declaration: COMPANY_LIST_DECLARATION,
    clauses: viewFilters,
    search: searchWords,
    prefixSearch: COMPANY_PREFIX_SEARCH,
  })
  const nowMs = useMemo(() => Date.now(), [])

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  // A filter, a search or a page is a different set of rows.
  useEffect(() => setSelectedIds([]), [plan, page])
  // The list's filter, when one narrows it, for the export to read the same
  // records the list does (AGL-3527).
  const exportFilter = useMemo(
    () => (plan.served.length || plan.searched ? { label: 'what the list shows', plan } : null),
    [plan],
  )
  const openCompany = useCallback(
    (id: string) => router.push(routes.company(id)),
    [router, routes],
  )

  const columns: GridColDef[] = useMemo(
    () => [
      {
        field: 'name',
        headerName: 'Company',
        flex: 1.6,
        minWidth: 240,
        ...listFilterColumn(COMPANY_LIST_FILTER_FIELDS, 'name'),
        valueGetter: (_value, row: CompanyRow) => String(row.name ?? ''),
        renderCell: ({ row }: { row: CompanyRow }) => (
          <Stack
            sx={{ justifyContent: 'center', height: '100%', lineHeight: 1.25 }}
          >
            <Typography variant="body2" sx={{ lineHeight: 1.25 }}>
              {row.name}
            </Typography>
            {row.industry ? (
              <Typography
                variant="caption"
                color="text.secondary"
                sx={{ lineHeight: 1.25 }}
                noWrap
              >
                {row.industry}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'domain',
        headerName: 'Domain',
        flex: 1,
        minWidth: 160,
        // Stored normalized, so it could be filtered exactly — but a domain
        // lookup is what the company suggestion on a contact does, and a
        // filter here would need an index of its own for one more way to
        // find a row the name filter already finds.
        filterable: false,
        sortable: false,
        valueGetter: (_value, row: CompanyRow) => String(row.domain ?? ''),
        renderCell: ({ row }: { row: CompanyRow }) =>
          row.domain ? (
            <Typography variant="body2">{row.domain}</Typography>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'—'}
            </Typography>
          ),
      },
      {
        field: 'contactsCount',
        headerName: 'Contacts',
        width: 110,
        align: 'right',
        headerAlign: 'right',
        /*
         * The denormalized count every link moves (AGL-2613) — a stored
         * number, so a page of companies costs no read per row. Absent on a
         * company nobody has linked since the counter existed, which reads
         * as zero; the company's own page takes the live aggregate.
         */
        filterable: false,
        sortable: false,
        valueGetter: (_value, row: CompanyRow) => Number(row.contactsCount ?? 0),
        renderCell: ({ row }: { row: CompanyRow }) => (
          <Typography
            variant="body2"
            color={row.contactsCount ? 'text.primary' : 'text.secondary'}
          >
            {Number(row.contactsCount ?? 0).toLocaleString()}
          </Typography>
        ),
      },
      {
        field: 'tags',
        headerName: 'Tags',
        flex: 1,
        minWidth: 140,
        // Written by the drawer and the bulk bar (AGL-2621); read here, not
        // filtered — a tag filter would need an `array-contains` index of
        // its own beside the scope predicate.
        filterable: false,
        sortable: false,
        valueGetter: (_value, row: CompanyRow) => (row.tags ?? []).join(', '),
        renderCell: ({ row }: { row: CompanyRow }) =>
          row.tags?.length ? (
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', overflow: 'hidden' }}>
              {row.tags.slice(0, 3).map((tag) => (
                <Chip key={tag} size="small" variant="outlined" label={tag} />
              ))}
              {row.tags.length > 3 ? (
                <Typography variant="caption" color="text.secondary">
                  {`+${row.tags.length - 3}`}
                </Typography>
              ) : null}
            </Stack>
          ) : (
            <Typography variant="body2" color="text.secondary">
              {'—'}
            </Typography>
          ),
      },
      {
        field: 'ownerUid',
        headerName: 'Owner',
        flex: 1,
        minWidth: 160,
        sortable: false,
        /*
         * A CHOICE from the roster, not a text box for a uid. The grid's
         * single-select `is` operator is what the panel offers; the handler
         * below maps it onto the declared field's `equals`, which the
         * translator turns into the equality the index serves.
         */
        type: 'singleSelect',
        valueOptions: members.options.map((option) => ({
          value: option.uid,
          label: crmMemberPickerLabel(option),
        })),
        filterable: members.options.length > 0,
        filterOperators: getGridSingleSelectOperators().filter(
          (operator) => operator.value === 'is',
        ),
        valueGetter: (_value, row: CompanyRow) => String(row.ownerUid ?? ''),
        renderCell: ({ row }: { row: CompanyRow }) => (
          <Typography
            variant="body2"
            color={row.ownerUid ? 'text.primary' : 'text.secondary'}
          >
            {row.ownerUid
              ? members.ready
                ? members.labelFor(row.ownerUid)
                : '…'
              : '—'}
          </Typography>
        ),
      },
      {
        field: 'updatedAt',
        headerName: 'Updated',
        flex: 0.8,
        minWidth: 140,
        filterable: false,
        sortable: false,
        valueGetter: (_value, row: CompanyRow) =>
          row.updatedAt?.seconds ? new Date(row.updatedAt.seconds * 1000) : null,
        renderCell: ({ row }: { row: CompanyRow }) => (
          <Typography variant="caption" color="text.secondary">
            {row.updatedAt?.seconds
              ? new Date(row.updatedAt.seconds * 1000).toLocaleDateString()
              : '—'}
          </Typography>
        ),
      },
      // When the earliest open task against the company is due (AGL-2661).
      nextActivityColumn(nowMs),
      // Salesforce's Account fields (AGL-3514), each optional. Type, Industry
      // and Rating filter by the key stored beside the label; the rest read.
      ...COMPANY_PICKLIST_FILTERS.map(
        (entry): GridColDef => ({
          field: entry.column,
          headerName: entry.header,
          flex: 0.8,
          minWidth: 130,
          sortable: false,
          valueGetter: (_value, row: CompanyRow) =>
            crmPicklistKey(row[entry.column as 'type' | 'industry' | 'rating']) ?? '',
          renderCell: ({ row }: { row: CompanyRow }) =>
            textCell(row[entry.column as 'type' | 'industry' | 'rating']),
        }),
      ),
      {
        field: 'accountSource',
        headerName: 'Account source',
        flex: 0.8,
        minWidth: 140,
        filterable: false,
        sortable: false,
        valueGetter: (_value, row: CompanyRow) => String(row.accountSource ?? ''),
        renderCell: ({ row }: { row: CompanyRow }) => textCell(row.accountSource),
      },
      {
        field: 'numberOfEmployees',
        headerName: 'Employees',
        width: 120,
        align: 'right',
        headerAlign: 'right',
        filterable: false,
        sortable: false,
        valueGetter: (_value, row: CompanyRow) =>
          typeof row.numberOfEmployees === 'number' ? row.numberOfEmployees : null,
        renderCell: ({ row }: { row: CompanyRow }) =>
          textCell(
            typeof row.numberOfEmployees === 'number' ? row.numberOfEmployees.toLocaleString() : '',
          ),
      },
      {
        field: 'annualRevenueCents',
        headerName: 'Annual revenue',
        width: 150,
        align: 'right',
        headerAlign: 'right',
        filterable: false,
        sortable: false,
        valueGetter: (_value, row: CompanyRow) =>
          typeof row.annualRevenueCents === 'number' ? row.annualRevenueCents : null,
        renderCell: ({ row }: { row: CompanyRow }) =>
          textCell(
            typeof row.annualRevenueCents === 'number'
              ? formatMoney(row.annualRevenueCents, row.currency)
              : '',
          ),
      },
      // The org's company fields as optional columns (AGL-2661), read off
      // the row's own `custom` map the way the contacts list reads its own.
      ...customFieldColumns(companyFields.active),
    ],
    [members, companyFields.active, nowMs],
  )

  /*
   * The grid's own Filters panel and quick search edit the view's clauses
   * (AGL-3313); the query answers them all (AGL-3321).
   */
  const ownerOptions = useMemo(
    () =>
      members.options.map((option) => ({
        value: option.uid,
        label: crmMemberPickerLabel(option),
      })),
    [members.options],
  )
  /*
   * Each picklist's choices (AGL-3514): every value the org keeps, valued
   * by the key the query compares and captioned by the label, inactive
   * ones marked. A stored clause naming a key no longer listed stays a
   * choice, so the panel can show it and clear it.
   */
  const filterOptions = useMemo(() => {
    const options: Record<string, Array<{ value: string; label: string }>> = {
      ownerUid: ownerOptions,
    }
    for (const entry of COMPANY_PICKLIST_FILTERS) {
      const list = picklists.lists[entry.picklistId]
      const known = (list?.values ?? []).flatMap((value) => {
        const key = crmPicklistKey(value.label)
        return key ? [{ value: key, label: value.active ? value.label : `${value.label} (inactive)` }] : []
      })
      const stale = viewFilters
        .filter((clause) => clause.field === entry.column)
        .flatMap((clause) => clause.value.split(','))
        .map((value) => value.trim())
        .filter((value) => value && !known.some((option) => option.value === value))
        .map((value) => ({ value, label: value }))
      options[entry.column] = [...known, ...stale]
    }
    return options
  }, [ownerOptions, picklists.lists, viewFilters])
  const filterColumns = useMemo(
    () =>
      listFilterGridColumns(columns, COMPANY_GRID_FILTER_FIELDS, filterOptions, COMPANY_GRID_FILTER_HEADERS),
    [columns, filterOptions],
  )
  const gridFilter = useListGridFilter({
    clauses: viewFilters,
    onChange: views.setFilters,
    selectFields: COMPANY_SELECT_FIELDS,
    search: { words: searchWords, onChange: setSearchWords },
  })
  // What the query could not hold, named by the clause the reader set.
  const refused = useMemo(
    () =>
      listQueryRefusals(plan.refused, {
        fields: COMPANY_GRID_FILTER_FIELDS,
        headers: COMPANY_GRID_FILTER_HEADERS,
        options: filterOptions,
      }),
    [plan.refused, filterOptions],
  )
  /*
   * The grid's models are the view's (AGL-2617). The filter model shows the
   * view's clause in the panel as a typed one would appear — the owner's
   * stored `equals` back as the single-select `is` the panel offers — so a
   * view opened from its address reads as filtered, not as a mystery.
   */
  const grid = useCrmViewGrid(views, filterColumns, COMPANY_HIDDEN_COLUMNS)

  /** Whether anything narrows the list, so an empty one is "no match", not "none yet". */
  const narrowed = viewFilters.length > 0 || searchWords.some((word) => word.trim())

  const newCompanyButton = (
    <Button
      size="small"
      variant="contained"
      color="primary"
      disabled={!scope}
      startIcon={<MdiIcon path={mdiPlus.path} size={0.8} />}
      onClick={() => setCreateOpen(true)}
    >
      {'New company'}
    </Button>
  )

  return (
    <CardDisplay
      header={'Companies'}
      help={pluginDocsHelp('companies', { anchor: '#the-companies-list' })}
      contentGutterX
      contentGutterY
      contentBordered="all"
      HeaderProps={{
        // The record actions, top right and never clipped (AGL-3311).
        action: (
          <CrmListActions>
            <CrmImportButton resource={CRM_COMPANIES_RESOURCE} noun="companies" hostId={hostId} mappingZone="companies" />
            <CrmExportButton resource={CRM_COMPANIES_RESOURCE} hostId={hostId} filter={exportFilter} />
            {newCompanyButton}
          </CrmListActions>
        ),
      }}
    >
      <Stack spacing={1.5}>
        <Typography variant="body2" color="text.secondary">
          {'The organizations your contacts belong to. Open one to see its ' +
            'people, its deals and its open tasks, or to link a contact ' +
            'to it.'}
        </Typography>
        {/* The saved view, and the clauses narrowing it as chips (AGL-3313). */}
        <CrmListToolbar label="Company filters">
          <CrmViewsControl controller={views} allLabel="All companies" />
          <ListFilterChips
            fields={COMPANY_GRID_FILTER_FIELDS}
            headers={COMPANY_GRID_FILTER_HEADERS}
            clauses={viewFilters}
            onChange={views.setFilters}
            options={filterOptions}
            marksServed={false}
          />
        </CrmListToolbar>
        <ListQueryNotices refused={refused} notices={plan.notices} />
        <CompaniesBulkBar
          hostId={hostId}
          scope={scope}
          rows={companies}
          selected={selectedIds}
          onSelectedChange={setSelectedIds}
          members={members}
        />
        <CrmColumnOrderProvider value={grid.columnOrder}>
          <ListTable
            rowHeight={TABLE_ROW_HEIGHT}
            columns={grid.columns}
            slots={CRM_LIST_SLOTS}
            rows={companies}
            selectable={{ selected: selectedIds, onChange: setSelectedIds }}
            noRowsLabel={narrowed ? 'No companies match these filters' : 'No companies yet'}
            noRowsDescription={
              narrowed
                ? undefined
                : 'A company groups the contacts who work at one business, with its domain, owner and address. Create the first one, or link a contact to a company from their page.'
            }
            noRowsAction={narrowed ? undefined : newCompanyButton}
            onOpen={(id) => openCompany(String(id))}
            // An empty table while the read is in flight reads as "you have
            // none" rather than "these are on their way".
            loading={!scope || status === 'loading'}
            /*
             * The grid must NOT also filter. The query answers it, so a client
             * pass could only drop rows the query already matched (AGL-3321).
             */
            filterMode="server"
            filterModel={gridFilter.filterModel}
            onFilterModelChange={gridFilter.onFilterModelChange}
            quickFilter
            // Columns and sort are the view's, controlled (AGL-2617).
            columnVisibilityModel={grid.columnVisibilityModel}
            onColumnVisibilityModelChange={grid.onColumnVisibilityModelChange}
            sortModel={grid.sortModel}
            onSortModelChange={grid.onSortModelChange}
            // Paged by the footer below, so the grid must not also slice.
            hideFooter
          />
        </CrmColumnOrderProvider>
        <ListPagination
          page={page}
          pageSize={pageSize}
          rowCount={companies.length}
          hasMore={hasMore}
          onPageChange={setPage}
          onPageSizeChange={setPageSize}
        />
      </Stack>
      {/*
        Mounted only while it is open, so the list pays for none of the
        drawer's state — and a fresh mount is what seeds an empty form.
       */}
      {createOpen ? (
        <CompanyEditDrawer
          open
          onClose={() => setCreateOpen(false)}
          hostId={hostId}
          org={org}
          members={members}
          onSaved={openCompany}
        />
      ) : null}
    </CardDisplay>
  )
}
CompaniesSection.displayName = 'CompaniesSection'

export default CompaniesSection
