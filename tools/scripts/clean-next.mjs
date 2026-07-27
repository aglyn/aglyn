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

// Keeps the Next dev caches from eating the disk.
//
// `apps/console/.next/dev/cache/turbopack` grows without bound across a long
// dev session — it reached 126 GB once and 57 GB again before this script
// existed, on a 460 GB volume. Nothing in `.next` is source: it is entirely
// derived from the repo, so the only cost of deleting it is one cold rebuild.
//
//   node tools/scripts/clean-next.mjs                 # report, delete nothing
//   node tools/scripts/clean-next.mjs --prune         # delete when over limit
//   node tools/scripts/clean-next.mjs --prune --force # delete regardless of size
//   node tools/scripts/clean-next.mjs --app=console   # one app only
//
// Wired to each Next app's `serve` target via dependsOn, so it runs at the one
// moment that is always safe: the server for that app is not up yet, and a
// cold build is about to happen anyway. Running it any other time would throw
// away a cache something is actively serving from.
//
// THE GUARD: an app whose `.next` is in use by a running dev server is skipped,
// always — including under --force. "In use" is decided by process working
// directory, not by port, so it still holds for a server started on a custom
// --port. A second checkout (git worktree) has its own `.next`, so it is
// unaffected either way.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync, rmSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const args = process.argv.slice(2)
const flagValue = (name) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]

const prune = args.includes('--prune')
const force = args.includes('--force')
const onlyApp = flagValue('app')
const thresholdGb = Number(
  flagValue('threshold') ?? process.env.NEXT_CACHE_MAX_GB ?? 10,
)

/** `du -sk`, which is far faster than walking the tree in node. */
function sizeKb(path) {
  try {
    const out = execFileSync('du', ['-sk', path], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return Number(out.trim().split(/\s+/)[0]) || 0
  } catch {
    return 0
  }
}

const gb = (kb) => kb / 1024 / 1024
const human = (kb) =>
  kb >= 1024 * 1024
    ? `${gb(kb).toFixed(1)} GB`
    : `${Math.round(kb / 1024)} MB`

/**
 * Working directories of every live `next` process.
 *
 * Keyed on cwd rather than on the port from project.json because a dev server
 * can be started on any port (`nx serve console --port 4300`), and a
 * port-based guard would happily delete the cache out from under one that
 * moved. `lsof -d cwd` is the reliable answer to "which checkout is this
 * process serving".
 */
function runningNextProcesses() {
  let lines = []
  try {
    lines = execFileSync('pgrep', ['-laf', 'next'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
      .trim()
      .split('\n')
      .filter(Boolean)
  } catch {
    // pgrep exits non-zero when nothing matches — no servers running.
    return []
  }
  const processes = []
  for (const line of lines) {
    const pid = line.split(/\s+/)[0]
    const cmd = line.slice(pid.length).trim()
    let cwd = null
    try {
      const out = execFileSync('lsof', ['-a', '-d', 'cwd', '-p', pid, '-Fn'], {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      })
      cwd = out
        .split('\n')
        .find((entry) => entry.startsWith('n'))
        ?.slice(1)
    } catch {
      // Process exited between pgrep and lsof, or we cannot inspect it.
      // Unknown resolves to "blocks everything" — this list is only ever used
      // to REFUSE deletions, so guessing wrong here costs disk, while the
      // other direction costs someone their running server.
      cwd = repoRoot
    }
    processes.push({ cmd, cwd: cwd ?? repoRoot })
  }
  return processes
}

/**
 * Whether a live dev server is serving THIS app's `.next`.
 *
 * A process whose cwd is inside the app directory is unambiguous. The harder
 * case is nx, which serves every app from the repo root — there the cwd says
 * nothing about which app, so the command line decides. Without that
 * discrimination a console server would also block tenant and www, which is
 * safe but means the caches they never clean are the ones that grow.
 */
function isAppInUse(app, processes) {
  return processes.some(({ cmd, cwd }) => {
    if (cwd === app.dir || cwd.startsWith(`${app.dir}/`)) return true
    if (cwd !== repoRoot) return false
    return new RegExp(`(^|[\\s/])${app.name}([\\s/]|$)`).test(cmd)
  })
}

/** Next apps in this repo, from the project.json that owns each serve target. */
function nextApps() {
  const appsDir = join(repoRoot, 'apps')
  const found = []
  for (const name of readdirSync(appsDir)) {
    if (onlyApp && name !== onlyApp) continue
    const projectFile = join(appsDir, name, 'project.json')
    if (!existsSync(projectFile)) continue
    try {
      const project = JSON.parse(readFileSync(projectFile, 'utf8'))
      const serve = project?.targets?.serve
      if (!String(serve?.executor ?? '').includes('next')) continue
      found.push({
        name,
        dir: join(appsDir, name),
        nextDir: join(appsDir, name, '.next'),
        port: serve?.options?.port ?? null,
      })
    } catch {
      // A malformed project.json is not this script's problem to report.
    }
  }
  return found
}

const processes = runningNextProcesses()
const apps = nextApps()
let reclaimedKb = 0
let blocked = 0

for (const app of apps) {
  if (!existsSync(app.nextDir)) continue

  const totalKb = sizeKb(app.nextDir)
  const turbopackKb = sizeKb(join(app.nextDir, 'dev', 'cache', 'turbopack'))
  const detail =
    turbopackKb > 0
      ? `${human(totalKb)} (turbopack cache ${human(turbopackKb)})`
      : human(totalKb)

  const inUse = isAppInUse(app, processes)
  const overLimit = gb(totalKb) >= thresholdGb

  if (!prune) {
    const verdict = inUse
      ? 'in use — would skip'
      : overLimit
        ? 'OVER LIMIT — would prune'
        : 'under limit'
    console.log(`${app.name.padEnd(8)} ${detail.padEnd(34)} ${verdict}`)
    continue
  }

  if (inUse) {
    blocked += 1
    console.log(
      `${app.name}: dev server is running — leaving ${detail} alone.`,
    )
    continue
  }
  if (!overLimit && !force) continue

  rmSync(app.nextDir, { recursive: true, force: true })
  reclaimedKb += totalKb
  console.log(`${app.name}: removed .next, reclaimed ${human(totalKb)}.`)
}

if (!prune) {
  console.log(
    `\nLimit ${thresholdGb} GB. Prune with: node tools/scripts/clean-next.mjs --prune`,
  )
} else if (reclaimedKb > 0) {
  console.log(`Reclaimed ${human(reclaimedKb)} total.`)
}

// Never fail the build this is attached to. A cache that could not be cleaned
// is a disk-space annoyance; a serve target that refuses to start because of
// one is a broken dev loop.
if (blocked > 0 && !prune) process.exitCode = 0
