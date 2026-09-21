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

import {
  capturePluginContact,
  pluginContactCaptureWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'

/**
 * SOMEBODY KEEPS PEOPLE IN THIS APP'S SERVER PROCESSES (AGL-3080).
 *
 * Four silos meet a person and none of them is the record system: a form
 * submission, a member signing up, an order, a booking. They hand the capture
 * to a contract, and `capturePluginContact` answers `null` when no plugin
 * keeps people — which means "this workspace has no record system", a
 * sentence that is FALSE and SILENT if the registration simply did not run.
 * Orders would stop creating contacts with nothing red anywhere.
 *
 * Two of those silos are Stripe webhooks, which have no reason to load the
 * CRM. That is why the writer is a server DECLARATION, registered at boot in
 * every process, rather than something a plugin surface registers when it
 * happens to load — and this is the spec that finds out if boot stopped
 * doing it.
 *
 * ⚑ It runs THIS APP'S OWN boot manifest, reached the way the app reaches it,
 * and never imports the plugin: an app may not depend on a plugin, and a
 * dynamic first-party import here would register a lazy nx graph edge that
 * breaks every static import of that library in other projects (AGL-2282).
 *
 * ⛔ THE BOOT IS RUN ONCE AND THE ANSWERS ARE CAPTURED AROUND IT, rather than
 * reset per test. Two things make anything else wrong: the manifest MEMOIZES,
 * so a reset between tests leaves later ones asserting against a boot that
 * will never run again; and `jest.resetModules()` gives the re-required
 * plugin a DIFFERENT copy of the registry from the one this file reads, so
 * the registration lands somewhere nothing can see. Both pass in isolation
 * and fail in the full suite, which is how this spec first failed.
 */

import { registerPluginServerDeclarations } from '../utils/plugins.declarations.server.generated'

/** The writer before boot and after it — the whole question, captured once. */
let before: ReturnType<typeof pluginContactCaptureWriter>
let after: ReturnType<typeof pluginContactCaptureWriter>
let captureBeforeBoot: Awaited<ReturnType<typeof capturePluginContact>>

beforeAll(async () => {
  resetPluginServicesForTests()
  before = pluginContactCaptureWriter()
  captureBeforeBoot = await capturePluginContact({
    orgId: 'org-1',
    hostId: 'host-1',
    identity: { email: 'a@b.test' },
    interaction: { source: 'form' },
  })
  await registerPluginServerDeclarations()
  after = pluginContactCaptureWriter()
})

describe('the plugin that keeps people, in this app', () => {
  it('THE CONTROL: with boot not run, nothing keeps people', () => {
    /*
     * Everything below would pass against a boot that registered nothing if
     * the registry happened to be filled already. `null` is also the exact
     * production symptom this spec exists for: `capturePluginContact`
     * defines it as "this workspace has no record system", which would be
     * false and silent.
     */
    expect(before).toBeNull()
    expect(captureBeforeBoot).toBeNull()
  })

  it('registers a writer at boot, and it is the CRM', () => {
    expect(after?.pluginId).toBe('crm')
  })

  it('registers something that can actually take a capture', () => {
    expect(typeof after?.writer.capture).toBe('function')
  })
})
