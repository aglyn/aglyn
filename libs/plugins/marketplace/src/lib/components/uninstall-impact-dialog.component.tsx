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

import { useUser } from '@aglyn/tenant-feature-instance'
import { authorizedFetch } from '@aglyn/shared-util-http/authorized-token'
import {
  Alert,
  Box,
  Button,
  Chip,
  CircularProgress,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { useCallback, useEffect, useState } from 'react'
import type { UninstallTarget } from '../model/marketplace'
import {
  UNINSTALL_ACKNOWLEDGEMENT,
  type UninstallImpact,
  uninstallImpactView,
} from '../model/marketplace-catalog'

export interface UninstallImpactDialogProps {
  open: boolean
  listing: { $id?: string; displayName?: string; pluginId?: string } | null
  /** Sites this uninstall touches — see `resolveUninstallTargets`. */
  targets: readonly UninstallTarget[]
  scope: 'org' | 'host'
  onCancel: () => void
  onConfirm: () => void | Promise<unknown>
}

/**
 * What an uninstall breaks, before it happens (AGL-1027).
 *
 * Uninstalling was a single click with no confirmation and no statement of
 * consequence — the pin went away and every page placing the plugin stopped
 * rendering it, on live sites, silently. A generic "are you sure?" would not
 * have fixed that: a confirmation that only asks whether you are sure trains
 * people to click through it. This one names what stops working, and scales its
 * friction to the finding:
 *
 * * nothing placed anywhere → a plain confirm, because there is nothing to
 *   weigh and adding ceremony to a harmless action is how ceremony stops
 *   being read;
 * * published pages affected → a typed acknowledgement, because the number is
 *   the point and typing it is the only way to be sure it was seen.
 *
 * It also has to say when uninstalling changes NOTHING visible: removing a host
 * pin while an org pin still covers the site swaps which pointer is in use, and
 * a dialog that implied the plugin was about to stop working would be wrong in
 * the direction that stops people trusting it.
 */
export function UninstallImpactDialog(props: UninstallImpactDialogProps) {
  const { open, listing, targets, scope, onCancel, onConfirm } = props
  const { data: user } = useUser()
  const [impact, setImpact] = useState<UninstallImpact | null>(null)
  const [failed, setFailed] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)

  const pluginId = listing?.pluginId ? String(listing.pluginId) : ''
  const losing = targets.filter((target) => !target.stillCovered)
  const covered = targets.filter((target) => target.stillCovered)
  const targetKey = targets.map((target) => target.hostId).join(',')

  useEffect(() => {
    if (!open) {
      setImpact(null)
      setFailed(false)
      setTyped('')
      return
    }
    // Nothing to scan: either the plugin has no manifest id to match nodes on,
    // or every site keeps it. Both are answerable without a request.
    if (!pluginId || !losing.length) {
      setImpact(null)
      return
    }
    let active = true
    setFailed(false)
    void (async () => {
      try {
        const response = await authorizedFetch(
          user,
          '/api/hosts/plugin-impact',
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              pluginId,
              hostIds: targets.map((target) => target.hostId),
              stillCoveredHostIds: covered.map((target) => target.hostId),
            }),
          },
        )
        const payload = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok || !payload) return void setFailed(true)
        setImpact(payload as UninstallImpact)
      } catch {
        if (active) setFailed(true)
      }
    })()
    return () => {
      active = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, pluginId, targetKey, user])

  const confirm = useCallback(async () => {
    setBusy(true)
    try {
      await onConfirm()
    } finally {
      setBusy(false)
    }
  }, [onConfirm])

  /*
   * The scan could not speak, so it must not be read as "nothing breaks": a
   * failed check is a reason for MORE friction, not less — the one thing it
   * rules out is confidence. What the dialog says, and how much friction it
   * asks for, is `uninstallImpactView`, which the native apps replay.
   */
  const view = uninstallImpactView({
    name: listing?.displayName ?? 'this plugin',
    scope,
    pluginId,
    targets,
    impact,
    failed,
  })
  const canConfirm =
    !busy &&
    !view.scanning &&
    (!view.needsAcknowledgement ||
      typed.trim().toUpperCase() === UNINSTALL_ACKNOWLEDGEMENT)

  return (
    <Dialog open={open} onClose={() => !busy && onCancel()} maxWidth="sm" fullWidth>
      <DialogTitle>{view.title}</DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {view.scanning ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                {'Checking what this would break…'}
              </Typography>
            </Stack>
          ) : null}

          {view.alerts.map((alert) => (
            <Alert key={alert.text} severity={alert.tone}>
              {alert.text}
            </Alert>
          ))}

          {view.sites.map((site) => (
            <Box key={site.label}>
              <Typography variant="subtitle2">{site.label}</Typography>
              <Typography variant="caption" color="text.secondary">
                {site.pages}
              </Typography>
              <Stack
                useFlexGap
                direction="row"
                spacing={1}
                sx={{ flexWrap: 'wrap', gap: 1, marginTop: 1 }}
              >
                {site.chips.map((chip) => (
                  <Chip key={chip} size="small" variant="outlined" label={chip} />
                ))}
              </Stack>
            </Box>
          ))}

          {view.note ? (
            <Typography variant="body2" color="text.secondary">
              {view.note}
            </Typography>
          ) : null}

          {view.needsAcknowledgement ? (
            <TextField
              size="small"
              label={`Type ${UNINSTALL_ACKNOWLEDGEMENT} to confirm`}
              value={typed}
              onChange={(event) => setTyped(event.target.value)}
              autoComplete="off"
            />
          ) : null}
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button disabled={busy} onClick={onCancel}>
          {'Cancel'}
        </Button>
        <Button
          color="error"
          variant="contained"
          disabled={!canConfirm}
          onClick={() => void confirm()}
        >
          {view.confirmLabel}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
UninstallImpactDialog.displayName = 'UninstallImpactDialog'

export default UninstallImpactDialog
