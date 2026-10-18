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

import assert from 'node:assert/strict'
import { test } from 'node:test'

import { bootSources, findBootRegistries, functionBody, stripNoise } from './boot-registries.mjs'

const INSTRUMENTATION = `
import { registerSiteCache } from '@aglyn/aglyn/plugin-manager/site-cache'
export async function register() {
  registerSiteCache({ drop: async () => undefined })
  const { registerPushSenders } = await import('./utils/push')
  registerPushSenders()
}
`

const PUSH = `
import { registerPushSender } from '@aglyn/tenant-data-admin/server/push-switch'
export function registerPushSenders() {
  registerPushSender(async () => undefined)
}
`

const moduleScoped = (name, store) => `
const ${store} = new Map<string, unknown>()
export function ${name}(value: unknown): void {
  ${store}.set('x', value)
}
`

const onGlobal = (name, store) => `
const KEY = Symbol.for('test:${store}')
const scope = globalThis as typeof globalThis & { [KEY]?: Map<string, unknown> }
const ${store}: Map<string, unknown> =
  scope[KEY] ?? (scope[KEY] = new Map())
export function ${name}(value: unknown): void {
  ${store}.set('x', value)
}
`

const tree = (overrides = {}) =>
  new Map(
    Object.entries({
      'apps/console/instrumentation.ts': INSTRUMENTATION,
      'apps/console/utils/push.ts': PUSH,
      'libs/aglyn/src/lib/plugin-manager/site-cache.ts': onGlobal('registerSiteCache', 'caches'),
      'libs/tenant/data/admin/src/lib/server/push-switch.ts': onGlobal('registerPushSender', 'senders'),
      ...overrides,
    }),
  )

test('a tree whose boot registries are all on globalThis is clean', () => {
  assert.deepEqual(findBootRegistries(tree()), [])
})

test('a module-scoped registry the boot fills directly is refused', () => {
  const findings = findBootRegistries(
    tree({
      'libs/aglyn/src/lib/plugin-manager/site-cache.ts': moduleScoped('registerSiteCache', 'caches'),
    }),
  )
  assert.deepEqual(
    findings.map(({ file, name, via }) => ({ file, name, via })),
    [{ file: 'libs/aglyn/src/lib/plugin-manager/site-cache.ts', name: 'caches', via: 'registerSiteCache' }],
  )
})

test('a registry reached through an app file and a register function is refused (AGL-3868)', () => {
  const findings = findBootRegistries(
    tree({
      'libs/tenant/data/admin/src/lib/server/push-switch.ts': `
const senders = new Set<unknown>()
export function registerPushSender(sender: unknown) {
  senders.add(sender)
}
`,
    }),
  )
  assert.deepEqual(findings.map((finding) => finding.name), ['senders'])
})

test('a registry a plugin declarations module fills is refused', () => {
  const findings = findBootRegistries(
    tree({
      'libs/plugins/crm/src/lib/declarations.server.ts': `
import { registerHostEventListener } from '@aglyn/tenant-runtime/host-event-listeners'
export function registerCrmServerDeclarations() {
  registerHostEventListener('crm', { onEvent: async () => undefined })
}
`,
      'libs/tenant/runtime/src/lib/host-event-listeners.ts': `
interface Registration { pluginId: string }
const registrations: Registration[] = []
export function registerHostEventListener(pluginId: string, listener: unknown) {
  registrations.push({ pluginId })
}
`,
    }),
  )
  assert.deepEqual(findings.map((finding) => finding.name), ['registrations'])
})

test('a resolver `let` a reached register function assigns is refused', () => {
  const findings = findBootRegistries(
    tree({
      'libs/aglyn/src/lib/plugin-manager/site-cache.ts': `
let cache: unknown = null
export function registerSiteCache(next: unknown) {
  cache = next
}
`,
    }),
  )
  assert.deepEqual(findings.map((finding) => finding.name), ['cache'])
})

test('a registry the boot never reaches is not a finding', () => {
  const findings = findBootRegistries(
    tree({
      'libs/aglyn/src/lib/plugin-manager/plugin-styles.ts': moduleScoped('registerPluginStyles', 'sheets'),
    }),
  )
  assert.deepEqual(findings, [])
})

test('a register call in a comment or a string does not reach anything', () => {
  const findings = findBootRegistries(
    tree({
      'apps/console/instrumentation.ts': `${INSTRUMENTATION}
// registerPluginStyles() is the client's, not the boot's.
const note = 'registerPluginStyles(sheet)'
`,
      'libs/aglyn/src/lib/plugin-manager/plugin-styles.ts': moduleScoped('registerPluginStyles', 'sheets'),
    }),
  )
  assert.deepEqual(findings, [])
})

test('only the reached function body is followed, not every call in its file', () => {
  const findings = findBootRegistries(
    tree({
      'libs/aglyn/src/lib/plugin-manager/site-cache.ts': `${onGlobal('registerSiteCache', 'caches')}
export function registerApiSurface() {
  registerPluginStyles('sheet')
}
`,
      'libs/aglyn/src/lib/plugin-manager/plugin-styles.ts': moduleScoped('registerPluginStyles', 'sheets'),
    }),
  )
  assert.deepEqual(findings, [])
})

test("a boot source's own once-latch is not a finding", () => {
  const findings = findBootRegistries(
    tree({
      'libs/plugins/ai/src/lib/declarations.ts': `
let declared = false
export function registerAiDeclarations() {
  if (declared) return
  declared = true
}
`,
    }),
  )
  assert.deepEqual(findings, [])
})

test('a registry marked per copy on purpose is not a finding', () => {
  const findings = findBootRegistries(
    tree({
      'libs/aglyn/src/lib/plugin-manager/site-cache.ts': `
// boot-registry: per copy — each copy warms its own handle
const caches = new Map<string, unknown>()
export function registerSiteCache(value: unknown): void {
  caches.set('x', value)
}
`,
    }),
  )
  assert.deepEqual(findings, [])
})

test('the boot sources are instrumentation, its app-local imports and plugin declarations', () => {
  const files = tree({
    'apps/console/app/api/x/route.ts': 'export const GET = () => null',
    'libs/plugins/crm/src/lib/declarations.server.ts': '',
    'libs/plugins/crm/src/lib/declarations.server.spec.ts': '',
  })
  assert.deepEqual([...bootSources(files)].sort(), [
    'apps/console/instrumentation.ts',
    'apps/console/utils/push.ts',
    'libs/plugins/crm/src/lib/declarations.server.ts',
  ])
})

test('functionBody returns the braces of the named export, past a typed parameter list', () => {
  const text = stripNoise(`
export function registerThing(options: { id: string } = { id: 'a' }): void {
  if (options) { inner() }
}
export function other() {}
`)
  assert.equal(functionBody(text, 'registerThing').trim().split('\n').length, 3)
})
