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
  auditNodeCapabilities,
  estimateCatalogTokens,
  nodeCapabilityProps,
  type AiNodeCapability,
} from './ai-palette'
import {
  AI_NODE_CAPABILITIES,
  AI_PALETTE,
  AI_PALETTE_CATALOG,
  AI_SURFACES,
  AI_SX_TOKENS,
  AI_UNDECLARED_FIELD_KINDS,
} from './ai-palette.generated'
import { NODE_CAPABILITIES } from '@aglyn/aglyn/app-utils/node-capabilities'
import {
  MARKETPLACE_COMPONENT_ID_ALLOWLIST,
  MARKETPLACE_EMAIL_STARTER_COMPONENT_ID_ALLOWLIST,
} from '@aglyn/aglyn/app-utils/node-definition-sanitizer'

/**
 * Every component the palette carries. That the palette agrees with the
 * runtime registry — the ids, each schema's plugin, name, restrictions,
 * child contract and attributes — is `check:ai-palette`'s to prove: the
 * generator walks the real `*_BUNDLE` arrays from `tools/`, and a plugin
 * may not import another plugin's bundle to walk them here.
 */
const REGISTRY = new Set(Object.keys(AI_PALETTE))

/** Elements a model must never be offered, whatever list they sit on. */
const NEVER_OFFERED = [
  'custom-html',
  'functionWidget',
  'functionScope',
  'functionInput',
  'functionOutput',
  'functionShow',
  'div',
  'reusableInstance',
  'marketplacePlugin',
  'emailHtml',
  'emailRichtext',
]

describe('AI_PALETTE agrees with the runtime registry (AGL-2905)', () => {
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
    // A component may also place an Icon, bound to an icon the site owner picks (AGL-3054).
    expect(AI_SURFACES.component.allow).toEqual([...AI_SURFACES.screen.allow, 'icon'].sort())
    expect(AI_SURFACES.screen.allow).not.toContain('icon')
    expect(AI_SURFACES.layout.allow).not.toContain('icon')
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

/**
 * Every field kind the palette carries SOMEWHERE, derived from the generated
 * entries rather than restated: an attribute drawn with one of these is a prop
 * the generator knows how to declare, so dropping it is a loss and not a
 * choice.
 */
const OFFERED_FIELD_KINDS = new Set([
  ...Object.values(AI_PALETTE).flatMap((entry) =>
    Object.values(entry.propFields),
  ),
  ...Object.values(AI_NODE_CAPABILITIES).flatMap((capability) =>
    Object.values(capability.propFields),
  ),
])

/**
 * The one rule covering both gaps this palette has had (AGL-3156, AGL-3164).
 *
 * Two different holes, one generator. Repeat was a capability that belonged to
 * no component, so reading component schemas found nothing to declare. Tabs'
 * "Opens on" was a `select` whose answers are resolved when the field is
 * drawn, so the branch that needs a static option list turned it away — while
 * selects were being declared all over the same palette. Both left the model
 * unable to set something the besigner offers, and in both cases every guard
 * stayed green.
 *
 * What they share is the shape: a field kind the palette CAN express, dropped
 * somewhere it could have been declared. A kind that is genuinely off the
 * palette — a picker choosing a record the site holds — is dropped everywhere
 * and declared nowhere, so the two sets never meet unless something is wrong.
 */
describe('no field kind is both declared and dropped (AGL-3156, AGL-3164)', () => {
  it('turns away only kinds it declares nowhere', () => {
    expect(
      AI_UNDECLARED_FIELD_KINDS.filter((kind) => OFFERED_FIELD_KINDS.has(kind)),
    ).toEqual([])
  })

  it('still turns away the pickers that choose a record the site holds', () => {
    // The rule is disjointness, not emptiness: these are off the palette on
    // purpose, because their value names a form, a dataset, a product or a
    // node that a model cannot know from a description.
    expect(AI_UNDECLARED_FIELD_KINDS).toEqual(
      expect.arrayContaining([
        'dataset-select',
        'form-select',
        'node-select',
        'product-select',
      ]),
    )
    expect([...AI_UNDECLARED_FIELD_KINDS]).toEqual(
      [...AI_UNDECLARED_FIELD_KINDS].sort(),
    )
  })
})

/**
 * The regression AGL-3156 records: AGL-3111 made repeat a node capability and
 * took the four Repeat fields off Stack's schema, the generator reads
 * component schemas, and so a clean regeneration dropped every repeat prop —
 * `repeat` mentions in the generated palette fell from 16 to 4, and the four
 * survivors were one component's prose. `check:ai-palette` stayed green
 * throughout, because the generated file did match the generator's output for
 * its inputs; what had changed was the inputs. These read the core
 * declarations instead and ask whether the palette still accounts for them.
 */
describe('AI_NODE_CAPABILITIES carries what core declares (AGL-3156)', () => {
  it('accounts for every declared capability and every attribute of one', () => {
    expect(
      auditNodeCapabilities(
        NODE_CAPABILITIES,
        AI_NODE_CAPABILITIES,
        OFFERED_FIELD_KINDS,
      ),
    ).toEqual([])
  })

  it('offers repeat on every element, not on one of them', () => {
    // The shape AGL-3111 was right to reach for and AGL-3156 restores: the
    // capability is declared once, and no component schema names it.
    const repeat = AI_NODE_CAPABILITIES['repeat']
    expect(Object.keys(repeat.propsSchema.properties).sort()).toEqual([
      'repeatFilter',
      'repeatLimit',
      'repeatSelf',
      'repeatSort',
    ])
    for (const name of ['repeatLimit', 'repeatFilter', 'repeatSort']) {
      expect(repeat.propsSchema.properties[name]).toEqual({
        type: 'string',
        maxLength: 200,
      })
      expect(repeat.propRoles[name]).toBe('text')
      expect(repeat.propFields[name]).toBe('text-field')
    }
    expect(repeat.propsSchema.properties['repeatSelf'].enum).toEqual([
      'false',
      'true',
    ])
    // The scope reads the same on a leaf whichever way it is set, so it is
    // offered only where the two readings differ — as the panel offers it.
    expect(repeat.childrenOnlyProps).toEqual(['repeatSelf'])
    for (const entry of Object.values(AI_PALETTE)) {
      expect(Object.keys(entry.propsSchema.properties)).not.toContain(
        'repeatLimit',
      )
    }
  })

  it('gives a node with children the scope prop, and a leaf the bounds alone', () => {
    expect(
      Object.keys(nodeCapabilityProps(AI_NODE_CAPABILITIES, true).properties).sort(),
    ).toEqual(['repeatFilter', 'repeatLimit', 'repeatSelf', 'repeatSort'])
    expect(
      Object.keys(nodeCapabilityProps(AI_NODE_CAPABILITIES, false).properties).sort(),
    ).toEqual(['repeatFilter', 'repeatLimit', 'repeatSort'])
    expect(nodeCapabilityProps(AI_NODE_CAPABILITIES, false).textLimits).toEqual({
      repeatFilter: 200,
      repeatLimit: 200,
      repeatSort: 200,
    })
  })

  it('keeps the capabilities out of the surface catalogs, which is priced and not an oversight', () => {
    // A catalog rides in the cached prefix of every pass of every generation
    // job, and a repeat's bounds are unusable to a generator composing from
    // nothing: what a node repeats OVER is picked from the datasets the site
    // holds, which no model writes. Naming them there cost 72 tokens a pass —
    // two credits on the Free page the wall is proven with, which keeps two.
    // They are named instead where the element already exists: the assist
    // editor's canvas context (`assist-edit.ts`).
    for (const surface of AI_SURFACE_NAMES) {
      expect(AI_PALETTE_CATALOG[surface]).not.toContain('Node capabilities')
      expect(AI_PALETTE_CATALOG[surface]).not.toContain('repeatLimit')
    }
  })
})

/**
 * The audit itself, on made-up data, because a guard that has only ever been
 * seen passing is a guard nobody has tested. Each case is the regression in
 * miniature.
 */
describe('auditNodeCapabilities reports a capability the palette lost (AGL-3156)', () => {
  const DECLARED = [
    {
      id: 'repeat',
      label: 'Repeat',
      attributes: [
        { name: 'repeatLimit', component: 'text-field' },
        { name: 'repeatDataset', component: 'dataset-select' },
      ],
    },
  ]
  const CARRIED: Record<string, AiNodeCapability> = {
    repeat: {
      id: 'repeat',
      displayName: 'Repeat',
      summary: 'Renders an element once per record.',
      propsSchema: {
        type: 'object',
        properties: { repeatLimit: { type: 'string', maxLength: 200 } },
        required: [],
        additionalProperties: false,
      },
      propRoles: { repeatLimit: 'text' },
      propFields: { repeatLimit: 'text-field' },
      textLimits: { repeatLimit: 200 },
      childrenOnlyProps: [],
      omittedProps: ['repeatDataset'],
    },
  }
  const KINDS = new Set(['text-field', 'select', 'switch'])

  it('passes while the palette carries the capability', () => {
    expect(auditNodeCapabilities(DECLARED, CARRIED, KINDS)).toEqual([])
  })

  it('fails when the capability belongs to no component and so reaches no bundle', () => {
    // Exactly AGL-3156: the generator read component schemas, repeat was on
    // none of them, and the palette came out without it.
    expect(auditNodeCapabilities(DECLARED, {}, KINDS)).toEqual([
      'the palette carries no node capability "repeat": a model cannot use it at all',
    ])
  })

  it('fails when a declared prop quietly stops being offered', () => {
    const lost: Record<string, AiNodeCapability> = {
      repeat: {
        ...CARRIED['repeat'],
        propsSchema: {
          ...CARRIED['repeat'].propsSchema,
          properties: {},
        },
      },
    }
    expect(auditNodeCapabilities(DECLARED, lost, KINDS)).toEqual([
      'node capability "repeat" is carried with no prop a model can write',
      'node capability "repeat" declares "repeatLimit", which the palette neither offers nor records as omitted',
    ])
  })

  it('fails when a prop the palette can express is written off as omitted', () => {
    const excused: Record<string, AiNodeCapability> = {
      repeat: {
        ...CARRIED['repeat'],
        propsSchema: { ...CARRIED['repeat'].propsSchema, properties: {} },
        omittedProps: ['repeatLimit', 'repeatDataset'],
      },
    }
    expect(auditNodeCapabilities(DECLARED, excused, KINDS)).toEqual([
      'node capability "repeat" is carried with no prop a model can write',
      'node capability "repeat" omits "repeatLimit", whose "text-field" field the palette offers elsewhere',
    ])
  })

  it('fails when the palette keeps a capability core has dropped', () => {
    expect(auditNodeCapabilities([], CARRIED, KINDS)).toEqual([
      'the palette carries node capability "repeat", which core no longer declares',
    ])
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
