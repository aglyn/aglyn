/**
 * @jest-environment node
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
 * THIS PLUGIN OWNS THE ARTIFACTS BUCKET'S DOCUMENTS, FROM BOOT (AGL-3080).
 *
 * ⛔ THE REGISTRATION IS THE WHOLE RISK, and it fails in the safe direction
 * only because something makes the absence loud. The console's two weekly
 * sweeps refuse outright when nothing is registered — see
 * `plugin-artifact-inventory.spec.ts` for that half — so a boot that never
 * reached here does not delete the bucket; it stops the reaper and the
 * re-verifier every Monday with a 507 nobody is watching for.
 *
 * So this drives the REAL `registerMarketplaceConsoleApi()` — the surface
 * the routes load with `ensureAll(['consoleApi'])` — and asserts the
 * capability answers afterwards. The contract's own behaviour is held in
 * core, beside the contract.
 *
 * ⚑ `@jest-environment node`, and it is not optional: the registration
 * surface reaches a handler that imports `next/server`, whose `NextRequest`
 * extends the global `Request` — which jsdom does not have, so the suite
 * dies at import with "Class extends value undefined" and never runs a case.
 */

export {}

/*
 * Every export of the admin package, stubbed by shape rather than by name.
 *
 * `../server` is the registration surface, so importing it drags in every
 * handler the marketplace has, and each one names a different set of admin
 * helpers — one of which is extended as a base class. Listing them would
 * make this file a maintenance tax on unrelated work, and the thing under
 * test touches none of them: nothing here calls a handler, it only registers
 * them.
 */
jest.mock('@aglyn/tenant-data-admin', () => {
  const stub: unknown = new Proxy(function stubbed() {} as never, {
    get: (_target, key) =>
      key === '__esModule' ? true : key === 'default' ? stub : stub,
    apply: () => stub,
    construct: () => ({}),
  })
  return stub
})

import { hasPluginArtifactInventory } from '@aglyn/aglyn/plugin-manager/plugin-artifact-inventory'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { registerMarketplaceConsoleApi } from '../server'

beforeEach(() => {
  resetPluginServicesForTests()
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
})

describe('the marketplace owns the stored artifacts', () => {
  it('CONTROL: nothing owns them before the surface registers', () => {
    // Without this the case below would pass against a registry another
    // suite had filled, which is the one way this guard is green and means
    // nothing.
    expect(hasPluginArtifactInventory()).toBe(false)
  })

  it('and owns them once the consoleApi surface has registered', () => {
    registerMarketplaceConsoleApi()
    expect(hasPluginArtifactInventory()).toBe(true)
  })
})
