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
 * A plugin's code reaches a surface only where that surface uses it
 * (AGL-3116), read from PRODUCTION BUILDS of both apps.
 *
 * ```
 * npx nx run tenant:build:production
 * npx nx run console:build:production
 * npm run check:plugins-load-where-used              # the gate
 * npm run check:plugins-load-where-used -- --list    # what each plugin contributes
 * node tools/scripts/check-plugins-load-where-used.mjs --if-built
 * node tools/scripts/check-plugins-load-where-used.mjs --next <dir> --console-next <dir>
 * ```
 *
 * ## Two halves
 *
 * The PUBLISHED-PAGE half asks what a customer site's visitor downloads: its
 * four rules and their reasoning live in `lib/plugins-load-where-used.mjs`. It
 * reads the same before-settle chunk set `check:tenant-wire-weight` budgets,
 * so the two agree on what a page loads and differ only in what they ask about
 * it: that one asks how many bytes, this one asks whose they are.
 *
 * The CONSOLE half (AGL-3142) asks the twin question of the workspace shell,
 * and lives in `lib/console-plugins-load-where-used.mjs`. The published half's
 * fourth rule keeps console code off a page; this one keeps a plugin that
 * draws nothing on every screen off every screen. Same chunk attribution, a
 * console build and the organization route.
 *
 * The forced reds for both are in the halves' own test files.
 *
 * `--if-built` is for a CI job whose build step is affected-scoped: with no
 * build for a half there is nothing that could have changed what that surface
 * loads, and that half is skipped. Without it, a missing build is a red — a
 * gate that read nothing has proved nothing.
 *
 * Exit codes: 0 every plugin module before settle belongs on the surface that
 * loaded it (or no build under `--if-built`) · 1 one does not, or a declared
 * import is not in the build · 2 no build to read.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { createResolver } from '../lint-rules/lib/app-router-graph.mjs'
import {
  CONSOLE_ROUTE,
  consoleShellLoad,
  declaredConsolePoints,
  evaluateConsolePresence,
  shellClosure,
  WHY_CONSOLE_LOAD_WHERE_USED,
} from './lib/console-plugins-load-where-used.mjs'
import {
  beforeSettleChunks,
  consoleEntries,
  evaluatePluginPresence,
  modulesInChunks,
  siteClosures,
  undeclaredSiteModules,
  WHY_LOAD_WHERE_USED,
} from './lib/plugins-load-where-used.mjs'
import { PUBLISHED_ROUTE } from './lib/tenant-wire-weight.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const args = process.argv.slice(2)
const flag = (name, fallback) => {
  const at = args.indexOf(name)
  return at >= 0 && args[at + 1] ? args[at + 1] : fallback
}
const NEXT_DIR = resolve(REPO_ROOT, flag('--next', 'dist/apps/tenant/.next'))
const CONSOLE_NEXT_DIR = resolve(
  REPO_ROOT,
  flag('--console-next', 'dist/apps/console/.next'),
)
const BUDGET_PATH = resolve(REPO_ROOT, flag('--budget', 'tools/tenant-wire-budget.json'))
const CONFIG_PATH = join(REPO_ROOT, 'plugins.config.json')

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`

/** A `.next` directory as the measurement reads it. */
function buildIo(dir) {
  return {
    readJson: (path) => JSON.parse(readFileSync(join(dir, path), 'utf8')),
    readText: (path) => readFileSync(join(dir, path), 'utf8'),
    readBuffer: (path) => readFileSync(join(dir, path)),
    exists: (path) => existsSync(join(dir, path)),
  }
}

/**
 * The console half (AGL-3142): no plugin's code on the workspace shell but
 * that of a plugin the shell draws something of.
 *
 * Returns the exit code, so a red here is a red for the whole gate even when
 * the published half passed.
 */
function checkConsole(config, resolveModule) {
  if (!existsSync(join(CONSOLE_NEXT_DIR, 'build-manifest.json'))) {
    if (args.includes('--if-built')) {
      console.log(
        'check:plugins-load-where-used — no console production build at ' +
          `${relative(REPO_ROOT, CONSOLE_NEXT_DIR)}: the console was not built ` +
          'in this run, so nothing here could have changed what a screen ' +
          'loads. Console half skipped.',
      )
      return 0
    }
    console.error(
      'check:plugins-load-where-used — no console production build at ' +
        `${relative(REPO_ROOT, CONSOLE_NEXT_DIR)}. Run \`npx nx run ` +
        'console:build:production` first. A gate with nothing to read is a ' +
        'red, never a pass.',
    )
    return 2
  }

  const io = buildIo(CONSOLE_NEXT_DIR)
  const plugins = config.plugins ?? []
  let shell
  try {
    shell = consoleShellLoad({ plugins, io })
  } catch (error) {
    console.error(
      `check:plugins-load-where-used — cannot read the console build: ${error.message}. ` +
        'An unreadable build is a red, never a pass.',
    )
    return 1
  }

  if (shell.missing.length) {
    for (const one of shell.missing) {
      console.error(
        `check:plugins-load-where-used — the shell loads ${one.import} from ` +
          `${one.from}, which is not in the console build.`,
      )
    }
    console.error(
      'A declared import this cannot find leaves its chunks unread, so the ' +
        'guard would clear a screen it never looked at.',
    )
    return 1
  }

  const closure = shellClosure({
    plugins,
    root: REPO_ROOT,
    read: (file) => readFileSync(file, 'utf8'),
    resolve: resolveModule,
  })
  const points = declaredConsolePoints({
    plugins,
    root: REPO_ROOT,
    resolve: resolveModule,
  })
  const { modules, unmapped } = modulesInChunks({ chunks: shell.chunks, io })
  const verdict = evaluateConsolePresence({ modules, closure, points })

  if (args.includes('--list')) {
    console.log(
      `\nthe workspace shell (${CONSOLE_ROUTE}) — ${shell.chunks.length} chunk(s), ` +
        `${kb(shell.bytes)} on the wire, ${kb(shell.raw)} raw`,
    )
    for (const [plugin, paths] of [...verdict.present].sort()) {
      console.log(`${plugin} — ${paths.length} module(s) before settle`)
      for (const path of paths.sort()) console.log(`    ${path}`)
    }
    if (unmapped.length) {
      console.log(`${unmapped.length} chunk(s) carry no source map`)
    }
  }

  if (!verdict.ok) {
    console.error(
      `\ncheck:plugins-load-where-used — ${verdict.offenders.length} module(s) of ` +
        'a plugin load on the workspace shell, which draws nothing of it:\n',
    )
    for (const one of verdict.offenders) {
      console.error(`  ${one.path}\n      ${one.why}\n      in ${one.chunk}`)
    }
    console.error(`\n${WHY_CONSOLE_LOAD_WHERE_USED}`)
    return 1
  }

  const names = [...verdict.present.keys()].sort()
  console.log(
    'check:plugins-load-where-used — every plugin module the workspace shell ' +
      `loads draws something on it (${names.length} plugin(s): ` +
      `${names.join(', ') || 'none'}; ${kb(shell.bytes)} on the wire)`,
  )
  return 0
}

/** The published-page half: rules 2-4, read from the tenant build. */
function checkPublished(config, resolveModule) {
  if (!existsSync(join(NEXT_DIR, 'build-manifest.json'))) {
    if (args.includes('--if-built')) {
      console.log(
        'check:plugins-load-where-used — no tenant production build at ' +
          `${relative(REPO_ROOT, NEXT_DIR)}: the tenant was not built in this ` +
          'run, so nothing here could have changed what a page loads. ' +
          'Published half skipped.',
      )
      return 0
    }
    console.error(
      'check:plugins-load-where-used — no tenant production build at ' +
        `${relative(REPO_ROOT, NEXT_DIR)}. Run \`npx nx run ` +
        'tenant:build:production` first. A gate with nothing to read is a ' +
        'red, never a pass.',
    )
    return 2
  }

  const budget = JSON.parse(readFileSync(BUDGET_PATH, 'utf8'))
  const io = buildIo(NEXT_DIR)

  let found
  try {
    found = beforeSettleChunks({
      groups: budget.groups ?? [],
      io,
      route: budget.route ?? PUBLISHED_ROUTE,
    })
  } catch (error) {
    console.error(
      `check:plugins-load-where-used — cannot read the build: ${error.message}. ` +
        'An unreadable build is a red, never a pass.',
    )
    return 1
  }

  if (found.missing.length) {
    for (const one of found.missing) {
      console.error(
        `check:plugins-load-where-used — "${one.group}" declares ` +
          `${one.import} from ${one.from}, which is not in the build.`,
      )
    }
    console.error(
      'A declared import this cannot find leaves its chunks unread, so the ' +
        'guard would clear a page it never looked at.',
    )
    return 1
  }

  const closures = siteClosures({
    plugins: config.plugins ?? [],
    root: REPO_ROOT,
    read: (file) => readFileSync(file, 'utf8'),
    resolve: resolveModule,
  })
  const consoleModules = consoleEntries({
    plugins: config.plugins ?? [],
    root: REPO_ROOT,
    resolve: resolveModule,
  })
  const { modules, unmapped } = modulesInChunks({ chunks: found.chunks, io })
  const verdict = evaluatePluginPresence({ modules, closures, consoleModules })

  if (args.includes('--list')) {
    for (const [plugin, paths] of [...verdict.present].sort()) {
      console.log(`${plugin} — ${paths.length} module(s) before settle`)
      for (const path of paths.sort()) console.log(`    ${path}`)
    }
    if (unmapped.length) {
      console.log(`${unmapped.length} chunk(s) carry no source map`)
    }
  }

  if (!verdict.ok) {
    console.error(
      `check:plugins-load-where-used — ${verdict.offenders.length} module(s) of ` +
        'a plugin load on every published page with nothing there to use them:\n',
    )
    for (const one of verdict.offenders) {
      console.error(`  ${one.path}\n      ${one.why}\n      in ${one.chunk}`)
    }
    console.error(`\n${WHY_LOAD_WHERE_USED}`)
    console.error(
      '\nA console surface belongs in a module of its own, named by the ' +
        "plugin's `modules` in plugins.config.json, so the site surface is " +
        'what a published page loads. See docs/PLUGIN_LOADING.md.',
    )
    return 1
  }

  const names = [...verdict.present.keys()].sort()
  console.log(
    'check:plugins-load-where-used — every plugin module a published page ' +
      `loads before settle belongs to a site surface (${names.length} plugin(s): ` +
      `${names.join(', ') || 'none'})`,
  )
  return 0
}

/**
 * Both halves run, and the worse verdict wins.
 *
 * Never one and then the other on success alone: a red on a published page
 * and a red on the shell are different mistakes with different fixes, and
 * stopping at the first would hide the second behind a build nobody re-ran.
 */
function main() {
  const config = JSON.parse(readFileSync(CONFIG_PATH, 'utf8'))

  // Rule 1 reads the declaration, so it holds whether or not there is a build
  // to read — and it is the rule the others rest on: with one module for both
  // surfaces, every console module is "in the site graph" by construction.
  const undeclared = undeclaredSiteModules(config.plugins ?? [])
  if (undeclared.length) {
    for (const one of undeclared) {
      console.error(
        `check:plugins-load-where-used — plugin "${one.id}" registers a site ` +
          'surface and a console surface from the same module ' +
          `(${one.specifier}). Give the site surface a module of its own and ` +
          'name it in `modules.site`.',
      )
    }
    console.error(`\n${WHY_LOAD_WHERE_USED}`)
    return 1
  }

  const resolveModule = createResolver(REPO_ROOT)
  return Math.max(
    checkPublished(config, resolveModule),
    checkConsole(config, resolveModule),
  )
}

process.exit(main())
