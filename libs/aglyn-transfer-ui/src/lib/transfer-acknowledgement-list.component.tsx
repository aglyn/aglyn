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
 * Every class of warning, counted, with examples, each needing its own
 * "I understand" before the action it guards is enabled.
 *
 * There is deliberately no "acknowledge all": a person ticks each class
 * they have read. Generic over what is warned about — the import wizard
 * feeds it a plan's warnings through {@link transferWarningItems}, a
 * package import its own.
 */

import type { TransferWarning } from '@aglyn/aglyn/data-transfer'
import {
  Alert,
  AlertTitle,
  Box,
  Checkbox,
  FormControlLabel,
  Stack,
  Typography,
} from '@mui/material'

import { WARNING_CLASS_WORDS, countOf, rowNumber } from './transfer-words'

export interface TransferAcknowledgementItem {
  id: string
  title: string
  description?: string
  count: number
  /** Distinct rows (or items) affected, when it differs from `count`. */
  rows?: number
  samples: string[]
  /** Must be acknowledged before the guarded action. */
  required: boolean
}

export interface TransferAcknowledgementListProps {
  items: readonly TransferAcknowledgementItem[]
  acknowledged: readonly string[]
  onChange(id: string, acknowledged: boolean): void
  disabled?: boolean
}

export function TransferAcknowledgementList({
  items,
  acknowledged,
  onChange,
  disabled,
}: TransferAcknowledgementListProps) {
  if (!items.length) return null
  return (
    <Stack spacing={1.5} role="list" aria-label="Warnings">
      {items.map((item) => {
        const done = acknowledged.includes(item.id)
        return (
          <Alert
            key={item.id}
            role="listitem"
            severity={item.required ? (done ? 'success' : 'warning') : 'info'}
            variant="outlined"
          >
            <AlertTitle>
              {item.title} — {countOf(item.count, 'time')}
              {item.rows !== undefined && item.rows !== item.count
                ? ` in ${countOf(item.rows, 'row')}`
                : ''}
            </AlertTitle>
            {item.description ? (
              <Typography variant="body2" gutterBottom>
                {item.description}
              </Typography>
            ) : null}
            {item.samples.length ? (
              <Box component="ul" sx={{ my: 0.5, pl: 2.5 }}>
                {item.samples.map((sample, index) => (
                  <Typography
                    component="li"
                    variant="body2"
                    color="text.secondary"
                    key={index}
                  >
                    {sample}
                  </Typography>
                ))}
              </Box>
            ) : null}
            {item.required ? (
              <FormControlLabel
                control={
                  <Checkbox
                    checked={done}
                    disabled={disabled}
                    onChange={(event) =>
                      onChange(item.id, event.target.checked)
                    }
                    slotProps={{
                      input: { 'aria-label': `I understand: ${item.title}` },
                    }}
                  />
                }
                label="I understand"
              />
            ) : null}
          </Alert>
        )
      })}
    </Stack>
  )
}

/** A plan's warnings as acknowledgement items, with each sample in words. */
export function transferWarningItems(
  warnings: readonly TransferWarning[],
  fieldLabel: (fieldId: string) => string,
): TransferAcknowledgementItem[] {
  return warnings.map((warning) => ({
    id: warning.class,
    title: WARNING_CLASS_WORDS[warning.class].title,
    description: WARNING_CLASS_WORDS[warning.class].description,
    count: warning.count,
    rows: warning.rows,
    required: warning.requiresAcknowledgement,
    samples: warning.samples.map((sample) =>
      [
        `Row ${rowNumber(sample.row)}`,
        sample.fieldId ? fieldLabel(sample.fieldId) : null,
        sample.value ? `"${sample.value}"` : null,
        sample.detail ?? null,
      ]
        .filter(Boolean)
        .join(' · '),
    ),
  }))
}

export default TransferAcknowledgementList
