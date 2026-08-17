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

// Spins up a second checkout for running a dev server alongside the main one
// (AGL-931) — screenshot captures, emulator e2e, verifying a change without
// disturbing whatever the main checkout is serving.
//
//   node tools/scripts/new-worktree.mjs shots
//   node tools/scripts/new-worktree.mjs shots --app=tenant --port=4600
//   node tools/scripts/new-worktree.mjs shots --ref=main --force
//
// This existed only as tribal knowledge before, and each of the three steps
// below is one somebody had already got wrong at least once:
//
// 1. `node_modules` is CLONED with `cp -Rc`, never symlinked. A symlink breaks
//    turbopack's module resolution in ways that surface as unrelated build
//    errors. On APFS the clone is copy-on-write, so it costs almost no disk
//    and takes about a minute.
// 2. The env files are gitignored, so `git worktree add` does not bring them.
//    A worktree without them boots and then throws
//    `FirebaseError: Firebase: Error (auth/invalid-api-key)` at the sign-in
//    page, which reads like a credentials problem rather than a missing file.
// 3. `tsconfig.next.json` is generated, not committed, so it has to be
//    regenerated in the new checkout.
//
// It also prunes the MAIN checkout's Next cache first: a worktree is about to
// clone node_modules and grow a second `.next`, so this is exactly the moment
// the disk is under most pressure. The prune is guarded and will not touch a
// cache a running dev server is using (see clean-next.mjs).

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

const args = process.argv.slice(2)
const flag = (name) =>
  args.find((arg) => arg.startsWith(`--${name}=`))?.split('=')[1]
const name = args.find((arg) => !arg.startsWith('--'))
const app = flag('app') ?? 'console'
const ref = flag('ref') ?? 'HEAD'
const force = args.includes('--force')

if (!name) {
  console.error(
    'Usage: node tools/scripts/new-worktree.mjs <name> [--app=console] ' +
      '[--port=4300] [--ref=HEAD]',
  )
  process.exit(1)
}

const worktree = resolve(repoRoot, '..', `aglyn-wt-${name}`)

/** Default dev ports, so a worktree never collides with the main checkout. */
const DEFAULT_PORTS = { console: 4300, tenant: 4600 }
const port = Number(flag('port') ?? DEFAULT_PORTS[app] ?? 4300)

function run(command, commandArgs, options = {}) {
  return execFileSync(command, commandArgs, {
    stdio: 'inherit',
    cwd: repoRoot,
    ...options,
  })
}

function portInUse(candidate) {
  try {
    execFileSync('lsof', ['-nP', `-iTCP:${candidate}`, '-sTCP:LISTEN', '-t'], {
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return true
  } catch {
    return false
  }
}

if (existsSync(worktree) && !force) {
  console.error(
    `${worktree} already exists. Re-use it, remove it with ` +
      `\`git worktree remove ${worktree}\`, or pass --force.`,
  )
  process.exit(1)
}

// ── 0. Reclaim first ───────────────────────────────────────────────────────
console.log('› pruning the main checkout\'s Next cache')
try {
  run('node', [join('tools', 'scripts', 'clean-next.mjs'), '--prune'])
} catch {
  // A cache that could not be pruned is a disk annoyance, not a reason to
  // refuse to create the worktree.
  console.log('  (prune skipped)')
}

// ── 1. The worktree ────────────────────────────────────────────────────────
if (!existsSync(worktree)) {
  console.log(`› git worktree add ${worktree} (${ref})`)
  run('git', ['worktree', 'add', '--detach', worktree, ref])
}

// ── 2. node_modules, cloned not linked ─────────────────────────────────────
if (existsSync(join(worktree, 'node_modules'))) {
  console.log('› node_modules already present')
} else {
  console.log('› cloning node_modules (cp -Rc, ~1 min, copy-on-write on APFS)')
  run('cp', ['-Rc', join(repoRoot, 'node_modules'), join(worktree, 'node_modules')])
}

// ── 3. The gitignored env files ────────────────────────────────────────────
const ENV_FILES = [
  '.env',
  'apps/console/.env.local',
  'apps/console/.env.development.local',
  'apps/tenant/.env.local',
]
let copied = 0
for (const relative of ENV_FILES) {
  const from = join(repoRoot, relative)
  if (!existsSync(from)) continue
  const to = join(worktree, relative)
  mkdirSync(dirname(to), { recursive: true })
  copyFileSync(from, to)
  copied += 1
}
console.log(`› copied ${copied} env file(s)`)

// ── 4. Generated tsconfigs ─────────────────────────────────────────────────
console.log('› regenerating tsconfig.next.json')
run('node', [join('tools', 'scripts', 'sync-next-tsconfigs.mjs')], {
  cwd: worktree,
})

// ── 5. Hand back a start command that carries the prune ────────────────────
// `nx serve` routes through the app's clean-next-cache dependsOn (AGL-930);
// a bare `npx next dev` does not, which is how the last worktree quietly grew
// a 6 GB cache. So the command printed here is always the nx one.
const collision = portInUse(port)
console.log(`\nWorktree ready: ${worktree}`)
if (collision) {
  console.log(
    `\n! Port ${port} is already in use — pass --port=<free port> or stop ` +
      'whatever is on it before serving.',
  )
}
console.log(
  `\nServe from it with (nx serve, NOT \`next dev\` — only nx carries the\n` +
    `cache prune):\n\n` +
    `  cd ${worktree} && npx nx serve ${app} --port ${port}\n\n` +
    `Emulator-backed instead:\n\n` +
    `  cd ${worktree} && FIREBASE_AUTH_EMULATOR_ENABLED=true ` +
    `FIREBASE_FIRESTORE_EMULATOR_ENABLED=true \\\n` +
    `    FIREBASE_AUTH_EMULATOR_HOST=localhost:9099 ` +
    `FIRESTORE_EMULATOR_HOST=localhost:8082 \\\n` +
    `    npx nx serve ${app} --port ${port}\n\n` +
    `Tear down when finished:\n\n` +
    `  git worktree remove --force ${worktree}\n`,
)
