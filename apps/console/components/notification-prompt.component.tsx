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

import { mdiBellOutline } from '@aglyn/shared-data-mdi'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  Link as MuiLink,
  Stack,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import useNotificationAlertPrefs from '../hooks/use-notification-prefs'
import {
  desktopNotificationPermission,
  requestDesktopNotifications,
} from '../utils/notification-alerts'

const DISMISSED_KEY = 'aglyn:notification-prompt-dismissed'
/** Long enough to land after the app has settled, not on top of first paint. */
const APPEAR_DELAY_MS = 2500
/**
 * How long "Not now" holds. Originally nothing was persisted at all, on the
 * reasoning that it should be free to offer again later — but the prompt is
 * re-armed on every mount, so "later" meant 2.5 seconds later, on the next
 * navigation that remounted it. A soft no that is asked again immediately is
 * indistinguishable from nagging, and teaches people to click the permanent
 * dismissal just to make it stop.
 */
const SNOOZE_MS = 7 * 24 * 60 * 60 * 1000

/** Stored as 'never', or 'snooze:<epoch-ms when it may ask again>'. */
function readDismissed(): 'never' | 'snoozed' | null {
  if (typeof window === 'undefined') return null
  try {
    const stored = window.localStorage.getItem(DISMISSED_KEY)
    if (stored === 'never') return 'never'
    if (stored?.startsWith('snooze:')) {
      const until = Number(stored.slice('snooze:'.length))
      // A malformed or expired stamp simply means it may ask again.
      return Number.isFinite(until) && Date.now() < until ? 'snoozed' : null
    }
    return null
  } catch {
    return null
  }
}

/**
 * Pre-permission prompt for desktop notifications (AGL-663).
 *
 * The browser grants exactly ONE permission prompt per origin: decline it and
 * the API is permanently `denied`, with no way for the app to ask again —
 * only the user digging through browser settings can undo it. Firing it
 * unprompted therefore risks burning the single ask on someone who happened
 * to be mid-task.
 *
 * So this asks first, in-app, where a "Not now" is free and reversible. The
 * native prompt is only raised for someone who has already said yes here.
 *
 * "Not now" snoozes for a week; "Don't ask me again" is permanent. Never
 * shown when:
 * - permission is already `granted` or `denied` (nothing left to ask),
 * - the user chose "Don't ask me again",
 * - the snooze from a previous "Not now" has not expired,
 * - notifications are unsupported,
 * - nobody is signed in.
 */
export function NotificationPrompt() {
  const { data: user } = useUser()
  const [, setAlertPrefs] = useNotificationAlertPrefs()
  const [open, setOpen] = useState(false)

  useEffect(() => {
    if (!user) return
    if (desktopNotificationPermission() !== 'default') return
    if (readDismissed() != null) return
    // Deferred so it reads as an offer once you're settled, rather than a
    // modal thrown in front of the page you asked for.
    const timer = window.setTimeout(() => setOpen(true), APPEAR_DELAY_MS)
    return () => window.clearTimeout(timer)
  }, [user])

  /**
   * "Not now" — and a backdrop or Escape dismissal, which means the same
   * thing. Snoozed rather than forgotten, so the answer actually holds.
   */
  const handleNotNow = useCallback(() => {
    setOpen(false)
    try {
      window.localStorage.setItem(
        DISMISSED_KEY,
        `snooze:${Date.now() + SNOOZE_MS}`,
      )
    } catch {
      // Private mode — it will offer again next session.
    }
  }, [])

  const handleEnable = useCallback(async () => {
    setOpen(false)
    // Must stay in the click's call stack — browsers reject
    // requestPermission() outside a user gesture.
    const verdict = await requestDesktopNotifications()
    if (verdict === 'granted') setAlertPrefs({ desktop: true })
  }, [setAlertPrefs])

  const handleNever = useCallback(() => {
    setOpen(false)
    try {
      window.localStorage.setItem(DISMISSED_KEY, 'never')
    } catch {
      // Private mode — it will simply offer again next session.
    }
  }, [])

  if (!open) return null

  return (
    <Dialog open onClose={handleNotNow} maxWidth="xs" fullWidth>
      <DialogContent sx={{ pt: 3, pb: 1 }}>
        <Stack spacing={1.5} sx={{ alignItems: 'center', textAlign: 'center' }}>
          <MdiIcon path={mdiBellOutline.path} fontSize="large" />
          <Typography variant="h6">{'Enable notifications'}</Typography>
          <Typography variant="body2" color="text.secondary">
            {'Get notified about form submissions, orders, billing and team ' +
              'changes — so you don’t have to keep checking back.'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions sx={{ px: 3, pb: 1, gap: 1, justifyContent: 'center' }}>
        <Button size="small" variant="outlined" onClick={handleNotNow}>
          {'Not now'}
        </Button>
        <Button
          size="small"
          variant="contained"
          color="secondary"
          onClick={() => void handleEnable()}
        >
          {'Enable'}
        </Button>
      </DialogActions>
      <Stack sx={{ alignItems: 'center', pb: 2 }}>
        <MuiLink
          component="button"
          variant="caption"
          underline="hover"
          onClick={handleNever}
        >
          {'Don’t ask me again'}
        </MuiLink>
      </Stack>
    </Dialog>
  )
}

NotificationPrompt.displayName = 'NotificationPrompt'

export default NotificationPrompt
