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
 * Fail when a `browser` resolve alias stops being safe (AGL-2706).
 *
 * Two specifiers are replaced, for browser bundles only, by modules that carry
 * a name and no implementation: `re2js` and Next's compiled `buffer`. That is
 * 48.7 KB gzipped off every console route, and it rests on how
 * `@firebase/firestore`'s vendored browser bundle uses each binding. This
 * reads that bundle and says whether it still does.
 *
 * ```
 * npm run check:browser-shim-aliases
 * npm run check:browser-shim-aliases -- --json
 * ```
 *
 * The reasoning, and what is deliberately NOT checked, is in
 * `lib/browser-shim-aliases.mjs`.
 *
 * Exit codes: 0 every alias still safe · 1 a use no longer has the shape its
 * shim was chosen for · 2 the check could not be made.
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  SHIMMED,
  WHY_SHIM_ALIAS,
  verdictFor,
} from './lib/browser-shim-aliases.mjs'

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const CONFIG = join(REPO_ROOT, 'with-aglyn.nextjs.config.js')
const asJson = process.argv.includes('--json')

/**
 * The BROWSER ESM bundles of a vendored package.
 *
 * `*.esm.js` and nothing else: the `.node.`, `.rn.` and `.cjs.` builds are
 * other runtimes' copies of the same code, and judging the browser alias by
 * what the Node bundle does would be measuring the adjacent quantity.
 */
function browserBundles(pkg) {
  const dist = join(REPO_ROOT, 'node_modules', pkg, 'dist')
  if (!existsSync(dist)) return []
  return readdirSync(dist)
    .filter((name) => name.endsWith('.esm.js'))
    .filter((name) => !/\.(node|rn|cjs)\./.test(name))
    .map((name) => ({
      path: `node_modules/${pkg}/dist/${name}`,
      source: readFileSync(join(dist, name), 'utf8'),
    }))
}

let config
try {
  config = readFileSync(CONFIG, 'utf8')
} catch (error) {
  console.error(
    `UNKNOWN — cannot read ${CONFIG}\n  ${error.message}\n\n` +
      'Without the alias map there is nothing to judge, so this is exit 2 ' +
      'and not a pass.',
  )
  process.exit(2)
}

const results = []
for (const shim of SHIMMED) {
  // The alias is written with the app-relative `../../` prefix the config
  // needs; matching on the shim's repo-relative tail keeps this readable and
  // survives the prefix changing.
  const declared =
    config.includes(shim.shim) &&
    new RegExp(
      `['"]?${shim.specifier.replace(/[/.]/g, '\\$&')}['"]?\\s*:`,
    ).test(config)
  const shimExists = existsSync(join(REPO_ROOT, shim.shim))
  if (!declared) {
    // Not an error. An alias someone deliberately removed means the real
    // package is back and there is nothing left to be unsafe about.
    results.push({ ...shim, state: 'not-aliased', sites: 0, failing: [] })
    continue
  }
  if (!shimExists) {
    results.push({ ...shim, state: 'missing-shim', sites: 0, failing: [] })
    continue
  }
  results.push(verdictFor(shim, browserBundles(shim.vendored)))
}

const bad = results.filter(
  (one) => one.state === 'unsafe' || one.state === 'missing-shim',
)
const unknown = results.filter((one) => one.state === 'unknown')

if (asJson) {
  console.log(
    JSON.stringify(
      results.map((one) => ({
        specifier: one.specifier,
        binding: one.binding,
        safety: one.safety,
        state: one.state,
        sites: one.sites,
        failingIn: one.failing.map((f) => f.path),
      })),
      null,
      2,
    ),
  )
  process.exit(bad.length ? 1 : unknown.length ? 2 : 0)
}

for (const one of results)
  console.log(
    `${one.specifier} -> ${one.shim} — ${one.state}, ` +
      `${one.sites} site(s) for ${one.binding} in ${one.vendored}, ` +
      `shape ${one.safety}`,
  )

if (!bad.length && !unknown.length) process.exit(0)

console.error('')
for (const one of unknown)
  console.error(
    `${one.specifier}: no browser ESM bundle found under ` +
      `node_modules/${one.vendored}/dist, so nothing was established.`,
  )
for (const one of bad) {
  if (one.state === 'missing-shim') {
    console.error(
      `${one.specifier}: the alias points at ${one.shim}, which does not ` +
        'exist. Every browser build resolving this specifier is broken.',
    )
    continue
  }
  console.error(`${one.specifier}: ${one.binding} is used in a shape the shim`)
  console.error(`  cannot survive (${one.safety}). ${one.why}`)
  for (const file of one.failing)
    console.error(
      `  ${file.path} — ${file.failing.length} of ${file.sites.length} site(s)`,
    )
}
console.error('')
console.error(WHY_SHIM_ALIAS)
process.exit(bad.length ? 1 : 2)
