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

import { docsHelp } from '../../constants/docs-links'
import {
  diffOverride,
  overrideWriteValue,
  resolveOverride,
} from '@aglyn/aglyn/app-utils/marketplace-overrides'
import {
  describeThemeOverride,
  isOverrideForCurrentTheme,
  readThemeOverride,
  type ThemeOverrideEntry,
} from '@aglyn/aglyn/app-utils/marketplace-theme'
import type { HostTheme } from '@aglyn/shared-data-types'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Box,
  Button,
  Chip,
  Stack,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useCallback, useMemo, useState } from 'react'

/** A colour value gets a swatch; everything else is read as text. */
function ValueCell(props: { value: unknown }) {
  const { value } = props
  if (value === undefined) {
    return (
      <Typography variant="caption" color="text.secondary">
        {'not set'}
      </Typography>
    )
  }
  const text =
    typeof value === 'string' || typeof value === 'number'
      ? String(value)
      : JSON.stringify(value)
  const isColor = typeof value === 'string' && /^#|^rgb|^hsl/.test(value.trim())
  return (
    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
      {isColor ? (
        <Box
          aria-hidden
          sx={{
            width: 16,
            height: 16,
            borderRadius: 0.5,
            border: 1,
            borderColor: 'divider',
            backgroundColor: text,
            flexShrink: 0,
          }}
        />
      ) : null}
      <Typography
        variant="body2"
        sx={{ fontFamily: 'monospace', wordBreak: 'break-all' }}
      >
        {text.length > 60 ? `${text.slice(0, 57)}…` : text}
      </Typography>
    </Stack>
  )
}

/**
 * "What have I changed?" — the site's theme overrides, rendered (AGL-1021).
 *
 * This is a read of the stored patch, not a diff computed for display, which is
 * the property the override layer exists to give: the list cannot disagree with
 * what is actually applied, because it IS what is applied.
 *
 * Only shown for an installed theme. A site that built its own theme has no
 * publisher's version to differ from — every value is theirs, so "what have I
 * changed" would be the whole theme and the question is not meaningful.
 */
export function ThemeOverridesCard(props: {
  hostId: string
  host: {
    theme?: HostTheme | null
    themeOverride?: unknown
    themeInstalledFrom?: { sha256?: string | null; listingId?: string } | null
  } | null
  /** Writes `themeOverride` wholesale — never `merge: true` (see below). */
  onWriteOverride: (value: unknown) => Promise<void>
}) {
  const { hostId, host, onWriteOverride } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)

  const entries = useMemo(() => describeThemeOverride(host), [host])
  const stale = !isOverrideForCurrentTheme(host)
  const installed = Boolean(host?.themeInstalledFrom?.listingId)

  /**
   * Per-field reset: drop ONE path from the patch and store the rest.
   *
   * Computed by resolving the patch, putting the publisher's value back at
   * that path, and re-diffing — rather than by deleting a key from the patch
   * object. The two differ whenever a path was reached through a keyed array
   * or a deletion sentinel, and re-diffing is right in every case because it
   * asks the same question the save path asks.
   */
  const resetPath = useCallback(
    async (entry: ThemeOverrideEntry) => {
      const override = readThemeOverride(host)
      if (!override) return
      setBusy(true)
      try {
        const base = (host?.theme ?? {}) as HostTheme
        const resolved = resolveOverride<HostTheme>(base, override.patch)
        const restored = setPath(
          resolved,
          entry.path.split('.'),
          readPath(base, entry.path),
        )
        await onWriteOverride(
          overrideWriteValue(
            diffOverride(base, restored),
            host?.themeInstalledFrom?.sha256 ?? null,
          ),
        )
        enqueueSnackbar(`${entry.label} is back to the theme’s value.`, {
          variant: 'success',
          persist: false,
        })
      } catch (error) {
        console.error(error)
        enqueueSnackbar('An error has occurred', {
          variant: 'error',
          allowDuplicate: true,
        })
      } finally {
        setBusy(false)
      }
    },
    [host, onWriteOverride, enqueueSnackbar],
  )

  const clearAll = useCallback(async () => {
    setBusy(true)
    try {
      const idToken = await (user as any)?.getIdToken?.()
      const response = await fetch('/api/marketplace/install-theme', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ hostId, action: 'clear-overrides' }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok) {
        return void enqueueSnackbar(payload?.error ?? 'That did not work', {
          variant: 'warning',
          allowDuplicate: true,
        })
      }
      enqueueSnackbar('Your changes are cleared — this is the theme as published.', {
        variant: 'success',
        persist: false,
      })
    } catch (error) {
      console.error(error)
      enqueueSnackbar('An error has occurred', {
        variant: 'error',
        allowDuplicate: true,
      })
    } finally {
      setBusy(false)
    }
  }, [hostId, user, enqueueSnackbar])

  if (!installed) return null

  return (
    <CardDisplay
      header={'What you have changed'}
      help={docsHelp('themeBuilder', {
        excerpt:
          'Your changes on top of an installed theme, stored separately so ' +
          'taking an update keeps them.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2}>
        {stale ? (
          <Alert severity="warning">
            {'These changes were made against a different theme. They still ' +
              'apply, because a brand colour usually still means the same ' +
              'thing — but a component style written for another theme often ' +
              'does not. Check them, or clear them all below.'}
          </Alert>
        ) : null}

        {!entries.length ? (
          <Typography variant="body2" color="text.secondary">
            {'Nothing — this site is running the theme exactly as its ' +
              'publisher shipped it. Anything you change below is stored as ' +
              'your change on top, so taking an update keeps it.'}
          </Typography>
        ) : (
          <>
            <Typography variant="body2" color="text.secondary">
              {`${entries.length} value${entries.length === 1 ? '' : 's'} ` +
                `${entries.length === 1 ? 'differs' : 'differ'} from the ` +
                'published theme. Taking an update keeps these and applies ' +
                'the rest.'}
            </Typography>
            <Box sx={{ overflowX: 'auto' }}>
              <Table size="small">
                <TableHead>
                  <TableRow>
                    <TableCell>{'What'}</TableCell>
                    <TableCell>{'Theme'}</TableCell>
                    <TableCell>{'Yours'}</TableCell>
                    <TableCell align="right" />
                  </TableRow>
                </TableHead>
                <TableBody>
                  {entries.map((entry) => (
                    <TableRow key={entry.path}>
                      <TableCell>
                        <Stack
                          direction="row"
                          spacing={1}
                          sx={{ alignItems: 'center', flexWrap: 'wrap' }}
                        >
                          <Typography variant="body2">{entry.label}</Typography>
                          {entry.scheme ? (
                            <Chip
                              size="small"
                              variant="outlined"
                              label={entry.scheme}
                            />
                          ) : null}
                        </Stack>
                      </TableCell>
                      <TableCell>
                        <ValueCell value={entry.themeValue} />
                      </TableCell>
                      <TableCell>
                        <ValueCell value={entry.overrideValue} />
                      </TableCell>
                      <TableCell align="right">
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() => resetPath(entry)}
                        >
                          {'Reset'}
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </Box>
            <Box>
              <Button
                size="small"
                variant="outlined"
                color="inherit"
                disabled={busy}
                onClick={clearAll}
              >
                {'Reset everything to the published theme'}
              </Button>
            </Box>
          </>
        )}
      </Stack>
    </CardDisplay>
  )
}

/** Reads a dotted path. */
function readPath(value: unknown, path: string): unknown {
  let cursor: unknown = value
  for (const segment of path.split('.')) {
    if (cursor == null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Record<string, unknown>)[segment]
  }
  return cursor
}

/** Copy-on-write set of a dotted path; `undefined` removes the key. */
function setPath(target: unknown, path: string[], value: unknown): any {
  const [head, ...rest] = path
  const container: Record<string, unknown> =
    target != null && typeof target === 'object' && !Array.isArray(target)
      ? { ...(target as Record<string, unknown>) }
      : {}
  if (!rest.length) {
    if (value === undefined) delete container[head]
    else container[head] = value
    return container
  }
  container[head] = setPath(container[head], rest, value)
  return container
}

export default ThemeOverridesCard
