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
import { MAX_ACCOUNT_EMAILS } from '@aglyn/aglyn/app-utils/account-emails'
import {
  Alert,
  Box,
  Button,
  Chip,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useSnackbar } from 'notistack'
import { useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'

interface EmailRow {
  address: string
  verified: boolean
  primary: boolean
  verifiedAt: string | null
}

/**
 * Email addresses on the account (AGL-2486), in Manage account → Account.
 *
 * GitHub's model: several addresses, each independently confirmed, exactly
 * one primary. An UNVERIFIED address does nothing at all — it is not a
 * sign-in identifier and receives no mail but its own confirmation — which is
 * why the list marks that state loudly rather than quietly.
 *
 * ## The sentence this card has to get right
 *
 * People add a work address expecting it to connect them to their employer's
 * workspace. It does not, and saying so plainly here is cheaper than a
 * support conversation: organization access comes from an invitation or from
 * the organization's own identity provider, never from an address you added
 * yourself. The copy below says exactly that.
 *
 * ## Reads through the API, not a Firestore listener
 *
 * `users/{uid}/emails` is owner-readable, so a listener would work — but the
 * list has to include the PRIMARY, and the primary is the Firebase Auth
 * record's email, which is not in Firestore for any account that predates
 * this feature. `GET /api/account/emails` seeds that row from the Auth record
 * on first read, so the route is the only place that sees the whole truth.
 */
export function AccountEmailsCard() {
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [rows, setRows] = useState<EmailRow[] | null>(null)
  const [adding, setAdding] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const call = useCallback(
    async (method: string, payload?: Record<string, unknown>) => {
      if (!user) throw new Error('Not signed in')
      const idToken = await user.getIdToken()
      const response = await fetch('/api/account/emails', {
        method,
        headers: {
          authorization: `Bearer ${idToken}`,
          ...(payload ? { 'content-type': 'application/json' } : {}),
        },
        ...(payload ? { body: JSON.stringify(payload) } : {}),
      })
      const data = await response.json().catch(() => ({}))
      if (!response.ok) {
        throw new Error(String(data?.error ?? `Request failed (${response.status})`))
      }
      return data
    },
    [user],
  )

  const refresh = useCallback(async () => {
    try {
      const data = await call('GET')
      setRows((data?.emails ?? []) as EmailRow[])
      setError(null)
    } catch (caught: any) {
      setError(caught?.message ?? 'Could not load your email addresses')
    }
  }, [call])

  useEffect(() => {
    if (user) void refresh()
  }, [user, refresh])

  /**
   * Honour the confirmation link (`?confirmEmail=…`).
   *
   * The link lands on this page because that is where the result is visible.
   * The token is stripped from the URL immediately afterwards so a shared or
   * bookmarked address does not carry a (spent) confirmation secret around.
   */
  useEffect(() => {
    if (typeof window === 'undefined') return
    const params = new URLSearchParams(window.location.search)
    const token = params.get('confirmEmail')
    if (!token) return
    void (async () => {
      try {
        const response = await fetch('/api/account/emails', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ action: 'confirm', token }),
        })
        const data = await response.json().catch(() => ({}))
        if (!response.ok) throw new Error(String(data?.error ?? 'Confirmation failed'))
        enqueueSnackbar(`${data?.address ?? 'Address'} confirmed`, {
          variant: 'success',
        })
        await refresh()
      } catch (caught: any) {
        enqueueSnackbar(caught?.message ?? 'Confirmation failed', { variant: 'error' })
      } finally {
        params.delete('confirmEmail')
        const query = params.toString()
        window.history.replaceState(
          {},
          '',
          `${window.location.pathname}${query ? `?${query}` : ''}`,
        )
      }
    })()
  }, [enqueueSnackbar, refresh])

  const run = useCallback(
    async (work: () => Promise<unknown>, success: string) => {
      setBusy(true)
      setError(null)
      try {
        await work()
        enqueueSnackbar(success, { variant: 'success' })
        await refresh()
      } catch (caught: any) {
        const message = caught?.message ?? 'Something went wrong'
        setError(message)
        enqueueSnackbar(message, { variant: 'error' })
      } finally {
        setBusy(false)
      }
    },
    [enqueueSnackbar, refresh],
  )

  const add = useCallback(async () => {
    const address = adding.trim()
    if (!address) return
    await run(async () => {
      await call('POST', { action: 'add', address })
      setAdding('')
    }, 'Confirmation email sent')
  }, [adding, call, run])

  const atCap = rows !== null && rows.length >= MAX_ACCOUNT_EMAILS

  return (
    <CardDisplay
      header="Email addresses"
      // `manageAccount#email-addresses`, not the sign-in page: this card's
      // own documentation is a section, and the anchor is type-checked
      // against that page's real headings, so a docs restructure breaks the
      // build rather than the link (AGL-602).
      help={docsHelp('manageAccount', {
        anchor: '#email-addresses',
        title: 'Email addresses',
        excerpt:
          'Add more than one address to your account. Any confirmed address ' +
          'can be used to sign in; your primary address receives receipts ' +
          'and account notices.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} sx={{ maxWidth: 560 }}>
        <Typography variant="body2" color="text.secondary">
          {'You can keep more than one address on this account. Confirm an ' +
            'address and you can sign in with it; your primary address is ' +
            'the one that receives receipts and account notices.'}
        </Typography>
        {/* The expectation this feature reliably creates, corrected up front. */}
        <Typography variant="body2" color="text.secondary">
          {'Adding an address does not join you to any workspace. Access to ' +
            'a workspace comes from an invitation, or from that ' +
            "organization's own single sign-on — never from an address you " +
            'add here.'}
        </Typography>

        {error ? <Alert severity="warning">{error}</Alert> : null}

        {rows !== null && rows.length > 0 ? (
          <Box sx={{ border: 1, borderColor: 'divider', borderRadius: 2, overflow: 'hidden' }}>
            <List dense disablePadding>
              {rows.map((row) => (
                <ListItem
                  key={row.address}
                  divider
                  secondaryAction={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                      {!row.verified ? (
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => call('POST', { action: 'resend', address: row.address }),
                              'Confirmation email sent',
                            )
                          }
                        >
                          {'Resend'}
                        </Button>
                      ) : null}
                      {row.verified && !row.primary ? (
                        <Button
                          size="small"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => call('POST', { action: 'primary', address: row.address }),
                              'Primary address updated',
                            )
                          }
                        >
                          {'Make primary'}
                        </Button>
                      ) : null}
                      {!row.primary ? (
                        <Button
                          size="small"
                          color="error"
                          disabled={busy}
                          onClick={() =>
                            void run(
                              () => call('DELETE', { address: row.address }),
                              'Address removed',
                            )
                          }
                        >
                          {'Remove'}
                        </Button>
                      ) : null}
                    </Stack>
                  }
                >
                  <ListItemText
                    primary={row.address}
                    secondary={
                      <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                        {row.primary ? (
                          <Chip size="small" label="Primary" color="primary" variant="outlined" />
                        ) : null}
                        <Chip
                          size="small"
                          label={row.verified ? 'Confirmed' : 'Unconfirmed'}
                          color={row.verified ? 'success' : 'warning'}
                          variant="outlined"
                        />
                      </Stack>
                    }
                    slotProps={{ secondary: { component: 'div' } }}
                  />
                </ListItem>
              ))}
            </List>
          </Box>
        ) : null}

        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
          <TextField
            size="small"
            fullWidth
            type="email"
            label="Add an email address"
            value={adding}
            disabled={busy || atCap}
            onChange={(event) => setAdding(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') void add()
            }}
            helperText={
              atCap
                ? `You have reached the limit of ${MAX_ACCOUNT_EMAILS} addresses.`
                : "We'll send a confirmation link to check it reaches you."
            }
          />
          <Button
            variant="outlined"
            disabled={busy || atCap || !adding.trim()}
            onClick={() => void add()}
            sx={{ mt: 0.5 }}
          >
            {'Add'}
          </Button>
        </Stack>
      </Stack>
    </CardDisplay>
  )
}

export default AccountEmailsCard
