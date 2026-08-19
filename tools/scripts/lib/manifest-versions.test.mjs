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

/**
 * Pins the manifest-version drift check (AGL-2108).
 *
 *   node --test tools/scripts/lib/manifest-versions.test.mjs
 *
 * The drift this exists for went unnoticed for a whole release because every
 * check that COULD have read it read something else instead. So the cases
 * below are written from the direction of "what would make this check green
 * over a real drift": a half-repaired lockfile with only the top-level field
 * fixed, and a manifest that carries no version at all.
 */

import { strict as assert } from 'node:assert'
import { describe, it } from 'node:test'

import {
  evaluateManifestVersions,
  formatManifestVersionFailure,
} from './manifest-versions.mjs'

const pair = (over = {}) => ({
  dir: '',
  packageJson: { version: '1.0.0-beta.1' },
  lockJson: {
    version: '1.0.0-beta.1',
    packages: { '': { version: '1.0.0-beta.1' } },
  },
  ...over,
})

describe('evaluateManifestVersions', () => {
  it('passes when both lockfile fields match', () => {
    const result = evaluateManifestVersions([pair()])
    assert.equal(result.ok, true)
    assert.equal(result.drifts.length, 0)
    assert.equal(result.checked, 1)
  })

  it('catches the real AGL-2108 shape: both fields left on the old version', () => {
    const result = evaluateManifestVersions([
      pair({
        lockJson: {
          version: '1.0.0-alpha.0',
          packages: { '': { version: '1.0.0-alpha.0' } },
        },
      }),
    ])
    assert.equal(result.ok, false)
    assert.equal(result.drifts.length, 2)
    assert.deepEqual(
      result.drifts.map((d) => d.field),
      ['version', 'packages[""].version'],
    )
  })

  it('catches a HALF-repaired lockfile — the top-level field alone is not the version', () => {
    // npm writes it in two places. A check reading only the first would pass
    // the repair somebody reaches for by hand, which is the same class of
    // green-over-a-drift this file exists to end.
    const result = evaluateManifestVersions([
      pair({
        lockJson: {
          version: '1.0.0-beta.1',
          packages: { '': { version: '1.0.0-alpha.0' } },
        },
      }),
    ])
    assert.equal(result.ok, false)
    assert.equal(result.drifts.length, 1)
    assert.equal(result.drifts[0].field, 'packages[""].version')
  })

  it('a manifest with no version at all is not drift', () => {
    // `cloud/functions` has never carried one. Inventing an expectation for it
    // would fail a shape that is deliberate — and a check that fails on
    // correct input gets disabled, not fixed.
    const result = evaluateManifestVersions([
      { dir: 'cloud/functions', packageJson: {}, lockJson: {} },
    ])
    assert.equal(result.ok, true)
  })

  it('names the directory, both values and the repair', () => {
    const message = formatManifestVersionFailure(
      evaluateManifestVersions([
        pair({
          dir: 'apps/docs',
          lockJson: { version: '0.0.0', packages: {} },
        }),
      ]),
    )
    assert.match(message, /apps\/docs\/package-lock\.json/)
    assert.match(message, /1\.0\.0-beta\.1/)
    assert.match(message, /0\.0\.0/)
    assert.match(message, /--package-lock-only/)
  })
})
