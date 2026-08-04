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
import { describeTheme } from '@aglyn/aglyn/app-utils/marketplace-theme'
import type { HostTheme } from '@aglyn/shared-data-types'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Alert,
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'

/**
 * Where this site's theme came from, and the ways back (AGL-1020).
 *
 * Installing a theme is the one marketplace action that repaints a running
 * site, so the editor has to answer two questions the other artifact types
 * never raise: *what am I looking at* — my own work, or a publisher's — and
 * *how do I undo this*. Neither is answerable from the theme document alone,
 * which is why the install route records provenance and keeps the replaced
 * theme rather than merely overwriting.
 *
 * The two ways back are deliberately separate controls:
 *
 * * **Go back to the previous theme** restores exactly what this site had,
 *   including a hand-built theme that exists in no listing anywhere.
 * * **Use the default theme** clears the theme entirely — the platform look.
 *
 * Collapsing them into one "reset" would force a guess between "undo what I
 * just did" and "start from nothing", and the two differ by an entire design.
 */
export function ThemeSourceCard(props: {
  hostId: string
  theme?: HostTheme
  installedFrom?: {
    listingId?: string
    version?: string | null
    publisherOrgId?: string | null
  } | null
  /** Present when a previous theme is recoverable. */
  replaced?: { theme?: HostTheme | null } | null
  onChanged?: () => void
}) {
  const { hostId, theme, installedFrom, replaced, onChanged } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [busy, setBusy] = useState(false)
  const [confirm, setConfirm] = useState<'revert' | 'reset' | null>(null)

  const call = useCallback(
    async (action: 'revert' | 'reset') => {
      setBusy(true)
      try {
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/marketplace/install-theme', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ hostId, action }),
        })
        const payload = await response.json().catch(() => ({}))
        if (!response.ok) {
          return void enqueueSnackbar(payload?.error ?? 'That did not work', {
            variant: 'warning',
            allowDuplicate: true,
          })
        }
        setConfirm(null)
        enqueueSnackbar(
          action === 'revert'
            ? 'Your previous theme is back.'
            : 'This site is using the default theme again.',
          { variant: 'success', persist: false },
        )
        onChanged?.()
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
    [hostId, user, enqueueSnackbar, onChanged],
  )

  const installed = Boolean(installedFrom?.listingId)
  const customised = Boolean(theme && Object.keys(theme).length)
  const summary = describeTheme(theme)
  // A previous theme that was itself empty is the default, and "go back to the
  // default" is what the other button already says.
  const canRevert = Boolean(
    replaced && replaced.theme && Object.keys(replaced.theme).length,
  )

  return (
    <>
      <CardDisplay
        header={'Theme source'}
        help={docsHelp('themeBuilder', {
          excerpt:
            'Where this site’s theme came from, and the two ways back — the ' +
            'theme it replaced, or the platform default.',
        })}
        contentGutterX
        contentGutterY
      >
        <Stack spacing={2}>
          <Stack
            direction="row"
            spacing={1}
            sx={{ alignItems: 'center', flexWrap: 'wrap' }}
          >
            {installed ? (
              <Chip
                size="small"
                color="primary"
                label={
                  installedFrom?.version
                    ? `From the marketplace · v${installedFrom.version}`
                    : 'From the marketplace'
                }
              />
            ) : customised ? (
              <Chip size="small" label={'Built on this site'} />
            ) : (
              <Chip size="small" variant="outlined" label={'Default theme'} />
            )}
            {summary.map((part) => (
              <Chip key={part} size="small" variant="outlined" label={part} />
            ))}
          </Stack>

          <Typography variant="body2" color="text.secondary">
            {installed
              ? 'This site runs an installed theme. Editing it here is your ' +
                'own change on top of the publisher’s — taking an update keeps ' +
                'what you changed and applies the rest.'
              : customised
                ? 'This theme was built on this site. Publishing it from ' +
                  'Marketplace → Publish makes it installable elsewhere.'
                : 'This site uses the platform’s default theme. Anything you ' +
                  'set below replaces just that part of it.'}
          </Typography>

          <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
            <Button
              size="small"
              variant="outlined"
              disabled={busy || !canRevert}
              onClick={() => setConfirm('revert')}
            >
              {'Go back to the previous theme'}
            </Button>
            <Button
              size="small"
              variant="outlined"
              color="inherit"
              disabled={busy || !customised}
              onClick={() => setConfirm('reset')}
            >
              {'Use the default theme'}
            </Button>
          </Stack>
        </Stack>
      </CardDisplay>

      <Dialog open={confirm !== null} onClose={() => !busy && setConfirm(null)}>
        <DialogTitle>
          {confirm === 'revert'
            ? 'Go back to the previous theme?'
            : 'Use the default theme?'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText component="div">
            {confirm === 'revert' ? (
              <>
                {'This site goes back to the theme it had before the last ' +
                  'change. What is on it now is kept, so this is reversible ' +
                  'too.'}
                {describeTheme(replaced?.theme).length ? (
                  <Stack
                    direction="row"
                    spacing={1}
                    sx={{ flexWrap: 'wrap', marginTop: 2 }}
                  >
                    {describeTheme(replaced?.theme).map((part) => (
                      <Chip key={part} size="small" label={part} />
                    ))}
                  </Stack>
                ) : null}
              </>
            ) : (
              <>
                {'This site goes back to the platform’s default appearance. ' +
                  'Your colours, typography and component styles are kept so ' +
                  'you can bring them back.'}
                {installed ? (
                  <Alert severity="info" sx={{ marginTop: 2 }}>
                    {'The installed theme stops being applied. It stays in the ' +
                      'marketplace, so you can install it again.'}
                  </Alert>
                ) : null}
              </>
            )}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button disabled={busy} onClick={() => setConfirm(null)}>
            {'Cancel'}
          </Button>
          <Button
            variant="contained"
            disabled={busy}
            onClick={() => confirm && call(confirm)}
          >
            {confirm === 'revert' ? 'Go back' : 'Use the default'}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  )
}

export default ThemeSourceCard
