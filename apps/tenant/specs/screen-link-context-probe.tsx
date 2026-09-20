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
 * A stand-in for `@aglyn/aglyn-node-renderer` that reports the screen-link
 * context it was rendered under, for suites asking WHICH PROVIDERS a branch
 * renders inside rather than what the canvas draws (AGL-3122).
 *
 * A file of its own, mirroring `site-plugin-loader-empty-manifest`, because a
 * `jest.mock` factory cannot close over an imported binding — it is hoisted
 * above the imports — and `require`ing `@aglyn/aglyn/...` inside the factory
 * instead makes Nx read the whole `aglyn` library as lazy-loaded, which then
 * fails `@nx/enforce-module-boundaries` on every STATIC import of it in the
 * app under test. Requiring this relative file is neither.
 */

import { ScreenLinkContext } from '@aglyn/aglyn/app-utils/screen-link-context-value'
import { useContext } from 'react'

export function AglynNodeRenderer() {
  const value = useContext(ScreenLinkContext)
  return (
    <div
      data-testid="probe"
      data-screens={JSON.stringify(value.screens ?? null)}
    />
  )
}

export default AglynNodeRenderer
