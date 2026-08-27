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
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material'
import { useCallback, useState } from 'react'
import { docsHelp } from '../constants/docs-links'
import { useStaffRole } from '../hooks/use-is-staff'

/** One row of the account's sign-in history, as the detail route returns it. */
export interface StaffDeviceRow {
  id: string
  deviceName: string | null
  userAgent: string | null
  location: string | null
  ip: string | null
  firstSeenMs: number | null
  lastSeenMs: number | null
  revokedAtMs: number | null
  revokedBy: string | null
  alertSuppressedAtMs: number | null
}

export interface StaffUserDeviceSessionsCardProps {
  /** For the confirmation copy — an email means more to a human than a uid. */
  subjectLabel: string
  rows: StaffDeviceRow[]
  /**
   * The read failed. NOT the same as an empty list, and the card must not let
   * a reader mistake one for the other.
   */
  lookupFailed: boolean
  /** Performs the POST; throws with the endpoint's own message on failure. */
  onSignOut: (deviceId: string) => Promise<unknown>
}

/** Date AND time: two sign-ins on the same day is the interesting case. */
function formatSeen(ms: number | null): string {
  if (!ms) return 'Unknown'
  try {
    return new Date(ms).toLocaleString(undefined, {
      year: 'numeric',
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
    })
  } catch {
    return 'Unknown'
  }
}

/**
 * Sign-in history for one account, with the staff sign-out (AGL-1513 part 2).
 *
 * The owner has had this list and this button since AGL-1959/AGL-2318. Staff
 * had neither: the narrowest session control on the staff route was `disable`,
 * which takes the whole account away, so "someone stole my laptop, please kill
 * that session" was answered either by disabling the person or by talking them
 * through their own Security tab — and neither works when they are locked out
 * of their mail, which is most of the calls.
 *
 * ## The two sentences the operator must read before clicking
 *
 * Both are on the confirmation, not only in a comment, because getting either
 * wrong means telling a customer something untrue while they are frightened:
 *
 *  - **Every device signs out, not just this one.** Firebase has no per-device
 *    refresh-token revocation. What is per-device is the refusal afterwards:
 *    the evicted browser stays refused at the session boundary because it
 *    cannot produce a newer `auth_time`, while the owner signs back in
 *    normally. So the honest promise is "everyone signs out once, you sign back
 *    in, that device does not".
 *  - **A tab already open can keep reading AND WRITING for up to an hour.**
 *    Firestore rules key on the ID token, not on our cookie. Everything that
 *    goes through our server stops within ~15 seconds (AGL-1881) — but the
 *    console edits Firestore DIRECTLY from the browser for most of what it
 *    does (screens, layouts, products, contacts, the canvas node graph), and
 *    `cloud/firebase-firestore.rules` never consults revocation: no rule reads
 *    `auth.token.auth_time`, so a still-valid ID token keeps its full write
 *    access until it expires. Presence/co-edit RTDB writes survive the same
 *    way, on the `presenceOrg`/`coeditHost` claims baked into that token.
 *    Storage is the one exception — `firebase-storage.rules` denies every
 *    client path, so uploads really do stop at once.
 *
 *    The copy below therefore says "reading and changing". It said "reading"
 *    alone until AGL-1513 measured it against the emulator; that was the same
 *    shape of false promise this comment block exists to prevent.
 *
 * ## Why it is super-only and role-refused rather than hidden
 *
 * Same terms as the erase card: the route demands `staffRole === 'super'`, so a
 * support-role operator gets an explanation instead of a button that 403s.
 * Hiding it entirely would leave them unable to tell "not allowed" from "this
 * account has no devices".
 */
export function StaffUserDeviceSessionsCard({
  subjectLabel,
  rows,
  lookupFailed,
  onSignOut,
}: StaffUserDeviceSessionsCardProps) {
  const staffRole = useStaffRole()
  const { enqueueSnackbar } = useSnackbar()
  const [confirming, setConfirming] = useState<StaffDeviceRow | null>(null)
  const [busy, setBusy] = useState(false)
  const [revoked, setRevoked] = useState<Record<string, number>>({})

  const signOut = useCallback(
    async (device: StaffDeviceRow) => {
      setBusy(true)
      try {
        const result = (await onSignOut(device.id)) as { revokedAt?: number }
        setRevoked((prior) => ({
          ...prior,
          [device.id]: Number(result?.revokedAt ?? Date.now()),
        }))
        enqueueSnackbar(
          'Device signed out (audited). Every session on the account ended; ' +
            'they can sign in again, that device cannot.',
          { variant: 'success', persist: false },
        )
        setConfirming(null)
      } catch (error) {
        // The endpoint's own message, never a generic one. "Nothing happened"
        // is the single answer this control must not give quietly, because the
        // operator will tell the customer it worked.
        enqueueSnackbar(
          (error as { message?: string })?.message ??
            'Signing that device out failed',
          { variant: 'error' },
        )
      } finally {
        setBusy(false)
      }
    },
    [onSignOut, enqueueSnackbar],
  )

  // `null` while the claim is still resolving — rendering the refusal in that
  // window would flash at every super-staff member on every page load.
  if (staffRole === null) return null

  const help = docsHelp('staffConsole', {
    anchor: '#sign-one-device-out',
    excerpt:
      'Every device that has signed in to this account, and the narrowest ' +
      'session control there is: end the sessions on one device without ' +
      'disabling the account.',
  })

  if (staffRole !== 'super') {
    return (
      <CardDisplay
        header="Sign-in history"
        help={help}
        contentGutterX
        contentGutterY
      >
        <Typography variant="body2" color="text.secondary">
          {'Signing a device out requires the super staff role. Ask someone ' +
            'who holds it, or walk the account holder through Manage account → ' +
            'Security, where the same control is self-serve.'}
        </Typography>
      </CardDisplay>
    )
  }

  return (
    <CardDisplay
      header="Sign-in history"
      help={help}
      contentGutterX
      contentGutterY
    >
      {lookupFailed ? (
        <Alert severity="warning">
          {
            'The device registry could not be read. This is NOT the same as "no other devices" — do not tell anyone their account is clean from this screen until it loads.'
          }
        </Alert>
      ) : rows.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No sign-ins recorded on this account yet.'}
        </Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {'Signing one device out ends every session on the account — they ' +
              'sign in again and keep working, that device stays refused. The ' +
              'account is not disabled and no password changes. Audited.'}
          </Typography>
          <List dense>
            {rows.map((device) => {
              const revokedAt = revoked[device.id] ?? device.revokedAtMs
              return (
                <ListItem
                  key={device.id}
                  disableGutters
                  /**
                   * A flex row, not an absolutely-positioned action
                   * (AGL-1482). `ListItemSecondaryAction` takes the button
                   * out of flow and pins it to the right edge, and the text
                   * beside it reserves nothing — so a device line long
                   * enough to wrap ran straight under "SIGN OUT", with the
                   * two drawn on top of each other.
                   *
                   * In flow the button cannot be overlapped whatever the
                   * text does, and it does not depend on guessing a gutter
                   * wide enough for the widest label (this one alternates
                   * between "Sign out" and "Signed out").
                   */
                  sx={{ alignItems: 'flex-start', gap: 2 }}
                >
                  <ListItemText
                    sx={{ my: 0 }}
                    primary={
                      device.deviceName ||
                      device.userAgent ||
                      'Unrecognised device'
                    }
                    secondary={
                      /*
                       * EACH ROW'S OWN facts. A card that showed the first
                       * device's location beside every row would look entirely
                       * right and be wrong for every row but one — and being
                       * wrong here means telling somebody a stranger's sign-in
                       * was theirs.
                       */
                      [
                        device.location || 'Unknown location',
                        device.ip ? `IP ${device.ip}` : null,
                        `last used ${formatSeen(device.lastSeenMs)}`,
                        device.firstSeenMs
                          ? `first seen ${formatSeen(device.firstSeenMs)}`
                          : null,
                        revokedAt
                          ? `signed out ${formatSeen(revokedAt)}${
                              device.revokedBy ? ` by ${device.revokedBy}` : ''
                            }`
                          : null,
                        device.alertSuppressedAtMs
                          ? 'no email sent — same network and system as a ' +
                            'device already known'
                          : null,
                      ]
                        .filter(Boolean)
                        .join(' · ')
                    }
                  />
                  <Button
                    size="small"
                    color="error"
                    disabled={busy || Boolean(revokedAt)}
                    onClick={() => setConfirming(device)}
                    // Never squeezed by the text beside it, and level with
                    // the device name rather than floating in the middle of
                    // a wrapped block.
                    sx={{ flexShrink: 0, alignSelf: 'flex-start' }}
                  >
                    {revokedAt ? 'Signed out' : 'Sign out'}
                  </Button>
                </ListItem>
              )
            })}
          </List>
        </>
      )}
      <Dialog open={Boolean(confirming)} onClose={() => setConfirming(null)}>
        <DialogTitle>{'Sign this device out?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {/*
              The whole effect, stated before the click rather than discovered
              after it — and stated to the person who will be repeating it to a
              customer on the phone.
            */}
            {`Signing out ${
              confirming?.deviceName || 'this device'
            } ends every session on ${subjectLabel}’s account. They can sign ` +
              'in again straight away on their own devices; this one stays ' +
              'refused. The account is not disabled and the password does not ' +
              'change. It takes effect on our servers within a few seconds; a ' +
              'page already open on the signed-out device may keep reading ' +
              'and changing data for up to an hour, though file uploads stop ' +
              'at once.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)} disabled={busy}>
            {'Cancel'}
          </Button>
          <Button
            color="error"
            disabled={busy}
            onClick={() => confirming && void signOut(confirming)}
          >
            {'Sign out this device'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

StaffUserDeviceSessionsCard.displayName = 'StaffUserDeviceSessionsCard'

export default StaffUserDeviceSessionsCard
