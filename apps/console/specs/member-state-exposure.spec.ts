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
 * AGL-2008 — which Member States are the affected data subjects in?
 *
 * Every per-authority filing in `docs/BREACH_NOTIFICATION.md` §4 starts with
 * that question, there is no one-stop-shop to absorb a wrong answer (no EU
 * establishment, EDPB Guidelines 9/2022 §73), and the clock is 72 hours. The
 * URLs in the runbook are decoration until it is answerable.
 *
 * The bar this file holds is the one the issue set: **a guess presented as a
 * count is worse than "we cannot say".** So nothing here returns a bare
 * number. Every bucket carries the PROVENANCE it was built from, `unknown` is
 * a first-class output that can never be silently dropped, and a bucket whose
 * only evidence is an IP-derived sign-in location says so — because that is a
 * record of where somebody WAS, not where they reside.
 *
 * No new collection. Every signal read here is already held for another,
 * stated purpose.
 */

import {
  deviceLocationCountry,
  memberStateExposure,
  resolveSubjectCountry,
  supervisoryAuthorityFor,
} from '../utils/server/member-state-exposure'

describe('deviceLocationCountry', () => {
  it('takes the country off a "City, Region, Country" sign-in location', () => {
    // The shape `describeSignInClient` writes to users/{uid}/devices.
    expect(deviceLocationCountry('Dublin, Leinster, IE')).toBe('IE')
  })

  it('handles a location with no city or region', () => {
    expect(deviceLocationCountry('DE')).toBe('DE')
    expect(deviceLocationCountry('Berlin, DE')).toBe('DE')
  })

  it('refuses anything that is not an ISO alpha-2 code', () => {
    // A country NAME in the last position is a different record shape and
    // must not be guessed at.
    expect(deviceLocationCountry('Dublin, Leinster, Ireland')).toBeNull()
    expect(deviceLocationCountry('')).toBeNull()
    expect(deviceLocationCountry(null)).toBeNull()
    expect(deviceLocationCountry('Unknown')).toBeNull()
  })

  it('normalises case and whitespace', () => {
    expect(deviceLocationCountry('  Paris ,  IDF , fr ')).toBe('FR')
  })
})

describe('supervisoryAuthorityFor', () => {
  it('names the authority for a Member State', () => {
    expect(supervisoryAuthorityFor('IE')?.authority).toContain('Data Protection Commission')
    expect(supervisoryAuthorityFor('DE')?.memberState).toBe('Germany')
  })

  it('routes the UK to the ICO, not to an EU authority', () => {
    // UK GDPR is a separate filing with a separate regulator.
    const uk = supervisoryAuthorityFor('GB')
    expect(uk?.authority).toContain('Information Commissioner')
    expect(uk?.regime).toBe('uk-gdpr')
  })

  it('routes an EU outermost region to its parent Member State', () => {
    // Réunion and Martinique are legally France; a filing goes to the CNIL,
    // not to a regulator that does not exist.
    expect(supervisoryAuthorityFor('RE')?.memberState).toBe('France')
    expect(supervisoryAuthorityFor('MQ')?.memberState).toBe('France')
    // Åland is Finland.
    expect(supervisoryAuthorityFor('AX')?.memberState).toBe('Finland')
    // Gibraltar sits under the UK regime.
    expect(supervisoryAuthorityFor('GI')?.regime).toBe('uk-gdpr')
  })

  it('covers the EEA EFTA states, which have their own authorities', () => {
    for (const code of ['IS', 'LI', 'NO']) {
      expect(supervisoryAuthorityFor(code)?.regime).toBe('eu-gdpr')
    }
  })

  it('returns null outside the EEA and UK', () => {
    expect(supervisoryAuthorityFor('US')).toBeNull()
    expect(supervisoryAuthorityFor('CH')).toBeNull()
    expect(supervisoryAuthorityFor('ZZ')).toBeNull()
  })

  it('carries a filing URL for every entry it has', () => {
    // A runbook step that says "file with the DPC" and no URL costs an hour
    // of the 72 finding one.
    for (const code of ['IE', 'DE', 'FR', 'GB', 'NO']) {
      expect(supervisoryAuthorityFor(code)?.url).toMatch(/^https:\/\//)
    }
  })
})

describe('resolveSubjectCountry — best available, and it says which', () => {
  it('prefers a DECLARED org country over everything else', () => {
    expect(
      resolveSubjectCountry({
        declaredCountry: 'IE',
        billingCountry: 'US',
        signInCountries: ['FR'],
      }),
    ).toEqual({ country: 'IE', provenance: 'declared' })
  })

  it('falls back to the Stripe billing country', () => {
    expect(
      resolveSubjectCountry({ billingCountry: 'DE', signInCountries: ['FR'] }),
    ).toEqual({ country: 'DE', provenance: 'billing' })
  })

  it('falls back to a sign-in country last, and labels it inferred', () => {
    expect(resolveSubjectCountry({ signInCountries: ['FR'] })).toEqual({
      country: 'FR',
      provenance: 'sign-in-ip',
    })
  })

  it('says UNKNOWN rather than guessing when there is nothing', () => {
    expect(resolveSubjectCountry({})).toEqual({
      country: null,
      provenance: 'unknown',
    })
    expect(resolveSubjectCountry({ signInCountries: [] })).toEqual({
      country: null,
      provenance: 'unknown',
    })
  })

  it('refuses to pick when sign-in countries DISAGREE', () => {
    // Somebody who signed in from IE and FR is not evidence for either. A
    // travelling or VPN-using user is exactly where an inferred country
    // produces a confident wrong filing, so this degrades to ambiguous
    // rather than taking the first or the most recent.
    expect(
      resolveSubjectCountry({ signInCountries: ['IE', 'FR'] }),
    ).toEqual({ country: null, provenance: 'ambiguous', candidates: ['FR', 'IE'] })
  })

  it('is not confused by repeats of the same sign-in country', () => {
    expect(
      resolveSubjectCountry({ signInCountries: ['IE', 'IE', 'ie'] }),
    ).toEqual({ country: 'IE', provenance: 'sign-in-ip' })
  })

  it('ignores a malformed declared or billing country', () => {
    expect(
      resolveSubjectCountry({ declaredCountry: 'Ireland', billingCountry: 'DE' }),
    ).toEqual({ country: 'DE', provenance: 'billing' })
  })

  // AGL-2008 — a uid in several orgs. Not an edge case: an agency sits in
  // 50+ workspaces (AGL-2336) and a contractor is added to ten client
  // workspaces owning none of them. The route used to keep ONE org per uid,
  // first-wins, from inside a `Promise.all` — so the answer depended on which
  // Firestore read returned first.
  it('refuses to pick when two orgs BILL to different countries', () => {
    expect(
      resolveSubjectCountry({ billingCountries: ['IE', 'US'] }),
    ).toEqual({ country: null, provenance: 'ambiguous', candidates: ['IE', 'US'] })
  })

  it('refuses to pick when two orgs DECLARE different countries', () => {
    expect(
      resolveSubjectCountry({ declaredCountries: ['FR', 'DE'] }),
    ).toEqual({ country: null, provenance: 'ambiguous', candidates: ['DE', 'FR'] })
  })

  it('accepts several orgs that agree, and does not call that ambiguous', () => {
    expect(
      resolveSubjectCountry({ billingCountries: ['IE', 'ie', 'IE'] }),
    ).toEqual({ country: 'IE', provenance: 'billing' })
  })

  it('does not let disagreeing orgs fall THROUGH to the sign-in country', () => {
    // The dangerous shape: refusing at the billing tier must not quietly
    // promote the weakest signal into an answer the stronger tier declined
    // to give. A contractor billed by a US and an IE client is ambiguous,
    // not "German because they were in Berlin once".
    expect(
      resolveSubjectCountry({
        billingCountries: ['US', 'IE'],
        signInCountries: ['DE'],
      }),
    ).toEqual({ country: null, provenance: 'ambiguous', candidates: ['IE', 'US'] })
  })

  it('still lets a single org outrank the sign-in country', () => {
    expect(
      resolveSubjectCountry({
        billingCountries: ['IE'],
        signInCountries: ['DE'],
      }),
    ).toEqual({ country: 'IE', provenance: 'billing' })
  })

  it('keeps a multi-org person OUT of a filing rather than in a wrong one', () => {
    const report = memberStateExposure([
      { id: 'contractor', billingCountries: ['US', 'IE'], signInCountries: ['DE'] },
      { id: 'owner', billingCountries: ['IE'] },
    ])
    expect(report.ambiguous).toBe(1)
    expect(report.filings).toHaveLength(1)
    expect(report.filings[0]).toMatchObject({ country: 'IE', subjects: 1 })
    // The invariant still holds with the new outcome in play.
    expect(
      report.filings.reduce((n, f) => n + f.subjects, 0) +
        report.ambiguous +
        report.unknown +
        report.outsideScope,
    ).toBe(report.totalSubjects)
  })
})

describe('memberStateExposure', () => {
  const subjects = [
    { id: 'u1', declaredCountry: 'IE' },
    { id: 'u2', billingCountry: 'IE' },
    { id: 'u3', signInCountries: ['DE'] },
    { id: 'u4', signInCountries: ['US'] },
    { id: 'u5', billingCountry: 'GB' },
    { id: 'u6' },
    { id: 'u7', signInCountries: ['IE', 'FR'] },
  ]

  it('buckets by Member State and keeps the provenance of each', () => {
    const report = memberStateExposure(subjects)
    const ie = report.filings.find((f) => f.country === 'IE')
    expect(ie?.subjects).toBe(2)
    expect(ie?.byProvenance).toEqual({ declared: 1, billing: 1, 'sign-in-ip': 0 })
    expect(ie?.memberState).toBe('Ireland')
  })

  it('never reports a count without provenance', () => {
    // The honesty bar. Every filing bucket must be able to say what it is
    // built from, so a reader can weigh a declared country against a
    // guessed one instead of seeing one number.
    for (const filing of memberStateExposure(subjects).filings) {
      expect(filing.byProvenance).toBeDefined()
      const summed =
        filing.byProvenance.declared +
        filing.byProvenance.billing +
        filing.byProvenance['sign-in-ip']
      expect(summed).toBe(filing.subjects)
    }
  })

  it('flags a bucket whose evidence is ONLY inferred', () => {
    // Germany here is one person, known only from a sign-in IP. Filing with
    // the BfDI on that basis is a decision somebody should make knowingly.
    const de = memberStateExposure(subjects).filings.find((f) => f.country === 'DE')
    expect(de?.inferredOnly).toBe(true)
    const ie = memberStateExposure(subjects).filings.find((f) => f.country === 'IE')
    expect(ie?.inferredOnly).toBe(false)
  })

  it('separates the UK filing from the EU ones', () => {
    const report = memberStateExposure(subjects)
    expect(report.filings.find((f) => f.country === 'GB')?.regime).toBe('uk-gdpr')
    expect(report.euFilingCount).toBe(2)
    expect(report.ukFilingCount).toBe(1)
  })

  it('counts the unattributable rather than dropping them', () => {
    // u4 is outside the EEA, u6 has nothing, u7 is ambiguous. None of them
    // may quietly vanish: the runbook needs to know how much of the
    // population the buckets do NOT account for.
    const report = memberStateExposure(subjects)
    expect(report.unknown).toBe(1)
    expect(report.ambiguous).toBe(1)
    expect(report.outsideScope).toBe(1)
    expect(
      report.filings.reduce((n, f) => n + f.subjects, 0) +
        report.unknown +
        report.ambiguous +
        report.outsideScope,
    ).toBe(subjects.length)
  })

  it('sorts the filings by size so the biggest obligation is first', () => {
    const report = memberStateExposure([
      ...subjects,
      { id: 'u8', declaredCountry: 'DE' },
      { id: 'u9', declaredCountry: 'DE' },
    ])
    expect(report.filings[0].country).toBe('DE')
  })

  it('reports an empty population honestly', () => {
    const report = memberStateExposure([])
    expect(report.filings).toEqual([])
    expect(report.unknown).toBe(0)
    expect(report.coverage).toBe(0)
  })

  it('states what fraction of the population it could attribute at all', () => {
    // 4 of 7 land in a filing bucket (u1, u2, u3, u5).
    expect(memberStateExposure(subjects).coverage).toBeCloseTo(4 / 7, 5)
  })
})
