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
 * The user turn a search listing is written from, and the site's own words in
 * it (AGL-2918).
 *
 * The rules blocks are held elsewhere — `runtime/ai-prompt-cache.spec.ts`
 * measures them and keeps them free of any one site's bytes. What is measured
 * here is the turn: the site's own words ride in it, so they steer the
 * listing without keying the platform's cache entry on a tenant's sentence.
 */

import { aiSeoFieldsPrompt, type AiSeoFieldsPromptInput } from './seo-fields'

const BASE: AiSeoFieldsPromptInput = {
  subject: { kind: 'screen', name: 'Grooming', path: '/grooming' },
  brand: 'Waggle',
  text: 'Baths, trims and nail clipping, by appointment.',
  fields: ['title', 'description'],
}

const prompt = (patch: Partial<AiSeoFieldsPromptInput> = {}) =>
  aiSeoFieldsPrompt({ ...BASE, ...patch })

describe('what the site is, and who it is for, reach the listing', () => {
  it('puts both answers in the turn, each on a line of its own', () => {
    const turn = prompt({
      site: { about: 'a neighborhood dog groomer', audience: 'local dog owners' },
    })
    expect(turn).toContain('What the site is: a neighborhood dog groomer')
    expect(turn).toContain('Who the site is for: local dog owners')
  })

  it('keeps them above the page, where the listing is written from', () => {
    const turn = prompt({ site: { about: 'a dog groomer', audience: 'dog owners' } })
    // The answers describe the site; the text describes one page of it, and a
    // model reading top down should have the site in hand before the page.
    expect(turn.indexOf('What the site is:')).toBeLessThan(turn.indexOf('Page text:'))
    expect(turn.indexOf('Who the site is for:')).toBeLessThan(turn.indexOf('Page text:'))
  })

  it('says nothing at all for a caller that knows neither', () => {
    // Not an empty line, and not a label with nothing after it: a question
    // nobody answered is a question the model is never shown.
    for (const site of [undefined, null, {}, { about: '', audience: '   ' }]) {
      const turn = prompt({ site })
      expect(turn).not.toContain('What the site is')
      expect(turn).not.toContain('Who the site is for')
      expect(turn).not.toMatch(/\n\n(?!Page text:)/)
    }
  })

  it('carries the half a caller does know', () => {
    const about = prompt({ site: { about: 'a dog groomer' } })
    expect(about).toContain('What the site is: a dog groomer')
    expect(about).not.toContain('Who the site is for')
    const audience = prompt({ site: { audience: 'dog owners' } })
    expect(audience).toContain('Who the site is for: dog owners')
    expect(audience).not.toContain('What the site is')
  })

  it('flattens a pasted answer and holds it to a phrase', () => {
    // An answer is typed into a box, so it can arrive with newlines in it; a
    // newline here would read as the next field.
    const turn = prompt({ site: { about: 'a dog\n  groomer', audience: 'x'.repeat(400) } })
    expect(turn).toContain('What the site is: a dog groomer')
    const line = turn.split('\n').find((row) => row.startsWith('Who the site is for:')) ?? ''
    expect(line.length).toBeLessThan(200)
  })

  it('leaves every other part of the turn exactly where it was', () => {
    // The site's words are an ADDITION. A turn without them has to be the
    // turn the door sent before this issue, byte for byte.
    expect(prompt()).toBe(
      [
        'Site: Waggle',
        'Page: Grooming (/grooming)',
        'Fields to write: title, description',
        '',
        'Page text:',
        'Baths, trims and nail clipping, by appointment.',
      ].join('\n'),
    )
  })
})
