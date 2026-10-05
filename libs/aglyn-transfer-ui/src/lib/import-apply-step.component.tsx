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
 * Step 7, Apply: the job written chunk by chunk, driven from the browser.
 * Progress, a pause that stops after the chunk in flight, a resume that
 * carries on from the job's cursor, and every failed row listed as it
 * arrives.
 */

import {
  Alert,
  Box,
  Button,
  LinearProgress,
  List,
  ListItem,
  ListItemText,
  Stack,
  Typography,
} from '@mui/material'

import { REASON_WORDS, countOf, rowNumber } from './transfer-words'
import type { TransferImportWizardController } from './use-transfer-import-wizard'

export function ImportApplyStep({
  wizard,
}: {
  wizard: TransferImportWizardController
}) {
  const { apply } = wizard
  const percent = apply.rowCount
    ? Math.round((apply.rowsDone / apply.rowCount) * 100)
    : 0
  return (
    <Stack spacing={2}>
      <Box>
        <Typography
          variant="subtitle2"
          gutterBottom
          id="transfer-apply-progress"
        >
          {apply.done
            ? 'Done.'
            : apply.running
              ? `Importing… ${apply.rowsDone.toLocaleString()} of ${apply.rowCount.toLocaleString()} rows`
              : `Paused at ${apply.rowsDone.toLocaleString()} of ${apply.rowCount.toLocaleString()} rows`}
        </Typography>
        <LinearProgress
          variant="determinate"
          value={percent}
          aria-labelledby="transfer-apply-progress"
        />
      </Box>
      <Stack direction="row" spacing={1}>
        {apply.running ? (
          <Button onClick={wizard.pauseApply}>Pause</Button>
        ) : apply.done ? null : (
          <Button variant="contained" onClick={() => void wizard.startApply()}>
            Resume
          </Button>
        )}
      </Stack>
      {apply.failures.length ? (
        <Alert severity="error">
          {countOf(apply.failures.length, 'row')} could not be written.
          <List dense aria-label="Rows that failed">
            {apply.failures.map((failure) => (
              <ListItem key={failure.row} disableGutters>
                <ListItemText
                  primary={`Row ${rowNumber(failure.row)}`}
                  secondary={
                    failure.message ??
                    (failure.reason && failure.reason in REASON_WORDS
                      ? REASON_WORDS[
                          failure.reason as keyof typeof REASON_WORDS
                        ]
                      : failure.reason) ??
                    'Failed'
                  }
                />
              </ListItem>
            ))}
          </List>
        </Alert>
      ) : null}
    </Stack>
  )
}

export default ImportApplyStep
