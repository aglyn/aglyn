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
 * THE CRM'S BOOT DECLARATION (AGL-3080).
 *
 * It registers in EVERY server process of both apps, including ones that will
 * never touch the CRM — a Stripe webhook, a form submission, a page render.
 * So what it costs at boot has to be one object, and the capture itself has
 * to arrive only when somebody captures somebody.
 *
 * The apps hold the other half: that boot actually runs it, and that the
 * contract then answers with this plugin. That question belongs to them,
 * because only an app can reach its own loader.
 */

import {
  pluginContactCaptureWriter,
  registerPluginContactCaptureWriter,
} from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import {
  listPluginLeadConversionListeners,
  resetPluginLeadConversionListenersForTests,
} from '@aglyn/aglyn/plugin-manager/plugin-lead-conversion'
import { resetPluginServicesForTests } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { crmContactCaptureWriter, registerCrmServerDeclarations } from './declarations.server'

const SOURCE = readFileSync(join(__dirname, 'declarations.server.ts'), 'utf8')

/**
 * Every module this file imports STATICALLY, and every one it defers.
 *
 * Matched on `from '…'` rather than on a line beginning `import`, because
 * this file's imports are multi-line: a line-anchored pattern finds none of
 * them and every "does not import X" assertion below then passes for the
 * wrong reason. That is not hypothetical — it is what the first version of
 * this spec did.
 */
const staticImports = [...SOURCE.matchAll(/\bfrom '([^']+)'/g)].map((m) => m[1])
const deferredImports = [...SOURCE.matchAll(/\bimport\('([^']+)'\)/g)].map((m) => m[1])

describe('what the CRM declares at boot', () => {
  beforeEach(() => {
    resetPluginServicesForTests()
    resetPluginLeadConversionListenersForTests()
  })

  it('registers its share of a lead conversion — the campaigns the lead carries — under this plugin (AGL-3254)', () => {
    registerCrmServerDeclarations()
    expect(listPluginLeadConversionListeners()).toEqual(['crm'])
    // Deferred like the capture: the writer and the Admin SDK load with the
    // first conversion, never at boot.
    expect(deferredImports).toContain('./server/lead-campaign-carry')
    expect(deferredImports).toContain('@aglyn/tenant-data-admin/server/firebase-admin')
    expect(staticImports).not.toContain('./server/lead-campaign-carry')
  })

  it('registers the workspace’s contact-capture writer, under this plugin', () => {
    registerCrmServerDeclarations()
    expect(pluginContactCaptureWriter()?.pluginId).toBe('crm')
    expect(pluginContactCaptureWriter()?.writer).toBe(crmContactCaptureWriter)
  })

  it('registering twice replaces in place rather than refusing', () => {
    // Boot runs it, and the plugin's own API registrar runs it again as a
    // backstop for a process whose boot did not. The second must not throw.
    registerCrmServerDeclarations()
    expect(() => registerCrmServerDeclarations()).not.toThrow()
    expect(pluginContactCaptureWriter()?.pluginId).toBe('crm')
  })

  it('a second plugin’s writer is refused, and this one keeps serving', () => {
    // A workspace keeps ONE set of people.
    registerCrmServerDeclarations()
    expect(() =>
      registerPluginContactCaptureWriter(
        { capture: async () => ({ ok: false, reason: 'error', error: 'no' }) },
        { pluginId: 'impostor' },
      ),
    ).toThrow(/crm/)
    expect(pluginContactCaptureWriter()?.pluginId).toBe('crm')
  })
})

describe('what it costs the processes that will never use it', () => {
  it('THE CONTROL: the source was read and its imports were found', () => {
    // A pattern that matches nothing makes every assertion below vacuous.
    expect(SOURCE.length).toBeGreaterThan(500)
    expect(staticImports.length).toBeGreaterThan(1)
    expect(deferredImports.length).toBeGreaterThan(0)
  })

  it('reaches the capture behind an `await import`, never statically', () => {
    /*
     * A static import here would pull the tenant data layer — Firestore, the
     * render cache, `next/cache` — into the boot of every server process in
     * both apps, to register one object. The capture arrives when the first
     * one does.
     */
    expect(deferredImports).toContain('./server/capture-contact')
    expect(staticImports).not.toContain('./server/capture-contact')
    expect(staticImports.some((name) => name.startsWith('@aglyn/tenant-'))).toBe(false)
  })

  it('imports the contract by its own module, not the plugin-manager barrel', () => {
    // The barrel reaches the client contexts; boot needs the registry alone.
    expect(staticImports).toContain('@aglyn/aglyn/plugin-manager/plugin-contact-capture')
    expect(staticImports).not.toContain('@aglyn/aglyn')
  })
})
