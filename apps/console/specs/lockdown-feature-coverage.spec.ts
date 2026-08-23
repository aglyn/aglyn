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

import { readFileSync } from 'fs'
import { resolve } from 'path'

/**
 * Every LAUNCH FEATURE of the lockdown feature scope (AGL-1510) is wired at
 * its declared server chokepoint — asserted AT THE DECLARATION, per the
 * `feedback_help_prop_presence_not_correctness` lesson: a generic "some
 * route somewhere calls the helper" check would stay green while the one
 * gate that matters quietly vanished. Each entry below names the feature,
 * the file, and the exact wiring text; unwiring any one of them turns this
 * red NAMING IT.
 *
 * The behavior of each gate has its own proof elsewhere — the refusal
 * helper (composition, staff-bypass map, expiry) in
 * libs/tenant/data/admin/src/lib/server/lockdown.spec.ts, the mint's
 * account-age predicate in session-lockdown-gate.spec.ts, the checkout
 * route's gate-before-Stripe in lockdown-feature-gate.spec.ts. This file
 * is the inventory that keeps the set complete.
 */
const REPO_ROOT = resolve(__dirname, '../../..')
const read = (repoPath: string) =>
  readFileSync(resolve(REPO_ROOT, repoPath), 'utf8')

/**
 * THE ENUM IS THE SOURCE OF TRUTH, AND THIS SPEC NOW DERIVES FROM IT
 * (AGL-2495).
 *
 * The gap the AGL-1621 drill named. Before this, `CHOKEPOINTS` was a
 * hand-maintained inventory and nothing tied it to `LOCKDOWN_FEATURE_KEYS`:
 * adding a key and shipping it unwired turned NOTHING red — while the last
 * entry below asserts the staff page renders its checklist FROM the enum, so
 * the new key appeared immediately as a staff toggle that enforced nothing
 * anywhere. An operator could pull a lever during an incident and watch it do
 * nothing. This file could only ever detect an OLD gate being removed, never
 * a NEW one being omitted — the opposite posture from its 423 sibling, which
 * discovers by walking.
 *
 * Parsed from the source rather than imported, deliberately: this is a
 * source-reading guard, the import would drag the server barrel into the
 * console jest project, and reading the file is what makes the parse itself
 * assertable (see the anti-vacuity test).
 */
const LOCKDOWN_TS = 'libs/aglyn/src/lib/app-utils/lockdown.ts'

export function parseFeatureKeys(source: string): string[] {
  const block = source.match(
    /const LOCKDOWN_FEATURE_KEY_SET: Record<LockdownFeatureKey, true> = \{([\s\S]*?)\n\}/,
  )
  if (!block) return []
  return [...block[1].matchAll(/^\s*'?([\w-]+)'?\s*:\s*true\s*,?\s*$/gm)].map(
    (match) => match[1],
  )
}

const FEATURE_KEYS = parseFeatureKeys(read(LOCKDOWN_TS))

interface Chokepoint {
  feature: string
  /**
   * The `LOCKDOWN_FEATURE_KEYS` entries this chokepoint enforces, when
   * `feature` is not itself one of them (the plugin dispatcher covers three;
   * the writer and the staff surface cover none and say so with `[]`).
   */
  covers?: string[]
  file: string
  /** Every one of these must appear verbatim in the file. */
  wiring: string[]
  why: string
}

const CHOKEPOINTS: Chokepoint[] = [
  {
    feature: 'signups',
    file: 'apps/console/app/api/auth/session/route.ts',
    wiring: [`getFeatureLockdown('signups')`, 'lockdownJsonResponse(signupsLock)'],
    why:
      'the mint is where a brand-new account becomes usable; the lock ' +
      'refuses accounts created since it began and touches nobody else',
  },
  {
    feature: 'signups',
    file: 'apps/console/app/api/auth/legal-acceptance/route.ts',
    wiring: [`featureLockdownRefusal({ feature: 'signups', staff })`],
    why:
      'every acceptance context is a signup door (AGL-1497) — the recorder ' +
      'refuses during a signups lock',
  },
  {
    feature: 'uploads',
    file: 'apps/console/utils/server/media-scope.ts',
    wiring: ['featureLockdownRefusal({', 'feature,'],
    why: 'the one resolver every media mutation passes through composes the gate',
  },
  {
    feature: 'uploads',
    file: 'apps/console/app/api/media/upload/route.ts',
    wiring: [`feature: 'uploads',`],
    why: 'ingress route — new bytes',
  },
  {
    feature: 'uploads',
    file: 'apps/console/app/api/media/upload-url/route.ts',
    wiring: [`feature: 'uploads',`],
    why: 'ingress route — signed-URL uploads are still new bytes',
  },
  {
    feature: 'uploads',
    file: 'apps/console/app/api/media/replace/route.ts',
    wiring: [`feature: 'uploads',`],
    why: 'ingress route — a replace writes a new object under an old id',
  },
  {
    feature: 'checkout',
    file: 'apps/console/app/api/billing/checkout/route.ts',
    wiring: [`feature: 'checkout',`],
    why:
      'refuses NEW Stripe checkout sessions only; the pay-your-way-out ' +
      'surface (subscription/invoices) stays exempt and untouched',
  },
  {
    feature: 'marketplace-installs + ai-assist + checkout (plugin surface)',
    covers: ['marketplace-installs', 'ai-assist', 'checkout'],
    file: 'apps/console/app/api/[...pluginApi]/route.ts',
    wiring: [
      'lockdownFeaturesForPluginApiPath(path)',
      'featureLockdownRefusal({ feature, staff })',
    ],
    why:
      'the dispatcher owns ai/assist, marketplace/install* and ' +
      'marketplace/checkout; the pure path→feature map is unit-tested in ' +
      'libs/aglyn lockdown.spec.ts',
  },
  {
    feature: '(writer)',
    covers: [],
    file: 'apps/console/app/api/admin/lockdown/route.ts',
    wiring: ['featureLockdownDocId(targetId)', 'invalidateFeatureLockdownCache()'],
    why: 'the audited writer covers the feature scope and drops the TTL cache',
  },
  {
    feature: '(staff surface)',
    covers: [],
    file: 'apps/console/app/(app)/admin/lockdown/page.tsx',
    wiring: ['LOCKDOWN_FEATURE_KEYS'],
    why: 'the checklist renders FROM the enum — a new key arrives on the page by existing',
  },
]

/** Which enum keys the inventory above claims to enforce, flattened. */
const COVERED = new Set(
  CHOKEPOINTS.flatMap((entry) => entry.covers ?? [entry.feature]),
)

describe('AGL-2495 · the inventory is derived from the enum, not hand-kept', () => {
  it('parses the launch set out of the enum — and the parse is proven', () => {
    // ANTI-VACUITY, and the load-bearing one: every assertion below is
    // quantified over FEATURE_KEYS, so a parse that silently returned []
    // would report perfect coverage of nothing. Named keys, not just a
    // count, and a negative case so a regex that matched EVERYTHING is
    // caught too.
    expect(FEATURE_KEYS).toEqual([
      'signups',
      'uploads',
      'checkout',
      'marketplace-installs',
      'ai-assist',
    ])
    expect(parseFeatureKeys('export const nothing = 1')).toEqual([])
  })

  it('fails when a NEW feature key ships without a chokepoint', () => {
    // The whole point of the derivation. `LOCKDOWN_FEATURE_KEYS` is what the
    // staff panic page renders its checklist from, so a key that exists is a
    // lever an operator can pull mid-incident; if nothing enforces it, the
    // lever moves and the capability keeps running. This is the assertion
    // that makes adding the key and adding the gate the same commit.
    const unenforced = FEATURE_KEYS.filter((key) => !COVERED.has(key)).map(
      (key) =>
        `${key} — added to LOCKDOWN_FEATURE_KEYS with no CHOKEPOINTS entry. ` +
        'It is already a toggle on the staff lockdown page and it enforces ' +
        'nothing. Wire the gate at its server chokepoint and add it below ' +
        '(use `covers` if one dispatcher owns several).',
    )
    expect(unenforced).toEqual([])
  })

  it('claims no chokepoint for a feature key that does not exist', () => {
    // The other direction: a `covers` entry naming a key the enum dropped is
    // a stale claim, and stale claims are how an inventory outlives the thing
    // it inventories. `(writer)` and `(staff surface)` opt out with `[]`.
    const phantom = [...COVERED]
      .filter((key) => !key.startsWith('(') && !key.includes('+'))
      .filter((key) => !FEATURE_KEYS.includes(key))
    expect(phantom).toEqual([])
  })

  it('says plainly what this file still CANNOT see', () => {
    // Not a behavioural assertion — a pinned admission, so that nobody reads
    // the derivation above as more than it is (AGL-2495).
    //
    // The derivation closes ONE hole: a key with no entry at all. It does
    // NOT make presence into correctness. Every entry is still
    // `source.includes(text)`, so:
    //
    //  1. a chokepoint entry pointing at a gate that is present but
    //     UNREACHABLE — after the write, behind a dead branch, on a route
    //     nothing calls — passes;
    //  2. the wiring text can be satisfied by a COMMENT or a dead object
    //     literal (`feature: 'uploads',` inside a docblock);
    //  3. a feature enforced at ONE of its three real chokepoints and
    //     omitted at the other two passes, because one entry satisfies the
    //     key.
    //
    // What would actually close those is the 423 sibling's posture applied
    // to features: DISCOVER the mutation surface for each capability —
    // every route that ingests bytes, every route that creates a Stripe
    // session — and require a gate on each, rather than accepting one named
    // file per key. That is a walk this repo does not have, and asserting it
    // here would be pretending. The behavioural proofs that DO exist are
    // named in the header above.
    expect(FEATURE_KEYS.length).toBeGreaterThan(0)
  })
})

describe('AGL-1510 · every launch feature is wired at its declared chokepoint', () => {
  it.each(CHOKEPOINTS)('$feature — $file', ({ feature, file, wiring, why }) => {
    const source = read(file)
    for (const text of wiring) {
      if (!source.includes(text)) {
        throw new Error(
          `UNWIRED feature gate: "${feature}" — ${file} no longer contains ` +
            `${JSON.stringify(text)}. This chokepoint exists because ${why}. ` +
            'Restore the gate or update this inventory WITH the runbook.',
        )
      }
    }
  })

  it('non-interference by declaration: the uploads gate stays OFF the read/organize media routes', () => {
    // An uploads lock stops new bytes, not the library. If one of these
    // grows the feature option, that is a scope decision to make on
    // purpose — in the runbook and the notice copy too, not by drift.
    for (const file of [
      'apps/console/app/api/media/sign/route.ts',
      'apps/console/app/api/media/folders/route.ts',
      'apps/console/app/api/media/references/route.ts',
      'apps/console/app/api/media/restore/route.ts',
    ]) {
      expect(`${file}: ${read(file).includes(`feature: 'uploads'`)}`).toBe(
        `${file}: false`,
      )
    }
  })

  it('the uploads gate never touches tenant media serving (AGL-1515 lane)', () => {
    // Upload enforcement is console-side by design; the CDN delivery path
    // serves EXISTING assets and belongs to the media-serving work.
    const source = read('apps/console/utils/server/media-scope.ts')
    expect(source).not.toContain('serve-media-cdn')
  })
})
