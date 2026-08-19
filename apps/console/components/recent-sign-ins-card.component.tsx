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
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
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
 * REVOCATION IS DELIBERATELY ABSENT. Ending a session needs invalidation,
 * which is a larger piece; the review surface alone closes the loop the email
 * opens, and a "sign out everywhere" button that did not actually sign anyone
 * out would be worse than no button. The card says what it cannot do rather
 * than implying it.
 */
export function RecentSignInsCard() {
  const { data: user } = useUser()
  const [devices, setDevices] = useState<DeviceRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

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
            {'If you do not recognise one of these, change your password and ' +
              'add a passkey. Signing a device out remotely is not available ' +
              'yet.'}
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
                    ]
                      .filter(Boolean)
                      .join(' · ')
                  }
                />
              </ListItem>
            ))}
          </List>
        </>
      )}
    </CardDisplay>
  )
}

RecentSignInsCard.displayName = 'RecentSignInsCard'

export default RecentSignInsCard
