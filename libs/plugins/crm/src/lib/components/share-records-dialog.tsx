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

import { MAX_SCOPE_HOSTS } from '@aglyn/aglyn'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Checkbox,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormGroup,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useState } from 'react'
import {
  CRM_SHARING_OBJECT_LABELS,
  type CrmShareAccess,
  type CrmSharingObject,
  type CrmSharingSite,
} from '../model/crm-sharing'
import { callCrmSharing } from '../model/crm-sharing-api'
import type { CrmTaskRouteScope } from '../model/task-routes'

export interface ShareRecordsDialogProps {
  open: boolean
  onClose: () => void
  object: CrmSharingObject
  ids: readonly string[]
  /** The route scope the share is sent with. */
  scope: CrmTaskRouteScope | null
  sites: readonly CrmSharingSite[]
  sitesReady: boolean
  /** Sites that already hold the record — not offered, since they see it anyway. */
  heldHostIds?: readonly string[]
  onShared?: (changed: number) => void
}

/**
 * "Share with sites…" (AGL-3336): the sites a manager picks, or All sites —
 * which covers a site created later — and whether they may edit.
 *
 * Read-only is the default. The sentence under the choice is the guardrail
 * a manager has to read before sharing: the other site sees the person and
 * may work the record, and gains no permission to market to them.
 */
export function ShareRecordsDialog(props: ShareRecordsDialogProps) {
  const { open, onClose, object, ids, scope, sites, sitesReady, heldHostIds = [], onShared } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  const [allSites, setAllSites] = useState(false)
  const [picked, setPicked] = useState<string[]>([])
  const [access, setAccess] = useState<CrmShareAccess>('read')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setAllSites(false)
    setPicked([])
    setAccess('read')
  }, [open])

  const offered = sites.filter((site) => !heldHostIds.includes(site.id))
  const label = CRM_SHARING_OBJECT_LABELS[object]
  const what = ids.length === 1 ? `this ${label.one}` : `${ids.length} ${label.many.toLowerCase()}`
  const tooMany = !allSites && picked.length > MAX_SCOPE_HOSTS
  const ready = Boolean(scope) && ids.length > 0 && (allSites || picked.length > 0) && !tooMany

  const submit = async () => {
    if (!scope || !ready) return
    setBusy(true)
    try {
      const answer = await callCrmSharing(user, scope, 'share', {
        object,
        ids,
        targets: allSites ? 'all' : picked,
        access,
      })
      enqueueSnackbar(
        answer.changed
          ? `Shared ${answer.changed === 1 ? `one ${label.one}` : `${answer.changed} ${label.many.toLowerCase()}`}`
          : `Already shared that way`,
        { variant: 'success', persist: false },
      )
      onShared?.(answer.changed ?? 0)
      onClose()
    } catch (error) {
      enqueueSnackbar((error as Error).message, { variant: 'error', allowDuplicate: true })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog open={open} onClose={busy ? undefined : onClose} fullWidth maxWidth="xs">
      <DialogTitle>{'Share with sites'}</DialogTitle>
      <DialogContent>
        <Stack spacing={2}>
          <Typography variant="body2" color="text.secondary">
            {`The sites you pick see ${what} on their CRM lists and can log activity and tasks on it.`}
          </Typography>
          <FormGroup>
            <FormControlLabel
              control={
                <Checkbox
                  checked={allSites}
                  onChange={(event) => setAllSites(event.target.checked)}
                />
              }
              label="All sites, including sites added later"
            />
            {offered.map((site) => (
              <FormControlLabel
                key={site.id}
                control={
                  <Checkbox
                    checked={allSites || picked.includes(site.id)}
                    disabled={allSites}
                    onChange={(event) =>
                      setPicked((current) =>
                        event.target.checked
                          ? [...current, site.id]
                          : current.filter((id) => id !== site.id),
                      )
                    }
                  />
                }
                label={site.name}
              />
            ))}
            {!sitesReady ? (
              <FormHelperText>{'Loading your sites…'}</FormHelperText>
            ) : !offered.length ? (
              <FormHelperText>{'No other site to share with. All sites still covers sites added later.'}</FormHelperText>
            ) : null}
            {tooMany ? (
              <FormHelperText error>
                {`Choose ${MAX_SCOPE_HOSTS} sites or fewer, or share with All sites.`}
              </FormHelperText>
            ) : null}
          </FormGroup>
          <FormControl>
            <FormLabel>{'Access'}</FormLabel>
            <RadioGroup
              value={access}
              onChange={(event) => setAccess(event.target.value === 'edit' ? 'edit' : 'read')}
            >
              <FormControlLabel value="read" control={<Radio size="small" />} label="Read-only" />
              <FormControlLabel value="edit" control={<Radio size="small" />} label="Read and edit" />
            </RadioGroup>
          </FormControl>
          <Typography variant="caption" color="text.secondary">
            {'Sharing is not consent. A site this is shared with cannot include the person ' +
              'in a campaign, a list or a sequence unless the person gave that site consent.'}
          </Typography>
        </Stack>
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose} disabled={busy}>
          {'Cancel'}
        </Button>
        <Button variant="contained" onClick={() => void submit()} disabled={!ready || busy}>
          {'Share'}
        </Button>
      </DialogActions>
    </Dialog>
  )
}
ShareRecordsDialog.displayName = 'ShareRecordsDialog'

export default ShareRecordsDialog
