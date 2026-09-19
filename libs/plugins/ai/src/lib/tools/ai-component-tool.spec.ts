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

import type { ReusableComponentPropType } from '@aglyn/aglyn/foundation/definitions/platform.types'
import {
  REUSABLE_PROP_KIND_GROUPS,
  REUSABLE_PROP_KINDS,
} from '@aglyn/aglyn/foundation/definitions/property-kinds'
import { aiDoctrineTreeTool } from '../runtime/ai-doctrine'
import {
  AI_COMPONENT_MAX_PROPS,
  AI_COMPONENT_PROP_KINDS,
  AI_COMPONENT_PROP_KINDS_NOT_OFFERED,
  AI_COMPONENT_TOOL_NAME,
  aiComponentTool,
  readAiComponentProps,
} from './ai-component-tool'

/**
 * The component tool (AGL-2908) declares properties with the Properties
 * dialog's own kinds, in both directions, and reads what a model declared
 * into the shape the dialog stores.
 */

type SchemaObject = {
  type: string
  additionalProperties?: boolean
  required?: string[]
  properties?: Record<string, SchemaObject & { enum?: string[]; description?: string; items?: SchemaObject }>
  items?: SchemaObject
}

describe('the component tool’s kinds are the Properties dialog’s (AGL-2908)', () => {
  const dialogKinds = Object.keys(REUSABLE_PROP_KINDS) as ReusableComponentPropType[]

  it('offers or excuses, with a reason, every kind the dialog declares, and names none the dialog does not', () => {
    const excused = Object.keys(AI_COMPONENT_PROP_KINDS_NOT_OFFERED)
    // The dialog to the tool: each kind is offered or excused, never both and never neither.
    for (const kind of dialogKinds) {
      const offered = (AI_COMPONENT_PROP_KINDS as readonly string[]).includes(kind)
      expect([kind, offered !== excused.includes(kind)]).toEqual([kind, true])
    }
    // The tool to the dialog: nothing offered or excused that the dialog lacks.
    for (const kind of [...AI_COMPONENT_PROP_KINDS, ...excused]) {
      expect([kind, (dialogKinds as string[]).includes(kind)]).toEqual([kind, true])
    }
    for (const [kind, reason] of Object.entries(AI_COMPONENT_PROP_KINDS_NOT_OFFERED)) {
      expect([kind, /\S.*\.$/.test(reason)]).toEqual([kind, true])
    }
  })

  it('offers the issue’s kinds and the Choice a dropdown binds to, in the order the dialog lists them', () => {
    expect([...AI_COMPONENT_PROP_KINDS]).toEqual([
      'text',
      'richText',
      'image',
      'href',
      'icon',
      'number',
      'boolean',
      'choice',
    ])
    const listed = REUSABLE_PROP_KIND_GROUPS.flatMap((group) =>
      dialogKinds.filter((kind) => REUSABLE_PROP_KINDS[kind].group === group),
    )
    expect([...AI_COMPONENT_PROP_KINDS]).toEqual(
      listed.filter((kind) => (AI_COMPONENT_PROP_KINDS as readonly string[]).includes(kind)),
    )
  })

  it('carries the offered kinds in its strict schema, with the names a page reads, beside the doctrine’s own tree', () => {
    const tool = aiComponentTool()
    const doctrine = aiDoctrineTreeTool('component')
    expect(tool.name).toBe(AI_COMPONENT_TOOL_NAME)
    expect(tool.name).toBe(doctrine.name)
    expect(tool.strict).toBe(true)
    const schema = tool.inputSchema as SchemaObject
    expect(schema.properties?.['tree']).toEqual((doctrine.inputSchema as SchemaObject).properties?.['tree'])
    const item = schema.properties?.['props']?.items as SchemaObject
    const type = item.properties?.['type']
    expect(type?.enum).toEqual([...AI_COMPONENT_PROP_KINDS])
    for (const kind of AI_COMPONENT_PROP_KINDS) {
      expect(type?.description).toContain(`${kind} (${REUSABLE_PROP_KINDS[kind].label})`)
    }
    // Every object closes and requires every property it declares.
    for (const object of [schema, item, item.properties?.['options']?.items as SchemaObject]) {
      expect(object.additionalProperties).toBe(false)
      expect([...(object.required ?? [])].sort()).toEqual(Object.keys(object.properties ?? {}).sort())
    }
  })
})

describe('readAiComponentProps (AGL-2908)', () => {
  const scope = { screenIds: new Set(['scr-contact']) }
  const read = (props: unknown) => readAiComponentProps({ props }, scope)
  const entry = (patch: Record<string, unknown>) => ({
    name: 'headline',
    type: 'text',
    label: 'Headline',
    description: '',
    defaultValue: '[Headline]',
    options: [],
    ...patch,
  })

  it('stores each default in its kind’s own type, with only the fields the kind uses, as the dialog saves a property', () => {
    const reading = read([
      entry({}),
      entry({ name: 'body', type: 'richText', label: 'Body', description: 'Two sentences.', defaultValue: '[What you do]' }),
      entry({ name: 'photo', type: 'image', label: 'Photo', defaultValue: '' }),
      entry({ name: 'link', type: 'href', label: 'Link', defaultValue: 'scr-contact' }),
      entry({ name: 'path', type: 'href', label: 'Path', defaultValue: '/contact' }),
      entry({ name: 'count', type: 'number', label: 'Count', defaultValue: '3' }),
      entry({ name: 'hideBadge', type: 'boolean', label: 'Hide badge', defaultValue: 'false' }),
      entry({
        name: 'style',
        type: 'choice',
        label: 'Style',
        defaultValue: 'outlined',
        options: [
          { value: 'contained', label: 'Filled' },
          { value: 'outlined', label: 'outlined' },
        ],
      }),
    ])
    expect(reading.violations).toEqual([])
    expect(reading.refused).toEqual([])
    expect(reading.props).toEqual([
      { name: 'headline', type: 'text', label: 'Headline', defaultValue: '[Headline]' },
      { name: 'body', type: 'richText', label: 'Body', description: 'Two sentences.', defaultValue: '[What you do]' },
      { name: 'photo', type: 'image', label: 'Photo' },
      { name: 'link', type: 'href', label: 'Link', defaultValue: 'scr-contact' },
      { name: 'path', type: 'href', label: 'Path', defaultValue: '/contact' },
      { name: 'count', type: 'number', label: 'Count', defaultValue: 3 },
      { name: 'hideBadge', type: 'boolean', label: 'Hide badge', defaultValue: false },
      {
        name: 'style',
        type: 'choice',
        label: 'Style',
        defaultValue: 'outlined',
        options: [{ value: 'contained', label: 'Filled' }, { value: 'outlined' }],
      },
    ])
  })

  it('refuses a name a property cannot have, a second property of one name, and a kind the dialog has that is not offered', () => {
    const reading = read([
      entry({ name: 'hero.title' }),
      entry({}),
      entry({ label: 'Again' }),
      entry({ name: 'accent', type: 'color-picker' }),
    ])
    expect(reading.violations.map((violation) => [violation.code, violation.paths])).toEqual([
      ['prop-name', ['props[0].name']],
      ['prop-duplicate', ['props[2].name']],
      ['prop-kind', ['props[3].type']],
    ])
    expect(reading.violations[2].message).toContain('Text, Long text, Image, Link, Icon, Number, Yes / no, Choice')
    expect(reading.props.map((prop) => prop.name)).toEqual(['headline'])
    expect(reading.refused).toEqual(['accent'])
  })

  it('stores an icon with no default, for the site owner to pick, and refuses one a model names (AGL-3054)', () => {
    expect(read([entry({ name: 'icon', type: 'icon', label: 'Icon', defaultValue: '' })])).toEqual({
      props: [{ name: 'icon', type: 'icon', label: 'Icon' }],
      refused: [],
      violations: [],
    })
    const named = read([entry({ name: 'icon', type: 'icon', label: 'Icon', defaultValue: 'mdiScaleBalance' })])
    expect(named.violations).toEqual([
      {
        rule: 1,
        code: 'prop-default',
        message: 'The default of "icon" is an icon, which the site owner picks; leave it "".',
        paths: ['props[0].defaultValue'],
      },
    ])
    expect(named.refused).toEqual(['icon'])
  })

  it('refuses a Choice with no answers, answers that share a value, and a default that is none of them', () => {
    const reading = read([
      entry({ name: 'bare', type: 'choice', defaultValue: '', options: [] }),
      entry({
        name: 'twice',
        type: 'choice',
        defaultValue: 'a',
        options: [{ value: 'a', label: 'A' }, { value: 'a', label: 'Also A' }],
      }),
      entry({
        name: 'stray',
        type: 'choice',
        defaultValue: 'c',
        options: [{ value: 'a', label: 'A' }, { value: 'b', label: 'B' }],
      }),
    ])
    expect(reading.violations.map((violation) => [violation.code, violation.paths?.[0]])).toEqual([
      ['prop-answers', 'props[0].options'],
      ['prop-answers', 'props[1].options'],
      ['prop-default', 'props[2].defaultValue'],
    ])
    expect(reading.refused).toEqual(['bare', 'twice', 'stray'])
  })

  it('refuses a picture from another website (rule 9), a link to nowhere, a Yes / no that is neither, and markup', () => {
    const reading = read([
      entry({ name: 'photo', type: 'image', defaultValue: 'https://images.example.com/a.jpg' }),
      entry({ name: 'link', type: 'href', defaultValue: 'contact-us' }),
      entry({ name: 'wide', type: 'boolean', defaultValue: 'yes' }),
      entry({ name: 'count', type: 'number', defaultValue: 'three' }),
      entry({ name: 'blurb', defaultValue: '<script>alert(1)</script>' }),
    ])
    expect(reading.violations.map((violation) => [violation.rule, violation.code])).toEqual([
      [9, 'prop-default'],
      [1, 'prop-default'],
      [1, 'prop-default'],
      [1, 'prop-default'],
      [1, 'prop-default'],
    ])
    expect(reading.props).toEqual([])
    expect(reading.refused).toEqual(['photo', 'link', 'wide', 'count', 'blurb'])
  })

  it('holds one component to its most properties, and reads a missing list as a finding and an empty one as none', () => {
    expect(readAiComponentProps({}, scope).violations.map((violation) => violation.code)).toEqual([
      'props-missing',
    ])
    expect(read([])).toEqual({ props: [], refused: [], violations: [] })
    const many = Array.from({ length: AI_COMPONENT_MAX_PROPS + 2 }, (_, index) =>
      entry({ name: `line${index}` }),
    )
    const reading = read(many)
    expect(reading.violations.map((violation) => violation.code)).toEqual(['props-over-limit'])
    expect(reading.props).toHaveLength(AI_COMPONENT_MAX_PROPS)
  })
})
