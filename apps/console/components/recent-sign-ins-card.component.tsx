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
import {
  Alert,
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogContentText,
  DialogTitle,
  LinearProgress,
  List,
  ListItem,
  ListItemSecondaryAction,
  ListItemText,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import { useUser } from '@aglyn/tenant-feature-instance'
import { docsHelp } from '../constants/docs-links'

interface DeviceRow {
  id: string
  deviceName: string | null
  userAgent: string | null
  location: string | null
  ip: string | null
  firstSeenMs: number | null
  lastSeenMs: number | null
  /** Set once the owner has signed this device out (AGL-1959). */
  revokedAtMs: number | null
  /**
   * Set when this device was recorded WITHOUT mailing an alert, because it
   * shared an IP and an operating system with a device already known
   * (AGL-1959). Shown, because a silent sign-in the owner cannot see is the
   * one thing suppression must never produce.
   */
  alertSuppressedAtMs: number | null
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
 * Recent sign-ins (AGL-2318), in Manage Account → Security.
 *
 * `recordDeviceAndMaybeAlert` writes `userAgent`, `deviceName`, `ip`,
 * `location`, `createdAt` and `lastSeenAt` on every sign-in of every account,
 * and read back exactly two things: whether a device document exists, and
 * whether ANY device exists. Both are existence checks that gate the
 * new-device email. Six descriptive fields, no reader.
 *
 * So somebody got "new sign-in from Chrome on Windows, Dallas, TX" and had
 * nowhere to go — no list to compare it against, no way to tell whether the
 * one before it was theirs. The field names describe this card; the data for
 * it was already being written.
 *
 * Revocation landed with AGL-1959, on the terms AGL-2318 set for it: "a 'sign
 * out everywhere' button that did not actually sign anyone out would be worse
 * than no button." What the button does is described in
 * `app/api/_lib/device-revocation.ts`. Two things about it belong in the UI
 * rather than only in a comment, because getting either wrong is a person
 * believing they are safe when they are not:
 *
 *  - **It signs out every device, including this one.** Firebase has no
 *    per-device refresh-token revocation, so the only lever that reaches the
 *    other browser's stored credential is account-wide. The confirmation says
 *    that in those words instead of implying a narrower effect.
 *  - **A tab that is already open can keep READING for up to an hour.**
 *    Firestore rules key on the ID token, not on our cookie, and the revoked
 *    browser holds one until it expires. It cannot get another.
 *
 *    Everything that goes through our server stops within seconds — but only
 *    since AGL-1881. This bullet used to end "anything that goes through our
 *    server stops immediately", and that sentence was false when it shipped:
 *    `checkRevoked` was set on 3 of 175 verifications, so the revoked token
 *    kept opening all 117 console API routes for the rest of its hour. The
 *    check now lives inside `firebaseAdmin.app().auth()` with a 15s cached
 *    verdict, so the bound is ≤15s on any server and zero on the one that
 *    took the click.
 */
export function RecentSignInsCard() {
  const { data: user } = useUser()
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState<DeviceRow | null>(null)
  const [revoking, setRevoking] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)

  const revoke = useCallback(
    async (device: DeviceRow) => {
      setRevoking(true)
      setError(null)
      try {
        const idToken = await (
          user as { getIdToken?: () => Promise<string> }
        )?.getIdToken?.()
        const response = await fetch('/api/account/devices/revoke', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({ deviceId: device.id }),
        })
        const body = await response.json().catch(() => null)
        if (!response.ok) {
          // Named, never swallowed — for the same reason the load error is.
          // "Nothing happened" is the one answer this control must not give
          // silently, because the person will walk away believing it did.
          setError(body?.error ?? 'Could not sign that device out')
          return
        }
        setDevices((rows) =>
          (rows ?? []).map((row) =>
            row.id === device.id
              ? { ...row, revokedAtMs: Number(body?.revokedAt ?? Date.now()) }
              : row,
          ),
        )
        setNotice(
          'Signed out. Every device has been signed out, including this ' +
            'one — you will be asked to sign in again. It takes effect ' +
            'everywhere within a few seconds; a page already open on another ' +
            'device may keep reading and changing data for up to an hour.',
        )
      } catch {
        setError('Could not sign that device out')
      } finally {
        setRevoking(false)
        setConfirming(null)
      }
    },
    [user],
  )

  useEffect(() => {
    if (!user) return
    let active = true
    void (async () => {
      setLoading(true)
      try {
        const idToken = await (
          user as { getIdToken?: () => Promise<string> }
        )?.getIdToken?.()
        const response = await fetch('/api/account/devices', {
          headers: idToken ? { Authorization: `Bearer ${idToken}` } : {},
        })
        const body = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok) {
          // Named, not swallowed. A security surface that renders an empty
          // list on a failed read tells someone the opposite of the truth —
          // "nothing else has signed in" — which is the one wrong answer this
          // card must never give.
          setError(body?.error ?? 'Could not load your sign-in history')
        } else {
          setDevices((body?.devices ?? []) as DeviceRow[])
        }
      } catch {
        if (active) setError('Could not load your sign-in history')
      } finally {
        if (active) setLoading(false)
      }
    })()
    return () => {
      active = false
    }
  }, [user])

  return (
    <CardDisplay
      header="Recent sign-ins"
      help={docsHelp('account', {
        anchor: '#recent-sign-ins',
        excerpt:
          'Every device that has signed in to your account, newest first — ' +
          'the list behind the "new sign-in" email.',
      })}
      contentGutterX
      contentGutterY
    >
      {loading && devices === null ? <LinearProgress /> : null}
      {error ? <Alert severity="warning">{error}</Alert> : null}
      {devices === null ? null : devices.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No sign-ins recorded yet on this account.'}
        </Typography>
      ) : (
        <>
          <Typography variant="body2" color="text.secondary" gutterBottom>
            {'If you do not recognize one of these, sign it out and change ' +
              'your password. Signing out one device signs out every device, ' +
              'including this one.'}
          </Typography>
          <List dense>
            {devices.map((device) => (
              <ListItem key={device.id} disableGutters>
                <ListItemText
                  primary={
                    device.deviceName ||
                    device.userAgent ||
                    'Unrecognised device'
                  }
                  secondary={
                    /*
                     * EACH ROW'S OWN facts. A card that showed the first
                     * device's location and time beside every row would look
                     * entirely right and be wrong for every row but one —
                     * and being wrong here means telling somebody a stranger's
                     * sign-in was theirs.
                     */
                    [
                      device.location || 'Unknown location',
                      device.ip ? `IP ${device.ip}` : null,
                      `last used ${formatSeen(device.lastSeenMs)}`,
                      device.firstSeenMs
                        ? `first seen ${formatSeen(device.firstSeenMs)}`
                        : null,
                      device.revokedAtMs
                        ? `signed out ${formatSeen(device.revokedAtMs)}`
                        : null,
                      // Suppression silences the email, never the row.
                      device.alertSuppressedAtMs
                        ? 'no email sent — same network and system as a ' +
                          'device already known'
                        : null,
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  }
                />
                <ListItemSecondaryAction>
                  <Button
                    size="small"
                    color="error"
                    disabled={revoking || Boolean(device.revokedAtMs)}
                    onClick={() => setConfirming(device)}
                  >
                    {device.revokedAtMs ? 'Signed out' : 'Sign out'}
                  </Button>
                </ListItemSecondaryAction>
              </ListItem>
            ))}
          </List>
        </>
      )}
      {notice ? <Alert severity="info">{notice}</Alert> : null}
      <Dialog open={Boolean(confirming)} onClose={() => setConfirming(null)}>
        <DialogTitle>{'Sign this device out?'}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {/*
              The whole effect, stated before the click rather than discovered
              after it. Firebase has no per-device refresh-token revocation, so
              the only lever that reaches the other browser's stored credential
              is account-wide — and a person who expects one device to drop and
              finds themselves signed out everywhere will read a working
              control as a broken one.
            */}
            {`Signing out ${
              confirming?.deviceName || 'this device'
            } signs out every device on your account, including this one. ` +
              'You will need to sign in again. It takes effect everywhere ' +
              'within a few seconds; a page already open on another device ' +
              'may keep reading and changing data for up to an hour.'}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setConfirming(null)} disabled={revoking}>
            {'Cancel'}
          </Button>
          <Button
            color="error"
            disabled={revoking}
            onClick={() => confirming && void revoke(confirming)}
          >
            {'Sign out everywhere'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}

RecentSignInsCard.displayName = 'RecentSignInsCard'

export default RecentSignInsCard
