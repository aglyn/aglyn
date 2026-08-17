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

import { formCeilingResetAt } from '@aglyn/aglyn'
import { Chip, Tooltip } from '@mui/material'

/** The per-host counters join `/api/admin/hosts?orgId=…` serves (AGL-1681). */
export interface StaffHostFormCounters {
  /** The month the counts are for — the shared `submissionMonthKey()`. */
  month: string
  /** Submissions refused by the abuse ceiling this month (AGL-1655). */
  refused: number
  /** The ceiling the counter recorded when it tripped, when known. */
  ceiling: number | null
  /**
   * Honeypot catches this month (AGL-1831, counter written by 9db4f322a).
   * Optional because the AGL-1681 join predates it by one commit and a
   * missing meter must read as zero, never crash the card.
   */
  spam?: number
}

/**
 * The at-a-glance form-abuse flag on the staff org detail page's Sites card
 * (AGL-1681) — so "my form stopped working" is answered by the page instead
 * of a raw Firestore query.
 *
 * Same render-nothing discipline as the owner's
 * `formSubmissionsPausedNotice`: below one hit of either counter there is
 * NOTHING, because the counter documents persist from their first trip
 * forever and a "0 refused" chip on every healthy site trains staff to
 * ignore the chip that will one day be real. `forms == null` also renders
 * nothing — that is "not joined" (the picker projection, a failed read),
 * not a healthy zero. The honeypot catch count (AGL-1831) renders beside
 * the refusal flag under the same rule.
 *
 * The chip is terse on purpose (the owner's wording is for owners); the
 * ceiling and the reset date live in the tooltip. The reset date is rendered
 * at the UTC boundary the `YYYY-MM` key rolls over on — a reader-zone render
 * would move a 1 September reset to 31 August for most of the Americas.
 */
const StaffHostFormCountersChips = ({
  forms,
}: {
  forms?: StaffHostFormCounters | null
}) => {
  if (!forms) return null
  const refused = Math.floor(Number(forms.refused) || 0)
  const spam = Math.floor(Number(forms.spam) || 0)
  if (refused < 1 && spam < 1) return null
  const ceiling =
    typeof forms.ceiling === 'number' && Number.isFinite(forms.ceiling)
      ? Math.floor(forms.ceiling)
      : null
  const reset = formCeilingResetAt().toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  })
  const refusedDetail =
    `${refused.toLocaleString()} form submission${refused === 1 ? '' : 's'} ` +
    `refused this month` +
    (ceiling
      ? ` — the site passed its ${ceiling.toLocaleString()}-submission ceiling`
      : '') +
    `. Nothing refused is stored or billed. Accepting again on ${reset}.`
  // The spam chip reports the honeypot WORKING, not something wrong
  // (AGL-1831) — neutral color, caught-and-dropped copy. It is also the
  // AGL-1664 revisit input: spam creeping toward ~20% of a paying host's
  // submissions is the trigger for reopening the App Check / CAPTCHA call.
  const spamDetail =
    `${spam.toLocaleString()} bot submission${spam === 1 ? '' : 's'} ` +
    `${spam === 1 ? 'was' : 'were'} caught and dropped by the honeypot ` +
    `this month — nothing was stored or billed.`
  return (
    <>
      {refused >= 1 ? (
        <Tooltip title={refusedDetail}>
          <Chip
            size="small"
            color="error"
            variant="outlined"
            aria-label={refusedDetail}
            label={`forms paused · ${refused.toLocaleString()} refused`}
          />
        </Tooltip>
      ) : null}
      {spam >= 1 ? (
        <Tooltip title={spamDetail}>
          <Chip
            size="small"
            variant="outlined"
            aria-label={spamDetail}
            label={`${spam.toLocaleString()} bot hit${spam === 1 ? '' : 's'} caught`}
          />
        </Tooltip>
      ) : null}
    </>
  )
}
StaffHostFormCountersChips.displayName = 'StaffHostFormCountersChips'

export default StaffHostFormCountersChips
