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
 * Pure comparison of the LIVE Firebase Auth authorized-domain allowlist
 * against `cloud/firebase-auth-domains.json` (AGL-1940).
 *
 * The rules and index checkers exist because rules and indexes deploy outside
 * the git pipeline. This list is a step further out: it has no deploy step at
 * all. It is edited in a console UI, and the only trace an edit leaves is the
 * live value itself. So a commit to the JSON is not evidence live changed, and
 * live changing is not evidence anyone approved it — the two have to be
 * compared, on a schedule, or the drift is invisible by construction. It was
 * invisible four times: AGL-1135, AGL-1344, AGL-1486, AGL-1940.
 *
 * Everything here is pure and takes its inputs as arguments so the self-test
 * can drive every branch without a network or a credential. The one impure
 * function, `fetchLiveAuthorizedDomains`, takes its `fetch` as an argument for
 * the same reason.
 */

/** Identity Toolkit origin. Overridable so the self-test can point the whole
 * fetch path at a stub rather than mocking around it. */
export function identityToolkitApiBase() {
  return (
    process.env.IDENTITY_TOOLKIT_API_BASE ||
    'https://identitytoolkit.googleapis.com'
  ).replace(/\/+$/, '')
}

/** Hostnames compare case-insensitively; a stray trailing dot is the same host. */
export function normalizeDomain(value) {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/\.$/, '')
}

/**
 * Read the inventory file's parsed JSON into the three sets the comparison
 * needs. THROWS on a malformed inventory rather than returning a partial one:
 * a checker that quietly compares against half a list reports green for the
 * half it dropped, which is the failure mode this whole file exists to stop.
 */
export function parseInventory(json) {
  if (!json || typeof json !== 'object') {
    throw new Error('inventory: not an object')
  }
  if (!Array.isArray(json.domains)) {
    throw new Error('inventory: `domains` must be an array')
  }
  if (json.removed !== undefined && !Array.isArray(json.removed)) {
    throw new Error('inventory: `removed` must be an array when present')
  }

  const expected = []
  const stale = []
  const seen = new Set()
  for (const entry of json.domains) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('inventory: every `domains` entry must be an object')
    }
    const domain = normalizeDomain(entry.domain)
    if (!domain) throw new Error('inventory: a `domains` entry has no `domain`')
    // The `why` is the point of the file. An entry without one cannot be
    // audited later, and "it was already there" is how all four drift issues
    // survived their own reviews.
    if (typeof entry.why !== 'string' || entry.why.trim().length < 20) {
      throw new Error(`inventory: ${domain} needs a substantive \`why\``)
    }
    if (seen.has(domain)) {
      throw new Error(`inventory: ${domain} listed twice in \`domains\``)
    }
    seen.add(domain)
    expected.push(domain)
    if (entry.stale === true) stale.push(domain)
  }

  const removed = []
  for (const entry of json.removed ?? []) {
    if (!entry || typeof entry !== 'object') {
      throw new Error('inventory: every `removed` entry must be an object')
    }
    const domain = normalizeDomain(entry.domain)
    if (!domain) throw new Error('inventory: a `removed` entry has no `domain`')
    if (seen.has(domain)) {
      throw new Error(
        `inventory: ${domain} is in both \`domains\` and \`removed\` — the ` +
          'file cannot say both that we trust it and that we deleted it',
      )
    }
    removed.push(domain)
  }

  return {
    projectId: json.projectId,
    expected,
    stale,
    removed,
  }
}

/**
 * Compare the two lists. Three findings, deliberately separated — they mean
 * opposite things and need opposite responses:
 *
 *   readded   live trusts a domain the file records as DELETED. The loudest
 *             one: somebody put back an entry a security fix removed.
 *   liveOnly  live trusts a domain no commit ever approved. The AGL-1940
 *             shape — if the hostname is outside a zone we control, it is an
 *             account-takeover vector.
 *   fileOnly  the file approves a domain live does not trust. Sign-in is
 *             BROKEN on that surface, or someone removed an entry by hand.
 */
export function compareAuthorizedDomains({ expected, live, removed = [] }) {
  const liveSet = new Set(live.map(normalizeDomain))
  const expectedSet = new Set(expected.map(normalizeDomain))
  const removedSet = new Set(removed.map(normalizeDomain))

  const readded = [...liveSet].filter((d) => removedSet.has(d)).sort()
  const liveOnly = [...liveSet]
    .filter((d) => !expectedSet.has(d) && !removedSet.has(d))
    .sort()
  const fileOnly = [...expectedSet].filter((d) => !liveSet.has(d)).sort()

  return {
    readded,
    liveOnly,
    fileOnly,
    ok: readded.length === 0 && liveOnly.length === 0 && fileOnly.length === 0,
  }
}

/** Human-readable report. `stale` entries are printed as a REVIEW note and
 * never affect the verdict — they are approved-but-questionable, not drift. */
export function formatReport(result, { stale = [], projectId = '' } = {}) {
  const lines = []
  const where = projectId ? ` for ${projectId}` : ''

  if (result.readded.length) {
    lines.push(
      `RE-ADDED — live trusts ${result.readded.length} domain(s) this repo records as REMOVED${where}:`,
      ...result.readded.map((d) => `  ${d}`),
      '  A security fix was undone. Find out who re-added it before deleting it again.',
      '',
    )
  }
  if (result.liveOnly.length) {
    lines.push(
      `LIVE-ONLY — Firebase trusts ${result.liveOnly.length} domain(s) no commit approved${where}:`,
      ...result.liveOnly.map((d) => `  ${d}`),
      '  Each one can complete our OAuth handshake. If the hostname sits outside',
      '  a DNS zone we control, treat it as an account-takeover vector.',
      '',
    )
  }
  if (result.fileOnly.length) {
    lines.push(
      `FILE-ONLY — cloud/firebase-auth-domains.json approves ${result.fileOnly.length} domain(s) Firebase does not trust${where}:`,
      ...result.fileOnly.map((d) => `  ${d}`),
      '  Sign-in cannot complete on those surfaces. Either the entry is stale',
      '  in the file, or somebody removed it from live by hand.',
      '',
    )
  }
  if (result.ok) {
    lines.push(`Live authorized domains match the repo${where}.`)
  }
  if (stale.length) {
    lines.push(
      '',
      `REVIEW (not a failure) — ${stale.length} approved domain(s) are flagged \`stale\` in the file:`,
      ...stale.map((d) => `  ${d}`),
      '  They serve nothing today. Read their `why` and decide whether to drop them.',
    )
  }
  return lines.join('\n')
}

/**
 * GET the live allowlist. `admin/v2/.../config` is the Identity Platform
 * config resource; `authorizedDomains` is the same array the console's
 * Authentication → Settings page edits.
 *
 * A missing `authorizedDomains` key is treated as CANNOT-CHECK, not as an
 * empty list: an empty list would read as "every approved domain is
 * FILE-ONLY", a spectacular red that says nothing true.
 */
export async function fetchLiveAuthorizedDomains({
  token,
  projectId,
  fetchImpl = globalThis.fetch,
  apiBase = identityToolkitApiBase(),
}) {
  const url = `${apiBase}/admin/v2/projects/${encodeURIComponent(projectId)}/config`
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { Authorization: `Bearer ${token}` },
  })
  const body = await response.text()
  if (!response.ok) {
    throw new Error(
      `Identity Toolkit GET ${response.status}: ${body.slice(0, 400)}`,
    )
  }
  let parsed
  try {
    parsed = JSON.parse(body)
  } catch {
    throw new Error('Identity Toolkit returned a body that is not JSON')
  }
  if (!Array.isArray(parsed.authorizedDomains)) {
    throw new Error(
      'Identity Toolkit response has no `authorizedDomains` array — refusing ' +
        'to treat that as an empty allowlist',
    )
  }
  return parsed.authorizedDomains.map(normalizeDomain)
}
