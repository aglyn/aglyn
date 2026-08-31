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
 * WHERE THIS DEPLOYMENT FILES — the control, not the variable.
 *
 * A registration number changes when a business registers in a new state. That
 * is an operator action and it was a deployment action: `AGLYN_TAX_JURISDICTION`,
 * `AGLYN_TAX_REGISTRATION_ID` and `AGLYN_TAX_FILING_ID` could only be changed
 * by editing the environment and redeploying, which puts a filing decision
 * behind a release.
 *
 * Same posture as the free-workspace ceiling and the send-rate ramp: any staff
 * may READ what is configured, only `super` may CHANGE it, and every change
 * lands with an `adminAudit` row carrying a before, an after and the reason the
 * operator typed. Both gates are enforced HERE rather than in the card — a
 * component that hides a button is a suggestion.
 *
 * ## What this route will not put in a response
 *
 * The registration and filing identifiers themselves. `taxFilingConfigView` is
 * the only thing that builds the body, and it has no path that copies a raw
 * identifier into its result: a registration number reports as configured with
 * a last-four, and the filing credential reports as configured and nothing
 * else. The Texas Webfile number is what the Comptroller's eSystems calls a
 * "Personal Identification Code" and authenticates a profile with, so a
 * last-four of its six digits would narrow it to a hundred candidates — that
 * is not masking, and the console offers no reveal for it at all. The one
 * surface that needs the whole value is the return, at the moment of filing,
 * and `/api/admin/tax-return` already serves it there behind the same gate.
 *
 * ## Why the audit row carries no identifier either
 *
 * `adminAudit` is readable by ANY staff role. A row echoing the number that
 * was set would put a filing credential in front of every reader the write
 * gate exists to exclude. The row records the jurisdiction, whether each
 * identifier was present before and after, and the reason — which is what
 * "who changed the filing configuration, when, and why" actually needs.
 *
 * ## DELETE is the other direction of the precedence rule
 *
 * The console wins and the environment is the bootstrap, so an operator who
 * stores a value can no longer be overruled by `.env` — and needs a way back.
 * DELETE removes the stored record, which hands the environment its layer
 * again. Audited exactly like a write, because "the registration changed" is
 * the same event whichever direction it moved.
 */

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import {
  TAX_FILING_NOTE_MAX,
  cleanTaxConfigValue,
  taxFilingConfigView,
  validateTaxFilingProposal,
} from '../../../../utils/tax-filing-config'
import { normalizeTaxJurisdictionKey } from '../../../../utils/tax-jurisdictions'
import {
  PLATFORM_SETTINGS_COLLECTION,
  TAX_FILING_CONFIG_DOC,
  invalidateTaxFilingConfigCache,
  readStoredTaxFilingConfig,
  resolveTaxFilingSettings,
  taxFilingConfigWrite,
} from '../../../../utils/server/tax-filing-store'

/** What an audit row may say about an identifier: whether there was one. */
function auditShape(resolved: {
  jurisdiction: { code: string }
  registrationId: string | null
  registrationIdSource: string
  filingId: string | null
  filingIdSource: string
  firstTaxablePeriod: string
}) {
  return {
    jurisdiction: resolved.jurisdiction.code,
    // Presence and LAYER, never the value — see the note above about who can
    // read this collection.
    registrationIdSet: Boolean(resolved.registrationId),
    registrationIdSource: resolved.registrationIdSource,
    filingIdSet: Boolean(resolved.filingId),
    filingIdSource: resolved.filingIdSource,
    firstTaxablePeriod: resolved.firstTaxablePeriod,
  }
}

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'PUT' && method !== 'DELETE') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const actorRole = String(decoded['staffRole'] ?? 'support')

    if (method === 'GET') {
      const resolved = await resolveTaxFilingSettings()
      return Response.json(
        {
          role: actorRole,
          config: taxFilingConfigView(resolved),
          limits: { noteMax: TAX_FILING_NOTE_MAX },
        },
        { status: 200 },
      )
    }

    // Reading is open to any staff role — support answers "where do we file"
    // without a deploy and without a write. Changing it is `super`, the same
    // bar as release flags: this decides which authority a return is prepared
    // for and under whose registration number it is signed.
    if (actorRole !== 'super') {
      return Response.json(
        { error: 'Requires the super staff role' },
        { status: 403 },
      )
    }

    const note = String(body?.note ?? '').trim().slice(0, TAX_FILING_NOTE_MAX)
    // A reason is REQUIRED on this control, unlike the free-workspace ceiling
    // where the number itself carries most of the story. "The registration id
    // changed" is not self-explaining: an auditor reading it a year later
    // needs to know whether it was a new state, a renewal or a correction.
    if (!note) {
      return Response.json(
        { error: 'A reason is required — it is written to the audit log' },
        { status: 400 },
      )
    }

    const before = await resolveTaxFilingSettings()
    const settings = firebaseAdmin
      .app()
      .firestore()
      .collection(PLATFORM_SETTINGS_COLLECTION)
      .doc(TAX_FILING_CONFIG_DOC)

    if (method === 'DELETE') {
      await settings.delete()
      invalidateTaxFilingConfigCache()
      const after = await resolveTaxFilingSettings()
      await firebaseAdmin
        .app()
        .firestore()
        .collection('adminAudit')
        .add({
          actorUid: decoded.uid,
          action: 'taxFilingConfig.clear',
          target: `${PLATFORM_SETTINGS_COLLECTION}/${TAX_FILING_CONFIG_DOC}`,
          before: auditShape(before),
          after: auditShape(after),
          note,
          at: FieldValue.serverTimestamp(),
        })
      return Response.json(
        { ok: true, config: taxFilingConfigView(after) },
        { status: 200 },
      )
    }

    /**
     * An identifier field the caller did not send is one it is not changing.
     *
     * The stored record is written whole (see `merge: false` below), so
     * something has to fill a field the operator left blank — and "blank means
     * erase" would make editing the first taxable period a way to silently
     * unset a registration number. A field that is PRESENT and empty is an
     * explicit erase; a field that is absent keeps what is stored.
     *
     * Carried forward only while the jurisdiction is unchanged. Moving to
     * another authority drops the previous authority's numbers rather than
     * re-filing them under a registration that never issued them.
     */
    const storedBefore = await readStoredTaxFilingConfig()
    const proposedJurisdiction = normalizeTaxJurisdictionKey(body?.jurisdiction)
    const carry =
      storedBefore !== null &&
      proposedJurisdiction !== null &&
      normalizeTaxJurisdictionKey(storedBefore.jurisdiction) === proposedJurisdiction
    const carried = (field: 'registrationId' | 'filingId'): string | null => {
      if (body && Object.prototype.hasOwnProperty.call(body, field)) {
        return cleanTaxConfigValue((body as Record<string, unknown>)[field])
      }
      return carry ? cleanTaxConfigValue(storedBefore?.[field]) : null
    }

    // A jurisdiction that cannot be a `summary.byJurisdiction` key is refused
    // here rather than diagnosed on the return, and half a Texas registration
    // is refused for the same reason: both are configurations whose only
    // symptom is a filing document that looks finished.
    const proposal = validateTaxFilingProposal({
      jurisdiction: body?.jurisdiction,
      registrationId: carried('registrationId'),
      filingId: carried('filingId'),
      firstTaxablePeriod: body?.firstTaxablePeriod,
    })
    if (proposal.error || !proposal.value) {
      return Response.json(
        { error: proposal.error ?? 'Invalid filing configuration' },
        { status: 400 },
      )
    }

    const write = taxFilingConfigWrite({
      ...proposal.value,
      actorEmail: decoded.email ?? null,
      note,
    })
    // `merge: false`: the stored record is the WHOLE configuration. Merging
    // would leave a previous authority's identifier under a new jurisdiction,
    // which is the pairing the resolver refuses one layer up.
    await settings.set(write)
    // The process that took the action serves the new configuration
    // immediately; others converge within the cache TTL. No deploy in any of
    // it, which is the point of the control.
    invalidateTaxFilingConfigCache()

    const after = await resolveTaxFilingSettings()
    await firebaseAdmin
      .app()
      .firestore()
      .collection('adminAudit')
      .add({
        actorUid: decoded.uid,
        action: 'taxFilingConfig.update',
        target: `${PLATFORM_SETTINGS_COLLECTION}/${TAX_FILING_CONFIG_DOC}`,
        before: auditShape(before),
        after: auditShape(after),
        note,
        at: FieldValue.serverTimestamp(),
      })

    return Response.json(
      { ok: true, config: taxFilingConfigView(after) },
      { status: 200 },
    )
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours (AGL-1993).
    // Null for anything else, so a real failure keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[admin/tax-filing]', error)
    return Response.json(
      { error: 'Tax filing configuration operation failed' },
      { status: 500 },
    )
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as PUT, handler as DELETE }
