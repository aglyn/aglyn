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

import BlockedControl from '@aglyn/shared-ui-jsx/components/blocked-control.component'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControlLabel,
  FormGroup,
  List,
  ListItem,
  ListItemText,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import usePinnedOrgs from '../hooks/use-pinned-orgs'
import useOrgScope from '../hooks/use-org-scope'
import { PINNED_ORGS_MAX } from '../utils/workspace-list'

/** A pinned workspace as a dialog names it. */
export interface PinnedOrgEntry {
  id: string
  name: string
}

export interface PinnedFullDialogProps {
  /** The workspace the reader tried to pin, or null when the dialog is closed. */
  pinning: PinnedOrgEntry | null
  /** The five pins, in the reader's order. */
  pins: readonly PinnedOrgEntry[]
  onReplace: (replacing: string) => void
  onClose: () => void
}

/**
 * "Pinned is full. Replace one?" (AGL-3943). Pins are capped at five
 * everywhere (Zach, 2026-10-18), and a sixth is never made room for quietly:
 * the reader picks the pin it takes the place of, or keeps the five.
 */
export function PinnedFullDialog({ pinning, pins, onReplace, onClose }: PinnedFullDialogProps) {
  return (
    <Dialog open={Boolean(pinning)} onClose={onClose} maxWidth="xs" fullWidth>
      <DialogTitle>{'Pinned is full. Replace one?'}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {`You can pin up to ${PINNED_ORGS_MAX} workspaces. Pick the one ` +
            `${pinning?.name ?? 'this workspace'} takes the place of.`}
        </Typography>
        <List dense disablePadding aria-label="Pinned workspaces">
          {pins.map((pin) => (
            <ListItem
              key={pin.id}
              disableGutters
              secondaryAction={
                <Button
                  size="small"
                  aria-label={`Replace ${pin.name}`}
                  onClick={() => onReplace(pin.id)}
                >
                  {'Replace'}
                </Button>
              }
            >
              <ListItemText primary={pin.name} />
            </ListItem>
          ))}
        </List>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{'Keep my pins'}</Button>
      </DialogActions>
    </Dialog>
  )
}
PinnedFullDialog.displayName = 'PinnedFullDialog'

/**
 * "Keep which 5?" (AGL-3943), asked once of a reader who pinned more than
 * five before the cap. Until they answer, the first five they pinned are the
 * pins on every surface; closing the question keeps exactly those, so it is
 * never asked again. Mounted on the console's persistent chrome, it reads
 * the account document it shares with the account menu, and renders nothing
 * for everyone else.
 */
export function PinnedOrgsKeepPrompt() {
  const { stored, pinned, overCap, ready, keep } = usePinnedOrgs(true)
  const { orgs, hasMoreOrgs, loadMoreOrgs } = useOrgScope()
  const open = ready && overCap
  // Every pin is named, so the window grows while the question is open.
  useEffect(() => {
    if (open && hasMoreOrgs) loadMoreOrgs()
  }, [open, hasMoreOrgs, loadMoreOrgs, orgs.length])
  const names = useMemo(
    () => new Map(orgs.map((org) => [org.$id, org.orgName || org.slug || org.$id])),
    [orgs],
  )
  const [checked, setChecked] = useState<string[] | null>(null)
  const picked = checked ?? pinned
  if (!open) return null
  const tooMany = picked.length > PINNED_ORGS_MAX
  const toggle = (id: string) =>
    setChecked(picked.includes(id) ? picked.filter((entry) => entry !== id) : [...picked, id])
  return (
    <Dialog open onClose={() => keep(pinned)} maxWidth="xs" fullWidth>
      <DialogTitle>{`Keep which ${PINNED_ORGS_MAX}?`}</DialogTitle>
      <DialogContent sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
        <Typography variant="body2" color="text.secondary">
          {`You can now pin up to ${PINNED_ORGS_MAX} workspaces, here and in ` +
            `the apps. You pinned ${stored.length}. Until you choose, your ` +
            `first ${PINNED_ORGS_MAX} stay pinned.`}
        </Typography>
        <FormGroup aria-label="Workspaces to keep pinned">
          {stored.map((id) => (
            <FormControlLabel
              key={id}
              control={
                <Checkbox checked={picked.includes(id)} onChange={() => toggle(id)} />
              }
              label={names.get(id) ?? 'A workspace you no longer belong to'}
            />
          ))}
        </FormGroup>
        <Typography
          variant="caption"
          color={tooMany ? 'error' : 'text.secondary'}
          role="status"
        >
          {`${picked.length} of ${PINNED_ORGS_MAX} picked`}
        </Typography>
      </DialogContent>
      <DialogActions>
        <Button onClick={() => keep(pinned)}>{`Keep the first ${PINNED_ORGS_MAX}`}</Button>
        <BlockedControl
          blocked={tooMany}
          reason={`Pick up to ${PINNED_ORGS_MAX} workspaces to keep`}
        >
          <Button variant="contained" onClick={() => keep(picked)}>
            {'Keep these'}
          </Button>
        </BlockedControl>
      </DialogActions>
    </Dialog>
  )
}
PinnedOrgsKeepPrompt.displayName = 'PinnedOrgsKeepPrompt'
