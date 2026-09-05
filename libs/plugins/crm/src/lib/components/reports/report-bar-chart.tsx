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

export interface ReportBarSeries {
  /** What the legend and the tooltip call it. */
  name: string
  /** A theme palette path — `primary.main`, `success.main` — never a literal. */
  color: string
  /** One value per label, in label order. */
  values: number[]
}

export interface ReportBarChartProps {
  /** One label per bar group, under the bars. */
  labels: string[]
  series: ReportBarSeries[]
  /** The tooltip for one bar; defaults to the value and the series name. */
  format?: (value: number, seriesIndex: number, barIndex: number) => string
  /** Bar area height in pixels. */
  height?: number
  /** What to say when there are no bars at all. */
  emptyText?: string
}

/**
 * Bars over a set of labels, drawn the way the commerce analytics card
 * draws its fourteen days: a row of flex boxes whose heights are a share of
 * the tallest, painted from the theme's palette, with the value in the
 * bar's title. No chart library — the console has never carried one, and a
 * dependency pulled in to draw a dozen bars is a dependency every console
 * page pays for.
 *
 * Every bar is present even when its value is zero, drawn faint and
 * short rather than left out: a week with no new contacts is a fact the
 * chart is there to show, and a missing bar is read as a missing week.
 * Several series draw side by side inside each group, so "won" and "lost"
 * for the same week sit next to each other rather than stacking into a total
 * nobody asked for.
 */
export function ReportBarChart(props: ReportBarChartProps) {
  const {
    labels,
    series,
    format = (value, seriesIndex) =>
      `${series[seriesIndex]?.name ?? ''}: ${value.toLocaleString()}`,
    height = 96,
    emptyText = 'Nothing in this period.',
  } = props
  if (!labels.length || !series.length) {
    return (
      <Typography variant="body2" color="text.secondary">
        {emptyText}
      </Typography>
    )
  }
  const max = Math.max(1, ...series.flatMap((one) => one.values))
  return (
    <Stack spacing={0.5}>
      <Box
        role="img"
        aria-label={series.map((one) => one.name).join(' and ')}
        sx={{ display: 'flex', gap: 0.75, alignItems: 'flex-end', height }}
      >
        {labels.map((label, barIndex) => (
          <Box
            key={label + barIndex}
            sx={{
              flex: 1,
              minWidth: 0,
              height: '100%',
              display: 'flex',
              gap: 0.25,
              alignItems: 'flex-end',
            }}
          >
            {series.map((one, seriesIndex) => {
              const value = one.values[barIndex] ?? 0
              return (
                <Box
                  key={one.name}
                  title={`${format(value, seriesIndex, barIndex)} · ${label}`}
                  sx={{
                    flex: 1,
                    bgcolor: one.color,
                    opacity: value ? 0.9 : 0.25,
                    borderRadius: 0.5,
                    height: `${Math.max(4, Math.round((value / max) * 100))}%`,
                  }}
                />
              )
            })}
          </Box>
        ))}
      </Box>
      <Box sx={{ display: 'flex', gap: 0.75 }}>
        {labels.map((label, index) => (
          <Typography
            key={label + index}
            variant="caption"
            color="text.secondary"
            noWrap
            sx={{ flex: 1, minWidth: 0, textAlign: 'center' }}
          >
            {label}
          </Typography>
        ))}
      </Box>
      {series.length > 1 ? (
        <Stack direction="row" spacing={2}>
          {series.map((one) => (
            <Stack
              key={one.name}
              direction="row"
              spacing={0.5}
              sx={{ alignItems: 'center' }}
            >
              <Box
                sx={{
                  width: 10,
                  height: 10,
                  borderRadius: 0.5,
                  bgcolor: one.color,
                }}
              />
              <Typography variant="caption" color="text.secondary">
                {one.name}
              </Typography>
            </Stack>
          ))}
        </Stack>
      ) : null}
    </Stack>
  )
}
ReportBarChart.displayName = 'ReportBarChart'

export default ReportBarChart
