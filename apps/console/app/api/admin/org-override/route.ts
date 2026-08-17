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
 * So the body carries only what is EXPLICITLY overridden — `features` and
 * `releaseFlags` are maps of the keys forced on or off, and nothing else.
 * ABSENCE IS THE INHERIT SIGNAL, and this route expands it against the
 * registries (`PLAN_ENTITLEMENTS.free.features`, `RELEASE_FLAGS`) into the
 * Admin SDK's `FieldValue.delete()`. The sentinel is minted on the side of
 * the wire that can hold one, and the key set comes from the source of truth
 * rather than from whatever the caller happened to send.
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
 */

import {
  normalizeOrgOverrideReason,
  PLAN_ENTITLEMENTS,
  pluginRequestFromWeb,
  RELEASE_FLAGS,
  type OrgPlan,
} from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
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
 */
function withInheritDeletes(
  explicit: Record<string, boolean>,
  allKeys: string[],
): Record<string, boolean | FieldValue> {
  const payload: Record<string, boolean | FieldValue> = {}
  for (const key of allKeys) {
    payload[key] = key in explicit ? explicit[key] : FieldValue.delete()
  }
  return payload
}

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
    // Fails CLOSED to the least-privileged role on a missing claim would be
    // wrong HERE: the rules read `token.get('staffRole', 'super')`, so a
    // pre-RBAC staff account with no claim can make this write today
    // (AGL-206's migration path). Diverging would lock those accounts out of
    // a surface they use, which is a different bug from the one being fixed.
    const actorRole = String(decoded['staffRole'] ?? 'super')
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

    // Numeric entitlements. Only what the caller explicitly set — an omitted
    // quota is left exactly as stored, which is the shipped behaviour of the
    // dialog this replaces. That is the AGL-1109 bug still open for the
    // numeric family (clearing ONE of several quotas does not remove it),
    // preserved verbatim here so this migration changes no behaviour, and
    // filed as AGL-1789 rather than half-fixed under a refactor.
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

    // Deletes do not count as overrides, or clearing the last one would
    // leave an empty map behind instead of removing the field — and
    // `overrideCount` reads key presence, so the row chip would never clear.
    const hasOverrides =
      Object.keys(quotas).length > 0 || Object.keys(explicitFeatures).length > 0
    const hasReleaseOverrides = Object.keys(explicitReleaseFlags).length > 0

    const entitlements: Record<string, unknown> = { ...quotas }
    if (hasOverrides) {
      entitlements['features'] = withInheritDeletes(explicitFeatures, FEATURE_KEYS)
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
    // The resulting STATE, never the sentinels: a `FieldValue.delete()` does
    // not serialise to anything a reader of the audit log can act on.
    const after = {
      plan: plan || null,
      entitlements: hasOverrides
        ? { ...quotas, features: explicitFeatures }
        : null,
      releaseFlags: hasReleaseOverrides ? explicitReleaseFlags : null,
    }

    // ONE atomic commit, the property AGL-1784 established and this must not
    // give back: the org document and the row that explains it land together
    // or neither does. Anything added to this handler belongs INSIDE the
    // batch — a write appended after `commit()` reopens the gap.
    const batch = firestore.batch()
    batch.set(
      orgRef,
      {
        plan: plan || FieldValue.delete(),
        entitlements: hasOverrides ? entitlements : FieldValue.delete(),
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
      at: FieldValue.serverTimestamp(),
    })
    await batch.commit()
    committed = true

    return Response.json({ ok: true, written: true, after }, { status: 200 })
  } catch (error) {
    console.error('[admin/org-override]', error)
    return Response.json(
      {
        error: 'Override failed',
        // Never assumed. Nothing runs after the commit, so this is false for
        // every reachable throw — but reading it from the flag is what keeps
        // that true if something is ever added below it.
        written: committed,
      },
      { status: 500 },
    )
  }
}

export { handler as POST }
