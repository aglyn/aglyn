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

import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import {
  browserLocalPersistence,
  GoogleAuthProvider,
  OAuthProvider,
  SAMLAuthProvider,
  setPersistence,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  type AuthProvider,
} from 'firebase/auth'
import { useCallback, useEffect, useState } from 'react'
import { useAuth, useUser } from '@aglyn/tenant-feature-instance'
import {
  markInteractiveSignIn,
  markInteractiveSignOut,
} from '../utils/interactive-signin'
import isMobileBrowser from '../utils/is-mobile-browser'
import { signInWithPasskey, usePasskeysSupported } from '../utils/passkeys'
import {
  clearSessionReauth,
  dismissSessionReauth,
  getSessionReauth,
  reopenSessionReauth,
  subscribeSessionReauth,
  type SessionReauthState,
} from '../utils/session-reauth'

/**
 * "Sign in again to verify your device" (AGL-664).
 *
 * The in-place half of session loss: instead of the hard bounce to
 * `/signin`, this dialog opens over the current route, re-authenticates
 * with the account's own factors, and on success simply closes — no
 * navigation, no lost context. The authenticated layout holds its redirect
 * while a request is pending, so the page underneath stays mounted (in the
 * degraded, cache-backed state AGL-1062 documented) the whole time.
 *
 * ## Session semantics this must not soften
 *
 * A revoked or freshly-tombstoned session (AGL-462) is DELIBERATELY dead:
 * the trigger site has already signed the local user out by the time this
 * dialog appears, and the only way forward from here is a real credential
 * sign-in — password or a provider ceremony. Nothing in this component
 * reuses a cached token, the shared cookie, or any other silent path to
 * bring a killed session back. "Expired but locally alive" never reaches
 * this dialog at all: `useSessionCookie` re-mints those silently (AGL-624).
 *
 * The `stale` trigger (AGL-1063 heuristic) is the one case where the local
 * user is still signed in when the dialog opens. Its heal is the full
 * sign-out/sign-in cycle (`feedback_oneshot_getdocs_denied_listeners_ok`),
 * performed only when the user submits — until then nothing is touched, so
 * "Not now" costs nothing.
 *
 * Passkeys (AGL-662) are the additional factor here: a REAL WebAuthn
 * ceremony verified server-side and bridged through `signInWithCustomToken`
 * — a fresh credential sign-in, not a resurrected session, so it honors
 * the semantics above exactly like the password and provider paths.
 */

/**
 * Same selection logic as `reauthProvider` on the close-account card, but
 * from a captured provider-id string — by the time this dialog is up the
 * user object that carried `providerData` may already be signed out.
 */
export function providerForId(providerId: string | null): AuthProvider {
  if (providerId && providerId.startsWith('saml.')) {
    return new SAMLAuthProvider(providerId)
  }
  if (providerId && providerId.startsWith('oidc.')) {
    return new OAuthProvider(providerId)
  }
  return new GoogleAuthProvider()
}

function reasonText(state: SessionReauthState): string {
  switch (state.reason) {
    case 'revoked':
      return (
        'Your session was ended for security reasons. Sign in again to ' +
        'verify this device — you will stay right here, and nothing on ' +
        'this page is lost.'
      )
    case 'signed-out':
      return (
        'You signed out on another device or tab, which ended this ' +
        'session too. Sign in again to keep working — you will stay ' +
        'right here.'
      )
    case 'idle':
      return (
        'You were signed out after a period of inactivity. Sign in again ' +
        'to pick up exactly where you left off.'
      )
    default:
      return (
        'Your session can no longer read your data from the server. ' +
        'Signing in again fixes it without leaving this page — unsaved ' +
        'changes stay on screen.'
      )
  }
}

function signInErrorText(code: string | undefined): string {
  if (code === 'auth/wrong-password' || code === 'auth/invalid-credential') {
    return 'That password is not right.'
  }
  if (code === 'auth/too-many-requests') {
    return 'Too many attempts — wait a moment and try again.'
  }
  if (code === 'auth/popup-closed-by-user') {
    return 'Sign-in cancelled.'
  }
  return `Sign-in failed: ${code ?? 'unknown error'}`
}

export function SessionReauthDialog() {
  const auth = useAuth()
  const { data: user } = useUser()
  const [state, setState] = useState<SessionReauthState>(getSessionReauth)
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Offered whenever the browser can run the ceremony: a discoverable
  // credential needs no captured identity, and if the user has none the
  // browser prompt simply comes up empty and cancels — no harm done.
  const passkeySupported = usePasskeysSupported()

  useEffect(() => subscribeSessionReauth(setState), [])

  const active = state.reason !== null

  // The session came back — our own sign-in below, or a sibling tab's
  // restore delivering a fresh user. Only for triggers that signed the
  // local user out: the `stale` flow keeps its user until submit, and is
  // resolved explicitly by the submit handlers instead.
  useEffect(() => {
    if (active && state.requiresSignIn && user && !busy) {
      clearSessionReauth()
    }
  }, [active, state.requiresSignIn, user, busy])

  // A fresh request must not inherit the previous attempt's leftovers.
  useEffect(() => {
    if (!active) {
      setPassword('')
      setError(null)
    }
  }, [active])

  /**
   * The one flow, for every factor: end whatever half-session is left,
   * then perform a REAL sign-in. The interactive markers route the
   * sign-out and the fresh mint through `useSessionCookie`'s convergence
   * branches (AGL-543/AGL-463), same as the /signout page and the sign-in
   * page do — this dialog invents no session machinery of its own.
   */
  const signInAgain = useCallback(
    async (credentialSignIn: () => Promise<unknown>) => {
      setBusy(true)
      setError(null)
      try {
        if (user) {
          // Still locally signed in (the `stale` trigger): the heal is a
          // full sign-out first — an in-place token refresh provably does
          // not clear a stale session's denied reads (AGL-1062).
          markInteractiveSignOut()
          await signOut(auth)
        }
        // BEFORE the sign-in starts, so it survives a mobile redirect
        // round-trip and the session hook mints rather than validates a
        // stale cookie on return (AGL-463).
        markInteractiveSignIn()
        await setPersistence(auth, browserLocalPersistence)
        await credentialSignIn()
        clearSessionReauth()
      } catch (caught) {
        setError(signInErrorText((caught as { code?: string })?.code))
      } finally {
        setBusy(false)
      }
    },
    [auth, user],
  )

  const handlePasswordSubmit = useCallback(() => {
    const email = state.identity.email
    if (!email || !password) return
    void signInAgain(() => signInWithEmailAndPassword(auth, email, password))
  }, [auth, password, signInAgain, state.identity.email])

  const handleProviderClick = useCallback(() => {
    const provider = providerForId(state.identity.providerId)
    void signInAgain(() =>
      // Mobile popups become tabs whose result never reaches the SDK
      // (AGL-462); the redirect flow returns to THIS route and completes
      // on load, with the interactive marker minting the shared cookie.
      isMobileBrowser()
        ? signInWithRedirect(auth, provider)
        : signInWithPopup(auth, provider),
    )
  }, [auth, signInAgain, state.identity.providerId])

  const handlePasskeyClick = useCallback(() => {
    void signInAgain(() =>
      signInWithPasskey(auth).catch((caught) => {
        // Closing the browser's credential prompt is a cancel; reuse the
        // existing cancel copy rather than reporting a failure.
        const name = (caught as { name?: string })?.name
        if (name === 'NotAllowedError' || name === 'AbortError') {
          throw { code: 'auth/popup-closed-by-user' }
        }
        throw caught
      }),
    )
  }, [auth, signInAgain])

  const handleUseSignInPage = useCallback(() => {
    // Escape hatch (an account whose factors we could not capture, or a
    // user who simply prefers the full page): the classic flow, with the
    // current route carried in `continue` so it still resumes here.
    window.location.assign(
      `/signin?continue=${encodeURIComponent(
        window.location.pathname + window.location.search,
      )}`,
    )
  }, [])

  if (!active) return null

  if (state.dismissed) {
    // "Not now" (only shown once the local user is signed out): the route
    // stays, cached content stays, and this is the way back in. The
    // `stale` trigger's persistent affordance is the session-health
    // banner, so no second banner for it here.
    if (!state.requiresSignIn) return null
    return (
      <Alert
        severity="warning"
        sx={{ borderRadius: 0, position: 'sticky', top: 0, zIndex: 1400 }}
        action={
          <Button color="inherit" size="small" onClick={reopenSessionReauth}>
            {'Sign in'}
          </Button>
        }
      >
        {'You are signed out — pages are read-only and may be out of date. ' +
          'Nothing has been lost; sign in again to keep working.'}
      </Alert>
    )
  }

  const email = state.identity.email
  const showPasswordForm = state.identity.hasPassword && Boolean(email)
  const providerLabel = state.identity.providerId?.startsWith('saml.')
    ? 'Continue with single sign-on'
    : state.identity.providerId?.startsWith('oidc.')
      ? 'Continue with single sign-on'
      : 'Continue with Google'
  const showProviderButton = Boolean(state.identity.providerId)

  return (
    <Dialog open maxWidth="xs" fullWidth onClose={busy ? undefined : dismissSessionReauth}>
      <DialogTitle>{'Sign in again to verify your device'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <DialogContentText>{reasonText(state)}</DialogContentText>
          {email ? (
            <Typography variant="body2" color="text.secondary">
              {email}
            </Typography>
          ) : null}
          {showPasswordForm ? (
            <TextField
              type="password"
              label="Password"
              value={password}
              autoComplete="current-password"
              autoFocus
              disabled={busy}
              onChange={(event) => setPassword(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === 'Enter') handlePasswordSubmit()
              }}
              fullWidth
            />
          ) : null}
          {showProviderButton ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={handleProviderClick}
            >
              {providerLabel}
            </Button>
          ) : null}
          {passkeySupported ? (
            <Button
              variant="outlined"
              disabled={busy}
              onClick={handlePasskeyClick}
            >
              {'Use a passkey'}
            </Button>
          ) : null}
          {!showPasswordForm && !showProviderButton && !passkeySupported ? (
            <Alert severity="info">
              {'Use the sign-in page to continue — this page will resume ' +
                'after you sign in.'}
            </Alert>
          ) : null}
          {error ? <Alert severity="error">{error}</Alert> : null}
          <Typography variant="body2">
            <Button
              variant="text"
              size="small"
              disabled={busy}
              onClick={handleUseSignInPage}
            >
              {'Use the sign-in page instead'}
            </Button>
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={dismissSessionReauth} disabled={busy}>
          {'Not now'}
        </Button>
        {showPasswordForm ? (
          <Button
            variant="contained"
            disabled={busy || !password}
            onClick={handlePasswordSubmit}
          >
            {busy ? 'Signing in…' : 'Sign in'}
          </Button>
        ) : null}
      </DialogActions>
    </Dialog>
  )
}
SessionReauthDialog.displayName = 'SessionReauthDialog'

export default SessionReauthDialog
