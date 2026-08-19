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
  actionRunResult,
  actionRunSummary,
  actionTriggerLabel,
} from '@aglyn/aglyn/app-utils/activity-presenter'
import { CardDisplay } from '@aglyn/shared-ui-jsx'
import {
  Chip,
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Tooltip,
  Typography,
} from '@mui/material'
import { collection, limit, query } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'

export interface HostRunHistoryCardProps {
  hostId: string
  /** Show only runs of this action/workflow. */
  targetId?: string
  max?: number
  header?: string
}

const RESULT_COLOR = {
  succeeded: 'success',
  failed: 'error',
  skipped: 'warning',
} as const

const RESULT_LABEL = {
  succeeded: 'Succeeded',
  failed: 'Failed',
  skipped: 'Skipped',
} as const

/**
 * The run-history table `/product/workflows` advertises (AGL-2171):
 * `Time | Trigger | Result | What happened`.
 *
 * A separate component from `HostActivityCard` on purpose. That card is
 * the site's general feed — publishes, media saves, member changes — and
 * a run is a different record with different columns. Pointing the Runs
 * dialog at the general feed is what produced a list of
 * `Action ran on formSubmission — My automation` where the mockup shows
 * four columns.
 *
 * `actionRunResult` returning `undefined` is the filter: the activity
 * collection holds far more than runs, and a publish has no verdict. An
 * entry that is not a run simply does not appear, rather than appearing
 * under a `Succeeded` that means nothing for it.
 */
export function HostRunHistoryCard(props: HostRunHistoryCardProps) {
  const { hostId, targetId, max = 25, header = 'Run history' } = props
  const firestore = useFirestore()
  const { data: entries } = useFirestoreCollection<any>(
    () => query(collection(firestore, 'hosts', hostId, 'activity'), limit(200)),
    [firestore, hostId],
    { idField: '$id' },
  )

  const runs = useMemo(
    () =>
      [...(entries ?? [])]
        .filter((entry) => !targetId || entry.target?.id === targetId)
        .map((entry) => ({ entry, result: actionRunResult(entry) }))
        .filter(
          (row): row is { entry: any; result: keyof typeof RESULT_LABEL } =>
            Boolean(row.result),
        )
        .sort(
          (a, b) =>
            (b.entry.createdAt?.seconds ?? 0) -
            (a.entry.createdAt?.seconds ?? 0),
        )
        .slice(0, max),
    [entries, targetId, max],
  )

  return (
    <CardDisplay
      header={header}
      contentGutterX
      contentGutterY
      contentBordered="all"
    >
      {runs.length === 0 ? (
        <Typography variant="body2" color="text.secondary">
          {'No runs yet — every run of this automation is logged here, ' +
            'including the ones a condition skipped.'}
        </Typography>
      ) : (
        <Table size="small" aria-label="Run history">
          <TableHead>
            <TableRow>
              <TableCell>{'Time'}</TableCell>
              <TableCell>{'Trigger'}</TableCell>
              <TableCell>{'Result'}</TableCell>
              <TableCell>{'What happened'}</TableCell>
            </TableRow>
          </TableHead>
          <TableBody>
            {runs.map(({ entry, result }) => {
              const at = entry.createdAt?.toDate?.()
              return (
                <TableRow key={entry.$id}>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    <Tooltip title={at ? at.toLocaleString() : ''}>
                      <span>{at ? at.toLocaleTimeString() : '--'}</span>
                    </Tooltip>
                  </TableCell>
                  <TableCell sx={{ whiteSpace: 'nowrap' }}>
                    {/* `formSubmission` → `Form submitted`. */}
                    {actionTriggerLabel(entry.trigger)}
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      color={RESULT_COLOR[result]}
                      label={RESULT_LABEL[result]}
                    />
                  </TableCell>
                  <TableCell>
                    <Typography variant="body2">
                      {actionRunSummary(entry)}
                    </Typography>
                    {entry.durationMs != null ? (
                      <Typography variant="caption" color="text.secondary">
                        {`${entry.durationMs}ms`}
                      </Typography>
                    ) : null}
                  </TableCell>
                </TableRow>
              )
            })}
          </TableBody>
        </Table>
      )}
    </CardDisplay>
  )
}
HostRunHistoryCard.displayName = 'HostRunHistoryCard'

export default HostRunHistoryCard
