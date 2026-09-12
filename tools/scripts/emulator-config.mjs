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

// An emulator config on a PRIVATE port set, and the hosts the rest of the
// stack reads (AGL-2834).
//
//   eval "$(node tools/scripts/emulator-config.mjs --offset=10000)"
//   (cd cloud && npx -y firebase-tools@13 emulators:start \
//     --config "$FIREBASE_EMULATOR_CONFIG" --project aglyn-main \
//     --only auth,firestore,storage,database)
//
// Several sessions share one machine, and one of them usually holds the
// emulators' default ports. Every port `cloud/firebase.e2e.json` pins moves by
// the offset: the four emulators, and the hub, logging and Firestore websocket
// ports, which collide just as surely and fail the start.
//
// The config is written to `cloud/`, beside the one it copies, and each rules
// and indexes path in it is relative to that directory (AGL-2858).
// firebase-tools treats the directory of the config it is given as the project
// directory: it joins every such path onto that directory, and refuses a path
// that leads out of it. An absolute path is doubled by the join and a `../`
// path is refused, so the config has to sit in `cloud/` or above it.
//
// stdout is shell, for `eval`: FIRESTORE_EMULATOR_HOST,
// FIREBASE_AUTH_EMULATOR_HOST, FIREBASE_STORAGE_EMULATOR_HOST and
// FIREBASE_DATABASE_EMULATOR_HOST — what `seed:e2e`, both `serve:*:emulated`
// scripts (and through them the page in the browser) and the e2e harness read
// — plus FIREBASE_EMULATOR_CONFIG, the absolute path of the file to start. An
// offset whose ports are already taken is refused, rather than written into a
// stack that half-binds.

import { readFileSync, writeFileSync } from 'node:fs'
import net from 'node:net'
import { dirname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const cloudDir = join(repoRoot, 'cloud')

/** firebase-tools' own default, used when the config pins none. */
const FIRESTORE_WEBSOCKET_DEFAULT_PORT = 9150

const offsetFlag = process.argv
  .slice(2)
  .find((argument) => argument.startsWith('--offset='))
const offset = Number(offsetFlag?.slice('--offset='.length))
if (!Number.isInteger(offset) || offset <= 0) {
  process.stderr.write(
    'Usage: eval "$(node tools/scripts/emulator-config.mjs --offset=10000)"\n',
  )
  process.exit(1)
}

const config = JSON.parse(
  readFileSync(join(cloudDir, 'firebase.e2e.json'), 'utf8'),
)

const file = join(cloudDir, `firebase.e2e.offset-${offset}.json`)

// Each path is written relative to the directory of the file that names it,
// which is the directory firebase-tools resolves it against. `resolve` leaves
// an absolute path naming the file it already named.
for (const [section, keys] of [
  ['firestore', ['rules', 'indexes']],
  ['storage', ['rules']],
  ['database', ['rules']],
]) {
  for (const key of keys) {
    const value = config[section]?.[key]
    if (typeof value === 'string') {
      config[section][key] = relative(dirname(file), resolve(cloudDir, value))
    }
  }
}

const { emulators } = config
const ports = {}
for (const [name, settings] of Object.entries(emulators)) {
  if (typeof settings?.port !== 'number') continue
  settings.port += offset
  ports[name] = settings.port
}
emulators.firestore.websocketPort =
  (emulators.firestore.websocketPort ?? FIRESTORE_WEBSOCKET_DEFAULT_PORT) +
  offset
ports['firestore websocket'] = emulators.firestore.websocketPort

/** Resolves true when nothing is listening on the port. */
function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer()
    server.once('error', () => resolve(false))
    server.once('listening', () => server.close(() => resolve(true)))
    server.listen(port, '127.0.0.1')
  })
}

const taken = []
for (const [name, port] of Object.entries(ports)) {
  if (port > 65535 || !(await portFree(port))) taken.push(`${name} ${port}`)
}
if (taken.length) {
  process.stderr.write(
    `Offset ${offset} collides: ${taken.join(', ')}. Pick another offset.\n`,
  )
  process.exit(1)
}

writeFileSync(file, `${JSON.stringify(config, null, 2)}\n`)

process.stderr.write(
  `Wrote ${file}\n` +
    Object.entries(ports)
      .map(([name, port]) => `  ${name}: ${port}\n`)
      .join(''),
)
const host = (name) => `localhost:${emulators[name].port}`
process.stdout.write(
  [
    `export FIRESTORE_EMULATOR_HOST=${host('firestore')}`,
    `export FIREBASE_AUTH_EMULATOR_HOST=${host('auth')}`,
    `export FIREBASE_STORAGE_EMULATOR_HOST=${host('storage')}`,
    `export FIREBASE_DATABASE_EMULATOR_HOST=${host('database')}`,
    `export FIREBASE_EMULATOR_CONFIG='${file}'`,
  ].join('\n') + '\n',
)
