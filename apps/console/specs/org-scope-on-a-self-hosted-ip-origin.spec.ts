/**
 * @jest-environment jsdom
 * @jest-environment-options {"url": "http://192.168.1.10:4200/acme/hosts"}
 */

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
 * A self-hosted console reached by IP names no workspace by its host
 * (AGL-3295).
 *
 * The org scope read the first label of any host outside a short Aglyn-shaped
 * list as a workspace, so on `192.168.1.10` it looked up a workspace called
 * `192`, found none, and `OrgGuard` 404'd every organization page on the
 * confirmed miss. The read is now the middleware's rule, and this file boots
 * jsdom on the IP origin to prove it — `window.location` cannot be faked from
 * inside a test (see `console-domain-auth-persistence-custom-host.spec.ts`).
 *
 * The docblock order is load-bearing: the environment pragma has to be in the
 * FIRST docblock, or the license header shadows it and the file silently runs
 * on `localhost`.
 */

import {
  currentWorkspaceSlug,
  workspaceSlugFromHost,
} from '../constants/workspace-domain'

describe('on a self-hosted console reached by IP address', () => {
  it('boots jsdom on the IP origin — the premise of the case below', () => {
    // Asserted, not assumed: on `localhost` the case below would pass for a
    // reason that has nothing to do with the fix.
    expect(window.location.host).toBe('192.168.1.10:4200')
  })

  it('names no workspace from the host, so OrgGuard has no miss to 404 on', () => {
    expect(currentWorkspaceSlug()).toBeNull()
  })

  it('still names one on a workspace subdomain — the rule is not "never"', () => {
    expect(workspaceSlugFromHost('acme.aglyn.com')).toBe('acme')
  })
})
