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
 *
 * ## The number is graded in BOTH directions (AGL-2672)
 *
 * A hand-set number is a floor only while somebody maintains it, and the
 * surplus — how far the live count sits above this one — is exactly how many
 * forms may stop routing before the count can notice. A number one below the
 * truth is therefore not a weaker check, it is a check that is not running,
 * and it stays quiet for as long as that lasts. Four lead forms against a
 * three is the shape AGL-2669 was found in.
 *
 * ⛔ The answer is NOT to derive the number from the forms in front of it. An
 * expectation that tracks its own subject agrees with every reality it could
 * be handed and can never fail, which is the defect the floor exists to
 * prevent.
 *
 * So the number stays hand-set and the check grades the DISAGREEMENT, with a
 * code per direction: below is a funnel that lost a lead surface, above is an
 * expectation nobody revisited when the funnel changed. The second is red
 * rather than a field in the body because "we are no longer watching what we
 * said we were watching" must not read the same as "the funnel is fine" —
 * the rule `marketingHost()` already applies to a canary pointed at nothing.
 * Nothing consumes this endpoint until an operator points a monitor at it,
 * and the code names the knob that settles it.
 *
 * The env var keeps `MIN` in its name deliberately. The value IS the floor,
 * and the below arm is still the one that catches a lost lead surface;
 * renaming a key an operator may already have set would answer with the
 * default on the deployment most likely to have thought about the number.
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
  /**
   * The form's pointer says a version was published and the design that
   * publish wrote onto the document is gone or unreadable. A placement whose
   * entity has no resolvable tree is left alone by the graft, so every page
   * carrying this form falls back to whatever it drew inline — for a form
   * built as an entity, an empty form that answers 200 and collects nothing.
   */
  | 'design-missing'
  /**
   * `routing.lead` is on and NOTHING on the form records an opt-in — neither
   * a declared consent field nor one the submit route recognizes by name.
   * Not "no declared field": a form carrying `marketingOptIn` and declaring
   * nothing is correctly wired, and the publish gate lets it through.
   */
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
  /**
   * Whether a promotion has ever moved this form's published pointer.
   *
   * `versionId` is the only field that records one; both promotion paths
   * write it in the same update as the design, and the rules deny an author
   * the key. It is also one-way — nothing clears it — which is what lets an
   * unpublished form be excluded without opening a way to leave the graded
   * set by going backwards.
   */
  published: boolean
  /**
   * Whether the published snapshot is still on the document and resolvable,
   * asked with the predicate the renderer's own forms read applies before it
   * hands a placement to the graft. A check answering this differently would
   * grade a design no visitor is served.
   */
  hasDesign: boolean
}

export interface FunnelRoutingCheck extends HealthCheck {
  /**
   * The site's LIVE lead surfaces: forms that declare `routing.lead` and have
   * been published. This is the number graded against `required`.
   */
  leadForms: number
  /** The count `leadForms` is graded against, in both directions. */
  required: number
  /**
   * Lead-routing forms in the catalog that no visitor can reach yet.
   *
   * Reported so the number above reconciles with what a console list shows —
   * a count that silently disagreed with the forms page would send whoever
   * reads this incident looking for a form that had left for a reason
   * nothing states.
   */
  unpublished: number
  /** Fault code → how many forms carry it. Counts only, never form names. */
  faults: Record<string, number>
}

/**
 * One stored form document reduced to the facts, or `null` when the document
 * is not a lead surface at all.
 *
 * Pure, and here rather than in the probe, because WHICH FORMS ARE GRADED is
 * the same kind of decision as what makes one faulty: a partition performed
 * inline against a Firestore snapshot could only be exercised with an admin
 * credential, and this check's red-proof runs with neither that nor a
 * network.
 *
 * `null` is the catalog filter — retired, or never a lead surface at all.
 * That is a different exclusion from an unpublished form, which IS in the
 * funnel's catalog and merely in front of nobody yet, and is counted as such.
 */
export function funnelFormFacts(
  data: Record<string, unknown>,
): FunnelFormFacts | null {
  // Through the shared reader, which asks about PRESENCE: the marker is
  // written by whatever retired the form, and at least one in production is a
  // Firestore `Timestamp` rather than a number.
  if (Aglyn.isFormArchived(data)) return null
  const routing = data['routing'] as { lead?: unknown } | undefined
  if (routing?.lead !== true) return null
  const declaredFields = Array.isArray(data['fields'])
    ? (data['fields'] as { fieldName?: unknown }[])
    : []
  const published = Boolean(String(data['versionId'] ?? '').trim())
  return {
    consentFieldName:
      typeof data['consentFieldName'] === 'string'
        ? data['consentFieldName']
        : undefined,
    fieldNames: declaredFields.map((field) => String(field?.fieldName ?? '')),
    // Read through the shared reader the submit route stamps rows with, so
    // "filed under a campaign" means here exactly what it means there.
    campaignCount: Aglyn.readCampaignIds(data).length,
    published,
    hasDesign: published && hasResolvableDesign(data),
  }
}

/**
 * Whether the published snapshot on the document is a tree the graft can
 * resolve: a `rootId` that is present among its own decoded `nodes`.
 *
 * Predicate for predicate what `getForms` skips a placement on, so the two
 * cannot drift into disagreeing about which forms a page can actually render.
 *
 * The decode is why this is asked only of a form whose pointer says it was
 * published. A site's whole form catalog is read on a public endpoint, and
 * msgpack over every document in it would be paid for documents this never
 * grades — a freshly created form carries the canvas it was seeded with, and
 * that seed is not a publication.
 */
function hasResolvableDesign(data: Record<string, unknown>): boolean {
  const rootId = typeof data['rootId'] === 'string' ? data['rootId'] : ''
  if (!rootId) return false
  const nodes = Aglyn.decodeStoredNodes<Record<string, unknown>>(data['nodes'])
  return Boolean(nodes?.[rootId])
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
      unpublished: 0,
      faults: {},
    }
  }
  /*
   * A FORM WITH NO PUBLISHED VERSION IS NOT IN THE FUNNEL (AGL-2672).
   *
   * It has no design to place, no fields derived from one, and no page can
   * render it, so grading it reports about a surface no prospect can reach —
   * and counting it toward the expectation would let an unreachable form
   * stand in for a live one, which is the floor being satisfied by something
   * that collects nothing.
   *
   * The exclusion is safe only because it is ONE-WAY. Nothing clears
   * `versionId`, so a form cannot leave this set by losing its publication;
   * the form that WAS published and whose design is now gone stays graded,
   * and `design-missing` below is what says so. Distinguishing the two is the
   * whole point — the second is a real failure and looks identical from a
   * count.
   */
  const live = forms.filter((form) => form.published)
  const faults: Record<string, number> = {}
  for (const form of live) {
    const fault = firstFault(form)
    if (fault) faults[fault] = (faults[fault] ?? 0) + 1
  }
  const base = {
    ms,
    leadForms: live.length,
    required,
    unpublished: forms.length - live.length,
    faults,
  }
  // The floor first: a form that stopped routing has LEFT this set, so the
  // count is the only thing that can still see it.
  if (live.length < required) {
    return { ...base, ok: false, code: 'lead-forms-below-floor' }
  }
  if (Object.keys(faults).length) {
    return { ...base, ok: false, code: 'forms-misrouted' }
  }
  /*
   * More live lead surfaces than the funnel is recorded as having, which is
   * the arm above no longer grading anything: the surplus is how many forms
   * may stop routing before a count can see it.
   *
   * Last of the three, because nothing on the site is broken — the recorded
   * number is what needs a decision — and because whoever reads this incident
   * must never be told a form stopped routing when one was added.
   */
  if (live.length > required) {
    return { ...base, ok: false, code: 'lead-form-expectation-stale' }
  }
  return { ...base, ok: true }
}

/**
 * The first thing wrong with one lead-routing form, or null.
 *
 * Asked only of a form that has been published, so the design arm is about a
 * publication whose snapshot went missing rather than about one that was
 * never made.
 *
 * Both consent arms are asked through the SHARED contract rather than
 * re-derived here, because a second opinion drifts from the real one and then
 * reports about a rule it no longer shares:
 *
 *  - whether the form records consent AT ALL is `formFieldsCaptureConsent`,
 *    the same function `checkFormContract` refuses a publish on and the Leads
 *    section offers from. Consent comes from the field a form DECLARES or,
 *    when it declares none, from an undeclared field the submit route
 *    recognizes by name — so an undeclared form that carries `marketingOptIn`
 *    is correctly wired, and a check that demanded a declared name would call
 *    a healthy funnel broken;
 *  - whether a ticked value under a declared name READS as consent is
 *    `readFormDeclaredConsent`, the function the submit route itself calls.
 *
 * The declared-name arms are conditional for the same reason: a form that
 * captures consent by recognized name has no declared name to lose, and
 * `consent-unreadable` is about a declaration that no longer resolves.
 */
function firstFault(form: FunnelFormFacts): FormFault | null {
  // The design first. With no tree to place, the declaration below describes
  // a form nobody is served, and a consent code reached over it would name a
  // repair that changes nothing about why the leads stopped.
  if (!form.hasDesign) return 'design-missing'
  const declared = String(form.consentFieldName ?? '').trim()
  const fields = form.fieldNames.map((fieldName) => ({ fieldName }))
  if (!Aglyn.formFieldsCaptureConsent(fields, declared)) {
    return 'consent-undeclared'
  }
  if (declared) {
    if (!form.fieldNames.includes(declared)) return 'consent-unreadable'
    if (!Aglyn.readFormDeclaredConsent({ consentFieldName: declared }, { [declared]: 'yes' })) {
      return 'consent-unreadable'
    }
  }
  if (form.campaignCount <= 0) return 'campaign-unlinked'
  return null
}
