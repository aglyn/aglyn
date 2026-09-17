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
  findInventedPrices,
  findStorefrontClaims,
  storefrontClaimViolations,
  type AiStorefrontClaimKind,
} from './ai-storefront-claims'

/** Storefront copy safety (AGL-2916): the claims AI-written product copy may not make. */

const kindsIn = (text: string, merchantWords = ''): AiStorefrontClaimKind[] =>
  findStorefrontClaims([{ at: 'description', text }], merchantWords).map((claim) => claim.kind)

describe('the claims product copy may not make', () => {
  it.each([
    ['This balm cures eczema overnight.', 'health'],
    ['A tea that treats anxiety and insomnia.', 'health'],
    ['Helps prevent the flu all winter.', 'health'],
    ['Clinically proven to soften skin.', 'health'],
    ['FDA-approved for daily use.', 'health'],
    ['Dermatologist recommended.', 'health'],
    ['Its healing properties come from the hills.', 'health'],
    ['Boosts your immune system.', 'health'],
    ['Guaranteed returns within a year.', 'financial'],
    ['A course that brings passive income.', 'financial'],
    ['This watch will appreciate in value.', 'financial'],
    ['The will kit is legally binding in every state.', 'legal'],
    ['GDPR-compliant from day one.', 'legal'],
    ['Certified organic cotton.', 'endorsement'],
    ['An award-winning roast.', 'endorsement'],
    ['Our best-selling mug.', 'endorsement'],
    ['The #1 rated blender.', 'endorsement'],
    ['As seen on TV.', 'endorsement'],
  ])('refuses %j as a %s claim', (text, kind) => {
    expect(kindsIn(text)).toContain(kind)
  })

  it.each([
    'A sweet treat for the afternoon.',
    'Thin slices of cured ham.',
    'A soothing lavender scent for the bath.',
    'Keeps your coffee hot for six hours.',
    'Hand-poured in small batches.',
    'Treat yourself to a slower morning.',
    'Protects your table from hot pans.',
    'The best way to start a picnic.',
    'Ranked by our team as a favorite.',
    'Pain au chocolat, baked every morning.',
  ])('lets ordinary copy through: %j', (text) => {
    expect(kindsIn(text)).toEqual([])
  })

  it('allows a certification or award the merchant’s own words state, and nothing else on that ground', () => {
    const merchant = 'Brass desk lamp. Award-winning design, certified organic linen shade.'
    expect(kindsIn('An award-winning lamp with a certified organic linen shade.', merchant)).toEqual([])
    // A health claim is refused whatever the merchant says.
    expect(kindsIn('Relieves migraines.', 'Relieves migraines.')).toEqual(['health'])
  })

  it('refuses a price the merchant never gave, and allows one they did', () => {
    const samples = [{ at: 'products[0].description', text: 'Only $28 a jar, or 30 USD for two.' }]
    expect(findInventedPrices(samples).map((price) => price.phrase)).toEqual(['$28', '30 USD'])
    expect(findInventedPrices(samples, 'Jars are $28 each, 30 USD for two.')).toEqual([])
    expect(findInventedPrices([{ at: 'description', text: 'An 8 oz jar with a 40 hour burn.' }])).toEqual([])
  })

  it('names each kind once, quoting the phrases and the places, for the one re-ask', () => {
    const claims = findStorefrontClaims([
      { at: 'description', text: 'Cures acne. Clinically proven, and it treats eczema too.' },
      { at: 'seoDescription', text: 'Cures acne fast.' },
    ])
    const violations = storefrontClaimViolations(claims, findInventedPrices([{ at: 'seoTitle', text: 'Now $9' }]))
    expect(violations.map((violation) => violation.code)).toEqual(['storefront-claim-health', 'storefront-price-invented'])
    expect(violations[0]).toMatchObject({
      rule: null,
      detail: 'Remove: "Cures acne", "treats eczema", "Clinically proven".',
      paths: ['description', 'seoDescription'],
    })
    expect(violations[1]).toMatchObject({ detail: 'Remove: "$9".', paths: ['seoTitle'] })
  })
})
