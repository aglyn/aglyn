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

// The guided AI site start, end to end, on the emulator stack with the REAL
// model (AGL-3596).
//
//   npm run e2e:ai-guided-start:local
//   npm run e2e:ai-guided-start:local -- --runs 2 --brief "A bakery in Tulsa"
//   npm run e2e:ai-guided-start:local -- --app-root ../aglyn-wt-integration
//
// What a new customer does, as one: a fresh Free workspace and owner, Sites →
// Create site → Start with AI → the answers → Plan my site → the "Building
// your site" page until the job settles. Then the run asks the documents and
// the published site what was built, and writes summary.json, summary.md and
// the screenshots to the output directory.
//
// Three production failures in a row shipped because every spec fed the site
// job hand-written plans (docs/AI_JOBS.md, "Running a guided start locally").
// This is the run that catches the next one before a promotion does.
//
// ## The stack it stands up, and what it reuses
//
// - Emulators: the ones FIRESTORE_EMULATOR_HOST and
//   FIREBASE_AUTH_EMULATOR_HOST name when both answer; otherwise a private
//   set on `--offset` (emulator-config.mjs), started and stopped here.
// - Console: `serve-emulated.mjs console --live-ai` on `--console-port`, the
//   one emulated server allowed the AI provider key, with a local CRON_SECRET.
//   `--console-url` reuses a running one, which the preflight must still find
//   holding nothing but that key.
// - Tenant: `serve-emulated.mjs tenant` on 4500, the one port its middleware
//   routes `<site>.localhost` on. `--tenant-url` reuses a running one.
// - The beat: Cloud Scheduler's minute call, every 5 s while a job is due
//   (tools/scripts/lib/ai-jobs-beat-pump.mjs).
//
// `--app-root <checkout>` serves another checkout's console and tenant (a
// worktree that merges the fixes under test), through THIS checkout's
// serve-emulated.mjs, so the branch under test needs no `--live-ai` of its
// own. That checkout needs its own `node_modules` and env files
// (docs/E2E_LOCAL.md).
//
// ## What it costs
//
// Every job reserves its credits before its first provider call and spends
// no more than it reserved, and a Free workspace holds a few hundred credits:
// one run is a few hundred credits, well under a dollar of model time.
// `--runs` multiplies that.

import { execFileSync, spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import {
  closeSync,
  createWriteStream,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import net from 'node:net'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  countDueAiJobs,
  startAiJobsBeatPump,
} from '../scripts/lib/ai-jobs-beat-pump.mjs'
import {
  LIVE_AI_CREDENTIALS,
  LOCAL_CRON_SECRET,
  listeningPids,
  readProcess,
  serverEnvironment,
  serversHoldNoCredential,
} from '../scripts/lib/emulated-env.mjs'
import { readLegalDocumentVersion } from '../scripts/lib/legal-document-version.mjs'
import {
  AI_JOB_SETTLED_STATUSES,
  analyzeProgress,
  boundFormIds,
  decodedDocument,
  distinctSnapshots,
  linksTo,
  seoTextVerdict,
  summaryMarkdown,
} from './lib/ai-guided-start-report.mjs'

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')

/*==========================================
 * OPTIONS
 *=========================================*/

const argv = process.argv.slice(2)
function option(name, fallback) {
  const inline = argv.find((arg) => arg.startsWith(`--${name}=`))
  if (inline) return inline.slice(name.length + 3)
  const index = argv.indexOf(`--${name}`)
  if (
    index >= 0 &&
    argv[index + 1] !== undefined &&
    !argv[index + 1].startsWith('--')
  )
    return argv[index + 1]
  return fallback
}
const flag = (name) => argv.includes(`--${name}`)

if (flag('help')) {
  console.log(`Usage: npm run e2e:ai-guided-start:local -- [options]

  --brief <text>          What kind of site (default "A dog groomer in Austin"); several
                          separated by " || " are used in turn, one a run, so two runs
                          of two briefs show two sites' looks side by side
  --audience <text>       Who it is for (default "Local dog owners")
  --style <label|id>      Style of site, or "auto" for the one the brief suggests (default auto)
  --submissions <id>      inbox | lead (default inbox)
  --pages <n>             Pages to plan (default 2, the Free maximum; 4 on a paid --plan)
  --plan <id>             The workspace's plan: free (default) or a paid one such as pro,
                          with the AI add-on, so a run can reach paid-only parts — a
                          blog's first posts, a store's first products (AGL-3676)
  --site-name <text>      The site's name (default "Hillside Dog Grooming"); " || " as --brief
  --runs <n>              Fresh workspace + site per run (default 1)
  --app-root <checkout>   Serve this checkout's console and tenant (default this one)
  --out <dir>             Output directory (default tmp/ai-guided-start/<timestamp>)
  --offset <n>            Emulator port offset when none is running (default 23000)
  --console-port <n>      Console port to start on (default 4610)
  --console-url <url>     Reuse a running --live-ai console instead
  --tenant-url <url>      Reuse a running emulated tenant (must be on :4500)
  --timeout-min <n>       Give up on a job after this long (default 25)
  --shot-every-s <n>      Build page screenshot interval (default 20)
  --warm-min <n>          Give up on a cold dev-server compile after this long (default 15)
  --keep                  Leave what this run started running`)
  process.exit(0)
}

/** Several briefs or names, " || " apart: one a run, in turn (AGL-3660). */
const several = (text) => text.split(/\s*\|\|\s*/).filter(Boolean)
const briefs = several(option('brief', 'A dog groomer in Austin'))
const siteNames = several(option('site-name', 'Hillside Dog Grooming'))
const answers = {
  siteType: briefs[0],
  audience: option('audience', 'Local dog owners'),
  style: option('style', 'auto'),
  submissions: option('submissions', 'inbox'),
  pages: Number(option('pages', option('plan', 'free') === 'free' ? '2' : '4')),
}
const workspacePlan = option('plan', 'free')
let siteName = siteNames[0]
const runs = Math.max(1, Number(option('runs', '1')))
const appRoot = resolve(option('app-root', repoRoot))
const startedAt = new Date().toISOString()
const outDir = resolve(
  option(
    'out',
    join(repoRoot, 'tmp', 'ai-guided-start', startedAt.replace(/[:.]/g, '-')),
  ),
)
const offset = Number(option('offset', '23000'))
const consolePort = Number(option('console-port', '4610'))
const consoleUrlArg = option('console-url', '')
const tenantUrlArg = option('tenant-url', '')
const timeoutMs = Number(option('timeout-min', '25')) * 60_000
const shotEveryMs = Number(option('shot-every-s', '20')) * 1000
const warmMs = Number(option('warm-min', '15')) * 60_000
const keep = flag('keep')
const TENANT_PORT = 4500
const PASSWORD = 'E2e-Password-1'

mkdirSync(outDir, { recursive: true })
const log = (line) =>
  console.log(`[${new Date().toISOString().slice(11, 19)}] ${line}`)

/*==========================================
 * THE STACK
 *=========================================*/

/** Processes this run started, stopped at exit unless `--keep`. */
const started = []
/** The command that runs again on what `--keep` left up. */
let reuseHint = ''

function startProcess(name, command, args, { cwd, env, onStop, ports }) {
  const logFile = join(outDir, `${name}.log`)
  // The server writes to its log file itself, never to a pipe this run reads
  // (AGL-3660). Under --keep the servers outlive the run, and a pipe dies with
  // it: the next line a server logged failed with EPIPE, Next's error handler
  // logged that failure to the same dead pipe, and the tenant spun at full CPU
  // answering nothing.
  const fd = openSync(logFile, 'w')
  const child = spawn(command, args, {
    cwd,
    env,
    detached: true,
    stdio: ['ignore', fd, fd],
  })
  closeSync(fd)
  started.push({ name, child, onStop, ports })
  log(`started ${name} (pid ${child.pid}), log ${logFile}`)
  return child
}

/** Resolves once the child has exited, or after `ms`. */
function exited(child, ms) {
  if (child.exitCode !== null || child.signalCode !== null)
    return Promise.resolve()
  return new Promise((done) => {
    const timer = setTimeout(done, ms)
    child.once('exit', () => {
      clearTimeout(timer)
      done()
    })
  })
}

/**
 * Stops what this run started: SIGINT to each process group, SIGKILL to one
 * still up after 30 s, then any emulator JVM still holding one of this run's
 * ports — firebase-tools starts each in a process group of its own, and one
 * outlived its launcher on a loaded machine.
 */
async function stopStarted() {
  if (keep) {
    if (started.length)
      log(
        `--keep: left running ${started.map((entry) => `${entry.name} (pid ${entry.child.pid})`).join(', ')}; ` +
          `run again on them with\n  ${reuseHint}`,
      )
    return
  }
  for (const { name, child, onStop, ports = [] } of started.reverse()) {
    if (child.exitCode === null) {
      try {
        process.kill(-child.pid, 'SIGINT')
        await exited(child, 30_000)
        if (child.exitCode === null && child.signalCode === null) {
          process.kill(-child.pid, 'SIGKILL')
        }
        log(`stopped ${name}`)
      } catch {
        // Already gone.
      }
    }
    for (const port of ports) {
      for (const pid of listeningPids(port) ?? []) {
        if (
          /\.cache\/firebase\/emulators|firebase-tools/.test(
            readProcess(pid)?.command ?? '',
          )
        ) {
          process.kill(pid, 'SIGKILL')
          log(`stopped a stray emulator on port ${port} (pid ${pid})`)
        }
      }
    }
    onStop?.()
  }
  started.length = 0
}

function isListening(hostPort, timeoutMs = 700) {
  const [host, port] = hostPort.replace('localhost', '127.0.0.1').split(':')
  return new Promise((done) => {
    const socket = new net.Socket()
    const finish = (result) => {
      socket.destroy()
      done(result)
    }
    socket.setTimeout(timeoutMs)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
    socket.connect(Number(port), host)
  })
}

async function waitUntil(what, test, { timeoutMs: limit, everyMs = 1000 }) {
  const deadline = Date.now() + limit
  while (Date.now() < deadline) {
    if (await test()) return
    await new Promise((done) => setTimeout(done, everyMs))
  }
  throw new Error(`timed out waiting for ${what}`)
}

/** The emulator hosts, reusing a running set or starting a private one. */
async function ensureEmulators() {
  const named = {
    firestore: process.env.FIRESTORE_EMULATOR_HOST,
    auth: process.env.FIREBASE_AUTH_EMULATOR_HOST,
    storage: process.env.FIREBASE_STORAGE_EMULATOR_HOST,
    database: process.env.FIREBASE_DATABASE_EMULATOR_HOST,
  }
  if (
    named.firestore &&
    named.auth &&
    (await isListening(named.firestore)) &&
    (await isListening(named.auth))
  ) {
    log(
      `reusing the emulators at firestore ${named.firestore}, auth ${named.auth}`,
    )
    return {
      ...named,
      storage: named.storage ?? 'localhost:9199',
      database: named.database ?? 'localhost:9000',
    }
  }
  const exports = execFileSync(
    'node',
    [join(repoRoot, 'tools/scripts/emulator-config.mjs'), `--offset=${offset}`],
    {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'inherit'],
    },
  )
  const value = (name) =>
    new RegExp(`export ${name}='?([^'\\n]+)'?`).exec(exports)?.[1]
  const hosts = {
    firestore: value('FIRESTORE_EMULATOR_HOST'),
    auth: value('FIREBASE_AUTH_EMULATOR_HOST'),
    storage: value('FIREBASE_STORAGE_EMULATOR_HOST'),
    database: value('FIREBASE_DATABASE_EMULATOR_HOST'),
  }
  const config = value('FIREBASE_EMULATOR_CONFIG')
  startProcess(
    'emulators',
    'npx',
    [
      '-y',
      'firebase-tools@13',
      'emulators:start',
      '--config',
      config,
      '--project',
      'aglyn-main',
      '--only',
      'auth,firestore,storage,database',
    ],
    {
      cwd: join(repoRoot, 'cloud'),
      env: process.env,
      // The private config is this run's; the emulators read it at start.
      onStop: () => rmSync(config, { force: true }),
      ports: Object.values(hosts).map((host) => Number(host.split(':').pop())),
    },
  )
  await waitUntil(
    'the emulators',
    async () =>
      (await isListening(hosts.firestore)) && (await isListening(hosts.auth)),
    {
      timeoutMs: 420_000,
    },
  )
  log(`emulators up: firestore ${hosts.firestore}, auth ${hosts.auth}`)
  return hosts
}

function serveEnv(hosts, extra = {}) {
  return {
    ...process.env,
    FIREBASE_AUTH_EMULATOR_ENABLED: 'true',
    FIREBASE_FIRESTORE_EMULATOR_ENABLED: 'true',
    FIREBASE_DATABASE_EMULATOR_ENABLED: 'true',
    FIREBASE_STORAGE_EMULATOR_ENABLED: 'true',
    FIREBASE_AUTH_EMULATOR_HOST: hosts.auth,
    FIRESTORE_EMULATOR_HOST: hosts.firestore,
    FIREBASE_DATABASE_EMULATOR_HOST: hosts.database,
    FIREBASE_STORAGE_EMULATOR_HOST: hosts.storage,
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: hosts.auth,
    NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: hosts.firestore,
    NEXT_PUBLIC_FIREBASE_DATABASE_EMULATOR_HOST: hosts.database,
    ...extra,
  }
}

/**
 * Waits for a server to answer, or throws at once when the process this run
 * started for it has exited — a refusal such as the dev-disk floor would
 * otherwise read as a fifteen-minute compile.
 */
async function warm(url, what, name) {
  log(`warming ${what} (${url}); a cold compile can take minutes`)
  const own = started.find((entry) => entry.name === name)?.child
  await waitUntil(
    what,
    async () => {
      if (own && own.exitCode !== null) {
        const tail = readFileSync(join(outDir, `${name}.log`), 'utf8')
          .trim()
          .split('\n')
          .slice(-12)
          .join('\n')
        throw new Error(
          `${what} exited (${own.exitCode}) before it answered:\n${tail}`,
        )
      }
      try {
        const response = await fetch(url, {
          signal: AbortSignal.timeout(240_000),
        })
        return response.status < 500
      } catch {
        return false
      }
    },
    { timeoutMs: warmMs, everyMs: 3000 },
  )
}

const revalidateSecret = `local-${randomBytes(6).toString('hex')}`

async function ensureServers(hosts) {
  let consoleUrl = consoleUrlArg
  if (!consoleUrl) {
    if (await isListening(`localhost:${consolePort}`)) {
      throw new Error(
        `port ${consolePort} is taken; pass --console-url to reuse that console or --console-port for another`,
      )
    }
    startProcess(
      'console',
      'node',
      [
        join(repoRoot, 'tools/scripts/serve-emulated.mjs'),
        'console',
        '--port',
        String(consolePort),
        '--live-ai',
        '--root',
        appRoot,
      ],
      {
        cwd: appRoot,
        env: serveEnv(hosts, {
          CRON_SECRET: LOCAL_CRON_SECRET,
          REVALIDATE_SECRET: revalidateSecret,
        }),
      },
    )
    consoleUrl = `http://localhost:${consolePort}`
  }
  let tenantUrl = tenantUrlArg
  if (!tenantUrl) {
    if (await isListening(`localhost:${TENANT_PORT}`)) {
      throw new Error(
        `port ${TENANT_PORT} is taken, and the tenant routes <site>.localhost only there; ` +
          'pass --tenant-url http://localhost:4500 to reuse that tenant if it is an emulated one on this stack',
      )
    }
    startProcess(
      'tenant',
      'node',
      [
        join(repoRoot, 'tools/scripts/serve-emulated.mjs'),
        'tenant',
        '--port',
        String(TENANT_PORT),
        '--root',
        appRoot,
      ],
      {
        cwd: appRoot,
        env: serveEnv(hosts, { REVALIDATE_SECRET: revalidateSecret }),
      },
    )
    tenantUrl = `http://localhost:${TENANT_PORT}`
  }
  await warm(`${consoleUrl}/signin`, 'the console', 'console')
  await warm(`${tenantUrl}/`, 'the tenant', 'tenant')

  // Nothing but the AI provider key on the console, nothing at all on the
  // tenant: the same refusal the DAM spec makes, with the one allowance.
  const verdict = serversHoldNoCredential(
    { console: consoleUrl, tenant: tenantUrl },
    { repoRoot: appRoot, allow: { console: [...LIVE_AI_CREDENTIALS.keys()] } },
  )
  if (!verdict.ok) throw new Error(`credential preflight: ${verdict.detail}`)
  log(`credential preflight: ${verdict.detail}`)
  // And the console has to hold the key, or every step fails as unavailable.
  const pid = listeningPids(Number(new URL(consoleUrl).port))?.[0]
  const environment = pid
    ? serverEnvironment(pid)
    : { error: 'nothing listening' }
  const holdsKey =
    !environment.error &&
    [...LIVE_AI_CREDENTIALS.keys()].some(
      (name) => environment.states.get(name) === 'set',
    )
  if (!holdsKey) {
    throw new Error(
      `the console at ${consoleUrl} holds no AI provider key; start it with ` +
        '`npm run serve:console:emulated -- --live-ai` (or let this harness start it)',
    )
  }
  return { consoleUrl, tenantUrl }
}

/*==========================================
 * ONE RUN
 *=========================================*/

function gitRef(root) {
  try {
    const branch = execFileSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    const sha = execFileSync('git', ['rev-parse', '--short', 'HEAD'], {
      cwd: root,
      encoding: 'utf8',
    }).trim()
    return `${branch} @ ${sha}`
  } catch {
    return null
  }
}

/** Every document under a host, by subcollection, with each screen's and layout's versions. */
async function readHost(firestore, hostId) {
  const hostRef = firestore.collection('hosts').doc(hostId)
  const host = await hostRef.get()
  const collections = {}
  for (const name of ['screens', 'layouts', 'forms', 'components']) {
    const snapshot = await hostRef.collection(name).get()
    collections[name] = []
    for (const doc of snapshot.docs) {
      const entry = { id: doc.id, data: decodedDocument(doc.data()) }
      if (name === 'screens' || name === 'layouts') {
        const versions = await doc.ref.collection('versions').get()
        entry.versions = versions.docs.map((version) => ({
          id: version.id,
          data: decodedDocument(version.data()),
        }))
      }
      collections[name].push(entry)
    }
  }
  return {
    exists: host.exists,
    data: decodedDocument(host.data() ?? null),
    ...collections,
  }
}

const currentVersion = (entry) =>
  entry.versions?.find((version) => version.id === entry.data.versionId) ??
  entry.versions?.at(-1) ??
  null

async function readBuildPage(page) {
  return page.evaluate(() => {
    const text = (node) => (node?.textContent ?? '').replace(/\s+/g, ' ').trim()
    const list = document.querySelector('ol[aria-label="Progress"]')
    const rows = list
      ? [...list.querySelectorAll('li')].map((li) => {
          const active = li.querySelector('[role="progressbar"]')
          const icon = li.querySelector('[role="img"][aria-label]')
          const label = text(li.querySelector('.MuiTypography-root'))
          const raw = active
            ? 'active'
            : (icon?.getAttribute('aria-label') ?? 'unknown')
          const state =
            {
              Done: 'done',
              Waiting: 'waiting',
              Stopped: 'failed',
              'Not built': 'skipped',
            }[raw] ?? raw.toLowerCase()
          return { label, state, text: text(li).slice(0, 300) }
        })
      : []
    const heading = text(document.querySelector('main h1, h1'))
    const alerts = [...document.querySelectorAll('[role="alert"]')]
      .map(text)
      .filter((value) => value && !/emulator/i.test(value))
    const credits =
      [...document.querySelectorAll('p, span')]
        .map(text)
        .find(
          (value) =>
            /\bcredits?\b/i.test(value) &&
            /\d/.test(value) &&
            value.length < 220,
        ) ?? null
    return { heading, rows, alerts, credits }
  })
}

async function shoot(page, path, options = {}) {
  await page
    .evaluate(() => {
      for (const selector of [
        '.firebase-emulator-warning',
        'nextjs-portal',
        '#__next-build-watcher',
      ]) {
        document
          .querySelectorAll(selector)
          .forEach((element) => element.remove())
      }
    })
    .catch(() => undefined)
  await page.screenshot({ path, ...options })
  return path
}

async function runOnce(context, index) {
  const { session, firestore, auth, consoleUrl } = context
  const runId = `${Date.now().toString(36)}${randomBytes(2).toString('hex')}`
  const runDir = join(outDir, `run-${index + 1}`)
  mkdirSync(runDir, { recursive: true })
  const run = {
    runId,
    verdict: 'INCOMPLETE',
    orgSlug: `hillside-${runId}`,
    subdomain: `hillside-${runId}`,
    orgId: null,
    hostId: null,
    jobId: null,
    checks: {},
    shots: [],
    timeline: [],
  }
  const check = (name, ok, detail = '') => {
    run.checks[name] = { ok, detail }
    log(
      `${ok === true ? 'PASS' : ok === false ? 'FAIL' : 'N/A '} ${name}${detail ? ` — ${detail}` : ''}`,
    )
  }
  const shot = async (page, name, options) => {
    const path = await shoot(page, join(runDir, `${name}.png`), options)
    run.shots.push(path)
    return path
  }

  // 1. A brand-new customer: an account, then a workspace through the real door.
  const uid = `ai-guided-${runId}`
  const email = `${uid}@aglyn.test`
  await auth.createUser({
    uid,
    email,
    password: PASSWORD,
    emailVerified: true,
    displayName: 'Guided Start Owner',
  })
  const legalVersion = readLegalDocumentVersion()
  await firestore
    .collection('users')
    .doc(uid)
    .collection('legalAcceptances')
    .doc(legalVersion)
    .set({
      version: legalVersion,
      documents: [],
      method: 'clickwrap',
      context: 'ai-guided-start-local',
      acceptedAt: new Date(),
      ipAddress: null,
      userAgent: null,
      updatedAt: new Date(),
    })
  const created = await session.postAsUser(uid, '/api/orgs/create', {
    name: siteName,
    slug: run.orgSlug,
  })
  if (created.status !== 200 || !created.body?.orgId) {
    throw new Error(
      `workspace creation answered ${created.status}: ${JSON.stringify(created.body).slice(0, 300)}`,
    )
  }
  record(run, { orgId: created.body.orgId })
  // Production releases the generative doors through Remote Config; the
  // emulator stack has none, so the workspace carries the per-org override.
  await firestore
    .collection('orgs')
    .doc(run.orgId)
    .set({ releaseFlags: { release_ai_generative: true } }, { merge: true })
  // A paid plan, as billing would leave it (AGL-3676): the emulator stack has
  // no Stripe, so the plan and the AI add-on are written the way staff comp one.
  if (workspacePlan !== 'free') {
    await firestore
      .collection('orgs')
      .doc(run.orgId)
      .set(
        { plan: workspacePlan, seatAddons: { aiAddon: 1 }, releaseFlags: { release_commerce_v2: true } },
        { merge: true },
      )
  }
  log(
    `run ${index + 1}: workspace ${run.orgSlug} (org ${run.orgId}, ${workspacePlan}), owner ${email}`,
  )

  const { browser, page } = await session.openConsole({
    email,
    password: PASSWORD,
    viewport: { width: 1440, height: 900 },
  })
  const runStart = Date.now()
  let pump = null
  try {
    // 2. Sites → Create site.
    await page.goto(`${consoleUrl}/${run.orgSlug}/hosts`, {
      waitUntil: 'domcontentloaded',
      timeout: 120_000,
    })
    await page
      .getByRole('button', { name: 'Create site' })
      .first()
      .click({ timeout: 120_000 })
    const dialog = page.getByRole('dialog', { name: 'Create a new site' })
    await dialog.getByLabel('Site name').fill(siteName)
    await dialog.getByLabel('Subdomain').fill(run.subdomain)
    await shot(page, '01-create-site')
    await dialog.getByRole('button', { name: 'Create site' }).click()
    await page.waitForURL((url) => url.searchParams.get('start') === 'site', {
      timeout: 120_000,
    })

    const hostSnapshot = await firestore
      .collection('hosts')
      .where('subdomain', '==', run.subdomain)
      .limit(1)
      .get()
    record(run, { hostId: hostSnapshot.docs[0]?.id ?? null })
    if (!run.hostId)
      throw new Error(`no host document for subdomain ${run.subdomain}`)
    const born = await readHost(firestore, run.hostId)
    const bornScreens = born.screens.filter(
      (screen) => screen.data.deletedAt == null,
    )
    check(
      'site empty at creation',
      bornScreens.length === 0 &&
        born.layouts.length === 0 &&
        Object.keys(born.data?.screens ?? {}).length === 0,
      `${bornScreens.length} page(s), ${born.layouts.length} layout(s), ${born.forms.length} form(s), routes ${JSON.stringify(born.data?.screens ?? {})}`,
    )

    // 3. Start with AI, and the answers.
    const startWithAi = page.getByRole('button', { name: /Start with AI/ })
    await startWithAi.waitFor({ timeout: 120_000 })
    await shot(page, '02-start-choice')
    await startWithAi.click()
    await page
      .getByLabel('What kind of site are you creating?')
      .fill(answers.siteType)
    if (answers.audience)
      await page.getByLabel('Who is it for?').fill(answers.audience)
    // The style of site (AGL-3660): the one the brief suggests is already
    // picked; a named one is clicked.
    if (answers.style && answers.style !== 'auto') {
      await page
        .getByRole('radio', {
          name: new RegExp(`^(?:${escapeRegExp(answers.style)})`, 'i'),
        })
        .first()
        .click()
    }
    record(run, {
      style: await page
        .getByRole('radio', { checked: true })
        .first()
        .getAttribute('aria-label')
        .catch(() => null),
    })
    await pickOption(
      page,
      'Where do form submissions go?',
      answers.submissions === 'lead' ? /^The Inbox, and CRM/ : /^The Inbox —/,
    )
    await pickOption(page, 'Pages', new RegExp(`^${answers.pages}$`))
    // The Pages menu closes on a transition; the frame is the form, not it.
    await page.waitForTimeout(600)
    await shot(page, '03-answers', { fullPage: true })

    // 4. The beat runs from here on, as the scheduler would.
    pump = startAiJobsBeatPump({
      origin: consoleUrl,
      secret: LOCAL_CRON_SECRET,
      everyMs: 5_000,
      due: () => countDueAiJobs(firestore),
      log: (line) =>
        context.beatLog.write(`${new Date().toISOString()} ${line}\n`),
    })

    await page.getByRole('button', { name: 'Plan my site' }).click()
    await page.waitForURL((url) => /\/ai-jobs\/[^/]+$/.test(url.pathname), {
      timeout: 180_000,
    })
    record(run, {
      jobId: decodeURIComponent(new URL(page.url()).pathname.split('/').pop()),
    })
    log(`run ${index + 1}: job ${run.jobId}`)
    const jobRef = firestore
      .collection('orgs')
      .doc(run.orgId)
      .collection('aiJobs')
      .doc(run.jobId)

    // 5. The build page, watched until the job settles.
    const snapshots = []
    let lastShot = 0
    let shots = 0
    let job = null
    const watchStart = Date.now()
    while (Date.now() - watchStart < timeoutMs) {
      job = (await jobRef.get()).data() ?? null
      const view = await readBuildPage(page).catch(() => null)
      if (view)
        snapshots.push({
          atMs: Date.now() - watchStart,
          jobStatus: job?.status ?? null,
          ...view,
        })
      if (Date.now() - lastShot >= shotEveryMs) {
        lastShot = Date.now()
        shots += 1
        await shot(page, `10-build-${String(shots).padStart(2, '0')}`).catch(
          () => undefined,
        )
      }
      if (job && AI_JOB_SETTLED_STATUSES.includes(job.status)) break
      await page.waitForTimeout(1500)
    }
    // The page's own last word, after the job's.
    await page.waitForTimeout(4000)
    job = (await jobRef.get()).data() ?? job
    const finalView = await readBuildPage(page).catch(() => null)
    if (finalView)
      snapshots.push({
        atMs: Date.now() - watchStart,
        jobStatus: job?.status ?? null,
        ...finalView,
      })
    await shot(page, '19-build-final', { fullPage: true })
    await pump.stop()
    pump = null
    record(run, { durationS: Math.round((Date.now() - runStart) / 1000) })
    record(run, { job })
    writeFileSync(join(runDir, 'job.json'), JSON.stringify(job, null, 2))

    const timeline = distinctSnapshots(snapshots)
    record(run, {
      timeline: timeline.map(({ atMs, jobStatus, heading, rows, alerts }) => ({
        atMs,
        jobStatus,
        heading,
        rows,
        alerts,
      })),
    })
    record(run, { progress: analyzeProgress(timeline) })
    check(
      'job settled',
      job?.status === 'done',
      job
        ? `${job.status}${job.error ? `: ${job.error}` : ''}${job.review?.reason ? ` (review: ${job.review.reason})` : ''}`
        : 'no job document',
    )
    check(
      'active row always present while working',
      run.progress.activeRowAlwaysWhileWorking,
      `${run.progress.workingWithoutActive.length} of ${run.progress.workingSnapshots} working state(s) had none`,
    )
    check(
      'look row shown first and active',
      run.progress.lookRowSeen ? run.progress.lookRowFirst && run.progress.lookRowActive : false,
      run.progress.lookRowSeen
        ? `first: ${run.progress.lookRowFirst}, active: ${run.progress.lookRowActive}`
        : 'no "Designing your look" row on the page',
    )
    check(
      'look row keeps its credits once done',
      run.progress.lookRowSeen ? run.progress.lookCreditsKept : null,
      run.progress.lookRowLast ?? '',
    )
    check(
      'form row shown as active',
      run.progress.formRowSeen ? run.progress.formRowActive : null,
      run.progress.formRowSeen ? '' : 'no form row on the page',
    )
    check(
      'nothing read failed/stopped/error mid-run',
      run.progress.troubleMidRun.length === 0,
      run.progress.troubleMidRun
        .map(
          (entry) =>
            `+${Math.round(entry.atMs / 1000)}s ${[entry.heading, ...entry.alerts, ...entry.rows.map((row) => `${row.label}=${row.state}`)].filter(Boolean).join('; ')}`,
        )
        .join(' | '),
    )

    // 6. What the job says it did.
    record(run, {
      items: (job?.items ?? []).map((item) => ({
        label: item.label,
        op: item.op,
        status: item.status,
        creditsSpent: item.creditsSpent ?? 0,
        creditsRefunded: item.creditsRefunded ?? 0,
        failure: item.failure?.message ?? null,
        note: item.note ?? null,
      })),
    })
    // `degraded` built, with a part left out on purpose; the rest did not.
    const failedItems = run.items.filter(
      (item) => item.status !== 'succeeded' && item.status !== 'degraded',
    )
    check(
      'every item succeeded',
      run.items.length > 0 && failedItems.length === 0,
      run.items.length
        ? failedItems
            .map(
              (item) =>
                `${item.label}: ${item.status}${item.failure ? ` — ${item.failure}` : ''}`,
            )
            .join('; ')
        : `no item ledger; steps: ${(job?.steps ?? []).map((step) => `${step.name}=${step.status}${step.error ? ` (${step.error})` : ''}`).join(', ')}`,
    )
    record(run, {
      credits: {
        reserved: job?.creditsReserved ?? 0,
        spent: job?.creditsSpent ?? 0,
        refunded: job?.refundedCredits ?? 0,
        itemsSpent: run.items.reduce((sum, item) => sum + item.creditsSpent, 0),
        itemsRefunded: run.items.reduce(
          (sum, item) => sum + item.creditsRefunded,
          0,
        ),
        steps: (job?.steps ?? []).map((step) => ({
          name: step.name,
          status: step.status,
          creditsSpent: step.creditsSpent ?? 0,
        })),
        pageLine: finalView?.credits ?? null,
      },
    })
    check(
      'credits accounted',
      run.credits.refunded <= run.credits.spent,
      `spent ${run.credits.spent}, refunded ${run.credits.refunded}, net ${run.credits.spent - run.credits.refunded}; ` +
        `items spent ${run.credits.itemsSpent}, refunded ${run.credits.itemsRefunded}; ` +
        `still reserved ${run.credits.reserved}` +
        (run.credits.pageLine ? `; page: "${run.credits.pageLine}"` : ''),
    )

    // 7. What is actually in the site.
    const host = await readHost(firestore, run.hostId)
    writeFileSync(join(runDir, 'host.json'), JSON.stringify(host, null, 2))
    // The site's own look (AGL-3660): a base theme picked, the look as the
    // override over it, and the style tokens this job wrote.
    const siteStyle = host.data?.siteStyle ?? null
    const primary =
      host.data?.themeOverride?.patch?.colorSchemes?.light?.primary?.main ??
      host.data?.theme?.colorSchemes?.light?.primary?.main ??
      null
    record(run, {
      look: siteStyle
        ? { base: siteStyle.base, kind: siteStyle.kind, fonts: siteStyle.fonts, cards: siteStyle.cards, buttons: siteStyle.buttons, primary }
        : null,
    })
    check(
      'site theme is its own look',
      Boolean(siteStyle && siteStyle.jobId === run.jobId && host.data?.themeOverride && primary),
      siteStyle
        ? `base ${siteStyle.base} (${host.data?.themeSelection?.name ?? 'site theme'}), kind ${siteStyle.kind}, primary ${primary}, fonts ${siteStyle.fonts}, cards ${siteStyle.cards}, buttons ${siteStyle.buttons}`
        : 'no siteStyle on the site',
    )
    const plan = job?.plan ?? null
    const planScreens = plan?.screens ?? []
    // An email design is a screen with no address; on a paid run the welcome
    // email's would otherwise answer for the page at "/" (AGL-3676).
    const live = host.screens.filter((screen) => screen.data.deletedAt == null && screen.data.kind !== 'email')
    const slugOf = (value) =>
      `/${String(value ?? '')
        .trim()
        .replace(/^\/+|\/+$/g, '')}`
    const pages = planScreens.map((planned) => {
      const match =
        live.find(
          (screen) => slugOf(screen.data.slug) === slugOf(planned.slug),
        ) ??
        live.find(
          (screen) =>
            String(screen.data.displayName ?? '').toLowerCase() ===
            String(planned.title ?? '').toLowerCase(),
        )
      const version = match ? currentVersion(match) : null
      return {
        title: planned.title,
        slug: slugOf(planned.slug),
        screenId: match?.id ?? null,
        layoutId: match?.data.layoutId ?? version?.data.layoutId ?? null,
        published: Boolean(match?.data.publishedAt),
        nodes: version
          ? Object.keys(version.data.nodes ?? version.data.tree ?? {}).length
          : 0,
        seo: match?.data.seo ?? version?.data.seo ?? null,
      }
    })
    record(run, { pages })
    check(
      'every planned page generated',
      planScreens.length > 0 &&
        pages.every((entry) => entry.screenId && entry.nodes > 0),
      `${planScreens.length} planned: ${pages.map((entry) => `${entry.title} ${entry.slug} → ${entry.screenId ?? 'MISSING'} (${entry.nodes} nodes)`).join('; ')}`,
    )
    const layoutIds = new Set(host.layouts.map((layout) => layout.id))
    check(
      'every page in a layout',
      pages.length > 0 &&
        pages.every((entry) => entry.layoutId && layoutIds.has(entry.layoutId)),
      pages
        .map((entry) => `${entry.title}: ${entry.layoutId ?? 'none'}`)
        .join('; '),
    )
    const layout =
      host.layouts.find((entry) =>
        pages.some((pageEntry) => pageEntry.layoutId === entry.id),
      ) ?? host.layouts[0]
    const layoutVersion = layout ? currentVersion(layout) : null
    const navPages = pages.filter((entry) => entry.screenId)
    const unlinked = navPages.filter(
      (entry) =>
        !linksTo(layoutVersion?.data ?? {}, entry.slug) &&
        !linksTo(layoutVersion?.data ?? {}, entry.screenId),
    )
    check(
      'navigation links every page',
      Boolean(layoutVersion) && navPages.length > 0 && unlinked.length === 0,
      layoutVersion
        ? unlinked.length
          ? `not linked: ${unlinked.map((entry) => entry.slug).join(', ')}`
          : `layout ${layout.id}`
        : 'no layout version',
    )
    // The brand the header and footer carry, as the layout stores it: the
    // site's name, not one the model made up (AGL-3596).
    const layoutTexts = Object.values(layoutVersion?.data.nodes ?? {})
      .map((node) => node?.props?.children)
      .filter((text) => typeof text === 'string' && text.trim())
    check(
      'layout names the site',
      layoutVersion
        ? layoutTexts.some((text) =>
            text.toLowerCase().includes(siteName.toLowerCase()),
          )
        : null,
      layoutTexts.length
        ? `layout text: ${layoutTexts.map((text) => `"${text}"`).join(', ')}`
        : 'no text in the layout',
    )
    const formIds = new Set(
      host.forms
        .filter((form) => form.data.deletedAt == null)
        .map((form) => form.id),
    )
    const bound = boundFormIds(
      live.map((screen) => currentVersion(screen)?.data ?? {}),
    )
    record(run, { forms: { saved: [...formIds], bound } })
    check(
      'a saved form bound by formId',
      bound.some((id) => formIds.has(id)),
      `${formIds.size} saved form(s) [${[...formIds].join(', ')}]; bound ${bound.length ? bound.join(', ') : 'none'}`,
    )
    const publish = job?.sitePublish ?? null
    record(run, { publish })
    check(
      'site published',
      Boolean(publish?.published?.length) &&
        pages.every((entry) => entry.published),
      publish
        ? `published ${publish.published.map((entry) => entry.path).join(', ') || 'none'}; drafts ${publish.drafts.map((entry) => `${entry.label} (${entry.reason})`).join(', ') || 'none'}`
        : 'no sitePublish on the job',
    )
    const listing =
      (job?.outputs ?? []).find((output) => output.id === 'site:listing') ??
      null
    const seoSources = {
      site: host.data?.seo ?? null,
      listing: listing?.values ?? listing?.proposal ?? null,
      pages: pages.map((entry) => ({ slug: entry.slug, seo: entry.seo })),
    }
    record(run, { seo: seoSources })
    const seoProblems = []
    const titleOf = (seo) => seo?.title ?? seo?.['seo.title']
    const descriptionOf = (seo) => seo?.description ?? seo?.['seo.description']
    for (const entry of pages) {
      const title = seoTextVerdict(titleOf(entry.seo), 60)
      const description = seoTextVerdict(descriptionOf(entry.seo), 155)
      if (!title.ok) seoProblems.push(`${entry.slug} title ${title.reason}`)
      if (!description.ok)
        seoProblems.push(`${entry.slug} description ${description.reason}`)
    }
    const siteTitle = seoTextVerdict(
      titleOf(seoSources.site) ?? titleOf(seoSources.listing),
      60,
    )
    const siteDescription = seoTextVerdict(
      descriptionOf(seoSources.site) ?? descriptionOf(seoSources.listing),
      155,
    )
    if (!siteTitle.ok) seoProblems.push(`site title ${siteTitle.reason}`)
    if (!siteDescription.ok)
      seoProblems.push(`site description ${siteDescription.reason}`)
    check(
      'SEO title and description complete',
      seoProblems.length === 0,
      seoProblems.join('; '),
    )

    // 8. The live site, as a visitor sees it.
    await shootLiveSite(context, run, runDir, check, browser)
    // 9. A blog's first posts and a store's first products (AGL-3676).
    await checkFirstContent({ context, run, runDir, check, browser, firestore, job })
  } finally {
    if (pump) await pump.stop()
    await browser.close().catch(() => undefined)
  }
  const failed = Object.values(run.checks).filter(
    (entry) => entry.ok === false,
  ).length
  record(run, { verdict: failed === 0 ? 'PASS' : `${failed} FAILED` })
  return run
}

/**
 * What a paid guided start wrote into a blog or a store (AGL-3676), and
 * whether a visitor sees it: the posts published in the site's blog with a
 * byline, its listing and every post answering 200 with their titles, and
 * the pages naming the real posts; or 3 to 6 products saved as unpriced
 * drafts, the pages naming them and no page stating a price. A Free run
 * checks that neither part was owed.
 */
async function checkFirstContent({ context, run, runDir, check, browser, firestore, job }) {
  const rows = job?.items ?? []
  const postsRow = rows.find((row) => row.slot === 'posts') ?? null
  const productsRow = rows.find((row) => row.slot === 'products') ?? null
  const rowText = (row) =>
    row ? `${row.status}, ${row.creditsSpent ?? 0} credits${row.note ? `; ${row.note}` : ''}${row.failure?.message ? `; ${row.failure.message}` : ''}` : 'no row'
  record(run, { firstContent: { posts: postsRow, products: productsRow } })
  if (workspacePlan === 'free') {
    check('Free: no posts or products part owed', !postsRow && !productsRow, `posts ${rowText(postsRow)}; products ${rowText(productsRow)}`)
    return
  }
  if (!postsRow && !productsRow) return
  const tenantPort = new URL(context.tenantUrl).port || '80'
  const origin = `http://${run.subdomain}.localhost:${tenantPort}`
  const visitor = await browser.newContext({ viewport: { width: 1440, height: 900 } })
  const page = await visitor.newPage()
  const visit = async (path, shotName) => {
    const response = await page.goto(`${origin}${path}`, { waitUntil: 'load', timeout: 180_000 }).catch(() => null)
    await page.waitForTimeout(1000)
    const text = response ? ((await page.locator('body').textContent({ timeout: 5_000 }).catch(() => '')) ?? '') : ''
    // What a visitor reads: a price is judged here, never in the page's
    // inline script payloads, where \`$1\`-style references are not prices.
    const visible = response ? await page.locator('body').innerText({ timeout: 5_000 }).catch(() => '') : ''
    if (shotName) run.shots.push(await shoot(page, join(runDir, `${shotName}.png`), { fullPage: true }).catch(() => null))
    return { status: response?.status() ?? 0, text, visible }
  }
  const pageTexts = []
  for (const entry of run.publish?.published ?? []) pageTexts.push({ path: entry.path, ...(await visit(entry.path)) })
  const hostRef = firestore.collection('hosts').doc(run.hostId)
  try {
    if (postsRow) {
      check('posts row succeeded', postsRow.status === 'succeeded', rowText(postsRow))
      const posts = (job.outputs ?? []).filter((output) => output.resource === 'entry')
      const collectionId = posts[0]?.proposal?.collectionId
      const slug = posts[0]?.proposal?.collectionSlug
      const entries = collectionId
        ? (await hostRef.collection('collections').doc(collectionId).collection('entries').get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }))
        : []
      record(run, { posts: entries.map((entry) => ({ id: entry.id, title: entry.title, slug: entry.slug, status: entry.status, authorName: entry.authorName ?? null, words: String(entry.body ?? '').split(/\s+/).length })) })
      check(
        'posts published with a byline',
        entries.length >= 2 && entries.every((entry) => entry.status === 'published' && entry.authorName),
        entries.map((entry) => `“${entry.title}” ${entry.status} by ${entry.authorName ?? 'nobody'}`).join('; ') || 'no entries',
      )
      if (slug) {
        const listing = await visit(`/${slug}`, '30-blog-listing')
        const missing = entries.filter((entry) => !listing.text.includes(entry.title)).map((entry) => entry.title)
        check(`blog listing /${slug} shows every post`, listing.status === 200 && missing.length === 0, `${listing.status}; missing ${missing.join(', ') || 'none'}`)
        const statuses = []
        for (const [index, entry] of entries.entries()) {
          const post = await visit(`/${slug}/${entry.slug}`, index === 0 ? '31-blog-post' : null)
          statuses.push(`/${slug}/${entry.slug} ${post.status}${post.text.includes(entry.title) ? '' : ' (title missing)'}`)
        }
        check('every post page answers 200 with its title', statuses.every((line) => / 200$/.test(line)), statuses.join('; '))
      }
      const named = entries.filter((entry) => pageTexts.some((one) => one.text.includes(entry.title))).map((entry) => entry.title)
      check('pages feature the real post titles', named.length > 0, `${named.length} of ${entries.length} titles on a page: ${named.join(', ') || 'none'}`)
      // The home lists the posts themselves, each card linking its post (AGL-3676),
      // and no planned page stands in for the blog in the header.
      if (slug) {
        await page.goto(`${origin}/`, { waitUntil: 'load', timeout: 180_000 }).catch(() => null)
        await page.waitForTimeout(1000)
        const hrefs = await page.$$eval('a[href]', (anchors) => anchors.map((anchor) => anchor.getAttribute('href') ?? '')).catch(() => [])
        const linked = entries.filter((entry) => hrefs.includes(`/${slug}/${entry.slug}`)).map((entry) => entry.title)
        check('the home links each post it lists', linked.length >= Math.min(2, entries.length), `${linked.length} of ${entries.length} posts linked: ${linked.join(', ') || 'none'}`)
        const nav = await page.locator('header nav').first().innerText({ timeout: 5_000 }).catch(() => '')
        const standIns = nav.split(/\n+/).map((line) => line.trim()).filter((line) => /^(articles?|journal|posts?|stories|writing)$/i.test(line))
        check('no page stands in for the blog in the header', standIns.length === 0 && new RegExp(`\\bBlog\\b`).test(nav), `nav: ${nav.replace(/\n+/g, ' | ')}`)
        const ctas = await page.$$eval('a', (anchors) => anchors.map((anchor) => anchor.textContent ?? '')).catch(() => [])
        const named = ctas.filter((text) => /\barticles?\b/i.test(text) && !/^Read the post$/.test(text))
        check('no call to action names a stand-in page', named.length === 0, named.join('; ') || 'none')
      }
    }
    if (productsRow) {
      check('products row succeeded', productsRow.status === 'succeeded', rowText(productsRow))
      const products = (await hostRef.collection('products').get()).docs.map((doc) => ({ id: doc.id, ...doc.data() }))
      record(run, { products: products.map((product) => ({ id: product.id, name: product.name, status: product.status, priceUsd: product.priceUsd ?? null, variants: (product.variants ?? []).map((variant) => variant.priceUsd ?? null) })) })
      const priced = products.filter((product) => product.priceUsd != null || (product.variants ?? []).some((variant) => variant.priceUsd != null))
      // Listed before they have a price (AGL-3676): active, unpriced, each with a photo.
      check(
        '3 to 6 products listed unpriced, each with a photo',
        products.length >= 3 &&
          products.length <= 6 &&
          products.every((product) => product.status === 'active' && (product.mediaUrls ?? []).length > 0) &&
          priced.length === 0,
        `${products.length} products: ${products.map((product) => `${product.name} (${product.status}, ${(product.mediaUrls ?? []).length} photo)`).join(', ')}; priced ${priced.length}`,
      )
      check('products row says to set prices', /Set their prices/.test(productsRow.note ?? ''), rowText(productsRow))
      // The storefront lists them (AGL-3676): the grid on the home and the shop, each card a product page.
      const store = pageTexts.filter((one) => one.status === 200)
      const gridOn = []
      const productLinks = new Set()
      for (const entry of run.publish?.published ?? []) {
        await page.goto(`${origin}${entry.path}`, { waitUntil: 'load', timeout: 180_000 }).catch(() => null)
        await page.waitForTimeout(1500)
        const links = await page.$$eval('a[href^="/products/"]', (anchors) => anchors.map((anchor) => anchor.getAttribute('href'))).catch(() => [])
        if (links.length) gridOn.push(`${entry.path} (${links.length})`)
        for (const link of links) productLinks.add(link)
        if (entry.path === '/') {
          const cart = await page.locator('header [aria-label="Cart"]').count().catch(() => 0)
          check('the header carries the cart', cart > 0, `${cart} cart button(s) in the header`)
          run.shots.push(await shoot(page, join(runDir, '32-store-home.png'), { fullPage: true }).catch(() => null))
        } else if (/shop|product|store/i.test(`${entry.path} ${entry.label}`)) {
          run.shots.push(await shoot(page, join(runDir, '33-store-shop.png'), { fullPage: true }).catch(() => null))
        }
      }
      check('the home and the shop list the products', gridOn.some((line) => line.startsWith('/ ')) && gridOn.length >= 2, gridOn.join('; ') || 'none')
      const soon = store.filter((one) => one.visible.includes('Price coming soon')).map((one) => one.path)
      check('cards say “Price coming soon”', soon.length > 0, soon.join(', ') || 'none')
      const pdps = []
      for (const [index, link] of [...productLinks].entries()) {
        const pdp = await visit(link, index === 0 ? '34-product-page' : null)
        pdps.push(`${link} ${pdp.status}${pdp.visible.includes('Price coming soon') ? '' : ' (no coming-soon)'}${/Add to cart/.test(pdp.visible) ? ' (Add to cart shown)' : ''}`)
      }
      check('every product page answers, coming soon, with nothing to buy', pdps.length > 0 && pdps.every((line) => / 200$/.test(line)), pdps.join('; ') || 'none')
      const named = products.filter((product) => pageTexts.some((one) => one.text.includes(product.name))).map((product) => product.name)
      check('pages feature the real product names', named.length > 0, `${named.length} of ${products.length} names on a page: ${named.join(', ') || 'none'}`)
      const prices = pageTexts.flatMap((one) => (one.visible.match(/[$€£]\s?\d[\d,]*(?:\.\d{1,2})?/g) ?? []).map((price) => `${one.path} ${price}`))
      check('no page states a price', prices.length === 0, prices.join('; ') || 'none')
    }
  } finally {
    await visitor.close().catch(() => undefined)
  }
}

async function shootLiveSite(context, run, runDir, check, browser) {
  const tenantPort = new URL(context.tenantUrl).port || '80'
  const origin = `http://${run.subdomain}.localhost:${tenantPort}`
  const published = run.publish?.published ?? []
  const contact =
    published.find((entry) =>
      /contact/i.test(`${entry.path} ${entry.label}`),
    ) ??
    published.find((entry) => entry.path !== '/') ??
    null
  const paths = [
    { name: 'home', path: '/' },
    ...(contact ? [{ name: 'contact', path: contact.path }] : []),
  ]
  const statuses = []
  // What the published layout's header reads on each page that answered 200.
  const headers = {}
  for (const viewport of [
    { name: 'desktop', width: 1440, height: 900 },
    { name: 'phone', width: 375, height: 812, isMobile: true, hasTouch: true },
  ]) {
    const visitor = await browser.newContext({
      viewport: { width: viewport.width, height: viewport.height },
      isMobile: viewport.isMobile ?? false,
      hasTouch: viewport.hasTouch ?? false,
    })
    const page = await visitor.newPage()
    try {
      for (const target of paths) {
        const response = await page
          .goto(`${origin}${target.path}`, {
            waitUntil: 'load',
            timeout: 180_000,
          })
          .catch((error) => {
            statuses.push(
              `${viewport.name} ${target.path}: ${error.message.split('\n')[0]}`,
            )
            return null
          })
        if (!response) continue
        if (viewport.name === 'desktop')
          statuses.push(`${target.path} ${response.status()}`)
        await page.waitForTimeout(1500)
        const base = `20-site-${target.name}-${viewport.name}`
        run.shots.push(
          await shoot(page, join(runDir, `${base}.png`), { fullPage: true }),
        )
        for (const part of ['header', 'footer']) {
          const element = page.locator(part).first()
          if (await element.count()) {
            await element.scrollIntoViewIfNeeded().catch(() => undefined)
            run.shots.push(
              await shoot(page, join(runDir, `${base}-${part}.png`), {
                clip: (await element.boundingBox()) ?? undefined,
              }).catch(() => null),
            )
          }
        }
        if (viewport.name === 'desktop' && response.status() === 200) {
          const header = await page
            .locator('header')
            .first()
            .textContent({ timeout: 5_000 })
            .catch(() => null)
          headers[target.path] = {
            header: header?.replace(/\s+/g, ' ').trim() ?? null,
            title: await page.title(),
          }
        }
      }
    } finally {
      await visitor.close()
    }
  }
  record(run, { shots: run.shots.filter(Boolean), liveHeaders: headers })
  check(
    'live pages answer 200',
    statuses.length > 0 && statuses.every((entry) => / 200$/.test(entry)),
    statuses.join('; '),
  )
  const read = Object.entries(headers).filter(([, entry]) => entry.header)
  check(
    'live header names the site',
    read.length
      ? read.every(([, entry]) =>
          entry.header.toLowerCase().includes(siteName.toLowerCase()),
        )
      : null,
    read.length
      ? read
          .map(
            ([path, entry]) => `${path} reads "${entry.header.slice(0, 120)}"`,
          )
          .join('; ')
      : 'no <header> on a page that answered 200',
  )
}

/**
 * Writes what a run found onto its record. One function rather than
 * assignments because the record is the run's own, built step by step across
 * awaits that nothing else can interleave with.
 */
function record(run, facts) {
  Object.assign(run, facts)
}

async function pickOption(page, label, option) {
  await page
    .getByRole('combobox', { name: new RegExp(`^${escapeRegExp(label)}`) })
    .first()
    .click()
  await page
    .locator('[role="listbox"]')
    .last()
    .getByRole('option', { name: option })
    .first()
    .click()
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/*==========================================
 * MAIN
 *=========================================*/

let exitCode = 1
const summary = {
  startedAt,
  appRoot,
  appRef: gitRef(appRoot),
  harnessRef: gitRef(repoRoot),
  answers: { ...answers, briefs, siteNames },
  outDir,
  runs: [],
}
const writeSummary = () => {
  writeFileSync(join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
  writeFileSync(join(outDir, 'summary.md'), summaryMarkdown(summary))
}

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    writeSummary()
    void stopStarted().finally(() => process.exit(130))
  })
}

try {
  if (!existsSync(join(appRoot, 'apps', 'console', 'project.json')))
    throw new Error(`${appRoot} is not a checkout of this repo`)
  const hosts = await ensureEmulators()
  const { consoleUrl, tenantUrl } = await ensureServers(hosts)
  summary.consoleUrl = consoleUrl
  summary.tenantUrl = tenantUrl
  reuseHint =
    `FIRESTORE_EMULATOR_HOST=${hosts.firestore} FIREBASE_AUTH_EMULATOR_HOST=${hosts.auth} ` +
    `FIREBASE_STORAGE_EMULATOR_HOST=${hosts.storage} FIREBASE_DATABASE_EMULATOR_HOST=${hosts.database} ` +
    `npm run e2e:ai-guided-start:local -- --console-url ${consoleUrl} --tenant-url ${tenantUrl}`

  // The shared session helpers read these when they load.
  process.env.E2E_BASE_URL = consoleUrl
  process.env.FIRESTORE_EMULATOR_HOST = hosts.firestore
  process.env.FIREBASE_AUTH_EMULATOR_HOST = hosts.auth
  const session = await import('./lib/console-session.mjs')
  const firestore = session.adminFirestore()
  const { getAuth } = await import('firebase-admin/auth')
  const auth = getAuth()
  const beatLog = createWriteStream(join(outDir, 'beat.log'), { flags: 'a' })

  for (let index = 0; index < runs; index += 1) {
    answers.siteType = briefs[index % briefs.length]
    siteName = siteNames[index % siteNames.length]
    log(`run ${index + 1} of ${runs}: ${answers.siteType} (${siteName})`)
    let run
    try {
      run = await runOnce(
        { session, firestore, auth, consoleUrl, tenantUrl, beatLog },
        index,
      )
    } catch (error) {
      run = {
        verdict: 'ERROR',
        error: String(error?.stack ?? error)
          .split('\n')
          .slice(0, 3)
          .join(' '),
        checks: {},
      }
      log(`run ${index + 1} ERROR: ${run.error}`)
    }
    summary.runs.push(run)
    writeSummary()
  }
  beatLog.end()
  // Two runs never share a look (AGL-3660): not their primary color, not their tokens.
  const looks = summary.runs.map((run) => run.look).filter(Boolean)
  if (looks.length > 1) {
    const distinct = new Set(looks.map((entry) => JSON.stringify(entry)))
    const primaries = new Set(looks.map((entry) => entry.primary))
    summary.looksDiffer = distinct.size === looks.length && primaries.size === looks.length
    log(`${summary.looksDiffer ? 'PASS' : 'FAIL'} every run has its own look — ${looks.map((entry) => `${entry.kind}/${entry.base} ${entry.primary} ${entry.fonts}`).join(' | ')}`)
  }
  exitCode =
    summary.runs.every((run) => run.verdict === 'PASS') && summary.looksDiffer !== false ? 0 : 1
} catch (error) {
  summary.error = String(error?.message ?? error)
  console.error(`ai guided start: ${summary.error}`)
} finally {
  writeSummary()
  log(`summary: ${join(outDir, 'summary.md')}`)
  await stopStarted()
}
// Admin SDK handles keep the loop alive; the summary is written.
process.exit(exitCode)
