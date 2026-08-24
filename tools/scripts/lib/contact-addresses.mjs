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
 * Which `@aglyn.com` addresses are actually provisioned to RECEIVE (AGL-2400).
 *
 * The sibling of `libs/aglyn/.../published-legal-pages.ts`, for the same reason
 * and in the same shape: the repo keeps its own record of an external fact it
 * cannot fetch, because the alternative is prose in a table that nothing reads.
 *
 * ## The failure this exists to catch
 *
 * AGL-1577: a Google default routing rule ACCEPTS mail for a `@aglyn.com`
 * address that was never created, and suppresses the bounce. So publishing an
 * address we never provisioned is not a 404 anybody notices — it is a silent
 * hole that looks exactly like a working mailbox from the outside, including to
 * whoever published it. The sender gets no error, we get no mail, and the only
 * evidence is an absence.
 *
 * That makes "is this address real?" un-answerable by observation and
 * answerable only by configuration — which is a fact that lives in Workspace,
 * not here. So this file records it, and the guard asserts the corpus never
 * publishes an address the record does not contain.
 *
 * ## Why a list and not a probe
 *
 * Identical reasoning to `published-legal-pages.ts`. A check that hit Groups
 * would need an admin credential, would be offline-flaky, and — per
 * `docs/EMAIL_SETUP.md` — cannot use the obvious probe anyway: the Groups "All
 * groups" listing is not a complete enumeration (`abuse@` is absent from it
 * while demonstrably existing), so only a per-address authenticated fetch is
 * conclusive. A list is checkable with no credential and is wrong in exactly
 * one direction: it can only go stale by claiming an address exists, which is
 * the mistake the reviewer of the edit that adds one is looking straight at.
 *
 * ## Provenance
 *
 * `STATUTORY_INTAKE_ADDRESSES` were verified from Workspace configuration on
 * **2026-08-19** (AGL-1911): each is a real Group, `Who can post` = *Anyone on
 * the web*, unmoderated, delivering to a single member.
 *
 * `OTHER_PROVISIONED_ADDRESSES` are recorded by `docs/EMAIL_SETUP.md` as "also
 * live as groups" and carry NO such verification date. They are trusted here
 * because publishing them is already done and the guard's job is to catch the
 * NEXT one, not to re-litigate these — but see `UNVERIFIED_PROVISIONING` below,
 * which is the honest half of that and is what the guard reports.
 */

/**
 * The six addresses named in a published legal document as the route for a
 * statutory or contractual process. These are the auto-reply targets.
 *
 * Verified as Groups 2026-08-19 (AGL-1911).
 */
export const STATUTORY_INTAKE_ADDRESSES = Object.freeze([
  'abuse@aglyn.com',
  'dmca@aglyn.com',
  'legal@aglyn.com',
  'privacy@aglyn.com',
  'security@aglyn.com',
  'support@aglyn.com',
])

/**
 * Provisioned, but not named in a legal document as a statutory route.
 *
 * Recorded by `docs/EMAIL_SETUP.md` ("Also live as groups"). `help@` and
 * `info@` are in this list and ARE published to the public — see
 * `UNVERIFIED_PROVISIONING`.
 */
export const OTHER_PROVISIONED_ADDRESSES = Object.freeze([
  'accounting@aglyn.com',
  'admin@aglyn.com',
  'billing@aglyn.com',
  'copyright@aglyn.com',
  'hello@aglyn.com',
  'help@aglyn.com',
  'info@aglyn.com',
  'sales@aglyn.com',
  'talent@aglyn.com',
  'webmaster@aglyn.com',
])

/** Every address provisioned to receive, statutory or not. */
export const PROVISIONED_CONTACT_ADDRESSES = Object.freeze(
  [...STATUTORY_INTAKE_ADDRESSES, ...OTHER_PROVISIONED_ADDRESSES].sort(),
)

/**
 * Outbound only. Resend sends AS these; nothing routes mail TO them, and a
 * document that offers one as a contact point is the defect, not an exception.
 */
export const PLATFORM_SENDER_ADDRESSES = Object.freeze(['noreply@aglyn.com'])

/**
 * Local-parts that are not an intake and must not be read as one.
 *
 * `zach` is the delivery target every group forwards to — it appears all over
 * the runbooks as the ANSWER to "where does this land", never as a published
 * contact. `you` is a documentation placeholder. `GoogleDrive-zach` is not an
 * address at all: it is a path segment of the macOS CloudStorage mount
 * (`/Users/…/CloudStorage/GoogleDrive-zach@aglyn.com/…`) that appears in
 * scripts which read the shared drive.
 */
export const NON_INTAKE_LOCALPARTS = Object.freeze([
  'GoogleDrive-zach',
  'you',
  'zach',
  'zachary.gover',
])

/**
 * Addresses that are PUBLISHED to the public but whose provisioning has never
 * been verified the way the six were, and which no auto-reply plan covers.
 *
 * This is data, not a suppression: the guard prints it on every run. Each entry
 * names where the address is published and what makes it load-bearing.
 *
 * Measured from the live site on 2026-08-24.
 */
export const UNVERIFIED_PROVISIONING = Object.freeze([
  {
    address: 'help@aglyn.com',
    publishedAt: 'docs.aglyn.com/trust — "Reporting a vulnerability"',
    why: 'Published as the fallback WHEN security@ BOUNCES. Under AGL-1577 a '
      + 'wrong address here does not bounce either, so the documented '
      + 'escalation path for a vulnerability report cannot fail loudly.',
  },
  {
    address: 'info@aglyn.com',
    publishedAt: '/legal, /legal/privacy, /legal/marketplace-publisher-agreement',
    why: 'The legal index routes "everything else" here, so it is the default '
      + 'contact on three legal pages, including a clickwrapped agreement.',
  },
  {
    address: 'hello@aglyn.com',
    publishedAt: '/contact — "General: anything else — we read every message"',
    why: '"We read every message" is a published commitment. EMAIL_SETUP and '
      + 'libs/plugins/email/src/lib/server.ts both still describe a monitored '
      + 'hello@ as an UNSTARTED IDEA.',
  },
  {
    address: 'sales@aglyn.com',
    publishedAt: '/contact — "Talk to sales"',
    why: 'No legal clock, but a published intake outside the six.',
  },
])

/** `local@aglyn.com`, case-insensitive on the domain. */
const ADDRESS_RE = /[A-Za-z0-9._%+-]+@aglyn\.com/g

/** The local-part of `addr`, lowercased for comparison. */
export function localPartOf(addr) {
  return String(addr).split('@')[0]
}

/** Every distinct `@aglyn.com` address in `text`, in first-seen order. */
export function extractAglynAddresses(text) {
  if (typeof text !== 'string' || !text) return []
  const seen = new Set()
  const out = []
  for (const m of text.match(ADDRESS_RE) || []) {
    const a = m.toLowerCase()
    if (!seen.has(a)) {
      seen.add(a)
      out.push(m)
    }
  }
  return out
}

/**
 * Whether `addr` is provisioned to receive mail.
 *
 * A sender address is NOT provisioned to receive — `noreply@` answers false on
 * purpose, because offering it as a contact point is the bug.
 */
export function isProvisionedContactAddress(addr) {
  if (typeof addr !== 'string' || !addr.trim()) return false
  return PROVISIONED_CONTACT_ADDRESSES.includes(addr.trim().toLowerCase())
}

/** Whether `addr` is exempt from the guard because it is not an intake. */
export function isNonIntakeAddress(addr) {
  if (typeof addr !== 'string' || !addr.trim()) return false
  const local = localPartOf(addr.trim())
  if (NON_INTAKE_LOCALPARTS.includes(local)) return true
  // `zach+e2e-smoke@` and friends: a plus-tag on a non-intake local-part.
  const base = local.split('+')[0]
  return NON_INTAKE_LOCALPARTS.includes(base)
}

/**
 * Scan `files` for `@aglyn.com` addresses that are neither provisioned to
 * receive, nor a known sender, nor an exempt non-intake local-part.
 *
 * `files` is `[{ path, text }]`. Returns `[{ path, address, line }]`, sorted by
 * path then line, so the output is stable across runs and reviewable as a diff.
 *
 * Pure: no fs, no network. The walking lives in the check script.
 */
export function findUnprovisionedAddresses(files) {
  const findings = []
  for (const file of files || []) {
    const path = file && file.path
    const text = file && file.text
    if (typeof path !== 'string' || typeof text !== 'string') continue
    const lines = text.split('\n')
    for (let i = 0; i < lines.length; i++) {
      for (const addr of extractAglynAddresses(lines[i])) {
        const lower = addr.toLowerCase()
        if (isProvisionedContactAddress(lower)) continue
        if (PLATFORM_SENDER_ADDRESSES.includes(lower)) continue
        if (isNonIntakeAddress(addr)) continue
        findings.push({ path, address: addr, line: i + 1 })
      }
    }
  }
  findings.sort((a, b) => a.path.localeCompare(b.path) || a.line - b.line)
  return findings
}
