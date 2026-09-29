#!/usr/bin/env node
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
/**
 * The realm plugin surfaces of `@aglyn/aglyn` and `@mui/material`, and the
 * names every host module holds (AGL-3392).
 *
 * ```
 * node tools/scripts/generate-realm-host-exports.mjs           # write
 * node tools/scripts/generate-realm-host-exports.mjs --check   # the guard
 * ```
 *
 * The host ABI used to hand a bundle all of core as one namespace, which a
 * bundler cannot tree-shake: every page that ran a realm plugin downloaded all
 * of core for it (254 KB on the wire). Handing MUI over the same way would have
 * added 163 KB. The host now holds a SURFACE of each — a short reviewed list of
 * modules — and a bundle may read nothing else from them. A bundle does not
 * compile either library in: the site already runs them, and a second copy is
 * bytes the page downloads twice (the realm build refuses it).
 *
 * Static imports, from the host module a page loads only when it runs a realm
 * plugin, and no fallback to a whole library — Zach's call on 2026-09-29, from
 * the tenant build's numbers. Every `import()` that reached a library module,
 * one per MUI component or one for a whole-library fallback, made Turbopack
 * re-cut the chunks EVERY published page loads: +0.7 to +1.6 KB on each, on
 * sites that run no plugin. A static import from a lazy module moved nothing.
 * Loading per export would also have tied every signed bundle to the host's
 * exact MUI version; a surface only asks that a name stay put, which the
 * `--check` below watches.
 *
 * Writes:
 * - `libs/aglyn/.../realm-host-aglyn.generated.ts` — core's surface, by
 *   relative imports (an app deferring core by package specifier trips
 *   `@nx/enforce-module-boundaries` across the whole app);
 * - `apps/<app>/utils/realm-host-mui.generated.ts` — MUI's, one per app,
 *   because core does not depend on MUI;
 * - `libs/aglyn/.../realm-host-surface.generated.ts` — the names each host
 *   module holds, for the verifier, which must not import them to know them.
 *
 * A name is placed by IDENTITY, not by reading source: the value the barrel
 * exports is found in a module that exports the very same value. Among several
 * (a re-export file and the file that declares it) the declaring file wins,
 * and barrels are never an owner.
 *
 * `--check` fails when a name moved, appeared or disappeared — a core change
 * or a dependency upgrade — because the verifier would then pass a bundle the
 * host cannot serve, or refuse one it can.
 */
import { createRequire } from 'node:module'
import { dirname, join, relative } from 'node:path'
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const require = createRequire(join(ROOT, 'package.json'))
const CORE_LIB = 'libs/aglyn/src/lib'
const CORE_FILE = `${CORE_LIB}/plugin-manager/realm-host-aglyn.generated.ts`
const NAMES_FILE = `${CORE_LIB}/app-utils/realm-host-surface.generated.ts`

const MUI_FILES = [
  'apps/tenant/utils/realm-host-mui.generated.ts',
  'apps/console/utils/realm-host-mui.generated.ts',
]

/**
 * The part of `@mui/material/styles` an element styles itself with. A name
 * list rather than the whole module: passing the module as a value keeps every
 * export it has alive in the PAGE's copy too (+0.66 KB on every published page,
 * measured), where only named reads let the rest shake out.
 */
const MUI_STYLES_SURFACE = [
  'alpha',
  'css',
  'darken',
  'emphasize',
  'getContrastRatio',
  'keyframes',
  'lighten',
  'styled',
  'useColorScheme',
  'useTheme',
]

/**
 * `@mui/material`'s realm plugin surface: the components a site element is
 * laid out, filled in and printed with — layout and type, form controls, the
 * table and list a document prints, feedback — `useMediaQuery`, and the one
 * name of `utils` an icon from `@mui/icons-material` draws through. Of each
 * component module, the component alone: every other name read here is kept
 * alive in the page's own copy, and the `*Classes` objects measured +0.1 KB on
 * every published page. A plugin writes MUI's stable class names
 * (`.MuiButton-root`) instead. Each is loaded for every page that runs
 * a realm plugin, so a component earns its place by what plugin elements are
 * built from, not by being possible.
 */
const MUI_SURFACE = [
  'Alert',
  'Box',
  'Button',
  'Card',
  'CardContent',
  'Checkbox',
  'Chip',
  'CircularProgress',
  'Collapse',
  'Divider',
  'FormControl',
  'FormControlLabel',
  'FormHelperText',
  'IconButton',
  'InputAdornment',
  'InputLabel',
  'Link',
  'List',
  'ListItem',
  'ListItemText',
  'MenuItem',
  'Paper',
  'Radio',
  'RadioGroup',
  'Select',
  'Stack',
  'SvgIcon',
  'Switch',
  'Table',
  'TableBody',
  'TableCell',
  'TableHead',
  'TableRow',
  'TextField',
  'Tooltip',
  'Typography',
  'useMediaQuery',
  'utils',
]

/** Of `utils`, what an icon from `@mui/icons-material` draws through. */
const MUI_UTILS_SURFACE = ['createSvgIcon']

/**
 * `@aglyn/aglyn`'s realm plugin surface — what a plugin element or console
 * extension is built from:
 *
 * - the singletons (registry, plugins, canvas, emitter, logger);
 * - the schema vocabulary (component, field and node constants);
 * - registration (`defineUiFeatureBundle`, console extensions and slots);
 * - the React contexts an element reads (the declaring files, not the
 *   `contexts` re-export, which reaches every context core has);
 * - site functions and variables, which an element may run in the browser.
 */
const CORE_SURFACE = [
  'aglyn',
  'foundation/constants/components',
  'foundation/constants/shared',
  'foundation/definitions/components.types',
  'types/nodes',
  'plugin-manager/feature-plugins',
  'app-utils/screen-link-context-value',
  'app-utils/site-context',
  'app-utils/node-identity',
  'app-utils/enabled-plugins-context',
  'app-utils/functions',
  'app-utils/variables',
  'app-utils/binding-tokens',
]

function workspaceAliases() {
  const { paths } = JSON.parse(
    readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8'),
  ).compilerOptions
  const alias = {}
  for (const [key, [target]] of Object.entries(paths)) {
    const path = target.replace(/^\.\//, '')
    if (key.endsWith('/*')) {
      alias[key.slice(0, -1)] = join(ROOT, path.replace(/\/?\*$/, '')) + '/'
    } else {
      alias[key] = join(ROOT, path)
    }
  }
  return alias
}

const exportNames = (mod) =>
  Object.keys(mod).filter((name) => name !== 'default' && name !== '__esModule')

/** Every module file under a directory, specs and declarations excluded. */
function sourceFiles(dir) {
  const out = []
  for (const entry of readdirSync(dir).sort()) {
    const path = join(dir, entry)
    if (statSync(path).isDirectory()) out.push(...sourceFiles(path))
    else if (/\.tsx?$/.test(entry) && !/\.(spec|test|d)\.tsx?$/.test(entry)) out.push(path)
  }
  return out
}

/** Adds `name` to `table[module]`. */
function place(table, module, name) {
  ;(table[module] ??= []).push(name)
}

/** `{ module: [name, …] }` for core's surface, by module path under the lib. */
async function coreTable() {
  const { createJiti } = require('jiti')
  const jiti = createJiti(join(ROOT, 'package.json'), {
    alias: workspaceAliases(),
    interopDefault: false,
    moduleCache: true,
    fsCache: false,
    sourceMaps: false,
  })
  const barrel = await jiti.import('@aglyn/aglyn')
  const wanted = new Set(exportNames(barrel))
  const declares = (source, name) =>
    new RegExp(
      `(^|\\n)\\s*export\\s+(declare\\s+)?(async\\s+)?(function\\*?|const|let|var|class|enum|abstract\\s+class)\\s+${name.replace(/\$/g, '\\$')}\\b`,
    ).test(source)
  const owners = new Map()
  const keys = new Set()
  for (const file of sourceFiles(join(ROOT, CORE_LIB))) {
    if (/\/index\.tsx?$/.test(file) || file.endsWith('.generated.ts')) continue
    const key = relative(join(ROOT, CORE_LIB), file).replace(/\.tsx?$/, '')
    keys.add(key)
    let mod
    try {
      mod = await jiti.import(file)
    } catch {
      // A server-only module does not load here, and nothing the client
      // barrel exports can live in one.
      continue
    }
    const source = readFileSync(file, 'utf8')
    for (const name of exportNames(mod)) {
      if (!wanted.has(name) || mod[name] !== barrel[name]) continue
      const entry = owners.get(name) ?? {}
      entry.any ??= key
      if (!entry.declared && declares(source, name)) entry.declared = key
      owners.set(name, entry)
    }
  }
  for (const key of CORE_SURFACE) {
    if (!keys.has(key)) throw new Error(`CORE_SURFACE names "${key}", which is not a core module`)
  }
  const table = {}
  for (const name of [...wanted].sort()) {
    const entry = owners.get(name)
    const owner = entry?.declared ?? entry?.any
    if (owner && CORE_SURFACE.includes(owner)) place(table, owner, name)
  }
  return table
}

/**
 * `{ subpath: [[name, sourceName], …] }` for MUI's surface. A component is its
 * module's `default`; every other name its module exports as the barrel does.
 */
function muiTable() {
  const pkg = require('@mui/material/package.json')
  const barrel = require('@mui/material')
  const wanted = new Set(exportNames(barrel))
  const table = {}
  for (const subpath of MUI_SURFACE) {
    if (!pkg.exports[`./${subpath}`]) {
      throw new Error(`MUI_SURFACE names "${subpath}", which @mui/material ${pkg.version} does not export`)
    }
    const mod = require(`@mui/material/${subpath}`)
    const entries = (table[subpath] = [])
    if (wanted.has(subpath) && mod.default !== undefined && mod.default === barrel[subpath]) {
      entries.push([subpath, 'default'])
    }
    const names = subpath === 'utils' ? MUI_UTILS_SURFACE : []
    for (const name of [...names].sort()) {
      if (mod[name] === undefined || mod[name] !== barrel[name]) {
        throw new Error(`@mui/material/${subpath} does not export "${name}" as the barrel does`)
      }
      entries.push([name, name])
    }
  }
  const styles = require('@mui/material/styles')
  for (const name of MUI_STYLES_SURFACE) {
    if (styles[name] === undefined) {
      throw new Error(`MUI_STYLES_SURFACE names "${name}", which @mui/material/styles does not export`)
    }
  }
  return { table, version: pkg.version }
}

const HEADER = (what) => `/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-realm-host-exports.mjs
 *
 * ${what}
 */
/* eslint-disable */
`

function coreContent(table) {
  const from = dirname(CORE_FILE)
  const specifier = (key) => {
    const path = relative(from, join(CORE_LIB, key))
    return path.startsWith('.') ? path : `./${path}`
  }
  const modules = Object.keys(table).sort()
  return (
    HEADER(
      'The realm plugin surface of `@aglyn/aglyn` (AGL-3392): what a signed\n' +
        ' * bundle reads from core. Imported only by the lazily loaded host module.',
    ) +
    `
${modules.map((key, index) => `import * as m${index} from ${JSON.stringify(specifier(key))}`).join('\n')}

export const AGLYN_HOST_SURFACE: Readonly<Record<string, unknown>> = Object.freeze({
${modules.flatMap((key, index) => table[key].map((name) => `  ${name}: m${index}.${name},`)).join('\n')}
})
`
  )
}

function muiContent({ table, version }) {
  const modules = Object.keys(table).sort()
  return (
    HEADER(
      `The realm plugin surface of \`@mui/material\` ${version} (AGL-3392): what a\n` +
        ' * signed bundle reads from MUI. Imported only by the lazily loaded host module.',
    ) +
    `
${modules.map((key, index) => `import * as m${index} from ${JSON.stringify(`@mui/material/${key}`)}`).join('\n')}
import * as styles from '@mui/material/styles'

export const MUI_HOST_SURFACE: Readonly<Record<string, unknown>> = Object.freeze({
${modules
  .flatMap((key, index) =>
    table[key].map(([name, source]) => `  ${name}: m${index}${source === 'default' ? '.default' : `.${source}`},`),
  )
  .join('\n')}
})

export const MUI_STYLES_HOST_SURFACE: Readonly<Record<string, unknown>> = Object.freeze({
${MUI_STYLES_SURFACE.map((name) => `  ${name}: styles.${name},`).join('\n')}
})
`
  )
}

function namesContent(core, mui) {
  const set = (names) => `new Set(${JSON.stringify(names)})`
  const lines = [
    `  aglyn: ${set(Object.values(core).flat().sort())},`,
    `  mui: ${set(Object.values(mui).flat().map(([name]) => name).sort())},`,
    `  muiStyles: ${set([...MUI_STYLES_SURFACE].sort())},`,
  ]
  return (
    HEADER(
      'The names each realm host module holds (AGL-3392), for the bundle\n' +
        ' * verifier: a bundle reading any other name from the host is refused,\n' +
        ' * because it would read `undefined` on every site.',
    ) +
    `
export const REALM_HOST_SURFACE_NAMES: Readonly<
  Record<'aglyn' | 'mui' | 'muiStyles', ReadonlySet<string>>
> = {
${lines.join('\n')}
}
`
  )
}

const check = process.argv.includes('--check')
const core = await coreTable()
const mui = muiTable()
const outputs = [
  { file: CORE_FILE, content: coreContent(core) },
  { file: NAMES_FILE, content: namesContent(core, mui.table) },
  ...MUI_FILES.map((file) => ({ file, content: muiContent(mui) })),
]

const drifted = []
for (const { file, content } of outputs) {
  if (!check) {
    writeFileSync(join(ROOT, file), content)
    console.log(`wrote ${file}`)
    continue
  }
  let actual = null
  try {
    actual = readFileSync(join(ROOT, file), 'utf8')
  } catch {
    // Absent is drift; the fix is the same command.
  }
  if (actual !== content) drifted.push(file)
}
if (drifted.length) {
  console.error(
    `realm host surface tables are stale (a core export or a host dependency moved):\n  ${drifted.join('\n  ')}\n` +
      'Run: node tools/scripts/generate-realm-host-exports.mjs',
  )
  process.exit(1)
}
if (check) console.log(`${outputs.length} realm host surface tables in sync`)
