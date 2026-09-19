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

import { parseMediaRef } from '@aglyn/aglyn/app-utils/media-ref'
import { COMPONENT_PROP_NAME_PATTERN } from '@aglyn/aglyn/app-utils/reusable-component-keys'
import { FieldComponentType } from '@aglyn/aglyn/foundation/definitions/components.types'
import type {
  ReusableComponentProp,
  ReusableComponentPropOption,
  ReusableComponentPropType,
  ReusableComponentPropValue,
} from '@aglyn/aglyn/foundation/definitions/platform.types'
import { REUSABLE_PROP_KINDS } from '@aglyn/aglyn/foundation/definitions/property-kinds'
import type { AiTool } from '../providers/contract'
import { aiDoctrineTreeTool } from '../runtime/ai-doctrine'
import type {
  AiDoctrineRuleNumber,
  AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import { HOSTILE_TEXT, isHttpsUrl, isRootRelativePath } from '../runtime/ai-node-tree'
import { AI_TEXT_LIMITS } from '../runtime/ai-palette'

/**
 * The tool a generated reusable component arrives through (AGL-2908), and
 * the reading of the properties it declares.
 *
 * ── The kinds are the Properties dialog's ────────────────────────────────
 *
 * FILE ▸ Properties… declares a property as one of `REUSABLE_PROP_KINDS`,
 * and so does this tool: the kinds it offers are that table less the ones
 * `AI_COMPONENT_PROP_KINDS_NOT_OFFERED` names, each with the reason it is
 * left out, and a spec holds the two in both directions. A kind added to the
 * dialog does not compile here until it is offered or given a reason.
 *
 * What is offered is what a generated element can carry and a brief can
 * fill: copy (Text, Long text), a picture (Image), a link (Link), an icon
 * the site owner picks (Icon), a number (Number), a switch or a part's
 * visibility (Yes / no), and a setting with fixed answers (Choice).
 *
 * ── A declaration as the dialog saves one ────────────────────────────────
 *
 * `readAiComponentProps` returns each property in the shape the dialog's
 * cleaner stores: trimmed, with only the fields its kind uses, and a default
 * in the kind's own type — a Yes / no a real `true` or `false`, a Number a
 * number. Every refusal is a building-rule finding the doctrine's re-ask
 * quotes by its path.
 */

type OfferedKind = 'text' | 'richText' | 'image' | 'href' | 'icon' | 'number' | 'boolean' | 'choice'

const STYLE_REASON =
  'Styling comes from the theme and the component’s own styles (rules 5 and 12); a page restyles one placement with an override, not a property.'
const RECORD_REASON =
  'A pick from the site’s own records is made where a page places the component (rule 8), never invented as a generated default.'
const PLUGIN_REASON =
  'Plugin settings belong to the plugin’s own element, which a generated component never places.'

/**
 * Why each property kind the dialog declares is not offered to a model.
 * Keyed by every kind outside the offered ones, so the table is complete by
 * type.
 */
export const AI_COMPONENT_PROP_KINDS_NOT_OFFERED: Readonly<
  Record<Exclude<ReusableComponentPropType, OfferedKind>, string>
> = {
  [FieldComponentType.MARKDOWN]:
    'Long text binds to the same formatted-document fields, with a default a brief can write.',
  [FieldComponentType.DATA_TABLE]:
    'A table is rows and columns a page fills in, not one value a brief describes.',
  [FieldComponentType.SLIDER]:
    'Number binds to every slider, without the range settings a Slider property must declare.',
  [FieldComponentType.CHECKBOX]:
    'Yes / no binds to every switch and single tick box, and no generated element offers a list of tick boxes.',
  [FieldComponentType.RADIO]:
    'Choice binds to every field Radio buttons binds to, with its answers checked in one place.',
  [FieldComponentType.TOGGLE_BUTTON]:
    'Choice binds to every field Toggle buttons binds to, with its answers checked in one place.',
  [FieldComponentType.DUAL_LIST_SELECT]:
    'A pick list holds several answers, and no generated element offers a field that takes several.',
  [FieldComponentType.COLOR_PICKER]:
    'Colors come from the theme (rule 5); a page recolors one placement with an override, not a property.',
  [FieldComponentType.CSS_DIMENSION]: STYLE_REASON,
  [FieldComponentType.CSS_BORDER]: STYLE_REASON,
  [FieldComponentType.CSS_GRADIENT]: STYLE_REASON,
  [FieldComponentType.BREAKPOINT_SPAN]: STYLE_REASON,
  [FieldComponentType.PRESET_CHOICE]: STYLE_REASON,
  [FieldComponentType.THEME_SCALE]: STYLE_REASON,
  [FieldComponentType.DATE_PICKER]:
    'A date is a fact the brief would have to give (rule 14), not copy a component shows until a page sets it.',
  [FieldComponentType.TIME_PICKER]:
    'A time is a fact the brief would have to give (rule 14), not copy a component shows until a page sets it.',
  [FieldComponentType.NODE_SELECT]: RECORD_REASON,
  [FieldComponentType.PRODUCT_SELECT]: RECORD_REASON,
  [FieldComponentType.COLLECTION_SELECT]: RECORD_REASON,
  [FieldComponentType.CATEGORY_SELECT]: RECORD_REASON,
  [FieldComponentType.DATASET_SELECT]: RECORD_REASON,
  [FieldComponentType.DATASET_FIELD_SELECT]: RECORD_REASON,
  [FieldComponentType.FORM_SELECT]:
    'A form is placed by its id from the Forms page (rule 3), never chosen through a generated property.',
  [FieldComponentType.PLUGIN_SELECT]: PLUGIN_REASON,
  [FieldComponentType.PLUGIN_SETTINGS]: PLUGIN_REASON,
}

/**
 * The kinds a generated component may declare: the dialog's table less the
 * kinds above, in the dialog's own order.
 */
export const AI_COMPONENT_PROP_KINDS: readonly OfferedKind[] = (
  Object.keys(REUSABLE_PROP_KINDS) as ReusableComponentPropType[]
).filter(
  (type): type is OfferedKind =>
    !Object.prototype.hasOwnProperty.call(AI_COMPONENT_PROP_KINDS_NOT_OFFERED, type),
)

export type AiComponentPropKind = OfferedKind

/**
 * The kinds a property proposed for a section already on a page may take
 * (AGL-3054): every offered kind but an Icon. That door reads each default off
 * the live field it binds, and an icon's default is drawn from a path the
 * picker stores beside its id, which the field it reads does not carry.
 */
export const AI_COMPONENT_SELECTION_PROP_KINDS: readonly AiComponentPropKind[] =
  AI_COMPONENT_PROP_KINDS.filter((type) => type !== 'icon')

/** The kinds as a model reads them: the stored type and the name a page reads. */
export function aiComponentPropKindWords(
  kinds: readonly AiComponentPropKind[] = AI_COMPONENT_PROP_KINDS,
): string {
  return kinds.map((type) => `${type} (${REUSABLE_PROP_KINDS[type].label})`).join(', ')
}

export const AI_COMPONENT_TOOL_NAME = 'submit_component'

/** The most properties one generated component declares. */
export const AI_COMPONENT_MAX_PROPS = 20

const NAME_MAX = 40
const LABEL_MAX = 80
const HELP_MAX = 200
const ANSWER_MAX = 100

/**
 * The strict tool a component arrives through: the doctrine's tree, as the
 * doctrine's own component tool carries it, and the properties beside it.
 * Every field of a property is required and flat, because optional
 * properties are not portable across strict tool implementations; a kind
 * that has no answers sends `[]`.
 */
export function aiComponentTool(): AiTool {
  const doctrine = aiDoctrineTreeTool('component')
  const tree = (doctrine.inputSchema as { properties: Record<string, unknown> }).properties['tree']
  return {
    name: AI_COMPONENT_TOOL_NAME,
    description:
      'Submit the reusable component: its tree as one flat node map, and every property the tree binds.',
    strict: true,
    inputSchema: {
      type: 'object',
      additionalProperties: false,
      required: ['tree', 'props'],
      properties: {
        tree,
        props: {
          type: 'array',
          description:
            'Every property the tree binds with {{prop.<name>}}, in the order a page sets them.',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['name', 'type', 'label', 'description', 'defaultValue', 'options'],
            properties: {
              name: {
                type: 'string',
                description:
                  'Letters, digits and underscores, starting with a letter; bound as {{prop.<name>}}.',
              },
              type: {
                type: 'string',
                enum: [...AI_COMPONENT_PROP_KINDS],
                description: `The kind, as type (the name a page reads): ${aiComponentPropKindWords()}.`,
              },
              label: { type: 'string', description: 'The words a page reads beside the field.' },
              description: { type: 'string', description: 'Help beside the field, or "".' },
              defaultValue: {
                type: 'string',
                description:
                  'What the component shows until a page sets it: copy for text and richText, a screen id from the site inventory or "" for href, "" for image and icon, a number for number, "true" or "false" for boolean, one answer’s value for choice.',
              },
              options: {
                type: 'array',
                description: 'The answers of a choice; [] for every other kind.',
                items: {
                  type: 'object',
                  additionalProperties: false,
                  required: ['value', 'label'],
                  properties: {
                    value: {
                      type: 'string',
                      description: 'What the bound field receives: one of the values that field lists.',
                    },
                    label: { type: 'string', description: 'What a page picks.' },
                  },
                },
              },
            },
          },
        },
      },
    },
  }
}

export interface AiComponentPropsScope {
  /** The screens a Link default may name: the site inventory's. */
  screenIds: ReadonlySet<string>
}

export interface AiComponentPropsReading {
  /** Every property that could be read, as the Properties dialog stores one. */
  props: ReusableComponentProp[]
  /**
   * The names of properties that were declared under a usable name and
   * refused for something else — their kind, answers, default or label — so
   * a check of the tree does not report their tokens a second time.
   */
  refused: string[]
  violations: AiDoctrineViolation[]
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

/** A scalar the answer wrote, as trimmed text. */
function scalar(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean'
    ? String(value).trim()
    : ''
}

type DefaultReading =
  | { value: ReusableComponentPropValue | undefined }
  | { error: string; rule: AiDoctrineRuleNumber }

/** A default as the kind stores it, or why it cannot be one. */
function readDefault(
  type: OfferedKind,
  raw: unknown,
  options: readonly ReusableComponentPropOption[],
  scope: AiComponentPropsScope,
): DefaultReading {
  const value = scalar(raw)
  if (HOSTILE_TEXT.test(value)) return { error: 'carries markup or script', rule: 1 }
  // Nothing set is a default of its own: the kind's "not set".
  if (!value) return { value: undefined }
  switch (type) {
    case 'text':
    case 'richText':
      return value.length > AI_TEXT_LIMITS.body
        ? { error: `runs past ${AI_TEXT_LIMITS.body} characters`, rule: 1 }
        : { value }
    case 'icon':
      // The picker stores an icon with the drawing a model cannot name, so
      // the site owner picks it where a page places the component.
      return { error: 'is an icon, which the site owner picks; leave it ""', rule: 1 }
    case 'image':
      if (/^https?:\/\//i.test(value)) {
        return { error: 'links a picture from another website; leave it empty for an upload', rule: 9 }
      }
      return parseMediaRef(value)
        ? { value }
        : { error: 'is not a picture from the media library; leave it empty for an upload', rule: 9 }
    case 'href':
      return scope.screenIds.has(value) || isRootRelativePath(value) || isHttpsUrl(value)
        ? { value }
        : {
            error: 'is neither a screen id from the site inventory, a path on this site nor an https: address',
            rule: 1,
          }
    case 'number': {
      const parsed = Number(value)
      return Number.isFinite(parsed) ? { value: parsed } : { error: 'is not a number', rule: 1 }
    }
    case 'boolean':
      if (value === 'true') return { value: true }
      if (value === 'false') return { value: false }
      return { error: 'is neither true nor false', rule: 1 }
    case 'choice':
      return options.some((option) => option.value === value)
        ? { value }
        : { error: 'is not the value of one of its answers', rule: 1 }
  }
}

/**
 * The properties a component answer declares, read into the shape the
 * Properties dialog stores, with a finding for everything that would not
 * save there or would not read as the brief's own copy.
 */
export function readAiComponentProps(
  answer: Record<string, unknown>,
  scope: AiComponentPropsScope,
): AiComponentPropsReading {
  const raw = answer['props']
  if (!Array.isArray(raw)) {
    return {
      props: [],
      refused: [],
      violations: [
        {
          rule: 1,
          code: 'props-missing',
          message:
            'The component came without its list of properties. Declare every property the tree binds, or an empty list.',
          paths: ['props'],
        },
      ],
    }
  }
  const violations: AiDoctrineViolation[] = []
  const finding = (
    code: string,
    message: string,
    path: string,
    rule: AiDoctrineRuleNumber = 1,
  ): void => {
    violations.push({ rule, code, message, paths: [path] })
  }
  if (raw.length > AI_COMPONENT_MAX_PROPS) {
    finding(
      'props-over-limit',
      `The component declares ${raw.length} properties, and one component declares at most ${AI_COMPONENT_MAX_PROPS}. Keep a property for each value that differs between placements.`,
      'props',
    )
  }
  const kindNames = AI_COMPONENT_PROP_KINDS.map((type) => REUSABLE_PROP_KINDS[type].label)
  const props: ReusableComponentProp[] = []
  const seen = new Set<string>()
  raw.slice(0, AI_COMPONENT_MAX_PROPS).forEach((entry, index) => {
    const at = `props[${index}]`
    if (!isRecord(entry)) {
      finding('prop-shape', 'A property could not be read. Give each one a name, a kind and a default.', at)
      return
    }
    const name = scalar(entry['name'])
    const called = name ? `"${name}"` : `number ${index + 1}`
    if (!COMPONENT_PROP_NAME_PATTERN.test(name) || name.length > NAME_MAX) {
      finding(
        'prop-name',
        `The property ${called} is not a name a property can have. Use letters, digits and underscores, starting with a letter, in ${NAME_MAX} characters or fewer.`,
        `${at}.name`,
      )
      return
    }
    if (seen.has(name)) {
      finding('prop-duplicate', `Two properties are named "${name}". Give each property its own name.`, `${at}.name`)
      return
    }
    seen.add(name)
    const type = scalar(entry['type']) as OfferedKind
    if (!AI_COMPONENT_PROP_KINDS.includes(type)) {
      finding(
        'prop-kind',
        `The property "${name}" is a kind a generated component does not declare. Use one of: ${kindNames.join(', ')}.`,
        `${at}.type`,
      )
      return
    }
    const options: ReusableComponentPropOption[] = []
    if (type === 'choice') {
      const answers = Array.isArray(entry['options']) ? entry['options'] : []
      const values = new Set<string>()
      for (const option of answers) {
        const value = isRecord(option) ? scalar(option['value']).slice(0, ANSWER_MAX) : ''
        const label = isRecord(option) ? scalar(option['label']).slice(0, LABEL_MAX) : ''
        if (!value || HOSTILE_TEXT.test(value) || HOSTILE_TEXT.test(label)) {
          finding('prop-answers', `Every answer of "${name}" needs a plain value.`, `${at}.options`)
          return
        }
        if (values.has(value)) {
          finding('prop-answers', `Two answers of "${name}" share the value "${value}".`, `${at}.options`)
          return
        }
        values.add(value)
        options.push({ value, ...(label && label !== value ? { label } : {}) })
      }
      if (!options.length) {
        finding(
          'prop-answers',
          `The Choice "${name}" lists no answers. Give it the answers a page picks from.`,
          `${at}.options`,
        )
        return
      }
    }
    const read = readDefault(type, entry['defaultValue'], options, scope)
    if ('error' in read) {
      finding('prop-default', `The default of "${name}" ${read.error}.`, `${at}.defaultValue`, read.rule)
      return
    }
    const label = scalar(entry['label']).slice(0, LABEL_MAX)
    const description = scalar(entry['description']).slice(0, HELP_MAX)
    if (HOSTILE_TEXT.test(label) || HOSTILE_TEXT.test(description)) {
      finding('prop-shape', `The label or help of "${name}" carries markup or script.`, at)
      return
    }
    props.push({
      name,
      type,
      ...(label ? { label } : {}),
      ...(description ? { description } : {}),
      ...(read.value !== undefined ? { defaultValue: read.value } : {}),
      ...(type === 'choice' ? { options } : {}),
    })
  })
  // A name that read, and was then refused for its kind, answers, default or label.
  const refused = [...seen].filter((name) => !props.some((prop) => prop.name === name))
  return { props, refused, violations }
}
