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

// The decision half of the SSO domain attestation backfill (AGL-1887).
//
// Separated from the runner, on the same reasoning as
// `media-content-sha256-backfill.mjs`: the rules that decide whether a
// domain gets published to an org are unit-tested rather than reasoned
// about. See `sso-domain-attestation.test.mjs`. The runner does Firestore;
// everything here is pure.
//
// What is at stake is worth restating, because it does not look like a
// backfill. Writing `attestedBy` onto `orgs/{orgId}/ssoDomains/{domain}`
// makes `publishSsoDomains` willing to publish `ssoDomains/{domain}`, and a
// live document there routes EVERY sign-in on that domain to that org's
// IdP. Attesting a domain to the wrong org hands that org another company's
// sign-ins. This file's job is to refuse every input where that could
// happen by accident.

/**
 * MUST match `normalizeSsoDomain` in
 * `libs/tenant/data/admin/src/lib/server/sso-provisioning.ts`.
 *
 * A `.mjs` script cannot import the TypeScript function, so the logic is
 * duplicated — and the test reads the TS file and asserts the two still
 * agree, because a mirror nobody checks is a mirror that drifts. Drift here
 * writes the marker at a path the publish gate never reads, which presents
 * as "I attested it and Turn on still says no".
 */
export function normalizeSsoDomain(input) {
  const raw = String(input ?? '')
    .trim()
    .toLowerCase()
  const at = raw.lastIndexOf('@')
  return (at >= 0 ? raw.slice(at + 1) : raw)
    .replace(/^@+/, '')
    .replace(/\.$/, '')
}

export const DOMAIN_PATTERN = /^(?!-)[a-z0-9-]{1,63}(\.[a-z0-9-]{1,63})+$/

/**
 * Mirrors `isStaffAttestedClaim` in `sso-provisioning.ts`.
 *
 * A field satisfiable by any truthy value is one a careless future write
 * satisfies by accident. `true` is not a person, and an attestation that
 * cannot name who made it is not attributable to anybody.
 */
export function isStaffAttestedClaim(attestedBy) {
  return typeof attestedBy === 'string' && attestedBy.trim().length > 0
}

/**
 * Parse and GATE the command line.
 *
 * The locks, and why each one is here:
 *
 *  1. **One org, one domain per run.** There is deliberately no "every
 *     stranded org" mode. Each attestation is a separate human assertion
 *     about a separate company's domain; a batch flag would let one command
 *     vouch for things nobody looked at.
 *  2. **Dry run is the default.** Nothing opts INTO safety; `--apply` opts
 *     out of it.
 *  3. **`--apply` requires `--confirm=<projectId>`.** One flag must not be
 *     able to write. Typing the project id out is also what stops a command
 *     rehearsed against a staging project being pasted at production.
 *  4. **`--by` and `--note` are required.** They are not paperwork: they are
 *     the entire record of why a domain was published without DNS proof.
 *     `--by` lands in `adminAudit` as the actor.
 */
export function parseAttestArgs(argv = [], options = {}) {
  const projectId = options.projectId ?? 'aglyn-main'
  const list = Array.isArray(argv) ? argv.map(String) : []
  const flag = (name) => list.includes(`--${name}`)
  const value = (name) => {
    const found = list.find((entry) => entry.startsWith(`--${name}=`))
    return found ? found.slice(name.length + 3) : null
  }

  const refuse = (error) => ({ ok: false, error })

  const orgId = (value('org') ?? '').trim()
  if (!orgId) {
    return refuse(
      'Pass --org=<orgId>. One org per run — there is deliberately no ' +
        'mode that attests for every stranded org at once.',
    )
  }

  const rawDomain = value('domain')
  if (rawDomain === null || !rawDomain.trim()) {
    return refuse('Pass --domain=<domain>.')
  }
  const domain = normalizeSsoDomain(rawDomain)
  if (!domain || !DOMAIN_PATTERN.test(domain)) {
    return refuse(
      `--domain=${rawDomain} is not a domain this platform can key a claim ` +
        'by. Pass the bare registrable name, e.g. --domain=example.com.',
    )
  }

  const by = (value('by') ?? '').trim()
  if (!isStaffAttestedClaim(by)) {
    return refuse(
      'Pass --by=<staff-uid>. An attestation that does not say who made it ' +
        'is not attributable to anybody, and the publish gate rejects it.',
    )
  }

  const note = (value('note') ?? '').trim()
  if (!note) {
    return refuse(
      'Pass --note="how ownership was confirmed". This is the only record ' +
        'of why a domain was published without DNS proof.',
    )
  }

  const apply = flag('apply')
  const confirm = value('confirm')
  if (apply && !confirm) {
    return refuse(
      `--apply also needs --confirm=${projectId}. One flag must not be able ` +
        "to publish sign-in routing for somebody's domain.",
    )
  }
  if (apply && confirm !== projectId) {
    return refuse(
      `--confirm=${confirm} does not match the project this run is pointed ` +
        `at (${projectId}). Refusing rather than guessing which one you meant.`,
    )
  }

  return {
    ok: true,
    error: null,
    orgId,
    domain,
    by,
    note,
    apply,
    confirm: confirm ?? null,
    projectId,
    json: flag('json'),
  }
}

/**
 * Decide what one attestation should do, given what Firestore already holds.
 *
 * `refuse` reasons are values rather than log lines so the runner can exit
 * on them and the test can name them. The distinction that matters most is
 * refuse-vs-warn: a domain another org already routes is a CONFLICT for a
 * human to resolve, while a domain missing from `sso.domains` merely means
 * the marker will sit there doing nothing — wrong, but not dangerous.
 *
 * @param state.orgExists      does `orgs/{orgId}` exist
 * @param state.orgName        display name, for the confirmation line
 * @param state.governedDomains `orgs/{orgId}.sso.domains`, or []
 * @param state.routingOrgId   `ssoDomains/{domain}.orgId`, or null
 * @param state.claim          the existing claim document, or null
 */
export function planAttestation(state = {}, parsed = {}) {
  const { orgId, domain, by } = parsed
  const refuse = (reason, message) => ({ action: 'refuse', reason, message })

  if (!state.orgExists) {
    return refuse('no-such-org', `No such organization: ${orgId}`)
  }

  // The same uniqueness rule `issueDomainClaim` and `attestSsoDomain`
  // enforce. An attestation must not become a way around "one domain, one
  // org" — whoever attests last must not win a conflict by default.
  if (state.routingOrgId && state.routingOrgId !== orgId) {
    return refuse(
      'routed-elsewhere',
      `${domain} is already routed to org "${state.routingOrgId}". Resolve ` +
        'that before attesting — an attestation is not a way to take a ' +
        'domain off another organization.',
    )
  }

  const claim = state.claim ?? null
  const existingAttestedBy = claim ? claim.attestedBy : undefined
  const governed = Array.isArray(state.governedDomains)
    ? state.governedDomains
    : []

  const warnings = []
  // `activate` hands `publishSsoDomains` the org's `sso.domains` array, so a
  // domain that array does not name is never offered to the gate at all and
  // the marker does nothing. Every pre-self-serve org is already in the
  // array — that is how they came to be live — so this is the difference
  // between "attested and it worked" and "attested and Turn on still says
  // no", not a safety question. Hence warn, not refuse.
  if (!governed.includes(domain)) {
    warnings.push(
      `${domain} is NOT in this org's sso.domains ${JSON.stringify(governed)}. ` +
        '`activate` publishes only what that array names, so this attestation ' +
        'alone will not make Turn on work.',
    )
  }
  // Not a reason to stop — the honest path is simply better, and re-running
  // is harmless — but worth saying out loud, because attesting a domain that
  // already has DNS proof adds an ownership assertion nobody needed.
  if (claim && claim.verified === true) {
    warnings.push(
      `${domain} is already DNS-verified for this org, so publish already ` +
        'accepts it. An attestation adds nothing here.',
    )
  }

  // Idempotent, and re-running is the recovery path when a run half-failed,
  // so an existing identical marker is reported rather than refused.
  const alreadyAttested =
    isStaffAttestedClaim(existingAttestedBy) && existingAttestedBy.trim() === by

  return {
    action: 'attest',
    reason: alreadyAttested ? 'reattest-same-staff' : 'new-attestation',
    orgId,
    domain,
    orgName: state.orgName ?? null,
    alreadyAttested,
    previousAttestedBy: isStaffAttestedClaim(existingAttestedBy)
      ? existingAttestedBy.trim()
      : null,
    claimExisted: Boolean(claim),
    warnings,
    // ADDITIVE ONLY, and merged. An org midway through proving the domain by
    // DNS keeps its token and its `verified` state; this write never resets
    // a fact it did not create. `verified` is deliberately absent from the
    // payload — DNS proof and a person vouching are different facts and the
    // data keeps them apart.
    write: { domain, attestedBy: by, attestationNote: parsed.note },
  }
}
