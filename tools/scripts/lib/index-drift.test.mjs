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

// Tests for the live-vs-file Firestore index drift check (AGL-1804).
//
// THE POINT OF THIS SUITE IS THAT THE GUARD CAN BE MADE TO FAIL. The e2e cases
// stand up a stub of the Firestore Admin API, synthesize the DEPLOYED form of
// the repo's real index file (trailing `__name__` and all), and then plant
// drift in each direction separately, asserting the CLI's real exit codes —
// never read through a pipe.
//
// The stub is filter-aware on purpose. `ListFields` only returns explicitly
// configured fields, and the documented filter for that,
// `indexConfig.usesAncestorConfig=false`, MISSES TTL POLICIES: measured against
// `aglyn-main`, both TTL fields report `usesAncestorConfig: true`, so that
// filter returns 15 fields and hides `mediaTombstones.expiresAt` — the exact
// AGL-1801 entry this checker exists to catch. The stub models that, so
// narrowing the filter turns the clean case red instead of silently blinding
// the check.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { spawn } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  collectionGroupFromResourceName,
  compareIndexes,
  compositeCreateBody,
  compositeKey,
  describeOverride,
  fieldPatchBody,
  fieldResourceId,
  implicitNameOrder,
  normalizeFileOverride,
  normalizeLiveOverride,
  planIndexDeploy,
  stripImplicitNameField,
} from './index-drift.mjs'
import { FIELD_OVERRIDE_FILTER } from './firestore-indexes-api.mjs'

const here = dirname(fileURLToPath(import.meta.url))
const repoRoot = join(here, '..', '..', '..')
const cliPath = join(repoRoot, 'tools', 'scripts', 'check-index-drift.mjs')
const indexFilePath = join(repoRoot, 'cloud', 'firebase-firestore.indexes.json')
const PROJECT = 'index-drift-test'

const readIndexFile = () => JSON.parse(readFileSync(indexFilePath, 'utf8'))

// --- the deployed form: what the Admin API reports back for a file entry ---
//
// A faithful double, not a convenient one (an unfaithful fake fabricates false
// GREENS and false REDS alike). Every shape below was read off `aglyn-main`:
// the appended `__name__`, `density: SPARSE_ALL`, `state: READY`, and — the
// one that matters — `usesAncestorConfig: true` on a TTL field.

function deployedIndex(entry, i) {
  const fields = [...entry.fields]
  const last = fields[fields.length - 1]
  fields.push({ fieldPath: '__name__', order: implicitNameOrder(last) })
  return {
    name: `projects/${PROJECT}/databases/(default)/collectionGroups/${entry.collectionGroup}/indexes/CICAg${i}`,
    queryScope: entry.queryScope,
    fields,
    state: 'READY',
    density: 'SPARSE_ALL',
  }
}

function deployedField(entry) {
  const indexes = (entry.indexes ?? []).map((index) => ({
    queryScope: index.queryScope,
    fields: [
      index.order
        ? { fieldPath: entry.fieldPath, order: index.order }
        : { fieldPath: entry.fieldPath, arrayConfig: index.arrayConfig },
    ],
    state: 'READY',
  }))
  return {
    name: `projects/${PROJECT}/databases/(default)/collectionGroups/${entry.collectionGroup}/fields/${entry.fieldPath}`,
    indexConfig: {
      indexes,
      // Measured: a TTL field inherits the database default index config, so
      // it is NOT returned by the usesAncestorConfig=false filter.
      usesAncestorConfig: entry.ttl === true,
      ...(entry.ttl === true
        ? {
            ancestorField: `projects/${PROJECT}/databases/(default)/collectionGroups/__default__/fields/*`,
          }
        : {}),
    },
    ...(entry.ttl === true ? { ttlConfig: { state: 'ACTIVE' } } : {}),
  }
}

/** The database-wide default field config production always reports. */
const DEFAULT_FIELD = {
  name: `projects/${PROJECT}/databases/(default)/collectionGroups/__default__/fields/*`,
  indexConfig: {
    indexes: [
      {
        queryScope: 'COLLECTION',
        fields: [{ fieldPath: '*', order: 'ASCENDING' }],
      },
      {
        queryScope: 'COLLECTION',
        fields: [{ fieldPath: '*', order: 'DESCENDING' }],
      },
      {
        queryScope: 'COLLECTION',
        fields: [{ fieldPath: '*', arrayConfig: 'CONTAINS' }],
      },
    ],
    usesAncestorConfig: false,
  },
}

function liveFromFile(file) {
  return {
    indexes: file.indexes.map(deployedIndex),
    fields: [DEFAULT_FIELD, ...file.fieldOverrides.map(deployedField)],
  }
}

// --- unit: normalization ------------------------------------------------

describe('stripImplicitNameField (the trailing __name__, AGL-1804)', () => {
  it('drops a trailing __name__ that inherits the last field order', () => {
    assert.deepEqual(
      stripImplicitNameField([
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: '__name__', order: 'ASCENDING' },
      ]),
      [{ fieldPath: 'status', order: 'ASCENDING' }],
    )
    assert.deepEqual(
      stripImplicitNameField([
        { fieldPath: 'createdAt', order: 'DESCENDING' },
        { fieldPath: '__name__', order: 'DESCENDING' },
      ]),
      [{ fieldPath: 'createdAt', order: 'DESCENDING' }],
    )
  })

  it('drops an ASCENDING __name__ after an arrayConfig field — the four `visibleTo CONTAINS` indexes', () => {
    assert.deepEqual(
      stripImplicitNameField([
        { fieldPath: 'name', order: 'ASCENDING' },
        { fieldPath: 'visibleTo', arrayConfig: 'CONTAINS' },
        { fieldPath: '__name__', order: 'ASCENDING' },
      ]).length,
      2,
    )
  })

  it('KEEPS a trailing __name__ at a non-default direction — that is a different index', () => {
    const fields = [
      { fieldPath: 'status', order: 'ASCENDING' },
      { fieldPath: '__name__', order: 'DESCENDING' },
    ]
    assert.deepEqual(stripImplicitNameField(fields), fields)
  })

  it('keeps a __name__ that is not last, and leaves a lone field alone', () => {
    const middle = [
      { fieldPath: '__name__', order: 'ASCENDING' },
      { fieldPath: 'status', order: 'ASCENDING' },
    ]
    assert.deepEqual(stripImplicitNameField(middle), middle)
    const lone = [{ fieldPath: '__name__', order: 'ASCENDING' }]
    assert.deepEqual(stripImplicitNameField(lone), lone)
  })
})

describe('compositeKey', () => {
  it('the file form and the deployed form of the SAME index share a key — all 43 of them', () => {
    const file = readIndexFile()
    assert.ok(file.indexes.length >= 40, 'expected the real index file')
    const mismatched = file.indexes.filter(
      (entry, i) =>
        compositeKey(entry) !== compositeKey(deployedIndex(entry, i)),
    )
    assert.deepEqual(
      mismatched.map((e) => compositeKey(e)),
      [],
      'a naive comparison reports every deployed composite as drift; this is the normalization that stops it',
    )
  })

  it('reads the collectionGroup out of an Admin API resource name', () => {
    assert.equal(
      collectionGroupFromResourceName(
        'projects/p/databases/(default)/collectionGroups/bookings/indexes/CIC',
      ),
      'bookings',
    )
    assert.equal(collectionGroupFromResourceName(undefined), null)
  })

  it('distinguishes query scope, field order and field position', () => {
    const base = {
      collectionGroup: 'bookings',
      queryScope: 'COLLECTION',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'startsAtMs', order: 'ASCENDING' },
      ],
    }
    const group = { ...base, queryScope: 'COLLECTION_GROUP' }
    const desc = {
      ...base,
      fields: [
        base.fields[0],
        { fieldPath: 'startsAtMs', order: 'DESCENDING' },
      ],
    }
    const swapped = { ...base, fields: [base.fields[1], base.fields[0]] }
    const keys = new Set([base, group, desc, swapped].map(compositeKey))
    assert.equal(keys.size, 4)
  })
})

describe('normalizeLiveOverride / normalizeFileOverride', () => {
  it('agree on a plain override', () => {
    const entry = {
      collectionGroup: 'installs',
      fieldPath: 'listingId',
      indexes: [
        { queryScope: 'COLLECTION', order: 'ASCENDING' },
        { queryScope: 'COLLECTION', order: 'DESCENDING' },
        { queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' },
      ],
    }
    const file = normalizeFileOverride(entry)
    const live = normalizeLiveOverride(deployedField(entry))
    assert.equal(file.id, 'installs.listingId')
    assert.equal(live.id, file.id)
    assert.deepEqual(live.scopes, file.scopes)
    assert.equal(live.ttl, false)
  })

  it('an exemption (indexes: []) is a state, not a missing value', () => {
    const entry = {
      collectionGroup: 'versions',
      fieldPath: 'nodes',
      indexes: [],
    }
    assert.deepEqual(normalizeFileOverride(entry).scopes, [])
    assert.deepEqual(normalizeLiveOverride(deployedField(entry)).scopes, [])
    assert.match(describeOverride(normalizeFileOverride(entry)), /EXEMPT/)
  })

  it('a TTL field reads as ttl:true even though it uses the ancestor index config', () => {
    const entry = {
      collectionGroup: 'mediaTombstones',
      fieldPath: 'expiresAt',
      ttl: true,
      indexes: [
        { queryScope: 'COLLECTION', order: 'ASCENDING' },
        { queryScope: 'COLLECTION', order: 'DESCENDING' },
        { queryScope: 'COLLECTION', arrayConfig: 'CONTAINS' },
      ],
    }
    const live = normalizeLiveOverride(deployedField(entry))
    assert.equal(live.indexConfigUsesAncestor, undefined) // not part of the verdict
    assert.equal(live.ttl, true)
    assert.equal(live.ttlState, 'ACTIVE')
    assert.deepEqual(live.scopes, normalizeFileOverride(entry).scopes)
  })
})

// --- unit: the comparison ------------------------------------------------

describe('compareIndexes against the real index file', () => {
  const file = readIndexFile()

  it('a project that matches the file reports ZERO drift, not 43', () => {
    const live = liveFromFile(file)
    const report = compareIndexes({
      liveIndexes: live.indexes,
      liveFields: live.fields,
      fileIndexes: file.indexes,
      fileOverrides: file.fieldOverrides,
    })
    assert.equal(report.drift, false)
    assert.equal(report.composite.matched, file.indexes.length)
    assert.equal(report.overrides.matched, file.fieldOverrides.length)
    assert.deepEqual(report.composite.prodOnly, [])
    assert.deepEqual(report.composite.fileOnly, [])
    assert.deepEqual(report.overrides.prodOnly, [])
    assert.deepEqual(report.overrides.fileOnly, [])
    assert.deepEqual(report.overrides.differing, [])
    assert.deepEqual(report.notReady, [])
  })

  it('the database-default field is skipped, not reported as prod-only', () => {
    const live = liveFromFile(file)
    const report = compareIndexes({
      liveIndexes: live.indexes,
      liveFields: live.fields,
      fileIndexes: file.indexes,
      fileOverrides: file.fieldOverrides,
    })
    assert.equal(report.skipped.length, 1)
    assert.match(report.skipped[0], /__default__/)
  })

  it('the AGL-1801 shape — a live TTL policy missing from the file — is PROD-ONLY drift, flagged as a TTL', () => {
    const live = liveFromFile(file)
    const withoutTtl = file.fieldOverrides.filter(
      (o) =>
        !(
          o.collectionGroup === 'mediaTombstones' && o.fieldPath === 'expiresAt'
        ),
    )
    assert.equal(
      withoutTtl.length,
      file.fieldOverrides.length - 1,
      'premise: the entry is in the file',
    )
    const report = compareIndexes({
      liveIndexes: live.indexes,
      liveFields: live.fields,
      fileIndexes: file.indexes,
      fileOverrides: withoutTtl,
    })
    assert.equal(report.drift, true)
    assert.equal(report.overrides.prodOnly.length, 1)
    assert.equal(report.overrides.prodOnly[0].id, 'mediaTombstones.expiresAt')
    assert.equal(report.overrides.prodOnly[0].ttl, true)
    assert.equal(report.overrides.fileOnly.length, 0)
  })

  it('the AGL-1793 shape — a collection-group override in the file, not deployed — is FILE-ONLY drift', () => {
    const live = liveFromFile(file)
    const undeployed = live.fields.filter(
      (f) => !f.name.endsWith('/collectionGroups/checkouts/fields/status'),
    )
    assert.equal(
      undeployed.length,
      live.fields.length - 1,
      'premise: the field is live',
    )
    const report = compareIndexes({
      liveIndexes: live.indexes,
      liveFields: undeployed,
      fileIndexes: file.indexes,
      fileOverrides: file.fieldOverrides,
    })
    assert.equal(report.drift, true)
    assert.equal(report.overrides.fileOnly.length, 1)
    assert.equal(report.overrides.fileOnly[0].id, 'checkouts.status')
    assert.equal(report.overrides.prodOnly.length, 0)
  })

  it('a composite index drifts in each direction independently', () => {
    const live = liveFromFile(file)
    const prodOnly = compareIndexes({
      liveIndexes: live.indexes,
      liveFields: live.fields,
      fileIndexes: file.indexes.slice(1),
      fileOverrides: file.fieldOverrides,
    })
    assert.equal(prodOnly.composite.prodOnly.length, 1)
    assert.equal(prodOnly.composite.fileOnly.length, 0)
    assert.equal(prodOnly.composite.matched, file.indexes.length - 1)

    const fileOnly = compareIndexes({
      liveIndexes: live.indexes.slice(1),
      liveFields: live.fields,
      fileIndexes: file.indexes,
      fileOverrides: file.fieldOverrides,
    })
    assert.equal(fileOnly.composite.fileOnly.length, 1)
    assert.equal(fileOnly.composite.prodOnly.length, 0)
  })
})

describe('compareIndexes edge cases', () => {
  const override = (extra) => ({
    collectionGroup: 'bookings',
    fieldPath: 'startsAtMs',
    indexes: [
      { queryScope: 'COLLECTION', order: 'ASCENDING' },
      { queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' },
    ],
    ...extra,
  })
  const run = ({ liveFields, fileOverrides }) =>
    compareIndexes({
      liveIndexes: [],
      liveFields,
      fileIndexes: [],
      fileOverrides,
    })

  it('a scope set that differs is DIFFERING, not two one-sided entries', () => {
    const narrower = override({
      indexes: [{ queryScope: 'COLLECTION', order: 'ASCENDING' }],
    })
    const report = run({
      liveFields: [deployedField(narrower)],
      fileOverrides: [override()],
    })
    assert.equal(report.drift, true)
    assert.equal(report.overrides.differing.length, 1)
    assert.equal(report.overrides.prodOnly.length, 0)
    assert.equal(report.overrides.fileOnly.length, 0)
    assert.match(
      report.overrides.differing[0].reasons[0],
      /index scopes differ/,
    )
    assert.match(report.overrides.differing[0].reasons[0], /COLLECTION_GROUP/)
  })

  it('scope ORDER inside the entry is not drift', () => {
    const reordered = {
      ...override(),
      indexes: [...override().indexes].reverse(),
    }
    const report = run({
      liveFields: [deployedField(override())],
      fileOverrides: [reordered],
    })
    assert.equal(report.drift, false)
  })

  it('an exemption that has become an indexed field is DIFFERING', () => {
    const report = run({
      liveFields: [deployedField(override())],
      fileOverrides: [
        { collectionGroup: 'bookings', fieldPath: 'startsAtMs', indexes: [] },
      ],
    })
    assert.equal(report.overrides.differing.length, 1)
    assert.match(
      report.overrides.differing[0].reasons[0],
      /EXEMPT|none: exempt/,
    )
  })

  it('a TTL flag that disagrees is drift in BOTH directions, with opposite advice', () => {
    const liveHasTtl = run({
      liveFields: [deployedField(override({ ttl: true }))],
      fileOverrides: [override()],
    })
    assert.equal(liveHasTtl.overrides.differing.length, 1)
    assert.match(
      liveHasTtl.overrides.differing[0].reasons.join(' '),
      /DISABLE it/,
    )

    const fileHasTtl = run({
      liveFields: [deployedField(override())],
      fileOverrides: [override({ ttl: true })],
    })
    assert.equal(fileHasTtl.overrides.differing.length, 1)
    assert.match(
      fileHasTtl.overrides.differing[0].reasons.join(' '),
      /gcloud enable command/,
    )
  })

  it('an index still building is reported even when nothing drifted', () => {
    const entry = {
      collectionGroup: 'bookings',
      queryScope: 'COLLECTION_GROUP',
      fields: [{ fieldPath: 'startsAtMs', order: 'ASCENDING' }],
    }
    const report = compareIndexes({
      liveIndexes: [{ ...deployedIndex(entry, 0), state: 'CREATING' }],
      liveFields: [],
      fileIndexes: [entry],
      fileOverrides: [],
    })
    assert.equal(report.drift, false)
    assert.equal(report.notReady.length, 1)
    assert.match(report.notReady[0], /CREATING/)
  })

  it('a duplicated file entry is surfaced, not absorbed', () => {
    const entry = {
      collectionGroup: 'bookings',
      queryScope: 'COLLECTION_GROUP',
      fields: [{ fieldPath: 'startsAtMs', order: 'ASCENDING' }],
    }
    const report = compareIndexes({
      liveIndexes: [deployedIndex(entry, 0)],
      liveFields: [],
      fileIndexes: [entry, entry],
      fileOverrides: [],
    })
    assert.equal(report.drift, true)
    assert.equal(report.composite.fileOnly.length, 1)
  })
})

// --- e2e: the real CLI against a stubbed Admin API ----------------------

/**
 * A filter-aware ListFields stub. `usesAncestorConfig: true` entries are
 * returned ONLY when the request filter mentions `ttlConfig` — which is what
 * production does, and what makes narrowing the filter fail this suite instead
 * of silently blinding the checker to every TTL policy.
 */
async function withStub({ indexes, fields, status }, run) {
  const seenFilters = []
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    if (status) return send(status, '{"error":{"message":"stub outage"}}')
    if (url.pathname.endsWith('/indexes')) return send(200, { indexes })
    if (url.pathname.endsWith('/fields')) {
      const filter = url.searchParams.get('filter') ?? ''
      seenFilters.push(filter)
      const wantsTtl = filter.includes('ttlConfig')
      return send(200, {
        fields: fields.filter(
          (f) => wantsTtl || f.indexConfig?.usesAncestorConfig !== true,
        ),
      })
    }
    send(404, `{"error":"unexpected path ${url.pathname}"}`)
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run({ port: server.address().port, seenFilters })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/**
 * Run the real CLI. Async (never spawnSync): the stub lives in THIS process,
 * so a synchronous spawn would deadlock the CLI's fetches against it.
 */
function runCli({ port, args = [], cwd = repoRoot, env = null }) {
  const child = spawn(process.execPath, [cliPath, ...args], {
    cwd,
    env: env ?? {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      FIREBASE_PROJECT_ID: PROJECT,
      INDEX_CHECK_ACCESS_TOKEN: 'stub-token',
      FIRESTORE_ADMIN_API_BASE: `http://127.0.0.1:${port}`,
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (c) => (stdout += c))
  child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c))
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

/** Write a doctored copy of the index file. Never edits the shared checkout. */
function doctoredFile(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'agl1804-'))
  const file = readIndexFile()
  mutate(file)
  const path = join(dir, 'firebase-firestore.indexes.json')
  writeFileSync(path, `${JSON.stringify(file, null, 2)}\n`)
  return { path, dir }
}

describe('check-index-drift CLI (planted drift, stubbed Admin API)', () => {
  it('a project that matches the file exits 0 and reports 43 = 43, not 43 mismatches', async () => {
    const file = readIndexFile()
    const live = liveFromFile(file)
    await withStub(live, async ({ port, seenFilters }) => {
      const result = await runCli({ port })
      assert.equal(
        result.status,
        0,
        `expected clean exit, got ${result.status}:\n${result.stdout}\n${result.stderr}`,
      )
      assert.match(
        result.stdout,
        new RegExp(`Composite indexes: ${file.indexes.length} matched`),
      )
      assert.match(
        result.stdout,
        new RegExp(`Field overrides:   ${file.fieldOverrides.length} matched`),
      )
      assert.match(result.stdout, /No drift/)
      // The TTL trap: the request must have asked for ttlConfig fields.
      assert.ok(
        seenFilters.every((f) => f.includes('ttlConfig')),
        `ListFields was called without a ttlConfig filter: ${JSON.stringify(seenFilters)}`,
      )
    })
  })

  it('DELETED-BY-THE-NEXT-DEPLOY direction: an override live but not in the file exits 1 and says so', async () => {
    const live = liveFromFile(readIndexFile())
    const { path, dir } = doctoredFile((file) => {
      file.fieldOverrides = file.fieldOverrides.filter(
        (o) =>
          !(
            o.collectionGroup === 'mediaTombstones' &&
            o.fieldPath === 'expiresAt'
          ),
      )
    })
    try {
      await withStub(live, async ({ port }) => {
        const result = await runCli({ port, args: [`--file=${path}`] })
        assert.equal(
          result.status,
          1,
          `expected drift exit 1, got ${result.status}:\n${result.stdout}\n${result.stderr}`,
        )
        assert.match(result.stderr, /PROD-ONLY field overrides \(1\)/)
        assert.match(result.stderr, /DELETES THESE/)
        assert.match(result.stderr, /mediaTombstones\.expiresAt/)
        assert.match(result.stderr, /LIVE TTL policy/)
        // No FILE-ONLY *bucket*. The closing advice names both directions on
        // purpose, so this must not match on the word alone.
        assert.doesNotMatch(result.stderr, /FILE-ONLY (composite|field)/)
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('NOT-DEPLOYED direction: an index in the file but not live exits 1 and names FAILED_PRECONDITION', async () => {
    const live = liveFromFile(readIndexFile())
    const { path, dir } = doctoredFile((file) => {
      file.indexes.push({
        collectionGroup: 'bookings',
        queryScope: 'COLLECTION_GROUP',
        fields: [
          { fieldPath: 'hostId', order: 'ASCENDING' },
          { fieldPath: 'startsAtMs', order: 'DESCENDING' },
        ],
      })
      file.fieldOverrides.push({
        collectionGroup: 'pluginVersions',
        fieldPath: 'trust',
        indexes: [
          { queryScope: 'COLLECTION', order: 'ASCENDING' },
          { queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' },
        ],
      })
    })
    try {
      await withStub(live, async ({ port }) => {
        const result = await runCli({ port, args: [`--file=${path}`] })
        assert.equal(
          result.status,
          1,
          `expected drift exit 1, got ${result.status}:\n${result.stdout}\n${result.stderr}`,
        )
        assert.match(result.stderr, /FILE-ONLY composite indexes \(1\)/)
        assert.match(result.stderr, /FILE-ONLY field overrides \(1\)/)
        assert.match(result.stderr, /FAILED_PRECONDITION/)
        assert.match(result.stderr, /pluginVersions\.trust/)
        assert.doesNotMatch(result.stderr, /PROD-ONLY (composite|field)/)
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('a live API failure exits 2 — cannot-check never masquerades as clean', async () => {
    await withStub(
      { indexes: [], fields: [], status: 500 },
      async ({ port }) => {
        const result = await runCli({ port })
        assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
        assert.match(result.stderr, /Cannot check/)
        assert.match(result.stderr, /NOT clean/)
      },
    )
  })

  it('missing credentials exit 2, never 0', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'agl1804-nocreds-'))
    try {
      const result = await runCli({
        port: 0,
        cwd: bare,
        env: { PATH: process.env.PATH, HOME: process.env.HOME },
      })
      assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /Cannot check/)
      assert.match(result.stderr, /FIREBASE_PROJECT_ID/)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })

  it('an unreadable index file exits 2, not 1 — a parse error is not drift', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'agl1804-bad-'))
    const path = join(dir, 'broken.json')
    writeFileSync(path, '{ not json')
    try {
      await withStub(liveFromFile(readIndexFile()), async ({ port }) => {
        const result = await runCli({ port, args: [`--file=${path}`] })
        assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
        assert.match(result.stderr, /could not be read as JSON/)
      })
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// --- the checker is wired ------------------------------------------------

describe('the checker is wired (workflow + package.json)', () => {
  const workflowPath = join(repoRoot, '.github', 'workflows', 'index-drift.yml')

  it('package.json exposes check:index-drift and test:index-drift', () => {
    const pkg = JSON.parse(readFileSync(join(repoRoot, 'package.json'), 'utf8'))
    assert.equal(
      pkg.scripts['check:index-drift'],
      'node tools/scripts/check-index-drift.mjs',
    )
    assert.match(pkg.scripts['test:index-drift'], /index-drift\.test\.mjs/)
  })

  it('the workflow runs the checker, on a schedule and on index-file pushes, and fails loudly without secrets', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    assert.match(workflow, /npm run check:index-drift/)
    assert.match(workflow, /schedule:/)
    assert.ok(
      workflow.includes('cloud/firebase-firestore.indexes.json'),
      'the path filter must include the index file',
    )
    assert.ok(
      workflow.includes('tools/scripts/check-index-drift.mjs'),
      'the path filter must include the checker',
    )
    // A skipped check that renders green is the silent-drift failure mode.
    assert.match(workflow, /secrets\.FIREBASE_CLIENT_EMAIL/)
    assert.match(workflow, /secrets\.FIREBASE_PRIVATE_KEY/)
    assert.match(workflow, /exit 2/)
  })

  it('the workflow runs THIS self-test BEFORE it trusts the comparison (AGL-1778)', () => {
    const workflow = readFileSync(workflowPath, 'utf8')
    const selfTest = workflow.indexOf('npm run test:index-drift')
    const check = workflow.indexOf('npm run check:index-drift')
    assert.ok(
      selfTest !== -1,
      'index-drift.yml must run npm run test:index-drift',
    )
    assert.ok(
      check !== -1,
      'index-drift.yml must run npm run check:index-drift',
    )
    assert.ok(selfTest < check, 'the self-test must run BEFORE the comparison')
  })

  it('a SECOND, ACTIVE workflow runs this self-test, so the claim is not circular (AGL-1778)', () => {
    // Asserted only from inside index-drift.yml, "the workflow runs the
    // self-test" is circular: deleting the step deletes the check on the
    // deletion. rules-drift.yml is the second home — and deliberately NOT
    // nx-ci.yml. That workflow is ACTIVE (the `disabled_manually` claim here
    // was false — AGL-2381), but it runs its guard steps behind `typecheck`
    // and `docs:typecheck` in one sequential job: 26 of 72 runs on 2026-08-19.
    // A redundancy that answers a third of the time is not the one to hang a
    // non-circularity argument on.
    const rulesDrift = readFileSync(
      join(repoRoot, '.github', 'workflows', 'rules-drift.yml'),
      'utf8',
    )
    assert.match(rulesDrift, /npm run test:index-drift/)
  })

  it('the CLI uses the shared comparison and the shared auth path', () => {
    const source = readFileSync(cliPath, 'utf8')
    assert.match(source, /from '\.\/lib\/index-drift\.mjs'/)
    assert.match(source, /from '\.\/lib\/firestore-indexes-api\.mjs'/)
    assert.match(source, /compareIndexes\(/)
  })

  it('the field filter still asks for TTL policies — narrowing it blinds the check (AGL-1801)', () => {
    assert.match(FIELD_OVERRIDE_FILTER, /usesAncestorConfig=false/)
    assert.match(FIELD_OVERRIDE_FILTER, /ttlConfig/)
  })
})

/* ══════════════════════════════════════════════════════════════════════════
 * THE DEPLOY SIDE (AGL-2015)
 *
 * The self-hosting runbook deployed rules and stopped, sending the operator
 * to `npx firebase login` for indexes. These cover the script that closes
 * that gap — and they are written against the two consequences that are NOT
 * symmetric:
 *
 *   a missing COMPOSITE index breaks a READ (FAILED_PRECONDITION)
 *   a missing `indexes: []` EXEMPTION can break a WRITE (the 40KB
 *     index-entry limit on the besigner `nodes` blob)
 *
 * The write case is the one that reads as "the product is broken", so the
 * assertion that the exemption is actually transmitted, as an empty array
 * rather than an omitted key, is the load-bearing one in this block.
 * ══════════════════════════════════════════════════════════════════════════ */

const deployCliPath = join(
  repoRoot,
  'tools',
  'scripts',
  'deploy-firestore-indexes.mjs',
)

/** An empty Firebase project: no composites, only the database-default field. */
const emptyProject = () => ({ indexes: [], fields: [DEFAULT_FIELD] })

/**
 * A WRITE-aware Admin API double. The read half mirrors `withStub` exactly;
 * the write half records every request so a test can assert on the URL (the
 * `updateMask` lives there) as well as on the body.
 *
 * `failWrites` / `conflictWrites` are how the failure paths get exercised —
 * a deploy script that cannot be seen refusing is not known to refuse.
 */
async function withWriteStub(
  { indexes, fields, failWrites = false, conflictWrites = false },
  run,
) {
  const writes = []
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const send = (code, body) => {
      res.writeHead(code, { 'Content-Type': 'application/json' })
      res.end(typeof body === 'string' ? body : JSON.stringify(body))
    }
    if (req.method === 'GET') {
      if (url.pathname.endsWith('/indexes')) return send(200, { indexes })
      if (url.pathname.endsWith('/fields')) {
        const wantsTtl = (url.searchParams.get('filter') ?? '').includes(
          'ttlConfig',
        )
        return send(200, {
          fields: fields.filter(
            (f) => wantsTtl || f.indexConfig?.usesAncestorConfig !== true,
          ),
        })
      }
      return send(404, `{"error":"unexpected GET ${url.pathname}"}`)
    }
    let raw = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => (raw += chunk))
    req.on('end', () => {
      let body
      try {
        body = JSON.parse(raw || '{}')
      } catch {
        body = { unparseable: raw }
      }
      writes.push({
        method: req.method,
        pathname: url.pathname,
        search: url.search,
        body,
      })
      if (conflictWrites && req.method === 'POST') {
        return send(409, {
          error: { code: 409, status: 'ALREADY_EXISTS', message: 'exists' },
        })
      }
      if (failWrites) {
        return send(403, {
          error: {
            code: 403,
            status: 'PERMISSION_DENIED',
            message: 'missing datastore.indexes.create',
          },
        })
      }
      if (req.method === 'POST') {
        return send(200, { name: 'projects/x/operations/abc', done: false })
      }
      return send(200, body)
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run({ port: server.address().port, writes })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

/** Run the real deploy CLI against the stub. */
function runDeploy({ port, args = [], cwd = repoRoot, env = null }) {
  const child = spawn(process.execPath, [deployCliPath, ...args], {
    cwd,
    env: env ?? {
      PATH: process.env.PATH,
      HOME: process.env.HOME,
      FIREBASE_PROJECT_ID: PROJECT,
      // NOT the checker's INDEX_CHECK_ACCESS_TOKEN: the deploy refuses that
      // one on purpose, and this test is also the assertion that the two
      // credentials really are separate names.
      FIRESTORE_DEPLOY_ACCESS_TOKEN: 'stub-deploy-token',
      FIRESTORE_ADMIN_API_BASE: `http://127.0.0.1:${port}`,
    },
  })
  let stdout = ''
  let stderr = ''
  child.stdout.setEncoding('utf8').on('data', (c) => (stdout += c))
  child.stderr.setEncoding('utf8').on('data', (c) => (stderr += c))
  return new Promise((resolve, reject) => {
    child.on('error', reject)
    child.on('close', (status) => resolve({ status, stdout, stderr }))
  })
}

describe('deploy request bodies (AGL-2015)', () => {
  it('an EXEMPTION transmits as an empty array, never as an omitted key', () => {
    // `versions.nodes` is the entry that keeps the large besigner blob out of
    // the index. If `indexes: []` were dropped as "empty", the patch would say
    // nothing about indexing, the field would keep inheriting the database
    // default, and Firestore would go on REJECTING THE WRITE on the 40KB
    // index-entry limit — with the deploy reporting success.
    const body = fieldPatchBody({
      collectionGroup: 'versions',
      fieldPath: 'nodes',
      indexes: [],
    })
    assert.deepEqual(body, { indexConfig: { indexes: [] } })
    assert.ok(
      Object.prototype.hasOwnProperty.call(body.indexConfig, 'indexes'),
      'the exemption must be an explicit empty array',
    )
  })

  it('a non-exempt override names the field itself, not the `*` wildcard', () => {
    const body = fieldPatchBody({
      collectionGroup: 'installs',
      fieldPath: 'listingId',
      indexes: [
        { queryScope: 'COLLECTION', order: 'ASCENDING' },
        { queryScope: 'COLLECTION_GROUP', order: 'ASCENDING' },
      ],
    })
    assert.deepEqual(body.indexConfig.indexes, [
      {
        queryScope: 'COLLECTION',
        fields: [{ fieldPath: 'listingId', order: 'ASCENDING' }],
      },
      {
        queryScope: 'COLLECTION_GROUP',
        fields: [{ fieldPath: 'listingId', order: 'ASCENDING' }],
      },
    ])
  })

  it('a create body drops the trailing __name__ the API appends itself', () => {
    // Sending it back at the implicit direction is rejected, so a create body
    // built from a live-shaped entry must normalize exactly as the checker does.
    const body = compositeCreateBody({
      collectionGroup: 'campaigns',
      queryScope: 'COLLECTION_GROUP',
      fields: [
        { fieldPath: 'status', order: 'ASCENDING' },
        { fieldPath: 'sendAtMs', order: 'ASCENDING' },
        { fieldPath: '__name__', order: 'ASCENDING' },
      ],
    })
    assert.deepEqual(body.fields.map((f) => f.fieldPath), [
      'status',
      'sendAtMs',
    ])
    assert.equal(body.collectionGroup, undefined, 'group belongs in the URL')
  })

  it('an array field keeps arrayConfig rather than inventing an order', () => {
    const body = compositeCreateBody({
      collectionGroup: 'screens',
      queryScope: 'COLLECTION',
      fields: [{ fieldPath: 'visibleTo', arrayConfig: 'CONTAINS' }],
    })
    assert.deepEqual(body.fields, [
      { fieldPath: 'visibleTo', arrayConfig: 'CONTAINS' },
    ])
  })

  it('a bare field path is not escaped; an exotic one is', () => {
    assert.equal(fieldResourceId('nodes'), 'nodes')
    assert.equal(fieldResourceId('a.b'), '`a.b`')
  })
})

describe('planIndexDeploy (AGL-2015)', () => {
  const planFor = (live, file) =>
    planIndexDeploy({
      report: compareIndexes({
        liveIndexes: live.indexes,
        liveFields: live.fields,
        fileIndexes: file.indexes,
        fileOverrides: file.fieldOverrides,
      }),
      fileIndexes: file.indexes,
      fileOverrides: file.fieldOverrides,
    })

  it('an EMPTY project plans every index and every override in the file', () => {
    const file = readIndexFile()
    const plan = planFor(emptyProject(), file)
    assert.equal(plan.creates.length, file.indexes.length)
    assert.equal(plan.patches.length, file.fieldOverrides.length)
    assert.equal(plan.empty, false)
    // The write-blocking one is in there.
    assert.ok(
      plan.patches.some((p) => p.id === 'versions.nodes' && p.exempt),
      'the versions.nodes exemption must be planned',
    )
  })

  it('a project that already matches plans NOTHING — the run is idempotent', () => {
    const file = readIndexFile()
    const plan = planFor(liveFromFile(file), file)
    assert.deepEqual(plan.creates, [])
    assert.deepEqual(plan.patches, [])
    assert.equal(plan.empty, true)
  })

  it('NEVER plans a delete: a live entry absent from the file is reported, not removed', () => {
    const file = readIndexFile()
    const live = liveFromFile(file)
    // Something the operator created by hand that the file has never heard of.
    live.indexes.push(
      deployedIndex(
        {
          collectionGroup: 'invoices',
          queryScope: 'COLLECTION',
          fields: [{ fieldPath: 'handwritten', order: 'ASCENDING' }],
        },
        999,
      ),
    )
    const plan = planFor(live, file)
    assert.equal(plan.empty, true, 'nothing to write')
    assert.equal(plan.notDeleted.composite.length, 1)
    assert.match(plan.notDeleted.composite[0], /invoices/)
  })

  it('a live TTL policy the file does not declare lands in ttlAtRisk — the AGL-1801 shape', () => {
    const file = readIndexFile()
    const live = liveFromFile(file)
    live.fields.push(
      deployedField({
        collectionGroup: 'forgottenSweep',
        fieldPath: 'expiresAt',
        indexes: [],
        ttl: true,
      }),
    )
    const plan = planFor(live, file)
    assert.equal(plan.ttlAtRisk.length, 1)
    assert.equal(plan.ttlAtRisk[0].id, 'forgottenSweep.expiresAt')
    // And it is NOT scheduled for any write.
    assert.equal(plan.empty, true)
  })

  it('a TTL-only difference is NOT laundered into an indexConfig patch', () => {
    // The file says `ttl: true`, the project has the same index scopes but no
    // TTL policy. Patching indexConfig would succeed, change nothing that
    // matters, and report a green deploy over an unfixed problem.
    const file = readIndexFile()
    const ttlEntry = file.fieldOverrides.find((o) => o.ttl === true)
    assert.ok(ttlEntry, 'fixture needs a ttl override')
    const live = liveFromFile(file)
    live.fields = live.fields.map((f) =>
      f.name.endsWith(
        `/collectionGroups/${ttlEntry.collectionGroup}/fields/${ttlEntry.fieldPath}`,
      )
        ? { ...f, ttlConfig: undefined }
        : f,
    )
    const plan = planFor(live, file)
    const id = `${ttlEntry.collectionGroup}.${ttlEntry.fieldPath}`
    assert.ok(
      !plan.patches.some((p) => p.id === id),
      'a TTL-only gap must not be patched as an index config',
    )
    assert.ok(
      plan.ttlOwed.some((entry) => entry.id === id),
      'it must be reported as owed to set-firestore-ttl.mjs instead',
    )
  })
})

describe('deploy-firestore-indexes CLI (empty project, stubbed Admin API)', () => {
  it('deploys every index and override, and sends the exemption as an empty array', async () => {
    const file = readIndexFile()
    await withWriteStub(emptyProject(), async ({ port, writes }) => {
      const result = await runDeploy({ port })
      assert.equal(
        result.status,
        0,
        `expected clean deploy:\n${result.stdout}\n${result.stderr}`,
      )
      const creates = writes.filter((w) => w.method === 'POST')
      const patches = writes.filter((w) => w.method === 'PATCH')
      assert.equal(creates.length, file.indexes.length)
      assert.equal(patches.length, file.fieldOverrides.length)

      // THE WRITE-UNBLOCKING ASSERTION.
      const nodes = patches.find((w) =>
        w.pathname.endsWith('/collectionGroups/versions/fields/nodes'),
      )
      assert.ok(nodes, 'versions.nodes must be patched')
      assert.deepEqual(
        nodes.body.indexConfig.indexes,
        [],
        'the exemption must arrive as an explicit empty array',
      )

      // `updateMask=indexConfig` is what stops the patch clearing ttlConfig.
      // Without it this deploy would BE the AGL-1801 bug.
      for (const patch of patches) {
        assert.match(
          patch.search,
          /updateMask=indexConfig/,
          `patch to ${patch.pathname} lacks updateMask — it would clear ttlConfig`,
        )
      }

      // TTL is never written by this script, in any request.
      for (const write of writes) {
        assert.ok(
          !JSON.stringify(write.body).includes('ttlConfig'),
          `${write.method} ${write.pathname} tried to write a TTL policy`,
        )
      }

      // No __name__ is ever sent back on a create.
      for (const create of creates) {
        assert.ok(
          !(create.body.fields ?? []).some((f) => f.fieldPath === '__name__'),
          `${create.pathname} sent __name__, which the API rejects`,
        )
      }

      assert.match(result.stdout, /Index builds are ASYNCHRONOUS/)
      assert.match(result.stdout, /check:index-drift/)
    })
  })

  it('is IDEMPOTENT: a matching project writes nothing at all and exits 0', async () => {
    const file = readIndexFile()
    await withWriteStub(liveFromFile(file), async ({ port, writes }) => {
      const result = await runDeploy({ port })
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.deepEqual(
        writes,
        [],
        'a matching project must produce no writes whatsoever',
      )
      assert.match(result.stdout, /Nothing to deploy/)
    })
  })

  it('--dry-run reports the plan and sends NOTHING', async () => {
    await withWriteStub(emptyProject(), async ({ port, writes }) => {
      const result = await runDeploy({ port, args: ['--dry-run'] })
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.deepEqual(writes, [], '--dry-run must not write')
      assert.match(result.stdout, /Nothing was sent/)
      assert.match(result.stdout, /CREATE/)
      assert.match(result.stdout, /versions\.nodes/)
    })
  })

  it('409 ALREADY_EXISTS is not a failure — a half-finished run can be re-run', async () => {
    await withWriteStub(
      { ...emptyProject(), conflictWrites: true },
      async ({ port }) => {
        const result = await runDeploy({ port })
        assert.equal(
          result.status,
          0,
          `a re-run must exit 0:\n${result.stdout}\n${result.stderr}`,
        )
        assert.match(result.stdout, /already present/)
      },
    )
  })

  it('a REFUSED write exits 1, never 0, and says the project is partial', async () => {
    await withWriteStub(
      { ...emptyProject(), failWrites: true },
      async ({ port }) => {
        const result = await runDeploy({ port })
        assert.equal(
          result.status,
          1,
          `a refused deploy must not exit 0:\n${result.stdout}\n${result.stderr}`,
        )
        assert.match(result.stderr, /refused/)
        assert.match(result.stderr, /PARTIALLY configured/)
        assert.match(result.stderr, /PERMISSION_DENIED/)
      },
    )
  })

  it('warns about live entries it is NOT deleting, before writing anything', async () => {
    const file = readIndexFile()
    const live = liveFromFile(file)
    live.fields.push(
      deployedField({
        collectionGroup: 'forgottenSweep',
        fieldPath: 'expiresAt',
        indexes: [],
        ttl: true,
      }),
    )
    await withWriteStub(live, async ({ port, writes }) => {
      const result = await runDeploy({ port })
      assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /LIVE BUT NOT IN THE FILE/)
      assert.match(result.stderr, /NOT deleted by this script/)
      assert.match(result.stderr, /AGL-1801/)
      assert.match(result.stderr, /forgottenSweep\.expiresAt/)
      assert.deepEqual(writes, [], 'and it really did not touch it')
    })
  })

  it('a live API failure exits 2 — could-not-deploy is not a clean deploy', async () => {
    const server = createServer((req, res) => {
      res.writeHead(500, { 'Content-Type': 'application/json' })
      res.end('{"error":{"message":"stub outage"}}')
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    try {
      const result = await runDeploy({ port: server.address().port })
      assert.equal(result.status, 2, `${result.stdout}\n${result.stderr}`)
      assert.match(result.stderr, /Cannot deploy/)
    } finally {
      await new Promise((resolve) => server.close(resolve))
    }
  })

  it('missing credentials exit 2, and the CHECKER\'S token is not accepted', async () => {
    const bare = mkdtempSync(join(tmpdir(), 'agl2015-nocreds-'))
    try {
      const result = await runDeploy({
        port: 0,
        cwd: bare,
        env: {
          PATH: process.env.PATH,
          HOME: bare,
          FIREBASE_PROJECT_ID: PROJECT,
          // The drift checker's variable, deliberately the wrong name here.
          INDEX_CHECK_ACCESS_TOKEN: 'a-read-credential',
          FIRESTORE_ADMIN_API_BASE: 'http://127.0.0.1:1',
        },
      })
      assert.equal(
        result.status,
        2,
        `a read credential must not authorise a deploy:\n${result.stdout}\n${result.stderr}`,
      )
      assert.match(result.stderr, /Cannot deploy/)
      assert.match(result.stderr, /FIREBASE_CLIENT_EMAIL/)
    } finally {
      rmSync(bare, { recursive: true, force: true })
    }
  })
})
