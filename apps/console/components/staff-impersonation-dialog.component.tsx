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

import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  TextField,
} from '@mui/material'
import { signInWithCustomToken, type Auth } from 'firebase/auth'
import { useCallback, useState, type ReactNode } from 'react'

/**
 * Minimum the route enforces (`app/api/admin/impersonate/route.ts`). Duplicated
 * rather than imported because that module is server-only; the mismatch this
 * risks is covered by `staff-impersonation-dialog.spec.tsx`, which asserts the
 * two numbers agree.
 */
export const IMPERSONATION_MIN_REASON_LENGTH = 8

/**
 * The reason gate on staff impersonation (AGL-2125).
 *
 * The route requires a reason and records it on the `adminAudit` row. This is
 * the surface that collects it — without one, the only way to satisfy the
 * route would be to hand-craft the POST, which is the failure shape AGL-1900
 * named: a capability reachable only by curl is not shipped, and a required
 * field reachable only by curl turns the requirement into an outage.
 *
 * Shared by the two call sites (`/admin/orgs/[orgId]` impersonating the owner,
 * `/admin/users/[uid]` impersonating a person) because the requirement is a
 * property of the ACT, not of the page. Two copies would eventually disagree
 * about the minimum length, and the one that disagreed downward would show the
 * operator a dialog that submits and 400s.
 *
 * The whole flow lives here — mint, sign in, redirect — so a caller cannot
 * accidentally reach the endpoint around the dialog.
 */
export function useImpersonationReason(options: {
  auth: Auth
  /** The staff user whose ID token authorises the mint. */
  user: unknown
}): {
  /** Opens the dialog for a target uid. Resolves nothing; the flow redirects. */
  request: (uid: string, label?: string) => void
  /** Render this somewhere in the page. */
  dialog: ReactNode
} {
  const { enqueueSnackbar } = useSnackbar()
  const [target, setTarget] = useState<{ uid: string; label?: string } | null>(
    null,
  )
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const request = useCallback((uid: string, label?: string) => {
    if (!uid) return
    // Never carried over from the previous session — the reason belongs to
    // THIS impersonation, and a pre-filled one is a reason nobody chose.
    setReason('')
    setTarget({ uid, label })
  }, [])

  const close = useCallback(() => {
    setTarget(null)
    setReason('')
  }, [])

  const submit = useCallback(async () => {
    if (!target) return
    setBusy(true)
    try {
      const idToken = await (options.user as any)?.getIdToken?.()
      const response = await fetch('/api/admin/impersonate', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
        },
        body: JSON.stringify({ uid: target.uid, reason: reason.trim() }),
      })
      const payload = await response.json().catch(() => ({}))
      if (!response.ok || !payload.token) {
        // The route's own message names the requirement, so it is surfaced
        // verbatim rather than replaced with a generic failure.
        return void enqueueSnackbar(payload?.error ?? 'Impersonation failed', {
          variant: 'warning',
          persist: false,
        })
      }
      // Replaces THIS browser session with the target account; the
      // impersonation banner (claims.impersonatedBy) offers the exit.
      // The named-app auth instance — bare getAuth() resolves the '[DEFAULT]'
      // app, which this app never registers.
      await signInWithCustomToken(options.auth, payload.token)
      window.location.assign('/')
    } catch (error) {
      console.error(error)
      enqueueSnackbar('Impersonation failed', {
        variant: 'warning',
        persist: false,
      })
    } finally {
      setBusy(false)
    }
  }, [enqueueSnackbar, options.auth, options.user, reason, target])

  const tooShort = reason.trim().length < IMPERSONATION_MIN_REASON_LENGTH

  return {
    request,
    dialog: (
      <Dialog open={Boolean(target)} onClose={close} fullWidth maxWidth={'sm'}>
        <DialogTitle>
          {target?.label
            ? `Sign in as ${target.label}`
            : 'Sign in as this customer'}
        </DialogTitle>
        <DialogContent>
          <DialogContentText sx={{ mb: 2 }}>
            This replaces your staff session in this browser with the
            customer&rsquo;s. The reason is recorded on the audit trail
            alongside your account, and is the only record of why this session
            happened — write what you are reproducing, or the ticket it serves.
          </DialogContentText>
          <TextField
            autoFocus
            fullWidth
            multiline
            minRows={2}
            label={'Reason'}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            error={reason.length > 0 && tooShort}
            helperText={
              reason.length > 0 && tooShort
                ? `At least ${IMPERSONATION_MIN_REASON_LENGTH} characters.`
                : 'e.g. "ticket 481 — billing page shows the wrong plan"'
            }
          />
        </DialogContent>
        <DialogActions>
          <Button onClick={close} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button
            variant={'contained'}
            color={'warning'}
            // Disabled rather than validated on submit: the operator should
            // not be able to discover the requirement by being refused.
            disabled={busy || tooShort}
            onClick={() => void submit()}
          >
            {'Sign in as customer'}
          </Button>
        </DialogActions>
      </Dialog>
    ),
  }
}
