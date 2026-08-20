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

// The `contentSha256` backfill's decision half (AGL-1630).
//
// AGL-1630's constraints are not stylistic — each one names a way this
// script could destroy real customer media — so each gets a case that fails
// if the rule is dropped:
//
//   * `contentHash` is NOT to be touched. It is the ETag and the path
//     segment of the pre-AGL-829 immutable CDN URL. Rewriting it 404s every
//     embed still carrying that form and invalidates every stored cache
//     validator at once. Asserted as "the patch has exactly one key".
//   * Per-collection passes. `orgs/{id}/media` and `hosts/{id}/media` are
//     separate runs, so `--collection` is required and refused when absent.
//   * Additive only. A document that already has a strong digest — one a
//     route wrote from bytes it actually held — is never overwritten.
//   * Gated so it cannot run by accident. `--apply` alone is not enough;
//     it must be accompanied by the project id, typed out.
//
// Pure functions only. The Firestore and Storage halves live in the runner
// and are not unit-testable without doubles that would be more elaborate
// than the code they model.

import { deepStrictEqual, ok, strictEqual } from 'node:assert'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  MEDIA_STRONG_DIGEST_MAX_BYTES,
  backfillPatch,
  parseBackfillArgs,
  planForDocument,
} from './media-content-sha256-backfill.mjs'

const args = (...argv) => parseBackfillArgs(argv, { projectId: 'aglyn-main' })

test('the ceiling matches the route it has to agree with', () => {
  // The runner cannot import the TypeScript constant, so it mirrors it. A
  // mirror nobody checks is a mirror that drifts, and drift here means the
  // backfill and the upload route disagree about which objects get a strong
  // digest — the exact split this issue exists to close.
  const source = readFileSync(
    join(
      process.cwd(),
      'libs/tenant/data/admin/src/lib/server/media-strong-digest.ts',
    ),
    'utf8',
  )
  const match = source.match(
    /MEDIA_STRONG_DIGEST_MAX_BYTES\s*=\s*(\d+)\s*\*\s*1024\s*\*\s*1024/,
  )
  ok(match, 'could not find the ceiling in media-strong-digest.ts')
  strictEqual(MEDIA_STRONG_DIGEST_MAX_BYTES, Number(match[1]) * 1024 * 1024)
})

test('refuses to run without naming a collection', () => {
  const parsed = args()
  strictEqual(parsed.ok, false)
  ok(/--collection/.test(parsed.error), parsed.error)
})

test('refuses a collection that is not one of the two media trees', () => {
  strictEqual(args('--collection=media').ok, false)
  strictEqual(args('--collection=orgs/acme').ok, false)
  strictEqual(args('--collection=ORGS').ok, false)
})

test('accepts each media tree, one pass at a time', () => {
  strictEqual(args('--collection=orgs').collection, 'orgs')
  strictEqual(args('--collection=hosts').collection, 'hosts')
})

test('a bare run is a DRY RUN — no flag opts into that, it is the default', () => {
  const parsed = args('--collection=orgs')
  strictEqual(parsed.ok, true)
  strictEqual(parsed.apply, false)
})

test('--apply alone is refused — one flag must not be able to write', () => {
  const parsed = args('--collection=orgs', '--apply')
  strictEqual(parsed.ok, false)
  ok(/--confirm/.test(parsed.error), parsed.error)
})

test('--apply with the WRONG project id is refused', () => {
  // The failure this guards against is a rehearsal against staging whose
  // command line is then pasted at production, or the reverse.
  const parsed = args('--collection=orgs', '--apply', '--confirm=aglyn-staging')
  strictEqual(parsed.ok, false)
  ok(/aglyn-main/.test(parsed.error), parsed.error)
})

test('--apply with the project typed out is accepted', () => {
  const parsed = args('--collection=orgs', '--apply', '--confirm=aglyn-main')
  strictEqual(parsed.ok, true)
  strictEqual(parsed.apply, true)
})

test('carries a resume cursor, because the expensive half is the re-read', () => {
  const parsed = args('--collection=hosts', '--after=hosts/abc/media/xyz')
  strictEqual(parsed.after, 'hosts/abc/media/xyz')
  strictEqual(args('--collection=hosts', '--limit=25').limit, 25)
})

const doc = (data) => ({ path: 'orgs/acme/media/m1', data })

test('digests an ordinary legacy document', () => {
  const plan = planForDocument(
    doc({ storagePath: 'orgs/acme/media/m1', sizeBytes: 4096, contentHash: 'abc123' }),
  )
  strictEqual(plan.action, 'digest')
})

test('NEVER overwrites a strong digest a route already wrote', () => {
  // Additive only. A value written from bytes the server genuinely held
  // beats one this script derives, and clobbering it would be a silent
  // rewrite of a live quarantine key.
  const plan = planForDocument(
    doc({ storagePath: 'orgs/acme/media/m1', sizeBytes: 4096, contentSha256: 'f'.repeat(64) }),
  )
  strictEqual(plan.action, 'skip')
  strictEqual(plan.reason, 'already-strong')
})

test('skips a document with no object behind it', () => {
  const plan = planForDocument(doc({ sizeBytes: 4096 }))
  strictEqual(plan.action, 'skip')
  strictEqual(plan.reason, 'no-object')
})

test('skips an object over the ceiling rather than paying for it', () => {
  const plan = planForDocument(
    doc({
      storagePath: 'orgs/acme/media/m1',
      sizeBytes: MEDIA_STRONG_DIGEST_MAX_BYTES + 1,
    }),
  )
  strictEqual(plan.action, 'skip')
  strictEqual(plan.reason, 'over-ceiling')
})

test('skips an unknown size instead of starting an unbounded read', () => {
  for (const sizeBytes of [0, -1, undefined, 'lots', Number.NaN]) {
    const plan = planForDocument(doc({ storagePath: 'orgs/acme/media/m1', sizeBytes }))
    strictEqual(plan.action, 'skip')
    strictEqual(plan.reason, 'unknown-size')
  }
})

test('still digests a TRASHED document', () => {
  // A restore brings the bytes straight back, and a takedown notice does not
  // stop applying because the customer tidied up — the same argument the
  // staff quarantine page already makes to an operator.
  const plan = planForDocument(
    doc({ storagePath: 'orgs/acme/media/m1', sizeBytes: 4096, deletedAt: 1 }),
  )
  strictEqual(plan.action, 'digest')
})

test('the patch writes contentSha256 and NOTHING else', () => {
  // The load-bearing assertion of this whole file. `contentHash` is the ETag
  // and the immutable URL's path segment; a patch that carried it would
  // break embeds minted before AGL-829 and invalidate every stored cache
  // validator at once. `deepStrictEqual` rather than a property check,
  // because the failure mode is an EXTRA key, not a missing one.
  const patch = backfillPatch('a'.repeat(64))
  deepStrictEqual(patch, { contentSha256: 'a'.repeat(64) })
})

test('the patch refuses anything that is not a full-width hex digest', () => {
  // A short, upper-case or non-hex value would be written as the PREFERRED
  // quarantine key and would shadow the legacy hash that does match — a
  // takedown quietly lifting itself.
  for (const bad of ['', 'abc', 'A'.repeat(64), 'g'.repeat(64), 'a'.repeat(63), null]) {
    let threw = false
    try {
      backfillPatch(bad)
    } catch {
      threw = true
    }
    strictEqual(threw, true, `expected ${String(bad)} to be refused`)
  }
})
