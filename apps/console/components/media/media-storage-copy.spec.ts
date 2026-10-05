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
  PLAN_ENTITLEMENTS,
  planMetersInfraOverage,
  resolveOrgEntitlements,
} from '@aglyn/aglyn/app-utils/plan-entitlements'
import { USAGE_METER_WARNING_PCT } from '@aglyn/shared-ui-jsx/components/usage-meter.component'
import { formatStorageMb } from '../../utils/usage-alert-notice'
import {
  formatMediaBytes,
  mediaFilesLabel,
  type MediaStorageBand,
  mediaStorageLimitMessage,
  mediaStorageReadout,
  mediaUploadStorageVerdict,
  parseMediaStorageBand,
  pooledMediaBytes,
} from './media-storage-copy'

/**
 * The media library's toolbar readout (AGL-3470).
 *
 * No plan figure is written here. Every cap is derived from
 * `PLAN_ENTITLEMENTS` through `resolveOrgEntitlements`, by the same
 * `max(1, hostLimit) × storagePerHostMb` arithmetic `resolveOrgMediaBand`
 * gates uploads on — so the per-site storage bands can move without this file
 * moving with them.
 */

const MB = 1024 * 1024

type PlanKey = keyof typeof PLAN_ENTITLEMENTS
const paidOrg = (plan: PlanKey, entitlements?: Record<string, number>) =>
  ({
    plan,
    subscription: { status: 'active' },
    ...(entitlements ? { entitlements } : {}),
  }) as any

/** The org-wide band in MB, as the server resolves it (AGL-2075). */
function pooledBandMb(org: any): number {
  const resolved = resolveOrgEntitlements(org)
  return Math.max(1, resolved.hostLimit) * resolved.storagePerHostMb
}

const PLANS = Object.keys(PLAN_ENTITLEMENTS) as PlanKey[]
/** A single-site plan that refuses past its band rather than billing. */
const HARD_SINGLE_SITE = PLANS.find((plan) => {
  const org = paidOrg(plan)
  return (
    resolveOrgEntitlements(org).hostLimit === 1 &&
    !planMetersInfraOverage(org) &&
    Number.isFinite(pooledBandMb(org))
  )
}) as PlanKey
/** A multi-site plan that bills past its band. */
const METERED_MULTI_SITE = PLANS.find((plan) => {
  const org = paidOrg(plan)
  return (
    resolveOrgEntitlements(org).hostLimit > 1 &&
    planMetersInfraOverage(org) &&
    Number.isFinite(pooledBandMb(org))
  )
}) as PlanKey

/** The band `/api/media/storage` would answer with for `org`. */
function bandFor(
  org: any,
  usage: { usedBytes: number; scopeBytes: number },
): MediaStorageBand {
  return {
    allowanceMb: pooledBandMb(org),
    usedBytes: usage.usedBytes,
    scopeBytes: usage.scopeBytes,
    hardBand: !planMetersInfraOverage(org),
  }
}

describe('the plans this spec reasons about exist', () => {
  it('has a hard single-site plan and a metered multi-site one', () => {
    // Anti-vacuity: every case below is keyed on these two.
    expect(HARD_SINGLE_SITE).toBeDefined()
    expect(METERED_MULTI_SITE).toBeDefined()
  })
})

describe('formatMediaBytes', () => {
  it('prints kilobytes, megabytes and gigabytes', () => {
    expect(formatMediaBytes(0)).toBe('0 KB')
    expect(formatMediaBytes(10)).toBe('1 KB')
    expect(formatMediaBytes(512 * 1024)).toBe('512 KB')
    expect(formatMediaBytes(4 * MB)).toBe('4.0 MB')
    expect(formatMediaBytes(1.25 * 1024 * MB)).toBe('1.3 GB')
  })

  it('never prints a negative or NaN figure', () => {
    expect(formatMediaBytes(-5)).toBe('0 KB')
    expect(formatMediaBytes(Number.NaN)).toBe('0 KB')
  })
})

describe('mediaFilesLabel', () => {
  it('states only the library total when no folder is open', () => {
    expect(mediaFilesLabel({ libraryCount: 17 })).toBe('17 files')
    expect(mediaFilesLabel({ libraryCount: 1, place: null })).toBe('1 file')
    expect(mediaFilesLabel({ libraryCount: 0 })).toBe('0 files')
  })

  it('names the folder and the library apart, never "N of M"', () => {
    const label = mediaFilesLabel({
      libraryCount: 17,
      place: { kind: 'folder', name: 'Project photos', count: 15 },
    })
    expect(label).toBe('15 files in Project photos · 17 in the library')
    // The shape this replaced, which read as an upload in progress.
    expect(label).not.toMatch(/\d+ of \d+/)
  })

  it('says when the count includes subfolders', () => {
    expect(
      mediaFilesLabel({
        libraryCount: 40,
        place: {
          kind: 'folder',
          name: 'Clients',
          count: 1,
          withSubfolders: true,
        },
      }),
    ).toBe('1 file in Clients and its subfolders · 40 in the library')
  })

  it('reads the "No folder" view as files outside every folder', () => {
    expect(
      mediaFilesLabel({ libraryCount: 17, place: { kind: 'root', count: 2 } }),
    ).toBe('2 files not in a folder · 17 in the library')
  })
})

describe('parseMediaStorageBand', () => {
  it('reads a capped band', () => {
    expect(
      parseMediaStorageBand({
        allowanceMb: 500,
        unlimited: false,
        usedBytes: 10,
        scopeBytes: 4,
        hardBand: true,
      }),
    ).toEqual({ allowanceMb: 500, usedBytes: 10, scopeBytes: 4, hardBand: true })
  })

  it('rebuilds the unlimited sentinel JSON flattened to null', () => {
    const band = parseMediaStorageBand({
      allowanceMb: null,
      unlimited: true,
      usedBytes: 0,
      scopeBytes: 0,
      hardBand: false,
    })
    expect(band?.allowanceMb).toBe(Number.POSITIVE_INFINITY)
  })

  it('states no band for anything that is not a whole answer', () => {
    // A guessed band could put Free's cap beside a paying workspace.
    for (const payload of [
      null,
      undefined,
      {},
      'nope',
      { allowanceMb: 500, usedBytes: 1 },
      { allowanceMb: null, unlimited: false, usedBytes: 1, scopeBytes: 1 },
      { allowanceMb: 0, usedBytes: 1, scopeBytes: 1 },
      { allowanceMb: 500, usedBytes: -1, scopeBytes: 1 },
    ]) {
      expect(parseMediaStorageBand(payload)).toBeNull()
    }
  })
})

describe('pooledMediaBytes', () => {
  it('keeps the other libraries as read and this one live', () => {
    const band = { allowanceMb: 100, usedBytes: 30, scopeBytes: 10, hardBand: true }
    expect(pooledMediaBytes(band, 10)).toBe(30)
    // An upload here moves the pool without another read.
    expect(pooledMediaBytes(band, 25)).toBe(45)
  })

  it('is never less than this library alone', () => {
    const band = { allowanceMb: 100, usedBytes: 5, scopeBytes: 10, hardBand: true }
    expect(pooledMediaBytes(band, 12)).toBe(12)
  })
})

describe('mediaStorageReadout', () => {
  it('states no cap until there is a band', () => {
    expect(mediaStorageReadout({ scopeBytes: 4 * MB, band: null })).toEqual({
      text: '4.0 MB used',
      percent: null,
      tone: 'primary',
    })
  })

  it('says storage is unlimited rather than quoting Infinity', () => {
    const org = paidOrg(METERED_MULTI_SITE, {
      storagePerHostMb: Number.POSITIVE_INFINITY,
    })
    const readout = mediaStorageReadout({
      scopeBytes: 4 * MB,
      band: bandFor(org, { usedBytes: 0, scopeBytes: 0 }),
    })
    expect(readout.text).toBe('4.0 MB used · unlimited storage')
    expect(readout.text).not.toMatch(/Infinity|∞/)
    expect(readout.percent).toBeNull()
  })

  it('writes the cap the plan resolves to when this library is the whole pool', () => {
    const org = paidOrg(HARD_SINGLE_SITE)
    const readout = mediaStorageReadout({
      scopeBytes: 4 * MB,
      band: bandFor(org, { usedBytes: 4 * MB, scopeBytes: 4 * MB }),
    })
    expect(readout.text).toBe(
      `4.0 MB of ${formatStorageMb(pooledBandMb(org))} used`,
    )
    expect(readout.tone).toBe('primary')
  })

  it('pools every library on a multi-site plan and labels this one apart', () => {
    const org = paidOrg(METERED_MULTI_SITE)
    const bandMb = pooledBandMb(org)
    // The pooled band is wider than one site's share — the reason a scope's
    // bytes may never be written "of" it.
    expect(bandMb).toBeGreaterThan(
      resolveOrgEntitlements(org).storagePerHostMb,
    )
    const elsewhere = Math.round(bandMb * 0.1) * MB
    const here = 4 * MB
    const readout = mediaStorageReadout({
      scopeBytes: here,
      band: bandFor(org, { usedBytes: elsewhere + here, scopeBytes: here }),
    })
    expect(readout.text).toBe(
      `4.0 MB here · ${formatMediaBytes(elsewhere + here)} of ` +
        `${formatStorageMb(bandMb)} used across your workspace`,
    )
    expect(readout.text).not.toMatch(/^4\.0 MB of /)
    expect(readout.percent).toBeCloseTo(((elsewhere + here) / (bandMb * MB)) * 100)
  })

  it('warns where the Billing meters warn, and turns red at the band', () => {
    const org = paidOrg(HARD_SINGLE_SITE)
    const bandBytes = pooledBandMb(org) * MB
    const at = (share: number) =>
      mediaStorageReadout({
        scopeBytes: Math.round(bandBytes * share),
        band: bandFor(org, { usedBytes: 0, scopeBytes: 0 }),
      })
    const below = (USAGE_METER_WARNING_PCT - 1) / 100
    expect(at(below).tone).toBe('primary')
    expect(at((USAGE_METER_WARNING_PCT + 0.5) / 100).tone).toBe('warning')
    expect(at(1).tone).toBe('error')
    // Past the band (billed on a metered plan) stays red; the meter caps at
    // full rather than overflowing.
    expect(at(1.5).tone).toBe('error')
    expect(at(1.5).percent).toBeGreaterThan(100)
  })
})

describe('mediaUploadStorageVerdict', () => {
  it('refuses on a hard band at the POOLED total, not this library alone', () => {
    const org = paidOrg(HARD_SINGLE_SITE)
    const bandBytes = pooledBandMb(org) * MB
    // This library holds half; the org's shared library the other half.
    const band = bandFor(org, {
      usedBytes: bandBytes,
      scopeBytes: bandBytes / 2,
    })
    const verdict = mediaUploadStorageVerdict({
      band,
      scopeBytes: bandBytes / 2,
      incomingBytes: MB,
    })
    expect(verdict).toEqual({ allowed: false, limitMb: pooledBandMb(org) })
    expect(mediaStorageLimitMessage(verdict.limitMb as number)).toBe(
      `Storage limit reached (${formatStorageMb(pooledBandMb(org))} across ` +
        'your workspace) — see Billing to upgrade',
    )
  })

  it('allows up to the cap, inclusive, by the gate’s own rounding', () => {
    const org = paidOrg(HARD_SINGLE_SITE)
    const bandBytes = pooledBandMb(org) * MB
    const band = bandFor(org, { usedBytes: 0, scopeBytes: 0 })
    expect(
      mediaUploadStorageVerdict({ band, scopeBytes: 0, incomingBytes: bandBytes })
        .allowed,
    ).toBe(true)
    expect(
      mediaUploadStorageVerdict({
        band,
        scopeBytes: 0,
        incomingBytes: bandBytes + 1,
      }).allowed,
    ).toBe(false)
  })

  it('lets a multi-site library pass one site’s share while the pool has room', () => {
    // The per-scope check this replaced refused here, and the server did not.
    const org = paidOrg(METERED_MULTI_SITE)
    const perSiteBytes = resolveOrgEntitlements(org).storagePerHostMb * MB
    const band = { ...bandFor(org, { usedBytes: perSiteBytes, scopeBytes: perSiteBytes }), hardBand: true }
    expect(
      mediaUploadStorageVerdict({ band, scopeBytes: perSiteBytes, incomingBytes: MB })
        .allowed,
    ).toBe(true)
  })

  it('never refuses a paid upload past the band — the server bills it', () => {
    const org = paidOrg(METERED_MULTI_SITE)
    const bandBytes = pooledBandMb(org) * MB
    const band = bandFor(org, { usedBytes: bandBytes * 2, scopeBytes: bandBytes * 2 })
    expect(band.hardBand).toBe(false)
    expect(
      mediaUploadStorageVerdict({
        band,
        scopeBytes: bandBytes * 2,
        incomingBytes: 100 * MB,
      }).allowed,
    ).toBe(true)
  })

  it('leaves the decision to the server with no band, or an unlimited one', () => {
    expect(
      mediaUploadStorageVerdict({ band: null, scopeBytes: 1e15, incomingBytes: 1e15 })
        .allowed,
    ).toBe(true)
    expect(
      mediaUploadStorageVerdict({
        band: {
          allowanceMb: Number.POSITIVE_INFINITY,
          usedBytes: 0,
          scopeBytes: 0,
          hardBand: true,
        },
        scopeBytes: 1e15,
        incomingBytes: 1e15,
      }).allowed,
    ).toBe(true)
  })
})
