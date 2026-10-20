#!/usr/bin/env node
/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Seeds a local Firebase emulator stack for the native apps (Aglyn and Aglyn
 * POS, AGL-3651): one member, one workspace on the Pro plan, one site with a
 * few redirect rules, then each area's rows (the notification feed among them) from `./seed-native/*.mjs`, in
 * the shapes the console writes, so every screen has data under the real
 * rules. Two areas give the member more workspaces: a white-label one on the
 * Agency plan with its own brand (`./seed-native/white-label.mjs`), and one in
 * the older shapes a long-lived production workspace holds (no switchboard
 * list, empty site plugin lists, retired actions, legacy datasets;
 * `./seed-native/legacy-workspace.mjs`, AGL-3993).
 *
 *   node tools/scripts/seed-native-emulator.mjs [--auth 127.0.0.1:9099] [--firestore 127.0.0.1:8082] [--project demo-aglyn]
 *     [--storage 127.0.0.1:9199 [--bucket <the console's bucket>]]
 *
 * Emulator only: it refuses a project id without the `demo-` prefix, which the
 * Firebase CLI never connects to a live project, and an emulator host that is
 * not local. Firestore writes use the emulator's `owner` bearer, which
 * bypasses rules; the apps then read under the real rules as the seeded
 * member. The member's sign-in is printed once to the terminal that ran this
 * script, for typing into the simulator.
 */

import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? process.argv[index + 1] : fallback
}

const AUTH = arg('auth', '127.0.0.1:9099')
const FIRESTORE = arg('firestore', '127.0.0.1:8082')
const PROJECT = arg('project', 'demo-aglyn')
/**
 * The Storage emulator, optional. Named, the seeded JPEG media get real files
 * in it, so the console's media CDN can serve them and make their delivery
 * copies, and the register's products show photos (AGL-3906). Unnamed, the
 * media documents name files nobody uploaded, as before.
 */
const STORAGE = arg('storage', null)
const EMAIL = 'mobile-owner@example.test'
const PASSWORD = `seed-${PROJECT}-mobile`
const LOCAL = /^(localhost|127\.0\.0\.1|10\.0\.2\.2):\d+$/

if (!PROJECT.startsWith('demo-')) {
  console.error('seed-native-emulator: the project id must start with demo- (emulator only).')
  process.exit(1)
}
if (!LOCAL.test(AUTH) || !LOCAL.test(FIRESTORE) || (STORAGE && !LOCAL.test(STORAGE))) {
  console.error('seed-native-emulator: the Auth, Firestore and Storage hosts must be local emulators.')
  process.exit(1)
}

/**
 * The bucket the local console reads, resolved the way an emulated console resolves it: the environment first, then the
 * console's env files (this tree's, or the main checkout's in a worktree that has none: `consoleEnvFiles`, which
 * `serve-emulated` reads too), then the bucket an emulated console derives from the project. `--bucket` overrides.
 * Printed once, so a seed and a console that disagree show it; a bucket the console never reads leaves every seeded
 * picture a 404.
 */
let bucketOnce = null
function consoleBucket() {
  bucketOnce ??= resolveConsoleBucket()
  return bucketOnce
}

async function resolveConsoleBucket() {
  const given = arg('bucket', null)
  let bucket = given
  let source = '--bucket'
  if (!given) {
    const { consoleEnvFiles, emulatedServeEnvironment } = await import('./lib/emulated-env.mjs')
    const files = consoleEnvFiles(ROOT, 'console')
    const { env } = emulatedServeEnvironment(
      {
        ...process.env,
        NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID || PROJECT,
        FIRESTORE_EMULATOR_HOST: FIRESTORE,
      },
      files,
    )
    bucket = env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
    const file = files.find((entry) => entry.parsed.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET)
    source = process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET
      ? 'the environment'
      : file
        ? file.path
        : `an emulated console's default for ${env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}`
  }
  if (!bucket) throw new Error('seed-native-emulator: no Storage bucket resolved for the console; pass --bucket <bucket>.')
  console.log(`seed-native-emulator: Storage bucket ${bucket} (from ${source})`)
  return bucket
}

/** Uploads `bytes` to the Storage emulator at `path` (emulator owner credentials; never a real bucket). */
async function putObject(path, bytes, contentType) {
  const bucket = await consoleBucket()
  const url = `http://${STORAGE}/upload/storage/v1/b/${encodeURIComponent(bucket)}/o?uploadType=media&name=${encodeURIComponent(path)}`
  const response = await fetch(url, { method: 'POST', headers: { Authorization: 'Bearer owner', 'Content-Type': contentType }, body: bytes })
  if (!response.ok) throw new Error(`upload ${path}: ${response.status} ${await response.text()}`)
}

async function call(url, init) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url}: ${response.status} ${JSON.stringify(body)}`)
  return body
}

/** Firestore REST value encoding for the plain shapes the seed writes. */
function encode(value) {
  if (value === null || value === undefined) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  // Stored node trees are msgpack bytes in production (`encodeStoredNodes`), so the seed writes them the same way.
  if (value instanceof Uint8Array) return { bytesValue: Buffer.from(value).toString('base64') }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } }
}

/**
 * Writes `data` at `path`; with `merge`, only its own top-level fields, leaving the rest, or only the dotted
 * `fields` named (one key of a map, as `releaseFlags.release_outreach`).
 */
async function put(path, data, { merge = false, fields = null } = {}) {
  const mask = merge
    ? `?${(fields ?? Object.keys(data))
        .map((key) => `updateMask.fieldPaths=${encodeURIComponent(key)}`)
        .join('&')}`
    : ''
  const url = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}${mask}`
  await call(url, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json', authorization: 'Bearer owner' },
    body: JSON.stringify({ fields: encode(data).mapValue.fields }),
  })
}

async function member() {
  const base = `http://${AUTH}/identitytoolkit.googleapis.com/v1`
  const body = JSON.stringify({ email: EMAIL, password: PASSWORD, returnSecureToken: true })
  const headers = { 'content-type': 'application/json' }
  try {
    return (await call(`${base}/accounts:signUp?key=emulator`, { method: 'POST', headers, body })).localId
  } catch {
    return (await call(`${base}/accounts:signInWithPassword?key=emulator`, { method: 'POST', headers, body })).localId
  }
}

// The name-search fields the console's writers stamp, so list search matches.
const { createJiti } = createRequire(join(ROOT, 'package.json'))('jiti')
const jiti = createJiti(join(ROOT, 'package.json'), { interopDefault: true, fsCache: false })
const { nameSearchFields } = await jiti.import(join(ROOT, 'libs/aglyn/src/lib/app-utils/name-search.ts'))

const uid = await member()
const now = new Date()
const orgId = 'mobile-demo-org'
const hostId = 'mobile-demo-site'

await put(`users/${uid}`, { email: EMAIL, displayName: 'Hannah Reyes', createdAt: now })
await put(`orgs/${orgId}`, { name: 'Juniper Street Co.', slug: 'juniper-street', plan: 'pro', memberRoles: { [uid]: 'owner' }, createdAt: now })
await put(`users/${uid}/orgs/${orgId}`, { orgName: 'Juniper Street Co.', slug: 'juniper-street', role: 'owner' })
await put(`hosts/${hostId}`, { orgId, displayName: 'Juniper Street Bakery', subdomain: 'juniper-street', memberRoles: { [uid]: 'admin' }, createdAt: now })
await put(`users/${uid}/hostMemberships/${hostId}`, {
  orgId,
  displayName: 'Juniper Street Bakery',
  nameLower: 'juniper street bakery',
  subdomain: 'juniper-street',
  role: 'admin',
  createdAt: now,
  updatedAt: now,
})
for (const id of [hostId, 'mobile-bloom-bakery', 'mobile-studio-north']) await put(`hostIndex/${id}`, { orgId })
const rules = [
  ['old-pricing', '/pricing-2025', '/pricing', 301, 'exact'],
  ['blog-move', '/news', '/blog', 301, 'prefix'],
  ['promo', '/fall', '/collections/fall', 302, 'exact'],
]
for (const [id, source, destination, statusCode, kind] of rules) {
  await put(`hosts/${hostId}/redirects/${id}`, { source, destination, statusCode, kind, enabled: true, createdAt: now })
}

const areas = [
  ['workspace', 'seedWorkspace'],
  ['people', 'seedCrm'],
  ['submissions', 'seedForms'],
  ['inbox', 'seedInbox'],
  ['marketing', 'seedMarketing'],
  ['email', 'seedEmail'],
  ['store', 'seedCommerce'],
  ['insights', 'seedInsights'],
  ['site-rules', 'seedAutomation'],
  ['pos', 'seedPos'],
  ['notifications', 'seedNotifications'],
  ['content', 'seedContent'],
  ['account', 'seedAccount'],
  ['pages', 'seedPages'],
  ['promotions', 'seedPromotions'],
  ['returns', 'seedReturns'],
  ['funnels', 'seedFunnels'],
  ['ai-jobs', 'seedAiJobs'],
  ['sequences', 'seedSequences'],
  ['accounting', 'seedAccounting'],
  ['listings', 'seedListings'],
  ['white-label', 'seedWhiteLabel'],
  ['usage', 'seedUsage'],
  ['legacy-workspace', 'seedLegacyWorkspace'],
]
let staff = null
for (const [file, name] of areas) {
  const area = await import(`./seed-native/${file}.mjs`)
  const seeded = await area[name]({
    put,
    uid,
    orgId,
    hostId,
    now,
    nameSearchFields,
    auth: AUTH,
    project: PROJECT,
    putObject: STORAGE ? putObject : null,
    root: ROOT,
  })
  if (file === 'account') staff = seeded
}

console.log(
  `seed-native-emulator: ${PROJECT} seeded (workspace ${orgId}, site ${hostId}, ${rules.length} redirects, ` +
    `${areas.map(([file]) => file).join(', ')}).`,
)
console.log(`  sign in as ${EMAIL} / ${PASSWORD}`)
if (staff) console.log(`  staff (super) as mobile-staff@example.test / ${staff.password}`)
