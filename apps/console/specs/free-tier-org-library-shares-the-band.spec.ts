/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
 *
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

/**
 * The org library shares the org's media band; it does not get one of its own
 * (AGL-2075).
 *
 * `resolveMediaScope` serves two libraries — `hosts/{hostId}` and
 * `orgs/{orgId}` — each with its own `counters/media.bytes`, and every ingress
 * route checked its scope's counter against the same `storagePerHostMb`. So a
 * free org's real ceiling was `250 MB (its one site) + 250 MB (the library)`
 * against a published 250 MB per site, and a downgraded org kept
 * `(sites + 1) × storagePerHostMb` whatever plan it landed on.
 *
 * Not a fail-open — `meteredInfraPassThrough: false` means none of it could be
 * billed — but the number enforced was not the number published, and it was
 * not the number the invoice uses either: `meteredIncludedAllowance` sizes the
 * band as `hostLimit × storagePerHostMb`, which has no room for a library
 * scope. Three figures, no two the same.
 *
 * ## Why the assertions are shaped this way
 *
 * The band is checked BOTH ways round — fill the site and refuse the library,
 * fill the library and refuse the site — because a per-scope band cannot be
 * fixed by capping one side: whichever scope is filled first would leave the
 * other its own full allowance, so the real ceiling depended on upload order.
 * Every refusal is paired with the same call one byte under the band, so a
 * gate that simply refused everything could not pass.
 */

import {
  meteredIncludedAllowance,
} from '../utils/usage-metering'
import { mediaStorageGate } from '../utils/storage-overage'
import { resolveOrgMediaBand } from '../utils/server/media-storage-band'

const MB = 1024 * 1024

let counters: Record<string, number> = {}
let legacyHosts: string[] = []
let getAllCalls = 0
let queryCalls = 0

function fakeFirestore(): any {
  const doc = (path: string) => ({
    path,
    collection: (name: string) => collection(`${path}/${name}`),
  })
  const collection = (prefix: string) => ({
    doc: (id: string) => doc(`${prefix}/${id}`),
    where: () => ({
      select: () => ({
        get: async () => {
          queryCalls += 1
          return { docs: legacyHosts.map((id) => ({ id })) }
        },
      }),
    }),
  })
  return {
    collection,
    getAll: async (...refs: Array<{ path: string }>) => {
      getAllCalls += 1
      return refs.map((ref) => ({
        get: (field: string) =>
          field === 'bytes' ? counters[ref.path] : undefined,
      }))
    },
  }
}

const freeOrg = (hosts: Record<string, true> = { 'host-1': true }) => ({
  plan: 'free' as const,
  hosts,
})

const band = (org: any, currentHostId?: string | null) =>
  resolveOrgMediaBand({
    firestore: fakeFirestore(),
    orgId: 'org-1',
    org,
    currentHostId,
  })

/** The verdict an ingress route reaches for `incomingBytes` on this org. */
async function ingressVerdict(options: {
  org: any
  incomingBytes: number
  currentHostId?: string | null
}) {
  const pool = await band(options.org, options.currentHostId)
  return mediaStorageGate({
    org: options.org,
    usedMb: (pool.usedBytes + options.incomingBytes) / MB,
    allowanceMb: pool.allowanceMb,
  })
}

beforeEach(() => {
  counters = {}
  legacyHosts = []
  getAllCalls = 0
  queryCalls = 0
})

describe('free gets ONE 250 MB media band, not two (AGL-2075)', () => {
  it('THE SECOND BAND: a full site library leaves the org library nothing', async () => {
    // Before this, the org library read its own counter (0 bytes) and passed
    // the same 250 MB cap — a whole second band on a plan that publishes one.
    counters['hosts/host-1/counters/media'] = 250 * MB
    const verdict = await ingressVerdict({
      org: freeOrg(),
      incomingBytes: 1 * MB,
      currentHostId: null, // the ORG library scope
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.status).toBe(403)
    expect(verdict.code).toBe('plan_limit_reached')
    expect(verdict.limitMb).toBe(250)
    // Never billed either — free is not a metered plan.
    expect(verdict.billed).toBe(false)
  })

  it('THE CONTROL: the per-scope band it replaced let that same upload through', async () => {
    // The old shape, run against the identical fixture. The org library read
    // its OWN counter — zero bytes — and sailed past the same 250 MB cap,
    // which is the whole defect in one line. If this ever starts refusing,
    // the test above has stopped proving anything.
    counters['hosts/host-1/counters/media'] = 250 * MB
    const perScopeUsedMb = 1 // the library's own counter, plus the incoming MB
    expect(
      mediaStorageGate({ org: freeOrg(), usedMb: perScopeUsedMb }).allowed,
    ).toBe(true)
  })

  it('GUARD IS LIVE: the same org-library upload lands with room in the pool', async () => {
    // The inverse fixture. Without it the assertion above is satisfied by a
    // gate that refuses every org-library upload.
    counters['hosts/host-1/counters/media'] = 200 * MB
    const verdict = await ingressVerdict({
      org: freeOrg(),
      incomingBytes: 1 * MB,
      currentHostId: null,
    })
    expect(verdict.allowed).toBe(true)
  })

  it('THE OTHER WAY ROUND: a full org library leaves the site nothing', async () => {
    // Order independence is the point. Capping only the library would leave
    // the effective ceiling depending on which scope was filled first.
    counters['orgs/org-1/counters/media'] = 250 * MB
    const verdict = await ingressVerdict({
      org: freeOrg(),
      incomingBytes: 1 * MB,
      currentHostId: 'host-1',
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.limitMb).toBe(250)
  })

  it('the two libraries ADD: 150 + 100 is at the band, not half of it', async () => {
    counters['hosts/host-1/counters/media'] = 150 * MB
    counters['orgs/org-1/counters/media'] = 100 * MB
    expect(
      (await ingressVerdict({ org: freeOrg(), incomingBytes: 1 * MB })).allowed,
    ).toBe(false)
    // …and one byte under it still lands, so this is a band and not a wall.
    counters['orgs/org-1/counters/media'] = 99 * MB
    expect(
      (await ingressVerdict({ org: freeOrg(), incomingBytes: 1 * MB })).allowed,
    ).toBe(true)
  })

  it('an org with no plan is banded as free, not left unmetered', async () => {
    counters['hosts/host-1/counters/media'] = 250 * MB
    const verdict = await ingressVerdict({
      org: { hosts: { 'host-1': true } },
      incomingBytes: 1 * MB,
    })
    expect(verdict.allowed).toBe(false)
    expect(verdict.limitMb).toBe(250)
  })
})

describe('the enforced band IS the invoiced band (AGL-2075)', () => {
  it('matches meteredIncludedAllowance exactly, on every plan shape', async () => {
    // The disagreement this closes: enforcement asked `storagePerHostMb` once
    // per scope while the invoice subtracted `hostLimit × storagePerHostMb`
    // once per org. On free (`hostLimit: 1`) those two numbers are equal,
    // which is exactly why the extra library scope went unnoticed.
    for (const org of [
      { plan: 'free' },
      { plan: 'starter' },
      { plan: 'pro' },
      { plan: 'business' },
      { plan: 'free', entitlements: { hostLimit: 4, storagePerHostMb: 500 } },
    ]) {
      const pool = await band(org)
      expect(pool.allowanceMb / 1024).toBeCloseTo(
        meteredIncludedAllowance(org as never).storageGb,
        6,
      )
    }
  })

  it('pools every site the org owns, not just the one being written to', async () => {
    counters['hosts/host-1/counters/media'] = 300 * MB
    counters['hosts/host-2/counters/media'] = 300 * MB
    counters['orgs/org-1/counters/media'] = 100 * MB
    const org = {
      plan: 'free',
      entitlements: { hostLimit: 3, storagePerHostMb: 250 },
      hosts: { 'host-1': true, 'host-2': true },
    }
    const pool = await band(org, 'host-1')
    expect(pool.usedBytes).toBe(700 * MB)
    expect(pool.allowanceMb).toBe(750)
    expect(
      (await ingressVerdict({ org, incomingBytes: 60 * MB, currentHostId: 'host-1' }))
        .allowed,
    ).toBe(false)
  })

  it('counts a site that predates the orgs/{id}.hosts directory', async () => {
    // The map is authoritative for the site cap (AGL-2063) but postdates some
    // orgs. A host missing from it would otherwise contribute zero bytes and
    // hand the org that site's whole band back.
    legacyHosts = ['legacy-1']
    counters['hosts/legacy-1/counters/media'] = 250 * MB
    const pool = await band({ plan: 'free', hosts: {} })
    expect(queryCalls).toBe(1)
    expect(pool.usedBytes).toBe(250 * MB)
  })

  it('counts the scope being written to even when the directory has not caught up', async () => {
    counters['hosts/host-9/counters/media'] = 250 * MB
    const pool = await band({ plan: 'free', hosts: { 'host-1': true } }, 'host-9')
    expect(pool.usedBytes).toBe(250 * MB)
  })

  it('an UNLIMITED band reads nothing at all', async () => {
    // Enterprise has the most sites to fan out over and the least reason to:
    // no sum could change the verdict.
    const pool = await band({ plan: 'enterprise' })
    expect(pool.allowanceMb).toBe(Number.POSITIVE_INFINITY)
    expect(getAllCalls).toBe(0)
    expect(queryCalls).toBe(0)
  })
})

describe('every ingress door measures the pool (AGL-2075)', () => {
  it('no media route calls mediaStorageGate without an allowanceMb', () => {
    // `allowanceMb` is optional so the gate keeps a defined answer for a
    // caller with no pool — and that fallback is the per-scope band, i.e. the
    // bug. A route added later that forgets it silently reinstates the second
    // band, and nothing else in the type system would say so.
    const fs = require('fs') as typeof import('fs')
    const path = require('path') as typeof import('path')
    const root = path.join(__dirname, '..', 'app', 'api')
    const files: string[] = []
    const walk = (dir: string) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) walk(full)
        else if (entry.name.endsWith('.ts')) files.push(full)
      }
    }
    walk(root)
    const callSites: string[] = []
    for (const file of files) {
      const source = fs.readFileSync(file, 'utf8')
      // Each call spans several lines; slice from the call to its closing
      // `})` so the check reads the ARGUMENTS, not merely the name.
      let index = source.indexOf('mediaStorageGate({')
      while (index !== -1) {
        const end = source.indexOf('})', index)
        callSites.push(`${file}:${source.slice(index, end)}`)
        index = source.indexOf('mediaStorageGate({', index + 1)
      }
    }
    // Fails if a door is added and left unpooled, and fails if the doors
    // vanish — a zero-length sweep must not read as compliance.
    expect(callSites.length).toBe(4)
    for (const site of callSites) {
      expect(site).toContain('allowanceMb')
    }
  })
})
