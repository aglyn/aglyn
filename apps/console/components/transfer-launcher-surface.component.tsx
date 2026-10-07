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
  TransferExportDialog,
  TransferImportWizard,
  type TransferWizardExtraStep,
} from '@aglyn/aglyn-transfer-ui'
import {
  pluginTransferResourceUi,
  type TransferWizardStep,
} from '@aglyn/aglyn/plugin-manager/plugin-transfer-resources'
import { ICON_VARIANT_CLOSE } from '@aglyn/shared-data-enums'
import { MdiIcon } from '@aglyn/shared-ui-jsx'
import {
  Dialog,
  DialogContent,
  DialogTitle,
  IconButton,
  Stack,
  Typography,
  useMediaQuery,
  useTheme,
} from '@mui/material'
import { createElement, useCallback, useMemo, useState } from 'react'
import { useFirestore, useUser } from '@aglyn/tenant-feature-instance'
import { createHttpTransferClient } from '../utils/transfer-http-client'
import { saveTransferPrefs } from '../utils/transfer-prefs-store'
import type { TransferLaunchState } from './transfer-launcher-provider.component'

export interface TransferLauncherSurfaceProps {
  state: TransferLaunchState
  orgId: string
  getIdToken(): Promise<string>
  onClose(): void
}

/** The core steps a plugin's own step may follow in the console's wizard: those before the review. */
const BEFORE_REVIEW = new Set<TransferWizardStep['after']>(['upload', 'mapping', 'values', 'matching', 'conflicts'])

/**
 * A plugin's own steps (`registerPluginTransferResourceUi`) as the kit's:
 * the step's component is handed the job and its answer, the answer rides
 * in the draft's `extras` under the step's id, and Next waits for
 * `setComplete(true)`.
 */
export function pluginWizardSteps(
  steps: readonly TransferWizardStep[],
  scope: { resource: string; orgId: string; hostId: string | null },
  complete: Readonly<Record<string, boolean>>,
  setComplete: (stepId: string, done: boolean) => void,
): TransferWizardExtraStep[] {
  return steps
    .filter((step) => BEFORE_REVIEW.has(step.after))
    .map((step) => ({
      id: step.id,
      label: step.label,
      after: step.after as TransferWizardExtraStep['after'],
      render: (context) =>
        createElement(step.component, {
          ...scope,
          jobId: context.draft.jobId,
          value: context.value,
          setValue: context.setValue,
          setComplete: (done: boolean) => setComplete(step.id, done),
        }),
      problems: () => (complete[step.id] ? [] : [`Finish “${step.label}” to go on.`]),
    }))
}

/**
 * What the launcher opens (AGL-3539): the import wizard in a dialog — full
 * screen on a phone — or the export dialog, both talking to the job
 * engine's routes through the console's HTTP client.
 */
export function TransferLauncherSurface({ state, orgId, getIdToken, onClose }: TransferLauncherSurfaceProps) {
  const theme = useTheme()
  const narrow = useMediaQuery(theme.breakpoints.down('sm'))
  const hostId = state.launch.hostId ?? null
  const resource = state.launch.resource
  const firestore = useFirestore()
  const { data: user } = useUser()
  const uid = user?.uid ?? null
  const client = useMemo(
    () =>
      createHttpTransferClient({
        orgId,
        hostId,
        getIdToken,
        ...(uid ? { savePrefs: (key: string, prefs) => saveTransferPrefs(firestore, uid, key, prefs) } : {}),
      }),
    [orgId, hostId, getIdToken, firestore, uid],
  )
  const ui = pluginTransferResourceUi(resource)
  const [complete, setCompleteState] = useState<Record<string, boolean>>({})
  const setComplete = useCallback(
    (stepId: string, done: boolean) =>
      setCompleteState((current) => (current[stepId] === done ? current : { ...current, [stepId]: done })),
    [],
  )
  const extraSteps = useMemo(
    () => pluginWizardSteps(ui?.extraSteps ?? [], { resource, orgId, hostId }, complete, setComplete),
    [ui, resource, orgId, hostId, complete, setComplete],
  )

  if (state.kind === 'export') {
    const { launch } = state
    return (
      <TransferExportDialog
        open
        onClose={onClose}
        client={client}
        resource={launch.resource}
        {...(launch.title ? { title: launch.title } : {})}
        {...(launch.selection?.length ? { selection: launch.selection } : {})}
        {...(launch.filter ? { filter: launch.filter } : {})}
        {...(launch.preset ? { preset: launch.preset } : {})}
      />
    )
  }

  const { launch } = state
  return (
    <Dialog
      open
      onClose={onClose}
      fullWidth
      maxWidth="lg"
      fullScreen={narrow}
      aria-labelledby="transfer-import-title"
    >
      <DialogTitle id="transfer-import-title">
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: 'space-between' }}>
          <Typography variant="h6" component="span">
            {launch.title ?? (ui?.label ? `Import ${ui.label}` : 'Import')}
          </Typography>
          <IconButton aria-label="Close" onClick={onClose} edge="end">
            <MdiIcon path={ICON_VARIANT_CLOSE.path} />
          </IconButton>
        </Stack>
      </DialogTitle>
      <DialogContent dividers>
        <TransferImportWizard
          client={client}
          resource={launch.resource}
          jobId={launch.jobId ?? null}
          extraSteps={extraSteps}
          {...(launch.mappingZone
            ? { importMappingZone: { collection: launch.mappingZone, hostId, orgId } }
            : {})}
          onDone={() => {
            launch.onFinished?.()
            onClose()
          }}
        />
      </DialogContent>
    </Dialog>
  )
}

export default TransferLauncherSurface
