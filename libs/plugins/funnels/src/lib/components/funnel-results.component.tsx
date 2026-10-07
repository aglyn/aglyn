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

import ScrollTable from '@aglyn/shared-ui-jsx/components/scroll-table.component'
import {
  Box,
  Button,
  LinearProgress,
  Stack,
  TableBody,
  TableCell,
  TableHead,
  TableRow,
  Typography,
} from '@mui/material'
import type { FunnelResult } from '../model/funnels.types'

/**
 * A funnel's result (AGL-3605): one bar per step with its visitors and share,
 * the drop-off before it and the median time from the step before, then the
 * same entered/completed split by where visits came from.
 */

export function formatShare(value: number | null): string {
  return value === null ? '—' : `${Math.round(value * 1000) / 10}%`
}

/** A duration as a person reads it: `45s`, `3m 05s`, `2h 10m`, `3d 4h`. */
export function formatDuration(ms: number | null): string {
  if (ms === null) return '—'
  const seconds = Math.round(ms / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  if (minutes < 60) return `${minutes}m ${String(seconds % 60).padStart(2, '0')}s`
  const hours = Math.floor(minutes / 60)
  if (hours < 48) return `${hours}h ${minutes % 60}m`
  return `${Math.floor(hours / 24)}d ${hours % 24}h`
}

export interface FunnelResultsProps {
  result: FunnelResult
  /**
   * "Act on this drop-off" on each step after the first, handed the step
   * people reached (1-based) — the one before the row. Absent hides it.
   */
  onActOnDropOff?: (reachedStep: number) => void
}

export function FunnelResults({ result, onActOnDropOff }: FunnelResultsProps) {
  const top = Math.max(1, result.entered)
  if (result.entered === 0) {
    return (
      <Typography variant="body2" color="text.secondary">
        {result.journeysRead
          ? 'No visit in this range reached the first step yet.'
          : 'No visits recorded in this range yet. Visits are recorded from when the first funnel was saved, for visitors whose consent allows analytics.'}
      </Typography>
    )
  }
  return (
    <Stack spacing={2}>
      <Typography variant="body2">
        {`${result.completed.toLocaleString()} of ${result.entered.toLocaleString()} visitors completed every step (${formatShare(result.overall)}).`}
      </Typography>
      <Stack spacing={1.5} component="ol" sx={{ m: 0, pl: 0, listStyle: 'none' }}>
        {result.steps.map((step) => (
          <Box component="li" key={step.index} aria-label={`Step ${step.index + 1}: ${step.label}`}>
            <Stack direction="row" spacing={2} sx={{ justifyContent: 'space-between' }}>
              <Typography variant="body2" sx={{ fontWeight: 500 }}>
                {`${step.index + 1}. ${step.label}`}
              </Typography>
              <Typography variant="body2">
                {`${step.visitors.toLocaleString()} · ${formatShare(step.fromStart)}`}
              </Typography>
            </Stack>
            <LinearProgress
              variant="determinate"
              value={(step.visitors / top) * 100}
              sx={{ height: 10, borderRadius: 1, my: 0.5 }}
              aria-hidden
            />
            {step.index > 0 ? (
              <Stack
                direction={{ xs: 'column', sm: 'row' }}
                spacing={1}
                sx={{ justifyContent: 'space-between', alignItems: { sm: 'center' } }}
              >
                <Typography variant="caption" color="text.secondary">
                  {`${formatShare(step.fromPrevious)} of the previous step · ${step.dropOff.toLocaleString()} dropped off · median ${formatDuration(step.medianMsFromPrevious)} from the previous step`}
                </Typography>
                {onActOnDropOff ? (
                  <Button
                    size="small"
                    sx={{ alignSelf: 'flex-start', flexShrink: 0 }}
                    aria-label={`Act on the drop-off before step ${step.index + 1}`}
                    onClick={() => onActOnDropOff(step.index)}
                  >
                    {'Act on this drop-off'}
                  </Button>
                ) : null}
              </Stack>
            ) : null}
          </Box>
        ))}
      </Stack>
      {result.sources.length ? (
        <Box>
          <Typography variant="subtitle2" gutterBottom>
            {'By source'}
          </Typography>
          <ScrollTable size="small">
            <TableHead>
              <TableRow>
                <TableCell>{'Source'}</TableCell>
                <TableCell align="right">{'Entered'}</TableCell>
                <TableCell align="right">{'Completed'}</TableCell>
                <TableCell align="right">{'Conversion'}</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {result.sources.map((row) => (
                <TableRow key={row.source}>
                  <TableCell>{row.source}</TableCell>
                  <TableCell align="right">{row.entered.toLocaleString()}</TableCell>
                  <TableCell align="right">{row.completed.toLocaleString()}</TableCell>
                  <TableCell align="right">{formatShare(row.conversion)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </ScrollTable>
        </Box>
      ) : null}
      {result.capped ? (
        <Typography variant="caption" color="text.secondary">
          {`Measured over the ${result.journeysRead.toLocaleString()} most recent visits in this range.`}
        </Typography>
      ) : null}
    </Stack>
  )
}

export default FunnelResults
