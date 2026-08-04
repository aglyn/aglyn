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

/** Mirrors the `/api/hosts/plugin-impact` response. */
interface ImpactSite {
  hostId: string
  label: string
  stillCovered: boolean
  placements: Array<{
    type: 'screen' | 'layout' | 'component'
    id: string
    name: string
    count: number
  }>
  affectedScreens: number
  truncated: boolean
}
interface Impact {
  sites: ImpactSite[]
  losingSites: number
  placements: number
  affectedScreens: number
  truncated: boolean
  dataSurvives: boolean
}

/** The word people expect to type when a confirmation is worth slowing down. */
const ACKNOWLEDGEMENT = 'UNINSTALL'

const PLACEMENT_NOUNS: Record<ImpactSite['placements'][number]['type'], string> =
  {
    screen: 'page',
    layout: 'layout',
    component: 'component',
  }

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
  const [impact, setImpact] = useState<Impact | null>(null)
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
        const idToken = await (user as any)?.getIdToken?.()
        const response = await fetch('/api/hosts/plugin-impact', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
          },
          body: JSON.stringify({
            pluginId,
            hostIds: targets.map((target) => target.hostId),
            stillCoveredHostIds: covered.map((target) => target.hostId),
          }),
        })
        const payload = await response.json().catch(() => null)
        if (!active) return
        if (!response.ok || !payload) return void setFailed(true)
        setImpact(payload as Impact)
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

  const name = listing?.displayName ?? 'this plugin'
  const scanning = Boolean(pluginId) && losing.length > 0 && !impact && !failed
  const affected = impact?.affectedScreens ?? 0
  /**
   * The scan could not speak, so it must not be read as "nothing breaks".
   * A failed check is a reason for MORE friction, not less — the one thing it
   * rules out is confidence.
   */
  const unknown = failed || (!pluginId && losing.length > 0)
  const needsAcknowledgement = affected > 0 || unknown
  const canConfirm =
    !busy &&
    !scanning &&
    (!needsAcknowledgement || typed.trim().toUpperCase() === ACKNOWLEDGEMENT)

  return (
    <Dialog open={open} onClose={() => !busy && onCancel()} maxWidth="sm" fullWidth>
      <DialogTitle>
        {scope === 'org'
          ? `Uninstall ${name} across the organization?`
          : `Remove ${name} from this site?`}
      </DialogTitle>
      <DialogContent dividers>
        <Stack spacing={2}>
          {scanning ? (
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
              <CircularProgress size={16} />
              <Typography variant="body2" color="text.secondary">
                {'Checking what this would break…'}
              </Typography>
            </Stack>
          ) : null}

          {unknown && !scanning ? (
            <Alert severity="warning">
              {pluginId
                ? 'The impact check could not run, so this cannot say what ' +
                  'would stop working. Nothing here means "nothing breaks".'
                : 'This listing records no plugin id, so its placements cannot ' +
                  'be found. Pages using it may stop rendering it.'}
            </Alert>
          ) : null}

          {!scanning && !unknown && affected > 0 ? (
            <Alert severity="error">
              {`Removes ${name} from ${impact?.losingSites ?? losing.length} ` +
                `site${(impact?.losingSites ?? losing.length) === 1 ? '' : 's'}; ` +
                `${impact?.truncated ? 'at least ' : ''}${affected} published ` +
                `page${affected === 1 ? '' : 's'} ` +
                `place${affected === 1 ? 's' : ''} it and will stop ` +
                'rendering it.'}
            </Alert>
          ) : null}

          {!scanning && !unknown && affected === 0 && losing.length ? (
            <Alert severity="info">
              {'No published page places this plugin, so nothing visitors can ' +
                'see changes.'}
            </Alert>
          ) : null}

          {covered.length ? (
            // The case that would otherwise read as a lie.
            <Alert severity="info">
              {covered.length === targets.length
                ? 'The plugin keeps running on ' +
                  (covered.length === 1
                    ? 'this site'
                    : `all ${covered.length} of these sites`) +
                  ', because another install still covers ' +
                  (covered.length === 1 ? 'it' : 'them') +
                  '. Only which version is in use changes.'
                : `${covered.length} of these sites keep the plugin — ` +
                  `${covered
                    .map((target) => target.label)
                    .join(', ')} — because another install still covers them.`}
            </Alert>
          ) : null}

          {impact?.sites
            .filter((site) => !site.stillCovered && site.placements.length)
            .map((site) => (
              <Box key={site.hostId}>
                <Typography variant="subtitle2">{site.label}</Typography>
                <Typography variant="caption" color="text.secondary">
                  {`${site.affectedScreens} published page` +
                    `${site.affectedScreens === 1 ? '' : 's'} affected`}
                </Typography>
                <Stack
                  direction="row"
                  spacing={1}
                  sx={{ flexWrap: 'wrap', gap: 1, marginTop: 1 }}
                >
                  {site.placements.slice(0, 12).map((placement) => (
                    <Chip
                      key={`${placement.type}:${placement.id}`}
                      size="small"
                      variant="outlined"
                      label={
                        `${PLACEMENT_NOUNS[placement.type]}: ${placement.name}` +
                        (placement.count > 1 ? ` ×${placement.count}` : '')
                      }
                    />
                  ))}
                  {site.placements.length > 12 ? (
                    <Chip
                      size="small"
                      label={`+${site.placements.length - 12} more`}
                    />
                  ) : null}
                </Stack>
              </Box>
            ))}

          {!scanning && losing.length ? (
            <Typography variant="body2" color="text.secondary">
              {'Uninstalling removes the install only. The plugin’s settings ' +
                'and any data it stored are kept, and installing it again ' +
                'restores the pages that place it.'}
            </Typography>
          ) : null}

          {needsAcknowledgement && !scanning ? (
            <TextField
              size="small"
              label={`Type ${ACKNOWLEDGEMENT} to confirm`}
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
          {scope === 'org' ? 'Uninstall org-wide' : 'Remove'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
UninstallImpactDialog.displayName = 'UninstallImpactDialog'

export default UninstallImpactDialog
