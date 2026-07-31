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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseReleaseFlagValue, RELEASE_FLAGS } from './release-flags'

/**
 * A release flag lives in two places that must agree, and nothing checked
 * that they did (AGL-1132).
 *
 * `ReleaseFlagDefinition.defaultEnabled` documents itself as the fallback
 * "when Remote Config is unreachable", and says it MUST match the seeded
 * value in the template — because an environment with no published template
 * behaves according to the code default, and one with a template behaves
 * according to the template. If those disagree, the same build ships a
 * feature on in one environment and off in another, and neither is wrong
 * enough to look like a bug.
 *
 * A flag missing from the template entirely is the worse case: it reads as
 * its code default forever and the staff flags editor has nothing to toggle.
 */
const template = JSON.parse(
  readFileSync(
    join(__dirname, '..', '..', '..', '..', '..', 'cloud', 'firebase-remoteconfig.template.json'),
    'utf8',
  ),
) as { parameters: Record<string, { defaultValue?: { value?: string } }> }

describe('release flags are seeded in the Remote Config template', () => {
  it.each(RELEASE_FLAGS.map((flag) => [flag.key, flag.defaultEnabled] as const))(
    '%s is seeded and its enabled value matches defaultEnabled',
    (key, defaultEnabled) => {
      const parameter = template.parameters[key]
      expect(parameter).toBeDefined()
      const raw = parameter?.defaultValue?.value
      expect(typeof raw).toBe('string')
      // Through the SAME parser the app uses, not raw JSON.parse. The
      // template is not uniform — `release_commerce_v2` is seeded as a bare
      // `true` rather than an object, which `parseReleaseFlagValue` accepts
      // by design. A stricter check here would fail on a flag that works
      // perfectly, which is a guard that costs more than it earns.
      //
      // `false` is passed as the fallback deliberately: it must not be able
      // to supply the very value under test, or an unparseable seed would
      // silently "match" whatever the code default happened to be.
      expect(parseReleaseFlagValue(raw, false).enabled).toBe(defaultEnabled)
    },
  )

  it('has no template flag that the registry does not declare', () => {
    // The other direction: a seeded `release_*` with no definition is a flag
    // staff can toggle that no code reads, which looks like a broken feature
    // rather than a dead entry.
    const registered = new Set(RELEASE_FLAGS.map((flag) => flag.key))
    const orphaned = Object.keys(template.parameters)
      .filter((key) => key.startsWith('release_'))
      .filter((key) => !registered.has(key as never))
    expect(orphaned).toEqual([])
  })
})
