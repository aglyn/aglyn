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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import ScrollTable from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import { TABLE_PAGE_SIZE_DEFAULT } from '@aglyn/shared-ui-jsx/const/table-pagination'
import {
  Alert,
  Button,
  Chip,
  CircularProgress,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  ToggleButton,
  ToggleButtonGroup,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useRef, useState } from 'react'
import { formatMoney } from '../model/accounting-money'
import type { AccountingProviderId, AccountingSyncItemView, AccountingSyncStatus } from '../model/accounting.types'
import { accountingDocsHelp } from './accounting-connection-section'
import { useAccountingApi, type AccountingApi } from './use-accounting-api'

export interface AccountingActivitySectionProps {
  orgId: string | null
  /** Test seam: the API; the routes by default. */
  api?: AccountingApi
  /** Which list opens first. */
  initialFilter?: 'all' | 'attention'
}

const STATUS_CHIPS: Readonly<Record<AccountingSyncStatus, { label: string; color: 'default' | 'success' | 'warning' | 'error' }>> = {
  pending: { label: 'Waiting', color: 'default' },
  synced: { label: 'Posted', color: 'success' },
  needs_attention: { label: 'Needs attention', color: 'error' },
  skipped: { label: 'Skipped', color: 'warning' },
}

type Load =
  | { status: 'loading' }
  | { status: 'error'; message: string }
  | { status: 'ready'; items: AccountingSyncItemView[]; nextBefore: number | null }

/**
 * The Sync activity section of the Accounting page (AGL-3614): everything
 * posted, waiting or skipped, newest first, and the items that need a person
 * with the reason and a Retry button each.
 *
 * The log route answers in batches behind a `before` cursor, so the footer
 * pages a SLICE of the batches read so far and reads the next batch when a
 * page is turned past them — the way the CRM activity list widens its window.
 */
export function AccountingActivitySection(props: AccountingActivitySectionProps) {
  const routesApi = useAccountingApi(props.orgId)
  const api = props.api ?? routesApi
  const [filter, setFilter] = useState<'all' | 'attention'>(props.initialFilter ?? 'attention')
  const [load, setLoad] = useState<Load>({ status: 'loading' })
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<{ severity: 'success' | 'error'; text: string } | null>(null)
  const [page, setPage] = useState(0)
  const [pageSize, setPageSize] = useState(TABLE_PAGE_SIZE_DEFAULT)
  const reading = useRef(false)
  // Only which guide the help opens depends on it, so a failed read leaves
  // the default guide in place.
  const [provider, setProvider] = useState<AccountingProviderId | null>(null)

  useEffect(() => {
    let live = true
    Promise.resolve(api.status())
      .then((status) => {
        if (live) setProvider(status?.connection?.provider ?? null)
      })
      .catch(() => undefined)
    return () => {
      live = false
    }
  }, [api])

  const read = useCallback(
    async (before: number | null = null) => {
      reading.current = true
      try {
        const page = await api.log({ filter, before })
        setLoad((current) => ({
          status: 'ready',
          items: before && current.status === 'ready' ? [...current.items, ...page.items] : page.items,
          nextBefore: page.nextBefore,
        }))
      } catch (error) {
        setLoad({ status: 'error', message: error instanceof Error ? error.message : String(error) })
      } finally {
        reading.current = false
      }
    },
    [api, filter],
  )

  useEffect(() => {
    setLoad({ status: 'loading' })
    setPage(0)
    void read()
  }, [read])

  // A page past the batches read so far reads the next batch.
  const loadedCount = load.status === 'ready' ? load.items.length : 0
  const nextBefore = load.status === 'ready' ? load.nextBefore : null
  useEffect(() => {
    if (nextBefore && !reading.current && (page + 1) * pageSize > loadedCount) {
      void read(nextBefore)
    }
  }, [loadedCount, nextBefore, page, pageSize, read])

  const retry = async (input: { itemId: string } | { all: true }) => {
    setBusy(true)
    setMessage(null)
    try {
      const { retried } = await api.retry(input)
      setMessage({
        severity: 'success',
        text: retried ? `${retried} ${retried === 1 ? 'item' : 'items'} will be posted again on the next sync.` : 'Nothing needed a retry.',
      })
      await read()
    } catch (error) {
      setMessage({ severity: 'error', text: error instanceof Error ? error.message : String(error) })
    } finally {
      setBusy(false)
    }
  }

  const attentionCount = load.status === 'ready' && filter === 'attention' ? load.items.length : 0
  const pageItems =
    load.status === 'ready' ? load.items.slice(page * pageSize, (page + 1) * pageSize) : []

  return (
    <CardDisplay
      header="Sync activity"
      help={accountingDocsHelp(
        provider,
        '#when-something-does-not-post',
        'Everything posted, waiting or skipped. Needs attention lists what your books refused, with the reason; fix the cause, then retry.',
      )}
      contentGutterX
      contentGutterY
      HeaderProps={{
        action: (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
            <ToggleButtonGroup
              size="small"
              exclusive
              value={filter}
              onChange={(_, value) => value && setFilter(value)}
              aria-label="Which items"
            >
              <ToggleButton value="attention">Needs attention</ToggleButton>
              <ToggleButton value="all">All</ToggleButton>
            </ToggleButtonGroup>
            {attentionCount ? (
              <Button disabled={busy} onClick={() => void retry({ all: true })}>
                Retry all
              </Button>
            ) : null}
          </Stack>
        ),
      }}
    >
      <Stack spacing={1.5}>
        {message ? (
          <Alert severity={message.severity} onClose={() => setMessage(null)}>
            {message.text}
          </Alert>
        ) : null}
        {load.status === 'loading' ? (
          <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
            <CircularProgress size={18} />
            <Typography variant="body2" color="text.secondary">
              Loading sync activity…
            </Typography>
          </Stack>
        ) : load.status === 'error' ? (
          <Alert severity="error">{load.message}</Alert>
        ) : !load.items.length ? (
          <Typography variant="body2" color="text.secondary">
            {filter === 'attention' ? 'Nothing needs your attention.' : 'Nothing has been synced yet.'}
          </Typography>
        ) : (
          <>
            <ScrollTable size="small">
              <TableHead>
                <TableRow>
                  <TableCell>Item</TableCell>
                  <TableCell>Document</TableCell>
                  <TableCell align="right">Amount</TableCell>
                  <TableCell>Date</TableCell>
                  <TableCell>Status</TableCell>
                  <TableCell />
                </TableRow>
              </TableHead>
              <TableBody>
                {pageItems.map((item) => (
                  <TableRow key={item.id}>
                    <TableCell>
                      <Typography variant="body2">{item.label}</Typography>
                      {item.lastError && item.status !== 'synced' ? (
                        <Typography variant="caption" color={item.status === 'needs_attention' ? 'error' : 'text.secondary'}>
                          {item.lastError}
                        </Typography>
                      ) : null}
                    </TableCell>
                    <TableCell>{item.externalId}</TableCell>
                    <TableCell align="right">{formatMoney(item.amountCents, item.currency)}</TableCell>
                    <TableCell>{new Date(item.occurredAtMs).toLocaleDateString()}</TableCell>
                    <TableCell>
                      <Chip size="small" label={STATUS_CHIPS[item.status].label} color={STATUS_CHIPS[item.status].color} />
                    </TableCell>
                    <TableCell align="right">
                      {item.status === 'needs_attention' ? (
                        <Button size="small" disabled={busy} onClick={() => void retry({ itemId: item.id })}>
                          Retry
                        </Button>
                      ) : null}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ScrollTable>
            <ListPagination
              page={page}
              pageSize={pageSize}
              rowCount={pageItems.length}
              hasMore={load.items.length > (page + 1) * pageSize || Boolean(load.nextBefore)}
              onPageChange={setPage}
              onPageSizeChange={(next) => {
                setPageSize(next)
                setPage(0)
              }}
            />
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}
AccountingActivitySection.displayName = 'AccountingActivitySection'

export default AccountingActivitySection
