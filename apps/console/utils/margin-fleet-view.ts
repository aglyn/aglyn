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
  fleetUtilization,
  UTILIZATION_BAND_LABELS,
  type OrgMarginRow,
} from '@aglyn/aglyn/app-utils/margin-utilization'

/*
 * THE FLEET UTILIZATION, AS THE STAFF MARGIN PAGE PRINTS IT (AGL-3667).
 *
 * `/admin/margin-utilization` folds the organizations it has scanned into the
 * median and spread of every band and the fleet's margin (`fleetUtilization`,
 * in the browser). The staff apps read the same fold through
 * `/api/admin/margin-utilization?view=fleet`, which scans the pages the page
 * would scan and sends the fold as the lines it prints, formatted the way it
 * formats them.
 */

const pct = (fraction: number | null): string =>
  fraction === null ? '\u2014' : `${(fraction * 100).toFixed(fraction < 0.1 ? 1 : 0)}%`

const usd = (amount: number): string =>
  `$${amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`

export interface MarginFleetView {
  orgs: number
  complete: boolean
  caption: string
  bands: Array<{
    band: string
    label: string
    counted: number
    median: string
    p25: string
    p75: string
    p90: string
    max: string
    overBand: number
    excluded: string
  }>
  margin: {
    median: string
    underFloor: number
    underwater: number
    cost: string
    revenue: string
    aiAddon: string
    nothingBills: boolean
  }
}

export function marginFleetView(rows: readonly OrgMarginRow[], complete: boolean): MarginFleetView {
  const fleet = fleetUtilization(rows)
  const withoutRollup = fleet.orgs - fleet.withRollup
  return {
    orgs: fleet.orgs,
    complete,
    caption:
      `Over ${fleet.orgs.toLocaleString('en-US')} organizations` +
      (withoutRollup > 0
        ? `, of which ${withoutRollup.toLocaleString('en-US')} have no usage rollup and count only toward Sites`
        : '') +
      '. A dash means no organization in the sample has a percentage on that band.',
    bands: fleet.distributions.map((band) => ({
      band: band.band,
      label: UTILIZATION_BAND_LABELS[band.band],
      counted: band.counted,
      median: pct(band.p50),
      p25: pct(band.p25),
      p75: pct(band.p75),
      p90: pct(band.p90),
      max: pct(band.max),
      overBand: band.overBand,
      excluded: [
        band.excludedUncapped ? `${band.excludedUncapped} uncapped` : '',
        band.excludedNoAllowance ? `${band.excludedNoAllowance} no allowance` : '',
        band.usageWithNoAllowance ? `${band.usageWithNoAllowance} spending it anyway` : '',
      ]
        .filter(Boolean)
        .join(' \u00b7 '),
    })),
    margin: {
      median: pct(fleet.medianMarginPct),
      underFloor: fleet.orgsUnderFloor,
      underwater: fleet.orgsUnderwater,
      cost: usd(fleet.totalCogsUsd),
      revenue: usd(fleet.totalNetRevenueUsd),
      aiAddon: usd(fleet.totalAiAddonRevenueUsd),
      nothingBills: fleet.medianMarginPct === null,
    },
  }
}
