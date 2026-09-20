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
 * The console half of `check:plugins-load-where-used` (AGL-3142), and its
 * forced reds.
 *
 * Driven over a synthetic catalog and synthetic sources, so a red can be
 * forced without editing the tree. Every refusal is paired with the load that
 * MUST still pass through the same code: a guard that refuses everything
 * reads as a guard that works, right up to the day it refuses a correct
 * change and gets deleted.
 */

import assert from 'node:assert/strict'
import { dirname, join } from 'node:path'
import test from 'node:test'

import {
  consoleShellGroup,
  declaredConsolePoints,
  evaluateConsolePresence,
  loadsWithShell,
  shellClosure,
} from './console-plugins-load-where-used.mjs'

const ROOT = '/repo'

/** Draws a nav tab on every screen, and serves a route of its own. */
const SHELL = {
  id: 'commerce',
  package: '@aglyn/plugins-commerce',
  register: { console: 'registerCommerceConsole', site: 'registerCommercePlugin' },
  modules: { site: 'site' },
  contributes: { console: { shell: true, routes: ['/products'] } },
}
/** Fills four zones and draws nothing on the shell. */
const ZONES_ONLY = {
  id: 'marketplace',
  package: '@aglyn/plugins-marketplace',
  register: { console: 'registerMarketplaceConsole' },
  contributes: { console: { slots: ['orgMarketplace', 'orgAddons'] } },
}
/** Published before the contract: loads with the shell, as it always did. */
const UNDECLARED = {
  id: 'legacy',
  package: '@aglyn/plugins-legacy',
  register: { console: 'registerLegacyConsole' },
}
/** No console surface at all. */
const SITE_ONLY = {
  id: 'mui',
  package: '@aglyn/plugins-mui',
  register: { site: 'registerMuiPlugin' },
  contributes: { site: { components: ['muiButton'] } },
}

/** `@aglyn/plugins-x[/sub]` → the file the repo's alias map would answer. */
const resolve = (specifier, from) => {
  if (specifier.startsWith('.')) return `${dirname(from)}/${specifier.slice(2)}.ts`
  const match = /^@aglyn\/plugins-([a-z-]+)(?:\/(.+))?$/.exec(specifier)
  if (!match) return null
  const [, name, sub] = match
  return sub
    ? `${ROOT}/libs/plugins/${name}/src/lib/${sub}.ts`
    : `${ROOT}/libs/plugins/${name}/src/index.ts`
}

test('a declaration decides whether a plugin loads with the shell', () => {
  assert.equal(loadsWithShell(SHELL), true)
  // Zones and routes are drawn elsewhere; the shell draws neither.
  assert.equal(loadsWithShell(ZONES_ONLY), false)
  // The compatibility default: an absent block is a plugin published before
  // the contract, and its nav tab is only discoverable by running register().
  assert.equal(loadsWithShell(UNDECLARED), true)
  // `{}` is a STATEMENT — contributes nothing — and differs from absent.
  assert.equal(loadsWithShell({ ...UNDECLARED, contributes: {} }), false)
  // A plugin with no console surface never loads on a console screen.
  assert.equal(loadsWithShell(SITE_ONLY), false)
})

test('the shell group declares one load per plugin the shell draws', () => {
  const group = consoleShellGroup([SHELL, ZONES_ONLY, UNDECLARED, SITE_ONLY])
  assert.deepEqual(
    group.loads.map((load) => load.import),
    ['@aglyn/plugins-commerce', '@aglyn/plugins-legacy'],
  )
  // Every load is keyed on the generated manifest's own import line, which is
  // what the build can actually be asked about.
  assert.ok(group.loads.every((load) => load.from.endsWith('plugins.client.generated.ts')))
})

test('a zone-only plugin`s code on the shell is refused, and a shell plugin`s is not', () => {
  const sources = {
    [`${ROOT}/libs/plugins/commerce/src/index.ts`]: "import './lib/console'",
    [`${ROOT}/libs/plugins/commerce/src/lib/console.ts`]: '',
  }
  const closure = shellClosure({
    plugins: [SHELL, ZONES_ONLY],
    root: ROOT,
    read: (file) => sources[file] ?? '',
    resolve,
  })
  const points = declaredConsolePoints({
    plugins: [SHELL, ZONES_ONLY],
    root: ROOT,
    resolve,
  })

  // The control: a module the shell's own plugin reaches statically.
  const allowed = evaluateConsolePresence({
    modules: new Map([['libs/plugins/commerce/src/lib/console.ts', 'a.js']]),
    closure,
    points,
  })
  assert.equal(allowed.ok, true)

  // The red: the plugin that fills zones nobody drew here.
  const refused = evaluateConsolePresence({
    modules: new Map([['libs/plugins/marketplace/src/lib/browse.tsx', 'a.js']]),
    closure,
    points,
  })
  assert.equal(refused.ok, false)
  assert.match(refused.offenders[0].why, /marketplace declares only 2 zone\(s\)/)
})

test('a module a shell plugin only DEFERS is refused when the chunker hands it over', () => {
  // The console twin of the published half's rule 3: `import()` inside a
  // plugin is code the plugin itself puts behind a branch, and the shell's
  // before-settle load is where it must not be.
  const sources = {
    [`${ROOT}/libs/plugins/commerce/src/index.ts`]:
      "const open = () => import('./lib/dialog')",
  }
  const closure = shellClosure({
    plugins: [SHELL],
    root: ROOT,
    read: (file) => sources[file] ?? '',
    resolve,
  })
  const verdict = evaluateConsolePresence({
    modules: new Map([['libs/plugins/commerce/src/lib/dialog.ts', 'a.js']]),
    closure,
    points: declaredConsolePoints({ plugins: [SHELL], root: ROOT, resolve }),
  })
  assert.equal(verdict.ok, false)
  assert.match(verdict.offenders[0].why, /no shell plugin's console surface reaches/)
})

test('a plugin a shell plugin genuinely reaches is NOT blamed for the edge', () => {
  // `forms` reads the MUI bundle id and `email` its HTML sanitizer. Those are
  // cross-package edges `check:lib-boundaries` owns; a rule that blamed every
  // module by the directory it sits in would red on them and teach nothing.
  const sources = {
    [`${ROOT}/libs/plugins/commerce/src/index.ts`]: "import '@aglyn/plugins-mui/ids'",
    [`${ROOT}/libs/plugins/mui/src/lib/ids.ts`]: '',
  }
  const closure = shellClosure({
    plugins: [SHELL],
    root: ROOT,
    read: (file) => sources[file] ?? '',
    resolve,
  })
  const verdict = evaluateConsolePresence({
    modules: new Map([['libs/plugins/mui/src/lib/ids.ts', 'a.js']]),
    closure,
    points: declaredConsolePoints({ plugins: [SHELL, SITE_ONLY], root: ROOT, resolve }),
  })
  assert.equal(verdict.ok, true)
})

test('a shell plugin whose module cannot be resolved is a red, never a silent pass', () => {
  const closure = shellClosure({
    plugins: [{ ...SHELL, package: 'not-a-plugin-package' }],
    root: ROOT,
    read: () => '',
    resolve,
  })
  assert.equal(closure.modules.size, 0)
  const verdict = evaluateConsolePresence({
    modules: new Map(),
    closure,
    points: new Map(),
  })
  assert.equal(verdict.ok, false)
  assert.match(verdict.offenders[0].why, /cannot resolve not-a-plugin-package/)
})

test('a console module names its plugin by DIRECTORY, which the id may not match', () => {
  const points = declaredConsolePoints({
    plugins: [
      {
        id: 'events',
        package: '@aglyn/plugins-events-calendar',
        register: { console: 'registerEventsCalendarConsole' },
        contributes: { console: { routes: ['/events'] } },
      },
    ],
    root: ROOT,
    resolve,
  })
  assert.deepEqual([...points.keys()], ['events-calendar'])
  assert.equal(points.get('events-calendar').points, 'only 1 site route(s)')
})

test('the shell load is measured on the route every workspace screen sits in', async () => {
  const { CONSOLE_ROUTE } = await import('./console-plugins-load-where-used.mjs')
  assert.equal(CONSOLE_ROUTE, '(app)/[orgSlug]')
  assert.equal(join('server', 'app', CONSOLE_ROUTE), 'server/app/(app)/[orgSlug]')
})
