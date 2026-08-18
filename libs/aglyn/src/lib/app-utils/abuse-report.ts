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
 * ABUSE REPORT INTAKE (AGL-1964) — the missing input to a mature response
 * system.
 *
 * Aglyn's takedown tooling is good: five lockdown scopes with a staff UI, 38
 * `lockdownRefusal()` sites, media quarantine by content digest, an audit
 * trail, read-only mode. Every one of those is a lever an operator pulls
 * AFTER learning there is a problem. Nothing anywhere let an outsider tell us
 * there was one — no report route, no form, no affordance on a published
 * site.
 *
 * ## Why that is the launch risk rather than a nicety
 *
 * From Sept 1 anyone can sign up and have arbitrary content live on
 * `{sub}.aglyn.app` within minutes. When one of those is used for phishing,
 * the finder is a bank's fraud team, a browser vendor, or Safe Browsing —
 * none of whom are customers, none of whom can open a support ticket (that
 * route is 401 + paid-plan gated), and all of whom have a next step if they
 * cannot reach us: a **domain-level block on `*.aglyn.app`**, which takes
 * every legitimate customer site down with it. The cheapest possible
 * mitigation is a reachable form. This is that form's shared core.
 *
 * ## The intake is a QUEUE, not an email address, and that is deliberate
 *
 * The published Acceptable Use Policy names `abuse@aglyn.com`, and the
 * Copyright/DMCA Policy names `dmca@aglyn.com`. AGL-1973 records that neither
 * mailbox is confirmed to exist — the Drive open-items list has only
 * `noreply@` and `info@` live — and AGL-1577 records that Gmail default
 * routing **accepts mail for non-existent @aglyn.com addresses with bounce
 * suppression on and no delivery recipient configured**. Those two facts
 * together mean a report sent to `abuse@` may be accepted and silently
 * discarded, with the reporter believing they told us.
 *
 * A published address that drops mail is worse than publishing none, because
 * it converts a reachable problem into an invisible one. So the primary
 * intake writes a Firestore document a staff surface reads, where delivery is
 * a database write we control rather than a routing rule we have not read.
 * The form is the thing to publish; the mailbox is a nice-to-have once
 * AGL-1973 confirms it.
 *
 * ## Categories carry the response, not just a label
 *
 * {@link ABUSE_REPORT_CATEGORIES} maps onto the levers that already exist:
 * every category's `severity` says how fast a human must look, and `dmca`
 * alone opens the statutory fields. The reason codes deliberately reuse the
 * media-quarantine vocabulary (`abuse`, `dmca`, `malware`) so a report can be
 * actioned into a quarantine or a lockdown without a translation table.
 */

/** Firestore collection holding intake rows. Staff-read, Admin-SDK-written. */
export const ABUSE_REPORT_COLLECTION = 'abuseReports'

/**
 * The contact address printed on the form.
 *
 * `support@aglyn.com` and NOT `abuse@aglyn.com`, deliberately. It is the one
 * address both existing notice families already print
 * (`LOCKDOWN_SUPPORT_EMAIL`, `MEDIA_QUARANTINE_SUPPORT_EMAIL`), it is
 * customer-visible on the lockdown 503 today, and it is therefore the address
 * most likely to be real. Printing `abuse@` here would spread an unconfirmed
 * mailbox to one more surface; when AGL-1973 confirms it, this constant is
 * the single place to change.
 */
export const ABUSE_REPORT_CONTACT_EMAIL = 'support@aglyn.com'

/** Maximum characters of reporter prose stored. */
export const ABUSE_REPORT_MAX_DETAILS = 5000
/** Maximum length of the reported URL. */
export const ABUSE_REPORT_MAX_URL = 2048
/** Maximum length of a reporter's email/name. */
export const ABUSE_REPORT_MAX_CONTACT = 254

export type AbuseReportSeverity = 'urgent' | 'high' | 'normal'

export interface AbuseReportCategoryDefinition {
  /** Stored discriminator. */
  id: string
  /** What the reporter sees. */
  label: string
  /** One line of help under the label. */
  hint: string
  /**
   * How fast a human must look. `urgent` categories are the ones where the
   * cost of a slow response is borne by someone who is not our customer.
   */
  severity: AbuseReportSeverity
}

/**
 * The reportable categories.
 *
 * Ordered by how much damage an hour of delay does, because the order is what
 * a panicking reporter actually reads. Phishing and CSAM lead: both have a
 * victim who is not our customer, and both are the categories whose
 * unanswered report becomes a `*.aglyn.app` domain block.
 *
 * `csam` is `urgent` and is deliberately NOT given a self-service lever
 * anywhere in the product — it is a report-to-NCMEC-and-preserve obligation,
 * not a takedown button, and the runbook says so.
 */
export const ABUSE_REPORT_CATEGORIES: readonly AbuseReportCategoryDefinition[] =
  [
    {
      id: 'phishing',
      label: 'Phishing or fraud',
      hint: 'A page impersonating another business to steal logins, card numbers or personal details.',
      severity: 'urgent',
    },
    {
      id: 'csam',
      label: 'Child sexual abuse material',
      hint: 'Reported to the authorities and handled outside the normal queue.',
      severity: 'urgent',
    },
    {
      id: 'malware',
      label: 'Malware or harmful downloads',
      hint: 'A file or script that infects or attacks the visitor.',
      severity: 'urgent',
    },
    {
      id: 'dmca',
      label: 'Copyright infringement (DMCA)',
      hint: 'Your copyrighted work is published without permission. Needs the statutory statements below.',
      severity: 'high',
    },
    {
      id: 'impersonation',
      label: 'Impersonation or trademark',
      hint: 'The site pretends to be you, your business, or uses your mark.',
      severity: 'high',
    },
    {
      id: 'illegal',
      label: 'Other illegal content',
      hint: 'Content unlawful where it is published.',
      severity: 'high',
    },
    {
      id: 'spam',
      label: 'Spam or deceptive content',
      hint: 'Bulk junk, SEO doorways, or content unrelated to a real business.',
      severity: 'normal',
    },
    {
      id: 'other',
      label: 'Something else',
      hint: 'Anything that breaks the Acceptable Use Policy.',
      severity: 'normal',
    },
  ]

const CATEGORY_BY_ID = new Map(
  ABUSE_REPORT_CATEGORIES.map((entry) => [entry.id, entry]),
)

/** Look a category up, or `null` for an unrecognised id. */
export function abuseReportCategory(
  id: unknown,
): AbuseReportCategoryDefinition | null {
  return typeof id === 'string' ? (CATEGORY_BY_ID.get(id) ?? null) : null
}

/** The workflow states a report moves through. */
export const ABUSE_REPORT_STATUSES = [
  'open',
  'reviewing',
  'actioned',
  'dismissed',
] as const
export type AbuseReportStatus = (typeof ABUSE_REPORT_STATUSES)[number]

export function isAbuseReportStatus(value: unknown): value is AbuseReportStatus {
  return (
    typeof value === 'string' &&
    (ABUSE_REPORT_STATUSES as readonly string[]).includes(value)
  )
}

/** What a reporter submitted, after validation. */
export interface AbuseReportInput {
  category: string
  severity: AbuseReportSeverity
  /** The reported page, normalized to an absolute http(s) URL. */
  url: string
  /** Host id resolved from `url`, when it resolves to one. */
  reportedHostname: string
  details: string
  reporterEmail: string | null
  reporterName: string | null
  /** DMCA-only, all four required together. See {@link validateAbuseReport}. */
  dmca: AbuseReportDmcaAffirmations | null
}

/**
 * The statutory shape of a DMCA notice.
 *
 * 17 U.S.C. §512(c)(3) requires a takedown notice to carry, among other
 * things, an identification of the work, a good-faith statement, a statement
 * under penalty of perjury that the reporter is authorised, and a physical or
 * electronic signature. Collecting them as free text next to a tick-box is
 * the ordinary web form of that.
 *
 * Two consequences the form has to honour, and does:
 *
 *  - **A DMCA notice needs a real identity.** The other categories accept an
 *    anonymous report because a phishing site is phishing whoever reports it;
 *    a copyright claim is a legal assertion by a named party, so
 *    `reporterEmail` and `signature` are REQUIRED for `dmca` and optional for
 *    everything else. That is why the anonymity rule is per-category and not
 *    global.
 *  - **We must not pretend to adjudicate.** Nothing here decides whether the
 *    claim is good. It records what was asserted, under whose name, at what
 *    time, which is exactly what the safe harbour asks a service provider to
 *    keep.
 */
export interface AbuseReportDmcaAffirmations {
  /** Identification of the copyrighted work being infringed. */
  work: string
  /** Typed name standing as the electronic signature. */
  signature: string
  /** "I have a good faith belief the use is not authorised." */
  goodFaith: boolean
  /** "Under penalty of perjury, I am authorised to act for the owner." */
  underPenalty: boolean
}

export interface AbuseReportValidationFailure {
  ok: false
  /** Stable machine code, for tests and for the form to highlight a field. */
  code: string
  /** Sentence shown to the reporter. Never blames them for our shape. */
  message: string
}

export interface AbuseReportValidationSuccess {
  ok: true
  value: AbuseReportInput
}

export type AbuseReportValidation =
  | AbuseReportValidationSuccess
  | AbuseReportValidationFailure

const fail = (code: string, message: string): AbuseReportValidationFailure => ({
  ok: false,
  code,
  message,
})

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

/**
 * Is this a truthy checkbox value?
 *
 * A no-JavaScript HTML form sends `on` for a ticked box and sends the field
 * NOT AT ALL when unticked; a JSON client sends `true`. Both have to mean the
 * same thing or the statutory affirmations would depend on how the reporter's
 * browser is configured — and the failure would be silent, refusing valid
 * notices from the people least likely to have JS on.
 */
const checked = (value: unknown): boolean =>
  value === true ||
  value === 'on' ||
  value === 'true' ||
  value === '1' ||
  value === 'yes'

/**
 * Normalize a reported URL.
 *
 * Returns `null` for anything that is not an absolute http(s) URL. The scheme
 * allow-list is the point: a report is rendered in a staff console, and a
 * `javascript:` or `data:` "URL" stored here would be a stored-XSS delivery
 * mechanism aimed at the one browser session that can suspend any site on the
 * platform. Refusing at the boundary is cheaper than trusting every renderer.
 */
export function normalizeReportedUrl(value: unknown): string | null {
  const raw = text(value, ABUSE_REPORT_MAX_URL)
  if (!raw) return null
  // A reporter pasting a bare hostname is the common case; assume https
  // rather than refusing them for a missing scheme.
  const candidate = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(raw) ? raw : `https://${raw}`
  let parsed: URL
  try {
    parsed = new URL(candidate)
  } catch {
    return null
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
  if (!parsed.hostname) return null
  return parsed.toString().slice(0, ABUSE_REPORT_MAX_URL)
}

/** The hostname of a normalized URL, lowercased, or `''`. */
export function reportedHostname(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase()
  } catch {
    return ''
  }
}

/**
 * Validate and normalize a submitted report.
 *
 * Accepts the shape of BOTH a JSON body and a urlencoded no-JS form post, so
 * the caller can hand it either without a translation step.
 *
 * The bar for a valid report is deliberately low — a URL, a category and a
 * sentence — because every field added is a reporter lost, and the whole
 * point of AGL-1964 is that the report arrives at all. DMCA is the one
 * exception, and only because the statute sets the shape rather than us.
 */
export function validateAbuseReport(
  payload: Record<string, unknown>,
): AbuseReportValidation {
  const category = abuseReportCategory(payload['category'])
  if (!category) {
    return fail('category', 'Choose what kind of problem you are reporting.')
  }

  const url = normalizeReportedUrl(payload['url'])
  if (!url) {
    return fail(
      'url',
      'Enter the full web address of the page you are reporting, starting with https://.',
    )
  }

  const details = text(payload['details'], ABUSE_REPORT_MAX_DETAILS)
  if (details.length < 10) {
    return fail(
      'details',
      'Tell us briefly what is wrong with the page — at least a sentence.',
    )
  }

  const reporterEmail = text(payload['reporterEmail'], ABUSE_REPORT_MAX_CONTACT)
  const reporterName = text(payload['reporterName'], ABUSE_REPORT_MAX_CONTACT)
  // Shape only. Deliverability is not ours to assert, and a stricter pattern
  // would reject valid addresses to buy nothing.
  if (reporterEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(reporterEmail)) {
    return fail('reporterEmail', 'That email address does not look right.')
  }

  let dmca: AbuseReportDmcaAffirmations | null = null
  if (category.id === 'dmca') {
    const work = text(payload['dmcaWork'], ABUSE_REPORT_MAX_DETAILS)
    const signature = text(payload['dmcaSignature'], ABUSE_REPORT_MAX_CONTACT)
    if (!work) {
      return fail(
        'dmcaWork',
        'Identify the copyrighted work you say is being infringed.',
      )
    }
    if (!signature) {
      return fail(
        'dmcaSignature',
        'Type your full legal name — it stands as your electronic signature.',
      )
    }
    if (!checked(payload['dmcaGoodFaith'])) {
      return fail(
        'dmcaGoodFaith',
        'A copyright notice needs the good-faith statement.',
      )
    }
    if (!checked(payload['dmcaUnderPenalty'])) {
      return fail(
        'dmcaUnderPenalty',
        'A copyright notice needs the statement made under penalty of perjury.',
      )
    }
    // A DMCA notice is a legal assertion by a named party, so unlike every
    // other category it cannot be anonymous — we have to be able to forward
    // it to the site owner and to accept a counter-notice.
    if (!reporterEmail) {
      return fail(
        'reporterEmail',
        'A copyright notice needs an email address we can reply to.',
      )
    }
    dmca = {
      work,
      signature,
      goodFaith: true,
      underPenalty: true,
    }
  }

  return {
    ok: true,
    value: {
      category: category.id,
      severity: category.severity,
      url,
      reportedHostname: reportedHostname(url),
      details,
      reporterEmail: reporterEmail || null,
      reporterName: reporterName || null,
      dmca,
    },
  }
}

export default validateAbuseReport
