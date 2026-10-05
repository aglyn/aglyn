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
  AI_BUILD_PLAN_EMBEDS_RECORDS_TOOL,
  AI_BUILD_PLAN_EMBEDS_TOOL,
  AI_BUILD_PLAN_LIMITS,
  AI_BUILD_PLAN_RECORDS_TOOL,
  AI_BUILD_PLAN_TOOL,
  aiBuildPlanToolFor,
  aiEmbedVideoKey,
  aiPlanCreateFor,
  aiPlanEmbedsFor,
  aiPlanRecordBase,
  aiPlanUndeclaredRefs,
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
        record: null,
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

  it('cuts a rationale on its last word break, not through a word (AGL-3022)', () => {
    const why = `${'word '.repeat(60)}truncated-here`
    const parsed = parseAiBuildPlan(
      plan({
        create: [
          { kind: 'component', name: 'Service card', why, duplicateOf: null, fields: ['name:text'] },
        ],
      }),
    )
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) return
    const cut = parsed.plan.create[0].why
    expect(cut.length).toBeLessThanOrEqual(AI_BUILD_PLAN_LIMITS.text)
    expect(cut.endsWith('word')).toBe(true)
    expect(parsed.repairs).toEqual([
      `create[0].why was over ${AI_BUILD_PLAN_LIMITS.text} characters; truncated`,
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

  it('lists every reference the create list does not carry, where the plan writes it, in plan order (AGL-3040)', () => {
    const [screen] = plan().screens
    const dangling = plan({
      screens: [
        {
          ...screen,
          layout: 'new:Site frame',
          template: 'new:Service page',
          sections: [
            // A declared creation, in any case, and an inventory id are not listed.
            { name: 'services grid', uses: ['new:service card', 'cmp-card', 'new:Price table'], items: 6 },
          ],
        },
        { ...screen, slug: '/quote', sections: [{ name: 'quote form', uses: ['new:Quote request'], items: 0 }] },
      ],
    })
    expect(aiPlanUndeclaredRefs(dangling)).toEqual([
      { name: 'Site frame', path: 'screens[0].layout', screenIndex: 0, field: 'layout', sectionIndex: null },
      { name: 'Service page', path: 'screens[0].template', screenIndex: 0, field: 'template', sectionIndex: null },
      { name: 'Price table', path: 'screens[0].sections[0].uses[2]', screenIndex: 0, field: 'uses', sectionIndex: 0 },
      { name: 'Quote request', path: 'screens[1].sections[0].uses[0]', screenIndex: 1, field: 'uses', sectionIndex: 0 },
    ])
    expect(aiPlanUndeclaredRefs(plan())).toEqual([])
  })
})

describe('a record template (AGL-3475)', () => {
  const recordScreen = (record: unknown) => plan({ screens: [{ ...plan().screens[0], record: record as never }] })

  it('reads a screen that names no record, as a plan kept before record templates does, as one page', () => {
    const { record: _record, ...kept } = plan().screens[0]
    const parsed = parseAiBuildPlan(plan({ screens: [kept as never] }))
    expect(parsed.ok && parsed.plan.screens[0].record).toBeNull()
  })

  it('reads a record and stores its base as the save route does', () => {
    const parsed = parseAiBuildPlan(recordScreen({ dataset: 'ds-services', base: '/Services/Residential/' }))
    expect(parsed.ok && parsed.plan.screens[0].record).toEqual({
      dataset: 'ds-services',
      base: 'services/residential',
    })
  })

  it.each<[string, unknown, string]>([
    ['an empty dataset', { dataset: ' ', base: 'services' }, 'screens[0].record.dataset is empty'],
    ['a base that is no path', { dataset: 'ds-services', base: 'our services!' }, 'screens[0].record.base is not a path'],
    ['an empty base', { dataset: 'ds-services', base: '/' }, 'screens[0].record.base is not a path'],
  ])('refuses %s', (_label, record, error) => {
    expect(parseAiBuildPlan(recordScreen(record))).toMatchObject({
      ok: false,
      error: expect.stringContaining(error),
    })
  })

  it('holds a base to one to four lowercase segments of letters, digits and hyphens', () => {
    expect(aiPlanRecordBase('services')).toBe('services')
    expect(aiPlanRecordBase('a/b/c/d')).toBe('a/b/c/d')
    expect(aiPlanRecordBase('a/b/c/d/e')).toBeNull()
    expect(aiPlanRecordBase('roof_repair')).toBeNull()
    expect(aiPlanRecordBase(`${'x'.repeat(61)}`)).toBeNull()
  })

  it('asks every screen for its record only on a job that may bind a dataset, leaving every other plan’s bytes alone', () => {
    const screensOf = (tool: typeof AI_BUILD_PLAN_TOOL) =>
      (tool.inputSchema['properties'] as Record<string, { items: Record<string, unknown> }>)['screens'].items
    for (const tool of [AI_BUILD_PLAN_RECORDS_TOOL, AI_BUILD_PLAN_EMBEDS_RECORDS_TOOL]) {
      expect(screensOf(tool)['required']).toContain('record')
      const record = (screensOf(tool)['properties'] as Record<string, { anyOf: Array<Record<string, unknown>> }>)['record']
      expect(record.anyOf.map((branch) => branch['type'])).toEqual(['object', 'null'])
      const branch = record.anyOf[0]
      expect([branch['additionalProperties'], [...(branch['required'] as string[])].sort()]).toEqual([
        false,
        Object.keys(branch['properties'] as object).sort(),
      ])
      expect(tool.strict).toBe(true)
    }
    expect(screensOf(AI_BUILD_PLAN_TOOL)['required']).not.toContain('record')
    expect(JSON.stringify(AI_BUILD_PLAN_EMBEDS_TOOL)).not.toContain('record')
    expect(aiBuildPlanToolFor('A site for a roofer')).toBe(AI_BUILD_PLAN_TOOL)
    expect(aiBuildPlanToolFor('A site for a roofer', { records: true })).toBe(AI_BUILD_PLAN_RECORDS_TOOL)
    expect(aiBuildPlanToolFor('A roofer with a video', { records: true })).toBe(AI_BUILD_PLAN_EMBEDS_RECORDS_TOOL)
    // Its reader is the plain one: a plan answered without the field reads as one page a screen.
    expect(JSON.stringify(AI_BUILD_PLAN_EMBEDS_RECORDS_TOOL.inputSchema)).not.toMatch(/"(?:minLength|maxLength|pattern|format)"/)
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
    const objects = objectSchemas(AI_BUILD_PLAN_EMBEDS_TOOL.inputSchema)
    expect(objects.map((entry) => entry.path)).toEqual([
      'input',
      'input.reuse[]',
      'input.create[]',
      'input.screens[]',
      'input.screens[].sections[]',
      'input.embeds[]',
    ])
    for (const { path, schema } of objects) {
      expect([path, schema['additionalProperties']]).toEqual([path, false])
      expect([path, [...(schema['required'] as string[])].sort()]).toEqual([
        path,
        Object.keys(schema['properties'] as object).sort(),
      ])
    }
    expect(AI_BUILD_PLAN_TOOL.strict).toBe(true)
    expect(AI_BUILD_PLAN_EMBEDS_TOOL.strict).toBe(true)
  })

  it('carries no bound strict output refuses — the reader enforces them instead', () => {
    const text = JSON.stringify(AI_BUILD_PLAN_EMBEDS_TOOL.inputSchema)
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

  /** Every property that holds text, nullable text or a list of text, with where it sits. */
  function textFields(
    schema: unknown,
    path = 'input',
  ): Array<{ path: string; description: string }> {
    if (!schema || typeof schema !== 'object') return []
    const found: Array<{ path: string; description: string }> = []
    for (const [name, inner] of Object.entries(
      ((schema as Record<string, unknown>)['properties'] as Record<string, unknown>) ?? {},
    )) {
      const field = inner as Record<string, unknown>
      const branches = (field['anyOf'] as Array<Record<string, unknown>> | undefined) ?? [field]
      const items = field['items'] as Record<string, unknown> | undefined
      const text = branches.some((branch) => branch['type'] === 'string') || items?.['type'] === 'string'
      if (text && !field['enum']) {
        found.push({ path: `${path}.${name}`, description: String(field['description']) })
      }
      if (items) found.push(...textFields(items, `${path}.${name}[]`))
    }
    return found
  }

  it('tells the model the ceiling the reader cuts each field it writes at (AGL-3022)', () => {
    // A ceiling the model is not shown is one it writes past, and the reader
    // then ends a rationale mid-sentence, on the last word break inside it.
    const fields = textFields(AI_BUILD_PLAN_EMBEDS_TOOL.inputSchema)
    // Copied from the inventory or from a creation's name, so the length is
    // not the model's to choose.
    const references = [
      'input.reuse[].id',
      'input.create[].duplicateOf',
      'input.screens[].layout',
      'input.screens[].template',
      'input.screens[].duplicateOf',
      'input.screens[].sections[].uses',
      'input.embeds[].where',
    ]
    // Copied from the brief, where the plan step finds them (AGL-3433): a
    // prefix the reader cuts is still the brief's own words.
    const fromBrief = ['input.embeds[].asked', 'input.embeds[].url']
    // Refused by rule 10 far inside the reader's ceilings, and told as the
    // rule's own numbers; the reader's here would contradict the rule.
    const heldByRule10 = ['input.screens[].seoTitle', 'input.screens[].seoDescription']
    expect(fields.map((field) => field.path)).toEqual(
      expect.arrayContaining([...references, ...fromBrief, ...heldByRule10]),
    )
    const written = fields.filter(
      (field) =>
        !references.includes(field.path) &&
        !fromBrief.includes(field.path) &&
        !heldByRule10.includes(field.path),
    )
    // A text field added to the schema lands here until it is placed in a group.
    expect(written.map((field) => field.path)).toEqual([
      'input.reuse[].purpose',
      'input.create[].name',
      'input.create[].why',
      'input.create[].fields',
      'input.screens[].title',
      'input.screens[].slug',
      'input.screens[].sections[].name',
    ])
    for (const { path, description } of written) {
      expect([path, description]).toEqual([
        path,
        expect.stringContaining(`at most ${AI_BUILD_PLAN_LIMITS.text} characters`),
      ])
    }
    for (const { path, description } of fields.filter((field) => heldByRule10.includes(field.path))) {
      for (const ceiling of [AI_BUILD_PLAN_LIMITS.text, AI_BUILD_PLAN_LIMITS.seoDescription]) {
        expect([path, description.includes(`at most ${ceiling}`)]).toEqual([path, false])
      }
    }
  })

  it('offers the list of players only to a brief that asks for a video, leaving every other plan’s bytes alone (AGL-3433)', () => {
    const { embeds, ...plain } = AI_BUILD_PLAN_EMBEDS_TOOL.inputSchema['properties'] as Record<string, unknown>
    expect(embeds).toBeDefined()
    expect(AI_BUILD_PLAN_TOOL.inputSchema['properties']).toEqual(plain)
    expect(AI_BUILD_PLAN_TOOL.inputSchema['required']).toEqual(['reuse', 'create', 'screens'])
    expect(AI_BUILD_PLAN_EMBEDS_TOOL.name).toBe(AI_BUILD_PLAN_TOOL.name)
    for (const brief of [
      'A page template for each of our insights articles: the headline, the author and date, the article body, and a short list of related reading.',
      'A Practice Areas page for the firm.',
    ]) {
      expect(aiBuildPlanToolFor(brief)).toBe(AI_BUILD_PLAN_TOOL)
    }
    for (const brief of [
      'An About page with our intro video at the top.',
      'Put https://youtu.be/dQw4w9WgXcQ on the home page.',
      'A service page with the Vimeo walkthrough.',
    ]) {
      expect(aiBuildPlanToolFor(brief)).toBe(AI_BUILD_PLAN_EMBEDS_TOOL)
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

describe('a planned third-party player (AGL-3433)', () => {
  const embed = {
    host: 'youtube',
    where: '/about',
    asked: 'our intro video',
    url: 'https://youtu.be/dQw4w9WgXcQ',
  }

  it('reads the list, and keeps no list on a plan whose brief asked for none', () => {
    const parsed = parseAiBuildPlan({ ...plan(), embeds: [embed] })
    expect(parsed.ok && parsed.plan.embeds).toEqual([embed])
    const none = parseAiBuildPlan({ ...plan(), embeds: [] })
    expect(none.ok && 'embeds' in none.plan).toBe(false)
    const stored = parseAiBuildPlan(plan())
    expect(stored.ok && 'embeds' in stored.plan).toBe(false)
  })

  it('refuses a host it cannot play and more players than a plan holds', () => {
    expect(parseAiBuildPlan({ ...plan(), embeds: [{ ...embed, host: 'dailymotion' }] })).toEqual({
      ok: false,
      error: 'embeds[0].host is not one of youtube, vimeo',
    })
    const many = Array.from({ length: AI_BUILD_PLAN_LIMITS.embeds + 1 }, () => embed)
    expect(parseAiBuildPlan({ ...plan(), embeds: many }).ok).toBe(false)
  })

  it('finds a screen’s players by its slug however it is spelled, and a creation’s by its name', () => {
    const listed = {
      embeds: [
        { ...embed, host: 'youtube' as const },
        { ...embed, host: 'vimeo' as const, where: 'new:Crew Video', url: null },
      ],
    }
    expect(aiPlanEmbedsFor(listed, { slug: 'About/' }).map((entry) => entry.host)).toEqual(['youtube'])
    expect(aiPlanEmbedsFor(listed, { create: 'crew video' }).map((entry) => entry.host)).toEqual(['vimeo'])
    expect(aiPlanEmbedsFor(listed, { slug: '/contact' })).toEqual([])
    expect(aiPlanEmbedsFor(null, { slug: '/about' })).toEqual([])
  })

  it('reads one video however its link is spelled, and no video from a link neither host plays', () => {
    for (const link of [
      'https://youtu.be/dQw4w9WgXcQ',
      'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      'https://m.youtube.com/watch?v=dQw4w9WgXcQ&t=4',
      'https://www.youtube.com/embed/dQw4w9WgXcQ',
      'https://www.youtube.com/shorts/dQw4w9WgXcQ',
    ]) {
      expect([link, aiEmbedVideoKey(link)]).toEqual([link, 'youtube:dQw4w9WgXcQ'])
    }
    expect(aiEmbedVideoKey('https://vimeo.com/123456789')).toBe('vimeo:123456789')
    expect(aiEmbedVideoKey('https://player.vimeo.com/video/123456789')).toBe('vimeo:123456789')
    for (const link of ['http://youtu.be/dQw4w9WgXcQ', 'https://video.example.com/x', '{{entry.coverVideo}}', 'not a link']) {
      expect([link, aiEmbedVideoKey(link)]).toEqual([link, null])
    }
  })
})
