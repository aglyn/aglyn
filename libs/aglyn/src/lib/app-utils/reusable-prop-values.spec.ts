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

import type { ConditionDefinition } from '@data-driven-forms/react-form-renderer'
import { parseCondition } from '@data-driven-forms/react-form-renderer/parse-condition'

import type {
  ReusableComponentProp,
  ReusableComponentPropCondition,
} from '../foundation/definitions/platform.types'
import {
  buildComponentDefaultTokens,
  buildComponentDefaultValues,
  evaluateReusablePropCondition,
  readReusablePropValue,
  resolveReusablePropValues,
} from './reusable-prop-values'

/**
 * What a property is worth on one page (AGL-2893).
 *
 * A property's condition is shown in the Attributes panel by
 * data-driven-forms and applied on a published page by the graft. The two
 * cannot share code — the graft ships to every published page and the form
 * renderer does not — so the evaluator is run against data-driven-forms' own
 * `parseCondition` over every operator the schema has, and has to answer the
 * same.
 */

// A stored condition is a data-driven-forms condition; this is the proof
// the types say so.
const asSchemaCondition = (
  condition: ReusableComponentPropCondition | ReusableComponentPropCondition[],
): ConditionDefinition | ConditionDefinition[] =>
  condition as ConditionDefinition | ConditionDefinition[]

describe('a property condition answers as data-driven-forms does (AGL-2893)', () => {
  const values: Record<string, unknown> = {
    showCta: true,
    hideMedia: false,
    tint: 'secondary',
    count: 3,
    headline: 'Build once',
    empty: '',
    answers: ['a', 'b'],
    none: [],
  }

  const conditions: Array<
    ReusableComponentPropCondition | ReusableComponentPropCondition[]
  > = [
    { when: 'showCta', is: true },
    { when: 'hideMedia', is: true },
    { when: 'tint', is: 'secondary' },
    { when: 'tint', is: 'secondary', notMatch: true },
    { when: 'tint', is: ['primary', 'secondary'] },
    { when: 'tint', is: ['primary', 'default'] },
    { when: 'tint', is: ['primary'], notMatch: true },
    { when: 'missing', is: 'x' },
    { when: 'headline', isNotEmpty: true },
    { when: 'empty', isNotEmpty: true },
    { when: 'empty', isEmpty: true },
    { when: 'missing', isEmpty: true },
    { when: 'hideMedia', isEmpty: true },
    { when: 'count', isEmpty: true },
    { when: 'answers', isNotEmpty: true },
    { when: 'none', isEmpty: true },
    { when: 'headline', pattern: '^build', flags: 'i' },
    { when: 'headline', pattern: '^build' },
    { when: 'headline', pattern: '^build', flags: 'i', notMatch: true },
    { when: 'count', greaterThan: 2 },
    { when: 'count', greaterThan: 3 },
    { when: 'count', greaterThanOrEqualTo: 3 },
    { when: 'count', lessThan: 3 },
    { when: 'count', lessThanOrEqualTo: 3 },
    [
      { when: 'showCta', is: true },
      { when: 'tint', is: 'secondary' },
    ],
    [
      { when: 'showCta', is: true },
      { when: 'hideMedia', is: true },
    ],
    { and: [{ when: 'showCta', is: true }, { when: 'count', greaterThan: 1 }] },
    { or: [{ when: 'hideMedia', is: true }, { when: 'count', lessThan: 1 }] },
    { or: [{ when: 'hideMedia', is: true }, { when: 'tint', isNotEmpty: true }] },
    { not: { when: 'showCta', is: true } },
    { not: [{ when: 'showCta', is: true }, { when: 'hideMedia', is: true }] },
  ]

  it.each(conditions.map((condition) => [JSON.stringify(condition), condition]))(
    '%s',
    (_label, condition) => {
      const expected = parseCondition(
        asSchemaCondition(condition as ReusableComponentPropCondition),
        values,
        { name: 'field' } as never,
      ).result
      expect(
        evaluateReusablePropCondition(
          condition as ReusableComponentPropCondition,
          values,
        ),
      ).toBe(expected)
    },
  )

  it('holds for a property with no condition at all', () => {
    expect(evaluateReusablePropCondition(undefined, values)).toBe(true)
  })
})

describe('what each property is worth on a page (AGL-2893)', () => {
  /** A card whose CTA, tint and media each page decides. */
  const declared: ReusableComponentProp[] = [
    { name: 'headline', type: 'text', defaultValue: 'Build once' },
    { name: 'showCta', type: 'boolean', defaultValue: 'true' },
    {
      name: 'ctaLabel',
      type: 'text',
      defaultValue: 'Learn more',
      condition: { when: 'showCta', is: true },
    },
    {
      name: 'tint',
      type: 'choice',
      options: [{ value: 'primary' }, { value: 'secondary' }],
    },
    { name: 'gap', type: 'css-dimension', defaultValue: '24px' },
    {
      name: 'topics',
      type: 'dual-list-select',
      options: [{ value: 'a' }, { value: 'b' }, { value: 'c' }],
    },
    { name: 'columns', type: 'slider', settings: { min: 1, max: 4 } },
    {
      name: 'badge',
      type: 'icon',
      defaultValue: 'mdiStar',
      defaultIconPath: 'M12,17.27L18.18,21',
    },
  ]

  it("takes the page's own value, else the default", () => {
    const { tokens, values } = resolveReusablePropValues(declared, {
      headline: 'Ship it',
      gap: '',
      columns: 3,
      topics: ['a', 'c'],
    })
    expect(tokens['prop.headline']).toBe('Ship it')
    expect(tokens['prop.gap']).toBe('24px')
    expect(values).toMatchObject({
      headline: 'Ship it',
      gap: '24px',
      columns: 3,
      topics: ['a', 'c'],
    })
    // A list substitutes into text as its answers.
    expect(tokens['prop.topics']).toBe('a, c')
  })

  it('switches a property off where its condition does not hold, and back on', () => {
    const off = resolveReusablePropValues(declared, { showCta: false })
    expect(off.off.has('ctaLabel')).toBe(true)
    expect(off.tokens['prop.ctaLabel']).toBe('')
    expect('ctaLabel' in off.values).toBe(false)

    // The stored text spelling of a no is read the way a Yes / no reads it.
    expect(
      resolveReusablePropValues(declared, { showCta: 'false' }).off.has('ctaLabel'),
    ).toBe(true)
    const on = resolveReusablePropValues(declared, { ctaLabel: 'Book a demo' })
    expect(on.tokens['prop.ctaLabel']).toBe('Book a demo')
  })

  it("draws an icon property's pick, else its default, with the path", () => {
    expect(resolveReusablePropValues(declared, {}).iconPaths['badge']).toBe(
      'M12,17.27L18.18,21',
    )
    const picked = resolveReusablePropValues(declared, {
      badge: { iconId: 'mdiRocket', iconPath: 'M13,22' },
    })
    expect(picked.tokens['prop.badge']).toBe('mdiRocket')
    expect(picked.iconPaths['badge']).toBe('M13,22')
  })

  it("previews the editor's own defaults, leaving a slot with none as its token", () => {
    const tokens = buildComponentDefaultTokens(declared)
    expect(tokens).toMatchObject({
      'prop.headline': 'Build once',
      'prop.showCta': 'true',
      'prop.ctaLabel': 'Learn more',
    })
    expect('prop.tint' in tokens).toBe(false)
    expect(buildComponentDefaultValues(declared)).toMatchObject({ gap: '24px' })
  })

  describe('readReusablePropValue', () => {
    it('reads a list only for a property that takes several', () => {
      const topics = declared.find((prop) => prop.name === 'topics')
      expect(readReusablePropValue(['a'], topics)).toEqual(['a'])
      expect(readReusablePropValue('a', topics)).toEqual(['a'])
      expect(readReusablePropValue([], topics)).toBeUndefined()
      expect(readReusablePropValue(['a'], { type: 'text' })).toBeUndefined()
    })

    it('reads a cleared value as unset, and keeps a real no and zero', () => {
      expect(readReusablePropValue('', { type: 'text' })).toBeUndefined()
      expect(readReusablePropValue(false, { type: 'boolean' })).toBe(false)
      expect(readReusablePropValue(0, { type: 'number' })).toBe(0)
    })
  })
})
