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
 * Step 6, the review (dry run): what the import WILL do, with nothing
 * written yet — counts of creates, updates, unchanged, skipped and failed
 * rows, a filterable before → after table, and every class of warning with
 * its count and examples. Import stays disabled until each warning class
 * that needs it has its own "I understand" (`missingAcknowledgements`).
 */

import {
  TRANSFER_ROW_VERDICTS,
  canApplyTransferPlan,
  missingAcknowledgements,
} from '@aglyn/aglyn/data-transfer'
import type { TransferWarningClass } from '@aglyn/aglyn/data-transfer'
import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  Chip,
  Stack,
} from '@mui/material'
import { useMemo } from 'react'

import {
  TransferAcknowledgementList,
  transferWarningItems,
} from './transfer-acknowledgement-list.component'
import {
  TransferDiffTable,
  VERDICT_COLORS,
  planRowsToDiffRows,
} from './transfer-diff-table.component'
import { TransferWizardNav } from './transfer-wizard-nav.component'
import { VERDICT_WORDS, countOf } from './transfer-words'
import type { TransferImportWizardController } from './use-transfer-import-wizard'

export function ImportDryRunStep({
  wizard,
}: {
  wizard: TransferImportWizardController
}) {
  const plan = wizard.planResponse?.plan
  const acknowledged = wizard.draft.acknowledged
  const diffRows = useMemo(
    () =>
      plan
        ? planRowsToDiffRows(
            plan.rows,
            wizard.fieldLabel,
            wizard.planResponse?.recordLabels,
          )
        : [],
    [plan, wizard.fieldLabel, wizard.planResponse?.recordLabels],
  )
  if (!plan)
    return <TransferWizardNav busy={wizard.busy} onBack={wizard.back} />

  const missing = missingAcknowledgements(plan, acknowledged)
  const writes = plan.summary.create + plan.summary.update
  const ready = canApplyTransferPlan(plan, acknowledged)
  const toggle = (id: string, on: boolean) =>
    wizard.setDraft((d) => ({
      ...d,
      acknowledged: on
        ? [
            ...d.acknowledged.filter((entry) => entry !== id),
            id as TransferWarningClass,
          ]
        : d.acknowledged.filter((entry) => entry !== id),
    }))

  const blockers = [
    ...(writes === 0
      ? ['Nothing in this file would be created or updated.']
      : []),
    ...(missing.length
      ? [
          `Read and acknowledge ${countOf(missing.length, 'more warning')} below.`,
        ]
      : []),
  ]

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardHeader
          title="What this import will do"
          subheader={`${countOf(plan.summary.total, 'row')} planned; nothing is written until you import.`}
        />
        <CardContent>
          <Stack
            direction="row"
            spacing={1}
            useFlexGap
            sx={{ flexWrap: 'wrap' }}
            aria-label="Summary"
          >
            {TRANSFER_ROW_VERDICTS.map((verdict) => (
              <Chip
                key={verdict}
                color={VERDICT_COLORS[verdict]}
                variant="outlined"
                label={`${VERDICT_WORDS[verdict]}: ${plan.summary[verdict].toLocaleString()}`}
              />
            ))}
          </Stack>
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardHeader title="Row by row" />
        <CardContent>
          <TransferDiffTable
            label="Planned changes"
            rows={diffRows}
            filters={TRANSFER_ROW_VERDICTS.map((verdict) => ({
              value: verdict,
              label: VERDICT_WORDS[verdict],
              count: plan.summary[verdict],
            }))}
          />
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardHeader
          title={`Warnings (${plan.warnings.length})`}
          subheader={
            plan.warnings.length
              ? 'Each needs your acknowledgement before the import can run.'
              : undefined
          }
        />
        <CardContent>
          {plan.warnings.length ? (
            <TransferAcknowledgementList
              items={transferWarningItems(plan.warnings, wizard.fieldLabel)}
              acknowledged={acknowledged}
              onChange={toggle}
            />
          ) : (
            <Alert severity="success">
              Nothing in this import needs a warning.
            </Alert>
          )}
        </CardContent>
      </Card>
      <TransferWizardNav
        busy={wizard.busy}
        blockers={blockers}
        onBack={wizard.back}
        nextDisabled={!ready}
        nextLabel={`Import ${countOf(writes, 'row')}`}
        onNext={() => void wizard.startApply()}
      />
    </Stack>
  )
}

export default ImportDryRunStep
