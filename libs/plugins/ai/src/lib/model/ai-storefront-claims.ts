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

import type { AiDoctrineViolation } from '../runtime/ai-doctrine-validators'

/**
 * STOREFRONT COPY SAFETY (AGL-2916): the claims AI-written product copy may not
 * make, checked in code on every answer rather than asked for in a prompt.
 *
 * A product description is published copy a shopper relies on, and a
 * generator writing one from a name and a photo knows nothing a claim would
 * rest on. So three kinds are refused outright, whatever the product:
 *
 *  - **health** — what a product cures, treats, heals or prevents, clinical or
 *    medical proof, a regulator's approval, a doctor's recommendation;
 *  - **financial** — returns, income or profit promised, an investment that
 *    cannot lose;
 *  - **legal** — legal advice, a legal guarantee, compliance or approval.
 *
 * A fourth kind is refused unless the merchant's own words already state it:
 * a certification, an award, a license or an endorsement. The acceptable-use
 * rules every AI request carries (`runtime/ai-runtime.ts`) forbid copy that
 * claims an endorsement, certification or partnership not given as a fact,
 * and the merchant's product text is the only such fact the generator has.
 *
 * The patterns name CLAIMS, not topics: "a sweet treat", "cured ham" and "a
 * soothing lavender scent" are ordinary copy. A match is refused with the
 * phrase quoted, so the one re-ask the generation loop allows can remove
 * exactly that phrase.
 *
 * A price is refused the same way unless the merchant's own words state it:
 * prices are the merchant's to set, and a generator never invents one.
 */

export type AiStorefrontClaimKind = 'health' | 'financial' | 'legal' | 'endorsement'

/** Conditions a health claim names, as the object of cure, treat, heal or prevent. */
const CONDITIONS =
  '(?:anxiety|depression|insomnia|stress|pain|aches?|arthritis|inflammation|acne|eczema|psoriasis|rosacea|' +
  'migraines?|headaches?|colds?|flu|covid(?:-19)?|viruse?s?|infections?|disease|diseases|illness|illnesses|' +
  'cancer|tumou?rs?|diabetes|blood pressure|hypertension|cholesterol|asthma|allergies|adhd|autism|dementia|' +
  'alzheimer\'?s|obesity|hair loss|baldness|wrinkles|scars?|nausea|indigestion|constipation|ulcers?|' +
  'insulin resistance|fatigue)'

const CLAIM_PATTERNS: ReadonlyArray<{ kind: AiStorefrontClaimKind; pattern: RegExp }> = [
  // What a product does to a condition.
  {
    kind: 'health',
    pattern: new RegExp(
      `\\b(?:cures?|cured|curing|treats?|treating|treatment for|heals?|healing|relieves?|relief (?:from|of)|` +
        `prevents?|preventing|prevention of|protects? against|fights?|reverses?|eliminates?|reduces? the risk of)` +
        `\\s+(?:your\\s+|the\\s+|a\\s+|an\\s+|all\\s+|most\\s+|chronic\\s+|common\\s+|symptoms of\\s+)*${CONDITIONS}\\b`,
      'i',
    ),
  },
  {
    kind: 'health',
    pattern:
      /\b(?:clinically|medically|scientifically) (?:proven|tested|shown|validated|approved)\b|\b(?:fda|ema|mhra)[- ]?(?:approved|cleared|registered|certified)\b|\b(?:doctor|physician|dermatologist|pediatrician|dentist|pharmacist)s?[- ](?:recommended|approved|endorsed)\b|\bhealing (?:properties|powers?|benefits)\b|\bboosts? (?:your |the )?immun(?:e system|ity)\b|\bimmune[- ]boosting\b|\bdetoxif(?:y|ies|ying) (?:your|the) body\b|\b(?:lose|burn) (?:weight|fat) (?:fast|quickly|without)\b|\bmiracle (?:cure|remedy)\b/i,
  },
  // Money a buyer is promised.
  {
    kind: 'financial',
    pattern:
      /\bguaranteed (?:returns?|income|profits?|earnings|payouts?|to (?:make|earn) money)\b|\brisk[- ]free (?:investment|returns?|income|profits?)\b|\bget rich\b|\bpassive income\b|\b(?:double|triple|multiply) your (?:money|investment|income|savings)\b|\bmake money (?:fast|quickly|from home)\b|\bfinancial freedom\b|\b(?:investment|financial|tax) advice\b|\bwill (?:increase|appreciate|grow) in value\b|\bpays? for itself\b/i,
  },
  // Law a buyer is promised.
  {
    kind: 'legal',
    pattern:
      /\blegal advice\b|\blegally (?:binding|approved|certified|compliant|required)\b|\b(?:court|lawyer|attorney)[- ](?:approved|certified|proven)\b|\blawsuit[- ]proof\b|\bguaranteed to (?:win|hold up)\b|\b(?:compliant|complies) with (?:all|every) (?:laws?|regulations?)\b|\bmeets all legal requirements\b|\b(?:gdpr|hipaa|ada|osha)[- ](?:compliant|certified|approved)\b/i,
  },
  // Standing a product has, which only the merchant can say it has.
  {
    kind: 'endorsement',
    pattern:
      /\bcertified (?:organic|vegan|gluten[- ]free|kosher|halal|fair ?trade|b corp|non[- ]gmo|cruelty[- ]free)\b|\b(?:usda|fair ?trade|b corp|non[- ]gmo project) (?:certified|verified|approved)\b|\bofficially licensed\b|\bendorsed by\b|\bas seen (?:on|in)\b|\baward[- ]winning\b|(?<![\w#])(?:#1|number one|no\. ?1)\s(?:rated|best[- ]?sell(?:ing|er)|recommended|brand)\b|\bbest[- ]sell(?:ing|er)\b|\bpatented\b|\bpatent[- ]pending\b/i,
  },
]

/** A price written into copy: a currency sign or code beside an amount. */
const PRICE =
  /(?:[$€£¥]\s?\d[\d,]*(?:\.\d{1,2})?|\b\d[\d,]*(?:\.\d{1,2})?\s?(?:usd|eur|gbp|dollars?|euros?|pounds? sterling)\b)/i

export interface AiStorefrontCopySample {
  /** Where the text sits in the answer, as `products[2].description`. */
  at: string
  text: string
}

/** One claim found, with the phrase that makes it. */
export interface AiStorefrontClaim {
  kind: AiStorefrontClaimKind
  at: string
  phrase: string
}

const collapse = (text: string): string => text.replace(/\s+/g, ' ').trim().toLowerCase()

/** Every phrase a pattern matches in a text, so one re-ask can remove them all. */
function everyMatch(pattern: RegExp, text: string): string[] {
  const global = new RegExp(pattern.source, pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`)
  return [...text.matchAll(global)].map((match) => match[0])
}

/**
 * Every claim the samples make that they may not. A certification, award,
 * license or endorsement is allowed when the merchant's own words — the
 * product's name and text, or the brief — contain the same phrase.
 */
export function findStorefrontClaims(
  samples: readonly AiStorefrontCopySample[],
  merchantWords = '',
): AiStorefrontClaim[] {
  const own = collapse(merchantWords)
  const found: AiStorefrontClaim[] = []
  for (const sample of samples) {
    for (const { kind, pattern } of CLAIM_PATTERNS) {
      for (const phrase of everyMatch(pattern, sample.text)) {
        if (kind === 'endorsement' && own.includes(collapse(phrase))) continue
        found.push({ kind, at: sample.at, phrase })
      }
    }
  }
  return found
}

/** A price in the samples that the merchant's own words do not state. */
export function findInventedPrices(
  samples: readonly AiStorefrontCopySample[],
  merchantWords = '',
): AiStorefrontClaim[] {
  const own = collapse(merchantWords)
  const found: AiStorefrontClaim[] = []
  for (const sample of samples) {
    for (const phrase of everyMatch(PRICE, sample.text)) {
      if (!own.includes(collapse(phrase))) found.push({ kind: 'financial', at: sample.at, phrase })
    }
  }
  return found
}

const CLAIM_WORDS: Readonly<Record<AiStorefrontClaimKind, string>> = {
  health: 'a health claim',
  financial: 'a financial claim',
  legal: 'a legal claim',
  endorsement: 'a certification, award or endorsement the product’s own text does not state',
}

/**
 * The claims as violations the generation loop re-asks for: one per kind, the
 * phrases quoted in the detail the model is told, the places in `paths`.
 */
export function storefrontClaimViolations(
  claims: readonly AiStorefrontClaim[],
  prices: readonly AiStorefrontClaim[] = [],
): AiDoctrineViolation[] {
  const violations: AiDoctrineViolation[] = []
  const kinds = [...new Set(claims.map((claim) => claim.kind))]
  for (const kind of kinds) {
    const own = claims.filter((claim) => claim.kind === kind)
    violations.push({
      rule: null,
      code: `storefront-claim-${kind}`,
      message: `The copy makes ${CLAIM_WORDS[kind]}. Say what the product is and how it is used instead.`,
      detail: `Remove: ${[...new Set(own.map((claim) => `"${claim.phrase}"`))].join(', ')}.`,
      paths: [...new Set(own.map((claim) => claim.at))],
    })
  }
  if (prices.length) {
    violations.push({
      rule: null,
      code: 'storefront-price-invented',
      message: 'The copy states a price nobody gave. Leave prices out; the merchant sets them.',
      detail: `Remove: ${[...new Set(prices.map((price) => `"${price.phrase}"`))].join(', ')}.`,
      paths: [...new Set(prices.map((price) => price.at))],
    })
  }
  return violations
}
