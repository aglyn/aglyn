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

// What an "emulated" dev server may hold (AGL-2828).
//
// The emulator stack stands in for Firebase and nothing else. The env files a
// dev server reads also carry the keys for Stripe, Vercel, Resend and Google
// Analytics, so a flow that reaches billing, email or domains from a server
// pointed at the emulators still calls the real service with a real key. This
// module decides which variables are such credentials, builds the environment
// the `serve:*:emulated` scripts start `next dev` with (every one of them set
// to ''), and reads a running server's environment back so an e2e preflight
// can refuse a server that still holds one.
//
// Two loaders disagree about an empty variable, and the design follows from
// that disagreement:
//
// - nx's task runner loads env files through dotenv-expand, which treats ''
//   as unset and writes the file's value over it. `STRIPE_SECRET_KEY=` in the
//   launching shell reaches an `nx serve` task holding the key.
// - Next's loader never replaces a variable the process inherited, empty or
//   not. It does fill an UNDEFINED one from the app's env files, inside the
//   server, where `ps` cannot see it.
//
// So the environment is assembled here the way nx assembles it, minus the
// refill, and handed to `next dev` with each credential present and empty.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import dotenv from 'dotenv'

/**
 * A variable name shaped like a credential. Deliberately broad: a new
 * provider's key added to an env file is blanked without anyone listing it,
 * and a secret the emulated servers genuinely need is kept by name below.
 */
const CREDENTIAL_SHAPE =
  /(?:^|_)(?:SECRET|TOKEN|PASSWORD|PRIVATE_KEY|API_KEY|ACCESS_KEY|RESTRICTED_KEY|PUBLISHABLE_KEY|CREDENTIALS?)(?:_|$)/

/**
 * Credential-shaped names an emulated server keeps, each with the reason it
 * reaches no service the emulators do not stand in for. The default for any
 * name not here is empty, so keeping one is a decision with a reason.
 */
export const KEPT_CREDENTIALS = new Map([
  [
    'FIREBASE_PRIVATE_KEY',
    'the Admin SDK does not start without the service account (libs/shared/util/fbserver), and signs media URLs with it locally',
  ],
  ['FIREBASE_PRIVATE_KEY_ID', 'part of the same service account'],
  ['FIREBASE_TOKEN_URI', "Google's token endpoint address, not a secret"],
  [
    'NEXT_PUBLIC_FIREBASE_PUBLIC_API_KEY',
    'the public Firebase web config; the client SDK refuses to start without it, even against the emulators',
  ],
  ['TOKEN_SIGNING_SECRET', 'signs and verifies tokens this app issues to itself'],
  ['CSRF_SECRET', 'verifies requests this server receives'],
  ['MEMBER_SESSION_SECRET', 'signs the site member sessions this server issues'],
  ['EMAIL_UNSUBSCRIBE_SECRET', 'signs the unsubscribe links this app verifies'],
  ['CRON_SECRET', 'verifies scheduler calls this server receives'],
  ['REVALIDATE_SECRET', 'shared between the local console and tenant for revalidation'],
])

/** Whether an emulated server must hold this variable empty. */
export function isOutboundCredential(name) {
  return CREDENTIAL_SHAPE.test(name) && !KEPT_CREDENTIALS.has(name)
}

/**
 * The env files `nx serve <app>` loads for its default configuration, in the
 * order nx gives them precedence (the first file to define a name wins): the
 * project's, then the workspace root's. Mirrors `getEnvPathsForTask` in nx's
 * tasks-runner/task-env-paths. Next reads only the app directory, so a name
 * that lives only in the root `.env` (TOKEN_SIGNING_SECRET) reaches a server
 * through this list or not at all.
 */
export function serveEnvFiles(repoRoot, app, configuration = 'development') {
  const identifiers = [`serve.${configuration}`, configuration, 'serve']
  const variants = (dir) =>
    [
      ...identifiers.flatMap((id) => [
        `.env.${id}.local`,
        `.env.${id}`,
        `.${id}.local.env`,
        `.${id}.env`,
      ]),
      '.env.local',
      '.local.env',
      '.env',
    ].map((file) => join(dir, file))
  return [...variants(join(repoRoot, 'apps', app)), ...variants(repoRoot)]
}

/** Every existing file of `paths`, parsed. Nothing here prints a value. */
export function readEnvFiles(paths) {
  return paths
    .filter((path) => existsSync(path))
    .map((path) => ({ path, parsed: dotenv.parse(readFileSync(path)) }))
}

/** Names some env file gives a non-empty value. */
export function namesWithValues(envFiles) {
  const names = new Set()
  for (const { parsed } of envFiles) {
    for (const [name, value] of Object.entries(parsed)) {
      if (value !== '') names.add(name)
    }
  }
  return names
}

/**
 * The environment an emulated server starts with, and the names of the
 * credentials that held a value before they were set empty.
 *
 * Files fill only what is undefined, never an inherited '', which is the one
 * step where this differs from nx. Then every outbound credential, from a
 * file or from the launching shell, becomes ''. Present and empty is the
 * state Next will not refill from the app's own env files; absent is not.
 */
export function emulatedServeEnvironment(inherited, envFiles) {
  const env = { ...inherited }
  for (const { parsed } of envFiles) {
    for (const [name, value] of Object.entries(parsed)) {
      if (env[name] === undefined) env[name] = value
    }
  }
  const blanked = []
  for (const name of Object.keys(env)) {
    if (!isOutboundCredential(name)) continue
    if (env[name]) blanked.push(name)
    env[name] = ''
  }
  return { env, blanked: blanked.sort() }
}

/**
 * The NAME=value pairs in a line of `ps eww` output, each as 'set' or
 * 'empty'. Values are tested for emptiness and never returned.
 *
 * `ps` joins the command line and the environment with spaces and quotes
 * nothing, so a value can carry text shaped like `NAME=` (npm's
 * `npm_lifecycle_script` holds the script's own shell text). A name reads as
 * 'empty' only when every occurrence of it is empty: a false refusal costs a
 * restart, and a false pass costs a call to the real service.
 */
export function parseProcessEnvironment(text) {
  const states = new Map()
  for (const match of String(text).matchAll(/(?:^|\s)([A-Za-z_][A-Za-z0-9_]*)=(\S?)/g)) {
    if (match[2]) states.set(match[1], 'set')
    else if (!states.has(match[1])) states.set(match[1], 'empty')
  }
  return states
}

/**
 * The outbound credentials a server environment holds: set in it, or absent
 * from it while an env file defines them. Absent counts because a server
 * fills an undefined variable from its env files after it starts, where `ps`
 * cannot see it; only present and empty proves nothing is held.
 */
export function heldCredentials(states, fileNames) {
  const held = new Set()
  for (const [name, state] of states) {
    if (state === 'set' && isOutboundCredential(name)) held.add(name)
  }
  for (const name of fileNames) {
    if (!states.has(name) && isOutboundCredential(name)) held.add(name)
  }
  return [...held].sort()
}

/** PIDs listening on a TCP port on this machine, or null when lsof is missing. */
export function listeningPids(port) {
  try {
    const out = execFileSync('lsof', ['-nP', `-iTCP:${port}`, '-sTCP:LISTEN', '-t'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    })
    return [...new Set(out.split('\n').map(Number).filter(Boolean))]
  } catch (error) {
    // lsof exits 1 when nothing is listening.
    return error?.code === 'ENOENT' ? null : []
  }
}

/** A process as `ps eww` shows it: its parent, then its command line and environment. */
export function readProcess(pid) {
  try {
    const out = execFileSync('ps', ['eww', '-o', 'ppid=,command=', '-p', String(pid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      maxBuffer: 64 * 1024 * 1024,
    })
    const match = /^\s*(\d+)\s+([\s\S]*)$/.exec(out)
    return match ? { pid, ppid: Number(match[1]), command: match[2] } : null
  } catch {
    return null
  }
}

/**
 * The environment a listening server runs with, as the `states` of the
 * process it could be read from, or `{ error }`.
 *
 * Next's dev server retitles itself `next-server (vX)`, and `ps` shows a
 * retitled process as its title with no environment at all. That server is
 * forked by `next dev` with the environment `next dev` started with, plus
 * Next's own NEXT_PRIVATE_* flags, so it is read through that one parent.
 * Through no other: any other launcher could have started it with anything.
 */
export function serverEnvironment(pid, read = readProcess) {
  const listener = read(pid)
  if (!listener) return { error: `exited before its environment could be read (pid ${pid})` }
  const own = parseProcessEnvironment(listener.command)
  if (own.size > 0) return { pid, states: own }
  const parent = read(listener.ppid)
  if (parent && /(?:^|\/)next\s+dev(?:\s|$)/.test(parent.command)) {
    const inherited = parseProcessEnvironment(parent.command)
    if (inherited.size > 0) return { pid: parent.pid, states: inherited }
  }
  return { error: `runs as a process whose environment cannot be read (pid ${pid})` }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Whether the server behind `origin` holds no outbound credential:
 * `{ ok: true, readFrom }`, or `{ ok: false, reason, held? }` where `reason`
 * completes "the <app> server at <origin> ..." and names variables only.
 * A server that cannot be inspected is refused, never assumed clean.
 */
export function credentialPreflight({
  origin,
  app,
  repoRoot,
  listen = listeningPids,
  read = readProcess,
  fileNames,
}) {
  let url
  try {
    url = new URL(origin)
  } catch {
    return { ok: false, reason: 'is not a URL' }
  }
  if (!LOOPBACK.has(url.hostname)) {
    return { ok: false, reason: 'is not on this machine, so the environment it runs with cannot be read' }
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80))
  const pids = listen(port)
  if (pids === null) return { ok: false, reason: 'cannot be matched to a process, because lsof is not installed' }
  if (pids.length === 0) return { ok: false, reason: `has no process listening on port ${port}` }

  const names = fileNames ?? namesWithValues(readEnvFiles(serveEnvFiles(repoRoot, app)))
  const held = new Set()
  const readFrom = []
  for (const pid of pids) {
    const server = serverEnvironment(pid, read)
    if (server.error) return { ok: false, reason: server.error }
    readFrom.push(server.pid)
    for (const name of heldCredentials(server.states, names)) held.add(name)
  }
  if (held.size > 0) {
    const sorted = [...held].sort()
    return { ok: false, reason: `holds ${sorted.join(', ')}`, held: sorted }
  }
  return { ok: true, readFrom }
}

/**
 * An e2e preflight over several servers, keyed by app: `{ ok: true, detail }`
 * naming the process each environment was read from, or `{ ok: false, detail }`
 * with the refusal for the first server that holds an outbound credential or
 * cannot be inspected. `detail` names variables, never a value.
 */
export function serversHoldNoCredential(servers, options = {}) {
  const readFrom = []
  for (const [app, origin] of Object.entries(servers)) {
    const verdict = credentialPreflight({ ...options, origin, app })
    if (!verdict.ok) {
      const remedy = verdict.held
        ? `Start it with \`npm run serve:${app}:emulated\`, which holds every such credential empty; ` +
          'running now could send a billing, email or domain call to the real service.'
        : 'Its environment has to be readable to show it holds no Stripe, Vercel or Resend key; ' +
          `start it on this machine with \`npm run serve:${app}:emulated\`.`
      return { ok: false, detail: `the ${app} server at ${origin} ${verdict.reason}. ${remedy}` }
    }
    readFrom.push(`${app} from pid ${verdict.readFrom.join(', ')}`)
  }
  return { ok: true, detail: `environments read: ${readFrom.join('; ')}` }
}
