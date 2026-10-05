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
 * Step 3, Values: what each value becomes.
 *
 *  - Picklists: every value the organization's list does not hold, with a
 *    choice made once for all its rows — map it to a list value, add it to
 *    the list (with a group, and a meaning where the list needs one), leave
 *    the field blank, or refuse those rows. Each starts at a proposal that
 *    is on screen and can be changed.
 *  - Reading: per field, what was done to its cells (a date put in order, a
 *    number's separators read, a name split) with counts and examples, the
 *    cells that could not be read, and — for dates that read either way — the
 *    order, which the person must choose.
 *  - Lookups: each value that names no record: create it, map it to a
 *    similar record, leave it blank, or refuse those rows.
 */

import type {
  PicklistUnmatched,
  PicklistValueChoice,
} from '@aglyn/aglyn/data-transfer'
import type {
  PicklistSpec,
  PicklistValueSet,
} from '@aglyn/aglyn/app-utils/picklists'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Alert,
  Card,
  CardContent,
  CardHeader,
  Chip,
  FormControl,
  FormControlLabel,
  FormLabel,
  Radio,
  RadioGroup,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  TextField,
  Typography,
} from '@mui/material'

import type {
  TransferDateOrder,
  TransferDerivationSummary,
  TransferLookupChoice,
  TransferLookupReview,
  TransferPicklistReview,
} from './transfer-client'
import { TransferChoiceSelect } from './transfer-choice-select.component'
import { valuesStepProblems } from './transfer-wizard-state'
import type { TransferWizardDraft } from './transfer-wizard-state'
import { TransferWizardNav } from './transfer-wizard-nav.component'
import { countOf, rowNumber } from './transfer-words'
import type { TransferImportWizardController } from './use-transfer-import-wizard'

type PicklistAction = PicklistValueChoice['action']

const PICKLIST_ACTIONS: readonly {
  value: PicklistAction
  label: string
  description: string
}[] = [
  {
    value: 'mapTo',
    label: 'Map to a list value',
    description: 'Store a value the list already holds.',
  },
  {
    value: 'addValue',
    label: 'Add it to the list',
    description: 'Every record can use it from now on.',
  },
  {
    value: 'leaveBlank',
    label: 'Leave the field blank',
    description: 'The rest of each row is imported.',
  },
  {
    value: 'refuseRow',
    label: 'Refuse these rows',
    description: 'Rows with this value are not imported.',
  },
]

function choiceFor(
  action: PicklistAction,
  value: PicklistUnmatched,
  set: PicklistValueSet,
): PicklistValueChoice {
  if (action === 'mapTo')
    return {
      action,
      valueId:
        value.suggestions[0]?.valueId ??
        set.values.find((entry) => entry.active)?.id ??
        '',
    }
  if (action === 'addValue') return { action, label: value.value }
  return { action }
}

function PicklistValueRow(props: {
  fieldLabel: string
  spec: PicklistSpec
  set: PicklistValueSet
  value: PicklistUnmatched
  choice: PicklistValueChoice | undefined
  onChange(choice: PicklistValueChoice): void
}) {
  const { spec, set, value, choice, onChange, fieldLabel } = props
  const suggested = new Set(value.suggestions.map((entry) => entry.valueId))
  return (
    <TableRow>
      <TableCell>
        <Typography variant="body2">“{value.value}”</Typography>
        <Typography variant="caption" color="text.secondary">
          {countOf(value.count, 'row')}
        </Typography>
      </TableCell>
      <TableCell sx={{ minWidth: 220 }}>
        <TransferChoiceSelect
          hideLabel
          fullWidth
          label={`${fieldLabel}: what to do with “${value.value}”`}
          value={choice?.action ?? ''}
          placeholder="Choose…"
          options={PICKLIST_ACTIONS}
          onChange={(action) => onChange(choiceFor(action, value, set))}
        />
      </TableCell>
      <TableCell sx={{ minWidth: 240 }}>
        {choice?.action === 'mapTo' ? (
          <TransferChoiceSelect
            hideLabel
            fullWidth
            label={`${fieldLabel}: list value for “${value.value}”`}
            value={choice.valueId}
            options={[
              ...set.values
                .filter((entry) => suggested.has(entry.id))
                .map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  description: 'Similar',
                })),
              ...set.values
                .filter((entry) => !suggested.has(entry.id))
                .map((entry) => ({
                  value: entry.id,
                  label: entry.label,
                  description: entry.active ? undefined : 'Inactive',
                })),
            ]}
            onChange={(valueId) => onChange({ action: 'mapTo', valueId })}
          />
        ) : null}
        {choice?.action === 'addValue' ? (
          <Stack spacing={1}>
            <TextField
              size="small"
              label="Label in the list"
              value={choice.label ?? value.value}
              onChange={(event) =>
                onChange({ ...choice, label: event.target.value })
              }
            />
            {spec.groups?.length ? (
              <TransferChoiceSelect
                label="Group"
                value={choice.group ?? ''}
                placeholder="No group"
                options={spec.groups.map((group) => ({
                  value: group.id,
                  label: group.label,
                }))}
                onChange={(group) => onChange({ ...choice, group })}
              />
            ) : null}
            {spec.meanings?.length ? (
              <TransferChoiceSelect
                label="Meaning"
                value={choice.meaning ?? ''}
                placeholder="Choose a meaning"
                options={spec.meanings.map((meaning) => ({
                  value: meaning,
                  label: meaning,
                }))}
                onChange={(meaning) => onChange({ ...choice, meaning })}
                helperText="What this value means to the platform; required on this list."
              />
            ) : null}
          </Stack>
        ) : null}
      </TableCell>
    </TableRow>
  )
}

function PicklistCard({
  review,
  wizard,
}: {
  review: TransferPicklistReview
  wizard: TransferImportWizardController
}) {
  const label = wizard.fieldLabel(review.fieldId)
  const choices = wizard.draft.picklistChoices[review.fieldId] ?? {}
  const inactive = review.result.matched.filter((entry) => entry.inactive)
  const setChoice = (key: string, choice: PicklistValueChoice) =>
    wizard.setDraft((d) => ({
      ...d,
      picklistChoices: {
        ...d.picklistChoices,
        [review.fieldId]: {
          ...(d.picklistChoices[review.fieldId] ?? {}),
          [key]: choice,
        },
      },
    }))
  return (
    <Card variant="outlined">
      <CardHeader
        title={label}
        subheader={`${countOf(review.result.matched.length, 'value')} the list holds · ${countOf(review.result.unmatched.length, 'value')} it does not`}
      />
      <CardContent>
        {inactive.length ? (
          <Alert severity="info" sx={{ mb: 2 }}>
            {inactive.map((entry) => `“${entry.label}”`).join(', ')}{' '}
            {inactive.length === 1 ? 'is' : 'are'} in the list but inactive; the
            rows keep {inactive.length === 1 ? 'it' : 'them'}.
          </Alert>
        ) : null}
        {review.result.unmatched.length ? (
          <ScrollTable
            size="small"
            aria-label={`${label} values the list does not hold`}
          >
            <TableHead>
              <TableRow>
                <TableCell>Value in the file</TableCell>
                <TableCell>What to do</TableCell>
                <TableCell>Details</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {review.result.unmatched.map((value) => (
                <PicklistValueRow
                  key={value.key}
                  fieldLabel={label}
                  spec={review.spec}
                  set={review.set}
                  value={value}
                  choice={choices[value.key]}
                  onChange={(choice) => setChoice(value.key, choice)}
                />
              ))}
            </TableBody>
          </ScrollTable>
        ) : (
          <Typography variant="body2" color="text.secondary">
            Every value is in the list.
          </Typography>
        )}
      </CardContent>
    </Card>
  )
}

function DateOrderChoice({
  summary,
  wizard,
}: {
  summary: TransferDerivationSummary
  wizard: TransferImportWizardController
}) {
  const label = wizard.fieldLabel(summary.fieldId)
  const id = `transfer-date-order-${summary.fieldId}`
  const choose = (order: TransferDateOrder) => {
    const next: TransferWizardDraft = {
      ...wizard.draft,
      dateOrders: { ...wizard.draft.dateOrders, [summary.fieldId]: order },
    }
    wizard.setDraft(() => next)
    void wizard.reanalyze(next)
  }
  return (
    <FormControl>
      <FormLabel id={id}>
        {countOf(summary.ambiguousDates, 'date')} in {label} could be read
        either way. Which comes first?
      </FormLabel>
      <RadioGroup
        row
        aria-labelledby={id}
        value={wizard.draft.dateOrders[summary.fieldId] ?? ''}
        onChange={(event) => choose(event.target.value as TransferDateOrder)}
      >
        <FormControlLabel
          value="mdy"
          control={<Radio />}
          label="Month first (03/05 is March 5)"
        />
        <FormControlLabel
          value="dmy"
          control={<Radio />}
          label="Day first (03/05 is 3 May)"
        />
      </RadioGroup>
    </FormControl>
  )
}

function DerivationCard({
  summary,
  wizard,
}: {
  summary: TransferDerivationSummary
  wizard: TransferImportWizardController
}) {
  const label = wizard.fieldLabel(summary.fieldId)
  return (
    <Card variant="outlined">
      <CardHeader
        title={label}
        subheader={`${countOf(summary.filled, 'cell')} filled · ${summary.unchanged.toLocaleString()} read as typed`}
      />
      <CardContent>
        <Stack spacing={2}>
          {summary.ambiguousDates > 0 ? (
            <DateOrderChoice summary={summary} wizard={wizard} />
          ) : null}
          {summary.derivations.length || summary.problems.length ? (
            <ScrollTable size="small" aria-label={`How ${label} was read`}>
              <TableHead>
                <TableRow>
                  <TableCell>What was done</TableCell>
                  <TableCell>Cells</TableCell>
                  <TableCell>Examples</TableCell>
                </TableRow>
              </TableHead>
              <TableBody>
                {summary.derivations.map((entry) => (
                  <TableRow key={entry.kind}>
                    <TableCell>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <Typography variant="body2">{entry.note}</Typography>
                        {entry.flagged ? (
                          <Chip
                            size="small"
                            color="warning"
                            variant="outlined"
                            label="A guess"
                          />
                        ) : null}
                      </Stack>
                    </TableCell>
                    <TableCell>{entry.count.toLocaleString()}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {entry.samples
                          .map(
                            (sample) =>
                              `Row ${rowNumber(sample.row)}: “${sample.from}” → “${sample.to}”`,
                          )
                          .join(' · ')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
                {summary.problems.map((entry) => (
                  <TableRow key={entry.code}>
                    <TableCell>
                      <Stack
                        direction="row"
                        spacing={1}
                        sx={{ alignItems: 'center' }}
                      >
                        <Typography variant="body2">{entry.message}</Typography>
                        <Chip
                          size="small"
                          color="error"
                          variant="outlined"
                          label="Dropped"
                        />
                      </Stack>
                    </TableCell>
                    <TableCell>{entry.count.toLocaleString()}</TableCell>
                    <TableCell>
                      <Typography variant="body2" color="text.secondary">
                        {entry.samples
                          .map(
                            (sample) =>
                              `Row ${rowNumber(sample.row)}: “${sample.raw}”`,
                          )
                          .join(' · ')}
                      </Typography>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </ScrollTable>
          ) : (
            <Typography variant="body2" color="text.secondary">
              Every cell was read as typed.
            </Typography>
          )}
        </Stack>
      </CardContent>
    </Card>
  )
}

function LookupCard({
  review,
  wizard,
}: {
  review: TransferLookupReview
  wizard: TransferImportWizardController
}) {
  const field = wizard.fields.find((entry) => entry.id === review.fieldId)
  const label = wizard.fieldLabel(review.fieldId)
  const choices = wizard.draft.lookupChoices[review.fieldId] ?? {}
  const setChoice = (key: string, choice: TransferLookupChoice) =>
    wizard.setDraft((d) => ({
      ...d,
      lookupChoices: {
        ...d.lookupChoices,
        [review.fieldId]: {
          ...(d.lookupChoices[review.fieldId] ?? {}),
          [key]: choice,
        },
      },
    }))
  return (
    <Card variant="outlined">
      <CardHeader
        title={label}
        subheader={`${countOf(review.unresolved.length, 'value')} that name no record`}
      />
      <CardContent>
        <ScrollTable
          size="small"
          aria-label={`${label} values that name no record`}
        >
          <TableHead>
            <TableRow>
              <TableCell>Value in the file</TableCell>
              <TableCell>What to do</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {review.unresolved.map((value) => {
              const choice = choices[value.key]
              const current = choice
                ? choice.action === 'mapTo'
                  ? `mapTo:${choice.recordId}`
                  : choice.action
                : ''
              return (
                <TableRow key={value.key}>
                  <TableCell>
                    <Typography variant="body2">“{value.value}”</Typography>
                    <Typography variant="caption" color="text.secondary">
                      {countOf(value.count, 'row')}
                    </Typography>
                  </TableCell>
                  <TableCell sx={{ minWidth: 260 }}>
                    <TransferChoiceSelect
                      hideLabel
                      fullWidth
                      label={`${label}: what to do with “${value.value}”`}
                      value={current}
                      placeholder="Choose…"
                      options={[
                        {
                          value: 'create',
                          label: `Create “${value.value}”`,
                          disabled: !field?.lookup?.creatable,
                          ...(field?.lookup?.creatable
                            ? {}
                            : {
                                description: 'This import cannot create these.',
                              }),
                        },
                        ...value.suggestions.map((suggestion) => ({
                          value: `mapTo:${suggestion.recordId}`,
                          label: `Use “${suggestion.label}”`,
                          description: 'A similar existing record',
                        })),
                        { value: 'leaveBlank', label: 'Leave the field blank' },
                        { value: 'refuseRow', label: 'Refuse these rows' },
                      ]}
                      onChange={(picked) =>
                        setChoice(
                          value.key,
                          picked.startsWith('mapTo:')
                            ? {
                                action: 'mapTo',
                                recordId: picked.slice('mapTo:'.length),
                              }
                            : ({ action: picked } as TransferLookupChoice),
                        )
                      }
                    />
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </ScrollTable>
      </CardContent>
    </Card>
  )
}

export function ImportValuesStep({
  wizard,
}: {
  wizard: TransferImportWizardController
}) {
  const analysis = wizard.analysis
  const blockers = analysis
    ? valuesStepProblems(analysis, wizard.draft, wizard.fieldLabel)
    : []
  const derivations = (analysis?.derivations ?? []).filter(
    (summary) =>
      summary.derivations.length ||
      summary.problems.length ||
      summary.ambiguousDates,
  )
  const lookups = (analysis?.lookups ?? []).filter(
    (review) => review.unresolved.length,
  )
  const nothing =
    !analysis?.picklists?.length && !derivations.length && !lookups.length
  return (
    <Stack spacing={2}>
      {nothing ? (
        <Alert severity="success">
          Every value reads as typed, and every list value and reference is
          known.
        </Alert>
      ) : null}
      {(analysis?.picklists ?? []).map((review) => (
        <PicklistCard key={review.fieldId} review={review} wizard={wizard} />
      ))}
      {derivations.map((summary) => (
        <DerivationCard
          key={summary.fieldId}
          summary={summary}
          wizard={wizard}
        />
      ))}
      {lookups.map((review) => (
        <LookupCard key={review.fieldId} review={review} wizard={wizard} />
      ))}
      <TransferWizardNav
        busy={wizard.busy}
        blockers={blockers}
        onBack={wizard.back}
        onNext={() => void wizard.next()}
      />
    </Stack>
  )
}

export default ImportValuesStep
