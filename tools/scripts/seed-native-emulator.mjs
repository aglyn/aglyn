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
 * rules.
 *
 *   node tools/scripts/seed-native-emulator.mjs [--auth 127.0.0.1:9099] [--firestore 127.0.0.1:8082] [--project demo-aglyn]
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
const EMAIL = 'mobile-owner@example.test'
const PASSWORD = `seed-${PROJECT}-mobile`
const LOCAL = /^(localhost|127\.0\.0\.1|10\.0\.2\.2):\d+$/

if (!PROJECT.startsWith('demo-')) {
  console.error('seed-native-emulator: the project id must start with demo- (emulator only).')
  process.exit(1)
}
if (!LOCAL.test(AUTH) || !LOCAL.test(FIRESTORE)) {
  console.error('seed-native-emulator: the Auth and Firestore hosts must be local emulators.')
  process.exit(1)
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
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } }
}

/** Writes `data` at `path`; with `merge`, only its own top-level fields, leaving the rest. */
async function put(path, data, { merge = false } = {}) {
  const mask = merge
    ? `?${Object.keys(data)
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

await put(`users/${uid}`, { email: EMAIL, displayName: 'Mobile Owner', createdAt: now })
await put(`orgs/${orgId}`, { name: 'Demo Workspace', slug: 'demo-workspace', plan: 'pro', memberRoles: { [uid]: 'owner' }, createdAt: now })
await put(`users/${uid}/orgs/${orgId}`, { orgName: 'Demo Workspace', slug: 'demo-workspace', role: 'owner' })
await put(`hosts/${hostId}`, { orgId, displayName: 'Demo Site', subdomain: 'demo-site', memberRoles: { [uid]: 'admin' }, createdAt: now })
await put(`users/${uid}/hostMemberships/${hostId}`, {
  orgId,
  displayName: 'Demo Site',
  nameLower: 'demo site',
  subdomain: 'demo-site',
  role: 'admin',
  createdAt: now,
  updatedAt: now,
})
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
  ['store', 'seedCommerce'],
  ['pos', 'seedPos'],
  ['notifications', 'seedNotifications'],
  ['content', 'seedContent'],
]
for (const [file, name] of areas) {
  const area = await import(`./seed-native/${file}.mjs`)
  await area[name]({ put, uid, orgId, hostId, now, nameSearchFields })
}

console.log(
  `seed-native-emulator: ${PROJECT} seeded (workspace ${orgId}, site ${hostId}, ${rules.length} redirects, ` +
    `${areas.map(([file]) => file).join(', ')}).`,
)
console.log(`  sign in as ${EMAIL} / ${PASSWORD}`)
