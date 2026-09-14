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
  AI_PALETTE_CATALOG_MAX_TOKENS,
  AI_SURFACE_NAMES,
  estimateCatalogTokens,
} from '@aglyn/aglyn/app-utils/ai-palette'
import {
  AI_PALETTE,
  AI_PALETTE_CATALOG,
  AI_SURFACES,
  AI_SX_TOKENS,
} from '@aglyn/aglyn/app-utils/ai-palette.generated'
import { schemaAcceptsChildren } from '@aglyn/aglyn/app-utils/child-contract'
import { BOOKINGS_BUNDLE } from '@aglyn/plugins-bookings/plugin'
import { COMMERCE_BUNDLE } from '@aglyn/plugins-commerce/plugin'
import { EMAIL_BUNDLE } from '@aglyn/plugins-email/plugin'
import { EVENTS_CALENDAR_BUNDLE } from '@aglyn/plugins-events-calendar/plugin'
import { FORMS_BUNDLE } from '@aglyn/plugins-forms/plugin'
import { MUI_BUNDLE } from '@aglyn/plugins-mui/plugin'

import {
  MARKETPLACE_COMPONENT_ID_ALLOWLIST,
  MARKETPLACE_EMAIL_STARTER_COMPONENT_ID_ALLOWLIST,
} from './marketplace'

/** Every schema the runtime registers, keyed by component id. */
const REGISTRY = new Map(
  [
    ...MUI_BUNDLE,
    ...EMAIL_BUNDLE,
    ...FORMS_BUNDLE,
    ...COMMERCE_BUNDLE,
    ...BOOKINGS_BUNDLE,
    ...EVENTS_CALENDAR_BUNDLE,
  ].map((entry) => [entry.schema.$id as string, entry.schema]),
)

/** Elements a model must never be offered, whatever list they sit on. */
const NEVER_OFFERED = [
  'custom-html',
  'functionWidget',
  'div',
  'reusableInstance',
  'marketplacePlugin',
  'emailHtml',
  'emailRichtext',
]

describe('AI_PALETTE agrees with the runtime registry (AGL-2905)', () => {
  it('lists exactly the registered component ids', () => {
    expect(Object.keys(AI_PALETTE).sort()).toEqual([...REGISTRY.keys()].sort())
  })

  it('carries each schema’s plugin, name, restrictions and child contract', () => {
    for (const [id, schema] of REGISTRY) {
      const entry = AI_PALETTE[id]
      expect(entry.pluginId).toBe(schema.pluginId)
      expect(entry.displayName).toBe(schema.displayName)
      expect(entry.acceptsChildren).toBe(schemaAcceptsChildren(schema))
      expect(entry.restrictChildren ?? null).toEqual(
        schema.restrictChildren
          ? JSON.parse(JSON.stringify(schema.restrictChildren))
          : null,
      )
      expect(entry.restrictParent ?? null).toEqual(
        schema.restrictParent
          ? JSON.parse(JSON.stringify(schema.restrictParent))
          : null,
      )
    }
  })

  it('declares only props the schema has an attribute for', () => {
    for (const [id, schema] of REGISTRY) {
      const names = new Set<string>()
      const collect = (attributes: unknown) => {
        for (const attribute of Array.isArray(attributes) ? attributes : []) {
          if (typeof attribute?.name === 'string') names.add(attribute.name)
          collect(attribute?.fields)
        }
      }
      collect(schema.attributes)
      for (const prop of Object.keys(AI_PALETTE[id].propsSchema.properties)) {
        expect(names).toContain(prop)
      }
      expect(AI_PALETTE[id].propsSchema.additionalProperties).toBe(false)
    }
  })

  it('names, in every surface, only registered components and never the excluded ones', () => {
    for (const surface of AI_SURFACE_NAMES) {
      const { root, allow } = AI_SURFACES[surface]
      expect(REGISTRY.has(root)).toBe(true)
      for (const id of allow) {
        expect(REGISTRY.has(id)).toBe(true)
        expect(NEVER_OFFERED).not.toContain(id)
      }
      expect([...allow]).toEqual([...new Set(allow)].sort())
    }
  })

  it('builds the page palette over the marketplace allowlist', () => {
    for (const id of MARKETPLACE_COMPONENT_ID_ALLOWLIST) {
      expect(AI_SURFACES.screen.allow).toContain(id)
    }
    expect(AI_SURFACES.component.allow).toEqual(AI_SURFACES.screen.allow)
    expect(AI_SURFACES.layout.allow).toEqual(
      [...AI_SURFACES.screen.allow, 'layoutSlot'].sort(),
    )
    expect(AI_SURFACES.screen.allow).not.toContain('layoutSlot')
  })

  it('builds the email palette over the starter allowlist', () => {
    expect([...AI_SURFACES.email.allow]).toEqual(
      [...MARKETPLACE_EMAIL_STARTER_COMPONENT_ID_ALLOWLIST].sort(),
    )
  })

  it('offers the form palette as the form components', () => {
    expect(AI_SURFACES.form).toEqual({
      root: 'form',
      allow: ['form', 'formField'],
    })
  })

  it('offers no element whose props carry raw HTML', () => {
    for (const surface of AI_SURFACE_NAMES) {
      for (const id of AI_SURFACES[surface].allow) {
        expect(
          Object.keys(AI_PALETTE[id].propsSchema.properties),
        ).not.toContain('html')
        expect(
          Object.keys(AI_PALETTE[id].propsSchema.properties),
        ).not.toContain('css')
      }
    }
  })

  it('reads its theme vocabulary off the theme sources', () => {
    expect(AI_SX_TOKENS.breakpoints).toEqual(['xs', 'sm', 'md', 'lg', 'xl'])
    expect(AI_SX_TOKENS.palette).toEqual(
      expect.arrayContaining([
        'primary.main',
        'secondary.main',
        'text.primary',
        'background.paper',
      ]),
    )
    expect(AI_SX_TOKENS.typographyVariants).toEqual(
      expect.arrayContaining(['h1', 'body1', 'caption']),
    )
  })
})

describe('AI_PALETTE_CATALOG stays inside its prompt budget (AGL-2905)', () => {
  it.each(AI_SURFACE_NAMES)('%s is under the token ceiling', (surface) => {
    const catalog = AI_PALETTE_CATALOG[surface]
    expect(estimateCatalogTokens(catalog)).toBeLessThanOrEqual(
      AI_PALETTE_CATALOG_MAX_TOKENS,
    )
    for (const id of AI_SURFACES[surface].allow) {
      expect(catalog).toContain(`- ${id} (`)
    }
    expect(catalog).toContain(`Surface: ${surface}.`)
  })
})
