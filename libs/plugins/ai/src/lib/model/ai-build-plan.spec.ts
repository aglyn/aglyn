/**
 * @jest-environment node
 *
 * Pragma must stay in the FIRST block comment — behind the license header it
 * is silently ignored and the suite runs on jsdom.
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

import {
  AI_BUILD_PLAN_LIMITS,
  AI_BUILD_PLAN_TOOL,
  aiPlanCreateFor,
  isAiPlanNewRef,
  parseAiBuildPlan,
  type AiBuildPlan,
} from './ai-build-plan'

/**
 * The build plan's schema (AGL-2935). The reader refuses a plan that would
 * read differently from what the model meant, and repairs only length; the
 * tool schema stays inside what strict structured output accepts, because a
 * provider that rejects the schema rejects every plan.
 */

function plan(patch: Partial<AiBuildPlan> = {}): AiBuildPlan {
  return {
    reuse: [{ kind: 'layout', id: 'lay-site', purpose: 'the site chrome' }],
    create: [
      {
        kind: 'component',
        name: 'Service card',
        why: 'No card on the site lists a service with its price.',
        duplicateOf: null,
        fields: ['title:text', 'image:image'],
      },
    ],
    screens: [
      {
        title: 'Roof repair',
        slug: '/services/roof-repair',
        layout: 'lay-site',
        template: null,
        duplicateOf: null,
        nav: true,
        seoTitle: 'Roof repair',
        seoDescription: 'Same-week roof repair from a local crew.',
        sections: [
          { name: 'hero', uses: [], items: 0 },
          { name: 'services grid', uses: ['new:Service card'], items: 6 },
        ],
      },
    ],
    ...patch,
  }
}

describe('parseAiBuildPlan', () => {
  it('reads a well-formed plan exactly as it was written', () => {
    expect(parseAiBuildPlan(plan())).toEqual({ ok: true, plan: plan(), repairs: [] })
  })

  it('cuts copy past its ceiling and names the cut', () => {
    const long = 'x'.repeat(AI_BUILD_PLAN_LIMITS.text + 10)
    const parsed = parseAiBuildPlan(
      plan({ reuse: [{ kind: 'layout', id: 'lay-site', purpose: long }] }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    expect(parsed.plan.reuse[0].purpose).toHaveLength(AI_BUILD_PLAN_LIMITS.text)
    expect(parsed.repairs).toEqual([
      `reuse[0].purpose was over ${AI_BUILD_PLAN_LIMITS.text} characters; truncated`,
    ])
  })

  it('reads an empty optional reference as null', () => {
    const parsed = parseAiBuildPlan(
      plan({ screens: [{ ...plan().screens[0], template: '', duplicateOf: undefined as never }] }),
    )
    expect(parsed.ok && parsed.plan.screens[0]).toMatchObject({ template: null, duplicateOf: null })
  })

  it.each<[string, unknown, string]>([
    ['a missing list', { ...plan(), screens: undefined }, 'screens is not a list'],
    [
      'an unknown kind',
      plan({ create: [{ ...plan().create[0], kind: 'widget' as never }] }),
      'create[0].kind is not one of',
    ],
    [
      'more screens than one job holds',
      plan({
        screens: Array.from({ length: AI_BUILD_PLAN_LIMITS.screens + 1 }, () => plan().screens[0]),
      }),
      `screens lists ${AI_BUILD_PLAN_LIMITS.screens + 1}`,
    ],
    [
      'two creations under one name',
      plan({ create: [plan().create[0], { ...plan().create[0], name: 'service CARD' }] }),
      'is used twice',
    ],
    [
      'a navigation flag that is not a switch',
      plan({ screens: [{ ...plan().screens[0], nav: 'yes' as never }] }),
      'nav is not true or false',
    ],
    [
      'an item count that is not a count',
      plan({
        screens: [{ ...plan().screens[0], sections: [{ name: 'grid', uses: [], items: -1 }] }],
      }),
      'items is not a count',
    ],
    ['an empty reuse id', plan({ reuse: [{ kind: 'layout', id: ' ', purpose: 'x' }] }), 'reuse[0].id is empty'],
  ])('refuses %s', (_label, input, error) => {
    expect(parseAiBuildPlan(input)).toMatchObject({
      ok: false,
      error: expect.stringContaining(error),
    })
  })
})

describe('new: references', () => {
  it('names a creation, case-insensitively, and nothing from the inventory', () => {
    expect(isAiPlanNewRef('new:Service card')).toBe(true)
    expect(isAiPlanNewRef('lay-site')).toBe(false)
    expect(isAiPlanNewRef(null)).toBe(false)
    expect(aiPlanCreateFor(plan(), 'new:service card')?.name).toBe('Service card')
    expect(aiPlanCreateFor(plan(), 'new:Price table')).toBeUndefined()
    expect(aiPlanCreateFor(plan(), 'lay-site')).toBeUndefined()
  })
})

describe('AI_BUILD_PLAN_TOOL — strict structured output', () => {
  /** Every object schema in the tree, with where it sits. */
  function objectSchemas(
    schema: unknown,
    path = 'input',
  ): Array<{ path: string; schema: Record<string, unknown> }> {
    if (!schema || typeof schema !== 'object') return []
    const node = schema as Record<string, unknown>
    const found: Array<{ path: string; schema: Record<string, unknown> }> = []
    if (node['type'] === 'object') found.push({ path, schema: node })
    for (const [name, inner] of Object.entries(
      (node['properties'] as Record<string, unknown>) ?? {},
    )) {
      found.push(...objectSchemas(inner, `${path}.${name}`))
    }
    if (node['items']) found.push(...objectSchemas(node['items'], `${path}[]`))
    for (const [index, branch] of ((node['anyOf'] as unknown[]) ?? []).entries()) {
      found.push(...objectSchemas(branch, `${path}|${index}`))
    }
    return found
  }

  it('closes every object and requires every property it declares', () => {
    const objects = objectSchemas(AI_BUILD_PLAN_TOOL.inputSchema)
    expect(objects.map((entry) => entry.path)).toEqual([
      'input',
      'input.reuse[]',
      'input.create[]',
      'input.screens[]',
      'input.screens[].sections[]',
    ])
    for (const { path, schema } of objects) {
      expect([path, schema['additionalProperties']]).toEqual([path, false])
      expect([path, [...(schema['required'] as string[])].sort()]).toEqual([
        path,
        Object.keys(schema['properties'] as object).sort(),
      ])
    }
    expect(AI_BUILD_PLAN_TOOL.strict).toBe(true)
  })

  it('carries no bound strict output refuses — the reader enforces them instead', () => {
    const text = JSON.stringify(AI_BUILD_PLAN_TOOL.inputSchema)
    for (const keyword of [
      'minLength',
      'maxLength',
      'minItems',
      'maxItems',
      'minimum',
      'maximum',
      'pattern',
      'format',
    ]) {
      expect([keyword, text.includes(`"${keyword}"`)]).toEqual([keyword, false])
    }
  })

  it('offers exactly the kinds the reader admits', () => {
    const schema = AI_BUILD_PLAN_TOOL.inputSchema as {
      properties: Record<string, { items: { properties: { kind: { enum: string[] } } } }>
    }
    for (const kind of schema.properties['reuse'].items.properties.kind.enum) {
      expect(
        parseAiBuildPlan(plan({ reuse: [{ kind: kind as never, id: 'x', purpose: 'y' }] })).ok,
      ).toBe(true)
    }
    for (const kind of schema.properties['create'].items.properties.kind.enum) {
      expect(
        parseAiBuildPlan(plan({ create: [{ ...plan().create[0], kind: kind as never }] })).ok,
      ).toBe(true)
    }
  })
})
