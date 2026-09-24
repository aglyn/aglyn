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

import {
  HOST_ACTION_STEP_LABELS,
  type HostActionStepType,
  hostEventLabel,
  pluginDocsHelp,
  scopeTokensForHost,
} from '@aglyn/aglyn'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { useSnackbar } from '@aglyn/shared-ui-snackstack'
import {
  useFirestore,
  useFirestoreCollection,
  useOrgDataScope,
} from '@aglyn/tenant-feature-instance'
import {
  Button,
  Chip,
  Dialog,
  DialogActions,
  DialogContent,
  DialogTitle,
  Stack,
  Typography,
} from '@mui/material'
import { collection, limit, query, where } from 'firebase/firestore'
import { useCallback, useMemo, useState } from 'react'
import {
  ORG_AUTOMATIONS_COLLECTION,
  ORG_AUTOMATIONS_MAX,
  orgAutomationPausedHostIds,
  type OrgAutomationRow,
} from '../model/org-automations'
import HostRunHistoryCard from './host-run-history-card.component'
import { useOrgAutomationsApi } from './use-org-automations-api'

/**
 * THE ORGANIZATION'S AUTOMATIONS THAT RUN ON THIS SITE (AGL-3302), on the
 * site's own Actions section: read-only, with the one control that belongs
 * to the site — pausing an automation here, and resuming it.
 *
 * Read with the site's own scope tokens, so the listener is provable for a
 * collaborator scoped to this site as well as for an org-wide member, and
 * only the live ones placed here come back. Editing is the organization's,
 * on its own hub; a pause is the site's, through `automations/pause`, which
 * admits the site's admins and editors and refuses anyone else with its own
 * words.
 *
 * Renders nothing while there is nothing: a site the organization runs no
 * automation on has no panel to explain.
 */
export function SiteOrgAutomationsPanel(props: { hostId: string }) {
  const { hostId } = props
  const firestore = useFirestore()
  const api = useOrgAutomationsApi()
  const { enqueueSnackbar } = useSnackbar()
  const { scope } = useOrgDataScope({ hostId })
  const tokens = useMemo(() => scopeTokensForHost(hostId), [hostId])
  const { data: rows } = useFirestoreCollection<OrgAutomationRow>(
    () =>
      scope
        ? query(
            collection(firestore, scope[0], scope[1], ORG_AUTOMATIONS_COLLECTION),
            where('deletedAt', '==', null),
            where('visibleTo', 'array-contains-any', tokens),
            limit(ORG_AUTOMATIONS_MAX + 1),
          )
        : null,
    [firestore, scope, tokens],
    { idField: '$id' },
  )
  const automations = useMemo(
    () =>
      [...(rows ?? [])].sort((a, b) =>
        String(a.name ?? '').localeCompare(String(b.name ?? '')),
      ),
    [rows],
  )
  const [busy, setBusy] = useState<string | null>(null)
  const [runsFor, setRunsFor] = useState<OrgAutomationRow | null>(null)

  const setPaused = useCallback(
    async (row: OrgAutomationRow, paused: boolean) => {
      setBusy(row.$id)
      try {
        await api('pause', { hostId, automationId: row.$id, paused })
        enqueueSnackbar(
          paused
            ? `“${row.name}” is paused on this site`
            : `“${row.name}” runs on this site again`,
          { variant: 'success', persist: false },
        )
      } catch (error) {
        enqueueSnackbar(
          (error as Error)?.message || 'The request could not be completed',
          { variant: 'warning', persist: false },
        )
      } finally {
        setBusy(null)
      }
    },
    [api, hostId, enqueueSnackbar],
  )

  if (!automations.length) return null
  return (
    <CardDisplay
      header={'Org automations on this site'}
      help={pluginDocsHelp('orgAutomations', { anchor: '#pause-it-on-one-site' })}
      contentGutterX
      contentGutterY
    >
      <Stack spacing={1}>
        <Typography variant="body2" color="text.secondary">
          {'Your organization runs these on this site beside the site’s own ' +
            'actions. Each run sends from this site and counts on its action ' +
            'runs. Pausing one stops it here — and anyone waiting inside it ' +
            'here — and leaves every other site alone.'}
        </Typography>
        {automations.map((row) => {
          const paused = orgAutomationPausedHostIds(row).includes(hostId)
          const off = row.enabled === false
          return (
            <Stack
              key={row.$id}
              direction="row"
              spacing={1}
              sx={{ alignItems: 'center' }}
            >
              <Stack sx={{ flex: 1, minWidth: 0 }}>
                <Typography variant="body2" noWrap>
                  {row.name}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap>
                  {`on ${hostEventLabel(row.trigger?.event)} · ${(row.steps ?? [])
                    .map(
                      (step) =>
                        HOST_ACTION_STEP_LABELS[step.type as HostActionStepType] ??
                        step.type,
                    )
                    .join(' → ')}`}
                </Typography>
              </Stack>
              <Chip
                size="small"
                variant="outlined"
                color={off ? 'default' : paused ? 'warning' : 'success'}
                label={off ? 'Switched off' : paused ? 'Paused here' : 'Runs here'}
              />
              <Button
                size="small"
                disabled={busy === row.$id}
                onClick={() => void setPaused(row, !paused)}
              >
                {paused ? 'Resume here' : 'Pause here'}
              </Button>
              <Button size="small" onClick={() => setRunsFor(row)}>
                {'Runs'}
              </Button>
            </Stack>
          )
        })}
      </Stack>
      <Dialog
        open={Boolean(runsFor)}
        onClose={() => setRunsFor(null)}
        maxWidth="sm"
        fullWidth
      >
        <DialogTitle>{`Runs — ${runsFor?.name ?? ''}`}</DialogTitle>
        <DialogContent>
          {runsFor ? (
            <HostRunHistoryCard
              hostId={hostId}
              targetId={runsFor.$id}
              targetName={runsFor.name ?? ''}
              header="Recent runs on this site"
            />
          ) : null}
        </DialogContent>
        <DialogActions>
          <Button color="inherit" onClick={() => setRunsFor(null)}>
            {'Close'}
          </Button>
        </DialogActions>
      </Dialog>
    </CardDisplay>
  )
}
SiteOrgAutomationsPanel.displayName = 'SiteOrgAutomationsPanel'

export default SiteOrgAutomationsPanel
