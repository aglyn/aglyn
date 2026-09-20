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
 * `check:plugins-load-where-used` (AGL-3116), and its forced reds.
 *
 * Each rule is driven over a synthetic plugin catalog and a synthetic chunk,
 * so a red can be forced without editing the tree — and so the ONE shape that
 * matters is asserted directly: the same module answering for a site surface
 * and a console one, which is what put a console registrar on every published
 * page in the first place.
 *
 * The real-build check is the CLI's own: with nothing to read it must refuse,
 * and pass saying so only under `--if-built`.
 */

import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  consoleEntries,
  evaluatePluginPresence,
  modulesInChunks,
  pluginOf,
  siteClosures,
  siteEntrySpecifier,
  undeclaredSiteModules,
} from './plugins-load-where-used.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..', '..')
const CLI = join(REPO_ROOT, 'tools', 'scripts', 'check-plugins-load-where-used.mjs')
const ROOT = '/repo'

const BOTH = {
  id: 'forms',
  package: '@aglyn/plugins-forms',
  register: { site: 'registerFormsPlugin', console: 'registerFormsConsole' },
  modules: { site: 'site' },
}
const CONSOLE_ONLY = {
  id: 'crm',
  package: '@aglyn/plugins-crm',
  register: { console: 'registerCrmConsole' },
}

/** `@aglyn/plugins-x[/sub]` → the file the repo's alias map would answer. */
const resolve = (specifier) => {
  const match = /^@aglyn\/plugins-([a-z-]+)(?:\/(.+))?$/.exec(specifier)
  if (!match) return null
  const [, name, sub] = match
  return sub
    ? `${ROOT}/libs/plugins/${name}/src/lib/${sub}.ts`
    : `${ROOT}/libs/plugins/${name}/src/index.ts`
}

test('pluginOf names the plugin a built module belongs to', () => {
  assert.equal(pluginOf('libs/plugins/forms/src/lib/site.ts'), 'forms')
  assert.equal(pluginOf('libs/aglyn/src/lib/plugin-manager/plugin-loader.ts'), null)
  assert.equal(pluginOf(undefined), null)
})

test('the site surface loads from `modules.site`, and the root without one', () => {
  assert.equal(siteEntrySpecifier(BOTH), '@aglyn/plugins-forms/site')
  assert.equal(siteEntrySpecifier({ ...BOTH, modules: undefined }), '@aglyn/plugins-forms')
  assert.equal(siteEntrySpecifier(CONSOLE_ONLY), null)
})

test('RULE 1 — one module for both surfaces is refused, with or without a build', () => {
  assert.deepEqual(undeclaredSiteModules([BOTH, CONSOLE_ONLY]), [])
  // The regression this whole change undoes: drop `modules.site` and the
  // loader hands a published page the console registrar.
  const dropped = undeclaredSiteModules([{ ...BOTH, modules: undefined }])
  assert.deepEqual(dropped, [{ id: 'forms', specifier: '@aglyn/plugins-forms' }])
  // A plugin with only one of the two surfaces has nothing to separate.
  assert.deepEqual(undeclaredSiteModules([CONSOLE_ONLY]), [])
  assert.deepEqual(
    undeclaredSiteModules([{ id: 'x', package: '@aglyn/plugins-x', register: { site: 'r' } }]),
    [],
  )
})

test('RULE 2 — a plugin with no site surface may contribute nothing', () => {
  const closures = siteClosures({
    plugins: [BOTH, CONSOLE_ONLY],
    root: ROOT,
    read: () => '',
    resolve,
  })
  const verdict = evaluatePluginPresence({
    modules: new Map([['libs/plugins/crm/src/lib/board.tsx', 'static/chunks/a.js']]),
    closures,
    consoleModules: new Map(),
  })
  assert.equal(verdict.ok, false)
  assert.equal(verdict.offenders[0].why, 'the plugin has no site surface')
})

test('RULE 3 — a module outside the site surface’s static graph is refused', () => {
  const sources = {
    [`${ROOT}/libs/plugins/forms/src/lib/site.ts`]: "import './components/form'",
    [`${ROOT}/libs/plugins/forms/src/lib/components/form.tsx`]: '',
  }
  const closures = siteClosures({
    plugins: [BOTH],
    root: ROOT,
    read: (file) => sources[file] ?? '',
    resolve: (specifier, from) => {
      if (specifier.startsWith('.')) {
        return `${dirname(from)}/${specifier.slice(2)}.tsx`
      }
      return resolve(specifier)
    },
  })
  const allowed = evaluatePluginPresence({
    modules: new Map([['libs/plugins/forms/src/lib/components/form.tsx', 'c.js']]),
    closures,
    consoleModules: new Map(),
  })
  assert.equal(allowed.ok, true)

  const refused = evaluatePluginPresence({
    modules: new Map([['libs/plugins/forms/src/lib/components/forms-console-page.tsx', 'c.js']]),
    closures,
    consoleModules: new Map(),
  })
  assert.equal(refused.ok, false)
  assert.match(refused.offenders[0].why, /@aglyn\/plugins-forms\/site/)
})

test('RULE 4 — the console registrar’s own module is refused whatever reaches it', () => {
  // Rule 3 reads the graph of the DECLARED site module, so a site module that
  // imported the console one would carry it inside its own graph and clear it.
  // Rule 4 does not ask what reaches it.
  const consoleModules = consoleEntries({ plugins: [BOTH], root: ROOT, resolve })
  assert.deepEqual([...consoleModules.keys()], ['libs/plugins/forms/src/index.ts'])

  const closures = new Map([
    [
      'forms',
      {
        specifier: '@aglyn/plugins-forms/site',
        modules: new Set(['libs/plugins/forms/src/index.ts']),
      },
    ],
  ])
  const verdict = evaluatePluginPresence({
    modules: new Map([['libs/plugins/forms/src/index.ts', 'c.js']]),
    closures,
    consoleModules,
  })
  assert.equal(verdict.ok, false)
  assert.match(verdict.offenders[0].why, /console surface registers from/)
})

test('a chunk names its modules through its own source map, and one without is reported', () => {
  const map = {
    version: 3,
    sources: ['turbopack:///[project]/libs/plugins/forms/src/lib/site.ts'],
    names: [],
    mappings: 'AAAA',
  }
  const files = {
    'static/chunks/a.js': 'x\n//# sourceMappingURL=a.js.map',
    'static/chunks/a.js.map': JSON.stringify(map),
    'static/chunks/b.js': 'y',
  }
  const io = {
    exists: (path) => path in files,
    readText: (path) => files[path],
    readJson: (path) => JSON.parse(files[path]),
  }
  const read = modulesInChunks({
    chunks: ['static/chunks/a.js', 'static/chunks/b.js'],
    io,
  })
  assert.deepEqual(
    [...read.modules],
    [['libs/plugins/forms/src/lib/site.ts', 'static/chunks/a.js']],
  )
  assert.deepEqual(read.unmapped, ['static/chunks/b.js'])
})

test('the CLI refuses a missing build, and skips only when told it was not built', () => {
  const empty = mkdtempSync(join(tmpdir(), 'aglyn-no-build-'))
  // Both halves are pointed at the empty directory, so this case is about the
  // CLI's own behavior rather than about whichever builds happen to be in
  // `dist/` on the machine running it (AGL-3142).
  const noBuilds = ['--next', empty, '--console-next', empty]
  try {
    assert.throws(
      () => execFileSync(process.execPath, [CLI, ...noBuilds], { encoding: 'utf8' }),
      (error) => error.status === 2,
    )
    const skipped = execFileSync(
      process.execPath,
      [CLI, ...noBuilds, '--if-built'],
      { encoding: 'utf8' },
    )
    assert.match(skipped, /Published half skipped/)
    assert.match(skipped, /Console half skipped/)
  } finally {
    rmSync(empty, { recursive: true, force: true })
  }
})
