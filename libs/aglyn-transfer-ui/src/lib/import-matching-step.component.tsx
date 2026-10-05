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
 * Step 4, Matching: which existing record each row is about.
 *
 * The person picks the match keys and their order — the first key that
 * finds a record decides — and sees, for the whole file, how many rows are
 * new, matched, ambiguous (several records) or repeated in the file, with
 * the rows of each listed.
 */

import type { MatchKeySpec, RowMatchOutcome } from '@aglyn/aglyn/data-transfer'
import ArrowDownwardIcon from '@mui/icons-material/ArrowDownward'
import ArrowUpwardIcon from '@mui/icons-material/ArrowUpward'
import { ScrollTable } from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Alert,
  Box,
  Card,
  CardContent,
  CardHeader,
  Checkbox,
  Chip,
  IconButton,
  List,
  ListItem,
  ListItemIcon,
  ListItemText,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import { useState } from 'react'

import { TransferChoiceSelect } from './transfer-choice-select.component'
import type { TransferWizardDraft } from './transfer-wizard-state'
import { TransferWizardNav } from './transfer-wizard-nav.component'
import { MATCH_KIND_WORDS, NORMALIZER_WORDS, rowNumber } from './transfer-words'
import type { TransferImportWizardController } from './use-transfer-import-wizard'

const KINDS: readonly RowMatchOutcome['kind'][] = [
  'new',
  'matched',
  'ambiguous',
  'duplicateInFile',
]

const LIST_LIMIT = 50

export function ImportMatchingStep({
  wizard,
}: {
  wizard: TransferImportWizardController
}) {
  const { info, analysis, draft, fieldLabel } = wizard
  const [kind, setKind] = useState<RowMatchOutcome['kind']>('matched')
  const offered = info?.matchKeys ?? []
  const defaults = info?.defaultMatchKeys ?? offered.map((key) => key.fieldId)
  const chosen = draft.matchKeys ?? defaults
  const mapped = new Set(Object.values(draft.mapping))
  const ordered: MatchKeySpec[] = [
    ...chosen
      .map((id) => offered.find((key) => key.fieldId === id))
      .filter((key): key is MatchKeySpec => Boolean(key)),
    ...offered.filter((key) => !chosen.includes(key.fieldId)),
  ]
  const summary = analysis?.matches?.summary
  const labels = analysis?.recordLabels ?? {}
  const rows = (analysis?.matches?.rows ?? []).filter(
    (row) => row.outcome.kind === kind,
  )

  const setKeys = (keys: string[]) => {
    const next: TransferWizardDraft = { ...draft, matchKeys: keys }
    wizard.setDraft(() => next)
    void wizard.reanalyze(next)
  }
  const move = (fieldId: string, by: number) => {
    const at = chosen.indexOf(fieldId)
    const to = at + by
    if (at < 0 || to < 0 || to >= chosen.length) return
    const keys = [...chosen]
    keys.splice(at, 1)
    keys.splice(to, 0, fieldId)
    setKeys(keys)
  }

  const detail = (outcome: RowMatchOutcome): string => {
    switch (outcome.kind) {
      case 'new':
        return 'No record has these keys'
      case 'matched':
        return `${labels[outcome.recordId] ?? outcome.recordId}, by ${fieldLabel(outcome.via.fieldId)} “${outcome.via.value}”${outcome.alsoMatched?.length ? ` — another key points at ${outcome.alsoMatched.map((id) => labels[id] ?? id).join(', ')}` : ''}`
      case 'ambiguous':
        return `${outcome.recordIds.map((id) => labels[id] ?? id).join(', ')} all have ${fieldLabel(outcome.via.fieldId)} “${outcome.via.value}”`
      case 'duplicateInFile':
        return `Same ${fieldLabel(outcome.via.fieldId)} as row ${rowNumber(outcome.firstRow)}`
    }
  }

  return (
    <Stack spacing={2}>
      <Card variant="outlined">
        <CardHeader
          title="Match rows to existing records by"
          subheader="In order: the first key that finds a record decides."
        />
        <CardContent>
          {offered.length === 0 ? (
            <Typography variant="body2" color="text.secondary">
              This import has no match keys; every row creates a new record.
            </Typography>
          ) : null}
          <List dense aria-label="Match keys">
            {ordered.map((key) => {
              const on = chosen.includes(key.fieldId)
              const parts = [key.fieldId, ...(key.with ?? []).map((part) => part.fieldId)]
              // A compound key is in the file only when every part is.
              const inFile = parts.every((id) => mapped.has(id))
              const position = chosen.indexOf(key.fieldId)
              const name = parts.map(fieldLabel).join(' + ')
              return (
                <ListItem
                  key={key.fieldId}
                  secondaryAction={
                    on ? (
                      <Stack direction="row">
                        <IconButton
                          size="small"
                          aria-label={`Try ${name} earlier`}
                          disabled={position === 0}
                          onClick={() => move(key.fieldId, -1)}
                        >
                          <ArrowUpwardIcon fontSize="small" />
                        </IconButton>
                        <IconButton
                          size="small"
                          aria-label={`Try ${name} later`}
                          disabled={position === chosen.length - 1}
                          onClick={() => move(key.fieldId, 1)}
                        >
                          <ArrowDownwardIcon fontSize="small" />
                        </IconButton>
                      </Stack>
                    ) : undefined
                  }
                >
                  <ListItemIcon>
                    <Checkbox
                      edge="start"
                      checked={on}
                      onChange={(event) =>
                        setKeys(
                          event.target.checked
                            ? [...chosen, key.fieldId]
                            : chosen.filter((id) => id !== key.fieldId),
                        )
                      }
                      slotProps={{
                        input: { 'aria-label': `Match by ${name}` },
                      }}
                    />
                  </ListItemIcon>
                  <ListItemText
                    primary={on ? `${position + 1}. ${name}` : name}
                    secondary={`Compared ${NORMALIZER_WORDS[key.normalizer]}${inFile ? '' : ' · no column fills it, so it finds nothing'}`}
                  />
                </ListItem>
              )
            })}
          </List>
          {offered.length > 0 && chosen.length === 0 ? (
            <Alert severity="warning">
              With no match key, every row creates a new record — even one
              already here.
            </Alert>
          ) : null}
        </CardContent>
      </Card>
      <Card variant="outlined">
        <CardHeader title="What the rows match" />
        <CardContent>
          <Stack
            direction="row"
            spacing={1}
            sx={{ flexWrap: 'wrap', mb: 2 }}
            useFlexGap
          >
            {KINDS.map((entry) => (
              <Chip
                key={entry}
                label={`${MATCH_KIND_WORDS[entry]}: ${(summary?.[entry] ?? 0).toLocaleString()}`}
                color={
                  entry === 'ambiguous' || entry === 'duplicateInFile'
                    ? (summary?.[entry] ?? 0) > 0
                      ? 'warning'
                      : 'default'
                    : 'default'
                }
                variant={kind === entry ? 'filled' : 'outlined'}
                onClick={() => setKind(entry)}
                aria-pressed={kind === entry}
              />
            ))}
          </Stack>
          <Box sx={{ mb: 1 }}>
            <TransferChoiceSelect
              label="Show rows"
              value={kind}
              options={KINDS.map((entry) => ({
                value: entry,
                label: MATCH_KIND_WORDS[entry],
              }))}
              onChange={(next) => setKind(next as RowMatchOutcome['kind'])}
            />
          </Box>
          <ScrollTable
            size="small"
            aria-label={`${MATCH_KIND_WORDS[kind]} rows`}
          >
            <TableHead>
              <TableRow>
                <TableCell>Row</TableCell>
                <TableCell>In the file</TableCell>
                <TableCell>Match</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {rows.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={3}>
                    <Typography variant="body2" color="text.secondary">
                      No rows.
                    </Typography>
                  </TableCell>
                </TableRow>
              ) : null}
              {rows.slice(0, LIST_LIMIT).map((row) => (
                <TableRow key={row.row}>
                  <TableCell>{rowNumber(row.row)}</TableCell>
                  <TableCell>{row.label ?? '—'}</TableCell>
                  <TableCell>{detail(row.outcome)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
          {rows.length > LIST_LIMIT ? (
            <Typography variant="caption" color="text.secondary">
              The first {LIST_LIMIT} of {rows.length.toLocaleString()} rows.
            </Typography>
          ) : null}
        </CardContent>
      </Card>
      <TransferWizardNav
        busy={wizard.busy}
        onBack={wizard.back}
        onNext={() => void wizard.next()}
      />
    </Stack>
  )
}

export default ImportMatchingStep
