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
 * Every server-owned field of `orgs/{orgId}` is denied to client writes
 * (AGL-1355).
 *
 * AGL-1354 found `brandingProfile` missing from the rules' org-update key
 * diff: an org admin with nothing but the Firebase client SDK could set a
 * white-label brand on a free plan, because the `whiteLabel` gate lives in
 * /api/orgs/settings and the console is not a boundary. Auditing the rest of
 * the list by hand turned up three more of the same shape — `sso`, `discount`,
 * `enterprise`. All four are closed.
 *
 * The four keys were the symptom. The disease is that the deny-list is
 * maintained by hand with nothing connecting it to the document it guards, so
 * the NEXT server-owned field is client-writable the day it ships, silently,
 * until somebody audits again. Four drifted before anybody looked. This is the
 * check that makes the fifth impossible.
 *
 * ## How "server-owned" is defined, and why it cannot drift
 *
 * Not by a second hand-written list — a guard whose own list drifts is worth
 * nothing. Three sources, two of them fully derived:
 *
 * 1. **Entitlement inputs — DERIVED, no list at all.** Every top-level field
 *    the entitlement/billing resolvers in `libs/aglyn/src/lib/app-utils` read
 *    off an org document (`org?.plan`, `org?.brandingProfile`, the
 *    `org as { billingStatus }` cast) must be denied. This needs nobody to
 *    remember anything: a field becomes server-owned the moment a resolver
 *    reads it, and the guard notices in the same commit. It is also the check
 *    that would have caught AGL-1354 with nobody reasoning about it —
 *    `resolveBrandingProfile` already read `org?.brandingProfile` before the
 *    fix, so the pre-fix rules fail this test on `brandingProfile` by name.
 *
 * 2. **The document's field set — DERIVED from `AglynOrgBilling`.** The
 *    interface is the declaration point, and all four AGL-1354 keys were
 *    declared on it. Reading it here is what makes "add a field" the trigger.
 *
 * 3. **The partition — DEFAULT-DENY, and this is the only manual step.** A
 *    declared field must be in the rules' deny-list, or in
 *    `ORG_CLIENT_WRITABLE_FIELDS` / `ORG_UNPERSISTED_FIELDS` beside the type
 *    WITH A REASON. Unclassified is not "allowed", it is a FAILURE naming the
 *    field. The manual step is therefore an explicit "I decided this is safe",
 *    recorded next to the declaration, and forgetting it breaks the build
 *    instead of shipping a hole.
 *
 * ## What this does not cover, stated plainly
 *
 * A field written onto the org document by server code and declared NOWHERE —
 * not on the interface, not in the rules, not read by a resolver — is outside
 * every source above and this guard will not see it. That is why the seed
 * writer (`createOrganization`) is swept in as a fourth source: it is the one
 * place the document's skeleton is defined, so at minimum the fields an org is
 * BORN with are always classified. Beyond that the mitigation is the interface
 * being honest, which `no unclassified field` and the seed sweep both enforce
 * pressure on.
 *
 * The companion behavioural assertion is in
 * `cloud/rules-tests/firestore-rules.test.mjs`, which drives a real emulator
 * write for each parsed key. This file proves the LIST is complete; that one
 * proves the list is ENFORCED. Neither is worth much without the other: a
 * complete list in a rule that never fires is the AGL-1354 shape one level up.
 */

import { readFileSync, readdirSync } from 'fs'
import { resolve } from 'path'

import {
  ORG_CLIENT_WRITABLE_FIELDS,
  ORG_UNPERSISTED_FIELDS,
} from './org-billing.types'
// The parsing moved to a shared module when AGL-1361 extended this property to
// `hosts/{hostId}` and `marketplaceListings/{listingId}`. Three documents, one
// parser: a second copy would be a second thing to keep true.
import {
  declaredFields as declaredFieldsOf,
  hasAnyKeys,
  normalizePathVariables,
  readFieldsOf,
  seedFields as seedFieldsOf,
  stripComments,
  topLevelBody,
} from './write-deny-coverage.util'

const REPO_ROOT = resolve(__dirname, '../../../../../..')

const read = (relativePath: string): string =>
  readFileSync(resolve(REPO_ROOT, relativePath), 'utf8')

const RULES_FILE = 'cloud/firebase-firestore.rules'
const TYPES_FILE =
  'libs/aglyn/src/lib/foundation/definitions/org-billing.types.ts'
const RESOLVER_DIR = 'libs/aglyn/src/lib/app-utils'
const SEED_FILE = 'libs/tenant/data/admin/src/lib/server/organizations.ts'

interface OrgUpdateRule {
  /** Denied to an org owner/admin holding the client SDK. */
  orgAdminDenied: string[]
  /** Denied to billing staff. */
  billingStaffDenied: string[]
  /**
   * Denied to SUPER staff — the loosest branch, and until AGL-1795 the one
   * branch this guard never read. It asserted `branches` had length 3 and then
   * parsed two of them, so `plan` could have fallen off the super list with
   * every test here still green. That is the same shape as the hole the file
   * exists to close, one level up: super staff satisfies `isBillingStaff()`
   * too, the branches are OR'd, and the LOOSER one wins — so for a super token
   * this is the only list that decides anything.
   */
  superStaffDenied: string[]
  /** Every OR'd branch of the single `allow update` statement. */
  branches: string[]
  /** Depth-0 statements of `match /orgs/{orgId}`. */
  statements: string[]
  /** Depth-0 `match` headers under `/databases/{database}/documents`. */
  topLevelMatches: string[]
}

function parseOrgUpdateRule(): OrgUpdateRule {
  const rules = normalizePathVariables(stripComments(read(RULES_FILE)))
  const root = topLevelBody(rules, 'match /databases/<database>/documents {')
  const topLevelMatches = [...root.matchAll(/match\s+(\/\S*)/g)].map(
    (entry) => entry[1],
  )

  const org = topLevelBody(rules, 'match /orgs/<orgId> {')
  const statements = org
    .split(';')
    .map((statement) => statement.trim())
    .filter(Boolean)

  // ONE `allow` statement may mention `update`. Firestore ORs every allow
  // across sibling statements AND sibling match blocks, and the LOOSER one
  // wins — so a second statement would mean this guard is reasoning about a
  // deny-list that some other statement quietly overrides.
  const updates = statements.filter((statement) =>
    /\ballow\b[^:]*\bupdate\b/.test(statement),
  )
  if (updates.length !== 1) {
    throw new Error(
      `Expected exactly one \`allow … update\` statement under ` +
        `match /orgs/{orgId}, found ${updates.length}. Firestore ORs them and ` +
        `the LOOSER wins, so the deny-list this guard reads would no longer ` +
        `be the whole answer. Fold the branches back into one statement, or ` +
        `teach this guard how they combine.`,
    )
  }

  const branches = updates[0].split('||').map((branch) => branch.trim())
  const branchFor = (predicate: string): string => {
    const found = branches.filter((branch) => branch.includes(predicate))
    if (found.length !== 1) {
      throw new Error(
        `Expected exactly one \`allow update\` branch guarded by ` +
          `${predicate}, found ${found.length}. The org update rule has been ` +
          `restructured; re-read it before trusting this guard.`,
      )
    }
    return found[0]
  }

  return {
    orgAdminDenied: hasAnyKeys(branchFor('canManageOrg()')),
    billingStaffDenied: hasAnyKeys(branchFor('isBillingStaff()')),
    superStaffDenied: hasAnyKeys(branchFor('isSuperStaff()')),
    branches,
    statements,
    topLevelMatches,
  }
}

/** Top-level property names declared on an interface. */
function declaredFields(source: string, interfaceName: string): string[] {
  return declaredFieldsOf(
    source,
    `export interface ${interfaceName} extends AglynDocument {`,
  )
}

/**
 * Top-level org-document fields the entitlement/billing resolvers read.
 *
 * Directory-wide on purpose. A per-file list would be one more thing to keep
 * up to date, and this directory is where every resolver lives — so a NEW
 * resolver reading a NEW field is covered the moment it is written, which is
 * the only way this stays true without anyone tending it.
 */
function entitlementInputs(): string[] {
  const directory = resolve(REPO_ROOT, RESOLVER_DIR)
  return readFieldsOf(
    readdirSync(directory)
      .filter((file) => file.endsWith('.ts') && !file.endsWith('.spec.ts'))
      .map((file) => readFileSync(resolve(directory, file), 'utf8')),
    'org',
  )
}

/** Top-level fields the org document is created with. */
function seedFields(): string[] {
  const fields = seedFieldsOf(
    read(SEED_FILE),
    /collection\('orgs'\)\.doc\(orgId\)\s*,\s*\{/,
  )
  if (!fields) {
    throw new Error(
      `Guard cannot parse the org seed write in ${SEED_FILE}. It is one of ` +
        `the four sources of the org document's field set — fix the parse ` +
        `rather than dropping the source.`,
    )
  }
  return fields
}

describe('every server-owned org field is denied to client writes (AGL-1355)', () => {
  const rule = parseOrgUpdateRule()
  const declared = declaredFields(read(TYPES_FILE), 'AglynOrgBilling')
  const inputs = entitlementInputs()
  const seeded = seedFields()

  const denied = new Set(rule.orgAdminDenied)
  const clientWritable = new Set(Object.keys(ORG_CLIENT_WRITABLE_FIELDS))
  const unpersisted = new Set(Object.keys(ORG_UNPERSISTED_FIELDS))

  /**
   * Every field this guard knows the org document can carry. A guard that
   * sweeps nothing passes vacuously, which is the failure mode of every
   * source check — the anchors below exist so a rotted parser fails here
   * rather than reporting an empty, perfect world.
   */
  const universe = new Set([
    ...declared,
    ...rule.orgAdminDenied,
    ...inputs,
    ...seeded,
  ])

  describe('the parsers still see what they are supposed to see', () => {
    it('reads the org-admin and billing-staff deny-lists out of the rules', () => {
      // The AGL-1354 four, plus the identity keys that predate them.
      expect(rule.orgAdminDenied).toEqual(
        expect.arrayContaining([
          'brandingProfile',
          'sso',
          'discount',
          'enterprise',
          'plan',
          'entitlements',
          'slug',
          'ownerUid',
        ]),
      )
      expect(rule.orgAdminDenied.length).toBeGreaterThanOrEqual(15)
      expect(rule.billingStaffDenied).toEqual(
        expect.arrayContaining(['sso', 'suspendedAt', 'erasureRequestedAt']),
      )
      // AGL-1795: /api/admin/org-override is the only writer of these three,
      // so they are denied to every client — including the super token, whose
      // branch is the loosest and therefore the one that decides.
      //
      // AGL-1813 extends the same argument, re-established per key, to the
      // four commercial/branding keys an org admin was already denied:
      // `discount` (/api/admin/org-discount + the webhook mirror),
      // `brandingProfile` (/api/orgs/settings `update-branding`),
      // `billingStatus` (the `writeOrgBilling` dunning mirror) and
      // `enterprise` (no in-product writer at all — only the
      // migrate-enterprise-plan Admin-SDK script). Both staff branches, or
      // the OR leaves the other role writing them.
      //
      // AGL-1824, the same shape a third time: the AGL-1028 vestigial billing
      // trio (`seatAddons`/`stripeCustomerId`/`subscription`, written only by
      // `writeOrgBilling` and the backfill scripts, and still LIVE inputs via
      // the `readOrgBilling` / `findOrgIdByStripeCustomer` fallbacks) joins
      // both staff branches, and the identity quartet `sso`/`slug`/
      // `ownerUid`/`hosts` (each owned by exactly one Admin-SDK surface)
      // joins the super branch, which was the last branch allowing them.
      expect(rule.superStaffDenied).toEqual(
        expect.arrayContaining([
          'plan',
          'entitlements',
          'releaseFlags',
          'suspendedAt',
          'billingStatus',
          'brandingProfile',
          'discount',
          'enterprise',
          'seatAddons',
          'stripeCustomerId',
          'subscription',
          'sso',
          'slug',
          'ownerUid',
          'hosts',
        ]),
      )
      expect(rule.billingStaffDenied).toEqual(
        expect.arrayContaining([
          'billingStatus',
          'brandingProfile',
          'discount',
          'enterprise',
          'seatAddons',
          'stripeCustomerId',
          'subscription',
        ]),
      )
      // The AGL-1517 carve-out, asserted rather than left to be inferred from
      // an absence: the erasure toggle is still a client `writeBatch`, so this
      // key must NOT join the super list. Denying it would refuse the last
      // client writer of a staff key with nothing to fall back on.
      expect(rule.superStaffDenied).not.toContain('erasureRequestedAt')
      // The AGL-501 carve-out, pinned the same way: super staff enabling a
      // gated plugin is the deliberate exception (and the emulator suite's
      // positive control that the super branch is alive at all).
      expect(rule.superStaffDenied).not.toContain('enabledPlugins')
      // AGL-1824 made the convergence exact, so it is asserted exactly: the
      // super list IS the billing list minus those two carve-outs. A third
      // difference appearing in either direction means someone narrowed one
      // branch and left the other behind — the AGL-1813/1824 bug reborn.
      expect(
        rule.billingStaffDenied
          .filter((field) => !rule.superStaffDenied.includes(field))
          .sort(),
      ).toEqual(['enabledPlugins', 'erasureRequestedAt'])
      // isSuperStaff / isBillingStaff / canManageOrg.
      expect(rule.branches).toHaveLength(3)
    })

    it('reads the document field set off AglynOrgBilling', () => {
      expect(declared).toEqual(
        expect.arrayContaining([
          '$id',
          'plan',
          'entitlements',
          'brandingProfile',
          'sso',
          'discount',
          'enterprise',
        ]),
      )
      expect(declared.length).toBeGreaterThanOrEqual(18)
    })

    it('finds the entitlement inputs the resolvers actually read', () => {
      expect(inputs).toEqual(
        expect.arrayContaining([
          'plan',
          'entitlements',
          'seatAddons',
          'subscription',
          'billingStatus',
          'brandingProfile',
        ]),
      )
      expect(inputs.length).toBeGreaterThanOrEqual(8)
    })

    it('finds the fields an org is created with', () => {
      expect(seeded).toEqual(
        expect.arrayContaining(['name', 'slug', 'ownerUid', 'hosts']),
      )
    })
  })

  it('denies every field the entitlement resolvers read', () => {
    // The fully derived half: no list, no memory, no review checklist. A
    // resolver reading a field is what MAKES it server-owned, and this fires
    // on the commit that adds the read.
    const exposed = inputs.filter((field) => !denied.has(field))
    if (exposed.length > 0) {
      throw new Error(
        `These org fields are read by the entitlement/billing resolvers in ` +
          `${RESOLVER_DIR} but an org admin can still write them from the ` +
          `Firebase client SDK:\n\n` +
          `${exposed.map((field) => `  • ${field}`).join('\n')}\n\n` +
          `A field a resolver reads is an INPUT TO A DECISION — a plan, a ` +
          `price, an entitlement, a brand, a routing target. Client-writable, ` +
          `it is the decision itself, made by whoever is being decided about ` +
          `(AGL-1354: \`brandingProfile\` was exactly this, and it bought a ` +
          `free-plan org the Enterprise white-label gate). The console writes ` +
          `these through Admin-SDK routes, so denying them costs nothing: add ` +
          `each to the \`canManageOrg()\` hasAny([…]) list in ${RULES_FILE}.`,
      )
    }
  })

  it('classifies every field of the org document, defaulting to denied', () => {
    // The half that cannot be derived: whether a NON-entitlement field is a
    // preference or a boundary is a judgement. So the guard does not guess —
    // it refuses to pass until someone records the judgement, and the answer
    // that costs nothing is always "deny".
    const unclassified = [...universe].filter(
      (field) =>
        !denied.has(field) &&
        !clientWritable.has(field) &&
        !unpersisted.has(field),
    )
    if (unclassified.length > 0) {
      throw new Error(
        `These fields of \`orgs/{orgId}\` are not classified:\n\n` +
          `${unclassified.map((field) => `  • ${field}`).join('\n')}\n\n` +
          `Unclassified means CLIENT-WRITABLE in production right now — the ` +
          `rules deny only what is named, so a field nobody listed is a field ` +
          `any org admin can set with the client SDK on any plan. That is ` +
          `AGL-1354, which shipped four such fields.\n\n` +
          `Decide, on this commit:\n` +
          `  • server-owned (an entitlement, price, routing or staff input) — ` +
          `add it to the \`canManageOrg()\` hasAny([…]) list in ` +
          `${RULES_FILE}, and to the \`isBillingStaff()\` list too if ` +
          `repointing it is not a billing action;\n` +
          `  • genuinely a user preference — add it to ` +
          `ORG_CLIENT_WRITABLE_FIELDS in ${TYPES_FILE} with a reason.\n\n` +
          `When in doubt, deny: every key AGL-1354 closed was already written ` +
          `exclusively by an Admin-SDK route, so denying it changed nothing ` +
          `about the product.`,
      )
    }
  })

  it('never lets a field be both denied and declared client-writable', () => {
    // The two partitions disagreeing means one of them is a lie, and the
    // reader has no way to tell which.
    const both = [...clientWritable, ...unpersisted].filter((field) =>
      denied.has(field),
    )
    expect(both).toEqual([])
  })

  it('keeps the declared client-writable list honest', () => {
    for (const [field, reason] of Object.entries({
      ...ORG_CLIENT_WRITABLE_FIELDS,
      ...ORG_UNPERSISTED_FIELDS,
    })) {
      // A field nobody has heard of is a leftover from a field that was
      // renamed or removed, and a stale allow-list entry is how the next one
      // hides.
      expect(universe.has(field)).toBe(true)
      // The reason is the entire value of the manual step: it records that
      // somebody decided rather than that somebody forgot.
      expect(reason.length).toBeGreaterThan(40)
    }
  })

  it('denies an org admin everything billing staff is denied', () => {
    // Billing staff is the strictly more trusted principal, so anything IT
    // cannot touch an org admin certainly cannot. Asserting the subset means
    // hardening one branch can never leave the other behind — which is how
    // `sso` came to be on both lists in AGL-1354.
    const looser = rule.billingStaffDenied.filter(
      (field) => !rule.orgAdminDenied.includes(field),
    )
    expect(looser).toEqual([])
  })

  it('denies billing staff everything super staff is denied (AGL-1795)', () => {
    // The other rung of the same ladder — super ⊆ billing ⊆ org admin — and
    // the one that actually bites. `isBillingStaff()` is true for the SUPER
    // role as well, so both staff branches evaluate for a super token and
    // Firestore ORs them: adding a key to the billing list alone leaves super
    // staff writing it, and adding it to the super list alone leaves the
    // billing role writing it. A key has to reach BOTH, and only the ladder
    // says so — the AGL-1795 mutation run confirmed each half independently.
    //
    // A vacuous ladder proves nothing, so the floor is checked first.
    // 20 = the AGL-1795 three + the AGL-1813 four + the six suspended* keys
    // + the AGL-1824 seven (the vestigial billing trio and the identity
    // quartet).
    expect(rule.superStaffDenied.length).toBeGreaterThanOrEqual(20)
    const looser = rule.superStaffDenied.filter(
      (field) => !rule.billingStaffDenied.includes(field),
    )
    expect(looser).toEqual([])
  })

  it('has no second rule that could OR a looser write onto the org doc', () => {
    // Sibling `match` blocks are OR'd and the LOOSER one wins, so a deny-list
    // in one block proves nothing if a wildcard block elsewhere allows the
    // same write. `parseOrgUpdateRule` already refuses more than one `allow …
    // update` inside the org block; this covers the outside of it.
    const wildcards = rule.topLevelMatches.filter((path) => path.includes('**'))
    expect(wildcards).toEqual([])
    expect(
      rule.topLevelMatches.filter((path) => path.startsWith('/orgs')),
    ).toEqual(['/orgs/<orgId>'])
    // And no depth-0 `allow write` in the org block, which would swallow
    // updates whole regardless of the key diff.
    expect(
      rule.statements.filter((statement) =>
        /\ballow\s+write\b/.test(statement),
      ),
    ).toEqual([])
  })
})
