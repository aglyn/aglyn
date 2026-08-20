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

/**
 * Live-vs-file Firestore INDEX comparison (AGL-1804).
 *
 * The rules counterpart of this module is lib/rules-drift.mjs; this one exists
 * because `cloud/firebase-firestore.indexes.json` had no drift check at all,
 * and one day's manual diff found three separate bugs that a standing check
 * would have caught the day each landed (AGL-1793, AGL-1801, AGL-1802).
 *
 * THE TWO DIRECTIONS ARE NOT SYMMETRIC, which is why they are reported as
 * separate buckets rather than as one "does it match" verdict:
 *
 *  - FILE-ONLY (in the repo, not in the project) — the index is not deployed,
 *    so every query that needs it throws `9 FAILED_PRECONDITION` in
 *    production. Silent when the caller is a cron: AGL-1793/AGL-1802 were
 *    three scheduled jobs that had never once run against real data, each
 *    swallowing the failure into a 500 nobody reads.
 *
 *  - PROD-ONLY (in the project, not in the repo) — the next
 *    `firebase deploy --only firestore:indexes` DELETES it, because that
 *    deploy reconciles the file onto the project and removes whatever the file
 *    does not list, `fieldOverrides` included. AGL-866 is that event having
 *    already happened once (the `versions.nodes` exemption); AGL-1801 is it
 *    nearly happening again to a live TTL policy. This is the dangerous
 *    direction, and it is the reason a bare "does the file match" check is not
 *    enough — the damage is caused by the deploy, not by the mismatch.
 *
 * NORMALIZATION — what does NOT count as drift, and why each one is here:
 *
 *  1. THE TRAILING `__name__`. Firestore appends the document key to every
 *     composite index it stores, so a naive comparison reports all 43 of this
 *     project's indexes as drift (it did, on the first manual pass). It is
 *     dropped only when its direction is the IMPLICIT one — the last real
 *     field's `order`, or ASCENDING when that field is an `arrayConfig`.
 *     Measured against all 43 live indexes in `aglyn-main`: 39 inherit the
 *     last field's order and 4 end in `visibleTo CONTAINS` with `__name__`
 *     ASCENDING. An explicit `__name__` at a NON-default direction is a
 *     different index and is deliberately kept, so declaring one in the file
 *     is still visible as drift.
 *
 *  2. THE DATABASE-DEFAULT FIELD. The Admin API lists
 *     `__default__/fields/*` — the database-wide default index config — among
 *     the field overrides. It is not a `fieldOverrides` entry and cannot be
 *     written as one, so counting it would report one permanent prod-only
 *     difference forever. A drift alarm that is red on a clean project is one
 *     people mute, and a muted alarm misses the real drift.
 *
 *  3. ORDER. Both `indexes` and `fieldOverrides` are sets; the file lists them
 *     in the order they were appended and the API in its own. Comparison is by
 *     canonical key, and duplicates are counted rather than collapsed so a
 *     double-added file entry still shows up.
 *
 * `density` is compared only when the file states it: the API reports
 * `SPARSE_ALL` on every index in this project (the default), and treating a
 * defaulted field the file never writes as a difference would fail the check
 * on every index at once.
 */

/** The database-wide default field config, which is not a `fieldOverrides` entry. */
export const DEFAULT_FIELD_COLLECTION_GROUP = '__default__'

/**
 * The direction Firestore gives an implicitly-appended `__name__` field: the
 * last real field's `order`, or ASCENDING when that field is an array config
 * (`arrayConfig` entries carry no order). Derived from the live index set, not
 * from the docs — see the module comment for the measurement.
 */
export function implicitNameOrder(lastRealField) {
  return lastRealField?.order || 'ASCENDING'
}

/**
 * Drop a trailing `__name__` field when its direction is the implicit one.
 * A trailing `__name__` at any other direction is a deliberate, different
 * index and survives normalization.
 */
export function stripImplicitNameField(fields) {
  const list = Array.isArray(fields) ? fields : []
  if (list.length < 2) return list
  const last = list[list.length - 1]
  if (last?.fieldPath !== '__name__') return list
  const rest = list.slice(0, -1)
  if (last.order !== implicitNameOrder(rest[rest.length - 1])) return list
  return rest
}

/** `collectionGroup` from an Admin API resource name, or null. */
export function collectionGroupFromResourceName(name) {
  const match = /\/collectionGroups\/([^/]+)/.exec(String(name ?? ''))
  return match ? match[1] : null
}

function fieldDirection(field) {
  return field?.order || field?.arrayConfig || 'UNSPECIFIED'
}

/**
 * Canonical key for one composite index. Accepts both shapes the project is
 * described in: the repo file / `firebase firestore:indexes` form
 * (`collectionGroup` present) and the Admin REST form (`name` resource path).
 */
export function compositeKey(index) {
  const group =
    index.collectionGroup ?? collectionGroupFromResourceName(index.name) ?? '?'
  const scope = index.queryScope || 'COLLECTION'
  const fields = stripImplicitNameField(index.fields)
    .map((f) => `${f.fieldPath}:${fieldDirection(f)}`)
    .join(', ')
  const density =
    index.density && index.density !== 'SPARSE_ALL'
      ? ` density=${index.density}`
      : ''
  return `${group} [${scope}] ${fields}${density}`
}

/** Count canonical keys, keeping duplicates visible. */
function keyCounts(items, keyOf) {
  const counts = new Map()
  for (const item of items ?? []) {
    const key = keyOf(item)
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }
  return counts
}

/**
 * Bucket two keyed multisets into left-only, right-only and shared. Duplicate
 * keys are surfaced as repeated entries so an accidentally doubled file entry
 * is not silently absorbed.
 */
function diffCounts(left, right) {
  const leftOnly = []
  const rightOnly = []
  let matched = 0
  for (const [key, n] of left) {
    const other = right.get(key) ?? 0
    matched += Math.min(n, other)
    for (let i = other; i < n; i += 1) leftOnly.push(key)
  }
  for (const [key, n] of right) {
    const other = left.get(key) ?? 0
    for (let i = other; i < n; i += 1) rightOnly.push(key)
  }
  leftOnly.sort()
  rightOnly.sort()
  return { leftOnly, rightOnly, matched }
}

/** `collectionGroup.fieldPath`, the identity of a single-field override. */
export function overrideId({ collectionGroup, fieldPath }) {
  return `${collectionGroup}.${fieldPath}`
}

function scopeLabel({ queryScope, order, arrayConfig }) {
  return `${queryScope || 'COLLECTION'}:${order || arrayConfig || 'UNSPECIFIED'}`
}

/**
 * Normalize a repo-file `fieldOverrides` entry.
 * `indexes: []` is an EXEMPTION (indexing switched off for that field) and is
 * a meaningful, comparable state — not a missing value.
 */
export function normalizeFileOverride(entry) {
  return {
    id: overrideId(entry),
    collectionGroup: entry.collectionGroup,
    fieldPath: entry.fieldPath,
    scopes: (entry.indexes ?? []).map(scopeLabel).sort(),
    ttl: entry.ttl === true,
  }
}

/**
 * Normalize an Admin API `Field` resource.
 *
 * ⚠️ A TTL field's `indexConfig` reports `usesAncestorConfig: true` — it has no
 * index override of its own and inherits `__default__`. Both of this project's
 * TTL fields read that way. Its `indexes` list is still the effective config
 * and still what `firebase firestore:indexes` round-trips into the file, so it
 * is compared as-is; the flag matters only for FETCHING the field at all (see
 * firestore-indexes-api.mjs).
 */
export function normalizeLiveOverride(field) {
  const name = String(field.name ?? '')
  const collectionGroup = collectionGroupFromResourceName(name) ?? '?'
  const fieldPath = name.split('/fields/').slice(1).join('/fields/') || '?'
  const indexes = field.indexConfig?.indexes ?? []
  return {
    id: `${collectionGroup}.${fieldPath}`,
    collectionGroup,
    fieldPath,
    scopes: indexes
      .map((index) =>
        scopeLabel({
          queryScope: index.queryScope,
          order: index.fields?.[0]?.order,
          arrayConfig: index.fields?.[0]?.arrayConfig,
        }),
      )
      .sort(),
    ttl: Boolean(field.ttlConfig),
    ttlState: field.ttlConfig?.state,
    notReady: indexes
      .filter((index) => index.state && index.state !== 'READY')
      .map(
        (index) =>
          `${scopeLabel({ queryScope: index.queryScope, order: index.fields?.[0]?.order, arrayConfig: index.fields?.[0]?.arrayConfig })} ${index.state}`,
      ),
  }
}

/**
 * Compare the live project against the repo file.
 *
 * @param {object} input
 * @param {Array} input.liveIndexes composite indexes from the Admin API.
 * @param {Array} input.liveFields `Field` resources from the Admin API.
 * @param {Array} input.fileIndexes the file's `indexes`.
 * @param {Array} input.fileOverrides the file's `fieldOverrides`.
 * @returns {{
 *   drift: boolean,
 *   composite: { matched: number, prodOnly: string[], fileOnly: string[] },
 *   overrides: {
 *     matched: number,
 *     prodOnly: object[],
 *     fileOnly: object[],
 *     differing: object[],
 *   },
 *   notReady: string[],
 *   skipped: string[],
 * }}
 */
export function compareIndexes({
  liveIndexes,
  liveFields,
  fileIndexes,
  fileOverrides,
}) {
  const composite = diffCounts(
    keyCounts(liveIndexes, compositeKey),
    keyCounts(fileIndexes, compositeKey),
  )

  const skipped = []
  const live = new Map()
  for (const field of liveFields ?? []) {
    const normalized = normalizeLiveOverride(field)
    if (normalized.collectionGroup === DEFAULT_FIELD_COLLECTION_GROUP) {
      skipped.push(
        `${normalized.id} (the database-wide default field config, not a fieldOverrides entry)`,
      )
      continue
    }
    live.set(normalized.id, normalized)
  }
  const file = new Map()
  for (const entry of fileOverrides ?? []) {
    const normalized = normalizeFileOverride(entry)
    file.set(normalized.id, normalized)
  }

  const prodOnly = []
  const fileOnly = []
  const differing = []
  let matched = 0
  for (const [id, liveEntry] of live) {
    const fileEntry = file.get(id)
    if (!fileEntry) {
      prodOnly.push(liveEntry)
      continue
    }
    const reasons = []
    if (liveEntry.scopes.join('|') !== fileEntry.scopes.join('|')) {
      reasons.push(
        `index scopes differ — live [${liveEntry.scopes.join(', ') || '(none: exempt)'}] vs file [${fileEntry.scopes.join(', ') || '(none: exempt)'}]`,
      )
    }
    if (liveEntry.ttl !== fileEntry.ttl) {
      reasons.push(
        liveEntry.ttl
          ? `TTL is live in the project (${liveEntry.ttlState}) and the file does not declare "ttl": true — the next index deploy can DISABLE it (AGL-1801)`
          : 'the file declares "ttl": true and the project has no TTL policy — run the gcloud enable command (docs/FIRESTORE_MANUAL_CONFIG.md)',
      )
    }
    if (reasons.length > 0) {
      differing.push({ id, live: liveEntry, file: fileEntry, reasons })
      continue
    }
    matched += 1
  }
  for (const [id, fileEntry] of file) {
    if (!live.has(id)) fileOnly.push(fileEntry)
  }

  const notReady = []
  for (const index of liveIndexes ?? []) {
    if (index.state && index.state !== 'READY') {
      notReady.push(`${compositeKey(index)} — ${index.state}`)
    }
  }
  for (const entry of live.values()) {
    for (const line of entry.notReady) notReady.push(`${entry.id} — ${line}`)
  }

  const sortById = (a, b) => a.id.localeCompare(b.id)
  prodOnly.sort(sortById)
  fileOnly.sort(sortById)
  differing.sort((a, b) => a.id.localeCompare(b.id))

  return {
    drift:
      composite.leftOnly.length > 0 ||
      composite.rightOnly.length > 0 ||
      prodOnly.length > 0 ||
      fileOnly.length > 0 ||
      differing.length > 0,
    composite: {
      matched: composite.matched,
      prodOnly: composite.leftOnly,
      fileOnly: composite.rightOnly,
    },
    overrides: { matched, prodOnly, fileOnly, differing },
    notReady,
    skipped: skipped.sort(),
  }
}

/** One-line human description of a normalized override. */
export function describeOverride(entry) {
  const scopes = entry.scopes.length
    ? entry.scopes.join(', ')
    : '(no indexes: EXEMPT)'
  return `${entry.id} — ${scopes}${entry.ttl ? ', ttl: true' : ''}`
}

/* ────────────────────────────────────────────────────────────────────────────
 * DEPLOY PLANNING (AGL-2015)
 *
 * `compareIndexes` above answers "does the project match the file". These
 * functions answer the next question — "what would it take to make it match" —
 * and they are here rather than in a module of their own because the reader
 * and the writer must never diverge in how they decide two entries are the
 * same thing. That is the AGL-1509 rule the rules scripts already follow: a
 * deploy that normalizes differently from the checker that verifies it will
 * re-create an index on every run and report drift forever.
 *
 * ⚠️ THE PLAN IS DELIBERATELY ADDITIVE. `firebase deploy --only
 * firestore:indexes` RECONCILES: it deletes whatever the project has and the
 * file does not list, `fieldOverrides` included. That is how AGL-866 actually
 * destroyed the `versions.nodes` exemption, and how AGL-1801 nearly disabled a
 * live TTL policy. A self-hoster's first index deploy is the one case where
 * reconciliation is harmless (the project is empty), but the same operator
 * runs the same command again later against a project that is not — so the
 * plan NEVER deletes. Prod-only entries are reported as `notDeleted` and the
 * operator is told which ones and why, which is a strictly better answer than
 * doing it silently.
 *
 * ⚠️ TTL IS NOT PLANNED HERE. `ttl: true` in the file is applied by
 * tools/scripts/set-firestore-ttl.mjs, and the split is not arbitrary: writing
 * `ttlConfig` through `fields.patch` in the same call that writes `indexConfig`
 * makes one failure mode indistinguishable from the other, and the TTL script
 * already owns the eight documented policies. Missing TTL is surfaced as
 * `ttlOwed` and pointed at that script instead of being silently skipped —
 * "not planned" must never read as "not needed".
 */

/**
 * The `fields.patch` document id for a field path. Firestore escapes any path
 * that is not a bare identifier with backticks; every override this repo ships
 * is a bare identifier, so this is a guard against a future one that is not,
 * rather than a transformation that fires today.
 */
export function fieldResourceId(fieldPath) {
  const path = String(fieldPath ?? '')
  if (/^[A-Za-z_][A-Za-z0-9_]*$/.test(path)) return path
  return `\`${path.replace(/\\/g, '\\\\').replace(/`/g, '\\`')}\``
}

/**
 * The Admin API `Index` body for one file entry: everything except the
 * `collectionGroup`, which is in the URL, and the trailing `__name__`, which
 * Firestore appends itself and REJECTS when sent explicitly at the implicit
 * direction.
 */
export function compositeCreateBody(index) {
  const body = {
    queryScope: index.queryScope || 'COLLECTION',
    fields: stripImplicitNameField(index.fields).map((field) => {
      const out = { fieldPath: field.fieldPath }
      if (field.order) out.order = field.order
      if (field.arrayConfig) out.arrayConfig = field.arrayConfig
      return out
    }),
  }
  if (index.density) body.density = index.density
  return body
}

/**
 * The `fields.patch` body for one file `fieldOverrides` entry.
 *
 * `indexes: []` is the EXEMPTION — indexing switched off for that field — and
 * it is the single most consequential thing this script writes: it is what
 * keeps the large besigner `nodes` blobs out of the index, and without it
 * Firestore tries to index them and REJECTS THE WRITE on the 40KB index-entry
 * limit. An empty array is therefore a real value that must be sent, never an
 * absent one to be omitted.
 */
export function fieldPatchBody(entry) {
  return {
    indexConfig: {
      indexes: (entry.indexes ?? []).map((index) => {
        const field = { fieldPath: entry.fieldPath }
        if (index.order) field.order = index.order
        if (index.arrayConfig) field.arrayConfig = index.arrayConfig
        return {
          queryScope: index.queryScope || 'COLLECTION',
          // The FIELD'S OWN PATH, not `*`. `*` is the wildcard the
          // database-wide `__default__` config uses, and sending it on a
          // single-field override is a different statement. This matches what
          // `ListFields` reports back for a configured field, which is what
          // makes a patch round-trip through check-index-drift.mjs cleanly
          // instead of reading as drift on the very next run.
          fields: [field],
        }
      }),
    },
  }
}

/**
 * Turn a `compareIndexes` report plus the file it was compared against into an
 * ordered, additive deploy plan.
 *
 * @returns {{
 *   creates: object[],
 *   patches: object[],
 *   notDeleted: { composite: string[], overrides: object[] },
 *   ttlOwed: object[],
 *   ttlAtRisk: object[],
 *   empty: boolean,
 * }}
 */
export function planIndexDeploy({ report, fileIndexes, fileOverrides }) {
  // Composite entries are diffed by canonical key, so the plan maps each
  // file-only key back to the file entries that produced it. Duplicates are
  // kept: `diffCounts` reports a doubled file entry twice, and creating it
  // twice is how the operator SEES the duplicate rather than having it
  // absorbed here.
  const byKey = new Map()
  for (const index of fileIndexes ?? []) {
    const key = compositeKey(index)
    if (!byKey.has(key)) byKey.set(key, [])
    byKey.get(key).push(index)
  }
  const taken = new Map()
  const creates = []
  for (const key of report.composite.fileOnly) {
    const candidates = byKey.get(key) ?? []
    const used = taken.get(key) ?? 0
    const entry = candidates[Math.min(used, candidates.length - 1)]
    taken.set(key, used + 1)
    if (!entry) continue
    creates.push({
      key,
      collectionGroup: entry.collectionGroup,
      body: compositeCreateBody(entry),
    })
  }

  const fileById = new Map()
  for (const entry of fileOverrides ?? []) {
    fileById.set(overrideId(entry), entry)
  }

  const patches = []
  const ttlOwed = []
  const seen = new Set()
  const queue = [
    ...report.overrides.fileOnly.map((entry) => ({ id: entry.id, why: 'absent from the project' })),
    ...report.overrides.differing.map((entry) => ({
      id: entry.id,
      why: entry.reasons.join('; '),
      indexReasons: entry.reasons.filter((r) => r.startsWith('index scopes differ')),
      ttlOnly: entry.reasons.every((r) => !r.startsWith('index scopes differ')),
    })),
  ]
  for (const item of queue) {
    if (seen.has(item.id)) continue
    seen.add(item.id)
    const source = fileById.get(item.id)
    if (!source) continue
    // A difference that is ONLY about TTL is not fixable by an indexConfig
    // patch. Patching anyway would rewrite the field, report success, and
    // leave the TTL exactly as wrong as it was — a green run that fixed
    // nothing, which is the failure shape this repo keeps finding.
    if (item.ttlOnly) {
      ttlOwed.push({ id: item.id, why: item.why })
      continue
    }
    patches.push({
      id: item.id,
      collectionGroup: source.collectionGroup,
      fieldPath: source.fieldPath,
      exempt: (source.indexes ?? []).length === 0,
      why: item.why,
      body: fieldPatchBody(source),
    })
    if (source.ttl === true) {
      ttlOwed.push({
        id: item.id,
        why: 'the file declares "ttl": true; this script does not write TTL policies',
      })
    }
  }

  // The dangerous direction, reported and never acted on. A live TTL policy in
  // this bucket is the AGL-1801 event itself: `firebase deploy` would have
  // disabled it, and the whole point of the separate bucket is that this
  // script does not.
  const ttlAtRisk = report.overrides.prodOnly.filter((entry) => entry.ttl)

  return {
    creates,
    patches,
    notDeleted: {
      composite: report.composite.prodOnly,
      overrides: report.overrides.prodOnly,
    },
    ttlOwed,
    ttlAtRisk,
    empty: creates.length === 0 && patches.length === 0,
  }
}
