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

import * as Aglyn from '@aglyn/aglyn'
import * as PluginSdk from '@aglyn/aglyn'
import { BUNDLE_ID } from './constants/bundle-common'
import { COMMERCE_BUNDLE, registerCommercePlugin } from './plugin'

describe('commerce plugin', () => {
  it('registers once as a mui-dependent bundle', () => {
    registerCommercePlugin()
    const bundle = Aglyn.plugins.getDependency(BUNDLE_ID)
    expect(bundle?.$id).toBe(BUNDLE_ID)
    expect(bundle?.dependencies).toMatchObject({ [PluginSdk.MUI_BUNDLE_ID]: true })
    // Idempotent: a second call is a no-op, not a duplicate.
    registerCommercePlugin()
    expect(Aglyn.plugins.getDependency(BUNDLE_ID)).toBe(bundle)
  })

  it('keeps every bundled component id unique and stable-looking', () => {
    const ids = COMMERCE_BUNDLE.map((entry) => entry.schema.$id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) {
      expect(id).toMatch(/^[a-z0-9-]+$/)
    }
  })
})
