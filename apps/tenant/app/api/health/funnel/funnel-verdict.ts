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
 * The funnel verdicts, pure (AGL-2586).
 *
 * Separated from the probe for the reason every verdict in
 * `health-report.ts` is: the probe reads Firestore and resolves a host, this
 * decides, and a spec exercises every branch with no network and no admin
 * credential. It also keeps the FLOOR and the fault rules — the two things
 * that decide whether a lead is really being routed — in a file whose only
 * import is the shared framework.
 */
import * as Aglyn from '@aglyn/aglyn/server'
import type { HealthCheck } from '@aglyn/aglyn/server'

/**
 * How many lead-routing forms the watched site is expected to carry.
 *
 * THE FLOOR IS THE POINT, and it is what a per-form list could not buy. This
 * probe grades the forms that declare `routing.lead === true`; a form whose
 * flag is turned off simply leaves that set, so grading the set alone would
 * report a clean bill of health for the single edit most likely to lose
 * every lead a form collects. A count with a floor cannot be quietly
 * satisfied by deletion.
 *
 * Three is the funnel AGL-2586 names — contact, sales enquiry, demo request.
 * `AGLYN_FUNNEL_MIN_LEAD_FORMS` overrides it: an operator with a different
 * funnel sets their own number, and setting it to a number above the truth
 * is the forced-failure lever this check's red path is proven with.
 */
export const DEFAULT_MIN_LEAD_FORMS = 3

export function configuredLeadFormFloor(): number {
  const raw = process.env['AGLYN_FUNNEL_MIN_LEAD_FORMS']
  if (!raw) return DEFAULT_MIN_LEAD_FORMS
  const parsed = Number.parseInt(raw, 10)
  return Number.isFinite(parsed) ? parsed : DEFAULT_MIN_LEAD_FORMS
}

/**
 * Would the next real submission be accepted at all?
 *
 * The verdicts `/api/forms/submit` reaches before its first write, named as
 * outcomes rather than as HTTP statuses: the route answers 423, 429 or 404,
 * and what a reader of an incident needs is which gate said no.
 */
export type IntakeOutcome =
  | { kind: 'not-configured' }
  /** The alias resolved to no host document. Nothing is collecting anything. */
  | { kind: 'host-unresolved' }
  /** A platform, org or host lockdown is refusing visitor writes (423). */
  | { kind: 'paused' }
  /** The plan's monthly submission wall is reached (429). */
  | { kind: 'quota-exhausted' }
  /** The abuse ceiling has tripped and the site is refusing (429). */
  | { kind: 'ceiling-tripped' }
  /**
   * The submission would be stored and then announced to nobody: no manager
   * on the host carries a role `notifyHostManagers` fans out to.
   */
  | { kind: 'unattended' }
  /** Accepted, and there is somebody to tell. */
  | { kind: 'open' }
  /** The probe could not determine any of the above. */
  | { kind: 'unavailable' }

export interface FunnelIntakeCheck extends HealthCheck {
  /**
   * How many people would receive the in-app notification a submission
   * fires. A COUNT, never the uids: this endpoint is public.
   */
  recipients: number
}

export function funnelIntakeHealth(
  outcome: IntakeOutcome,
  recipients: number,
  ms: number,
): FunnelIntakeCheck {
  const base = { ms, recipients }
  switch (outcome.kind) {
    case 'open':
      return { ...base, ok: true }
    case 'not-configured':
      return { ...base, ok: false, code: 'not-configured' }
    case 'host-unresolved':
      return { ...base, ok: false, code: 'host-unresolved' }
    case 'paused':
      return { ...base, ok: false, code: 'submissions-paused' }
    case 'quota-exhausted':
      return { ...base, ok: false, code: 'quota-exhausted' }
    case 'ceiling-tripped':
      return { ...base, ok: false, code: 'abuse-ceiling-tripped' }
    case 'unattended':
      // A stored submission nobody is told about is the quiet half of a lost
      // lead: the row exists, and the only person who would act on it never
      // learns it arrived.
      return { ...base, ok: false, code: 'no-notification-recipient' }
    case 'unavailable':
    default:
      // Same rule as every sibling probe: "we could not determine whether the
      // funnel accepts submissions" is a failure, never calm.
      return { ...base, ok: false, code: 'intake-unavailable' }
  }
}

/**
 * What is wrong with a lead-routing form, if anything. One form can only
 * report its first fault — the codes are a histogram for the human reading
 * the incident, not a per-form audit, and the endpoint is public.
 */
export type FormFault =
  /** `routing.lead` is on but no field is declared as the opt-in. */
  | 'consent-undeclared'
  /**
   * A consent field IS declared and the real reader cannot read it: either
   * the named field is not among the form's own fields, or a ticked value
   * under that name does not come back as consent.
   */
  | 'consent-unreadable'
  /** The form is filed under no campaign, so nobody is ever mailed. */
  | 'campaign-unlinked'

/** The subject a routing verdict is reached over. */
export interface FunnelFormFacts {
  /** Declared as the marketing opt-in, verbatim. */
  consentFieldName?: string
  /** The submission keys the form declares. */
  fieldNames: string[]
  /** How many campaigns the form is filed under. */
  campaignCount: number
}

export interface FunnelRoutingCheck extends HealthCheck {
  /** Forms on the site that declare themselves lead surfaces. */
  leadForms: number
  /** The floor `leadForms` is graded against. */
  required: number
  /** Fault code → how many forms carry it. Counts only, never form names. */
  faults: Record<string, number>
}

/**
 * Grade the site's lead-routing forms.
 *
 * `forms` is every non-archived form that declared `routing.lead === true`.
 * `null` means the read failed, which is degraded by contract.
 */
export function funnelRoutingHealth(
  forms: FunnelFormFacts[] | null,
  required: number,
  ms: number,
): FunnelRoutingCheck {
  if (!forms) {
    return {
      ok: false,
      ms,
      code: 'routing-unavailable',
      leadForms: 0,
      required,
      faults: {},
    }
  }
  const faults: Record<string, number> = {}
  for (const form of forms) {
    const fault = firstFault(form)
    if (fault) faults[fault] = (faults[fault] ?? 0) + 1
  }
  const base = { ms, leadForms: forms.length, required, faults }
  // The floor first: a form that stopped routing has LEFT this set, so the
  // count is the only thing that can still see it.
  if (forms.length < required) {
    return { ...base, ok: false, code: 'lead-forms-below-floor' }
  }
  if (Object.keys(faults).length) {
    return { ...base, ok: false, code: 'forms-misrouted' }
  }
  return { ...base, ok: true }
}

/**
 * The first thing wrong with one lead-routing form, or null.
 *
 * The consent arm drives `readFormDeclaredConsent` — the function the submit
 * route itself calls — against a ticked value under the declared name,
 * rather than re-deriving what "ticked" means here. A second opinion about
 * the affirmative values would drift from the real one, and would then
 * report healthy about a rule it no longer shares.
 */
function firstFault(form: FunnelFormFacts): FormFault | null {
  const declared = String(form.consentFieldName ?? '').trim()
  if (!declared) return 'consent-undeclared'
  if (!form.fieldNames.includes(declared)) return 'consent-unreadable'
  if (!Aglyn.readFormDeclaredConsent({ consentFieldName: declared }, { [declared]: 'yes' })) {
    return 'consent-unreadable'
  }
  if (form.campaignCount <= 0) return 'campaign-unlinked'
  return null
}
