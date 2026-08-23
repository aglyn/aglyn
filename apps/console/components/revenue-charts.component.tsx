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
 * The revenue page's two charts (AGL-2486).
 *
 * Built from plain MUI boxes, like `billing-usage-history.component.tsx` — the
 * repo's existing chart idiom. No charting library is added for two shapes
 * that are a division and a ranking, and reusing the established idiom keeps
 * one visual language rather than two.
 *
 * ## The low-data case is the DESIGN, not an excuse
 *
 * Zach asked for these now, so the page is ready when there is real data —
 * which means what they do at launch, with $25.00 and one paying org, is a
 * requirement rather than a caveat. Stated per chart:
 *
 * **`CompositionBar` — how one total divides.**
 * - *Zero*: nothing is drawn. A bar of a zero total would render as either an
 *   empty frame or a fabricated full-width block, and both read as broken.
 *   The card says what it is waiting for instead.
 * - *One*: drawn, full width, and SAID — "all of it came from X". This is the
 *   important difference from a trend chart, and the reason the usage-history
 *   card refuses to draw one bar while this one draws it happily: a
 *   composition of one source is a TRUE statement about proportion (it really
 *   is 100%), whereas one bar of a time series implies a comparison it cannot
 *   support. Drawing it is honest; hiding it would withhold a real fact.
 * - *Many*: proportional segments, largest first, each labelled with its
 *   share.
 *
 * **`RankedBars` — who contributed how much.**
 * - *Zero*: nothing drawn, message instead.
 * - *One*: drawn. A single bar here is a magnitude against a scale, not a
 *   trend, so it implies nothing it cannot support.
 * - *Many*: sorted descending, each bar scaled against the largest.
 *
 * ## Never fabricate a measurement
 *
 * A zero-value row renders as a hairline tick, never as a floor-height bar —
 * the same rule the usage history states as "null is not zero". A reader must
 * be able to tell "this earned nothing" from "this earned a little".
 *
 * Negative values are clamped to zero for LAYOUT only and the real figure is
 * still printed beside the bar. A proportional chart cannot express a negative
 * share, and silently rescaling to fit one would misstate every other segment.
 *
 * ## Hover text is the NATIVE `title`, not a MUI `Tooltip`
 *
 * Each table shows up to 100 rows and there are three of them, so a `Tooltip`
 * per bar is several hundred Poppers on one page — every one of them mounting
 * a positioning engine and a transition for a string. It measurably wrecked
 * the page: the render spec went from 4 seconds to over 100 and most
 * assertions timed out before the page had painted. A `title` attribute says
 * the same thing for free, and the `aria-label` beside it is what actually
 * carries the figure to a screen reader.
 */

import { Box, Stack, Typography } from '@mui/material'

/** Cents to a signed money string. Local to keep the component standalone. */
function money(cents: number): string {
  const safe = Number.isFinite(cents) ? cents : 0
  const text = (Math.abs(safe) / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })
  return `${safe < 0 ? '-' : ''}$${text}`
}

/** The palette segments cycle through, in order. Theme tokens, never hex. */
const SEGMENT_COLORS = [
  'primary.main',
  'secondary.main',
  'success.main',
  'warning.main',
  'info.main',
]

export interface CompositionSlice {
  key: string
  label: string
  cents: number
}

export function CompositionBar({
  slices,
  emptyMessage,
}: {
  slices: readonly CompositionSlice[]
  emptyMessage: string
}) {
  // Only positive contributions can hold a share of a whole.
  const positive = (slices ?? []).filter((slice) => slice.cents > 0)
  const total = positive.reduce((sum, slice) => sum + slice.cents, 0)

  if (total <= 0) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        data-chart-state="empty"
      >
        {emptyMessage}
      </Typography>
    )
  }

  const ordered = [...positive].sort((a, b) => b.cents - a.cents)
  return (
    <Stack spacing={1} data-chart-state={ordered.length === 1 ? 'single' : 'multi'}>
      <Stack direction="row" sx={{ height: 24, borderRadius: 1, overflow: 'hidden' }}>
        {ordered.map((slice, index) => {
          const pct = (slice.cents / total) * 100
          const title = `${slice.label}: ${money(slice.cents)} (${pct.toFixed(1)}%)`
          return (
            <Box
              key={slice.key}
              data-slice={slice.key}
              title={title}
              aria-label={title}
              sx={{
                width: `${pct}%`,
                bgcolor: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
              }}
            />
          )
        })}
      </Stack>
      <Stack direction="row" spacing={2} sx={{ flexWrap: 'wrap' }}>
        {ordered.map((slice, index) => (
          <Stack
            key={slice.key}
            direction="row"
            spacing={0.75}
            sx={{ alignItems: 'center' }}
          >
            <Box
              sx={{
                width: 10,
                height: 10,
                borderRadius: '50%',
                bgcolor: SEGMENT_COLORS[index % SEGMENT_COLORS.length],
              }}
            />
            <Typography variant="caption" color="text.secondary">
              {slice.label} {money(slice.cents)} (
              {((slice.cents / total) * 100).toFixed(1)}%)
            </Typography>
          </Stack>
        ))}
      </Stack>
      {ordered.length === 1 ? (
        // Said outright rather than left to be inferred from a full-width
        // block, which on its own is indistinguishable from a broken chart.
        <Typography variant="caption" color="text.secondary">
          {`All of it came from ${ordered[0].label} — one source, so this is a statement about where the money came from, not a comparison.`}
        </Typography>
      ) : null}
    </Stack>
  )
}

export interface RankedRow {
  key: string
  label: string
  sublabel?: string
  cents: number
}

export function RankedBars({
  rows,
  emptyMessage,
}: {
  rows: readonly RankedRow[]
  emptyMessage: string
}) {
  if ((rows ?? []).length === 0) {
    return (
      <Typography
        variant="body2"
        color="text.secondary"
        data-chart-state="empty"
      >
        {emptyMessage}
      </Typography>
    )
  }
  const ordered = [...rows].sort((a, b) => b.cents - a.cents)
  const max = Math.max(...ordered.map((row) => Math.max(0, row.cents)), 0)
  return (
    <Stack spacing={1} data-chart-state={ordered.length === 1 ? 'single' : 'multi'}>
      {ordered.map((row) => {
        // A zero row is a HAIRLINE, never a floor-height bar: "earned
        // nothing" and "earned a little" must not look the same.
        const width =
          max > 0 && row.cents > 0 ? `${Math.max(2, (row.cents / max) * 100)}%` : '2px'
        const title = `${row.label}: ${money(row.cents)}`
        return (
          <Stack key={row.key} spacing={0.25}>
            <Stack
              direction="row"
              spacing={1}
              sx={{ alignItems: 'baseline', justifyContent: 'space-between' }}
            >
              <Typography variant="body2">
                {row.label}
                {row.sublabel ? (
                  <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                  >
                    {` · ${row.sublabel}`}
                  </Typography>
                ) : null}
              </Typography>
              <Typography variant="body2">{money(row.cents)}</Typography>
            </Stack>
            <Box
              data-bar={row.key}
              data-zero={row.cents > 0 ? 'false' : 'true'}
              title={title}
              aria-label={title}
              sx={{
                width,
                height: 8,
                borderRadius: 0.5,
                bgcolor: row.cents > 0 ? 'primary.main' : 'action.disabled',
              }}
            />
          </Stack>
        )
      })}
    </Stack>
  )
}
