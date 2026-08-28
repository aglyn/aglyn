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
import { CardDisplay, type HelpTipContent } from '@aglyn/shared-ui-jsx'
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
import { collection, limit, orderBy, query, where } from 'firebase/firestore'
import { useMemo } from 'react'
import {
  useFirestore,
  useFirestoreCollection,
} from '@aglyn/tenant-feature-instance'
import { pluginDocsHelp } from '@aglyn/aglyn'

export interface HostRunHistoryCardProps {
  hostId: string
  /** Show only runs of this action/workflow. */
  targetId?: string
  max?: number
  header?: string
  /** Overrides the default help affordance on the card header. */
  help?: HelpTipContent
}

/** Activity rows fetched before the run filter and the `max` slice. */
const WINDOW = 200

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
  const {
    hostId,
    targetId,
    max = 25,
    header = 'Run history',
    help = pluginDocsHelp('buildAWorkflow', {
      anchor: '#4-save-and-test',
      excerpt:
        'Every run of this automation, including the ones a trigger ' +
        'condition skipped — which is the answer to "why did it not fire?".',
    }),
  } = props
  const firestore = useFirestore()
  /*
   * The window is NARROWED BY THE SERVER, not by the client (AGL-2292).
   *
   * A bare `limit(200)` with no ordering is not "the most recent 200 runs" —
   * Firestore answers an unordered limit in `__name__` order, so it is an
   * arbitrary slice of the host's whole activity feed. `activity` also holds
   * publishes, media saves and member changes, and only entries carrying a
   * run result survive the filter below, so a busy site could fill all 200
   * places with rows this card discards and report "No runs yet" for a
   * workflow that had run all day.
   *
   * `target.id` equality is what makes the read proportional to the card:
   * it asks for this workflow's rows rather than the site's. It carries no
   * `orderBy` deliberately — an equality plus an ordering on a second field
   * needs a composite index, and the client sort below already puts the
   * newest first. The untargeted case has no equality to pair, so it orders
   * server-side instead.
   */
  const { data: entries } = useFirestoreCollection<any>(
    () => {
      if (!hostId) return null
      const base = collection(firestore, 'hosts', hostId, 'activity')
      return targetId
        ? query(base, where('target.id', '==', targetId), limit(WINDOW))
        : query(base, orderBy('createdAt', 'desc'), limit(WINDOW))
    },
    // `targetId` belongs here: it now shapes the query, so a card that
    // switched workflows without it would go on showing the first one's runs.
    [firestore, hostId, targetId],
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
      help={help}
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
