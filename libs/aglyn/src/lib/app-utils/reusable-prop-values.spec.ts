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
  REUSABLE_PROP_PATTERN_INPUT_MAX_LENGTH,
  REUSABLE_PROP_PATTERN_MAX_LENGTH,
  resolveReusablePropValues,
  reusablePropPatternProblem,
  withMatchableConditions,
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

  it.each([
    { when: 'headline', pattern: 'ONCE$', flags: 'i' },
    { when: 'headline', pattern: '^build\\s+once$', flags: 'im' },
    { when: 'headline', pattern: 'd.o', flags: 's' },
    { when: 'headline', pattern: 'uild', flags: 'y' },
    { when: 'headline', pattern: '(^Build)?$' },
    { when: 'headline', pattern: '\\bonce\\b' },
    { when: 'headline', pattern: 'd\\B' },
    { when: 'headline', pattern: '^(B|b)(u|U)[a-z]+\\s' },
    { when: 'count', pattern: '^\\d$' },
    { when: 'answers', pattern: '^a,b$' },
    { when: 'missing', pattern: '^undefined$' },
  ] as ReusableComponentPropCondition[])('matches %j as data-driven-forms does', (condition) => {
    const expected = parseCondition(
      asSchemaCondition(condition),
      values,
      { name: 'field' } as never,
    ).result
    expect(evaluateReusablePropCondition(condition, values)).toBe(expected)
  })
})

describe('a condition whose pattern cannot be matched safely (AGL-2893)', () => {
  /** What a publisher can set as a default: long enough to hang a backtracker. */
  const values = {
    headline: `${'a'.repeat(28)}!`,
    title: 'Build once',
    essay: 'a'.repeat(REUSABLE_PROP_PATTERN_INPUT_MAX_LENGTH + 1),
  }

  /**
   * Generous: the linear matcher answers each of these in well under a
   * millisecond, and a loaded CI box must not turn that into a flake. A
   * backtracking matcher takes seconds on the first of them.
   */
  const BUDGET_MS = 500

  it.each([
    ['an unbalanced group', { when: 'title', pattern: '(' }],
    ['a repeated flag', { when: 'title', pattern: 'B', flags: 'gg' }],
    ['an unknown flag', { when: 'title', pattern: 'B', flags: 'x' }],
    ['unicode mode', { when: 'title', pattern: 'B', flags: 'u' }],
    ['lookahead', { when: 'title', pattern: 'B(?=u)' }],
    ['a backreference', { when: 'title', pattern: '(B)\\1' }],
    ['a named group', { when: 'title', pattern: '(?<word>B)' }],
    ['a nothing-to-repeat that only RegExp refuses', { when: 'title', pattern: 'B{1}{2}' }],
    [
      'a pattern longer than the bound',
      { when: 'title', pattern: `B${'u?'.repeat(REUSABLE_PROP_PATTERN_MAX_LENGTH)}` },
    ],
    ['a pattern that is not text', { when: 'title', pattern: 7 as unknown as string }],
  ])('holds nothing for %s, and never throws', (_label, rule) => {
    const condition = rule as ReusableComponentPropCondition
    expect(
      reusablePropPatternProblem(rule.pattern, (rule as { flags?: string }).flags),
    ).toEqual(expect.any(String))
    expect(() => evaluateReusablePropCondition(condition, values)).not.toThrow()
    expect(evaluateReusablePropCondition(condition, values)).toBe(false)
    // Unmet, whichever way the rule reads its pattern.
    expect(
      evaluateReusablePropCondition({ ...condition, notMatch: true } as never, values),
    ).toBe(false)
  })

  it.each(['^(a+)+$', '^(a|a)*$', '^a*a*a*a*a*a*a*a*$', '^(\\w+\\s?)+$'])(
    'answers the catastrophic pattern %s correctly, in bounded time',
    (pattern) => {
      const started = Date.now()
      expect(evaluateReusablePropCondition({ when: 'headline', pattern }, values)).toBe(
        false,
      )
      expect(
        evaluateReusablePropCondition(
          { when: 'headline', pattern: pattern.replace('$', '!$') },
          values,
        ),
      ).toBe(true)
      expect(Date.now() - started).toBeLessThan(BUDGET_MS)
    },
  )

  it('holds nothing for a value longer than a pattern is matched against', () => {
    expect(
      evaluateReusablePropCondition({ when: 'essay', pattern: '^a' }, values),
    ).toBe(false)
    expect(
      evaluateReusablePropCondition(
        { when: 'essay', pattern: '^b', notMatch: true },
        values,
      ),
    ).toBe(false)
  })

  it('switches the property off and leaves every other one on the page', () => {
    const declared: ReusableComponentProp[] = [
      { name: 'title', type: 'text', defaultValue: values.headline },
      { name: 'broken', type: 'text', defaultValue: 'x', condition: { when: 'title', pattern: '(' } },
      { name: 'flagged', type: 'text', defaultValue: 'x', condition: { when: 'title', pattern: 'a', flags: 'gg' } },
      { name: 'slow', type: 'text', defaultValue: 'x', condition: { when: 'title', pattern: '^(a+)+$' } },
      { name: 'plain', type: 'text', defaultValue: 'Kept' },
    ]
    const started = Date.now()
    const resolved = resolveReusablePropValues(declared, {})
    expect(Date.now() - started).toBeLessThan(BUDGET_MS)
    expect([...resolved.off].sort()).toEqual(['broken', 'flagged', 'slow'])
    expect(resolved.tokens['prop.plain']).toBe('Kept')
    expect(resolved.tokens['prop.broken']).toBe('')
  })

  it('names nothing wrong with a pattern it can match', () => {
    for (const [pattern, flags] of [
      ['^(a+)+$', undefined],
      ['^build', 'i'],
      ['^[A-Z][a-z]+$', 'gm'],
      ['', undefined],
    ] as const) {
      expect(reusablePropPatternProblem(pattern, flags)).toBeUndefined()
    }
  })
})

describe('a declared condition as a server stores it (AGL-2893)', () => {
  it('removes a rule whose pattern cannot be matched, and keeps the rest', () => {
    expect(
      withMatchableConditions([
        { name: 'a', condition: { when: 'b', pattern: '(' } },
        {
          name: 'c',
          condition: [
            { when: 'b', pattern: '^x', flags: 'i' },
            { when: 'b', pattern: 'y', flags: 'gg' },
          ],
        },
        {
          name: 'd',
          condition: {
            or: [{ when: 'b', pattern: 'B(?=u)' }, { when: 'b', is: 'x' }],
          },
        },
        { name: 'e', condition: { not: { when: 'b', pattern: '(' } } },
        { name: 'f', condition: { and: [{ when: 'b', pattern: '(' }] } },
        { name: 'g', condition: { when: 'b', pattern: '^(a+)+$' } },
      ]),
    ).toEqual([
      { name: 'a' },
      { name: 'c', condition: [{ when: 'b', pattern: '^x', flags: 'i' }] },
      { name: 'd', condition: { or: [{ when: 'b', is: 'x' }] } },
      { name: 'e' },
      { name: 'f' },
      { name: 'g', condition: { when: 'b', pattern: '^(a+)+$' } },
    ])
  })

  it('hands back a list with nothing to remove as it was', () => {
    const props = [
      { name: 'a', type: 'text', condition: { when: 'b', pattern: '^x' } },
      { name: 'b', type: 'text' },
    ]
    expect(withMatchableConditions(props)).toBe(props)
    expect(withMatchableConditions(undefined)).toBeUndefined()
    expect(withMatchableConditions('props')).toBe('props')
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
