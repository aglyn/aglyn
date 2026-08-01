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
  AlertTitle,
  Box,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  EmailAuthProvider,
  GoogleAuthProvider,
  OAuthProvider,
  SAMLAuthProvider,
  reauthenticateWithCredential,
  reauthenticateWithPopup,
  type AuthProvider,
  type User,
} from 'firebase/auth'
import { useCallback, useState } from 'react'
import { docsHelp } from '../constants/docs-links'

/**
 * Close your own account (AGL-1140).
 *
 * Until this existed there was no self-serve deletion at all — not a UI, not a
 * route, not a script — which is a bad answer to an erasure request and a
 * worse one to an enterprise security review.
 *
 * The card is deliberately plain and the confirmation deliberately slow. This
 * is the only action in the console that no other action can undo.
 */

/**
 * The provider to re-challenge a non-password account with.
 *
 * Taken from the account's own `providerData`, because "not a password
 * account" does not mean "a Google account". An SSO user's only provider is
 * `saml.<tenant-id>`, and `SAMLAuthProvider` needs that exact id — a
 * hard-coded `GoogleAuthProvider` would throw for every Enterprise customer,
 * which is the tier most likely to be asked for a deletion path in a security
 * review. Falls back to Google, which is the only other provider the console
 * offers today.
 */
export function reauthProvider(user: Pick<User, 'providerData'>): AuthProvider {
  const providerId = user.providerData.find((entry) =>
    entry?.providerId?.startsWith('saml.'),
  )?.providerId
  if (providerId) return new SAMLAuthProvider(providerId)
  const oidc = user.providerData.find((entry) =>
    entry?.providerId?.startsWith('oidc.'),
  )?.providerId
  if (oidc) return new OAuthProvider(oidc)
  return new GoogleAuthProvider()
}

interface CloseAccountBlocker {
  orgId: string
  orgName: string
  hasLiveSubscription: boolean
  otherMembers: number
}

export interface CloseAccountCardProps {
  user: User
  /** True when the account signs in with a password (so we can reauth inline). */
  hasPassword: boolean
}

export function CloseAccountCard({ user, hasPassword }: CloseAccountCardProps) {
  const { enqueueSnackbar } = useSnackbar()
  const [open, setOpen] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [blockers, setBlockers] = useState<CloseAccountBlocker[] | null>(null)

  const reset = useCallback(() => {
    setOpen(false)
    setPassword('')
    setConfirm('')
    setBlockers(null)
  }, [])

  const close = useCallback(async () => {
    setBusy(true)
    setBlockers(null)
    try {
      // Reauthenticate FIRST. The server independently requires a recent
      // `auth_time`, so this is not the security boundary — it is what makes
      // the token satisfy it, and what puts a password prompt in front of an
      // irreversible click.
      if (hasPassword) {
        await reauthenticateWithCredential(
          user,
          EmailAuthProvider.credential(user.email ?? '', password),
        )
      } else {
        // The provider owns the challenge. Which provider is read off the
        // account rather than assumed to be Google: an SSO account's only
        // provider is `saml.<id>`, and handing it a GoogleAuthProvider would
        // fail for exactly the Enterprise tier this matters most to. Popup
        // rather than redirect, so the typed confirmation is not lost to a
        // full page load.
        await reauthenticateWithPopup(user, reauthProvider(user))
      }

      // `true` forces a refresh, so the token carries the `auth_time` that
      // was just refreshed rather than the cached one from sign-in.
      const idToken = await user.getIdToken(true)
      const response = await fetch('/api/account/close', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ confirm }),
      })
      const payload = (await response.json()) as {
        error?: string
        blockers?: CloseAccountBlocker[]
      }

      if (response.status === 409 && payload.error === 'owns-orgs') {
        setBlockers(payload.blockers ?? [])
        return
      }
      if (!response.ok) {
        enqueueSnackbar(payload.error ?? 'Closing the account failed.', {
          variant: 'error',
        })
        return
      }

      // Straight out, without waiting for a snackbar nobody will read: the
      // account behind this session no longer exists, and every subsequent
      // request would fail in a way that reads like a bug.
      window.location.href = '/signout'
    } catch (error) {
      const code = (error as { code?: string })?.code
      enqueueSnackbar(
        code === 'auth/wrong-password' || code === 'auth/invalid-credential'
          ? 'That password is not right.'
          : code === 'auth/popup-closed-by-user'
            ? 'Confirmation cancelled — the account was not closed.'
            : `Could not confirm it is you: ${code ?? 'unknown error'}`,
        { variant: 'error' },
      )
    } finally {
      setBusy(false)
    }
  }, [confirm, enqueueSnackbar, hasPassword, password, user])

  const canSubmit =
    confirm.trim().toUpperCase() === 'DELETE' &&
    (!hasPassword || password.length > 0) &&
    !busy

  return (
    <CardDisplay
      title="Close account"
      help={docsHelp('account', {
        anchor: '#closing-your-account',
        excerpt:
          'Permanently delete your personal account, your profile and your ' +
          'sign-in. Workspaces you solely own have to be handed over first.',
      })}
    >
      <Stack spacing={2}>
        <Typography variant="body2" color="text.secondary">
          {'Closing your account permanently deletes your profile, your ' +
            'contact details, your avatar and your sign-in, and removes you ' +
            'from every workspace you belong to. It cannot be undone, and ' +
            'support cannot restore it.'}
        </Typography>
        <Typography variant="body2" color="text.secondary">
          {'Workspaces are not deleted. If you are the sole owner of one, ' +
            'hand it over to someone else first — otherwise it would be left ' +
            'with nobody who can administer it.'}
        </Typography>
        <Box>
          <Button color="error" variant="outlined" onClick={() => setOpen(true)}>
            {'Close account'}
          </Button>
        </Box>
      </Stack>

      <Dialog open={open} onClose={busy ? undefined : reset} maxWidth="sm" fullWidth>
        <DialogTitle>{'Close your account?'}</DialogTitle>
        <DialogContent>
          <Stack spacing={2}>
            <DialogContentText>
              {'This permanently deletes your account and everything on it. ' +
                'It cannot be undone.'}
            </DialogContentText>

            {blockers !== null && (
              <Alert severity="warning">
                <AlertTitle>
                  {blockers.length === 1
                    ? 'One workspace still needs an owner'
                    : `${blockers.length} workspaces still need an owner`}
                </AlertTitle>
                <Typography variant="body2">
                  {'Hand these over to someone else, then close your account:'}
                </Typography>
                <List dense disablePadding>
                  {blockers.map((blocker) => (
                    <ListItem key={blocker.orgId} disableGutters>
                      <ListItemText
                        primary={blocker.orgName}
                        secondary={[
                          blocker.hasLiveSubscription
                            ? 'has an active subscription'
                            : null,
                          blocker.otherMembers === 1
                            ? '1 other member'
                            : blocker.otherMembers > 1
                              ? `${blocker.otherMembers} other members`
                              : 'no other members',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      />
                    </ListItem>
                  ))}
                </List>
              </Alert>
            )}

            {hasPassword ? (
              <TextField
                type="password"
                label="Your password"
                value={password}
                autoComplete="current-password"
                onChange={(event) => setPassword(event.target.value)}
                helperText="Confirm it is you."
                fullWidth
              />
            ) : (
              <Alert severity="info">
                {'You will be asked to sign in again to confirm it is you.'}
              </Alert>
            )}

            <TextField
              label="Type DELETE to confirm"
              value={confirm}
              onChange={(event) => setConfirm(event.target.value)}
              fullWidth
            />
          </Stack>
        </DialogContent>
        <DialogActions>
          <Button onClick={reset} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button
            color="error"
            variant="contained"
            disabled={!canSubmit}
            onClick={() => void close()}
          >
            {busy ? 'Closing…' : 'Close account permanently'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

export default CloseAccountCard
