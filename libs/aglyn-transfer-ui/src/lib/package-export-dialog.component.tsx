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

/**
 * Exporting part of a site as a package (AGL-3534): pick items by kind, and
 * say whether the file carries what they need — the closure is shown before
 * anything downloads, so a page never arrives without its layout by
 * surprise. "Everything" is the whole-site backup.
 */

import { packageDependencyClosure, packageItemKey } from '@aglyn/aglyn/data-transfer'
import {
  Alert,
  Box,
  Button,
  Checkbox,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  Stack,
  Switch,
  TextField,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'

import type { SitePackageCatalog, SitePackageClient } from './site-package-client'
import { packageItemTitle } from './site-package-import-state'
import { downloadTransferFile } from './transfer-export-dialog.component'
import { countOf } from './transfer-words'

export interface PackageExportDialogProps {
  open: boolean
  onClose(): void
  client: SitePackageClient
  /** Saves the file; defaults to a browser download. */
  download?(fileName: string, body: Blob): void
}

/** The route's own ceiling on a selection: past it, export everything. */
export const SITE_PACKAGE_SELECTION_MAX = 5000

const message = (error: unknown) =>
  error instanceof Error && error.message ? error.message : 'Something went wrong. Try again.'

export function PackageExportDialog({ open, onClose, client, download = downloadTransferFile }: PackageExportDialogProps) {
  const [catalog, setCatalog] = useState<SitePackageCatalog | null>(null)
  const [selected, setSelected] = useState<string[]>([])
  const [dependencies, setDependencies] = useState(true)
  const [search, setSearch] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!open || catalog) return
    let cancelled = false
    client
      .catalog()
      .then((answer) => {
        if (!cancelled) setCatalog(answer)
      })
      .catch((caught) => {
        if (!cancelled) setError(message(caught))
      })
    return () => {
      cancelled = true
    }
  }, [open, catalog, client])

  const items = catalog?.manifest.items ?? []
  const labelOf = (kind: string) => catalog?.kinds.find((one) => one.kind === kind)?.label ?? kind
  const closure = useMemo(
    () => (dependencies ? packageDependencyClosure(items, selected) : selected),
    [dependencies, items, selected],
  )
  const added = closure.filter((key) => !selected.includes(key))
  const needle = search.trim().toLowerCase()
  const kinds = [...new Set(items.map((item) => item.kind))]

  const toggle = (keys: readonly string[], on: boolean) =>
    setSelected((current) =>
      on ? [...new Set([...current, ...keys])] : current.filter((key) => !keys.includes(key)),
    )

  const save = async (selection: { items?: readonly string[]; dependencies?: boolean }) => {
    setBusy(true)
    setError(null)
    try {
      const file = await client.exportPackage(selection)
      download(file.fileName, file.body)
      onClose()
    } catch (caught) {
      setError(message(caught))
    } finally {
      setBusy(false)
    }
  }

  const tooMany = selected.length > SITE_PACKAGE_SELECTION_MAX

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md" aria-labelledby="package-export-title">
      <DialogTitle id="package-export-title">Export items</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {error ? <Alert severity="error">{error}</Alert> : null}
          {!catalog && !error ? <CircularProgress size={24} aria-label="Loading the site’s items" /> : null}
          {catalog ? (
            <>
              <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                <TextField size="small" label="Search" value={search} onChange={(event) => setSearch(event.target.value)} />
                <FormControlLabel
                  control={<Switch checked={dependencies} onChange={(event) => setDependencies(event.target.checked)} />}
                  label="Include what they need"
                />
              </Stack>
              {kinds.map((kind) => {
                const ofKind = items.filter((item) => item.kind === kind)
                const shown = ofKind.filter(
                  (item) =>
                    !needle ||
                    [item.name, item.slug, item.$id].some((value) => value?.toLowerCase().includes(needle)),
                )
                if (!shown.length) return null
                const keys = ofKind.map(packageItemKey)
                const chosen = keys.filter((key) => selected.includes(key)).length
                return (
                  <Box key={kind} role="group" aria-label={labelOf(kind)}>
                    <FormControlLabel
                      control={
                        <Checkbox
                          checked={chosen === keys.length}
                          indeterminate={chosen > 0 && chosen < keys.length}
                          onChange={(event) => toggle(keys, event.target.checked)}
                        />
                      }
                      label={<Typography variant="subtitle2">{`${labelOf(kind)} (${keys.length.toLocaleString()})`}</Typography>}
                    />
                    <Stack sx={{ pl: 3 }}>
                      {shown.map((item) => {
                        const key = packageItemKey(item)
                        const needed = !selected.includes(key) && closure.includes(key)
                        return (
                          <FormControlLabel
                            key={key}
                            control={
                              <Checkbox
                                size="small"
                                checked={selected.includes(key) || needed}
                                indeterminate={needed}
                                onChange={(event) => toggle([key], event.target.checked)}
                              />
                            }
                            label={
                              <Typography variant="body2">
                                {packageItemTitle({ ...item, id: item.$id })}
                                {needed ? (
                                  <Typography component="span" variant="caption" color="text.secondary">
                                    {' — needed by your selection'}
                                  </Typography>
                                ) : null}
                              </Typography>
                            }
                          />
                        )
                      })}
                    </Stack>
                  </Box>
                )
              })}
              <Typography variant="body2" aria-live="polite">
                {selected.length
                  ? `${countOf(closure.length, 'item')} in the file` +
                    (added.length ? `, ${countOf(added.length, 'item')} of them because your selection needs ${added.length === 1 ? 'it' : 'them'}.` : '.')
                  : 'Choose items, or export everything.'}
              </Typography>
              {tooMany ? (
                <Alert severity="warning">
                  {`Choose at most ${SITE_PACKAGE_SELECTION_MAX.toLocaleString()} items, or export everything.`}
                </Alert>
              ) : null}
            </>
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          Cancel
        </Button>
        <Button onClick={() => void save({})} disabled={busy}>
          Export everything
        </Button>
        <Button
          variant="contained"
          disabled={busy || !selected.length || tooMany}
          onClick={() => void save({ items: selected, dependencies })}
        >
          {selected.length ? `Export ${countOf(closure.length, 'item')}` : 'Export selected'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}

export default PackageExportDialog
