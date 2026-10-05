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

/**
 * The import wizard: eight steps, nothing decided silently.
 *
 *   Upload → Columns → Values → Matching → Conflicts → Review → Import → Results
 *
 * Every column, value, match and conflict is shown with what will happen
 * and a choice; every warning class is acknowledged before Import enables;
 * an applied import can be undone for seven days. A plugin adds its own
 * steps (a consent attestation) through `extraSteps` or the registry.
 *
 * The step list is a stepper of buttons: a step already passed can be
 * reopened from the keyboard or pointer, until the import starts writing.
 * The draft is saved per job, so a reload with the job id resumes where
 * the person left off.
 */

import {
  Alert,
  Box,
  CircularProgress,
  Stack,
  Step,
  StepButton,
  StepLabel,
  Stepper,
} from '@mui/material'

import { ImportApplyStep } from './import-apply-step.component'
import { ImportConflictsStep } from './import-conflicts-step.component'
import { ImportDryRunStep } from './import-dry-run-step.component'
import { ImportMappingStep } from './import-mapping-step.component'
import type { TransferImportMappingZone } from './import-mapping-step.component'
import { ImportMatchingStep } from './import-matching-step.component'
import { ImportResultsStep } from './import-results-step.component'
import { ImportUploadStep } from './import-upload-step.component'
import { ImportValuesStep } from './import-values-step.component'
import type { TransferClient } from './transfer-client'
import type { TransferWizardStorage } from './transfer-wizard-state'
import { TransferWizardNav } from './transfer-wizard-nav.component'
import type { TransferWizardExtraStep } from './transfer-wizard-steps'
import { useTransferImportWizard } from './use-transfer-import-wizard'
import type { TransferImportWizardController } from './use-transfer-import-wizard'

export interface TransferImportWizardProps {
  client: TransferClient
  /** The resource key the file is imported into. */
  resource: string
  /** Resume this job. */
  jobId?: string | null
  /** Told the job id once a file is uploaded, so a reload can resume it. */
  onJobChange?(jobId: string | null): void
  /** Where the `importMapping` zone renders on the mapping step; omitted, the zone is not shown. */
  importMappingZone?: TransferImportMappingZone
  /** Steps the owning plugin adds. Registered steps for the resource are added too. */
  extraSteps?: readonly TransferWizardExtraStep[]
  storage?: TransferWizardStorage
  /** Called from the results step's Done. */
  onDone?(): void
  /** Saves a downloaded file; defaults to a browser download. */
  download?(fileName: string, body: Blob): void
  now?: () => number
}

function ExtraStep({ wizard }: { wizard: TransferImportWizardController }) {
  const step = wizard.steps[wizard.stepIndex]
  const extra = step?.extra
  if (!extra || !wizard.info) return null
  const context = {
    resource: wizard.info,
    draft: wizard.draft,
    analysis: wizard.analysis,
    value: wizard.draft.extras[extra.id],
    setValue: (value: unknown) =>
      wizard.setDraft((d) => ({
        ...d,
        extras: { ...d.extras, [extra.id]: value },
      })),
  }
  return (
    <Stack spacing={2}>
      {extra.render(context)}
      <TransferWizardNav
        busy={wizard.busy}
        blockers={extra.problems?.(context) ?? []}
        onBack={wizard.back}
        onNext={() => void wizard.next()}
      />
    </Stack>
  )
}

const LOCKED_AFTER_START = new Set(['apply', 'results'])

export function TransferImportWizard(props: TransferImportWizardProps) {
  const wizard = useTransferImportWizard(props)
  const { steps, stepIndex, draft } = wizard
  const started = LOCKED_AFTER_START.has(draft.step)

  if (!wizard.info) {
    return wizard.error ? (
      <Alert severity="error">{wizard.error}</Alert>
    ) : (
      <CircularProgress aria-label="Loading the import" />
    )
  }

  let body
  switch (draft.step) {
    case 'upload':
      body = <ImportUploadStep wizard={wizard} />
      break
    case 'mapping':
      body = (
        <ImportMappingStep wizard={wizard} zone={props.importMappingZone} />
      )
      break
    case 'values':
      body = <ImportValuesStep wizard={wizard} />
      break
    case 'matching':
      body = <ImportMatchingStep wizard={wizard} />
      break
    case 'conflicts':
      body = <ImportConflictsStep wizard={wizard} />
      break
    case 'dryRun':
      body = <ImportDryRunStep wizard={wizard} />
      break
    case 'apply':
      body = <ImportApplyStep wizard={wizard} />
      break
    case 'results':
      body = (
        <ImportResultsStep
          wizard={wizard}
          onDone={props.onDone}
          {...(props.download ? { download: props.download } : {})}
        />
      )
      break
    default:
      body = <ExtraStep wizard={wizard} />
  }

  return (
    <Stack spacing={3}>
      <Box component="nav" aria-label="Import steps" sx={{ overflowX: 'auto' }}>
        <Stepper nonLinear activeStep={stepIndex} alternativeLabel>
          {steps.map((step, index) => {
            const reachable =
              index < stepIndex && !started && Boolean(draft.jobId)
            return (
              <Step key={step.id} completed={index < stepIndex}>
                {reachable ? (
                  <StepButton onClick={() => void wizard.goTo(step.id)}>
                    {step.label}
                  </StepButton>
                ) : (
                  <StepLabel
                    aria-current={index === stepIndex ? 'step' : undefined}
                  >
                    {step.label}
                  </StepLabel>
                )}
              </Step>
            )
          })}
        </Stepper>
      </Box>
      {wizard.error ? (
        <Alert severity="error" onClose={wizard.clearError}>
          {wizard.error}
        </Alert>
      ) : null}
      {wizard.busy && !started ? (
        <CircularProgress size={24} aria-label="Working" />
      ) : null}
      <Box>{body}</Box>
    </Stack>
  )
}

export default TransferImportWizard
