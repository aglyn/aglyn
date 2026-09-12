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

// Serves a Next app for the emulator stack, holding no credential for a
// service the emulators do not stand in for (AGL-2828).
//
//   npm run serve:console:emulated                  # port from project.json
//   npm run serve:tenant:emulated -- --port 4510    # any port
//
// The `serve:*:emulated` scripts run this instead of `nx serve <app>` because
// the nx task runner refills a blanked credential: it loads the env files
// through dotenv-expand, which reads an empty variable as unset and writes
// the file's value over it, so `STRIPE_SECRET_KEY=` in the launching shell
// still reaches the server as the key. This script assembles the environment
// nx would, without that step, sets every outbound credential in it to ''
// (lib/emulated-env.mjs), and starts `next dev` with it. Next never replaces
// an inherited variable, even an empty one, so billing, email and domain
// calls fail closed.
//
// What `nx serve` did besides starting `next dev` happens here too: the
// clean-next-cache prune first (its disk floor can refuse to start), the port
// from project.json, and PORT exported to the server.

import { fork, spawnSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { emulatedServeEnvironment, readEnvFiles, serveEnvFiles } from './lib/emulated-env.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const USAGE = 'Usage: node tools/scripts/serve-emulated.mjs <app> [--port <port>]'

function fail(message) {
  console.error(`${message}\n${USAGE}`)
  process.exit(1)
}

let app
let portArg
const args = process.argv.slice(2)
for (let index = 0; index < args.length; index += 1) {
  const arg = args[index]
  if (arg === '--port' || arg === '-p') {
    portArg = args[index + 1]
    index += 1
  } else if (arg.startsWith('--port=')) {
    portArg = arg.slice('--port='.length)
  } else if (!arg.startsWith('-') && app === undefined) {
    app = arg
  } else {
    // An option `nx serve` accepted (a configuration, a hostname) must not be
    // dropped silently and serve something other than what was asked for.
    fail(`Unrecognized argument: ${arg}`)
  }
}
if (!app) fail('No app named.')

const projectFile = join(repoRoot, 'apps', app, 'project.json')
const targets = existsSync(projectFile)
  ? (JSON.parse(readFileSync(projectFile, 'utf8')).targets ?? {})
  : {}
if (!String(targets.serve?.executor ?? '').includes('next')) {
  fail(`apps/${app} has no Next serve target.`)
}
const port = Number(portArg ?? targets.serve.options?.port)
if (!Number.isInteger(port) || port <= 0) fail(`No usable port for ${app}.`)
const prune = targets['clean-next-cache']?.options?.command
if (!prune) fail(`apps/${app} has no clean-next-cache command to run first.`)

/*
 * Modules the bundler can reach (AGL-2860).
 *
 * `git worktree add` leaves `node_modules` a symlink to the checkout the
 * worktree came from, and Turbopack refuses one whose target is outside the
 * project root: `next dev` dies on "Symlink [project]/node_modules is invalid,
 * it points out of the filesystem root" and names no remedy. `--webpack` is
 * not one — it follows the link, the escaped path stops matching the server
 * externals, and the app fails on a Node builtin instead. A worktree inside
 * the checkout is unaffected, because its link stays under that root.
 *
 * Checked here so the answer arrives before the bundler's question.
 */
const modulesDir = join(repoRoot, 'node_modules')
const modulesLink = lstatSync(modulesDir, { throwIfNoEntry: false })
if (modulesLink?.isSymbolicLink()) {
  const target = resolve(repoRoot, readlinkSync(modulesDir))
  if (target !== repoRoot && !target.startsWith(`${repoRoot}/`)) {
    console.error(
      `node_modules links out of this checkout, to ${target}, and the bundler ` +
        'refuses that. Give this worktree modules of its own — on APFS the ' +
        'clone costs seconds and almost no disk:\n' +
        `  rm ${modulesDir} && cp -Rc ${target} ${modulesDir}`,
    )
    process.exit(1)
  }
}

const { env, blanked } = emulatedServeEnvironment(
  process.env,
  readEnvFiles(serveEnvFiles(repoRoot, app)),
)
// `@nx/next:server` exports the port it serves on over any PORT an env file holds.
env.PORT = String(port)

const pruned = spawnSync(prune, { cwd: repoRoot, env, shell: true, stdio: 'inherit' })
if (pruned.status !== 0) process.exit(pruned.status ?? 1)

console.log(
  `serve-emulated: ${app} on port ${port}; ${blanked.length} outbound credential(s) set empty` +
    (blanked.length > 0 ? `: ${blanked.join(', ')}` : ''),
)

const nextBin = createRequire(import.meta.url).resolve('next/dist/bin/next')
const server = fork(nextBin, ['dev', '--port', String(port)], {
  cwd: join(repoRoot, 'apps', app),
  env,
  stdio: 'inherit',
})

let stopping = false
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    stopping = true
    if (server.exitCode === null && server.signalCode === null) server.kill(signal)
  })
}
server.on('exit', (code) => process.exit(code ?? (stopping ? 0 : 1)))
