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

/**
 * Generates the element palette a model composes from (AGL-2905). Source of
 * truth: the component bundles every plugin registers. Emits one GENERATED
 * file:
 *
 *   libs/plugins/ai/src/lib/runtime/ai-palette.generated.ts
 *
 * It walks the REAL registry — the `*_BUNDLE` arrays the plugin loaders
 * register at runtime — rather than a hand list, so a component added to a
 * bundle appears in the palette on the next run and a component removed from
 * one leaves it. From each schema it derives a JSON-Schema-shaped prop
 * declaration (the attribute fields, their option lists and validators), the
 * child and parent restrictions the besigner enforces, and a compact catalog
 * line for the system prompt. Re-run after editing a plugin bundle:
 *
 *   node tools/scripts/generate-ai-palette.mts          (write the file)
 *   node tools/scripts/generate-ai-palette.mts --check  (fail if stale; CI)
 *
 * The bundles are React component modules, so loading them needs TypeScript,
 * JSX, the `@aglyn/*` path aliases and a tolerance for packages that ship ESM
 * syntax under a CommonJS package (`mobx-utils/lib`). Node's own loader
 * refuses the last of those, so the bundles are loaded through jiti with the
 * aliases read from tsconfig.base.json; nothing is rendered.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '../..')
const OUT = join(ROOT, 'libs/plugins/ai/src/lib/runtime/ai-palette.generated.ts')

const require = createRequire(join(ROOT, 'package.json'))
const { createJiti } = require('jiti')
const prettier = require('prettier')

type Dict = Record<string, any>

/**
 * The `@aglyn/*` aliases, in the prefix form jiti resolves: a wildcard path
 * becomes a directory prefix, a bare one a file.
 */
function readAliases(): Record<string, string> {
  const base = JSON.parse(
    readFileSync(join(ROOT, 'tsconfig.base.json'), 'utf8'),
  )
  const alias: Record<string, string> = {}
  const paths = base.compilerOptions.paths as Record<string, string[]>
  for (const [key, targets] of Object.entries(paths)) {
    const target = targets[0].replace(/^\.\//, '')
    if (key.endsWith('/*')) {
      alias[key.slice(0, -1)] = join(ROOT, target.replace(/\/?\*$/, '')) + '/'
    } else {
      alias[key] = join(ROOT, target)
    }
  }
  return alias
}

const jiti = createJiti(join(ROOT, 'package.json'), {
  alias: readAliases(),
  jsx: true,
  interopDefault: true,
  moduleCache: true,
  fsCache: false,
  sourceMaps: false,
})

async function load(file: string): Promise<Dict> {
  return jiti.import(join(ROOT, file)) as Promise<Dict>
}

/** Every bundle a plugin registers, by plugin directory. */
const BUNDLE_FILES: ReadonlyArray<[pluginId: string, file: string]> = [
  ['mui', 'libs/plugins/mui/src/lib/plugin.ts'],
  ['email', 'libs/plugins/email/src/lib/plugin.ts'],
  ['forms', 'libs/plugins/forms/src/lib/plugin.ts'],
  ['commerce', 'libs/plugins/commerce/src/lib/plugin.ts'],
  ['bookings', 'libs/plugins/bookings/src/lib/plugin.ts'],
  ['events-calendar', 'libs/plugins/events-calendar/src/lib/plugin.ts'],
]

/**
 * Page elements offered beyond the marketplace allowlist. The marketplace
 * rule is "inert and self-contained enough to install on another tenant";
 * a model composing the tenant's OWN page may also reach the layout and
 * surface primitives, the media lists and the collection blocks, which are
 * bound to this site's data and so stay out of a listing.
 */
const PAGE_EXTRA_IDS = [
  'muiContainer',
  'muiGrid',
  'muiBox',
  'muiCard',
  'muiCardHeader',
  'muiCardContent',
  'muiCardActions',
  'image',
  'muiImageList',
  'muiImageListItem',
  'muiAccordion',
  'muiAccordionSummary',
  'muiAccordionDetails',
  'muiBreadcrumbs',
  'dataTable',
  'collectionEntries',
  'collectionEntryBody',
  'collectionRelated',
  'collectionShare',
  'collectionEntryMeta',
  'collectionEntryAuthor',
  'contentAuthorProfile',
  'collectionCategories',
  'collectionSearch',
  'videoEmbed',
  'socialLinks',
]

/**
 * Never offered to a model, whatever list they are on: a raw-HTML escape
 * hatch, a code-invoking widget, the canvas root, a reference into another
 * document, and third-party plugin elements.
 */
const NEVER_IDS = new Set([
  'custom-html',
  'functionWidget',
  'div',
  'reusableInstance',
  'marketplacePlugin',
  'emailHtml',
  'emailRichtext',
])

/** Elements whose `children` is a button label. */
const BUTTON_LIKE_IDS = new Set([
  'muiButton',
  'muiScreenLink',
  'emailButton',
  'muiDrawerToggle',
])

const URL_PROP_NAMES = new Set(['href', 'url', 'link'])
const MEDIA_PROP_NAMES = new Set(['src', 'poster', 'image'])
const BUTTON_LABEL_PROP_NAMES = new Set(['submitLabel', 'buttonLabel'])

/**
 * Field editors whose persisted value a model can write from a description
 * alone. Everything else picks from a record the site holds (a form, a
 * dataset, a product, a node) or edits a structure the JSON-Schema subset
 * cannot express, and is left off the palette.
 */
const STRING_FIELDS = new Set([
  'text-field',
  'textarea',
  'markdown',
  'css-dimension',
  'css-border',
  'css-gradient',
  'color-picker',
  'breakpoint-span',
  'theme-scale',
  'icon-picker',
  'screen-select',
  'date-picker',
  'time-picker',
])
const ENUM_FIELDS = new Set([
  'select',
  'radio',
  'toggle-button',
  'button-group',
  'preset-choice',
])
const BOOLEAN_FIELDS = new Set(['switch', 'checkbox'])
const NUMBER_FIELDS = new Set(['slider'])
const NESTED_FIELDS = new Set(['sub-form', 'tabs', 'tab-item'])

interface PropDeclaration {
  schema: Dict
  role?: string
  textLimit?: number
  required: boolean
}

function firstSentence(text: unknown, max = 110): string {
  if (typeof text !== 'string') return ''
  const flat = text.replace(/\s+/g, ' ').trim()
  const stop = flat.search(/[.!?](\s|$)/)
  const sentence = stop === -1 ? flat : flat.slice(0, stop + 1)
  return sentence.length <= max
    ? sentence
    : sentence.slice(0, max - 1).trimEnd() + '…'
}

function flattenAttributes(attributes: unknown): Dict[] {
  if (!Array.isArray(attributes)) return []
  const out: Dict[] = []
  for (const attribute of attributes) {
    if (!attribute || typeof attribute !== 'object') continue
    if (NESTED_FIELDS.has(attribute.component)) {
      out.push(...flattenAttributes(attribute.fields))
      continue
    }
    if (typeof attribute.name === 'string' && attribute.name)
      out.push(attribute)
  }
  return out
}

function declareProp(
  componentId: string,
  attribute: Dict,
  textLimits: Dict,
): PropDeclaration | null {
  const component = String(attribute.component ?? '')
  const name = attribute.name as string
  const schema: Dict = {}
  let role: string | undefined
  let textLimit: number | undefined

  if (ENUM_FIELDS.has(component) && Array.isArray(attribute.options)) {
    const values = attribute.options
      .map((option: Dict) =>
        option && typeof option === 'object' ? option.value : option,
      )
      .filter((value: unknown) => typeof value === 'string' && value !== '')
    if (!values.length) return null
    schema.type = 'string'
    schema.enum = [...new Set(values as string[])]
  } else if (BOOLEAN_FIELDS.has(component)) {
    schema.type = 'boolean'
  } else if (NUMBER_FIELDS.has(component)) {
    schema.type = 'number'
    if (typeof attribute.min === 'number') schema.minimum = attribute.min
    if (typeof attribute.max === 'number') schema.maximum = attribute.max
  } else if (STRING_FIELDS.has(component)) {
    schema.type = 'string'
  } else {
    return null
  }

  const dataType = attribute.dataType
  if (dataType === 'boolean') schema.type = 'boolean'
  else if (dataType === 'integer') schema.type = 'integer'
  else if (dataType === 'number' || dataType === 'float') schema.type = 'number'

  if (schema.type === 'string' && !schema.enum) {
    if (component === 'screen-select') role = 'screen'
    else if (URL_PROP_NAMES.has(name) || /Url$/.test(name)) role = 'url'
    else if (MEDIA_PROP_NAMES.has(name)) role = 'media'
    else if (
      component === 'text-field' ||
      component === 'textarea' ||
      component === 'markdown'
    ) {
      role = 'text'
      if (name === 'children' && BUTTON_LIKE_IDS.has(componentId)) {
        textLimit = textLimits.button
      } else if (BUTTON_LABEL_PROP_NAMES.has(name)) {
        textLimit = textLimits.button
      } else if (component === 'text-field') {
        textLimit = textLimits.label
      } else {
        textLimit = textLimits.body
      }
    }
  }

  let required = attribute.isRequired === true
  for (const validator of Array.isArray(attribute.validate)
    ? attribute.validate
    : []) {
    if (!validator || typeof validator !== 'object') continue
    const threshold = validator.threshold ?? validator.value
    switch (validator.type) {
      case 'required':
        required = true
        break
      case 'min-length':
        if (typeof threshold === 'number') schema.minLength = threshold
        break
      case 'max-length':
        if (typeof threshold === 'number') schema.maxLength = threshold
        break
      case 'exact-length':
        if (typeof threshold === 'number') {
          schema.minLength = threshold
          schema.maxLength = threshold
        }
        break
      case 'min-number-value':
        if (typeof threshold === 'number') schema.minimum = threshold
        break
      case 'max-number-value':
        if (typeof threshold === 'number') schema.maximum = threshold
        break
      case 'pattern':
        if (validator.pattern instanceof RegExp)
          schema.pattern = validator.pattern.source
        else if (typeof validator.pattern === 'string')
          schema.pattern = validator.pattern
        break
      default:
        break
    }
  }
  if (textLimit !== undefined) {
    schema.maxLength = Math.min(schema.maxLength ?? textLimit, textLimit)
  }
  return { schema, role, textLimit, required }
}

/**
 * Dotted paths to every string leaf of the CREATED theme's palette — the
 * options plus the shades and roles MUI fills in (`text.primary`,
 * `primary.light`, `divider`), which is what an `sx` value can name.
 */
function paletteTokens(palette: Dict, prefix = ''): string[] {
  const tokens: string[] = []
  for (const [key, value] of Object.entries(palette ?? {})) {
    if (key === 'mode') continue
    const path = prefix ? `${prefix}.${key}` : key
    if (typeof value === 'string') tokens.push(path)
    else if (value && typeof value === 'object')
      tokens.push(...paletteTokens(value, path))
  }
  return tokens
}

/** Every component id a nested preset tree places. */
function presetComponentIds(node: Dict, into = new Set<string>()): Set<string> {
  if (!node || typeof node !== 'object') return into
  if (typeof node.componentId === 'string') into.add(node.componentId)
  for (const child of Array.isArray(node.nodes) ? node.nodes : []) {
    presetComponentIds(child, into)
  }
  return into
}

function holdsLine(entry: Dict): string {
  if (!entry.acceptsChildren) return 'leaf'
  const order = entry.restrictChildren
  if (Array.isArray(order) && order[0] === 'limitedTo') {
    const definition = order[1]
    const components = Array.isArray(definition)
      ? definition
      : definition?.components
    if (Array.isArray(components) && components.length) {
      return `holds only ${components.join('|')}`
    }
  }
  return 'holds any'
}

function catalogProps(entry: Dict, max = 5): string {
  const properties = entry.propsSchema.properties as Record<string, Dict>
  const names = Object.keys(properties)
  const rank = (name: string): number => {
    const schema = properties[name]
    if (entry.propsSchema.required.includes(name)) return 0
    if (name === 'children') return 1
    if (schema.enum) return 2
    const role = entry.propRoles[name]
    if (role === 'url' || role === 'screen' || role === 'media') return 3
    if (schema.type === 'boolean') return 5
    return 4
  }
  const chosen = names
    .map((name, index) => ({ name, index, rank: rank(name) }))
    .sort((a, b) => a.rank - b.rank || a.index - b.index)
    .slice(0, max)
    .sort((a, b) => a.index - b.index)
  return chosen
    .map(({ name }) => {
      const schema = properties[name]
      const role = entry.propRoles[name]
      let value: string
      if (schema.enum) {
        const shown = schema.enum.slice(0, 6).join('|')
        value = schema.enum.length > 6 ? `${shown}|…` : shown
      } else if (role === 'text') {
        value = `text≤${entry.textLimits[name]}`
      } else if (role) {
        value = role
      } else {
        value = schema.type
      }
      const mark = entry.propsSchema.required.includes(name) ? '*' : ''
      return `${name}${mark}=${value}`
    })
    .join(', ')
}

function buildCatalog(
  surface: string,
  definition: { root: string; allow: readonly string[] },
  palette: Record<string, Dict>,
  blocks: Array<{ name: string; rootId: string; ids: Set<string> }>,
): string {
  const lines: string[] = []
  const rootLine =
    definition.root === 'div'
      ? 'Root: the document wrapper (componentId "div", id "_@_"); every other node carries an allowed componentId.'
      : `Root: one "${definition.root}" node.`
  lines.push(`Surface: ${surface}. ${rootLine}`)
  lines.push('Elements (id (name): purpose — children — props; * = required):')
  for (const id of definition.allow) {
    const entry = palette[id]
    lines.push(
      `- ${id} (${entry.displayName}): ${entry.summary || entry.category} — ${holdsLine(entry)} — ${catalogProps(entry) || 'no props'}`,
    )
  }
  const allowed = new Set(definition.allow)
  const named = blocks
    .filter((block) => [...block.ids].every((id) => allowed.has(id)))
    .map((block) => `${block.name} (${block.rootId})`)
  if (named.length) lines.push(`Named blocks to imitate: ${named.join('; ')}.`)
  return lines.join('\n')
}

async function main(): Promise<void> {
  const { schemaAcceptsChildren } = await load(
    'libs/aglyn/src/lib/app-utils/child-contract.ts',
  )
  const { AI_TEXT_LIMITS } = await load(
    'libs/plugins/ai/src/lib/runtime/ai-palette.ts',
  )
  const {
    MARKETPLACE_COMPONENT_ID_ALLOWLIST,
    MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST,
  } = await load('libs/aglyn/src/lib/app-utils/node-definition-sanitizer.ts')
  const { SPAN_BREAKPOINTS } = await load(
    'libs/shared/data/enums/src/lib/breakpoint-span.ts',
  )
  const { tenantThemeLight } = await load(
    'libs/shared/ui/theme/src/lib/tenant.theme.ts',
  )
  const { typographyVariants } = await load(
    'libs/plugins/mui/src/lib/components/typography.tsx',
  )

  const palette: Record<string, Dict> = {}
  const presetsByRoot = new Map<string, string[]>()
  const blocks: Array<{ name: string; rootId: string; ids: Set<string> }> = []

  for (const [pluginId, file] of BUNDLE_FILES) {
    const mod = await load(file)
    const key = Object.keys(mod).find((name) => name.endsWith('_BUNDLE'))
    if (!key) throw new Error(`${file} exports no *_BUNDLE`)
    for (const entry of mod[key] as Dict[]) {
      const schema = entry.schema as Dict
      const id = schema.$id as string
      if (!id) throw new Error(`${file}: a schema has no $id`)
      if (palette[id])
        throw new Error(`Component id "${id}" is registered twice`)
      const propsSchema: Dict = {
        type: 'object',
        properties: {},
        required: [],
        additionalProperties: false,
      }
      const propRoles: Dict = {}
      const propFields: Dict = {}
      const textLimits: Dict = {}
      for (const attribute of flattenAttributes(schema.attributes)) {
        const declared = declareProp(id, attribute, AI_TEXT_LIMITS)
        if (!declared) continue
        propsSchema.properties[attribute.name] = declared.schema
        if (declared.required) propsSchema.required.push(attribute.name)
        if (declared.role) propRoles[attribute.name] = declared.role
        // The field kind the editor draws the prop with, which decides the
        // component properties it can be bound to (AGL-2908).
        propFields[attribute.name] = String(attribute.component)
        if (declared.textLimit !== undefined)
          textLimits[attribute.name] = declared.textLimit
      }
      palette[id] = {
        pluginId: schema.pluginId ?? pluginId,
        kind: schema.kind ?? 'element',
        category: String(schema.category ?? ''),
        displayName: String(schema.displayName ?? id),
        summary: firstSentence(schema.description),
        acceptsChildren: schemaAcceptsChildren(schema),
        ...(schema.restrictChildren
          ? { restrictChildren: schema.restrictChildren }
          : {}),
        ...(schema.restrictParent
          ? { restrictParent: schema.restrictParent }
          : {}),
        propsSchema,
        propRoles,
        propFields,
        textLimits,
        presets: [],
      }
      for (const preset of Array.isArray(entry.presets) ? entry.presets : []) {
        const rootId = preset?.data?.componentId
        const name = preset?.displayName
        if (typeof rootId !== 'string' || typeof name !== 'string') continue
        const list = presetsByRoot.get(rootId) ?? []
        if (!list.includes(name)) list.push(name)
        presetsByRoot.set(rootId, list)
        if (Array.isArray(preset.data?.nodes) && preset.data.nodes.length) {
          blocks.push({ name, rootId, ids: presetComponentIds(preset.data) })
        }
      }
    }
  }
  for (const [rootId, names] of presetsByRoot) {
    if (palette[rootId]) palette[rootId].presets = names
  }

  const registered = (id: string): string => {
    if (!palette[id]) throw new Error(`"${id}" is not a registered component`)
    return id
  }
  const pageAllow = [
    ...new Set([...MARKETPLACE_COMPONENT_ID_ALLOWLIST, ...PAGE_EXTRA_IDS]),
  ]
    .map(registered)
    .filter((id) => !NEVER_IDS.has(id))
    .sort()
  const emailAllow = (MARKETPLACE_EMAIL_COMPONENT_ID_ALLOWLIST as string[])
    .map(registered)
    .filter((id) => !NEVER_IDS.has(id))
    .sort()
  const formAllow = ['form', 'formField'].map(registered)
  const surfaces = {
    screen: { root: 'div', allow: pageAllow },
    email: { root: 'div', allow: emailAllow },
    form: { root: 'form', allow: formAllow },
    layout: {
      root: 'div',
      allow: [...pageAllow, registered('layoutSlot')].sort(),
    },
    component: { root: 'div', allow: pageAllow },
  }

  const sxTokens = {
    palette: paletteTokens(tenantThemeLight.palette).sort(),
    breakpoints: [...SPAN_BREAKPOINTS],
    typographyVariants: (typographyVariants as Dict[]).map(
      (variant) => variant.value,
    ),
  }

  const catalog: Record<string, string> = {}
  for (const [surface, definition] of Object.entries(surfaces)) {
    catalog[surface] = buildCatalog(surface, definition, palette, blocks)
  }

  const sorted = Object.fromEntries(
    Object.keys(palette)
      .sort()
      .map((id) => [id, palette[id]]),
  )
  const banner =
    readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0] + '*/'
  const source =
    `${banner}\n\n` +
    `/**\n` +
    ` * GENERATED by tools/scripts/generate-ai-palette.mts from the registered\n` +
    ` * plugin bundles (AGL-2905). Do not edit; re-run the generator, and\n` +
    ` * \`npm run check:ai-palette\` fails CI when this file is stale.\n` +
    ` */\n` +
    `import type {\n` +
    `  AiPaletteEntry,\n` +
    `  AiSurface,\n` +
    `  AiSurfaceDefinition,\n` +
    `  AiSxTokens,\n` +
    `} from './ai-palette'\n\n` +
    `/** Every registered component, by id. */\n` +
    `export const AI_PALETTE: Record<string, AiPaletteEntry> = ${JSON.stringify(sorted, null, 2)}\n\n` +
    `/** The root and the allowed component ids of each surface. */\n` +
    `export const AI_SURFACES: Record<AiSurface, AiSurfaceDefinition> = ${JSON.stringify(surfaces, null, 2)}\n\n` +
    `/** Theme vocabulary an \`sx\` value may name. */\n` +
    `export const AI_SX_TOKENS: AiSxTokens = ${JSON.stringify(sxTokens, null, 2)}\n\n` +
    `/** The prompt catalog of each surface. */\n` +
    `export const AI_PALETTE_CATALOG: Record<AiSurface, string> = ${JSON.stringify(catalog, null, 2)}\n`
  const prettierConfig = (await prettier.resolveConfig(OUT)) ?? {}
  const content = await prettier.format(source, {
    ...prettierConfig,
    filepath: OUT,
  })

  const check = process.argv.includes('--check')
  const current = (() => {
    try {
      return readFileSync(OUT, 'utf8')
    } catch {
      return null
    }
  })()
  const budget = Object.entries(catalog).map(
    ([surface, text]) => `${surface}=${Math.ceil(text.length / 4)} tokens`,
  )
  if (current === content) {
    console.log(
      `OK     ${OUT.slice(ROOT.length + 1)} is current (${budget.join(', ')})`,
    )
  } else if (check) {
    console.error(
      `STALE  ${OUT.slice(ROOT.length + 1)}\n\n` +
        'The generated palette does not match the registered bundles.\n' +
        'Run: node tools/scripts/generate-ai-palette.mts',
    )
    process.exit(1)
  } else {
    writeFileSync(OUT, content)
    console.log(`WROTE  ${OUT.slice(ROOT.length + 1)} (${budget.join(', ')})`)
  }
}

main().catch((error) => {
  console.error(error)
  process.exit(1)
})
