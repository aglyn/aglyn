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
  ACTION_MAX_CONDITIONS,
  type HostActionTrigger,
  type HostActionTriggerCondition,
  normalizeTriggerConditions,
  type TriggerCombinator,
  type TriggerConditionOp,
} from '@aglyn/aglyn'
import {
  Button,
  IconButton,
  MenuItem,
  Stack,
  TextField,
  Typography,
} from '@mui/material'
import { placeholderState } from './automation-step-fields.component'

/**
 * ONE TRIGGER-CONDITION EDITOR FOR EVERY AUTOMATION THAT HAS A TRIGGER.
 *
 * The structured payload conditions (AGL-557), chainable with AND/OR
 * (AGL-565): the no-code sibling of the filter expression — "only when
 * `subscribe` is not empty". A site action and an org automation (AGL-3302)
 * take the same clauses and are judged by the same evaluator, so they are
 * edited by the same rows.
 */

/** One editable condition row; a lone row with an empty op means "always run". */
export interface ConditionRowDraft {
  op: '' | TriggerConditionOp
  field: string
  value: string
}

export const EMPTY_CONDITION_ROW: ConditionRowDraft = {
  op: '',
  field: '',
  value: '',
}

/**
 * A stored trigger's clauses as editor rows. A legacy single-condition trigger
 * normalizes to one row, and a trigger with none opens on the lone "always"
 * row.
 */
export function conditionRowsFromTrigger(
  trigger:
    | Pick<HostActionTrigger, 'condition' | 'conditions'>
    | null
    | undefined,
): ConditionRowDraft[] {
  const rows = normalizeTriggerConditions(trigger).map(
    (condition): ConditionRowDraft => ({
      op: condition.op ?? '',
      field: condition.field ?? '',
      value: condition.value ?? '',
    }),
  )
  return rows.length ? rows : [EMPTY_CONDITION_ROW]
}

/**
 * The rows as the stored clause list, or nothing when every row says
 * "always". Blank fields are kept, so the validator names what is missing.
 */
export function conditionsFromRows(
  rows: readonly ConditionRowDraft[],
  combinator: TriggerCombinator,
): { conditions?: HostActionTriggerCondition[]; combinator?: TriggerCombinator } {
  if (!rows.some((row) => row.op)) return {}
  return {
    conditions: rows
      .filter((row) => row.op)
      .map((row) => ({
        field: row.field.trim(),
        op: row.op as TriggerConditionOp,
        ...(row.op !== 'notEmpty' ? { value: row.value.trim() } : {}),
      })),
    combinator,
  }
}

export interface TriggerConditionRowsProps {
  rows: readonly ConditionRowDraft[]
  combinator: TriggerCombinator
  /** Replaces the rows, from the rows as they stand. */
  onRowsChange: (
    update: (previous: ConditionRowDraft[]) => ConditionRowDraft[],
  ) => void
  onCombinatorChange: (combinator: TriggerCombinator) => void
}

/** The condition rows, "Add condition", and the AND/OR choice once there are two. */
export function TriggerConditionRows({
  rows,
  combinator,
  onRowsChange,
  onCombinatorChange,
}: TriggerConditionRowsProps) {
  return (
    <>
      {rows.map((row, index) => (
        <Stack
          key={index}
          direction="row"
          spacing={1}
          sx={{ alignItems: 'center' }}
        >
          {index > 0 ? (
            <Typography variant="caption" color="text.secondary">
              {combinator === 'or' ? 'or' : 'and'}
            </Typography>
          ) : null}
          <TextField
            select
            label={index === 0 ? 'Only run when' : 'Condition'}
            value={row.op}
            onChange={(event) =>
              onRowsChange((previous) =>
                previous.map((previousRow, index2) =>
                  index2 === index
                    ? {
                        ...previousRow,
                        op: event.target.value as ConditionRowDraft['op'],
                      }
                    : previousRow,
                ),
              )
            }
            size="small"
            sx={{ minWidth: 180 }}
          >
            {/* "Always" only exists while this is the sole row —
                multi-row chains clear by removing rows instead. */}
            {rows.length === 1 ? (
              <MenuItem value="">{'Always (no condition)'}</MenuItem>
            ) : null}
            <MenuItem value="notEmpty">{'A field is not empty'}</MenuItem>
            <MenuItem value="equals">{'A field equals…'}</MenuItem>
            <MenuItem value="contains">{'A field contains…'}</MenuItem>
          </TextField>
          {row.op ? (
            <TextField
              label="Field"
              placeholder="subscribe"
              value={row.field}
              onChange={(event) =>
                onRowsChange((previous) =>
                  previous.map((previousRow, index2) =>
                    index2 === index
                      ? { ...previousRow, field: event.target.value }
                      : previousRow,
                  ),
                )
              }
              size="small"
              sx={{ flex: 1 }}
            />
          ) : null}
          {row.op === 'equals' || row.op === 'contains' ? (
            <TextField
              label="Value"
              placeholder="Yes"
              {...placeholderState(
                row.value,
                'Replace the placeholder with the value to match',
              )}
              value={row.value}
              onChange={(event) =>
                onRowsChange((previous) =>
                  previous.map((previousRow, index2) =>
                    index2 === index
                      ? { ...previousRow, value: event.target.value }
                      : previousRow,
                  ),
                )
              }
              size="small"
              sx={{ flex: 1 }}
            />
          ) : null}
          {rows.length > 1 ? (
            <IconButton
              size="small"
              aria-label="remove condition"
              onClick={() =>
                onRowsChange((previous) =>
                  previous.length > 1
                    ? previous.filter((_, index2) => index2 !== index)
                    : [EMPTY_CONDITION_ROW],
                )
              }
            >
              {'×'}
            </IconButton>
          ) : null}
        </Stack>
      ))}
      {rows.every((row) => row.op) ? (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
          <Button
            size="small"
            disabled={rows.length >= ACTION_MAX_CONDITIONS}
            onClick={() =>
              onRowsChange((previous) => [
                ...previous,
                // New rows start on the simplest operator so the field input
                // is immediately visible.
                { op: 'notEmpty', field: '', value: '' },
              ])
            }
          >
            {'Add condition'}
          </Button>
          {rows.length >= 2 ? (
            // AND/OR combinator (AGL-565); applies to every row.
            <TextField
              select
              label="Match"
              value={combinator}
              onChange={(event) =>
                onCombinatorChange(event.target.value as TriggerCombinator)
              }
              size="small"
              sx={{ minWidth: 220 }}
            >
              <MenuItem value="and">{'All conditions match (AND)'}</MenuItem>
              <MenuItem value="or">{'Any condition matches (OR)'}</MenuItem>
            </TextField>
          ) : null}
        </Stack>
      ) : null}
    </>
  )
}
TriggerConditionRows.displayName = 'TriggerConditionRows'
