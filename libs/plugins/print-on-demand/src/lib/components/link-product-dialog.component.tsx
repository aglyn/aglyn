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

import EmptyStateComponent from '@aglyn/shared-ui-jsx/components/empty-state.component'
import { ListPagination } from '@aglyn/shared-ui-jsx/components/list-pagination.component'
import { StatusChip } from '@aglyn/shared-ui-jsx/components/status-chip.component'
import {
  Alert,
  Avatar,
  Button,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  List,
  ListItemAvatar,
  ListItemButton,
  ListItemText,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { POD_API_ROUTES } from '../constants/api-routes'
import type { PodCatalogEntry, PodConnectionView, PodProductLinkView } from '../model/print-on-demand'
import { usePodFetch } from './pod-api'

export interface LinkProductDialogProps {
  hostId: string
  /** The store's product to link. */
  productId: string
  productName?: string
  open: boolean
  connections: PodConnectionView[]
  onClose: () => void
  onLinked: (link: PodProductLinkView | null) => void
}

interface LinkAnswer {
  result: { matched?: number; offered?: number }
  link: PodProductLinkView | null
}

/**
 * Links a product the store already has to one of a service's (AGL-3641),
 * for a merchant moving from another store whose products came over with
 * their own words, photos and addresses. Nothing is copied: the product's
 * variants are paired with the service's by SKU, then by their choices, and
 * its paid orders are sent to the service from then on.
 */
export function LinkProductDialog(props: LinkProductDialogProps) {
  const { hostId, productId, productName, open, connections, onClose, onLinked } = props
  const request = usePodFetch()
  const [provider, setProvider] = useState(connections[0]?.provider ?? null)
  const connection = connections.find((entry) => entry.provider === provider) ?? connections[0] ?? null
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<PodCatalogEntry[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [filter, setFilter] = useState('')
  const [chosen, setChosen] = useState<PodCatalogEntry | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [done, setDone] = useState<LinkAnswer | null>(null)
  const label = connection?.providerLabel ?? 'the service'

  const load = useCallback(
    async (index: number, cursor: string | null) => {
      if (!connection) return
      setRows(null)
      setError(null)
      try {
        const answer = await request<{ products: PodCatalogEntry[]; nextCursor: string | null }>(POD_API_ROUTES.catalog, {
          query: { hostId, provider: connection.provider, ...(cursor ? { cursor } : {}) },
        })
        setRows(answer.products)
        setNext(answer.nextCursor)
        setCursors((current) => {
          const copy = current.slice(0, index + 1)
          copy[index + 1] = answer.nextCursor
          return copy
        })
      } catch (cause) {
        setRows([])
        setError((cause as Error).message)
      }
    },
    [connection, hostId, request],
  )

  useEffect(() => {
    if (!open) return
    setPage(0)
    setChosen(null)
    setDone(null)
    setFilter(productName ?? '')
    void load(0, null)
  }, [load, open, productName])

  const shown = useMemo(() => {
    const words = filter.trim().toLowerCase().split(/\s+/).filter(Boolean)
    if (!rows || words.length === 0) return rows
    const hits = rows.filter((row) => words.some((word) => row.name.toLowerCase().includes(word)))
    // A name that matches nothing still shows the whole page.
    return hits.length > 0 ? hits : rows
  }, [filter, rows])

  const link = async () => {
    if (!chosen || !connection) return
    setBusy(true)
    setError(null)
    try {
      const answer = await request<LinkAnswer>(POD_API_ROUTES.linkProduct, {
        body: { hostId, provider: connection.provider, sourceProductId: chosen.id, productId },
      })
      setDone(answer)
      onLinked(answer.link)
    } catch (cause) {
      setError((cause as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const matchedText = (answer: LinkAnswer) => {
    const offered = answer.result.offered ?? answer.link?.variants.length ?? 0
    const matched = answer.result.matched ?? 0
    const added = Math.max(0, offered - matched)
    return (
      `${matched} of ${offered} variant${offered === 1 ? '' : 's'} matched your product’s` +
      (added ? `; ${added} new one${added === 1 ? ' was' : 's were'} added at ${label}’s retail price` : '') +
      `. Your name, description, photos, prices and address are unchanged, and paid orders for it now go to ${label}. Close this product without saving and open it again to see its variants as they are now.`
    )
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="sm">
      <DialogTitle>{`Link to a ${label} product`}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {done ? (
            <Alert severity="success">{matchedText(done)}</Alert>
          ) : (
            <>
              <Typography variant="body2" color="text.secondary">
                {`Choose the ${label} product that makes this one. Its sizes and colors are matched to yours by SKU, then by name. ` +
                  `A variant ${label} does not offer is removed, because it could not be made.`}
              </Typography>
              {connections.length > 1 ? (
                <TextField
                  select
                  size="small"
                  label="Service"
                  value={connection?.provider ?? ''}
                  onChange={(event) => {
                    setProvider(event.target.value as typeof provider)
                    setChosen(null)
                  }}
                >
                  {connections.map((entry) => (
                    <MenuItem key={entry.provider} value={entry.provider}>
                      {`${entry.providerLabel} — ${entry.storeName}`}
                    </MenuItem>
                  ))}
                </TextField>
              ) : null}
              <TextField size="small" label="Find by name" value={filter} onChange={(event) => setFilter(event.target.value)} />
              {error ? <Alert severity="error">{error}</Alert> : null}
              {shown === null ? (
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
                  <CircularProgress size={18} />
                  <Typography variant="body2" color="text.secondary">
                    {`Loading your ${label} products…`}
                  </Typography>
                </Stack>
              ) : shown.length ? (
                <List dense aria-label={`${label} products`}>
                  {shown.map((row) => (
                    <ListItemButton
                      key={row.id}
                      selected={chosen?.id === row.id}
                      disabled={Boolean(row.importedProductId && row.importedProductId !== productId)}
                      onClick={() => setChosen(row)}
                    >
                      <ListItemAvatar>
                        <Avatar variant="rounded" src={row.thumbnailUrl ?? undefined} alt="" />
                      </ListItemAvatar>
                      <ListItemText
                        primary={row.name}
                        secondary={`${row.variantCount} variant${row.variantCount === 1 ? '' : 's'}`}
                      />
                      {row.importedProductId && row.importedProductId !== productId ? (
                        <StatusChip label="Already in your store" variant="outlined" />
                      ) : null}
                    </ListItemButton>
                  ))}
                </List>
              ) : (
                <EmptyStateComponent compact label={`No products at ${label} yet`} description={`Create the product at ${label} first, then link it here.`} />
              )}
              <ListPagination
                page={page}
                pageSize={connection?.provider === 'printful' ? 100 : 50}
                rowCount={rows?.length ?? 0}
                hasMore={Boolean(next)}
                disabled={busy || rows === null}
                onPageChange={(target) => {
                  if (target > page && !next) return
                  setPage(target)
                  void load(target, cursors[target] ?? null)
                }}
              />
            </>
          )}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {done ? 'Done' : 'Cancel'}
        </Button>
        {done ? null : (
          <Button variant="contained" onClick={() => void link()} disabled={!chosen || busy}>
            {busy ? 'Linking…' : 'Link'}
          </Button>
        )}
      </DialogActions>
    </Dialog>
  )
}

export default LinkProductDialog
