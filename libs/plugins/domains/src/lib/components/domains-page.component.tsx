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

import { pluginDocsHelp } from '@aglyn/aglyn/app-utils/docs-help'
import type { ConsolePluginPageProps } from '@aglyn/aglyn/plugin-manager/feature-plugins'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { BlockedControl } from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import { ListTable, type ListTableProps } from '@aglyn/shared-ui-jsx/components/list-table.component'
import { PrerequisiteNotice } from '@aglyn/shared-ui-jsx/components/prerequisite-notice.component'
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
  Stack,
  Typography,
} from '@mui/material'
import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { DOMAINS_API_ROUTES } from '../constants/bundle-common'
import { BoughtDomainPanel } from './bought-domain-panel.component'
import { DomainSearch } from './domain-search.component'
import {
  formatDay,
  formatMoney,
  useDomainsFetch,
  type DomainOfferView,
  type WorkspaceAnswer,
  type WorkspaceDomainRow,
} from './domains-api'
import { PurchaseDialog } from './purchase-dialog.component'
import { TransferInDialog } from './transfer-in-dialog.component'

/*
 * THE WORKSPACE'S DOMAINS PAGE (AGL-4040), at `/[orgSlug]/domains`.
 *
 * Every name the workspace holds — connected to a site or not, on its way
 * here, or lapsed — in one table that sorts by every column. A row opens
 * that name's own page (`/domains/<name>`): auto-renew, Renew now, connect it
 * to any site or disconnect it, the transfer code, the registrant contact
 * and the DNS records. The page's actions sit in the card header: Buy a
 * domain, which buys into the workspace, and Transfer a domain in.
 */

/** While a name is registering or connecting, the page re-reads this often. */
const POLL_MS = 5000

type Row = WorkspaceDomainRow & { $id: string; siteName: string }

/** A row's status, in a word or two, with the chip color that carries it. */
export function domainStatus(row: WorkspaceDomainRow): {
  label: string
  color: 'default' | 'info' | 'success' | 'warning' | 'error'
} {
  switch (row.status) {
    case 'charging':
    case 'registering':
      return { label: row.origin === 'transfer-in' ? 'Starting transfer' : 'Registering', color: 'info' }
    case 'transferring-in':
      return { label: 'Moving here', color: 'info' }
    case 'connecting':
      return { label: 'Connecting', color: 'info' }
    case 'expired':
      return { label: 'Expired', color: 'error' }
    case 'transferred-out':
      return { label: 'Moved away', color: 'default' }
    case 'refunded':
    case 'declined':
      return { label: 'Not completed', color: 'default' }
    default:
      if (row.renewalFailing) return { label: 'Renewal failing', color: 'error' }
      if (row.verifyByMs) return { label: 'Confirm email', color: 'warning' }
      return { label: 'Active', color: 'success' }
  }
}

/** "Renews Oct 19, 2027", "Expires …", or nothing yet. */
export function renewsLine(row: WorkspaceDomainRow): string {
  if (!row.expiresAtMs) return '—'
  if (row.status !== 'active') return `Expires ${formatDay(row.expiresAtMs)}`
  return `${row.autoRenew ? 'Renews' : 'Expires'} ${formatDay(row.expiresAtMs)}`
}

const PAGE_SORTS = {
  domain: (row: Row) => row.domain,
  site: (row: Row) => (row.connected ? row.siteName : ''),
  status: (row: Row) => domainStatus(row).label,
  expiresAtMs: (row: Row) => row.expiresAtMs ?? 0,
  autoRenew: (row: Row) => (row.autoRenew ? 1 : 0),
  renewalCents: (row: Row) => row.renewalCents,
}
const PAGE_HEADERS = {
  domain: 'Domain',
  site: 'Site',
  status: 'Status',
  expiresAtMs: 'Expires or renews',
  autoRenew: 'Auto-renew',
  renewalCents: 'Price at renewal',
}

export default function DomainsPage(props: ConsolePluginPageProps) {
  const { orgMount, basePath, segments } = props
  const orgId = orgMount?.orgId ?? ''
  const router = useRouter()
  const request = useDomainsFetch()
  const { enqueueSnackbar } = useSnackbar()
  const [state, setState] = useState<WorkspaceAnswer | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [buying, setBuying] = useState<DomainOfferView | null>(null)
  const [transferOpen, setTransferOpen] = useState(false)
  const selected = segments?.[0] ? decodeURIComponent(segments[0]).toLowerCase() : null
  const listPath = basePath ?? (orgMount?.orgSlug ? `/${orgMount.orgSlug}/domains` : '')
  const billingHref = orgMount?.billingPath ?? null

  const refresh = useCallback(async () => {
    if (!orgId) return
    try {
      setState(await request<WorkspaceAnswer>(DOMAINS_API_ROUTES.workspace, { query: { orgId } }))
      setLoadError(null)
    } catch (caught) {
      setLoadError((caught as Error).message)
    }
  }, [orgId, request])

  useEffect(() => {
    void refresh()
  }, [refresh])

  const settling = state?.rows.some((row) =>
    ['charging', 'registering', 'connecting'].includes(row.status),
  )
  useEffect(() => {
    if (!settling) return
    const timer = setInterval(() => void refresh(), POLL_MS)
    return () => clearInterval(timer)
  }, [settling, refresh])

  const sites = useMemo(
    () => (orgMount?.hosts ?? []).map((host) => ({ id: host.id, name: host.name })),
    [orgMount?.hosts],
  )
  const rows = useMemo<Row[]>(
    () =>
      (state?.rows ?? []).map((row) => ({
        ...row,
        $id: row.domain,
        siteName: sites.find((site) => site.id === row.hostId)?.name ?? '',
      })),
    [state, sites],
  )
  const columnSort = useListColumnSort<Row>({
    sorts: [],
    rows,
    pageSorts: PAGE_SORTS,
    headers: PAGE_HEADERS,
    complete: true,
  })

  const columns = useMemo<NonNullable<ListTableProps['columns']>>(
    () => [
      { field: 'domain', headerName: 'Domain', flex: 1.2, minWidth: 180 },
      {
        field: 'site',
        headerName: 'Site',
        flex: 1,
        minWidth: 150,
        valueGetter: (_value: unknown, row: Row) =>
          row.connected ? row.siteName || 'A site' : 'Not connected',
      },
      {
        field: 'status',
        headerName: 'Status',
        width: 150,
        renderCell: ({ row }: { row: Row }) => {
          const status = domainStatus(row)
          return <Chip size="small" label={status.label} color={status.color} />
        },
      },
      {
        field: 'expiresAtMs',
        headerName: 'Expires or renews',
        width: 180,
        valueGetter: (_value: unknown, row: Row) => renewsLine(row),
      },
      {
        field: 'autoRenew',
        headerName: 'Auto-renew',
        width: 120,
        valueGetter: (_value: unknown, row: Row) =>
          row.status === 'active' ? (row.autoRenew ? 'On' : 'Off') : '—',
      },
      {
        field: 'renewalCents',
        headerName: 'Price at renewal',
        width: 150,
        valueGetter: (_value: unknown, row: Row) =>
          row.renewalCents ? `${formatMoney(row.renewalCents)} a year` : '—',
      },
    ],
    [],
  )

  const help = pluginDocsHelp('manageDomains')

  if (!orgId) return null
  if (loadError && !state) return <Alert severity="warning">{loadError}</Alert>
  if (!state) return null

  if (selected) {
    const row = rows.find((candidate) => candidate.domain === selected)
    return (
      <CardDisplay
        header={selected}
        help={help}
        contentGutterX
        contentGutterY
        HeaderProps={{
          action: (
            <Button size="small" onClick={() => router.push(listPath)}>
              {'All domains'}
            </Button>
          ),
        }}
      >
        {row ? (
          <BoughtDomainPanel
            scope={{ orgId }}
            registration={row}
            billingPermission={state.billingPermission}
            billingHref={billingHref}
            onChanged={() => void refresh()}
            workspace={{ sites, siteDomains: state.siteDomains, connected: row.connected }}
          />
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'That domain isn’t in this workspace.'}
          </Typography>
        )}
      </CardDisplay>
    )
  }

  const buyBlocked = !state.canBuy
  const buyReason = state.refusal?.message ??
    (!state.entitled ? 'Domains can be bought on the Starter plan and above.' : '')
  const actions = state.configured ? (
    <Stack direction="row" spacing={1}>
      <BlockedControl blocked={buyBlocked} reason={buyReason}>
        <Button size="small" variant="contained" onClick={() => setSearchOpen(true)}>
          {'Buy a domain'}
        </Button>
      </BlockedControl>
      <BlockedControl blocked={buyBlocked} reason={buyReason}>
        <Button size="small" variant="outlined" onClick={() => setTransferOpen(true)}>
          {'Transfer a domain in'}
        </Button>
      </BlockedControl>
    </Stack>
  ) : undefined

  return (
    <CardDisplay header="Domains" help={help} contentGutterX contentGutterY HeaderProps={{ action: actions }}>
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Every domain your workspace holds here. Open one to connect it to a site, manage its renewal, its registrant contact and its DNS records, or move it to another registrar.'}
        </Typography>
        {!state.entitled ? (
          <PrerequisiteNotice href={billingHref ?? undefined} actionLabel="See plans">
            {'Buying and connecting domains is included from the Starter plan. Domains you already hold stay yours and keep renewing.'}
          </PrerequisiteNotice>
        ) : state.refusal ? (
          <PrerequisiteNotice
            href={state.refusal.code === 'no-payment-history' && billingHref ? billingHref : undefined}
            actionLabel="Open billing"
          >
            {state.refusal.message}
          </PrerequisiteNotice>
        ) : null}
        <ListTable
          aria-label="Domains"
          rows={columnSort.rows}
          columns={columns}
          columnSort={columnSort}
          hideFooter
          noRowsLabel="No domains yet"
          onOpen={(id) => router.push(`${listPath}/${encodeURIComponent(String(id))}`)}
        />
      </Stack>

      <Dialog open={searchOpen} onClose={() => setSearchOpen(false)} fullWidth maxWidth="sm">
        <DialogTitle>{'Buy a domain'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2} sx={{ pt: 0.5 }}>
            <Typography variant="body2" color="text.secondary">
              {'A name bought here goes into your workspace’s domains. Connect it to any of your sites whenever you’re ready.'}
            </Typography>
            <DomainSearch
              scope={{ orgId }}
              blocked={buyBlocked}
              blockedReason={buyReason}
              onBuy={(offer) => {
                setSearchOpen(false)
                setBuying(offer)
              }}
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setSearchOpen(false)}>{'Close'}</Button>
        </DialogActions>
      </Dialog>

      <PurchaseDialog
        open={Boolean(buying)}
        scope={{ orgId }}
        offer={buying}
        defaults={state.contactDefaults}
        intoWorkspace
        onClose={() => setBuying(null)}
        onBought={(registration) => {
          setBuying(null)
          enqueueSnackbar(`${registration.domain} is yours. Connect it to a site whenever you’re ready.`, {
            variant: 'success',
            persist: false,
          })
          void refresh()
        }}
      />

      <TransferInDialog
        open={transferOpen}
        orgId={orgId}
        defaults={state.contactDefaults}
        onClose={() => setTransferOpen(false)}
        onStarted={(registration) => {
          setTransferOpen(false)
          enqueueSnackbar(`The transfer of ${registration.domain} has started. We’ll email you when it arrives.`, {
            variant: 'success',
            persist: false,
          })
          void refresh()
        }}
      />
    </CardDisplay>
  )
}
