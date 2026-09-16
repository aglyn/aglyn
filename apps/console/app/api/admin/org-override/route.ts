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
 * THE STAFF ORG OVERRIDE (AGL-1786), server-side.
 *
 *   POST { orgId, plan, quotas, features, releaseFlags, reason, note? }
 *
 * The one act that changes what a customer is ENTITLED to and BILLED against
 * — plan, every numeric entitlement including the three fee percentages, the
 * plan feature booleans, and the per-org release-flag overrides AGL-1635
 * added. It writes the org document and its `adminAudit` row with the Admin
 * SDK in a single `batch()`.
 *
 * ## Why a route rather than the client batch it replaces
 *
 * AGL-1784 put both writes into one client `writeBatch`, which closed the
 * split write: the two documents commit together or neither lands. What a
 * batch could not do is make the REASON a boundary. `adminAudit` validates
 * no shape at all (`allow create: if isStaff()`), and AGL-1652 deliberately
 * did not police one action's field in the rules — doing so would imply the
 * other client-written rows are validated when they are not. So the reason
 * was a dialog gate: a staff user driving Firestore from a browser console
 * could still change a fee percentage and write a reasonless row, or no row
 * at all. A batch that is never issued is still atomic.
 *
 * Here `normalizeOrgOverrideReason` — the SAME predicate the disabled Save
 * button reads — runs before anything is written, so the gate and the button
 * cannot disagree and the gate is the one that decides.
 *
 * THE HONEST LIMIT, until AGL-1795: this closes the CONSOLE path, which is
 * how every override is actually made, and it is now the only writer of
 * `plan`/`entitlements`/`releaseFlags` in the product. It is not yet a wall.
 * `cloud/firebase-firestore.rules` still permits a staff client to write
 * those keys directly, so a browser console can bypass this handler — the
 * denied-key narrowing that closes it has to DEPLOY AFTER this route
 * reaches production, or a stale console tab is refused with nothing to fall
 * back on, and rules deploy on a different cadence from code.
 *
 * ## `deleteField()` DOES NOT CROSS JSON — the wire carries INTENT
 *
 * "Inherit" has to DELETE the key (AGL-1109): the org write is
 * `set(…, { merge: true })`, and a merge writes nested maps key by key, so a
 * `features` map that merely omitted an inherited flag left the stored value
 * in place — you could force a flag off but never remove the override.
 * `deleteField()` is the sentinel a merge acts on, and it is a client-SDK
 * object with no JSON form: serialised it arrives as `{}`, which a merge
 * ignores. Posting the built payload would therefore have turned every
 * "inherit" back into the AGL-1109 no-op, silently.
 *
 * So the body carries only what is EXPLICITLY overridden — `quotas`,
 * `features` and `releaseFlags` are maps of the keys the operator filled in
 * or forced, and nothing else. ABSENCE IS THE INHERIT SIGNAL, and this route
 * expands it against the registries (the numeric keys of
 * `PLAN_ENTITLEMENTS.free`, its `features`, and `RELEASE_FLAGS`) into the
 * Admin SDK's `FieldValue.delete()`. The sentinel is minted on the side of
 * the wire that can hold one, and the key set comes from the source of truth
 * rather than from whatever the caller happened to send.
 *
 * The numeric family reached that contract late (AGL-1789): it omitted
 * cleared quotas instead of deleting them, so emptying one field of several
 * left the stored override in force while the audit row said it was gone.
 * Absence is the signal there too now — and PRESENCE is what makes an
 * override, so a quota of `0` is a real cap of none, not a cleared field.
 *
 * ## The role split is the rules' split, kept
 *
 * `cloud/firebase-firestore.rules` lets BILLING staff write `plan` and
 * `entitlements` but denies them `releaseFlags`, which is super-only — a
 * per-org release override is the same class of act as the platform-wide
 * flag editor (/api/admin/flags, super-only), not a commercial one. Moving
 * the write to the Admin SDK bypasses those rules entirely, so the split is
 * re-stated here or billing staff silently gain release-flag power. It is
 * enforced on the CHANGE, not on the payload: every override write names
 * `releaseFlags`, and refusing billing staff for naming it unchanged would
 * take away quota overrides they can make today.
 *
 * ## Every refusal says whether anything was written
 *
 * A client batch could promise "nothing was written" from a single catch: a
 * rejected commit applies none of it. A route cannot — a request that dies
 * in the network after leaving the browser may or may not have committed,
 * and AGL-1784's whole lesson is that a wrong "nothing happened" invites a
 * retry whose `before` is the already-overridden state. So every response
 * this handler produces carries an explicit `written` boolean, and the
 * console says "unchanged" only when it reads `written: false` from a body
 * this handler actually wrote. Anything else — a transport failure, a
 * gateway error page — is reported as UNKNOWN rather than as safe.
 *
 * ## A plan with no live subscription behind it is a COMP (AGL-3034)
 *
 * The body gains `comp`, which is `{ plan }` or `null`, beside everything
 * above.
 *
 * `plan` is the STORED plan, and it only decides anything where a live
 * subscription does (or, for a workspace that never subscribed, where staff
 * stored one before comps existed). On a canceled subscription it grants
 * nothing — `resolveEffectivePlan` reads it as Free, AGL-247's rule — so this
 * handler used to write it, answer 200, and change nothing, which is how a
 * staff override on test-org did nothing at all and said nothing about it.
 * The stored plan cannot simply win instead: a paid `plan` beside a canceled
 * subscription is also what a customer who left looks like.
 *
 * So a plan granted where no subscription governs is an explicit comp,
 * `entitlements.planComp`, with its plan, reason, note, staff uid and time,
 * in the same batch and the same audit row as everything else here:
 *
 *  - `comp: { plan }` grants or changes it. Refused while a subscription is
 *    live, because the subscription decides and the comp would do nothing.
 *  - `comp: null` removes it — the only thing that does. An omitted `comp`
 *    leaves it exactly as stored, so a quota edit from a dialog that knows
 *    nothing about comps can never drop one.
 *  - A CHANGE to `plan` on a dead or absent subscription is refused, not
 *    written: on a dead one it would be silently ignored, and on an absent
 *    one it would be a comp with no record. The one change allowed there is
 *    clearing a plan stored directly on a workspace that never subscribed,
 *    which really does return it to Free. The same refusal is what stops a
 *    console tab older than this contract from comping a canceled customer by
 *    saving a quota change with their old plan pre-filled.
 *
 * Every success answers `planEffect` — `describeOrgPlan` of the document as
 * committed, plus what changed and one sentence saying it — so the dialog
 * reports what took effect rather than "updated". A live subscription says
 * that it governs, and that Stripe's next event rewrites the stored plan.
 */

import {
  describeOrgPlan,
  normalizeOrgOverrideReason,
  orgPlanDescriptionSentence,
  orgSubscriptionState,
  PLAN_ENTITLEMENTS,
  PLAN_LABELS,
  pluginRequestFromWeb,
  readOrgPlanComp,
  RELEASE_FLAGS,
  type OrgPlan,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { revalidateOrgHosts } from '../../../../utils/server/tenant-revalidate'
import { FieldValue } from 'firebase-admin/firestore'

export const dynamic = 'force-dynamic'

/** Every numeric entitlement the resolver applies, by name. */
const QUOTA_KEYS = new Set(
  Object.entries(PLAN_ENTITLEMENTS.free)
    .filter(([, value]) => typeof value === 'number')
    .map(([key]) => key),
)

/** Every plan feature boolean, by name. */
const FEATURE_KEYS = Object.keys(PLAN_ENTITLEMENTS.free.features)

/** Every registered release flag, by name. */
const RELEASE_FLAG_KEYS = RELEASE_FLAGS.map((definition) => definition.key)

const PLAN_KEYS = new Set(Object.keys(PLAN_ENTITLEMENTS))

/**
 * A refusal, with the one fact the console cannot work out for itself.
 *
 * `written` is not decoration: it is the difference between "correct the
 * problem and save again" and "go and look at the organization before you
 * touch it". Every path out of this handler states it.
 */
function refuse(error: string, status: number): Response {
  return Response.json({ error, written: false }, { status })
}

/** The explicit boolean overrides out of a wire map, validated. */
function readBooleanMap(
  raw: unknown,
  allowed: string[],
  label: string,
): { values: Record<string, boolean> } | { error: string } {
  if (raw === undefined || raw === null) return { values: {} }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: `${label} must be an object` }
  }
  const values: Record<string, boolean> = {}
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (!allowed.includes(key)) {
      return { error: `Unknown ${label} key: ${key}` }
    }
    if (typeof value !== 'boolean') {
      return { error: `${label}.${key} must be true or false` }
    }
    values[key] = value
  }
  return { values }
}

/**
 * Expand the explicit overrides to the FULL registry key set, deleting every
 * key the caller did not force. This is the AGL-1109 contract restated on
 * the side of the wire that can hold a sentinel — and derived from the
 * registry, so a flag shipped after the caller's bundle is still handled.
 *
 * KEY PRESENCE, never the value: `key in explicit`, so a forced `false` and
 * a quota of `0` are overrides that are WRITTEN, not absences that are
 * deleted. An org capped at zero registers or comped to a 0% marketplace fee
 * is expressing a cap, and reading emptiness off the value would hand it the
 * plan default instead (AGL-1789).
 */
function withInheritDeletes<T extends boolean | number>(
  explicit: Record<string, T>,
  allKeys: Iterable<string>,
): Record<string, T | FieldValue> {
  const payload: Record<string, T | FieldValue> = {}
  for (const key of allKeys) {
    payload[key] = key in explicit ? explicit[key] : FieldValue.delete()
  }
  return payload
}

/** What the caller asked of the comp (AGL-3034). */
type CompRequest =
  | { kind: 'untouched' }
  | { kind: 'remove' }
  | { kind: 'grant'; plan: OrgPlan }

/**
 * `comp` off the wire. ABSENCE IS "LEAVE IT" here, the opposite of the
 * quota and flag maps, on purpose: those maps are the whole editor's state
 * and a missing key is a cleared field, while a comp is removed only by
 * asking for its removal — `null`, which JSON carries — and never because a
 * caller did not mention it.
 */
function readCompRequest(raw: unknown): CompRequest | { error: string } {
  if (raw === undefined) return { kind: 'untouched' }
  if (raw === null) return { kind: 'remove' }
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    return { error: 'comp must be { plan } to grant one, or null to remove it' }
  }
  const plan = (raw as Record<string, unknown>)['plan']
  if (typeof plan !== 'string' || !PLAN_KEYS.has(plan)) {
    return { error: `Unknown comp plan: ${String(plan)}` }
  }
  if (plan === 'free') {
    return {
      error:
        'A comp of Free grants nothing. To remove a comp, send comp: null.',
    }
  }
  return { kind: 'grant', plan: plan as OrgPlan }
}

/**
 * A stored plan for comparison: `free` and no plan resolve the same, so
 * moving between them is not a plan change anyone could observe.
 */
const comparablePlan = (plan: unknown): string =>
  typeof plan === 'string' && plan !== 'free' ? plan : ''

/** Do two flag maps express the same overrides? Junk counts as different. */
function sameFlagMap(a: unknown, b: Record<string, boolean>): boolean {
  const current =
    a && typeof a === 'object' && !Array.isArray(a)
      ? (a as Record<string, unknown>)
      : {}
  const keys = new Set([...Object.keys(current), ...Object.keys(b)])
  for (const key of keys) {
    if (current[key] !== b[key]) return false
  }
  return true
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } =
    await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'POST') return refuse('Method not allowed', 405)

  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return refuse('Unauthenticated', 401)

  // Flipped only once the commit RESOLVES. Nothing runs after it, so a 500
  // out of the catch below reports the truth rather than an assumption.
  let committed = false
  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) return refuse('Staff only', 403)
    // Fails CLOSED to the least-privileged role, like every other staff route
    // (AGL-2131). This one defaulted to `super` on the grounds that the rules
    // read `token.get('staffRole', 'super')` and a pre-RBAC account would
    // otherwise lose a surface it used — but AGL-495 already inverted that
    // default everywhere else, so those accounts have resolved to `support`
    // on every OTHER staff route since. `tools/scripts/audit-staff-claims.mjs`
    // exists precisely to find them and says so in its header. The migration
    // path this comment protected has been over for a while; what was left was
    // a claim-less token resolving to `super` HERE and `support` there, which
    // is the inconsistency, not the fix for one.
    const actorRole = String(decoded['staffRole'] ?? 'support')
    if (actorRole !== 'super' && actorRole !== 'billing') {
      return refuse('Requires the billing or super staff role', 403)
    }

    const orgId = String(body?.['orgId'] ?? '').trim()
    if (!orgId) return refuse('Missing orgId', 400)

    // THE GATE (AGL-1652/1786), before anything is read or written. Same
    // predicate as the disabled Save button, now on the boundary rather than
    // beside it: it refuses rather than defaults, because a defaulted code
    // next to a real fee change is worse than an empty field.
    const reason = normalizeOrgOverrideReason(body?.['reason'], body?.['note'])
    if (!reason) {
      return refuse(
        'An override needs a reason code from the fixed set, and "other" ' +
          'needs a note. The audit row is append-only, so one not given now ' +
          'cannot be added later.',
        400,
      )
    }

    const rawPlan = body?.['plan']
    if (rawPlan !== undefined && rawPlan !== null && typeof rawPlan !== 'string') {
      return refuse('plan must be a string', 400)
    }
    const plan = String(rawPlan ?? '').trim() as OrgPlan | ''
    if (plan && !PLAN_KEYS.has(plan)) {
      return refuse(`Unknown plan: ${plan}`, 400)
    }

    // Numeric entitlements — the caller's EXPLICIT set, and absence is the
    // inherit signal here exactly as it is for the two boolean families
    // (AGL-1789). A quota the operator emptied is expanded into a delete
    // below; one they typed `0` into is a present key and is written.
    const rawQuotas = body?.['quotas']
    if (
      rawQuotas !== undefined &&
      rawQuotas !== null &&
      (typeof rawQuotas !== 'object' || Array.isArray(rawQuotas))
    ) {
      return refuse('quotas must be an object', 400)
    }
    const quotas: Record<string, number> = {}
    for (const [key, value] of Object.entries(
      (rawQuotas ?? {}) as Record<string, unknown>,
    )) {
      if (!QUOTA_KEYS.has(key)) return refuse(`Unknown quota key: ${key}`, 400)
      const numeric = typeof value === 'number' ? value : Number(value)
      if (!Number.isFinite(numeric) || numeric < 0) {
        return refuse(`quotas.${key} must be a number >= 0`, 400)
      }
      // A PERCENTAGE HAS A CEILING (AGL-2293), and these ones are money.
      // `transactionFee*Pct` becomes Stripe's `application_fee_amount` at
      // checkout, so a typed `200` produces a fee larger than the charge;
      // Stripe refuses the session and EVERY sale on that storefront dies
      // until someone connects a 400 at a shopper's checkout to a number typed
      // into the staff dialog weeks earlier. `resolveMarketplaceFeePct` has
      // clamped its own read at `<= 100` since AGL-1543 — this is the same
      // rule at the write, where it can still be reported to the person
      // making the mistake.
      if (key.endsWith('Pct') && numeric > 100) {
        return refuse(`quotas.${key} is a percentage and must be <= 100`, 400)
      }
      quotas[key] = numeric
    }

    const featureRead = readBooleanMap(body?.['features'], FEATURE_KEYS, 'features')
    if ('error' in featureRead) return refuse(featureRead.error, 400)
    const releaseRead = readBooleanMap(
      body?.['releaseFlags'],
      RELEASE_FLAG_KEYS,
      'releaseFlags',
    )
    if ('error' in releaseRead) return refuse(releaseRead.error, 400)
    const explicitFeatures = featureRead.values
    const explicitReleaseFlags = releaseRead.values
    const compRead = readCompRequest(body?.['comp'])
    if ('error' in compRead) return refuse(compRead.error, 400)

    const firestore = firebaseAdmin.app().firestore()
    const orgRef = firestore.collection('orgs').doc(orgId)
    const orgSnapshot = await orgRef.get()
    // `set(…, { merge: true })` CONJURES a document. Overriding a mistyped
    // org id would otherwise mint a phantom org carrying a plan and a fee
    // schedule, and audit it as a real change.
    if (!orgSnapshot.exists) return refuse('No such org', 404)
    const orgData = (orgSnapshot.data() ?? {}) as Record<string, any>

    // The rules' split, restated (see the header). Enforced on the CHANGE:
    // every override write names `releaseFlags`, and the rules' own
    // `affectedKeys()` is a diff, so an unchanged map is not a write billing
    // staff are denied.
    if (
      actorRole !== 'super' &&
      !sameFlagMap(orgData['releaseFlags'], explicitReleaseFlags)
    ) {
      return refuse(
        'Per-organization release flags require the super staff role',
        403,
      )
    }

    // THE PLAN, decided against the LIVE document (AGL-3034) — see "A plan
    // with no live subscription behind it is a COMP" in the header. Every
    // refusal here is before the batch, so each one writes nothing.
    const planBefore = describeOrgPlan(orgData as never)
    const governed = orgSubscriptionState(orgData as never) === 'live'
    const statusWord = planBefore.subscriptionStatus ?? 'none'
    const planLabel = (value: string) =>
      PLAN_LABELS[value as OrgPlan] ?? 'no plan'
    const planChanged = comparablePlan(plan) !== comparablePlan(orgData['plan'])
    if (governed && compRead.kind === 'grant') {
      return refuse(
        `This organization's subscription is ${statusWord}, and a live ` +
          'subscription decides the plan, so a comp would do nothing while ' +
          'it lasts. Set the plan instead, or grant the comp once the ' +
          'subscription has ended.',
        409,
      )
    }
    if (!governed && planChanged && comparablePlan(plan)) {
      return refuse(
        planBefore.subscription === 'dead'
          ? `This organization's subscription is ${statusWord}, so a stored ` +
              `plan grants nothing: saving ${planLabel(plan)} there would ` +
              'change nothing. Grant it as a staff comp instead — reload the ' +
              'override dialog if it did not offer one.'
          : 'No subscription pays for this organization, so ' +
              `${planLabel(plan)} has to be granted as a staff comp, which ` +
              'records why and can be removed. Reload the override dialog if ' +
              'it did not offer one.',
        409,
      )
    }
    if (!governed && planChanged && planBefore.subscription === 'dead') {
      return refuse(
        `This organization's subscription is ${statusWord}, so its stored ` +
          `plan (${planLabel(String(orgData['plan'] ?? ''))}) is Stripe's ` +
          'record and grants nothing; it is left as it is. It resolves as ' +
          `${planLabel(planBefore.effectivePlan)}` +
          (planBefore.compInForce ? ', through its comp.' : '.'),
        409,
      )
    }
    // What reaches `plan`: exactly as before under a live subscription, and
    // otherwise nothing — except the one change allowed without one, clearing
    // a plan stored directly on a workspace that never subscribed.
    const planWrite: { plan?: string | FieldValue } = governed
      ? { plan: plan || FieldValue.delete() }
      : planChanged
        ? { plan: FieldValue.delete() }
        : {}
    const storedPlanAfter: string | null = governed
      ? plan || null
      : planChanged
        ? null
        : ((orgData['plan'] as string | undefined) ?? null)
    const planChange: 'set' | 'cleared' | 'unchanged' = !planChanged
      ? 'unchanged'
      : plan
        ? 'set'
        : 'cleared'

    // THE COMP. `storedCompRaw` is whatever sits at the key, malformed or not,
    // because the audit row records state; `storedComp` is the reading that
    // grants a plan.
    const storedCompRaw =
      ((orgData['entitlements'] as Record<string, unknown> | undefined)?.[
        'planComp'
      ] as unknown) ?? undefined
    const storedComp = readOrgPlanComp(orgData as never)
    let compChange: 'granted' | 'replaced' | 'removed' | 'kept' | 'none' =
      'none'
    let compWrite: Record<string, unknown> | FieldValue | undefined
    let compAfter: unknown = storedCompRaw
    if (compRead.kind === 'grant') {
      if (storedComp?.plan === compRead.plan) {
        // The grant already stands. Rewriting it would replace who granted
        // it and when with this act's; this act has its own audit row.
        compChange = 'kept'
      } else {
        compChange = storedComp ? 'replaced' : 'granted'
        compWrite = {
          plan: compRead.plan,
          reason: reason.reason,
          note: reason.note,
          grantedBy: decoded.uid,
          grantedAt: FieldValue.serverTimestamp(),
        }
        compAfter = compWrite
      }
    } else if (compRead.kind === 'remove') {
      if (storedCompRaw !== undefined) {
        compWrite = FieldValue.delete()
        compChange = storedComp ? 'removed' : 'none'
      }
      compAfter = undefined
    }
    const compRemains = compAfter !== undefined

    // Deletes do not count as overrides, or clearing the last one would
    // leave an empty map behind instead of removing the field — and
    // `overrideCount` reads key presence, so the row chip would never clear.
    // Counted by key presence on BOTH sides of that: an org whose only
    // override is a `0` quota still has one.
    const hasOverrides =
      Object.keys(quotas).length > 0 || Object.keys(explicitFeatures).length > 0
    const hasReleaseOverrides = Object.keys(explicitReleaseFlags).length > 0

    // Both families expanded against their registry, so a quota the operator
    // cleared is DELETED rather than omitted (AGL-1789). Omitting it was the
    // AGL-1109 no-op wearing a number: a merge writes nested maps key by key,
    // so clearing one of several left the stored override in force while the
    // audit row's `after` recorded it as gone.
    //
    // Keys the registry does not name — `datasetsPerHost` and its `max`
    // sibling, the pre-AGL-240 host-keyed overrides the resolver still
    // honours — are left alone. They are not rendered by the dialog, so the
    // operator cannot have meant to clear them; clearing every offered quota
    // still drops the whole map below, unless a comp keeps it (AGL-3034).
    //
    // `planComp` is written only when this act changes it. Left out of a
    // merge, a stored comp survives a save of quotas and flags untouched.
    const entitlements: Record<string, unknown> = {
      ...withInheritDeletes(quotas, QUOTA_KEYS),
      features: hasOverrides
        ? withInheritDeletes(explicitFeatures, FEATURE_KEYS)
        : FieldValue.delete(),
      ...(compWrite !== undefined ? { planComp: compWrite } : {}),
    }

    // `before` is read from the LIVE document, not taken from the caller.
    // The dialog's snapshot is whatever the org looked like when it opened,
    // and AGL-1784's failure mode is precisely a row whose `before` no
    // longer describes the state the change was made against.
    const before = {
      plan: orgData['plan'] ?? null,
      entitlements: orgData['entitlements'] ?? null,
      releaseFlags: orgData['releaseFlags'] ?? null,
    }
    // The resulting STATE, never the delete sentinels: a
    // `FieldValue.delete()` does not serialize to anything a reader of the
    // audit log can act on. A new comp's `grantedAt` is the server timestamp
    // the org document gets, which the row stores as the same instant.
    const after = {
      plan: storedPlanAfter,
      entitlements:
        hasOverrides || compRemains
          ? {
              ...(hasOverrides ? { ...quotas, features: explicitFeatures } : {}),
              ...(compRemains ? { planComp: compAfter } : {}),
            }
          : null,
      releaseFlags: hasReleaseOverrides ? explicitReleaseFlags : null,
    }

    // WHAT TOOK EFFECT (AGL-3034), off the document as it will be committed —
    // the answer the dialog shows instead of "updated", and a line on the row
    // saying which plan the act left the workspace on.
    const planAfter = describeOrgPlan({
      ...orgData,
      plan: storedPlanAfter ?? undefined,
      entitlements: after.entitlements ?? undefined,
    } as never)
    const effectiveMoved = planBefore.effectivePlan !== planAfter.effectivePlan
    const lead = [
      compChange === 'granted' && planAfter.comp
        ? `${planLabel(planAfter.comp.plan)} comp granted.`
        : null,
      compChange === 'replaced' && planAfter.comp && storedComp
        ? `Comp changed from ${planLabel(storedComp.plan)} to ` +
          `${planLabel(planAfter.comp.plan)}.`
        : null,
      compChange === 'removed' && storedComp
        ? `${planLabel(storedComp.plan)} comp removed.`
        : null,
      compChange === 'kept' && storedComp
        ? `The ${planLabel(storedComp.plan)} comp already stands and is unchanged.`
        : null,
      planChange === 'set' ? `Stored plan set to ${planLabel(plan)}.` : null,
      planChange === 'cleared' ? 'Stored plan cleared.' : null,
      effectiveMoved
        ? `Effective plan: ${planLabel(planBefore.effectivePlan)} → ` +
          `${planLabel(planAfter.effectivePlan)}.`
        : null,
    ]
      .filter(Boolean)
      .join(' ')
    const planEffect = {
      ...planAfter,
      compChange,
      planChange,
      before: {
        effectivePlan: planBefore.effectivePlan,
        decidedBy: planBefore.decidedBy,
      },
      summary: [lead, orgPlanDescriptionSentence(planAfter)]
        .filter(Boolean)
        .join(' '),
    }

    // ONE atomic commit, the property AGL-1784 established and this must not
    // give back: the org document and the row that explains it land together
    // or neither does. Anything added to this handler belongs INSIDE the
    // batch — a write appended after `commit()` reopens the gap.
    const batch = firestore.batch()
    batch.set(
      orgRef,
      {
        ...planWrite,
        entitlements:
          hasOverrides || compRemains ? entitlements : FieldValue.delete(),
        releaseFlags: hasReleaseOverrides
          ? withInheritDeletes(explicitReleaseFlags, RELEASE_FLAG_KEYS)
          : FieldValue.delete(),
        updatedAt: FieldValue.serverTimestamp(),
      },
      { merge: true },
    )
    batch.set(firestore.collection('adminAudit').doc(), {
      actorUid: decoded.uid,
      action: 'org.override',
      target: `orgs/${orgId}`,
      before,
      after,
      // WHY, beside the what (AGL-1652). Top-level rather than folded into
      // `after`, because `after` is the resulting state of the org and the
      // reason is a fact about the ACT. `note` is explicitly null when
      // absent; Firestore rejects `undefined`.
      reason: reason.reason,
      note: reason.note,
      // Which plan the act left the workspace on, and what decided it
      // (AGL-3034). `before`/`after` above hold the stored fields; this is
      // the resolution of them, which is the question a comp is asked months
      // later — and a stored plan alone cannot answer it.
      planEffect: {
        before: planEffect.before,
        after: {
          effectivePlan: planAfter.effectivePlan,
          decidedBy: planAfter.decidedBy,
          compInForce: planAfter.compInForce,
        },
        compChange,
        planChange,
      },
      at: FieldValue.serverTimestamp(),
    })
    await batch.commit()
    committed = true

    // The published sites render the plan too — the free-tier badge is
    // resolved in the tenant loader (AGL-1152) — so a plan that MOVED drops
    // their cached pages, the way the billing webhook does on a Stripe
    // transition. After the commit because it is a cache hint over HTTP, not
    // a write, and `revalidateOrgHosts` never throws; a quota-only save moves
    // no plan and fans nothing out.
    if (effectiveMoved) await revalidateOrgHosts(firestore, orgId)

    // `after` as the row records it, with the comp as it READS — a new comp's
    // server timestamp has no JSON form until it has been committed.
    const responseAfter = {
      ...after,
      entitlements:
        after.entitlements && compRemains
          ? { ...after.entitlements, planComp: planAfter.comp ?? compAfter }
          : after.entitlements,
    }
    return Response.json(
      { ok: true, written: true, after: responseAfter, planEffect },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours
    // (AGL-1993). Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/org-override]', error)
    return Response.json(
      {
        error: 'Override failed',
        // Never assumed. Only a cache hint that never throws runs after the
        // commit, so this is false for every reachable throw — but reading it
        // from the flag is what keeps that true if something is ever added
        // below it.
        written: committed,
      },
      { status: 500 },
    )
  }
}

export { handler as POST }
