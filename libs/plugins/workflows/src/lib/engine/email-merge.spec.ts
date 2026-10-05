/**
 * @jest-environment node
 *
 * Must stay the FIRST block comment in the file — Jest reads the pragma only
 * from there, and behind the license header the suite would run on jsdom.
 *
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

import { resolveStepEmailMerge } from './email-merge'

/** AGL-3458 — a step's email fills both merge spellings, with fallbacks. */

const CONTEXT = {
  contact: {
    name: 'Ada Lovelace',
    email: 'Ada@Example.com',
    facets: {
      'site-1': { name: 'Countess Ada Lovelace', jobTitle: 'Analyst', companyName: 'Analytical Engines' },
    },
  },
  contactGroupId: 'site-1',
  site: { name: 'Acme Site' },
}

const LEAD = { name: 'Charles Babbage', email: 'charles@example.com', company: 'Analytical Engines' }

describe('resolveStepEmailMerge', () => {
  it('fills the campaign’s short tags from the contact as this site knows them', () => {
    const merged = resolveStepEmailMerge(
      'Hi {{firstName|there}} ({{name}}, {{email}}) — {{contact.title}} at {{site.name}}',
      CONTEXT,
    )
    expect(merged.text).toBe(
      'Hi Countess (Countess Ada Lovelace, ada@example.com) — Analyst at Acme Site',
    )
  })

  it('falls back to the lead when nobody holds a contact for the person', () => {
    const merged = resolveStepEmailMerge('Hi {{firstName|there}} at {{lead.company}}', { lead: LEAD })
    expect(merged.text).toBe('Hi Charles at Analytical Engines')
  })

  it('falls back to the event’s own name and address, then to the tag’s fallback', () => {
    expect(
      resolveStepEmailMerge('Hi {{firstName|there}}, {{email}}', {}, { name: 'Grace Hopper', email: 'g@h.co' }).text,
    ).toBe('Hi Grace, g@h.co')
    expect(resolveStepEmailMerge('Hi {{firstName|there}}', {}, null).text).toBe('Hi there')
  })

  it('never sends a tag as its braces', () => {
    expect(resolveStepEmailMerge('{{frstName}}{{contact.nickname}}{{lead.x|y}}', {}).text).toBe('y')
  })
})
