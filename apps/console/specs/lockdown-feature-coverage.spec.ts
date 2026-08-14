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

interface Chokepoint {
  feature: string
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
    file: 'apps/console/app/api/admin/lockdown/route.ts',
    wiring: ['featureLockdownDocId(targetId)', 'invalidateFeatureLockdownCache()'],
    why: 'the audited writer covers the feature scope and drops the TTL cache',
  },
  {
    feature: '(staff surface)',
    file: 'apps/console/app/(app)/admin/lockdown/page.tsx',
    wiring: ['LOCKDOWN_FEATURE_KEYS'],
    why: 'the checklist renders FROM the enum — a new key arrives on the page by existing',
  },
]

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
