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
 * A workspace answers once; a site may answer for itself.
 *
 * The failure this guards is quiet in both directions. A site that fails to
 * inherit keeps running an old workspace value nobody can see any more; a site
 * whose override is silently discarded runs the workspace's value while its
 * own console shows the operator the number they typed. Neither errors, and
 * neither is visible from the page it affects.
 */

import {
  pluginConfigOverrides,
  resolvePluginConfig,
  type PluginConfigSchema,
} from './plugin-config'

const schema: PluginConfigSchema = {
  pluginId: 'bookings',
  fields: [
    { key: 'horizonDays', label: 'Booking horizon', type: 'number', min: 1, max: 365 },
    { key: 'requireDeposit', label: 'Require a deposit', type: 'boolean' },
    { key: 'timeZone', label: 'Time zone', type: 'string' },
  ],
  defaults: { horizonDays: 60, requireDeposit: false, timeZone: 'UTC' },
}

describe('what a site runs with', () => {
  it('THE CONTROL: the schema defaults, when nobody has answered', () => {
    // Every layering case below is only worth something because this proves
    // the bottom layer is reached at all.
    expect(resolvePluginConfig(schema, {})).toEqual({
      horizonDays: 60,
      requireDeposit: false,
      timeZone: 'UTC',
    })
  })

  it('the workspace value, for a site that overrides nothing', () => {
    expect(
      resolvePluginConfig(schema, { org: { horizonDays: 90 }, host: null }),
    ).toMatchObject({ horizonDays: 90 })
  })

  it('the site value where it has one, the workspace value everywhere else', () => {
    /*
     * The whole point: a chain sets one horizon and the flagship branch takes
     * bookings further out, without restating every other setting. A model
     * that made a site override the whole document would have the branch
     * silently revert to schema defaults for the fields it did not mention.
     */
    expect(
      resolvePluginConfig(schema, {
        org: { horizonDays: 90, requireDeposit: true, timeZone: 'America/Chicago' },
        host: { horizonDays: 365 },
      }),
    ).toEqual({
      horizonDays: 365,
      requireDeposit: true,
      timeZone: 'America/Chicago',
    })
  })

  it('a later workspace change reaches every site that did not override', () => {
    // The reason inheritance is worth having at all. Asserted as a change
    // rather than a single read, because "inherits" means it keeps following.
    const host = { requireDeposit: true }
    expect(
      resolvePluginConfig(schema, { org: { horizonDays: 30 }, host }),
    ).toMatchObject({ horizonDays: 30 })
    expect(
      resolvePluginConfig(schema, { org: { horizonDays: 120 }, host }),
    ).toMatchObject({ horizonDays: 120, requireDeposit: true })
  })

  it('a site override may be falsy, and still an override', () => {
    /*
     * `0`, `false` and `''` are the values a truthiness test loses. A site
     * that switched deposits OFF against a workspace that requires them is
     * exactly the override an operator would most notice failing, and it is
     * the one a `host[key] || org[key]` resolver would drop.
     */
    expect(
      resolvePluginConfig(schema, {
        org: { requireDeposit: true, timeZone: 'America/Chicago' },
        host: { requireDeposit: false, timeZone: '' },
      }),
    ).toMatchObject({ requireDeposit: false, timeZone: '' })
  })
})

describe('a malformed site value', () => {
  it('falls back to the WORKSPACE value, not past it to the default', () => {
    /*
     * The direction that matters. Coercing per level would have a junk site
     * value skip the workspace answer entirely and land on the schema default
     * — so one bad override silently discards a value the operator can see
     * and believes is in force everywhere.
     */
    expect(
      resolvePluginConfig(schema, {
        org: { horizonDays: 90 },
        host: { horizonDays: 'soon' },
      }),
    ).toMatchObject({ horizonDays: 90 })
  })

  it('is still clamped to the field bounds when it is the right type', () => {
    expect(
      resolvePluginConfig(schema, { org: { horizonDays: 90 }, host: { horizonDays: 9000 } }),
    ).toMatchObject({ horizonDays: 365 })
  })

  it('ignores keys the schema does not declare', () => {
    // A field a plugin update removed must not reappear as config, from
    // either level.
    expect(
      resolvePluginConfig(schema, {
        org: { retired: 'x' },
        host: { alsoRetired: 'y' },
      }),
    ).toEqual({ horizonDays: 60, requireDeposit: false, timeZone: 'UTC' })
  })
})

describe('which fields a site is answering for itself', () => {
  it('THE CONTROL: none, for a site with no document', () => {
    expect(pluginConfigOverrides(schema, null)).toEqual([])
    expect(pluginConfigOverrides(schema, {})).toEqual([])
  })

  it('names exactly the keys present on the site document', () => {
    expect(pluginConfigOverrides(schema, { horizonDays: 365 })).toEqual([
      'horizonDays',
    ])
  })

  it('treats `undefined` as absent, so clearing an override is one behavior', () => {
    /*
     * A UI that writes `{key: undefined}` to mean "stop overriding" and one
     * that never wrote the key are doing the same thing. Distinguishing them
     * would make "revert to the workspace value" depend on which code path
     * cleared it.
     *
     * ⚠️ It does NOT follow that writing undefined clears a STORED override:
     * `setDoc(…, {merge: true})` leaves an omitted field exactly as it is, so
     * a form that drops empty inputs cannot clear anything by saving. Only a
     * field delete returns a key to inherited — this function describes what
     * a document means, not what a save does to it.
     */
    expect(pluginConfigOverrides(schema, { horizonDays: undefined })).toEqual([])
    expect(
      resolvePluginConfig(schema, {
        org: { horizonDays: 90 },
        host: { horizonDays: undefined },
      }),
    ).toMatchObject({ horizonDays: 90 })
  })

  it('does not count a stale key the schema no longer declares', () => {
    expect(pluginConfigOverrides(schema, { retired: 'x', horizonDays: 7 })).toEqual([
      'horizonDays',
    ])
  })
})
