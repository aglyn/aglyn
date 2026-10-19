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

// The Chrome a headless script launches, and the switches it launches with.
// Spread into `chromium.launch({ headless: true, ...chromeExecutable() })`.
//
// On macOS a branded Chrome copies its whole app bundle (~1.4 GB) into
// `$TMPDIR/../X/com.google.Chrome*.code_sign_clone/` at every start, and only
// a clean `browser.close()` removes the copy. A run that is killed, crashes
// or exits before closing leaves it behind; the local e2e and AI-shot runs
// once piled up 102 GB of them. Chrome's `MacAppCodeSignClone` feature is
// what makes the copy, so it is switched off here.
//
// Chrome honors only the LAST `--disable-features` on its command line, and
// Playwright already passes one of its own. Appending ours alone would drop
// Playwright's list, so the switch carries Playwright's features too, read
// from the installed playwright-core so an upgrade can't make it stale.
//
// Copies still pile up from Chromes that never come through here: a
// Lighthouse run (its launcher kills Chrome to stop it), a hand-typed
// `--headless` command that is killed once its screenshot is written, a
// scratch script, a crashed desktop Chrome. They refilled 24 GB in a day after
// the switch landed. So on macOS `chromeExecutable()` also removes copies that
// no running process has open.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'

const MAC_CHROMES = [
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/Applications/Google Chrome Beta.app/Contents/MacOS/Google Chrome Beta',
  '/Applications/Chromium.app/Contents/MacOS/Chromium',
]

/** The Chrome feature that clones the app bundle at every start. */
export const CODE_SIGN_CLONE_FEATURE = 'MacAppCodeSignClone'

// Where playwright-core defines `disabledFeatures`, newest layout first.
const PLAYWRIGHT_SWITCH_SOURCES = ['lib/coreBundle.js', 'lib/server/chromium/chromiumSwitches.js']

/**
 * The features Playwright's own `--disable-features` switch turns off, or
 * null when the installed playwright-core no longer reads that way.
 *
 * @param {string} [packageDir] playwright-core's folder; found from here when omitted.
 * @returns {string[] | null}
 */
export function playwrightDisabledFeatures(packageDir) {
  let dir = packageDir
  if (!dir) {
    try {
      dir = dirname(createRequire(import.meta.url).resolve('playwright-core/package.json'))
    } catch {
      return null
    }
  }
  for (const source of PLAYWRIGHT_SWITCH_SOURCES) {
    const path = join(dir, source)
    if (!existsSync(path)) continue
    const list = /disabledFeatures\s*=\s*\[([\s\S]*?)\]/.exec(readFileSync(path, 'utf8'))?.[1]
    if (!list) continue
    // One quoted name per line; the comments between them hold no quotes.
    const features = [...list.matchAll(/^\s*["']([\w-]+)["'],?\s*$/gm)].map((match) => match[1])
    if (features.length) return features
  }
  return null
}

/**
 * The launch switches that keep a macOS Chrome from leaving a bundle clone,
 * or none when Playwright's own list can't be read (dropping it would change
 * how every page under test behaves).
 *
 * @param {string[] | null} [playwrightFeatures]
 * @returns {string[]}
 */
export function noCodeSignCloneArgs(playwrightFeatures = playwrightDisabledFeatures()) {
  if (!playwrightFeatures) {
    console.warn(
      '[chrome-executable] could not read Playwright’s --disable-features list, so Chrome may ' +
        'leave a ~1.4 GB code_sign_clone copy in $TMPDIR if this run does not close it.',
    )
    return []
  }
  const features = [...new Set([...playwrightFeatures, CODE_SIGN_CLONE_FEATURE])]
  return [`--disable-features=${features.join(',')}`]
}

// A Chrome that is still starting may not have opened its copy yet.
const CLONE_MIN_AGE_MS = 10 * 60 * 1000

// A running browser process (not a helper) of a flavor that makes a copy.
const CHROME_BROWSER_PROCESS = /\/(Google Chrome(?: Beta| Dev| Canary)?|Chromium)\.app\/Contents\/MacOS\/\1(?:\s|$)/

/**
 * The bundle copies some process has open, by folder name, from the output of
 * `lsof -Fn +D <copies folder>` and `ps -axww -o args=`. Null when lsof saw
 * fewer copies than there are running Chromes that made one: it missed some,
 * so none may be removed.
 *
 * @param {string} lsofListing
 * @param {string} psListing
 * @returns {Set<string> | null}
 */
export function openCodeSignClones(lsofListing, psListing) {
  const open = new Set(lsofListing.match(/code_sign_clone\.\w+/g) ?? [])
  const cloning = psListing
    .split('\n')
    .filter((line) => CHROME_BROWSER_PROCESS.test(line))
    .filter((line) => !line.includes(CODE_SIGN_CLONE_FEATURE)).length
  return open.size < cloning ? null : open
}

/**
 * Where this Mac's Chrome keeps its bundle copies (`$TMPDIR/../X`), or null.
 *
 * @returns {string | null}
 */
function codeSignCloneRoot() {
  try {
    return join(execFileSync('getconf', ['DARWIN_USER_TEMP_DIR'], { encoding: 'utf8' }).trim(), '..', 'X')
  } catch {
    return null
  }
}

/**
 * Which copies under `root` are open right now, or null when that can't be
 * told (then none may be removed).
 *
 * @param {string} root
 * @returns {Set<string> | null}
 */
function readOpenCodeSignClones(root) {
  const run = (command, args) => {
    try {
      return execFileSync(command, args, {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        maxBuffer: 64 << 20,
      })
    } catch (error) {
      // lsof exits 1 when any lookup fails, even after listing what it found.
      return error?.status === 1 && typeof error.stdout === 'string' ? error.stdout : null
    }
  }
  const lsofListing = run('lsof', ['-Fn', '+D', root])
  const psListing = run('ps', ['-axww', '-o', 'args='])
  return lsofListing === null || psListing === null ? null : openCodeSignClones(lsofListing, psListing)
}

/**
 * Removes the bundle copies a killed or crashed Chrome left behind. A copy
 * that a process still has open, or one younger than ten minutes, stays.
 *
 * @param {{ root?: string | null, readOpen?: (root: string) => Set<string> | null, now?: number }} [options]
 * @returns {string[]} the copies removed
 */
export function reapCodeSignClones({
  root = codeSignCloneRoot(),
  readOpen = readOpenCodeSignClones,
  now = Date.now(),
} = {}) {
  if (!root || !existsSync(root)) return []
  const stale = []
  try {
    for (const flavor of readdirSync(root)) {
      if (!flavor.endsWith('.code_sign_clone')) continue
      for (const name of readdirSync(join(root, flavor))) {
        const path = join(root, flavor, name)
        if (name.startsWith('code_sign_clone.') && now - statSync(path).mtimeMs > CLONE_MIN_AGE_MS) {
          stale.push({ name, path })
        }
      }
    }
  } catch {
    return []
  }
  if (!stale.length) return []
  const open = readOpen(root)
  if (!open) return []
  const removed = []
  for (const { name, path } of stale) {
    if (open.has(name)) continue
    try {
      rmSync(path, { recursive: true, force: true })
      removed.push(path)
    } catch {
      // The next run tries again.
    }
  }
  if (removed.length) {
    console.warn(
      `[chrome-executable] removed ${removed.length} leftover Chrome bundle ` +
        `${removed.length === 1 ? 'copy (~1.4 GB)' : 'copies (~1.4 GB each)'} from ${root}.`,
    )
  }
  return removed
}

/**
 * Which Chrome to launch: an explicit path (`E2E_CHROME_PATH`, or the
 * caller's own variable), else the first installed macOS flavor, else
 * Playwright's `chrome` channel. On macOS it adds the switches that stop the
 * bundle clone and removes the copies earlier Chromes left; elsewhere it does
 * neither, so CI launches exactly as before.
 *
 * @param {{ explicit?: string }} [options]
 * @returns {{ executablePath?: string, channel?: string, args?: string[] }}
 */
export function chromeExecutable({ explicit } = {}) {
  const mac = process.platform === 'darwin'
  const executablePath =
    explicit ||
    process.env.E2E_CHROME_PATH ||
    // First installed flavor wins: a Chrome update or uninstall must not
    // break a script (it did once, when only Beta was installed).
    (mac ? MAC_CHROMES.find((candidate) => existsSync(candidate)) : undefined)
  const target = executablePath ? { executablePath } : { channel: 'chrome' }
  if (!mac) return target
  reapCodeSignClones()
  return { ...target, args: noCodeSignCloneArgs() }
}
