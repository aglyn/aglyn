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

import { sharingFromChoice } from '@aglyn/aglyn/app-utils/scope-tokens'
import {
  SiteSharingField,
  type SiteSharingValue,
} from '@aglyn/shared-ui-jsx/components/site-sharing-field.component'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import { useUser } from '@aglyn/tenant-feature-instance'
import {
  Button,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  FormControl,
  FormControlLabel,
  FormHelperText,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  Typography,
} from '@mui/material'
import { useEffect, useMemo, useState } from 'react'
import {
  CRM_SHARING_MAX_INCLUDED,
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
  /**
   * Sites that already hold the record. They are listed like every site, so
   * what each choice reaches reads true, and the dialog says they keep it.
   */
  heldHostIds?: readonly string[]
  onShared?: (changed: number) => void
}

/**
 * What `crm/sharing` `share` reads as `targets` for a choice (AGL-4047):
 * `'all'`, the sites, or all sites except the ones left out.
 */
export function shareTargetsOfChoice(
  choice: SiteSharingValue,
): 'all' | string[] | { mode: 'allExcept'; exceptHostIds: string[] } {
  if (choice.mode === 'all') return 'all'
  if (choice.mode === 'selected') return [...choice.hostIds]
  return { mode: 'allExcept', exceptHostIds: [...choice.exceptHostIds] }
}

/**
 * "Share with sites…" (AGL-3336): All sites — which covers a site created
 * later — the sites a manager picks, or all sites except the ones they leave
 * out (AGL-4047), which a site created later also joins; and whether they
 * may edit. Radios and a visible list, through the shared sharing field.
 *
 * Read-only is the default. The sentence under the choice is the guardrail
 * a manager has to read before sharing: the other site sees the person and
 * may work the record, and gains no permission to market to them.
 */
export function ShareRecordsDialog(props: ShareRecordsDialogProps) {
  const { open, onClose, object, ids, scope, sites, sitesReady, heldHostIds = [], onShared } = props
  const { data: user } = useUser()
  const { enqueueSnackbar } = useSnackbar()
  // Nothing is chosen until the manager chooses.
  const [choice, setChoice] = useState<SiteSharingValue | null>(null)
  const [access, setAccess] = useState<CrmShareAccess>('read')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    if (!open) return
    setChoice(null)
    setAccess('read')
  }, [open])

  const holders = sites.filter((site) => heldHostIds.includes(site.id)).map((site) => site.name)
  const others = sites.length - holders.length
  const label = CRM_SHARING_OBJECT_LABELS[object]
  const what = ids.length === 1 ? `this ${label.one}` : `${ids.length} ${label.many.toLowerCase()}`
  // What the route will answer, from the same helper: the sites it reaches
  // are worked out against every site of the workspace, held ones included.
  const problem = useMemo(() => {
    if (!choice) return null
    if (choice.mode === 'selected' && !choice.hostIds.length) return 'Choose a site to share with.'
    if (choice.mode === 'allExcept' && !sitesReady) return null
    return sharingFromChoice(
      choice,
      sites.map((site) => site.id),
      { maxIncluded: CRM_SHARING_MAX_INCLUDED },
    ).problem
  }, [choice, sites, sitesReady])
  const ready = Boolean(scope) && ids.length > 0 && Boolean(choice) && !problem

  const submit = async () => {
    if (!scope || !ready || !choice) return
    setBusy(true)
    try {
      const answer = await callCrmSharing(user, scope, 'share', {
        object,
        ids,
        targets: shareTargetsOfChoice(choice),
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
          <SiteSharingField
            label="Share with"
            value={choice}
            onChange={setChoice}
            sites={sites}
            sitesReady={sitesReady}
            maxIncluded={CRM_SHARING_MAX_INCLUDED}
            problem={problem}
          />
          {sitesReady && !others ? (
            <FormHelperText>{'No other site to share with. All sites still covers sites added later.'}</FormHelperText>
          ) : holders.length ? (
            <FormHelperText>
              {`${holders.join(', ')} already ${holders.length === 1 ? 'holds' : 'hold'} ${what}, and ${
                holders.length === 1 ? 'keeps' : 'keep'
              } it whatever you choose.`}
            </FormHelperText>
          ) : null}
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
