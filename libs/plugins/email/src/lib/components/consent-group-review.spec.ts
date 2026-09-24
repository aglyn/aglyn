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
 * What the admin is told before a consent group change (AGL-3320), written
 * from the route's preview: what signup forms will say, who stops getting
 * mail, who can still be mailed, what happens to the CRM's records — each
 * with the number the preview counted, and without one where it counted
 * none. The primary button is named for what it does.
 */

import type { ConsentGroupChangePreview } from './consent-groups-api'
import {
  describeConsentGroupDraft,
  listConsentGroups,
  type ConsentGroupDraft,
} from './consent-group-editing'
import {
  describeConsentGroupReview,
  joinNames,
  type ConsentGroupReview,
} from './consent-group-review'

const ORG = {
  consentGroups: {
    g_home: { name: 'Home goods', hostIds: ['shop', 'blog', 'deals'] },
    g_acme: { name: 'Acme', hostIds: ['acme-a', 'acme-b'] },
  },
}
const CURRENT = listConsentGroups(ORG)
const NAMES: Record<string, string> = {
  shop: 'Shop',
  blog: 'Blog',
  deals: 'Deals',
  camp: 'Camp',
  'acme-a': 'Acme East',
  'acme-b': 'Acme West',
}
const siteName = (hostId: string) => NAMES[hostId] ?? hostId

function preview(patch: Partial<ConsentGroupChangePreview> = {}): ConsentGroupChangePreview {
  return {
    before: {},
    after: {},
    discarded: [],
    lines: [],
    disclosures: [],
    carries: [],
    inherited: [],
    pendingHolds: [],
    partialAccessMembers: 0,
    forwardPolicyWarning: null,
    participants: [],
    capturesDisclosing: ['form'],
    estimate: 'minutes',
    ...patch,
  }
}

function review(
  draft: Partial<ConsentGroupDraft>,
  answer: ConsentGroupChangePreview | null = preview(),
  awaitsConfirmation = false,
): ConsentGroupReview {
  return describeConsentGroupReview({
    change: describeConsentGroupDraft(CURRENT, {
      mode: 'create',
      groupId: null,
      name: '',
      hostIds: [],
      ...draft,
    }),
    preview: answer,
    siteName,
    awaitsConfirmation,
  })
}

/** Every sentence, in order, for asserting on the copy. */
const text = (result: ConsentGroupReview) =>
  result.sections.flatMap((section) => section.items.map((item) => item.text))

const CRM = (lines: Array<{ id: string; count: number | null }>) => ({
  pluginId: 'crm',
  lines: lines.map((line) => ({ ...line, text: `${line.id} said`, severity: 'info' as const })),
})

describe('names', () => {
  it('joins site names the way a sentence does', () => {
    expect(joinNames(['A'])).toBe('A')
    expect(joinNames(['A', 'B'])).toBe('A and B')
    expect(joinNames(['A', 'B', 'C'])).toBe('A, B, and C')
  })
})

describe('creating a group', () => {
  const result = review(
    { name: 'Outdoors', hostIds: ['camp', 'shop'] },
    preview({
      inherited: [
        { hostId: 'camp', refusals: 3 },
        { hostId: 'shop', refusals: 9 },
      ],
      partialAccessMembers: 2,
      participants: [CRM([{ id: 'crm.combine', count: 41 }])],
    }),
  )
  const said = text(result)

  it('is titled and labeled for what it does', () => {
    expect(result.title).toBe('Create “Outdoors”')
    expect(result.confirmLabel).toBe('Create group')
  })

  it('quotes what signup forms will say', () => {
    expect(said).toContain(
      'Signup forms on these sites will say: “You\'ll receive marketing email from Outdoors, which covers 2 sites.”',
    )
  })

  it('says consent given before is not shared', () => {
    expect(said).toContain(
      'People who signed up before now agreed to hear from one site. They are not shared; only people who sign up after this change, on a form that shows this name, are.',
    )
  })

  it('counts the opt-outs that start applying across the group', () => {
    expect(said).toContain(
      'Anyone who unsubscribed from, opted out on, or declined email from any of these sites will stop getting marketing email from all of them (12 opt-outs on record).',
    )
  })

  it('says whose record wins, and how many people are combined', () => {
    expect(said.find((line) => line.startsWith('The CRM records'))).toBe(
      'The CRM records these sites keep about the same person will be combined into one record, visible to everyone who works on any of these sites. Where two records disagree about one value, such as the owner or stage, the record from the site that met the person first is kept. This combines records for 41 people.',
    )
  })

  it('names the members who keep seeing only some of the sites', () => {
    expect(said).toContain(
      '2 team members can open only some of these sites. They’ll keep seeing only those sites’ records.',
    )
  })

  it('says the other capture surfaces record one site', () => {
    expect(said).toContain(
      'Only signup forms show this name for now. Anywhere else someone signs up, their consent is recorded for the one site they used.',
    )
  })

  it('ends with the estimate and that the page may be left', () => {
    expect(said.slice(-2)).toEqual([
      'This will take a few minutes.',
      'You can leave this page; it finishes on its own.',
    ])
  })

  it('does not print the folded CRM line a second time', () => {
    expect(said).not.toContain('crm.combine said')
  })

  it('warns that confirmations will hold siblings when the switch is on', () => {
    expect(text(review({ name: 'Outdoors', hostIds: ['camp', 'shop'] }, preview(), true))).toContain(
      'A confirmation one site is waiting for will hold the other sites’ email on that topic.',
    )
    expect(said.join(' ')).not.toMatch(/waiting for will hold/)
  })

  it('says nothing about CRM records when the CRM did not report', () => {
    expect(
      text(review({ name: 'Outdoors', hostIds: ['camp', 'shop'] })).join(' '),
    ).not.toMatch(/CRM records/)
  })
})

describe('adding a site', () => {
  const result = review(
    { mode: 'edit', groupId: 'g_acme', name: 'Acme', hostIds: ['acme-a', 'acme-b', 'camp'] },
    preview({ participants: [CRM([{ id: 'crm.combine', count: 3 }])] }),
  )
  const said = text(result)

  it('is labeled for the one site it adds', () => {
    expect(result.confirmLabel).toBe('Add site')
    expect(said[0]).toBe('Add Camp to Acme.')
  })

  it('keeps the group’s record where records disagree', () => {
    expect(said.find((line) => line.startsWith('The CRM records'))).toMatch(
      /such as the owner or stage, Acme’s record is kept\./,
    )
  })

  it('shares nobody who signed up before, in either direction', () => {
    expect(said).toContain(
      'People who signed up before now keep what they agreed to: nobody who signed up on Camp is shared with Acme’s other sites, or the other way around. Only people who sign up after this change, on a form that shows this name, are.',
    )
  })

  it('warns, with the cutoff date, when the org grandfathers earlier captures', () => {
    const forward = review(
      { mode: 'edit', groupId: 'g_acme', name: 'Acme', hostIds: ['acme-a', 'acme-b', 'camp'] },
      preview({
        forwardPolicyWarning: { hostIds: ['camp'], enforceFromMs: Date.UTC(2026, 2, 1, 12) },
      }),
    )
    expect(text(forward)).toContain(
      'Camp will be able to email people these sites captured before March 1, 2026 without a recorded opt-in.',
    )
  })
})

describe('removing a site', () => {
  const result = review(
    { mode: 'edit', groupId: 'g_home', name: 'Home goods', hostIds: ['shop', 'deals'] },
    preview({
      carries: [
        { toHostId: 'blog', fromHostId: 'shop', siteSuppressions: 5, topicOptOuts: 2, paces: 1 },
        { toHostId: 'shop', fromHostId: 'blog', siteSuppressions: 1, topicOptOuts: 0, paces: 0 },
      ],
      pendingHolds: [{ hostId: 'blog', topicId: 'news', count: 4, releasedHostIds: ['shop'] }],
      participants: [
        CRM([
          { id: 'crm.refusals', count: 2 },
          { id: 'crm.grants', count: 30 },
          { id: 'crm.copy', count: 12 },
          { id: 'crm.visibility', count: 7 },
        ]),
      ],
    }),
  )
  const said = text(result)

  it('is labeled for the one site it removes', () => {
    expect(result.title).toBe('Change “Home goods”')
    expect(result.confirmLabel).toBe('Remove site')
  })

  it('says the site sends on its own again', () => {
    expect(said).toContain(
      'Blog will send on its own again; its signup forms will stop naming Home goods.',
    )
  })

  it('copies opt-outs both ways, and counts every copy once', () => {
    expect(said).toContain(
      'Everyone who opted out on any of Home goods’s sites stays opted out on Blog, and everyone who opted out on Blog stays opted out on Home goods’s other sites (10 opt-outs copied, and 1 email frequency choice kept).',
    )
  })

  it('says the leaving site keeps the consent it was given', () => {
    expect(said).toContain(
      'Blog can still email the 30 people who signed up to Home goods while it was part of it.',
    )
  })

  it('says who keeps which CRM records', () => {
    expect(said).toContain(
      'Blog keeps a copy of the CRM record for the 12 people it met itself. Home goods keeps its records, including order totals for people who also bought elsewhere.',
    )
    expect(said).toContain(
      'Blog will still see 7 people it met only through Home goods’s other sites, without their CRM details.',
    )
  })

  it('says which pending confirmations stop holding the others', () => {
    expect(said).toContain(
      '4 people waiting to confirm on Blog will no longer hold Home goods’s email, and vice versa.',
    )
  })

  it('still quotes what the group’s remaining forms say, with the new count', () => {
    expect(said).toContain(
      'Signup forms on Home goods’s sites will say: “You\'ll receive marketing email from Home goods, which covers 2 sites.”',
    )
  })
})

describe('dissolving', () => {
  const answer = preview({
    carries: [
      { toHostId: 'acme-a', fromHostId: 'acme-b', siteSuppressions: 3, topicOptOuts: 0, paces: 0 },
      { toHostId: 'acme-b', fromHostId: 'acme-a', siteSuppressions: 4, topicOptOuts: 0, paces: 0 },
    ],
    participants: [CRM([{ id: 'crm.figures', count: 6 }, { id: 'crm.copy', count: 20 }])],
  })

  it('from the menu', () => {
    const result = review({ mode: 'dissolve', groupId: 'g_acme', name: 'Acme' }, answer)
    const said = text(result)
    expect(result.title).toBe('Dissolve “Acme”')
    expect(result.confirmLabel).toBe('Dissolve group')
    expect(said).toContain('Dissolve Acme.')
    expect(said).toContain(
      'Acme East and Acme West will each send on their own again; their signup forms will stop naming Acme.',
    )
    expect(said).toContain(
      'Everyone who opted out on any of Acme’s sites stays opted out on every one of them (7 opt-outs copied).',
    )
    expect(said).toContain('Each site keeps a copy of the CRM record for the 20 people it met itself.')
  })

  it('warns that order totals that can’t be split are removed', () => {
    const result = review({ mode: 'dissolve', groupId: 'g_acme', name: 'Acme' }, answer)
    const figures = result.sections
      .flatMap((section) => section.items)
      .find((item) => item.id === 'records.figures')
    expect(figures).toEqual({
      id: 'records.figures',
      text: 'Order totals for 6 people who bought on more than one of these sites can’t be split and will be removed.',
      tone: 'warning',
    })
  })

  it('by unticking all but one site, which it says first', () => {
    const result = review(
      { mode: 'edit', groupId: 'g_acme', name: 'Acme', hostIds: ['acme-a'] },
      answer,
    )
    expect(result.confirmLabel).toBe('Dissolve group')
    expect(text(result)[0]).toBe(
      'A consent group needs at least two sites. Removing Acme West dissolves Acme.',
    )
  })
})

describe('renaming', () => {
  const result = review({
    mode: 'edit',
    groupId: 'g_acme',
    name: 'Acme Outfitters',
    hostIds: ['acme-a', 'acme-b'],
  })
  const said = text(result)

  it('is labeled as a rename', () => {
    expect(result.confirmLabel).toBe('Rename group')
    expect(said[0]).toBe('Rename Acme to Acme Outfitters.')
  })

  it('says the old name stays on the records of people who saw it', () => {
    expect(said).toContain(
      'Signup forms and preference pages will show Acme Outfitters from now on. People who already signed up saw Acme; their records keep it.',
    )
  })

  it('copies no opt-outs and combines no records', () => {
    expect(said.join(' ')).not.toMatch(/opted out|CRM records/)
  })
})

describe('moving a site from another group', () => {
  it('says what the move costs the group it leaves', () => {
    const said = text(
      review(
        { mode: 'edit', groupId: 'g_home', name: 'Home goods', hostIds: ['shop', 'blog', 'deals', 'acme-a'] },
        preview(),
      ),
    )
    expect(said).toContain('Move Acme East from Acme to Home goods.')
    expect(said).toContain(
      'Moving Acme East dissolves Acme, because a consent group needs at least two sites. Acme West will send on its own.',
    )
    expect(said).toContain(
      'Everyone who opted out on any of Acme’s sites stays opted out on Acme East, and everyone who opted out on Acme East stays opted out on Acme West (0 opt-outs copied).',
    )
    expect(said).toContain(
      'Acme East can still email the people who signed up to Acme while it was part of it.',
    )
  })

  it('merges a group whose every site moves, and copies nothing for it', () => {
    const said = text(
      review(
        {
          mode: 'edit',
          groupId: 'g_home',
          name: 'Home goods',
          hostIds: ['shop', 'blog', 'deals', 'acme-a', 'acme-b'],
        },
        preview(),
      ),
    )
    expect(said).toContain('Acme will be merged into Home goods, so Acme stops existing.')
    expect(said.join(' ')).not.toMatch(/stays opted out/)
  })
})

describe('what the plugins reported', () => {
  it('prints a line the review does not fold, as the plugin wrote it', () => {
    const said = text(
      review(
        { mode: 'dissolve', groupId: 'g_acme', name: 'Acme' },
        preview({
          participants: [
            {
              pluginId: 'bookings',
              lines: [{ id: 'bookings.reminders', text: '3 reminders move', count: 3, severity: 'warning' }],
            },
          ],
        }),
      ),
    )
    expect(said).toContain('3 reminders move')
  })

  it('says so when a plugin could not count in time', () => {
    const said = text(
      review(
        { mode: 'dissolve', groupId: 'g_acme', name: 'Acme' },
        preview({ participants: [{ pluginId: 'crm', lines: null }] }),
      ),
    )
    expect(said).toContain(
      'Part of this change couldn’t be counted ahead of time. It still runs, and nobody who opted out starts getting email.',
    )
  })

  it('lists the stored entries the write removes', () => {
    const said = text(
      review(
        { mode: 'dissolve', groupId: 'g_acme', name: 'Acme' },
        preview({ discarded: ['cg_old', 'stray'] }),
      ),
    )
    expect(said.find((line) => line.startsWith('2 saved consent groups'))).toMatch(
      /This change removes them: cg_old and stray\.$/,
    )
  })
})

describe('before the preview has answered', () => {
  it('says nothing it would need a count for', () => {
    const said = text(review({ name: 'Outdoors', hostIds: ['camp', 'shop'] }, null))
    expect(said.join(' ')).not.toMatch(/on record|copied/)
    expect(said).toContain('You can leave this page; it finishes on its own.')
  })
})
