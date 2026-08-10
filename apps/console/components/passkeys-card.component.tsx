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
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Alert,
  Box,
  Button,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'
import { collection, onSnapshot } from 'firebase/firestore'
import { useCallback, useEffect, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'
import {
  registerPasskey,
  usePasskeysSupported,
  PasskeyRequestError,
} from '../utils/passkeys'

interface PasskeyRow {
  id: string
  label: string
  createdAt: number
  lastUsedAt: number | null
  suspectedCloneAt?: number
}

function formatDay(ms: number | null | undefined): string | null {
  if (!ms) return null
  try {
    return new Date(ms).toLocaleDateString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
    })
  } catch {
    return null
  }
}

/**
 * Passkey management card (AGL-662), in the Manage Account → Security tab.
 *
 * Additive by design: registering a passkey never touches the account's
 * other sign-in methods, so a lost authenticator only ever degrades to the
 * pre-passkey experience. The list reads the owner's own
 * `users/{uid}/passkeys` (rules: owner-read, server-write-only); every
 * write happens through the ceremony endpoints.
 *
 * Rename/revoke are a follow-up — the credential store is server-write
 * only, so both need their own authenticated endpoints.
 */
export function PasskeysCard() {
  const { data: user } = useUser()
  const firestore = useFirestore()
  const { enqueueSnackbar } = useSnackbar()
  const [rows, setRows] = useState<PasskeyRow[] | null>(null)
  /**
   * The listen failed (AGL-1380). Kept apart from `rows` because the error
   * callback used to answer it with `setRows([])`, which is the same value a
   * user with no passkeys has — so a denied or dropped listen told someone
   * with registered credentials that they had none, and offered them the
   * setup CTA. It also hid any credential flagged `suspectedCloneAt` behind
   * the same empty state, which is the one row nobody should be able to miss.
   */
  const [listFailed, setListFailed] = useState(false)
  /** Bumped by Retry to re-subscribe. */
  const [retryNonce, setRetryNonce] = useState(0)
  const [busy, setBusy] = useState(false)
  const supported = usePasskeysSupported()
  // Passkeys are project-pool only (AGL-662): enterprise-SSO tenant users
  // sign in through their IdP and the register endpoint refuses them, so
  // don't offer a button that can only 403.
  const tenantUser = Boolean(
    (user as { tenantId?: string | null } | null)?.tenantId,
  )

  useEffect(() => {
    if (!user?.uid) return undefined
    setRows(null)
    setListFailed(false)
    return onSnapshot(
      collection(firestore, 'users', user.uid, 'passkeys'),
      (snapshot) => {
        setListFailed(false)
        setRows(
          snapshot.docs.map((docSnapshot) => {
            const data = docSnapshot.data() as Omit<PasskeyRow, 'id'>
            return { ...data, id: docSnapshot.id }
          }),
        )
      },
      (error) => {
        console.error('[passkeys-card] list failed', error)
        // Deliberately NOT `setRows([])` — see `listFailed`. `rows` stays at
        // whatever we actually know, which on a first-load failure is null.
        setListFailed(true)
      },
    )
  }, [firestore, user?.uid, retryNonce])

  const handleAdd = useCallback(async () => {
    if (!user) return
    setBusy(true)
    try {
      const { label } = await registerPasskey(user)
      enqueueSnackbar(`Passkey "${label}" added`, { variant: 'success' })
    } catch (error) {
      // The user closing the browser prompt is not an error worth alarming.
      const name = (error as { name?: string })?.name
      if (name === 'NotAllowedError' || name === 'AbortError') return
      console.error('[passkeys-card] registration failed', error)
      enqueueSnackbar(
        error instanceof PasskeyRequestError &&
          error.reason === 'limit-reached'
          ? 'Passkey limit reached — remove one first.'
          : 'Adding the passkey failed. Try again.',
        { variant: 'error' },
      )
    } finally {
      setBusy(false)
    }
  }, [user, enqueueSnackbar])

  if (tenantUser) return null

  return (
    <CardDisplay
      header="Passkeys"
      help={docsHelp('account', {
        excerpt:
          'Sign in with Touch ID, Face ID, or a security key. Passkeys are ' +
          'an extra sign-in method — your password and providers stay.',
      })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={2} sx={{ maxWidth: 560 }}>
        <Typography variant="body2" color="text.secondary">
          {'Sign in with Touch ID, Face ID, or a security key instead of ' +
            'your password. Passkeys are an extra way in — your other ' +
            'sign-in methods keep working.'}
        </Typography>
        {rows && rows.length > 0 ? (
          <Box
            sx={{
              border: 1,
              borderColor: 'divider',
              borderRadius: 2,
              overflow: 'hidden',
            }}
          >
            <List dense disablePadding>
              {rows.map((row) => {
                const created = formatDay(row.createdAt)
                const used = formatDay(row.lastUsedAt)
                const parts = [
                  created ? `Added ${created}` : null,
                  used ? `Last used ${used}` : null,
                  row.suspectedCloneAt
                    ? 'Blocked — possible credential copy'
                    : null,
                ].filter(Boolean)
                return (
                  <ListItem key={row.id} divider>
                    <ListItemText
                      primary={row.label}
                      secondary={parts.join(' · ') || undefined}
                      slotProps={
                        row.suspectedCloneAt
                          ? { secondary: { color: 'error' } }
                          : undefined
                      }
                    />
                  </ListItem>
                )
              })}
            </List>
          </Box>
        ) : listFailed ? (
          // No list and no "No passkeys yet" — both assert something about
          // this account's credentials that we failed to read (AGL-1380).
          <Alert
            severity="error"
            action={
              <Button
                color="inherit"
                size="small"
                onClick={() => setRetryNonce((n) => n + 1)}
              >
                {'Retry'}
              </Button>
            }
          >
            {'We couldn’t load your passkeys. This does not mean you have ' +
              'none — any you have registered still work.'}
          </Alert>
        ) : rows ? (
          <Typography variant="body2" color="text.secondary">
            {'No passkeys yet.'}
          </Typography>
        ) : null}
        {supported ? (
          <Button
            variant="outlined"
            onClick={handleAdd}
            disabled={busy || !user}
            sx={{ alignSelf: 'flex-start' }}
          >
            {busy ? 'Follow your browser’s prompts…' : 'Set up a passkey'}
          </Button>
        ) : (
          <Typography variant="body2" color="text.secondary">
            {'This browser does not support passkeys.'}
          </Typography>
        )}
      </Stack>
    </CardDisplay>
  )
}
PasskeysCard.displayName = 'PasskeysCard'

export default PasskeysCard
