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
 * THE PAIRING: a scope whose bytes reach no invoice must not be admitted past
 * the band (AGL-2003).
 *
 * ## The failure this exists to make impossible
 *
 * `BILL_ORG_LIBRARY_STORAGE_FROM` is a start MONTH, deliberately unset. Two
 * halves were supposed to move together and only one did:
 *
 * - the METER is off — `billsOrgLibraryStorage` is false for anything that is
 *   not `YYYY-MM`, and `report-usage` drops org-library bytes from
 *   `billedEstimate`;
 * - the CEILING was open — `mediaStorageGate` admitted a metered org past
 *   `storagePerHostMb` in every scope, the org library included.
 *
 * So a customer could be shown a metered storage price, CONSENT to it, upload
 * into the org library past the allowance, and be invoiced nothing. An
 * undercharge with a paper trail saying the customer expected to pay — worse
 * than a plain one, because the consent is evidence against us.
 *
 * ## Which half this suite fixes, and why that one
 *
 * The gate closes; the meter stays off. Read from what the customer agreed to
 * at the consent moment, that is the only half a code change may touch:
 *
 * - What they agreed to is "past my allowance I pay the PUBLISHED metered
 *   rate". Refusing the bytes honours it exactly — they are never given
 *   storage they did not pay for, and never shown a projection that will not
 *   materialise. It costs no revenue, because none was being collected.
 * - Turning the meter on instead would start billing a scope on a date nobody
 *   chose. The rate is locked and published, but the START MONTH is Zach's
 *   live billing decision (AGL-1886) and it needs a redeploy, so a code change
 *   cannot make it.
 *
 * The fix is self-healing in the direction Zach wants: the day the env var
 * names a month, `scopeBillsStorageOverage` returns true, the gate opens on
 * its own, and no second decision has to be remembered.
 *
 * ## Why the assertions are shaped this way
 *
 * Every refusal is paired with a positive control on the SAME org — the
 * neighbouring month, or the neighbouring scope — because a gate that simply
 * refused everything would satisfy a suite that only proves refusals, and
 * that is the exact regression AGL-1957 found the last time this file moved.
 * Both directions of each guard were forced red on purpose.
 */

import {
  mediaStorageGate,
  scopeBillsStorageOverage,
} from '../utils/storage-overage'
import { billsOrgLibraryStorage } from '../utils/usage-metering'
import { PLAN_ENTITLEMENTS, planMetersInfraOverage } from '@aglyn/aglyn/server'

/** A plan that meters infra overage, so the gate can reach the billed arm. */
const METERED_PLAN = 'pro'
const proOrg = () => ({ plan: METERED_PLAN }) as any
const BAND_MB = PLAN_ENTITLEMENTS[METERED_PLAN].storagePerHostMb

const MONTH = '2026-09'
const EARLIER = '2026-08'

/** One ingress verdict, with the scope spelled out the way a route spells it. */
const ingress = (options: {
  collection: 'orgs' | 'hosts'
  month?: string
  configuredStart?: string | null
  usedMb?: number
}) =>
  mediaStorageGate({
    org: proOrg(),
    usedMb: options.usedMb ?? BAND_MB + 1024,
    allowanceMb: BAND_MB,
    billsOverage: scopeBillsStorageOverage(
      options.collection,
      options.month ?? MONTH,
      options.configuredStart,
    ),
  })

describe('the premise still holds', () => {
  it('the plan under test really does meter, so a refusal means THIS gate', () => {
    // Without this, every assertion below could pass on a plan that hard-bands
    // for an unrelated reason and the suite would prove nothing.
    expect(planMetersInfraOverage(proOrg())).toBe(true)
    expect(BAND_MB).toBeGreaterThan(0)
    expect(Number.isFinite(BAND_MB)).toBe(true)
  })

  it('the meter is OFF today, which is what makes the open gate a bug', () => {
    expect(billsOrgLibraryStorage(MONTH, undefined)).toBe(false)
    expect(billsOrgLibraryStorage(MONTH, '')).toBe(false)
    // Fail-closed on a malformed value, restated here because the gate now
    // depends on it: `yes` must not open a ceiling.
    expect(billsOrgLibraryStorage(MONTH, 'yes')).toBe(false)
  })
})

describe('THE INVARIANT: gate open past the band ⇒ meter on (AGL-2003)', () => {
  it('refuses org-library bytes past the band while the meter is off', () => {
    const gate = ingress({ collection: 'orgs', configuredStart: undefined })
    expect(gate.allowed).toBe(false)
    expect(gate.status).toBe(403)
    expect(gate.code).toBe('plan_limit_reached')
    // The half that costs money: never report an invoice line for bytes the
    // rollup will drop.
    expect(gate.billed).toBe(false)
    expect(gate.projectedOverageUsd).toBe(0)
  })

  it('OPENS on its own the month the env var names — no code change', () => {
    // The positive control for the test above, same org, same bytes, same
    // scope. If this ever fails the fix has become a permanent ban on selling
    // org-library storage, which is the opposite mistake.
    const gate = ingress({ collection: 'orgs', configuredStart: MONTH })
    expect(gate.allowed).toBe(true)
    expect(gate.billed).toBe(true)
    expect(gate.projectedOverageUsd).toBeGreaterThan(0)
  })

  it('stays shut for the months BEFORE the named start month', () => {
    const before = ingress({
      collection: 'orgs',
      month: EARLIER,
      configuredStart: MONTH,
    })
    expect(before.allowed).toBe(false)
    expect(before.billed).toBe(false)
    // And opens at the boundary itself, so the comparison is `>=` and not `>`.
    expect(ingress({ collection: 'orgs', month: MONTH, configuredStart: MONTH }).allowed).toBe(true)
  })

  it('leaves SITE media untouched in both settings of the switch', () => {
    // Site media has been in `billedEstimate` since it existed. If closing the
    // org-library ceiling also closed this one, the fix would have taken
    // revenue that was actually being collected.
    for (const configuredStart of [undefined, MONTH, 'yes', '']) {
      const gate = ingress({ collection: 'hosts', configuredStart })
      expect(gate.allowed).toBe(true)
      expect(gate.billed).toBe(true)
    }
  })

  it('under the band, the scope makes no difference at all', () => {
    // The pairing governs the OVERAGE ceiling only. Bytes inside the included
    // allowance are paid for by the subscription and must land either way,
    // or the fix would have hard-capped the org library at nothing.
    for (const collection of ['orgs', 'hosts'] as const) {
      const gate = ingress({
        collection,
        configuredStart: undefined,
        usedMb: BAND_MB - 1,
      })
      expect(gate.allowed).toBe(true)
      expect(gate.billed).toBe(false)
    }
  })

  it('the invariant holds as a PROPERTY, swept over the whole matrix', () => {
    // Stated as the implication the issue asked for, rather than as a list of
    // cases: if the gate admits bytes past the band, the meter behind that
    // scope must be on for the month being billed.
    const starts = [undefined, null, '', 'yes', '2026-08', '2026-09', '2026-10']
    const months = ['2026-08', '2026-09', '2026-10']
    let admittedPastBand = 0
    for (const collection of ['orgs', 'hosts'] as const) {
      for (const configuredStart of starts) {
        for (const month of months) {
          const gate = ingress({ collection, month, configuredStart })
          if (!gate.allowed) continue
          admittedPastBand += 1
          const metered =
            collection === 'hosts' ||
            billsOrgLibraryStorage(month, configuredStart)
          expect(metered).toBe(true)
          expect(gate.billed).toBe(true)
        }
      }
    }
    // A sweep that admitted nothing would satisfy the implication vacuously.
    expect(admittedPastBand).toBeGreaterThan(0)
  })
})

describe('scopeBillsStorageOverage reads the switch it claims to read', () => {
  it('is true for site media unconditionally', () => {
    expect(scopeBillsStorageOverage('hosts', MONTH, undefined)).toBe(true)
  })

  it('tracks billsOrgLibraryStorage exactly for the org library', () => {
    for (const start of [undefined, '', 'yes', '2026-08', '2026-09']) {
      expect(scopeBillsStorageOverage('orgs', MONTH, start)).toBe(
        billsOrgLibraryStorage(MONTH, start),
      )
    }
  })

  it('reads process.env when the caller passes no explicit start', () => {
    // The default is a default PARAMETER, evaluated per call, so a var set
    // after module load still takes effect. A module-scope const would read
    // `undefined` forever and this gate would be permanently shut.
    const previous = process.env.BILL_ORG_LIBRARY_STORAGE_FROM
    try {
      delete process.env.BILL_ORG_LIBRARY_STORAGE_FROM
      expect(scopeBillsStorageOverage('orgs', MONTH)).toBe(false)
      process.env.BILL_ORG_LIBRARY_STORAGE_FROM = MONTH
      expect(scopeBillsStorageOverage('orgs', MONTH)).toBe(true)
    } finally {
      if (previous === undefined) delete process.env.BILL_ORG_LIBRARY_STORAGE_FROM
      else process.env.BILL_ORG_LIBRARY_STORAGE_FROM = previous
    }
  })

  it('an unknown scope bills, so a new library must opt IN to the ceiling', () => {
    // Deliberate: only `orgs` is known to be excluded from the rollup. A scope
    // nobody has classified must not silently inherit a closed ceiling and
    // start refusing paying customers.
    expect(scopeBillsStorageOverage('datasets' as any, MONTH, undefined)).toBe(true)
    expect(scopeBillsStorageOverage(null, MONTH, undefined)).toBe(true)
  })
})

describe('every ingress door passes the pairing (AGL-2003)', () => {
  it('no media route calls mediaStorageGate without a billsOverage', () => {
    // `billsOverage` defaults to TRUE, and must: every existing caller relies
    // on that default, and flipping it would refuse all storage overage on the
    // platform. That makes the default fail-OPEN, so the type system cannot be
    // the enforcement — this sweep is. A route added later that forgets the
    // field reopens exactly the ceiling AGL-2003 closed, and nothing else
    // would say so.
    //
    // Same shape as the `allowanceMb` sweep in
    // `free-tier-org-library-shares-the-band.spec.ts`, deliberately: the two
    // fields fail the same way and should fail the same guard.
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
      // Slice from the call to its closing `})` so this reads the ARGUMENTS,
      // not merely the name.
      let index = source.indexOf('mediaStorageGate({')
      while (index !== -1) {
        const end = source.indexOf('})', index)
        callSites.push(`${file}:${source.slice(index, end)}`)
        index = source.indexOf('mediaStorageGate({', index + 1)
      }
    }
    // Fails if a door is added and left unpaired, and fails if the doors
    // vanish — a zero-length sweep must not read as compliance.
    expect(callSites.length).toBe(4)
    for (const site of callSites) {
      expect(site).toContain('billsOverage')
      // The scope, not a hardcoded literal: a route that passed `true` would
      // satisfy the line above while reinstating the bug.
      expect(site).toContain('scopeBillsStorageOverage(scope.collection)')
    }
  })
})
