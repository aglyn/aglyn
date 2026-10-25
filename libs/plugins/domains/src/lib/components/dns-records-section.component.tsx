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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { ListTable, type ListTableProps } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { useListColumnSort } from '@aglyn/shared-ui-jsx/hooks/use-list-column-sort'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  InputAdornment,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import {
  CAA_TAGS,
  DNS_EDITABLE_TYPES,
  DNS_TTL_OPTIONS,
  DNS_TYPE_HELP,
  recordHostLabel,
  toRecordInput,
  type CaaTag,
  type DnsEditableType,
  type DnsRecordInput,
  type DnsRecordView,
} from '../model/dns-records'
import { DomainsRequestError, useDomainsFetch, type DnsAnswer } from './domains-api'

/*
 * DNS RECORDS (AGL-4040), for a name on our nameservers: the list, each
 * record one click from a form of ordinary fields. The records Aglyn keeps
 * for the site the name serves are listed, labeled, and never editable here.
 * A name on another provider's nameservers gets the reason and no editor:
 * its records live there.
 */

/** The chip on a record the platform keeps, in the deployment's own brand. */
export const MANAGED_LABEL = `Managed by ${PLATFORM_BRAND_NAME}`

const CAA_TAG_LABELS: Record<CaaTag, string> = {
  issue: 'May issue certificates',
  issuewild: 'May issue wildcard certificates',
  iodef: 'Where to report problems',
}

const FIELD_NAMES: Record<string, string> = {
  type: 'Type',
  name: 'Name',
  value: 'Value',
  priority: 'Priority',
  weight: 'Weight',
  port: 'Port',
  ttl: 'TTL',
  caaTag: 'What it allows',
}

/** The value field's label for each type. */
export function valueLabel(type: DnsEditableType): string {
  switch (type) {
    case 'A':
      return 'IPv4 address'
    case 'AAAA':
      return 'IPv6 address'
    case 'ALIAS':
    case 'CNAME':
      return 'Points to (host name)'
    case 'MX':
      return 'Mail server'
    case 'SRV':
      return 'Target host'
    case 'CAA':
      return 'Certificate authority, or a report address'
    default:
      return 'Text'
  }
}

const blankRecord = (): DnsRecordInput => ({ type: 'TXT', name: '', value: '', ttl: null })

const numberOrNull = (value: string): number | null => (value.trim() === '' ? null : Number(value))

const ttlLabel = (ttl: number | null): string =>
  DNS_TTL_OPTIONS.find((option) => option.seconds === ttl)?.label ?? (ttl ? `${ttl} seconds` : 'Automatic')

type RecordRow = DnsRecordView & { $id: string }

const RECORD_SORTS = {
  type: (row: RecordRow) => row.type,
  name: (row: RecordRow) => row.name,
  value: (row: RecordRow) => row.value,
  ttl: (row: RecordRow) => row.ttl ?? 0,
}
const RECORD_HEADERS = { type: 'Type', name: 'Name', value: 'Value', ttl: 'TTL' }

export interface DnsRecordsSectionProps {
  orgId: string
  domain: string
}

export function DnsRecordsSection(props: DnsRecordsSectionProps) {
  const { orgId, domain } = props
  const request = useDomainsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [answer, setAnswer] = useState<DnsAnswer | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [editing, setEditing] = useState<{ id: string | null; record: DnsRecordInput } | null>(null)
  const [badFields, setBadFields] = useState<string[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    try {
      setAnswer(await request<DnsAnswer>(DOMAINS_API_ROUTES.dns, { query: { orgId, domain } }))
      setLoadError(null)
    } catch (caught) {
      setLoadError((caught as Error).message)
    }
  }, [request, orgId, domain])

  useEffect(() => {
    void load()
  }, [load])

  const rows = useMemo<RecordRow[]>(
    () => (answer?.records ?? []).map((record) => ({ ...record, $id: record.id })),
    [answer],
  )
  const columnSort = useListColumnSort<RecordRow>({
    sorts: [],
    rows,
    pageSorts: RECORD_SORTS,
    headers: RECORD_HEADERS,
    complete: true,
  })

  const columns = useMemo<NonNullable<ListTableProps['columns']>>(
    () => [
      { field: 'type', headerName: 'Type', width: 90 },
      {
        field: 'name',
        headerName: 'Name',
        flex: 1,
        minWidth: 180,
        renderCell: ({ row }: { row: RecordRow }) => (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center', height: '100%' }}>
            <span>{recordHostLabel(row.name, domain)}</span>
            {row.managed ? <Chip size="small" label={MANAGED_LABEL} /> : null}
          </Stack>
        ),
      },
      {
        field: 'value',
        headerName: 'Value',
        flex: 1.5,
        minWidth: 200,
        valueGetter: (_value: unknown, row: RecordRow) =>
          row.priority !== null && row.type === 'MX' ? `${row.priority} ${row.value}` : row.value,
      },
      {
        field: 'ttl',
        headerName: 'TTL',
        width: 110,
        valueGetter: (_value: unknown, row: RecordRow) => ttlLabel(row.ttl),
      },
    ],
    [domain],
  )

  const open = (row: RecordRow | null) => {
    setBadFields([])
    setError(null)
    if (!row) {
      setEditing({ id: null, record: blankRecord() })
      return
    }
    const record = toRecordInput(row)
    if (!record || row.managed) return
    setEditing({ id: row.id, record })
  }

  const write = async (action: 'create' | 'update' | 'delete') => {
    if (!editing) return
    setBusy(true)
    setError(null)
    setBadFields([])
    try {
      await request(DOMAINS_API_ROUTES.dns, {
        body: {
          orgId,
          domain,
          action,
          ...(editing.id ? { recordId: editing.id } : {}),
          ...(action === 'delete' ? {} : { record: editing.record }),
        },
      })
      setEditing(null)
      enqueueSnackbar(
        action === 'create' ? 'Record added' : action === 'update' ? 'Record saved' : 'Record deleted',
        { variant: 'success', persist: false },
      )
      void load()
    } catch (caught) {
      const fields = caught instanceof DomainsRequestError ? caught.payload['fields'] : null
      if (Array.isArray(fields) && fields.length) {
        setBadFields(fields.map(String))
        setError(`Check these fields: ${fields.map((field) => FIELD_NAMES[String(field)] ?? field).join(', ')}.`)
      } else {
        setError((caught as Error).message)
      }
    } finally {
      setBusy(false)
    }
  }

  if (loadError) return <Alert severity="warning">{loadError}</Alert>
  if (!answer) return null

  if (!answer.ours) {
    return (
      <Stack spacing={1.5}>
        <Typography variant="subtitle1" component="h3">
          {'DNS records'}
        </Typography>
        <Alert severity="info">
          {`${domain} uses ${answer.nameservers.length ? answer.nameservers.join(', ') : 'another provider’s nameservers'} for its DNS, so its records are kept and edited there, not here. Anything already using the domain keeps working.`}
        </Alert>
      </Stack>
    )
  }

  const record = editing?.record
  const set = (patch: Partial<DnsRecordInput>) =>
    setEditing((current) => (current ? { ...current, record: { ...current.record, ...patch } } : current))

  return (
    <Stack spacing={1.5}>
      <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
        <Typography variant="subtitle1" component="h3">
          {'DNS records'}
        </Typography>
        <Button size="small" variant="outlined" onClick={() => open(null)}>
          {'Add record'}
        </Button>
      </Stack>
      {answer.siteConnected ? (
        <Typography variant="body2" color="text.secondary">
          {`Records marked ${MANAGED_LABEL} are how visitors reach your site at this domain and keep its security certificate working, so they can’t be changed here.`}
        </Typography>
      ) : null}
      <ListTable
        aria-label={`DNS records for ${domain}`}
        rows={columnSort.rows}
        columns={columns}
        columnSort={columnSort}
        hideFooter
        noRowsLabel="No records yet"
        onOpen={(_id, row) => open(row as RecordRow)}
      />

      <Dialog open={Boolean(editing)} onClose={busy ? undefined : () => setEditing(null)} fullWidth maxWidth="sm">
        <DialogTitle>{editing?.id ? 'Edit record' : 'Add a record'}</DialogTitle>
        <DialogContent>
          {record ? (
            <Stack spacing={2} sx={{ pt: 0.5 }}>
              <TextField
                select
                label="Type"
                value={record.type}
                onChange={(event) =>
                  set({ type: event.target.value as DnsEditableType, priority: null, weight: null, port: null, caaTag: null })
                }
                disabled={busy || Boolean(editing?.id)}
                size="small"
                helperText={DNS_TYPE_HELP[record.type]}
              >
                {DNS_EDITABLE_TYPES.map((type) => (
                  <MenuItem key={type} value={type}>
                    {type}
                  </MenuItem>
                ))}
              </TextField>
              <TextField
                label="Name"
                value={record.name}
                onChange={(event) => set({ name: event.target.value })}
                error={badFields.includes('name')}
                disabled={busy}
                size="small"
                helperText={
                  record.type === 'CNAME'
                    ? 'The subdomain, like shop or blog.'
                    : 'Leave empty for the domain itself, or enter a subdomain like shop.'
                }
                slotProps={{
                  input: { endAdornment: <InputAdornment position="end">{`.${domain}`}</InputAdornment> },
                }}
              />
              {record.type === 'CAA' ? (
                <TextField
                  select
                  label="What it allows"
                  value={record.caaTag ?? ''}
                  onChange={(event) => set({ caaTag: event.target.value as CaaTag })}
                  error={badFields.includes('caaTag')}
                  disabled={busy}
                  size="small"
                >
                  {CAA_TAGS.map((tag) => (
                    <MenuItem key={tag} value={tag}>
                      {CAA_TAG_LABELS[tag]}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              <TextField
                label={valueLabel(record.type)}
                value={record.value}
                onChange={(event) => set({ value: event.target.value })}
                error={badFields.includes('value')}
                disabled={busy}
                size="small"
                multiline={record.type === 'TXT'}
              />
              {record.type === 'MX' || record.type === 'SRV' ? (
                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                  <TextField
                    label="Priority"
                    type="number"
                    value={record.priority ?? ''}
                    onChange={(event) => set({ priority: numberOrNull(event.target.value) })}
                    error={badFields.includes('priority')}
                    disabled={busy}
                    size="small"
                    helperText="Lower is tried first."
                    sx={{ flex: 1 }}
                  />
                  {record.type === 'SRV' ? (
                    <>
                      <TextField
                        label="Weight"
                        type="number"
                        value={record.weight ?? ''}
                        onChange={(event) => set({ weight: numberOrNull(event.target.value) })}
                        error={badFields.includes('weight')}
                        disabled={busy}
                        size="small"
                        sx={{ flex: 1 }}
                      />
                      <TextField
                        label="Port"
                        type="number"
                        value={record.port ?? ''}
                        onChange={(event) => set({ port: numberOrNull(event.target.value) })}
                        error={badFields.includes('port')}
                        disabled={busy}
                        size="small"
                        sx={{ flex: 1 }}
                      />
                    </>
                  ) : null}
                </Stack>
              ) : null}
              <TextField
                select
                label="TTL"
                value={String(record.ttl ?? '')}
                onChange={(event) => set({ ttl: numberOrNull(event.target.value) })}
                disabled={busy}
                size="small"
                helperText="How long other networks may remember the record."
              >
                {DNS_TTL_OPTIONS.map((option) => (
                  <MenuItem key={option.label} value={String(option.seconds ?? '')}>
                    {option.label}
                  </MenuItem>
                ))}
              </TextField>
              {error ? <Alert severity="error">{error}</Alert> : null}
            </Stack>
          ) : null}
        </DialogContent>
        <DialogActions>
          {editing?.id ? (
            <Button color="error" onClick={() => void write('delete')} disabled={busy} sx={{ mr: 'auto' }}>
              {'Delete'}
            </Button>
          ) : null}
          <Button onClick={() => setEditing(null)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button variant="contained" onClick={() => void write(editing?.id ? 'update' : 'create')} disabled={busy}>
            {busy ? 'Saving…' : editing?.id ? 'Save' : 'Add record'}
          </Button>
        </DialogActions>
      </Dialog>
    </Stack>
  )
}
