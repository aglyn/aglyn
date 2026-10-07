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
  OVERLAY_COPY_LIMITS,
  overlayCopyFromProposal,
  overlayDraftFromProposal,
} from './overlay-drafts'

/**
 * Proposed overlay copy (AGL-3603) is held to the overlay's own rules before
 * it reaches an overlay: cut to the limits, a known trigger with its value in
 * range or none, only the fields the kind has, and a new overlay switched off.
 */
describe('overlay copy from a proposal', () => {
  it('cuts every field to its limit and folds a line onto one line', () => {
    const values = overlayCopyFromProposal('popup', {
      headline: `Book\n a   free call ${'x'.repeat(200)}`,
      ctaLabel: 'y'.repeat(100),
    })
    expect(values.headline?.startsWith('Book a free call')).toBe(true)
    expect(values.headline?.length).toBeLessThanOrEqual(OVERLAY_COPY_LIMITS.headline)
    expect(values.ctaLabel).toHaveLength(OVERLAY_COPY_LIMITS.ctaLabel)
  })

  it('keeps a body’s paragraphs', () => {
    expect(overlayCopyFromProposal('popup', { body: 'One.\n\n\n\nTwo.' }).body).toBe('One.\n\nTwo.')
  })

  it('keeps a known trigger with its value in range, and drops an unknown one', () => {
    expect(overlayCopyFromProposal('popup', { trigger: 'scroll', triggerValue: 250 })).toEqual({
      trigger: 'scroll',
      triggerValue: 100,
    })
    expect(overlayCopyFromProposal('popup', { trigger: 'exit', triggerValue: 9 })).toEqual({ trigger: 'exit' })
    expect(overlayCopyFromProposal('popup', { trigger: 'teleport', triggerValue: 9 })).toEqual({})
  })

  it('keeps only the fields a bar has', () => {
    expect(overlayCopyFromProposal('bar', { text: 'Sale', headline: 'No', trigger: 'delay' })).toEqual({ text: 'Sale' })
  })
})

describe('a new overlay from a proposal', () => {
  it('is switched off', () => {
    expect(overlayDraftFromProposal('bar', { text: 'Free delivery' })).toEqual({
      kind: 'bar',
      enabled: false,
      bar: { text: 'Free delivery', dismissible: true },
    })
    expect(overlayDraftFromProposal('popup', { body: 'Book a call', trigger: 'exit' })).toEqual({
      kind: 'popup',
      enabled: false,
      popup: { body: 'Book a call', trigger: 'exit', frequencyDays: 7 },
    })
  })

  it('opens a popup after the editor’s default delay when nothing else was proposed', () => {
    expect(overlayDraftFromProposal('popup', { body: 'Hi' })?.popup).toMatchObject({ trigger: 'delay', triggerValue: 3 })
  })

  it('is not made without the field the overlay needs', () => {
    expect(overlayDraftFromProposal('bar', { headline: 'Only a headline' })).toBeNull()
    expect(overlayDraftFromProposal('popup', { headline: 'Only a headline', body: '   ' })).toBeNull()
  })
})
