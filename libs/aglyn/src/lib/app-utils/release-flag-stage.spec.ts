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
 * Per-feature release stage (AGL-4052): a released feature still changing
 * reads Beta, and nothing else does.
 */

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  BETA_STAGED_RELEASE_FLAG_KEYS,
  isBetaStaged,
  isReleaseFlagStage,
  RELEASE_FLAG_STAGES,
  RELEASE_FLAGS,
  releaseFlagStage,
  releaseStageOfSurface,
  showsBetaStage,
  type ReleaseFlagKey,
} from './release-flags'

describe('release flag stage (AGL-4052)', () => {
  it('stages the generative doors, Bring my site and the assistant as beta', () => {
    expect(releaseFlagStage('release_ai_generative')).toBe('beta')
    expect(releaseFlagStage('release_assist')).toBe('beta')
    expect(releaseFlagStage('release_ai_site_import')).toBe('beta')
    expect(isBetaStaged('release_assist')).toBe(true)
  })

  it('leaves generally available features without a stage', () => {
    for (const key of [
      'release_crm',
      'release_workflows',
      'release_marketplace',
      'release_bookings',
      'release_native_checkout',
      'release_edit_bar',
    ] as ReleaseFlagKey[]) {
      expect([key, releaseFlagStage(key)]).toEqual([key, undefined])
    }
  })

  it('stages no flag that ships off', () => {
    // An off flag is rolling out, not in beta. A stage on one would say
    // nothing anywhere today and would label the feature the moment it is
    // switched on, before anyone decided that it is still changing.
    const offAndStaged = RELEASE_FLAGS.filter(
      (flag) => !flag.defaultEnabled && flag.stage !== undefined,
    ).map((flag) => flag.key)
    expect(offAndStaged).toEqual([])
  })

  it('declares only known stages', () => {
    for (const flag of RELEASE_FLAGS) {
      if (flag.stage === undefined) continue
      expect([flag.key, isReleaseFlagStage(flag.stage)]).toEqual([
        flag.key,
        true,
      ])
    }
    expect(isReleaseFlagStage('beta')).toBe(true)
    expect(isReleaseFlagStage('alpha')).toBe(false)
    expect(isReleaseFlagStage(undefined)).toBe(false)
  })

  it('lists the beta-staged keys in registry order', () => {
    expect(BETA_STAGED_RELEASE_FLAG_KEYS).toEqual(
      RELEASE_FLAGS.filter((flag) => flag.stage === 'beta').map(
        (flag) => flag.key,
      ),
    )
    expect(BETA_STAGED_RELEASE_FLAG_KEYS).toEqual(
      expect.arrayContaining(['release_assist', 'release_ai_generative']),
    )
  })

  it('shows Beta only for a released, beta-staged flag', () => {
    expect(showsBetaStage('release_assist', true)).toBe(true)
    // Off for this workspace: a staff preview of a rolling-out feature.
    expect(showsBetaStage('release_assist', false)).toBe(false)
    expect(showsBetaStage('release_assist', undefined)).toBe(false)
    // Released and generally available.
    expect(showsBetaStage('release_crm', true)).toBe(false)
    // No flag at all.
    expect(showsBetaStage(undefined, true)).toBe(false)
    expect(showsBetaStage(null, true)).toBe(false)
  })

  it('stages a surface from whichever governing flag is released and beta', () => {
    const on = { released: true }
    const off = { released: false }
    expect(releaseStageOfSurface(['release_assist'], { release_assist: on })).toBe('beta')
    expect(releaseStageOfSurface(['release_assist'], { release_assist: off })).toBeUndefined()
    // A generally available hub with a beta section reads Beta on that section.
    expect(
      releaseStageOfSurface(['release_crm', 'release_ai_generative'], {
        release_crm: on,
        release_ai_generative: on,
      }),
    ).toBe('beta')
    expect(
      releaseStageOfSurface(['release_crm', undefined], { release_crm: on }),
    ).toBeUndefined()
    // No verdict yet reads as not released.
    expect(releaseStageOfSurface(['release_assist'], {})).toBeUndefined()
    expect(releaseStageOfSurface([], {})).toBeUndefined()
  })

  it('agrees with the stages the plugin manifest generator accepts', () => {
    // The generator is plain node and cannot import this module, so it
    // spells the list out; a stage added here and not there would be refused
    // on a plugin's catalog row.
    const generator = readFileSync(
      join(__dirname, '../../../../../tools/scripts/generate-plugin-manifests.mjs'),
      'utf8',
    )
    const declared = generator.match(/const RELEASE_FLAG_STAGES = (\[[^\]]*\])/)
    expect(declared).not.toBeNull()
    expect(JSON.parse((declared?.[1] ?? '[]').replace(/'/g, '"'))).toEqual([
      ...RELEASE_FLAG_STAGES,
    ])
  })
})
