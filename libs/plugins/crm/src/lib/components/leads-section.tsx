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

import * as Aglyn from '@aglyn/aglyn'
import type { ConsolePluginPageProps, CrmLeadFields, CrmLeadStatus } from '@aglyn/aglyn'
import { mdiAccountArrowRight, mdiAccountCancelOutline, mdiAccountTieOutline } from '@aglyn/shared-data-mdi'
import { CardDisplay, MdiIcon } from '@aglyn/shared-ui-jsx'
import { ListTable } from '@aglyn/shared-ui-jsx/components/list-table.component'
import RowActionsMenu from '@aglyn/shared-ui-jsx/components/row-actions-menu.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  InputLabel,
  MenuItem,
  Select,
  Stack,
  Typography,
} from '@mui/material'
import type { GridColDef } from '@mui/x-data-grid'
import {
  collection,
  deleteField,
  doc,
  limit,
  orderBy,
  query,
  serverTimestamp,
  updateDoc,
} from 'firebase/firestore'
import { useRouter } from 'next/navigation'
import { useCallback, useMemo, useState } from 'react'
import { crmRoutes } from '../model/crm-routes'
import {
  LEAD_FILTER_LABELS,
  LEAD_FILTERS,
  type LeadFilter,
  leadMatchesFilter,
} from '../model/lead-filters'
import { leadSourceLabel, leadSources, leadTimeLabel } from './lead-history-card'
import {
  LeadOwnerSelect,
  type OrgMemberOptions,
  useOrgMemberOptions,
} from './lead-owner-select'
import { LeadStatusChip } from './lead-status-chip'
import { LeadUnqualifyDialog } from './lead-unqualify-dialog'

/**
 * How many leads the section reads: the newest by last seen, plus one probe
 * row so "there are more" is a fact rather than a guess at the boundary.
 *
 * A CEILING and a client-side filter rather than a paged status query, and
 * the reason is the lead documents themselves. Every lead the capture door
 * writes carries NO `status` — the field exists only once somebody in the
 * CRM has touched the lead — and Firestore cannot select documents by a
 * field's absence: `where('status','in',[…])`, `!=` and `not-in` all skip a
 * document without the field. A server-side "open leads" query would
 * therefore hide every lead nobody has worked yet, which is the entire
 * population the section exists to show on the day it ships. So the query
 * is the one order every lead can satisfy (`lastSeenAtMs`, stamped on every
 * capture), and the status filter narrows the loaded window — said out loud
 * beneath the table whenever the window is not the whole collection.
 */
const LEADS_WINDOW = 200

type LeadRow = Record<string, unknown> & CrmLeadFields & { $id: string }

/**
 * `/crm/leads` — the people a site has met but not yet qualified (AGL-2608).
 *
 * A section of its own, the way Salesforce keeps Leads apart from Contacts:
 * a lead is a capture — a form, a booking, a sign-up — that somebody has
 * still to work, and it converts into a contact, a company and a deal when
 * it is real. Reads `hosts/{hostId}/leads`, host-scoped by path, so there is
 * no `visibleTo` filter; the Firestore rules admit any member of the site to
 * read it and an admin, editor or author to update it, which is what makes
 * the inline status and owner changes client-direct writes.
 */
export function CrmLeadsSection(props: ConsolePluginPageProps) {
  const { hostId, basePath } = props
  const firestore = useFirestore()
  const router = useRouter()
  const { enqueueSnackbar } = useSnackbar()
  const { orgId } = useOrgDataScope({ hostId })
  const roster = useOrgMemberOptions(orgId)
  const routes = crmRoutes(basePath ?? '')

  const { data: leadDocs, status } = useFirestoreCollection<LeadRow>(
    () =>
      query(
        collection(firestore, 'hosts', hostId, 'leads'),
        orderBy('lastSeenAtMs', 'desc'),
        limit(LEADS_WINDOW + 1),
      ),
    [firestore, hostId],
    { idField: '$id' },
  )
  const truncated = leadDocs.length > LEADS_WINDOW
  const window = useMemo(() => leadDocs.slice(0, LEADS_WINDOW), [leadDocs])

  const [filter, setFilter] = useState<LeadFilter>('open')
  const rows = useMemo(
    () => window.filter((lead) => leadMatchesFilter(lead, filter)),
    [window, filter],
  )

  const [assigning, setAssigning] = useState<LeadRow | null>(null)
  const [unqualifying, setUnqualifying] = useState<LeadRow | null>(null)

  const writeLead = useCallback(
    async (leadId: string, fields: Record<string, unknown>, done: string) => {
      try {
        await updateDoc(doc(firestore, 'hosts', hostId, 'leads', leadId), {
          ...fields,
          updatedAt: serverTimestamp(),
        })
        enqueueSnackbar(done, { variant: 'success', persist: false })
      } catch (error) {
        enqueueSnackbar(
          error instanceof Error ? error.message : 'The lead could not be updated.',
          { variant: 'error' },
        )
      }
    },
    [firestore, hostId, enqueueSnackbar],
  )

  const columns = useMemo<GridColDef[]>(
    () => [
      {
        field: 'name',
        headerName: 'Lead',
        flex: 1.4,
        minWidth: 160,
        valueGetter: (_value, row: LeadRow) => String(row['name'] || row['email'] || ''),
        renderCell: ({ row }: { row: LeadRow }) => (
          <Stack spacing={0} sx={{ minWidth: 0, justifyContent: 'center', height: '100%' }}>
            <Typography variant="body2" noWrap>
              {String(row['name'] || row['email'] || row.$id)}
            </Typography>
            {row['name'] ? (
              <Typography variant="caption" color="text.secondary" noWrap>
                {String(row['email'] ?? '')}
              </Typography>
            ) : null}
          </Stack>
        ),
      },
      {
        field: 'status',
        headerName: 'Status',
        flex: 0.9,
        minWidth: 150,
        valueGetter: (_value, row: LeadRow) => Aglyn.crmLeadStatus(row),
        renderCell: ({ row }: { row: LeadRow }) => (
          <InlineStatus
            lead={row}
            onChange={(next) => {
              if (next === 'unqualified') {
                setUnqualifying(row)
                return
              }
              void writeLead(
                row.$id,
                {
                  status: next,
                  ...(Aglyn.crmLeadStatus(row) === 'unqualified'
                    ? { unqualifiedReason: deleteField() }
                    : {}),
                },
                'Status updated',
              )
            }}
          />
        ),
      },
      {
        field: 'ownerUid',
        headerName: 'Owner',
        flex: 1,
        minWidth: 140,
        valueGetter: (_value, row: LeadRow) => roster.labelFor(row.ownerUid),
      },
      {
        field: 'sources',
        headerName: 'Source',
        flex: 1,
        minWidth: 140,
        valueGetter: (_value, row: LeadRow) =>
          leadSources(row).map(leadSourceLabel).join(', '),
      },
      {
        field: 'lastSeenAtMs',
        headerName: 'Last seen',
        flex: 0.9,
        minWidth: 160,
        valueGetter: (_value, row: LeadRow) =>
          leadTimeLabel(row['lastSeenAtMs'] ?? row['createdAt']),
      },
      {
        field: 'actions',
        headerName: '',
        width: 56,
        sortable: false,
        filterable: false,
        disableColumnMenu: true,
        renderCell: ({ row }: { row: LeadRow }) => (
          <Box
            onClick={(event) => event.stopPropagation()}
            sx={{ display: 'flex', alignItems: 'center', height: '100%' }}
          >
            <RowActionsMenu
              label={String(row['email'] ?? row.$id)}
              items={[
                {
                  key: 'open',
                  label: 'Open lead',
                  icon: <MdiIcon path={mdiAccountArrowRight.path} size={0.8} />,
                  href: routes.lead(row.$id),
                },
                {
                  key: 'assign',
                  label: 'Assign owner',
                  icon: <MdiIcon path={mdiAccountTieOutline.path} size={0.8} />,
                  onClick: () => setAssigning(row),
                },
                {
                  key: 'unqualify',
                  label: 'Unqualify',
                  icon: <MdiIcon path={mdiAccountCancelOutline.path} size={0.8} />,
                  onClick: () => setUnqualifying(row),
                  disabled: !Aglyn.isCrmLeadOpen(row) || Boolean(row.convertedContactId),
                  disabledReason: row.convertedContactId
                    ? 'This lead was converted'
                    : 'This lead is already closed',
                },
              ]}
            />
          </Box>
        ),
      },
    ],
    [roster, routes, writeLead],
  )

  return (
    <>
      <CardDisplay
        header={'Leads'}
        help={Aglyn.pluginDocsHelp('contacts', { anchor: '#whats-in-the-crm-area' })}
        actions={
          <FormControl size="small" sx={{ minWidth: 160 }}>
            <InputLabel>{'Show'}</InputLabel>
            <Select
              label="Show"
              value={filter}
              onChange={(event) => setFilter(event.target.value as LeadFilter)}
            >
              {LEAD_FILTERS.map((option) => (
                <MenuItem key={option} value={option}>
                  {LEAD_FILTER_LABELS[option]}
                </MenuItem>
              ))}
            </Select>
          </FormControl>
        }
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          {status === 'success' && window.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {'No leads yet — sign-ups, bookings and form submissions on your ' +
                'site become leads automatically.'}
            </Typography>
          ) : status === 'success' && rows.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              {`No ${LEAD_FILTER_LABELS[filter].toLowerCase()} leads among the ` +
                `${window.length.toLocaleString()} most recently seen.`}
            </Typography>
          ) : (
            <ListTable
              rows={rows}
              columns={columns}
              loading={status === 'loading'}
              onOpen={(id) => router.push(routes.lead(id))}
            />
          )}
          {truncated ? (
            <Alert severity="info">
              {`Showing the ${LEADS_WINDOW.toLocaleString()} most recently seen ` +
                'leads. The status filter narrows these; older leads are still ' +
                'listed in the Inbox and reached by campaign audiences.'}
            </Alert>
          ) : null}
        </Stack>
      </CardDisplay>
      <AssignOwnerDialog
        lead={assigning}
        roster={roster}
        onClose={() => setAssigning(null)}
        onAssign={(uid) => {
          if (!assigning) return
          void writeLead(
            assigning.$id,
            { ownerUid: uid || deleteField() },
            uid ? 'Owner assigned' : 'Owner cleared',
          )
          setAssigning(null)
        }}
      />
      <LeadUnqualifyDialog
        open={Boolean(unqualifying)}
        onClose={() => setUnqualifying(null)}
        hostId={hostId}
        leadId={unqualifying?.$id ?? ''}
        leadLabel={String(unqualifying?.['name'] || unqualifying?.['email'] || '')}
      />
    </>
  )
}
CrmLeadsSection.displayName = 'CrmLeadsSection'

/**
 * The status, editable in place for a lead that is still open.
 *
 * A converted lead shows the chip alone: its status IS the conversion, and
 * the route stamped it. The select stops its click from reaching the row, or
 * every status change would also open the record.
 */
function InlineStatus(props: {
  lead: LeadRow
  onChange: (next: CrmLeadStatus) => void
}) {
  const { lead, onChange } = props
  if (lead.convertedContactId) {
    return (
      <Box sx={{ display: 'flex', alignItems: 'center', height: '100%' }}>
        <LeadStatusChip lead={lead} />
      </Box>
    )
  }
  const status = Aglyn.crmLeadStatus(lead)
  return (
    <Box
      onClick={(event) => event.stopPropagation()}
      sx={{ display: 'flex', alignItems: 'center', height: '100%', width: '100%' }}
    >
      <Select
        size="small"
        variant="standard"
        disableUnderline
        value={status}
        onChange={(event) => onChange(event.target.value as CrmLeadStatus)}
        renderValue={() => <LeadStatusChip lead={lead} />}
        sx={{ width: '100%' }}
      >
        <MenuItem value="new">{Aglyn.CRM_LEAD_STATUS_LABELS.new}</MenuItem>
        <MenuItem value="working">{Aglyn.CRM_LEAD_STATUS_LABELS.working}</MenuItem>
        <MenuItem value="unqualified">{`${Aglyn.CRM_LEAD_STATUS_LABELS.unqualified}…`}</MenuItem>
      </Select>
    </Box>
  )
}
InlineStatus.displayName = 'InlineStatus'

/** Hand a lead to a team member. */
function AssignOwnerDialog(props: {
  lead: LeadRow | null
  roster: OrgMemberOptions
  onClose: () => void
  onAssign: (uid: string) => void
}) {
  const { lead, roster, onClose, onAssign } = props
  const [uid, setUid] = useState<string | null>(null)
  const current = uid ?? String(lead?.ownerUid ?? '')
  return (
    <Dialog
      open={Boolean(lead)}
      onClose={onClose}
      maxWidth="xs"
      fullWidth
      slotProps={{ transition: { onExited: () => setUid(null) } }}
    >
      <DialogTitle>{`Assign ${String(lead?.['name'] || lead?.['email'] || 'lead')}`}</DialogTitle>
      <DialogContent>
        <Box sx={{ pt: 1 }}>
          <LeadOwnerSelect value={current} onChange={setUid} roster={roster} size="medium" />
        </Box>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Cancel'}</Button>
        <Button variant="contained" onClick={() => onAssign(current)}>
          {'Assign'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
AssignOwnerDialog.displayName = 'AssignOwnerDialog'

export default CrmLeadsSection
