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
 * AGL-1964 intake validation.
 *
 * The load-bearing property of this suite is NOT that bad input is refused —
 * it is that GOOD input from an anonymous stranger is accepted. An abuse form
 * is itself an abuse target, so hardening it is right; hardening it until a
 * bank's fraud team cannot file is the failure this whole issue exists to
 * prevent, and it is the failure that looks like success in a test that only
 * checks the denies.
 */

import {
  ABUSE_REPORT_CATEGORIES,
  ABUSE_REPORT_CONTACT_EMAIL,
  ABUSE_REPORT_MAX_DETAILS,
  abuseReportCategory,
  type AbuseReportValidation,
  type AbuseReportValidationFailure,
  isAbuseReportStatus,
  normalizeReportedUrl,
  validateAbuseReport,
} from './abuse-report'

/**
 * Read the failure arm without leaning on the discriminant.
 *
 * `strictNullChecks` is OFF repo-wide, and with it off TypeScript does not
 * narrow a union by a boolean discriminant — after `if (result.ok) return`,
 * `result` is still the whole `AbuseReportValidation`, so `result.code` is a
 * compile error even though the branch has already proved which arm it is.
 * /api/report-abuse hit exactly this wall and casts for the same reason; this
 * does it in one place instead of at every assertion.
 *
 * The runtime `expect(result.ok).toBe(false)` above each call is what actually
 * proves the arm — this only satisfies the compiler.
 */
const failed = (result: AbuseReportValidation): AbuseReportValidationFailure =>
  result as AbuseReportValidationFailure

const phishing = {
  category: 'phishing',
  url: 'https://evil.aglyn.app/login',
  details: 'This page copies our bank login and posts credentials elsewhere.',
}

describe('validateAbuseReport', () => {
  it('accepts a fully anonymous report — the whole point of the intake', () => {
    const result = validateAbuseReport({ ...phishing })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.reporterEmail).toBeNull()
    expect(result.value.reporterName).toBeNull()
    expect(result.value.category).toBe('phishing')
    expect(result.value.severity).toBe('urgent')
    expect(result.value.reportedHostname).toBe('evil.aglyn.app')
  })

  it('accepts a bare hostname — a reporter is not a URL parser', () => {
    const result = validateAbuseReport({ ...phishing, url: 'evil.aglyn.app' })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.url).toBe('https://evil.aglyn.app/')
  })

  it('refuses a non-http scheme — a staff console renders this field', () => {
    // The stored URL is shown to the one browser session that can suspend any
    // site on the platform. `javascript:`/`data:` here would be a delivery
    // mechanism aimed straight at it.
    for (const url of [
      'javascript:alert(1)',
      'data:text/html,<script>alert(1)</script>',
      'file:///etc/passwd',
    ]) {
      expect(normalizeReportedUrl(url)).toBeNull()
      const result = validateAbuseReport({ ...phishing, url })
      expect(result.ok).toBe(false)
      if (result.ok) return
      expect(failed(result).code).toBe('url')
    }
  })

  it('refuses an unknown category rather than storing it', () => {
    const result = validateAbuseReport({ ...phishing, category: 'made-up' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(failed(result).code).toBe('category')
  })

  it('asks for a sentence, not a novel', () => {
    const short = validateAbuseReport({ ...phishing, details: 'bad' })
    expect(short.ok).toBe(false)
    // …and a novel is truncated rather than refused: a reporter who pasted a
    // whole email thread has still told us something true.
    const long = validateAbuseReport({
      ...phishing,
      details: 'x'.repeat(ABUSE_REPORT_MAX_DETAILS * 3),
    })
    expect(long.ok).toBe(true)
    if (!long.ok) return
    expect(long.value.details.length).toBe(ABUSE_REPORT_MAX_DETAILS)
  })

  it('takes an optional contact without demanding one', () => {
    const result = validateAbuseReport({
      ...phishing,
      reporterEmail: '  fraud@bank.example  ',
      reporterName: ' Fraud Desk ',
    })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.reporterEmail).toBe('fraud@bank.example')
    expect(result.value.reporterName).toBe('Fraud Desk')
  })

  it('refuses an email that is not shaped like one', () => {
    const result = validateAbuseReport({
      ...phishing,
      reporterEmail: 'not-an-address',
    })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(failed(result).code).toBe('reporterEmail')
  })
})

describe('the DMCA path carries its statutory shape', () => {
  const notice = {
    category: 'dmca',
    url: 'https://copycat.aglyn.app/gallery',
    details: 'Our photographs are republished here without a licence.',
    reporterEmail: 'legal@studio.example',
    dmcaWork: 'Photograph "Harbour at Dawn", registered VA 2-345-678.',
    dmcaSignature: 'Dana Reyes',
    dmcaGoodFaith: true,
    dmcaUnderPenalty: true,
  }

  it('accepts a complete notice', () => {
    const result = validateAbuseReport({ ...notice })
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.value.dmca).toEqual({
      work: 'Photograph "Harbour at Dawn", registered VA 2-345-678.',
      signature: 'Dana Reyes',
      goodFaith: true,
      underPenalty: true,
    })
  })

  it.each([
    ['dmcaWork', 'dmcaWork'],
    ['dmcaSignature', 'dmcaSignature'],
    ['dmcaGoodFaith', 'dmcaGoodFaith'],
    ['dmcaUnderPenalty', 'dmcaUnderPenalty'],
    ['reporterEmail', 'reporterEmail'],
  ])('refuses a notice missing %s', (field, code) => {
    const result = validateAbuseReport({ ...notice, [field]: '' })
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(failed(result).code).toBe(code)
  })

  it('reads a no-JavaScript checkbox the same as a JSON boolean', () => {
    // An unticked HTML checkbox is ABSENT, and a ticked one is the string
    // 'on'. If only `true` counted, every notice from a reporter without
    // JavaScript would be refused for a statement they had actually made —
    // and the people least likely to have JS on are exactly the ones filing
    // from a locked-down corporate or law-firm browser.
    const result = validateAbuseReport({
      ...notice,
      dmcaGoodFaith: 'on',
      dmcaUnderPenalty: 'on',
    })
    expect(result.ok).toBe(true)
  })

  it('does not demand the DMCA fields of any other category', () => {
    for (const category of ABUSE_REPORT_CATEGORIES) {
      if (category.id === 'dmca') continue
      const result = validateAbuseReport({
        category: category.id,
        url: 'https://site.aglyn.app/page',
        details: 'Something is wrong with this page and here is why.',
      })
      expect(result.ok).toBe(true)
      if (!result.ok) return
      expect(result.value.dmca).toBeNull()
    }
  })
})

describe('the category catalog', () => {
  it('has unique ids and resolves them', () => {
    const ids = ABUSE_REPORT_CATEGORIES.map((entry) => entry.id)
    expect(new Set(ids).size).toBe(ids.length)
    for (const id of ids) expect(abuseReportCategory(id)?.id).toBe(id)
    expect(abuseReportCategory('nope')).toBeNull()
    expect(abuseReportCategory(undefined)).toBeNull()
  })

  it('keeps the categories a stranger bears the cost of at urgent', () => {
    // These three are the ones where a slow response is paid for by someone
    // who is not our customer — and they are the ones whose unanswered report
    // becomes a domain-level block on *.aglyn.app.
    for (const id of ['phishing', 'csam', 'malware']) {
      expect(abuseReportCategory(id)?.severity).toBe('urgent')
    }
  })

  it('publishes a contact address that is not an unconfirmed mailbox', () => {
    // AGL-1973: `abuse@aglyn.com` is not confirmed to exist, and AGL-1577's
    // default routing would accept and silently discard mail to it. Until
    // that is settled this surface must not add a fourth place the address is
    // promised.
    expect(ABUSE_REPORT_CONTACT_EMAIL).toBe('support@aglyn.com')
  })

  it('recognises exactly the four workflow states', () => {
    for (const status of ['open', 'reviewing', 'actioned', 'dismissed']) {
      expect(isAbuseReportStatus(status)).toBe(true)
    }
    expect(isAbuseReportStatus('closed')).toBe(false)
    expect(isAbuseReportStatus(null)).toBe(false)
  })
})
