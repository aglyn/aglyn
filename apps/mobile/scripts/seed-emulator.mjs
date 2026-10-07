/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Seeds a local Firebase emulator stack for the Aglyn app (AGL-3620): one
 * member, one workspace, one site and a few redirect rules, so sign-in, the
 * workspace and site switcher and the Redirects sample screen all have data;
 * then each area's rows from `./seed/*.mjs` (AGL-3622).
 *
 *   node apps/mobile/scripts/seed-emulator.mjs [--auth 127.0.0.1:9099] [--firestore 127.0.0.1:8082] [--project demo-aglyn]
 *
 * Emulator only: it refuses a project id without the `demo-` prefix, which the
 * Firebase CLI never connects to a live project. Firestore writes use the
 * emulator's `owner` bearer, which bypasses rules; the app then reads under the
 * real rules as the seeded member. The member's sign-in is printed once to the
 * terminal that ran this script, for typing into the simulator.
 */

const arg = (name, fallback) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > 0 ? process.argv[index + 1] : fallback
}

const AUTH = arg('auth', '127.0.0.1:9099')
const FIRESTORE = arg('firestore', '127.0.0.1:8082')
const PROJECT = arg('project', 'demo-aglyn')
const EMAIL = 'mobile-owner@example.test'
const PASSWORD = `seed-${PROJECT}-mobile`

if (!PROJECT.startsWith('demo-')) {
  console.error('seed-emulator: the project id must start with demo- (emulator only).')
  process.exit(1)
}

async function call(url, init) {
  const response = await fetch(url, init)
  const body = await response.json().catch(() => ({}))
  if (!response.ok) throw new Error(`${init?.method ?? 'GET'} ${url}: ${response.status} ${JSON.stringify(body)}`)
  return body
}

/** Firestore REST value encoding for the plain shapes this seed writes. */
function encode(value) {
  if (value === null) return { nullValue: null }
  if (typeof value === 'string') return { stringValue: value }
  if (typeof value === 'boolean') return { booleanValue: value }
  if (typeof value === 'number') return Number.isInteger(value) ? { integerValue: String(value) } : { doubleValue: value }
  if (value instanceof Date) return { timestampValue: value.toISOString() }
  if (Array.isArray(value)) return { arrayValue: { values: value.map(encode) } }
  return { mapValue: { fields: Object.fromEntries(Object.entries(value).map(([k, v]) => [k, encode(v)])) } }
}

async function put(path, data) {
  const url = `http://${FIRESTORE}/v1/projects/${PROJECT}/databases/(default)/documents/${path}`
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

// Each area of the app seeds its own rows (AGL-3622), in the shapes the
// console writes, so every screen has data under the real rules.
const areas = [
  ['workspace', 'seedWorkspace'],
  ['crm', 'seedCrm'],
  ['forms', 'seedForms'],
  ['inbox', 'seedInbox'],
  ['marketing', 'seedMarketing'],
]
for (const [file, name] of areas) {
  const area = await import(`./seed/${file}.mjs`)
  await area[name]({ put, uid, orgId, hostId, now })
}

console.log(`seed-emulator: ${PROJECT} seeded (workspace ${orgId}, site ${hostId}, ${rules.length} redirects, ${areas.map(([file]) => file).join(', ')}).`)
console.log(`  sign in as ${EMAIL} / ${PASSWORD}`)
