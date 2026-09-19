/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
 *
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

/**
 * How the automation engine comes to hear host events (AGL-3105).
 *
 * The engine lives in this plugin and the doors that raise events mostly do
 * not load it — a form submission and a page view are core routes. So the
 * engine's listener is registered at BOOT, by a function both apps call by
 * name from their generated server-declarations manifest, and the runtime's
 * `emitHostEvent` reaches it through the registry. Every link of that chain is
 * pinned here: the call the manifests make, the registration it performs, and
 * an event arriving at the engine through the runtime's own emit path.
 */

const mockRunEventAutomations = jest.fn(async () => [
  { message: 'welcome', severity: 'info' as const },
])
const mockRunSingleAction = jest.fn(async () => [
  { message: 'dispatched', severity: 'success' as const },
])

// The engine itself is exercised by its own suites; here it only has to be
// the thing the listener loads when an event arrives.
jest.mock('./engine/run-event-automations', () => ({
  __esModule: true,
  runEventAutomations: (...args: unknown[]) =>
    (mockRunEventAutomations as (...a: unknown[]) => unknown)(...args),
}))
jest.mock('./engine/run-event-actions', () => ({
  __esModule: true,
  runSingleAction: (...args: unknown[]) =>
    (mockRunSingleAction as (...a: unknown[]) => unknown)(...args),
}))

import { emitHostEvent } from '@aglyn/tenant-runtime/emit-host-event'
import {
  dispatchHostAutomation,
  listHostEventListeners,
  resetHostEventListenersForTests,
} from '@aglyn/tenant-runtime/host-event-listeners'
import { BUNDLE_ID } from './constants/bundle-common'
import { registerWorkflowsServerDeclarations } from './declarations.server'

const REPO_ROOT = join(__dirname, '../../../../..')

beforeEach(() => {
  resetHostEventListenersForTests()
  mockRunEventAutomations.mockClear()
  mockRunSingleAction.mockClear()
})

describe('the server declarations', () => {
  it('register the engine as a host-event listener', () => {
    registerWorkflowsServerDeclarations()
    expect(listHostEventListeners()).toEqual([BUNDLE_ID])
  })

  it('leave one listener however often they run', () => {
    registerWorkflowsServerDeclarations()
    registerWorkflowsServerDeclarations()
    expect(listHostEventListeners()).toEqual([BUNDLE_ID])
  })

  it('carry an event raised by the runtime to the engine, and its alerts back', async () => {
    registerWorkflowsServerDeclarations()

    const { alerts } = await emitHostEvent('site-1', 'formSubmission', {
      email: 'ada@example.com',
    })

    expect(mockRunEventAutomations).toHaveBeenCalledWith(
      'site-1',
      'formSubmission',
      { email: 'ada@example.com' },
    )
    expect(alerts).toEqual([{ message: 'welcome', severity: 'info' }])
  })

  it('carry a page-dispatched automation to the action runner', async () => {
    registerWorkflowsServerDeclarations()

    await expect(
      dispatchHostAutomation('site-1', 'action-1', 'exitIntent', { path: '/' }),
    ).resolves.toEqual([{ message: 'dispatched', severity: 'success' }])
    expect(mockRunSingleAction).toHaveBeenCalledWith(
      'site-1',
      'action-1',
      'exitIntent',
      { path: '/' },
    )
  })
})

describe('the apps', () => {
  /*
   * The registration only exists in a running app if the app CALLS it, by
   * name, from the manifest `instrumentation.ts` runs at boot. A bare import
   * of the module would be dropped by the bundler (AGL-3025), so the call is
   * what has to be there — in both apps, because both raise host events.
   */
  it.each([
    'apps/tenant/utils/plugins.declarations.server.generated.ts',
    'apps/console/constants/plugins.declarations.server.generated.ts',
  ])('%s calls the declarations by name at boot', (manifest) => {
    const source = readFileSync(join(REPO_ROOT, manifest), 'utf8')
    expect(source).toContain(
      "(await import('@aglyn/plugins-workflows/declarations.server')).registerWorkflowsServerDeclarations()",
    )
  })
})
