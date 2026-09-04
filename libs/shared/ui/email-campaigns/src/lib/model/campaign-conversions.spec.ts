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

import {
  CAMPAIGN_CONVERSION_KINDS,
  campaignConversionId,
  campaignConversionsCoverage,
  campaignConversionsReport,
  campaignTouchLabel,
  type CampaignConversionsReport,
} from './campaign-conversions'

/**
 * The reader half of the identify-moment join, and mostly the ONE rule it
 * exists to hold: the four kinds are never added together.
 *
 * That rule is asserted structurally rather than by reading the code — a walk
 * over the report looking for any number equal to the sum. A future field
 * called `total`, `all` or `conversions` fails it whatever it is named, which
 * is the point: the assertion is about the report's shape, not about a
 * spelling somebody has to remember.
 */
describe('campaignConversionsReport', () => {
  const rollup = { byKind: { form: 3, lead: 2, contact: 5, booking: 1 } }

  it('reports every kind, in one order, with no total anywhere', () => {
    const report = campaignConversionsReport({ rollup })
    expect(report.kinds.map((entry) => entry.kind)).toEqual([
      'form',
      'lead',
      'contact',
      'booking',
    ])
    expect(report.kinds.map((entry) => entry.value)).toEqual([3, 2, 5, 1])
  })

  /**
   * THE ADDITION IS NOT AVAILABLE — the assertion this module exists for.
   *
   * The counts are chosen so the sum (11) collides with nothing else the
   * report holds: not a kind's value, not `windowDays` (7), not the kind
   * count (4). So any number equal to 11 anywhere on the report is a total
   * that somebody added.
   */
  it('exposes no field, at any depth, holding the sum of the kinds', () => {
    const report = campaignConversionsReport({ rollup })
    const sum = 3 + 2 + 5 + 1
    const found: string[] = []
    const walk = (node: unknown, path: string) => {
      if (typeof node === 'number') {
        if (node === sum) found.push(path)
        return
      }
      if (Array.isArray(node)) {
        node.forEach((item, index) => walk(item, `${path}[${index}]`))
        return
      }
      if (node && typeof node === 'object') {
        Object.entries(node).forEach(([key, value]) =>
          walk(value, `${path}.${key}`),
        )
      }
    }
    walk(report, 'report')
    expect(found).toEqual([])
  })

  /**
   * And the module offers nothing that WOULD add them. A helper that reduced
   * the kinds is the same failure arriving through a different door, so the
   * export surface is asserted rather than only the report's shape.
   */
  it('exports no reducer over the kinds', () => {
    // Named anything but `module`, which is a Next-reserved identifier: the
    // bundler rewrites assignments to it, so a binding by that name is a lint
    // error rather than a style note.
    const exported = require('./campaign-conversions')
    const suspicious = Object.keys(exported).filter((name) =>
      /total|sum|all|combined/i.test(name),
    )
    expect(suspicious).toEqual([])
  })

  it('says why the kinds stand apart, so a missing total reads as deliberate', () => {
    const report = campaignConversionsReport({ rollup })
    expect(report.caveats.map((caveat) => caveat.id)).toContain(
      'conversions-kinds-overlap',
    )
  })

  it('says the rollup covers campaign emails only, never the web labels', () => {
    const report = campaignConversionsReport({ rollup })
    expect(report.caveats.map((caveat) => caveat.id)).toContain(
      'conversions-web-not-rolled-up',
    )
  })

  /**
   * A kind with no entry draws a dash, not a zero. A site with no booking
   * form has never written a booking conversion, and a measured zero invites
   * the reader to conclude the campaign failed at something it never tried.
   */
  it('reads a kind the rollup does not mention as unrecorded, not as zero', () => {
    const report = campaignConversionsReport({ rollup: { byKind: { form: 4 } } })
    const byKind = new Map(report.kinds.map((entry) => [entry.kind, entry]))
    expect(byKind.get('form')?.value).toBe(4)
    expect(byKind.get('booking')?.value).toBeNull()
    expect(byKind.get('lead')?.value).toBeNull()
  })

  it('distinguishes an absent rollup from one that recorded nothing', () => {
    expect(campaignConversionsReport({ rollup: undefined }).recorded).toBe(false)
    expect(campaignConversionsReport({ rollup: {} }).recorded).toBe(true)
  })

  it('raises no caveat when there is no figure to qualify', () => {
    const report = campaignConversionsReport({ rollup: undefined })
    expect(report.any).toBe(false)
    expect(report.caveats).toEqual([])
  })

  it('prints the window the records were credited under, not today’s', () => {
    const report = campaignConversionsReport({
      rollup: { byKind: { form: 1 }, model: 'first-click', windowDays: 30 },
    })
    expect(report.model).toBe('first-click')
    expect(report.windowDays).toBe(30)
  })

  it('falls back to the platform rule when the record carries none', () => {
    const report = campaignConversionsReport({ rollup: { byKind: { form: 1 } } })
    expect(report.model).toBe('last-click')
    expect(report.windowDays).toBe(7)
  })

  it('reads a negative or non-numeric stored count as unrecorded', () => {
    const report = campaignConversionsReport({
      rollup: { byKind: { form: -4, lead: Number.NaN as number } },
    })
    const byKind = new Map(report.kinds.map((entry) => [entry.kind, entry]))
    expect(byKind.get('form')?.value).toBeNull()
    expect(byKind.get('lead')?.value).toBeNull()
  })
})

/**
 * THE UNCREDITED HALF. A screen showing only attribution records renders
 * "we credited four of these" as "four of these happened".
 */
describe('campaignConversionsCoverage', () => {
  it('counts what was not credited, and never as a negative', () => {
    const coverage = campaignConversionsCoverage({
      kind: 'form',
      attributed: 12,
      total: 90,
    })
    expect(coverage?.attributed).toBe(12)
    expect(coverage?.total).toBe(90)
    expect(coverage?.unattributed).toBe(78)
  })

  /**
   * The two counts come from two collections a moment apart, so a conversion
   * landing between them makes `attributed` briefly exceed `total`.
   */
  it('clamps at zero when the two counts were taken a moment apart', () => {
    const coverage = campaignConversionsCoverage({
      kind: 'lead',
      attributed: 5,
      total: 4,
    })
    expect(coverage?.unattributed).toBe(0)
  })

  /**
   * THE FLATTERING WRONG ANSWER. Defaulting an uncountable total to the
   * attributed figure renders every conversion as attributed; withholding the
   * split says nothing rather than something false.
   */
  it('withholds the split entirely when the total could not be counted', () => {
    expect(
      campaignConversionsCoverage({ kind: 'form', attributed: 12, total: null }),
    ).toBeNull()
    expect(
      campaignConversionsCoverage({
        kind: 'form',
        attributed: null,
        total: 90,
      }),
    ).toBeNull()
  })

  it('presents the uncredited figure as a ceiling, never as a count of direct arrivals', () => {
    const coverage = campaignConversionsCoverage({
      kind: 'form',
      attributed: 12,
      total: 90,
    })
    expect(coverage?.exact).toBe(false)
    expect(coverage?.caveats.map((caveat) => caveat.id)).toContain(
      'conversions-unattributed-is-a-ceiling',
    )
  })

  it('says so when the total is counted over the whole org rather than one site', () => {
    const scoped = campaignConversionsCoverage({
      kind: 'contact',
      attributed: 2,
      total: 40,
      crossHostTotal: true,
    })
    expect(scoped?.caveats.map((caveat) => caveat.id)).toContain(
      'conversions-total-crosses-hosts',
    )
    const hostScoped = campaignConversionsCoverage({
      kind: 'form',
      attributed: 2,
      total: 40,
    })
    expect(hostScoped?.caveats.map((caveat) => caveat.id)).not.toContain(
      'conversions-total-crosses-hosts',
    )
  })

  it('counts zero attributed conversions as a real zero, not as unknown', () => {
    const coverage = campaignConversionsCoverage({
      kind: 'booking',
      attributed: 0,
      total: 31,
    })
    expect(coverage).not.toBeNull()
    expect(coverage?.unattributed).toBe(31)
  })
})

/**
 * The id scheme, which a keyed read on a record's own page depends on
 * entirely: a wrong id is a document that does not exist, and a document that
 * does not exist renders as "not attributed" for every record on the screen.
 */
describe('campaignConversionId', () => {
  it('builds the writer’s id', () => {
    expect(campaignConversionId('form', 'abc123')).toBe('form:abc123')
  })

  it('refuses a missing half rather than naming a document that cannot exist', () => {
    expect(campaignConversionId('form', '')).toBeNull()
    expect(campaignConversionId('form', undefined)).toBeNull()
    expect(campaignConversionId('', 'abc123')).toBeNull()
    expect(campaignConversionId(undefined, 'abc123')).toBeNull()
  })

  it('refuses a kind the writer never stamps', () => {
    expect(campaignConversionId('order', 'abc123')).toBeNull()
    expect(campaignConversionId('Form', 'abc123')).toBeNull()
  })

  it('refuses a ref that would leave the collection or split the pair', () => {
    expect(campaignConversionId('form', 'a/b')).toBeNull()
    expect(campaignConversionId('form', 'a:b')).toBeNull()
  })

  it('covers every kind the reader knows about', () => {
    CAMPAIGN_CONVERSION_KINDS.forEach((kind) => {
      expect(campaignConversionId(kind, 'ref')).toBe(`${kind}:ref`)
    })
  })
})

/**
 * What a record names. The email channel names a document and can be linked;
 * the web channel names text a marketer typed and never can.
 */
describe('campaignTouchLabel', () => {
  it('names the campaign document for an email touch', () => {
    expect(
      campaignTouchLabel({ channel: 'email', campaignId: 'camp_9' }),
    ).toBe('camp_9')
  })

  it('joins the utm triple a marketer set', () => {
    expect(
      campaignTouchLabel({
        channel: 'web',
        source: 'google',
        medium: 'cpc',
        campaign: 'spring',
      }),
    ).toBe('google / cpc / spring')
  })

  /**
   * A placeholder for an absent part invites the reader to go looking for a
   * campaign called "(none)".
   */
  it('leaves an absent part out rather than filling it', () => {
    expect(campaignTouchLabel({ channel: 'web', source: 'google', medium: 'cpc' })).toBe(
      'google / cpc',
    )
    expect(campaignTouchLabel({ channel: 'web', source: 'google' })).toBe('google')
  })

  it('answers empty for a record it cannot read, rather than throwing', () => {
    expect(campaignTouchLabel(null)).toBe('')
    expect(campaignTouchLabel(undefined)).toBe('')
    expect(campaignTouchLabel({ channel: 'web' })).toBe('')
    expect(campaignTouchLabel({ channel: 'email' })).toBe('')
  })
})

/**
 * A type-level restatement of the structural assertion above: the report has
 * no total, and adding one has to break this file rather than pass silently.
 */
describe('the report’s shape', () => {
  it('holds exactly the fields a screen may read', () => {
    const report: CampaignConversionsReport = campaignConversionsReport({
      rollup: { byKind: { form: 1 } },
    })
    expect(Object.keys(report).sort()).toEqual([
      'any',
      'caveats',
      'kinds',
      'model',
      'recorded',
      'windowDays',
    ])
  })
})
