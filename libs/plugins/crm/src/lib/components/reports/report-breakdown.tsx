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

import { Box, Stack, Typography } from '@mui/material'

export interface ReportBreakdownRow {
  key: string
  label: string
  /** What the bar's length is a share of the largest of. */
  value: number
  /** The figure on the right; the value itself when omitted. */
  display?: string
  /** A line under the label — a count, a rate with its denominator. */
  note?: string
  /** A theme palette path; `primary.main` when omitted. */
  color?: string
}

export interface ReportBreakdownProps {
  rows: ReportBreakdownRow[]
  emptyText: string
}

/**
 * One horizontal bar per category — contacts by source, deals by stage,
 * the lifecycle funnel — each labeled, each with its figure at the end of
 * the row.
 *
 * Horizontal rather than the vertical bars of the trend chart because the
 * categories have NAMES, and a name under a thin vertical bar truncates
 * while a name beside a horizontal one reads. The bar is a share of the
 * largest row, not of the total, so a funnel's top step is always the full
 * width and every step below it is visibly a fraction of the one above.
 */
export function ReportBreakdown(props: ReportBreakdownProps) {
  const { rows, emptyText } = props
  if (!rows.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    )
  }
  const max = Math.max(1, ...rows.map((row) => row.value))
  return (
    <Stack spacing={1}>
      {rows.map((row) => (
        <Stack
          key={row.key}
          direction="row"
          spacing={1.5}
          sx={{ alignItems: 'center' }}
        >
          <Box sx={{ flex: '0 0 36%', minWidth: 0 }}>
            <Typography variant="body2" noWrap>
              {row.label}
            </Typography>
            {row.note ? (
              <Typography
                variant="caption"
                color="text.secondary"
                noWrap
                component="div"
              >
                {row.note}
              </Typography>
            ) : null}
          </Box>
          <Box
            sx={{
              flex: 1,
              height: 8,
              borderRadius: 0.5,
              bgcolor: 'action.hover',
              overflow: 'hidden',
            }}
          >
            <Box
              title={row.display ?? row.value.toLocaleString()}
              sx={{
                width: `${Math.max(row.value > 0 ? 2 : 0, Math.round((row.value / max) * 100))}%`,
                height: '100%',
                bgcolor: row.color ?? 'primary.main',
                opacity: 0.9,
              }}
            />
          </Box>
          <Typography
            variant="body2"
            sx={{ flex: '0 0 auto', minWidth: 64, textAlign: 'right' }}
          >
            {row.display ?? row.value.toLocaleString()}
          </Typography>
        </Stack>
      ))}
    </Stack>
  )
}
ReportBreakdown.displayName = 'ReportBreakdown'

export default ReportBreakdown
