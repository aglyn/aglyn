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

import { FieldComponentType } from '@aglyn/aglyn/foundation/definitions/components.types'
import type { ReusableComponentProp } from '@aglyn/aglyn/foundation/definitions/platform.types'
import {
  attributeFieldValueShape,
  reusablePropBindsToField,
} from '@aglyn/aglyn/foundation/definitions/property-kinds'
import { AI_COMPONENT_PROP_KINDS } from '../tools/ai-component-tool'
import {
  aiComponentPropBindsToField,
  aiComponentPropNamesIn,
  aiComponentUnofferedAnswers,
  isAiComponentPropToken,
  type AiComponentPropPlacement,
} from './ai-component-bindings'
import type { AiPaletteEntry } from './ai-palette'
import { AI_PALETTE } from './ai-palette.generated'

/**
 * Which field of a generated component may carry which of its properties
 * (AGL-2908), held over the whole generated palette to the judgment the
 * Attributes panel makes when it offers a field's `{}` (AGL-2871).
 */

const bind = (
  type: string,
  entry: AiPaletteEntry | undefined,
  field: string,
  placement: AiComponentPropPlacement,
): boolean =>
  aiComponentPropBindsToField({ name: 'p', type } as ReusableComponentProp, entry, field, placement)

describe('the palette records the field each prop is edited with (AGL-2908)', () => {
  it('names an attribute field kind for every prop an element declares, and nothing else', () => {
    const kinds = new Set<string>(Object.values(FieldComponentType))
    for (const [id, entry] of Object.entries(AI_PALETTE)) {
      expect([id, Object.keys(entry.propFields).sort()]).toEqual([
        id,
        Object.keys(entry.propsSchema.properties).sort(),
      ])
      for (const [prop, field] of Object.entries(entry.propFields)) {
        expect([id, prop, kinds.has(field)]).toEqual([id, prop, true])
      }
    }
  })
})

describe('aiComponentPropBindsToField (AGL-2908)', () => {
  it('agrees with the Attributes panel on every palette field that is not typed into, as a whole value only', () => {
    let judged = 0
    for (const [id, entry] of Object.entries(AI_PALETTE)) {
      for (const [prop, component] of Object.entries(entry.propFields)) {
        const schema = entry.propsSchema.properties[prop]
        const options = schema.enum?.map((value) => ({ value }))
        const field = { component, ...(options ? { options } : {}) }
        if (attributeFieldValueShape(field) === undefined) continue
        for (const type of AI_COMPONENT_PROP_KINDS) {
          const candidate = {
            name: 'p',
            type,
            ...(type === 'choice' ? { options: options ?? [{ value: 'a' }] } : {}),
          } as ReusableComponentProp
          judged += 1
          expect([id, prop, type, aiComponentPropBindsToField(candidate, entry, prop, 'whole')]).toEqual([
            id,
            prop,
            type,
            reusablePropBindsToField(candidate, field),
          ])
          expect([id, prop, type, aiComponentPropBindsToField(candidate, entry, prop, 'inside')]).toEqual([
            id,
            prop,
            type,
            false,
          ])
        }
      }
    }
    expect(judged).toBeGreaterThan(100)
  })

  it('holds a field that is typed into to copy, a picture or a link, by what the field holds', () => {
    const typography = AI_PALETTE['muiTypography']
    const button = AI_PALETTE['muiButton']
    const image = AI_PALETTE['image']
    for (const type of ['text', 'richText', 'number']) {
      expect([type, bind(type, typography, 'children', 'whole'), bind(type, typography, 'children', 'inside')]).toEqual([
        type,
        true,
        true,
      ])
    }
    for (const type of ['image', 'href', 'boolean', 'choice']) {
      expect([type, bind(type, typography, 'children', 'whole')]).toEqual([type, false])
    }
    expect(bind('href', button, 'href', 'whole')).toBe(true)
    expect(bind('href', button, 'href', 'inside')).toBe(false)
    expect(bind('text', button, 'href', 'whole')).toBe(false)
    expect(bind('image', image, 'src', 'whole')).toBe(true)
    expect(bind('image', image, 'src', 'inside')).toBe(false)
    expect(bind('text', image, 'src', 'whole')).toBe(false)
    // A screen picker is not typed into: it takes a Link, whole.
    expect(bind('href', button, 'screenId', 'whole')).toBe(true)
    expect(bind('text', button, 'screenId', 'whole')).toBe(false)
  })

  it('takes a Yes / no on hideIf and a Link on hideUnless, each as the whole value', () => {
    const image = AI_PALETTE['image']
    expect(bind('boolean', image, 'hideIf', 'whole')).toBe(true)
    expect(bind('boolean', image, 'hideIf', 'inside')).toBe(false)
    expect(bind('text', image, 'hideIf', 'whole')).toBe(false)
    expect(bind('href', image, 'hideUnless', 'whole')).toBe(true)
    expect(bind('boolean', image, 'hideUnless', 'whole')).toBe(false)
  })

  it('binds nothing to a prop the element does not declare, a field no offered kind takes, or an unknown element', () => {
    const button = AI_PALETTE['muiButton']
    expect(button.propFields['startIconId']).toBe(FieldComponentType.ICON_PICKER)
    for (const type of AI_COMPONENT_PROP_KINDS) {
      expect([type, bind(type, button, 'startIconId', 'whole')]).toEqual([type, false])
    }
    expect(bind('text', button, 'onClick', 'whole')).toBe(false)
    expect(bind('text', undefined, 'children', 'whole')).toBe(false)
  })
})

describe('aiComponentUnofferedAnswers (AGL-2871)', () => {
  it('lists the answers a dropdown does not offer, and none for a kind without answers', () => {
    const button = AI_PALETTE['muiButton']
    const choice = {
      name: 'style',
      type: 'choice',
      options: [{ value: 'contained' }, { value: 'fancy' }],
    } as ReusableComponentProp
    expect(aiComponentUnofferedAnswers(choice, button, 'variant')).toEqual(['fancy'])
    expect(aiComponentUnofferedAnswers({ name: 'label', type: 'text' }, button, 'variant')).toEqual([])
    expect(aiComponentUnofferedAnswers(choice, button, 'children')).toEqual([])
  })
})

describe('component property tokens (AGL-2908)', () => {
  it('reads a whole token, and each name a value carries, once', () => {
    expect(isAiComponentPropToken(' {{ prop.headline }} ')).toBe(true)
    expect(isAiComponentPropToken('Hello {{prop.name}}')).toBe(false)
    expect(isAiComponentPropToken('{{entry.title}}')).toBe(false)
    expect(aiComponentPropNamesIn('{{prop.name}}, {{prop.role}} and {{prop.name}} on {{entry.title}}')).toEqual([
      'name',
      'role',
    ])
    expect(aiComponentPropNamesIn(3)).toEqual([])
  })
})
