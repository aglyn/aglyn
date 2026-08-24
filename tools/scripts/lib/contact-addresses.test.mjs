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

import assert from 'node:assert/strict'
import test from 'node:test'

import {
  extractAglynAddresses,
  findUnprovisionedAddresses,
  isNonIntakeAddress,
  isProvisionedContactAddress,
  OTHER_PROVISIONED_ADDRESSES,
  PLATFORM_SENDER_ADDRESSES,
  PROVISIONED_CONTACT_ADDRESSES,
  STATUTORY_INTAKE_ADDRESSES,
  UNVERIFIED_PROVISIONING,
} from './contact-addresses.mjs'

test('the six statutory intakes are all provisioned', () => {
  assert.equal(STATUTORY_INTAKE_ADDRESSES.length, 6)
  for (const a of STATUTORY_INTAKE_ADDRESSES) {
    assert.ok(isProvisionedContactAddress(a), `${a} should be provisioned`)
  }
})

test('the registry has no duplicate between its two halves', () => {
  const overlap = STATUTORY_INTAKE_ADDRESSES.filter((a) =>
    OTHER_PROVISIONED_ADDRESSES.includes(a),
  )
  assert.deepEqual(overlap, [])
  assert.equal(
    new Set(PROVISIONED_CONTACT_ADDRESSES).size,
    PROVISIONED_CONTACT_ADDRESSES.length,
  )
})

// ── The load-bearing negative control ────────────────────────────────────────
// A guard that cannot red is a green check that reads nothing. An address
// nobody provisioned is the whole point, so it is asserted directly.

test('an address that is NOT in the registry is reported', () => {
  const found = findUnprovisionedAddresses([
    { path: 'apps/docs/src/pages/trust.md', text: 'Email nosuchbox@aglyn.com.' },
  ])
  assert.equal(found.length, 1)
  assert.equal(found[0].address, 'nosuchbox@aglyn.com')
  assert.equal(found[0].path, 'apps/docs/src/pages/trust.md')
  assert.equal(found[0].line, 1)
})

test('a provisioned address is NOT reported', () => {
  const found = findUnprovisionedAddresses([
    { path: 'a.md', text: 'Email privacy@aglyn.com for personal data.' },
  ])
  assert.deepEqual(found, [])
})

test('a sender address is never an intake, but is not swept as one', () => {
  // Two different questions, and conflating them is why this is asserted.
  //
  // `noreply@` is provisioned to SEND and nothing routes mail TO it, so it must
  // answer FALSE to "can a person write here" — that predicate is what a
  // surface would consult before printing a contact.
  for (const sender of PLATFORM_SENDER_ADDRESSES) {
    assert.equal(isProvisionedContactAddress(sender), false)
  }
  // But it legitimately appears ~11 times across the runbooks and config as the
  // configured FROM address, so the corpus sweep must stay quiet about it.
  // Reporting it would make the guard noisy on every run, and a guard people
  // learn to ignore is one that no longer reads anything.
  assert.deepEqual(
    findUnprovisionedAddresses([
      { path: 'docs/EMAIL_SETUP.md', text: 'Sends as noreply@aglyn.com' },
    ]),
    [],
  )
})

test('the internal delivery target and placeholders are exempt', () => {
  assert.ok(isNonIntakeAddress('zach@aglyn.com'))
  assert.ok(isNonIntakeAddress('zach+e2e-smoke@aglyn.com'))
  assert.ok(isNonIntakeAddress('you@aglyn.com'))
  // Not an address at all — a CloudStorage mount path segment.
  assert.ok(isNonIntakeAddress('GoogleDrive-zach@aglyn.com'))
  assert.deepEqual(
    findUnprovisionedAddresses([
      { path: 'tools/scripts/x.mjs', text: '/CloudStorage/GoogleDrive-zach@aglyn.com/Shared' },
    ]),
    [],
  )
})

test('an exempt local-part does not exempt a different one', () => {
  // `zach` is exempt; `zachary` is not the same local-part and must not
  // inherit the exemption by prefix.
  assert.equal(isNonIntakeAddress('zachary@aglyn.com'), false)
  const found = findUnprovisionedAddresses([
    { path: 'a.md', text: 'zachary@aglyn.com' },
  ])
  assert.equal(found.length, 1)
})

test('line numbers and paths are reported accurately', () => {
  const found = findUnprovisionedAddresses([
    { path: 'b.md', text: 'ok\nprivacy@aglyn.com\nmore\nghost@aglyn.com\n' },
  ])
  assert.equal(found.length, 1)
  assert.equal(found[0].line, 4)
})

test('findings are sorted by path then line', () => {
  const found = findUnprovisionedAddresses([
    { path: 'z.md', text: 'ghost@aglyn.com' },
    { path: 'a.md', text: '\n\nghost@aglyn.com' },
    { path: 'a.md', text: 'ghost@aglyn.com' },
  ])
  assert.deepEqual(
    found.map((f) => `${f.path}:${f.line}`),
    ['a.md:1', 'a.md:3', 'z.md:1'],
  )
})

test('extraction is case-insensitive and de-duplicates', () => {
  const got = extractAglynAddresses('Privacy@aglyn.com and privacy@aglyn.com')
  assert.equal(got.length, 1)
  assert.ok(isProvisionedContactAddress('PRIVACY@AGLYN.COM'))
})

test('a non-aglyn.com address is ignored', () => {
  assert.deepEqual(
    findUnprovisionedAddresses([
      { path: 'a.md', text: 'ghost@example.com and ghost@aglyn.com.evil.test' },
    ]).map((f) => f.address),
    // The second matches `ghost@aglyn.com` as a prefix of a lookalike host,
    // which is deliberately still reported: a lookalike in our own docs is
    // not something to pass over quietly.
    ['ghost@aglyn.com'],
  )
})

test('bad input does not throw', () => {
  assert.deepEqual(findUnprovisionedAddresses(null), [])
  assert.deepEqual(findUnprovisionedAddresses([null, {}, { path: 1, text: 2 }]), [])
  assert.deepEqual(extractAglynAddresses(null), [])
  assert.equal(isProvisionedContactAddress(null), false)
  assert.equal(isProvisionedContactAddress('   '), false)
})

// ── The open gaps are data, and must stay readable ───────────────────────────

test('every UNVERIFIED_PROVISIONING entry is itself in the registry', () => {
  // These are published AND believed provisioned. If one were dropped from the
  // registry the guard would report it as unprovisioned, which is a different
  // and louder claim than "published without a verification date".
  assert.ok(UNVERIFIED_PROVISIONING.length > 0)
  for (const row of UNVERIFIED_PROVISIONING) {
    assert.ok(
      isProvisionedContactAddress(row.address),
      `${row.address} is flagged unverified but missing from the registry`,
    )
    assert.ok(row.publishedAt && row.why, `${row.address} needs both fields`)
  }
})

test('help@ is recorded as the security escalation fallback', () => {
  // The sharpest of the four: docs.aglyn.com/trust offers it as the address to
  // use WHEN security@ bounces, and AGL-1577 means it cannot bounce either.
  const row = UNVERIFIED_PROVISIONING.find((r) => r.address === 'help@aglyn.com')
  assert.ok(row, 'help@aglyn.com must stay recorded')
  assert.match(row.publishedAt, /trust/)
})
