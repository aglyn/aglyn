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
 */

// Set one secret in the repo-root `.env` and in a Vercel project, from a
// single paste.
//
//   npm run env:set-secret                       # RESEND_WEBHOOK_SECRET
//   npm run env:set-secret -- STRIPE_WEBHOOK_SECRET --project aglyn-tenant
//   npm run env:set-secret -- --local-only       # laptop only, no API call
//   npm run env:set-secret -- --remote-only      # Vercel only, .env untouched
//   pbpaste | npm run env:set-secret             # non-interactive
//
// Exit codes: 0 = written everywhere asked; 1 = refused or failed; 2 = could
// not authenticate to Vercel.
//
// ## THE VALUE IS TYPED, NEVER ARGUED
//
// There is deliberately no `--value` flag. A secret on a command line is in
// the shell history, in the process table for every user on the machine, and
// in any terminal-scrollback capture — and this repo has a memory of secrets
// leaking through the places nobody scans. The prompt reads from the TTY with
// echo off, so a paste leaves nothing behind; piping stdin works for the
// scripted case and is the caller's own decision.
//
// Nothing here ever prints the value back. The confirmation is a length and
// the last four characters, which is enough to tell "I pasted the right one"
// from "I pasted my clipboard's previous contents" and is not enough to be
// worth capturing.
//
// ## PRODUCTION-ONLY BY DEFAULT, AND IT REFUSES TO SPAN
//
// `verify-env-isolation.mjs` fails the build when ONE Vercel record targets
// production and a non-production environment, because a single record has a
// single value — so a spanning record is proof that a laptop and a preview
// hold the production secret. This script cannot create that shape: asking for
// production together with preview or development is refused with the reason,
// rather than quietly producing the thing the other script exists to catch.
//
// Writing the same value into `.env` is NOT that shape and is not refused —
// a local file is not a Vercel record, and `check:env-isolation` cannot see
// it. It is still worth thinking about: for a webhook signing secret the
// clean answer is a SECOND webhook pointed at your tunnel, with its own
// secret, so the laptop never holds production's. The script says so once and
// then does what you asked.

import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync, chmodSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
const API = 'https://api.vercel.com'

/** Keys this script knows something extra about. */
const KNOWN_KEYS = {
  RESEND_WEBHOOK_SECRET: {
    project: 'aglyn-console',
    prefix: 'whsec_',
    // Named so a wrong-project paste is caught before it is stored: the route
    // is registered by `registerMarketingConsoleApi`, so the tenant project
    // has no use for this value at all.
    note:
      'The Resend webhook at https://app.aglyn.com/api/email/events is served ' +
      'by the CONSOLE app. Copy the signing secret from that webhook, not ' +
      'from an API key.',
  },
}

const DEFAULT_KEY = 'RESEND_WEBHOOK_SECRET'
const DEFAULT_PROJECT = 'aglyn-console'

class Fatal extends Error {
  constructor(message, code = 1) {
    super(message)
    this.code = code
  }
}

function parseArgs(argv) {
  const options = {
    key: null,
    project: null,
    environments: [],
    file: join(REPO_ROOT, '.env'),
    local: true,
    remote: true,
  }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    if (arg === '--local-only') options.remote = false
    else if (arg === '--remote-only') options.local = false
    else if (arg === '--project') options.project = argv[++index]
    else if (arg === '--environment') options.environments.push(argv[++index])
    else if (arg === '--file') options.file = resolve(argv[++index])
    else if (arg === '--help' || arg === '-h') options.help = true
    else if (arg.startsWith('-')) throw new Fatal(`unknown flag: ${arg}`)
    else if (!options.key) options.key = arg
    else throw new Fatal(`unexpected argument: ${arg}`)
  }
  options.key = options.key ?? DEFAULT_KEY
  if (!/^[A-Z][A-Z0-9_]*$/.test(options.key)) {
    throw new Fatal(
      `"${options.key}" is not an environment variable name — expected ` +
        'SCREAMING_SNAKE_CASE',
    )
  }
  if (!options.environments.length) options.environments = ['production']
  options.project =
    options.project ?? KNOWN_KEYS[options.key]?.project ?? DEFAULT_PROJECT
  return options
}

/**
 * Refuses the one record shape `verify-env-isolation.mjs` fails the build
 * over. One Vercel record holds one value, so a target spanning production and
 * anything else IS the production secret on a laptop.
 */
function assertEnvironmentsAreIsolated(environments) {
  const valid = new Set(['production', 'preview', 'development'])
  for (const environment of environments) {
    if (!valid.has(environment)) {
      throw new Fatal(
        `"${environment}" is not a Vercel environment — expected production, ` +
          'preview or development',
      )
    }
  }
  if (environments.includes('production') && environments.length > 1) {
    throw new Fatal(
      'refusing to create one record targeting production AND ' +
        `${environments.filter((e) => e !== 'production').join('/')}.\n` +
        '  A Vercel env var is a record with ONE value, so that record would ' +
        'put the production secret\n  on every preview and every laptop that ' +
        'pulls it — which is exactly what `npm run check:env-isolation`\n  ' +
        'fails the build over. Run this once per environment, with a ' +
        'different secret each time.',
    )
  }
}

/**
 * The Vercel API token: `VERCEL_TOKEN` first, then the CLI's own auth file.
 * Same resolution as `verify-env-isolation.mjs` and
 * `verify-production-aliases.mjs`, so one `vercel login` serves all three.
 */
function readVercelToken() {
  if (process.env.VERCEL_TOKEN) return process.env.VERCEL_TOKEN.trim()
  const candidates = [
    join(homedir(), 'Library', 'Application Support', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.local', 'share', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.config', 'com.vercel.cli', 'auth.json'),
    join(homedir(), '.vercel', 'auth.json'),
  ]
  for (const path of candidates) {
    try {
      if (!existsSync(path)) continue
      const token = JSON.parse(readFileSync(path, 'utf8'))?.token
      if (token) return String(token).trim()
    } catch {
      // Unreadable or not JSON — try the next candidate.
    }
  }
  return null
}

/**
 * The team id: `VERCEL_TEAM_ID`, else the `orgId` any linked project in this
 * checkout already records. Every project here belongs to one team, so a
 * sibling app's link file is a correct answer and saves a flag.
 */
function readTeamId() {
  if (process.env.VERCEL_TEAM_ID) return process.env.VERCEL_TEAM_ID.trim()
  for (const path of [
    join(REPO_ROOT, '.vercel', 'project.json'),
    join(REPO_ROOT, 'apps', 'tenant', '.vercel', 'project.json'),
    join(REPO_ROOT, 'apps', 'console', '.vercel', 'project.json'),
  ]) {
    try {
      if (!existsSync(path)) continue
      const orgId = JSON.parse(readFileSync(path, 'utf8'))?.orgId
      if (orgId) return String(orgId).trim()
    } catch {
      // Try the next candidate.
    }
  }
  return null
}

async function api(token, path, init = {}) {
  const response = await fetch(`${API}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      ...init.headers,
    },
  })
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Fatal(
      `${init.method ?? 'GET'} ${path.split('?')[0]} -> HTTP ` +
        `${response.status} ${response.statusText}${detail ? `\n  ${detail.slice(0, 300)}` : ''}`,
    )
  }
  return response.status === 204 ? null : response.json()
}

/**
 * Reads the secret with echo OFF when there is a terminal, and from stdin
 * otherwise so `pbpaste | …` works.
 *
 * Raw mode rather than a muted readline: readline's own echo suppression
 * still leaves the value in its internal line buffer and, on some terminals,
 * in the scrollback for the instant before the redraw.
 */
async function readSecret(promptText) {
  if (!process.stdin.isTTY) {
    const chunks = []
    for await (const chunk of process.stdin) chunks.push(chunk)
    return Buffer.concat(chunks).toString('utf8').trim()
  }

  process.stdout.write(promptText)
  process.stdin.setRawMode(true)
  process.stdin.resume()
  process.stdin.setEncoding('utf8')

  return new Promise((resolvePromise, rejectPromise) => {
    let value = ''
    const finish = (error) => {
      process.stdin.setRawMode(false)
      process.stdin.pause()
      process.stdin.removeListener('data', onData)
      process.stdout.write('\n')
      if (error) rejectPromise(error)
      else resolvePromise(value.trim())
    }
    const onData = (chunk) => {
      for (const character of chunk) {
        if (character === '\r' || character === '\n') return finish()
        // Ctrl-C leaves nothing half-written: no file touched, no API call.
        if (character === '\u0003') return finish(new Fatal('cancelled'))
        if (character === '\u007f' || character === '\b') {
          value = value.slice(0, -1)
          continue
        }
        // Ignore other control characters so a stray escape sequence from a
        // paste cannot end up inside the stored value.
        if (character >= ' ') value += character
      }
    }
    process.stdin.on('data', onData)
  })
}

/**
 * Whether git will actually ignore this path.
 *
 * Asked rather than assumed: the default `.env` is ignored, but `--file` takes
 * any path, and "gitignored" printed over a file that is about to be committed
 * is the one reassurance this script must not give falsely.
 */
function isGitIgnored(path) {
  try {
    execFileSync('git', ['check-ignore', '-q', path], {
      cwd: REPO_ROOT,
      stdio: 'ignore',
    })
    return true
  } catch {
    return false
  }
}

/** Enough to recognise a value, not enough to be worth capturing. */
function fingerprint(value) {
  return `${value.length} chars, ending "…${value.slice(-4)}"`
}

/**
 * Upserts `KEY=value` in a dotenv file, leaving every other line byte-identical.
 *
 * A rewrite of the whole file from a parsed map would drop comments and
 * reorder keys, and this file is hand-maintained and shared with whoever picks
 * up the checkout next.
 */
function upsertEnvFile(path, key, value) {
  const existed = existsSync(path)
  const original = existed ? readFileSync(path, 'utf8') : ''
  // Quote only when the value needs it, so the file keeps the plain look the
  // rest of its lines have.
  const line = /[\s#'"]/.test(value)
    ? `${key}="${value.replace(/(["\\])/g, '\\$1')}"`
    : `${key}=${value}`
  const pattern = new RegExp(`^${key}=.*$`, 'm')

  let next
  let action
  if (pattern.test(original)) {
    next = original.replace(pattern, line)
    action = 'replaced'
  } else {
    const separator = !original || original.endsWith('\n') ? '' : '\n'
    next = `${original}${separator}${line}\n`
    action = existed ? 'appended to' : 'created'
  }

  writeFileSync(path, next, { mode: 0o600 })
  // Tighten an existing file too: a secret store the whole machine can read is
  // worth fixing on the way past, and this file already holds the Firebase
  // private key.
  try {
    chmodSync(path, 0o600)
  } catch {
    // A filesystem that will not take the mode is not a reason to fail.
  }
  return action
}

async function setVercelSecret({ token, teamId, project, key, value, environments }) {
  const team = teamId ? `?teamId=${encodeURIComponent(teamId)}` : ''
  const found = await api(
    token,
    `/v9/projects/${encodeURIComponent(project)}${team}`,
  )
  const projectId = found?.id
  if (!projectId) throw new Fatal(`no Vercel project named "${project}"`)

  const listed = await api(
    token,
    `/v10/projects/${projectId}/env${team}${team ? '&' : '?'}decrypt=false`,
  )
  // Replacing means DELETE then POST. Vercel refuses a second record for one
  // key in one environment, and an in-place PATCH cannot change the target
  // set, so the two-step is the only shape that also fixes a record created
  // with the wrong environments.
  const clashes = (listed?.envs ?? []).filter(
    (record) =>
      record.key === key &&
      (record.target ?? []).some((target) => environments.includes(target)),
  )
  for (const clash of clashes) {
    await api(token, `/v9/projects/${projectId}/env/${clash.id}${team}`, {
      method: 'DELETE',
    })
  }

  await api(token, `/v10/projects/${projectId}/env${team}`, {
    method: 'POST',
    body: JSON.stringify({
      key,
      value,
      type: 'encrypted',
      target: environments,
    }),
  })

  return { projectId, replaced: clashes.length }
}

function usage() {
  process.stdout.write(
    `\nSet one secret in the repo-root .env and in a Vercel project.\n\n` +
      `  npm run env:set-secret                 # ${DEFAULT_KEY}\n` +
      `  npm run env:set-secret -- KEY_NAME\n\n` +
      `  --project <name>        Vercel project (default: ${DEFAULT_PROJECT})\n` +
      `  --environment <env>     production | preview | development, repeatable\n` +
      `                          (default: production; may not span production)\n` +
      `  --file <path>           dotenv file to write (default: <repo>/.env)\n` +
      `  --local-only            write .env, skip Vercel\n` +
      `  --remote-only           write Vercel, leave .env alone\n\n` +
      `The value is typed at a hidden prompt, never passed as an argument.\n` +
      `Pipe stdin to run it non-interactively.\n\n`,
  )
}

async function main() {
  const options = parseArgs(process.argv.slice(2))
  if (options.help) return void usage()
  assertEnvironmentsAreIsolated(options.environments)

  const known = KNOWN_KEYS[options.key]
  process.stdout.write(`\n${options.key}\n`)
  if (known?.note) process.stdout.write(`  ${known.note}\n`)
  process.stdout.write(
    `  local   ${options.local ? options.file.replace(REPO_ROOT + '/', '') : '(skipped)'}\n` +
      `  vercel  ${
        options.remote
          ? `${options.project} · ${options.environments.join(', ')}`
          : '(skipped)'
      }\n\n`,
  )

  // Fail BEFORE the paste, not after: asking for a secret and then discovering
  // there is no credential to use it with means asking for it twice.
  let token = null
  let teamId = null
  if (options.remote) {
    token = readVercelToken()
    if (!token) {
      throw new Fatal(
        'no Vercel token — run `vercel login`, or set VERCEL_TOKEN',
        2,
      )
    }
    teamId = readTeamId()
  }

  const value = await readSecret(`Paste ${options.key} (input hidden): `)
  if (!value) throw new Fatal('nothing pasted — nothing written')
  if (known?.prefix && !value.startsWith(known.prefix)) {
    throw new Fatal(
      `that does not look like a ${options.key}: expected it to start with ` +
        `"${known.prefix}".\n  Nothing was written. Re-run and paste the ` +
        'signing secret itself.',
    )
  }
  process.stdout.write(`  read ${fingerprint(value)}\n\n`)

  if (options.local) {
    const action = upsertEnvFile(options.file, options.key, value)
    const ignored = isGitIgnored(options.file)
    process.stdout.write(
      `  ✓ ${action} ${options.file.replace(REPO_ROOT + '/', '')} ` +
        `(mode 600, ${ignored ? 'gitignored' : 'NOT gitignored'})\n`,
    )
    if (!ignored) {
      process.stdout.write(
        `  ! ${options.file.replace(REPO_ROOT + '/', '')} is not ignored by ` +
          'git — a secret there can be committed. Add it to .gitignore.\n',
      )
    }
  }

  if (options.remote) {
    const { replaced } = await setVercelSecret({
      token,
      teamId,
      project: options.project,
      key: options.key,
      value,
      environments: options.environments,
    })
    process.stdout.write(
      `  ✓ ${replaced ? 'replaced' : 'created'} on ${options.project} · ` +
        `${options.environments.join(', ')}\n`,
    )
    // A Vercel env var reaches a RUNNING deployment only through a new build.
    // Saying so here is the difference between "I set it" and "it is in
    // effect", which is the distinction this repo has been bitten by before.
    process.stdout.write(
      `\n  Not live yet: environment variables reach a deployment at BUILD time.\n` +
        `  Redeploy ${options.project}, then confirm with:\n` +
        `    npm run check:env-isolation\n`,
    )
  }
  process.stdout.write('\n')
}

main().catch((error) => {
  const fatal = error instanceof Fatal
  process.stderr.write(`\n${fatal ? '' : 'unexpected: '}${error.message}\n\n`)
  process.exit(fatal ? error.code : 1)
})
