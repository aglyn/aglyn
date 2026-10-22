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

import {
  countedPluginBands,
  meteredBandField,
  meteredPluginBands,
} from '../../plugin-manager/plugin-usage-axes'

/**
 * One monthly org usage rollup as `/api/admin/org-usage` serves it. The row
 * carries more fields than the core columns draw: every field a plugin's cost
 * axis reads, records or serves staff, under its rollup name — a metered
 * band's count among them, which the table draws — and a plugin column reads
 * the ones that are its own off the same row.
 */
export interface StaffOrgUsageMonth {
  month: string
  storageGb: number
  pageViews: number
  costUsd: number
  /**
   * What the rollup recorded and nothing priced (AGL-2321).
   *
   * A detail LINE under the row rather than sixteen more columns: these are
   * the history a future rate gets derived from, not figures a reader scans
   * across months, and a table wide enough to hold them all would stop being
   * readable for the figures that are.
   *
   * Every field is optional and every one distinguishes null from zero,
   * because the route does — a rollup written before a meter existed recorded
   * nothing, and printing `0` there would be a fabricated measurement.
   */
  recorded?: {
    emailSends?: number
    emailSendsOverage?: number
    /**
     * Each plugin band counted by a per-site counter and never billed past it
     * (`countedPluginBands`), by band id.
     */
    counted?: Readonly<Record<string, number>>
    actionRuns?: number
    billableCostUsd?: number
    apiOverageUsd?: number
    /**
     * Each metered band that waits behind a release flag, by band id: whether
     * the month billed its overage, and what was forgone, at cost, if not.
     */
    meteredVerdicts?: Readonly<
      Record<string, { billed: boolean | null; withheldUsd: number }>
    >
    contactsOverageBilled?: boolean | null
    contactsOverageUsd?: number
    contactsOverageWithheldUsd?: number
    orgLibraryStorageGb?: number | null
    orgLibraryBilled?: boolean | null
    orgLibraryBilledFrom?: string | null
    siteSizeMb?: number | null
    siteSizeTruncated?: boolean | null
  }
  deltas: { pageViews: number | null; costUsd: number | null } | null
  readonly [field: string]: unknown
}

/**
 * The withheld/billed pair as ONE sentence (AGL-2321).
 *
 * `*WithheldUsd` is zero whenever the release flag was on, so the dollar
 * figure alone cannot tell a withheld month from an in-band one — the writer's
 * own comment says so and it has been true ever since. Rendering the flag with
 * the number is the whole fix.
 */
function overageSentence(
  label: string,
  billed: boolean | null | undefined,
  withheldUsd: number | undefined,
  billedUsd?: number,
): string | null {
  if (billed == null) return null
  if (billed) {
    return billedUsd == null
      ? `${label} billed`
      : `${label} billed $${billedUsd.toFixed(2)}`
  }
  return `${label} withheld $${Number(withheldUsd ?? 0).toFixed(2)}`
}

/**
 * The org library's own recorded answer to "was THIS month billed for it".
 *
 * Read off the rollup, never re-derived from `BILL_ORG_LIBRARY_STORAGE_FROM`.
 * The env var answers "what is the switch now", which is the right question
 * for the current-month estimate card and the wrong one for a July row: the
 * switch may have moved since, and a past invoice does not change when it
 * does. The rollup froze the value for exactly this reader (AGL-2321 item 3).
 */
function librarySentence(
  recorded: StaffOrgUsageMonth['recorded'],
): string | null {
  if (!recorded || recorded.orgLibraryStorageGb == null) return null
  const size = `Org library ${recorded.orgLibraryStorageGb.toFixed(3)} GB`
  if (recorded.orgLibraryBilled == null) return size
  if (!recorded.orgLibraryBilled) return `${size}, not billed`
  return recorded.orgLibraryBilledFrom
    ? `${size}, billed from ${recorded.orgLibraryBilledFrom}`
    : `${size}, billed`
}

/**
 * The recorded block as the short lines a staff reader actually scans: the meters, the money, the
 * release-gated overages and the site size, each a line of its own (or empty).
 */
export function recordedUsageGroups(
  recorded: StaffOrgUsageMonth['recorded'],
): { meters: string; money: string; gates: string; site: string } {
  const none = { meters: '', money: '', gates: '', site: '' }
  if (!recorded) return none
  const meters: string[] = []
  if (recorded.emailSends != null) {
    meters.push(
      `Emails ${recorded.emailSends.toLocaleString()}` +
        (recorded.emailSendsOverage
          ? ` (${recorded.emailSendsOverage.toLocaleString()} over band)`
          : ''),
    )
  }
  for (const band of countedPluginBands()) {
    const count = recorded.counted?.[band.id]
    if (count != null) meters.push(`${band.label} ${count.toLocaleString()}`)
  }
  if (recorded.actionRuns != null) {
    meters.push(`Action runs ${recorded.actionRuns.toLocaleString()}`)
  }
  const money: string[] = []
  if (recorded.billableCostUsd != null) {
    // The pre-markup twin of `costUsd`. Four decimals for the AGL-2280
    // reason: a sub-cent month rounded to `$0.00` is the silence this exists
    // to end.
    money.push(`Billable $${recorded.billableCostUsd.toFixed(4)}`)
  }
  if (recorded.apiOverageUsd) {
    money.push(`API overage $${recorded.apiOverageUsd.toFixed(2)}`)
  }
  const gates = [
    ...meteredPluginBands().map((band) => {
      const verdict = recorded.meteredVerdicts?.[band.id]
      return overageSentence(
        `${band.label} overage`,
        verdict?.billed,
        verdict?.withheldUsd,
      )
    }),
    overageSentence(
      'Contacts overage',
      recorded.contactsOverageBilled,
      recorded.contactsOverageWithheldUsd,
      recorded.contactsOverageUsd,
    ),
    librarySentence(recorded),
  ].filter(Boolean) as string[]
  const site: string[] = []
  if (recorded.siteSizeMb != null) {
    // The truncation flag changes the NUMBER'S MEANING, so it is rendered on
    // the number and not beside it: a truncated measurement is a floor.
    site.push(
      `Site size ${recorded.siteSizeMb.toFixed(1)} MB` +
        (recorded.siteSizeTruncated
          ? ' (at least — measurement truncated)'
          : ''),
    )
  }
  return {
    meters: meters.join(' · '),
    money: money.join(' · '),
    gates: gates.join(' · '),
    site: site.join(' · '),
  }
}

/** The recorded block as the short lines a staff reader actually scans. */
export function recordedUsageLines(
  recorded: StaffOrgUsageMonth['recorded'],
): string[] {
  const groups = recordedUsageGroups(recorded)
  return [groups.meters, groups.money, groups.gates, groups.site].filter(
    (line) => line.length > 0,
  )
}


/** A month-over-month change as the table prints it beside a figure: `+8%`, `-3%`. */
export function percentChange(change: number): string {
  return `${change > 0 ? '+' : ''}${Math.round(change * 100)}%`
}

/** What a month with nothing recorded beyond the core meters says, rather than a blank. */
export const NO_RECORDED_METERS = 'No additional meters recorded for this month.'

/** Each metered band's count as `Label n`, joined as the table's columns read across. */
export function meteredBandsText(row: StaffOrgUsageMonth): string {
  return meteredPluginBands()
    .map((band) => `${band.label} ${Number(row[meteredBandField(band)] ?? 0).toLocaleString()}`)
    .join(' · ')
}

export interface StaffOrgUsageRowView {
  month: string
  /** Page views and, when there is an older month, the change from it. */
  views: string
  storage: string
  metered: string
  /** The month's cost and, when there is an older month, the change from it. */
  cost: string
  recorded: { meters: string; money: string; gates: string; site: string; none: string }
}

/** One rollup row as the staff usage table prints it, for a client that draws no table (the staff apps). */
export function staffOrgUsageRowView(row: StaffOrgUsageMonth): StaffOrgUsageRowView {
  const groups = recordedUsageGroups(row.recorded)
  const any = Object.values(groups).some((line) => line.length > 0)
  return {
    month: row.month,
    views:
      row.pageViews.toLocaleString() +
      (row.deltas?.pageViews != null ? ` ${percentChange(row.deltas.pageViews)}` : ''),
    storage: `${row.storageGb.toFixed(2)} GB`,
    metered: meteredBandsText(row),
    cost:
      `$${row.costUsd.toFixed(2)}` +
      (row.deltas?.costUsd != null ? ` ${percentChange(row.deltas.costUsd)}` : ''),
    recorded: { ...groups, none: any ? '' : NO_RECORDED_METERS },
  }
}
