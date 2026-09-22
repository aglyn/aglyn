/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from the opening docblock, so a license header above it silently leaves the
 * suite on jsdom.
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

/**
 * This app hands its boot step to the capture doors (AGL-3080).
 *
 * `register()` catches a failed declarations boot on purpose — a declaration
 * that will not load must not cost every route — and the cost of that catch
 * is a process where `capturePluginContact` answers `null` for every door,
 * no contact is ever written, and nothing is red. `recordCapturedContact`
 * repairs it by running the boot step again, and core cannot reach that step
 * itself: the manifest names every plugin, which is the one import core may
 * not make. So this app offers it, and what could silently stop being true
 * is that it still does.
 *
 * The behaviour of the wrapper is held in core, next to it
 * (`record-captured-contact.spec.ts`). What is here is the wiring, in the
 * exact shape that needs it: a boot whose declarations threw.
 */

export {}

let mockBootAttempts = 0
/** Whether this attempt at the boot step blows up, as a bad boot does. */
let mockBootThrows = false

/*
 * The registrar comes off the STATIC import below, through a hoisted helper.
 * A factory cannot close over an import, and deferring `@aglyn/aglyn` here
 * would register a dynamic nx graph edge that forbids every static import of
 * core in every project that reaches it (AGL-2282).
 */
jest.mock('../utils/plugins.declarations.server.generated', () => ({
  __esModule: true,
  registerPluginServerDeclarations: async () => {
    mockBootAttempts += 1
    if (mockBootThrows) throw new Error('a declaration module would not load')
    mockKeepsPeople()
  },
}))

/** The plugin that keeps people, as the boot step registers it. */
function mockKeepsPeople(): void {
  registerPluginContactCaptureWriter(
    { capture: async () => ({ ok: true, record: 'contact', contactId: 'c1', created: true }) },
    { pluginId: 'crm' },
  )
}

// The rest of `register()` is not what is under test, and both of these reach
// firebase-admin.
jest.mock('../utils/live-page-dropper', () => ({
  __esModule: true,
  registerLivePageDropping: () => undefined,
}))
jest.mock('../utils/boot-warmup', () => ({
  __esModule: true,
  warmFirestoreAtBoot: () => undefined,
}))

import { registerPluginContactCaptureWriter } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import {
  recordCapturedContact,
  resetPluginDeclarationsRepairForTests,
} from '@aglyn/aglyn/plugin-manager/record-captured-contact'
import { register } from '../instrumentation'

const REQUEST = {
  orgId: 'org-1',
  hostId: 'host-1',
  identity: { email: 'a@b.test' },
  interaction: { source: 'form' },
}

const NODE_RUNTIME = process.env.NEXT_RUNTIME

beforeEach(() => {
  process.env.NEXT_RUNTIME = 'nodejs'
  resetPluginServicesForTests()
  resetPluginDeclarationsRepairForTests()
  mockBootAttempts = 0
  mockBootThrows = false
  jest.spyOn(console, 'warn').mockImplementation(() => undefined)
  jest.spyOn(console, 'error').mockImplementation(() => undefined)
})

afterEach(() => {
  jest.restoreAllMocks()
  if (NODE_RUNTIME === undefined) delete process.env.NEXT_RUNTIME
  else process.env.NEXT_RUNTIME = NODE_RUNTIME
})

describe('a capture in this app reaches a writer', () => {
  it('repairs a boot whose declarations threw', async () => {
    mockBootThrows = true
    await register()
    expect(mockBootAttempts).toBe(1)
    // What production looks like at this point: the instance is serving, the
    // failure is one line in a log, and nobody keeps people.
    expect(console.error).toHaveBeenCalledWith(
      '[instrumentation] plugin declarations failed',
      expect.any(Error),
    )

    mockBootThrows = false
    const verdict = await recordCapturedContact(REQUEST)

    expect(mockBootAttempts).toBe(2)
    expect(verdict).toEqual({ ok: true, record: 'contact', contactId: 'c1', created: true })
  })

  it('does not run the boot step again for a process that booted', async () => {
    await register()
    expect(mockBootAttempts).toBe(1)

    expect(await recordCapturedContact(REQUEST)).toEqual({
      ok: true,
      record: 'contact',
      contactId: 'c1',
      created: true,
    })
    expect(mockBootAttempts).toBe(1)
  })
})
