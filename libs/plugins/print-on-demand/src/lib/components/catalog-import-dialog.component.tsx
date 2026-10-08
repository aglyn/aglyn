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
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  LinearProgress,
  List,
  ListItem,
  ListItemAvatar,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Stack,
  Switch,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { POD_API_ROUTES } from '../constants/api-routes'
import type { PodCatalogEntry, PodConnectionView } from '../model/print-on-demand'
import { usePodFetch } from './pod-api'

/** Products sent per import request; the server refuses more. */
const IMPORT_BATCH = 5

/** How many products a service answers per page. */
const SERVICE_PAGE_SIZE = { printful: 100, printify: 50 } as const

/** Products chosen in one sitting. */
const MAX_SELECTED = 50

interface ImportResult {
  sourceProductId: string
  outcome: 'created' | 'updated' | 'unchanged' | 'failed'
  name?: string
  message?: string
  imagesSkipped?: number
}

export interface CatalogImportDialogProps {
  hostId: string
  open: boolean
  connection: PodConnectionView
  onClose: () => void
  /** Called once an import changed anything, so lists can reload. */
  onImported: () => void
}

const OUTCOME = {
  created: { label: 'Imported', tone: 'success' },
  updated: { label: 'Updated', tone: 'info' },
  unchanged: { label: 'Up to date', tone: 'neutral' },
  failed: { label: 'Not imported', tone: 'error' },
} as const

/**
 * The service's products, a page at a time, to choose from and import
 * (AGL-3641). A product already imported can be chosen again to re-sync it.
 * Imports run a few at a time, and each product's outcome is listed.
 */
export function CatalogImportDialog(props: CatalogImportDialogProps) {
  const { hostId, open, connection, onClose, onImported } = props
  const request = usePodFetch()
  const [cursors, setCursors] = useState<Array<string | null>>([null])
  const [page, setPage] = useState(0)
  const [rows, setRows] = useState<PodCatalogEntry[] | null>(null)
  const [next, setNext] = useState<string | null>(null)
  const [total, setTotal] = useState<number | undefined>(undefined)
  const [selected, setSelected] = useState<Map<string, string>>(new Map())
  const [listNow, setListNow] = useState(false)
  const [refreshContent, setRefreshContent] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [progress, setProgress] = useState<{ done: number; of: number } | null>(null)
  const [results, setResults] = useState<ImportResult[]>([])

  const load = useCallback(
    async (index: number, cursor: string | null) => {
      setRows(null)
      setError(null)
      try {
        const answer = await request<{ products: PodCatalogEntry[]; nextCursor: string | null; total: number | null }>(
          POD_API_ROUTES.catalog,
          { query: { hostId, provider: connection.provider, ...(cursor ? { cursor } : {}) } },
        )
        setRows(answer.products)
        setNext(answer.nextCursor)
        if (answer.total !== null) setTotal(answer.total)
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
    [connection.provider, hostId, request],
  )

  useEffect(() => {
    if (!open) return
    setPage(0)
    setSelected(new Map())
    setResults([])
    void load(0, null)
  }, [load, open])

  const toggle = (entry: PodCatalogEntry) =>
    setSelected((current) => {
      const copy = new Map(current)
      if (copy.has(entry.id)) copy.delete(entry.id)
      else if (copy.size < MAX_SELECTED) copy.set(entry.id, entry.name)
      return copy
    })

  const runImport = async () => {
    const ids = [...selected.keys()]
    setResults([])
    setError(null)
    setProgress({ done: 0, of: ids.length })
    const collected: ImportResult[] = []
    for (let at = 0; at < ids.length; at += IMPORT_BATCH) {
      const batch = ids.slice(at, at + IMPORT_BATCH)
      try {
        const answer = await request<{ results: ImportResult[] }>(POD_API_ROUTES.importProducts, {
          body: {
            hostId,
            provider: connection.provider,
            productIds: batch,
            status: listNow ? 'active' : 'draft',
            content: refreshContent,
          },
        })
        collected.push(...answer.results)
      } catch (cause) {
        collected.push(
          ...batch.map((id) => ({
            sourceProductId: id,
            outcome: 'failed' as const,
            name: selected.get(id),
            message: (cause as Error).message,
          })),
        )
      }
      setResults([...collected])
      setProgress({ done: Math.min(ids.length, at + batch.length), of: ids.length })
    }
    setProgress(null)
    setSelected(new Map())
    if (collected.some((result) => result.outcome !== 'failed')) onImported()
    void load(page, cursors[page] ?? null)
  }

  const busy = progress !== null
  const nameOf = (result: ImportResult) => result.name ?? selected.get(result.sourceProductId) ?? result.sourceProductId

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="md">
      <DialogTitle>{`Import from ${connection.providerLabel} — ${connection.storeName}`}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {`Choose the products to sell. Each comes in with its variants, the retail prices you set at ${connection.providerLabel} and its photos. ` +
              `Choosing one you already imported updates it from ${connection.providerLabel}.`}
          </Typography>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {rows === null ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }} role="status">
              <CircularProgress size={18} />
              <Typography variant="body2" color="text.secondary">
                {`Loading your ${connection.providerLabel} products…`}
              </Typography>
            </Stack>
          ) : rows.length ? (
            <List dense disablePadding>
              {rows.map((entry) => (
                <ListItem key={entry.id} disablePadding divider>
                  <ListItemButton onClick={() => toggle(entry)} disabled={busy}>
                    <ListItemIcon>
                      <Checkbox edge="start" checked={selected.has(entry.id)} tabIndex={-1} disableRipple slotProps={{ input: { 'aria-label': entry.name } }} />
                    </ListItemIcon>
                    <ListItemAvatar>
                      <Avatar variant="rounded" src={entry.thumbnailUrl ?? undefined} alt="">
                        {entry.name.slice(0, 1)}
                      </Avatar>
                    </ListItemAvatar>
                    <ListItemText
                      primary={entry.name}
                      secondary={`${entry.variantCount} variant${entry.variantCount === 1 ? '' : 's'}`}
                    />
                    {entry.importedProductId ? <StatusChip label="Imported" tone="success" variant="outlined" /> : null}
                  </ListItemButton>
                </ListItem>
              ))}
            </List>
          ) : (
            <EmptyStateComponent
              compact
              label={`No products at ${connection.providerLabel} yet`}
              description={`Create a product in your ${connection.providerLabel} ${connection.provider === 'printful' ? 'store' : 'shop'}, then come back to import it.`}
            />
          )}
          <ListPagination
            page={page}
            pageSize={SERVICE_PAGE_SIZE[connection.provider]}
            rowCount={rows?.length ?? 0}
            count={total}
            hasMore={Boolean(next)}
            disabled={busy || rows === null}
            onPageChange={(target) => {
              if (target > page && !next) return
              setPage(target)
              void load(target, cursors[target] ?? null)
            }}
          />
          <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
            <FormControlLabel
              control={<Switch checked={listNow} onChange={(event) => setListNow(event.target.checked)} disabled={busy} />}
              label="List new products in the store now"
            />
            <FormControlLabel
              control={<Switch checked={refreshContent} onChange={(event) => setRefreshContent(event.target.checked)} disabled={busy} />}
              label="Update names, descriptions and photos of products already imported"
            />
          </Stack>
          {progress ? (
            <Stack spacing={0.5} role="status">
              <LinearProgress variant="determinate" value={(progress.done / Math.max(1, progress.of)) * 100} />
              <Typography variant="caption" color="text.secondary">{`Imported ${progress.done} of ${progress.of}…`}</Typography>
            </Stack>
          ) : null}
          {results.length ? (
            <List dense disablePadding aria-label="Import results">
              {results.map((result) => (
                <ListItem key={result.sourceProductId} disableGutters divider>
                  <ListItemText
                    primary={nameOf(result)}
                    secondary={
                      result.outcome === 'failed'
                        ? result.message
                        : result.imagesSkipped
                          ? `${result.imagesSkipped} photo${result.imagesSkipped === 1 ? ' was' : 's were'} not copied.`
                          : undefined
                    }
                  />
                  <StatusChip label={OUTCOME[result.outcome].label} tone={OUTCOME[result.outcome].tone} />
                </ListItem>
              ))}
            </List>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {results.length ? 'Done' : 'Cancel'}
        </Button>
        <Button variant="contained" onClick={() => void runImport()} disabled={busy || selected.size === 0}>
          {selected.size ? `Import ${selected.size}` : 'Import'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default CatalogImportDialog
