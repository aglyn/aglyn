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
 * DERIVE the media bucket's upload-CORS origin list from the thing that
 * provisions domains, and report where the bucket disagrees (AGL-1452).
 *
 * ## Why this exists on top of the attach-time reconcile
 *
 * `attachProjectDomain` already merges an origin in when it attaches a serving
 * name (`libs/tenant/data/admin/src/lib/server/upload-cors-reconcile.ts`, shipped
 * in `6d8a848ef`). That closes the FUTURE. It does nothing about two other
 * directions, and both were live when this file was written:
 *
 * 1. **Names attached before the reconcile existed.** Nothing ever walks the
 *    project. Measured 2026-08-24: of the console project's 20 attached names,
 *    15 serve and only 6 were permitted — the 5 that an AGL-1514 smoke run
 *    attached AFTER the reconcile shipped, plus `app.aglyn.com`. Nine serving
 *    names could not complete a large upload, up from the five AGL-1452
 *    recorded on 2026-08-20. Add-on-attach alone makes that number grow, not
 *    shrink.
 * 2. **Detach never reclaims.** The origin outlives the name. For an
 *    `*.aglyn.com` subdomain that is untidy; for a WHITE-LABEL customer domain
 *    it is a standing permission for a host the customer keeps and we no
 *    longer serve — and the signed URL carries its own authorization, so that
 *    host can spend one that leaks. AGL-1378 shipped custom console domains on
 *    2026-08-24, so this stopped being hypothetical the same day.
 *
 * ## The derivation, and why it is a derivation and not a list
 *
 * GCS matches the `origin` list as an EXACT string. There is no subtree form
 * and no wildcard short of `*`, which is not an option here — the signed URL
 * IS the authorization. So the list cannot be collapsed; it can only be
 * COMPUTED. The source it is computed from is the same Vercel project-domains
 * resource that `attachProjectDomain` writes to, so a name cannot be serving
 * the console without appearing here:
 *
 *     serving name (redirect === null)  ->  needs `https://<name>`
 *     redirect name (redirect set)      ->  needs NOTHING, and must not get it
 *
 * That contrast is measured, not assumed: `console.aglyn.com` 308s to
 * `app.aglyn.com`, carries no CORS entry, and is not broken.
 *
 * ## Exit semantics
 *
 * Three outcomes, never two. "Could not look" must never render as "clean" —
 * a checker that reports calm because its credential expired is the shape that
 * has already cost this repo real outages.
 *
 * Everything here is pure and takes its inputs as arguments; the two impure
 * functions take their `fetch` as an argument for the same reason.
 */

/** The console's Vercel project. Same constants the deploy verifier uses. */
export const CONSOLE_PROJECT = 'aglyn-console'
export const TEAM_SCOPE = 'team_JFfQodGE8VhCAZM6usYTu54M'

/** Mirrors `UPLOAD_CORS_*` in `libs/aglyn/src/lib/app-utils/upload-cors.ts`. */
export const UPLOAD_CORS_METHOD = 'PUT'
export const UPLOAD_CORS_RESPONSE_HEADERS = ['Content-Type', 'x-goog-resumable']
export const UPLOAD_CORS_MAX_AGE_SECONDS = 3600

const HOSTNAME = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * The origin a browser on `host` sends. Null for anything that is not a plain
 * hostname — including a Vercel wildcard name like `*.aglyn.io`, which can
 * never be an exact origin and must not be smuggled into the list as one.
 *
 * Deliberately identical to `uploadOriginFor` in the app library. `tools/*.mjs`
 * cannot import the TypeScript libs without a build step, which is why every
 * other checker here (`authorized-domains.mjs`, `index-drift.mjs`) restates its
 * comparison too; `upload-cors-drift.test.mjs` pins the cases that matter.
 */
export function uploadOriginFor(host) {
  const raw = String(host ?? '')
    .trim()
    .toLowerCase()
  if (!raw) return null
  const bare = raw
    .replace(/^[a-z][a-z0-9+.-]*:\/\//, '')
    .split(/[/?#]/)[0]
    .replace(/\.$/, '')
  return HOSTNAME.test(bare) ? `https://${bare}` : null
}

/** The rules that govern the signed `PUT`. Others on the bucket are not ours. */
function uploadRules(rules) {
  return (rules ?? []).filter((rule) =>
    (rule?.method ?? []).some(
      (method) => String(method).toUpperCase() === UPLOAD_CORS_METHOD,
    ),
  )
}

/**
 * Every origin the bucket currently permits a signed `PUT` from.
 *
 * A `*` is reported AS `*` rather than expanded or hidden. It permits
 * everything, and a caller that renders it as "nothing is missing" without
 * saying why would be describing an open bucket as a tidy one.
 */
export function permittedUploadOrigins(rules) {
  const seen = new Set()
  for (const rule of uploadRules(rules)) {
    for (const origin of rule?.origin ?? []) seen.add(String(origin))
  }
  return [...seen]
}

/**
 * Derive the origins the console must permit, from the project's domain list.
 *
 * A domain contributes an origin only when it SERVES: no `redirect`. An
 * unverified name serves nothing yet, but it is attached and will, and leaving
 * it out would make the checker report drift-free on a project that is one DNS
 * propagation away from a broken upload — so it counts, and is flagged.
 */
export function deriveRequiredOrigins(domains) {
  const required = []
  const seen = new Set()
  for (const domain of domains ?? []) {
    const name = String(domain?.name ?? '')
    const redirect = domain?.redirect
    if (redirect) continue
    const origin = uploadOriginFor(name)
    if (!origin || seen.has(origin)) continue
    seen.add(origin)
    required.push({ name, origin, verified: domain?.verified !== false })
  }
  return required.sort((a, b) => a.origin.localeCompare(b.origin))
}

/**
 * Compare the derived set against the live bucket.
 *
 * `rules === null` means the bucket could not be read. That is NOT an empty
 * configuration: an empty configuration is a definite answer ("everything is
 * missing") and an unreadable one is no answer at all. They are kept apart
 * because collapsing them is how a credential failure gets reported as a
 * finding, or worse, as clean.
 */
export function compareUploadCors({ domains, rules, platformOrigin = null }) {
  if (rules === null || rules === undefined) {
    return { readable: false, missing: [], stale: [], permitted: [], required: [], wildcard: false }
  }
  const required = deriveRequiredOrigins(domains)
  const permitted = permittedUploadOrigins(rules)
  const wildcard = permitted.includes('*')
  const requiredSet = new Set(required.map((entry) => entry.origin))
  const permittedSet = new Set(permitted)

  // A wildcard permits every derived origin, so nothing is "missing" — and
  // saying so is the truthful report. The wildcard itself is the finding.
  const missing = wildcard
    ? []
    : required.filter((entry) => !permittedSet.has(entry.origin))

  const stale = permitted
    .filter((origin) => origin !== '*' && !requiredSet.has(origin))
    .map((origin) => ({
      origin,
      // The platform origin is never derived away. It is configured, not
      // provisioned, and a prune that removed it would take down large uploads
      // for every customer at once — the exact platform-wide outage this
      // issue's read-modify-write warning is about.
      protected: platformOrigin ? origin === platformOrigin : false,
    }))
    .sort((a, b) => a.origin.localeCompare(b.origin))

  return { readable: true, missing, stale, permitted, required, wildcard }
}

/**
 * The configuration to WRITE so `origins` are permitted, preserving every
 * origin already there.
 *
 * Read-modify-WRITE, always. `gcloud storage buckets update --cors-file`
 * REPLACES the document, so automation that builds a fresh one silently drops
 * every other customer's origin — a per-customer provisioning action whose
 * failure mode is a platform-wide large-upload outage, landing on someone else,
 * days later. THROWS on a wildcard rather than returning an error a caller can
 * ignore.
 */
export function mergeUploadOrigins(rules, origins) {
  if (origins.some((origin) => String(origin).includes('*'))) {
    throw new Error(
      'refusing to write a wildcard CORS origin: the signed URL carries the ' +
        'authorization, so `*` lets any site spend one that leaks (AGL-1452)',
    )
  }
  const permitted = new Set(permittedUploadOrigins(rules))
  const missing = [...new Set(origins)].filter((origin) => !permitted.has(origin))
  if (missing.length === 0) return { rules, added: [] }

  const target = (rules ?? []).findIndex((rule) => uploadRules([rule]).length === 1)
  if (target < 0) {
    return {
      rules: [
        ...(rules ?? []),
        {
          origin: missing,
          method: [UPLOAD_CORS_METHOD],
          responseHeader: [...UPLOAD_CORS_RESPONSE_HEADERS],
          maxAgeSeconds: UPLOAD_CORS_MAX_AGE_SECONDS,
        },
      ],
      added: missing,
    }
  }
  return {
    rules: rules.map((rule, index) =>
      index === target
        ? { ...rule, origin: [...new Set([...(rule.origin ?? []), ...missing])] }
        : rule,
    ),
    added: missing,
  }
}

/**
 * Remove `origins` from the upload rules, refusing to remove `keep`.
 *
 * Pruning is REMOVING a permission, so it is deliberate and separate from the
 * merge: a run that healed and pruned in one motion would make a routine fix
 * carry an irreversible half nobody asked for. An emptied rule is dropped
 * rather than left with `origin: []`, which GCS accepts and which reads, to
 * the next person, like a rule that permits something.
 */
export function pruneUploadOrigins(rules, origins, { keep = [] } = {}) {
  const protectedSet = new Set(keep)
  const doomed = new Set(
    [...new Set(origins)].filter((origin) => origin !== '*' && !protectedSet.has(origin)),
  )
  if (doomed.size === 0) return { rules, removed: [], refused: [...new Set(origins)].filter((o) => protectedSet.has(o) || o === '*') }

  const removed = []
  const next = []
  for (const rule of rules ?? []) {
    if (uploadRules([rule]).length !== 1) {
      next.push(rule)
      continue
    }
    const kept = (rule.origin ?? []).filter((origin) => {
      if (!doomed.has(String(origin))) return true
      removed.push(String(origin))
      return false
    })
    if (kept.length > 0) next.push({ ...rule, origin: kept })
  }
  return {
    rules: next,
    removed,
    refused: [...new Set(origins)].filter((o) => protectedSet.has(o) || o === '*'),
  }
}

/** Every attached domain on the console's Vercel project. Paginated. */
export async function fetchProjectDomains({
  token,
  project = CONSOLE_PROJECT,
  teamId = TEAM_SCOPE,
  fetchImpl = fetch,
}) {
  const url =
    `https://api.vercel.com/v9/projects/${encodeURIComponent(project)}/domains` +
    `?teamId=${encodeURIComponent(teamId)}&limit=100`
  const response = await fetchImpl(url, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!response.ok) {
    throw new Error(
      `Vercel refused the project-domains read: ${response.status} ${response.statusText}`,
    )
  }
  const body = await response.json()
  return body?.domains ?? []
}

/** The live bucket's CORS document, with the metageneration a write needs. */
export async function fetchBucketCors({ token, bucket, fetchImpl = fetch }) {
  const response = await fetchImpl(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}?fields=cors,metageneration`,
    { headers: { Authorization: `Bearer ${token}` } },
  )
  if (!response.ok) {
    throw new Error(
      `Cloud Storage refused the bucket read: ${response.status} ${response.statusText}`,
    )
  }
  const body = await response.json()
  return { rules: body?.cors ?? [], metageneration: String(body?.metageneration ?? '') }
}

/**
 * Write the CORS document back, CONDITIONAL on the metageneration that was read.
 *
 * Two provisioning actions racing would otherwise clobber each other, and the
 * loser's customer is the one whose uploads break. Note that Cloud Storage
 * rate-limits bucket metadata to ONE UPDATE PER SECOND, so a burst of attaches
 * contends here as well — a 412 or a 429 is the expected shape under load, not
 * an anomaly, and the caller must report it rather than treat it as written.
 */
export async function writeBucketCors({
  token,
  bucket,
  rules,
  metageneration,
  fetchImpl = fetch,
}) {
  const query = metageneration
    ? `?ifMetagenerationMatch=${encodeURIComponent(metageneration)}`
    : ''
  const response = await fetchImpl(
    `https://storage.googleapis.com/storage/v1/b/${encodeURIComponent(bucket)}${query}`,
    {
      method: 'PATCH',
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ cors: rules }),
    },
  )
  if (!response.ok) {
    const detail = await response.text().catch(() => '')
    throw new Error(
      `Cloud Storage refused the bucket write: ${response.status} ${response.statusText}` +
        (response.status === 412
          ? ' — the configuration changed under this run (another attach); re-read and retry.'
          : response.status === 429
            ? ' — bucket metadata updates are limited to one per second; retry.'
            : '') +
        (detail ? `\n${detail.slice(0, 400)}` : ''),
    )
  }
  return true
}

/** The human-readable report. Pure, so the self-test can pin the wording. */
export function formatReport(result, { bucket }) {
  if (!result.readable) {
    return `Could not read the CORS configuration of gs://${bucket}. No verdict.`
  }
  const lines = []
  if (result.wildcard) {
    lines.push(
      'WIDE OPEN: the upload rule carries `*`. Every site on the internet can',
      'spend a signed URL that leaks. Nothing is reported missing because a',
      'wildcard does permit every derived origin — the wildcard IS the finding.',
      '',
    )
  }
  lines.push(
    `Derived from ${CONSOLE_PROJECT}: ${result.required.length} serving name(s) need an origin.`,
    `gs://${bucket} permits ${result.permitted.length}.`,
    '',
  )
  if (result.missing.length > 0) {
    lines.push(`MISSING — large uploads fail from ${result.missing.length} origin(s):`)
    for (const entry of result.missing) {
      lines.push(`  ${entry.origin}${entry.verified ? '' : '   (attached, not yet verified)'}`)
    }
    lines.push('')
  }
  if (result.stale.length > 0) {
    lines.push(
      `STALE — permitted but no longer served by this project (${result.stale.length}):`,
    )
    for (const entry of result.stale) {
      lines.push(`  ${entry.origin}${entry.protected ? '   (platform origin — never pruned)' : ''}`)
    }
    lines.push('')
  }
  if (result.missing.length === 0 && result.stale.length === 0 && !result.wildcard) {
    lines.push('Clean: every serving name is permitted and nothing else is.')
  }
  return lines.join('\n')
}
