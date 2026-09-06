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
  pluginDocsHelp,
} from '@aglyn/aglyn'
import { mdiPlus } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import {
  gridFilterRequest,
  listFilterColumn,
  type ListFilterRequest,
} from '@aglyn/shared-ui-jsx/const/list-filter'
import { TABLE_ROW_HEIGHT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  listFilterConstraints,
  usePagedCollection,
  useFirestore,
} from '@aglyn/tenant-feature-instance'
import { Button, Chip, Stack, Typography } from '@mui/material'
import {
  getGridSingleSelectOperators,
  type GridColDef,
} from '@mui/x-data-grid'
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { COMPANY_LIST_FILTER_FIELDS } from '../constants/company-filters'
import { useCrmScope } from '../hooks/use-crm-scope'
import { useOrgMemberOptions } from '../hooks/use-org-member-options'
import { type CompanyCsvOptions, companiesCsv } from '../model/companies-csv'
import { downloadTextFile } from '../model/contacts-csv'
import { crmRoutes } from '../model/crm-routes'
import CompaniesBulkBar from './companies-bulk-bar'
import CompanyEditDrawer from './company-edit-drawer'

export interface CompaniesSectionProps {
  hostId: string
  org?: Partial<AglynOrgBilling>
  /** The CRM hub URL, which every company route hangs beneath. */
  basePath: string
}

type CompanyRow = Partial<CrmCompany> & { $id: string; updatedAt?: any }

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
 * The scope predicate is an array clause, and Firestore carries one per
 * query, so the word-prefix search the contact list offers cannot run here.
 * The name is a prefix range and an exact match instead, and the owner is a
 * choice from the roster — each reaching the whole collection, which is the
 * property a search must have: a company on page four is found, not reported
 * missing. `COMPANY_LIST_FILTER_FIELDS` states what the indexes serve.
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
 * the table. Export CSV writes the loaded page through `companiesCsv()` —
 * the same file the bar writes over the selection, headed as the import
 * reads it — and Import CSV opens the companies drawer beside it.
 */
export function CompaniesSection(props: CompaniesSectionProps) {
  const { hostId, org, basePath } = props
  const routes = crmRoutes(basePath)
  const router = useRouter()
  const firestore = useFirestore()
  const { scope, orgId, visibleTo } = useCrmScope({ hostId, org })
  /*
   * The team, read once for this surface: the Owner column names a person
   * from a uid, and the create drawer picks from the same roster. One fetch
   * serves both, which is why the drawer takes it as a prop.
   */
  const members = useOrgMemberOptions(orgId)

  /*
   * The column filter, declared BEFORE the listener that reads it — the query
   * is rebuilt from it, so it cannot be state introduced further down.
   */
  const [filter, setFilter] = useState<ListFilterRequest | null>(null)

  const {
    rows: companies,
    status,
    hasMore,
    page,
    setPage,
    pageSize,
    setPageSize,
  } = usePagedCollection<CompanyRow>(
    (pageLimit) => {
      if (!scope) return null
      const constraints = listFilterConstraints(
        COMPANY_LIST_FILTER_FIELDS,
        filter,
      )
      return query(
        collection(firestore, scope[0], scope[1], CRM_COLLECTIONS.companies),
        where('visibleTo', 'array-contains-any', visibleTo),
        ...(constraints ?? [orderBy('updatedAt', 'desc')]),
        limit(pageLimit),
      )
    },
    [firestore, scope, visibleTo, filter],
    { idField: '$id' },
  )

  const [createOpen, setCreateOpen] = useState(false)
  const [selectedIds, setSelectedIds] = useState<string[]>([])
  /*
   * The owner is written by ADDRESS, because the companies import resolves
   * an owner by email; the same options reach the bar, so the page's file
   * and the selection's are one format.
   */
  const csvOptions: CompanyCsvOptions = useMemo(
    () => ({ ownerEmail: members.emailFor }),
    [members.emailFor],
  )
  const handleExport = useCallback(() => {
    downloadTextFile('companies.csv', 'text/csv', companiesCsv(companies, csvOptions))
  }, [companies, csvOptions])
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
          label: option.label,
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
    ],
    [members],
  )

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
      HeaderProps={{ action: newCompanyButton }}
    >
      <Stack spacing={1.5}>
        <Stack
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center', flexWrap: 'wrap', rowGap: 1 }}
        >
          <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
            {'The organizations your contacts belong to. Open one to see its ' +
              'people, its deals and its open tasks, or to link a contact ' +
              'to it.'}
          </Typography>
          <Button size="small" onClick={handleExport} disabled={!companies.length}>
            {'Export CSV'}
          </Button>
        </Stack>
        <CompaniesBulkBar
          hostId={hostId}
          scope={scope}
          rows={companies}
          selected={selectedIds}
          onSelectedChange={setSelectedIds}
          members={members}
          csv={csvOptions}
        />
        <ListTable
          rowHeight={TABLE_ROW_HEIGHT}
          columns={columns}
          rows={companies}
          selectable={{ selected: selectedIds, onChange: setSelectedIds }}
          noRowsLabel="No companies yet"
          noRowsDescription="A company groups the contacts who work at one business, with its domain, owner and address. Create the first one, or link a contact to a company from their page."
          noRowsAction={newCompanyButton}
          onOpen={(id) => openCompany(String(id))}
          // An empty table while the read is in flight reads as "you have
          // none" rather than "these are on their way".
          loading={!scope || status === 'loading'}
          /*
           * The grid must NOT also filter. The query answers it, so a client
           * pass could only drop rows the query already matched.
           */
          filterMode="server"
          onFilterModelChange={(model) => {
            const request = gridFilterRequest(model)
            setFilter(
              request && request.field === 'ownerUid' && request.op === 'is'
                ? { ...request, op: 'equals' }
                : request,
            )
          }}
          // Paged by the footer below, so the grid must not also slice.
          hideFooter
        />
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
