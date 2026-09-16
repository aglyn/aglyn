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
  COMPONENT_PROP_NAME_PATTERN,
  NODE_HIDE_IF_PROP,
  NODE_HIDE_UNLESS_PROP,
  REUSABLE_INSTANCE_COMPONENT_ID,
  REUSABLE_INSTANCE_PROP_VALUES_KEY,
} from '@aglyn/aglyn/app-utils/reusable-component-keys'
import type {
  ReusableComponentProp,
  ReusableComponentPropType,
} from '@aglyn/aglyn/foundation/definitions/platform.types'
import {
  REUSABLE_PROP_KINDS,
  reusablePropValueShape,
} from '@aglyn/aglyn/foundation/definitions/property-kinds'
import type { AiJobPlan } from '../model/ai-jobs.types'
import type { AiSiteInventory } from '../model/ai-site-inventory'
import {
  AI_COMPONENT_COPY_KINDS,
  aiComponentKindBindsTo,
  aiComponentPropBindsToField,
  aiComponentPropNamesIn,
  aiComponentUnofferedAnswers,
  isAiComponentPropToken,
} from '../runtime/ai-component-bindings'
import type { AiValidatedTree } from '../runtime/ai-doctrine'
import {
  aiHeadingLevel,
  detectOffVoiceCopy,
  walkTree,
  type AiDoctrineNode,
  type AiDoctrineViolation,
} from '../runtime/ai-doctrine-validators'
import { AI_INSTANCE_REF_PROP } from '../runtime/ai-node-tree'
import { AI_PALETTE } from '../runtime/ai-palette.generated'
import { readAiComponentProps } from '../tools/ai-component-tool'
import {
  aiModelNodeIds,
  aiPlacedComponentIds,
  aiPlanCreation,
  aiPlanReuseViolations,
} from './ai-job-generation'

/**
 * The component door's own checks (AGL-2908): what a generated reusable
 * component is held to beyond the doctrine, on a tree the doctrine admitted
 * and the properties the same answer declared.
 *
 * - every token names a property the component declares, and every declared
 *   property is bound, so no field a page sets changes nothing;
 * - a property binds only to a field that holds its kind of value
 *   (`runtime/ai-component-bindings.ts`): a switch takes a Yes / no, a
 *   dropdown a Choice whose answers it lists, a screen picker a Link
 *   (AGL-2871), an icon picker an Icon;
 * - an icon is an Icon the site owner picks, never words (AGL-3054): a copy
 *   property named or labeled as an icon, shown as copy, is refused;
 * - its headings start at h3 (AGL-3057): a component is placed inside a page
 *   section, which opens with its own h2, and a page's outline check sees an
 *   instance as one node, never the headings it grafts in;
 * - an optional part is switched off by a Yes / no labeled `Hide …` that
 *   defaults to No, bound to `hideIf` on that part and never on the whole
 *   component;
 * - a default is what the component shows until a page sets it, in the
 *   site's voice (rule 14), and fits the field it fills;
 * - what the confirmed plan names is there: the components it reuses, and
 *   the properties it lists for this component, an icon as an icon (rule 7).
 *
 * Pure: no Firestore and no provider, so the component step, the eval
 * harness and their specs read one definition of a component's checks.
 */

/** The label a Yes / no that hides a part opens with, so a page reads what it does. */
const HIDE_LABEL = /^Hide\b/

/** The kinds of a placed component's property that copy fills as text. */
const COPY_FIELD_KINDS: ReadonlySet<string> = new Set(['text', 'richText'])

/**
 * The highest heading a component may carry (AGL-3057): a page section opens
 * with its own h2, and whatever the section places sits under it.
 */
export const AI_COMPONENT_TOP_HEADING_LEVEL = 3

/** A word naming an icon, in a label or in a name split at its capitals and underscores. */
const ICON_WORD = /\bicons?\b/i

/** One `name:type` field of the confirmed plan's component; `type` is empty when the field names none. */
export interface AiPlannedComponentField {
  name: string
  type: string
}

/** The fields the confirmed plan lists for its component, read from `name:type`, each name once. */
export function aiPlannedComponentFields(plan: AiJobPlan | null): AiPlannedComponentField[] {
  const fields = new Map<string, AiPlannedComponentField>()
  for (const field of aiPlanCreation(plan, 'component')?.fields ?? []) {
    const [name = '', type = ''] = field.split(':').map((part) => part.trim())
    if (COMPONENT_PROP_NAME_PATTERN.test(name) && !fields.has(name)) fields.set(name, { name, type })
  }
  return [...fields.values()]
}

/** The property names the confirmed plan lists for its component, from its `name:type` fields. */
export function aiPlannedComponentProps(plan: AiJobPlan | null): string[] {
  return aiPlannedComponentFields(plan).map((field) => field.name)
}

interface BindingFinding {
  id: string
  name: string
}

/** A property's kind as a sentence names one: "an Image", "a Yes / no". */
function aKind(type: string | undefined): string {
  const label =
    REUSABLE_PROP_KINDS[(type ?? 'text') as ReusableComponentPropType]?.label ??
    REUSABLE_PROP_KINDS.text.label
  return `${/^[AEIOU]/i.test(label) ? 'an' : 'a'} ${label}`
}

function fieldPhrase(componentId: string, field: string): string {
  return `the ${AI_PALETTE[componentId]?.displayName ?? componentId}’s ${field}`
}

const tokenOf = (name: string): string => `{{prop.${name}}}`

/** Whether a property's name or label says it is an icon. */
function namedAsIcon(prop: Pick<ReusableComponentProp, 'name' | 'label'>): boolean {
  const words = prop.name.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
  return ICON_WORD.test(words) || ICON_WORD.test(prop.label ?? '')
}

/** "{{prop.a}} is" or "{{prop.a}}, {{prop.b}} are", for a finding that names its properties. */
function tokensAre(names: readonly string[]): string {
  const tokens = [...new Set(names)].map(tokenOf)
  return `${tokens.slice(0, 3).join(', ')} ${tokens.length === 1 ? 'is' : 'are'}`
}

/**
 * Whether a property handed on to a placed component fits the property it
 * fills there: copy into copy, whole or inside a sentence; a picture or a
 * link only into its own kind, whole; any other kind into one whose value has
 * its shape.
 */
function handsOnTo(prop: ReusableComponentProp, placedType: string, whole: boolean): boolean {
  const type = prop.type ?? 'text'
  if (AI_COMPONENT_COPY_KINDS.has(type) && COPY_FIELD_KINDS.has(placedType)) return true
  if (!whole) return false
  if ([type, placedType].some((kind) => kind === 'image' || kind === 'href')) return type === placedType
  return (
    reusablePropValueShape(prop) ===
    reusablePropValueShape({ type: placedType as ReusableComponentPropType })
  )
}

/**
 * The component door's check of its bindings, on a tree the doctrine admitted
 * and the properties the same answer declared: every token names a declared
 * property on a field of its kind, every property is bound, an icon is never
 * shown as words, a part is hidden by a `Hide …` Yes / no that defaults to No,
 * and a default fits the field it fills. `refused` names properties the answer
 * declared and the reading refused, which are reported there and not again
 * here.
 */
export function aiComponentBindingViolations(
  tree: Pick<AiValidatedTree, 'rootId' | 'nodes' | 'sourceIds'>,
  props: readonly ReusableComponentProp[],
  inventory: AiSiteInventory | null,
  refused: readonly string[] = [],
): AiDoctrineViolation[] {
  const declared = new Map(props.map((prop) => [prop.name, prop]))
  const skipped = new Set(refused)
  const placedProps = new Map(
    (inventory?.components ?? []).map((component) => [component.id, component.props]),
  )
  const nodes = tree.nodes as unknown as Record<string, AiDoctrineNode>
  // The whole component: its root, and the one element a document wrapper holds.
  const whole = new Set([tree.rootId])
  const root = nodes[tree.rootId]
  if (root?.componentId === 'div' && root.nodes?.length === 1) whole.add(root.nodes[0])

  const bound = new Set<string>()
  const undeclared: BindingFinding[] = []
  const unfit: Array<BindingFinding & { at: string }> = []
  const unoffered: Array<BindingFinding & { at: string; values: string[] }> = []
  const tooLong: Array<BindingFinding & { at: string; limit: number }> = []
  const iconAsText: BindingFinding[] = []
  const hidesWhole: BindingFinding[] = []
  const hideForm: BindingFinding[] = []
  const named = (id: string, name: string): ReusableComponentProp | null => {
    const prop = declared.get(name)
    if (prop) {
      bound.add(name)
      return prop
    }
    if (!skipped.has(name)) undeclared.push({ id, name })
    return null
  }

  for (const { id, node } of walkTree({ rootId: tree.rootId, nodes })) {
    const entry = AI_PALETTE[node.componentId]
    for (const [field, value] of Object.entries(node.props ?? {})) {
      const placement = isAiComponentPropToken(value) ? 'whole' : 'inside'
      for (const name of aiComponentPropNamesIn(value)) {
        const prop = named(id, name)
        if (!prop) continue
        if (!aiComponentPropBindsToField(prop, entry, field, placement)) {
          unfit.push({ id, name, at: fieldPhrase(node.componentId, field) })
          continue
        }
        if (field === NODE_HIDE_IF_PROP || field === NODE_HIDE_UNLESS_PROP) {
          if (whole.has(id)) hidesWhole.push({ id, name })
          if (
            field === NODE_HIDE_IF_PROP &&
            (!HIDE_LABEL.test(prop.label ?? '') || prop.defaultValue === true)
          ) {
            hideForm.push({ id, name })
          }
          continue
        }
        // Copy the tree shows as words is the wrong home for an icon: the
        // words a page types in are drawn as text, never as the icon.
        if (entry?.propRoles[field] === 'text' && namedAsIcon(prop)) iconAsText.push({ id, name })
        const values = aiComponentUnofferedAnswers(prop, entry, field)
        if (values.length) unoffered.push({ id, name, at: fieldPhrase(node.componentId, field), values })
        const limit = entry?.textLimits[field]
        if (
          placement === 'whole' &&
          limit !== undefined &&
          typeof prop.defaultValue === 'string' &&
          prop.defaultValue.length > limit
        ) {
          tooLong.push({ id, name, at: fieldPhrase(node.componentId, field), limit })
        }
      }
    }
    // A property handed on to a component this one places.
    const refId = node.props?.[AI_INSTANCE_REF_PROP]
    const handed = node.props?.[REUSABLE_INSTANCE_PROP_VALUES_KEY]
    if (
      node.componentId !== REUSABLE_INSTANCE_COMPONENT_ID ||
      typeof refId !== 'string' ||
      !handed ||
      typeof handed !== 'object' ||
      Array.isArray(handed)
    ) {
      continue
    }
    const types = placedProps.get(refId) ?? {}
    for (const [field, value] of Object.entries(handed as Record<string, unknown>)) {
      const wholeValue = isAiComponentPropToken(value)
      for (const name of aiComponentPropNamesIn(value)) {
        const prop = named(id, name)
        if (prop && !handsOnTo(prop, types[field] ?? 'text', wholeValue)) {
          unfit.push({ id, name, at: `the placed component’s ${field}` })
        }
      }
    }
  }

  const at = (list: ReadonlyArray<{ id: string }>): string[] =>
    aiModelNodeIds([...new Set(list.map((entry) => entry.id))], tree.sourceIds)
  const violations: AiDoctrineViolation[] = []
  if (undeclared.length) {
    const tokens = [...new Set(undeclared.map((entry) => tokenOf(entry.name)))]
    violations.push({
      rule: 1,
      code: 'prop-undeclared',
      message: `The tree binds ${tokens.slice(0, 3).join(', ')}, which the component does not declare. Declare every property the tree binds.`,
      nodeIds: at(undeclared),
    })
  }
  if (unfit.length) {
    const [first] = unfit
    violations.push({
      rule: 1,
      code: 'binding-field',
      message: `${tokenOf(first.name)} is ${aKind(declared.get(first.name)?.type)} property bound to ${first.at}, which does not take one. Bind each property only to a field that holds its kind of value.`,
      nodeIds: at(unfit),
    })
  }
  const shownAsWords = iconAsText.filter((entry) => AI_COMPONENT_COPY_KINDS.has(declared.get(entry.name)?.type ?? 'text'))
  if (shownAsWords.length) {
    const one = new Set(shownAsWords.map((entry) => entry.name)).size === 1
    violations.push({
      rule: 1,
      code: 'icon-as-text',
      message: `${tokensAre(shownAsWords.map((entry) => entry.name))} named as an icon and shown as words. Make ${
        one ? 'it an icon property' : 'each an icon property'
      } ("type": "icon", "defaultValue": "") bound whole to an Icon element’s iconId, for the site owner to pick.`,
      nodeIds: at(shownAsWords),
    })
  }
  if (unoffered.length) {
    const [first] = unoffered
    violations.push({
      rule: 1,
      code: 'binding-answers',
      message: `${tokenOf(first.name)} offers ${first.values.map((value) => `"${value}"`).join(', ')}, which ${first.at} does not list. Give a Choice only answers whose values the field lists.`,
      nodeIds: at(unoffered),
    })
  }
  if (tooLong.length) {
    const [first] = tooLong
    violations.push({
      rule: 1,
      code: 'prop-default-too-long',
      message: `The default of ${tokenOf(first.name)} is longer than ${first.at} holds (${first.limit} characters). Shorten it.`,
      nodeIds: at(tooLong),
    })
  }
  if (hidesWhole.length) {
    violations.push({
      rule: 1,
      code: 'hide-whole-component',
      message:
        'The whole component is hidden by one of its own properties, so a page could place it and show nothing. Put hideIf on the optional part instead.',
      nodeIds: at(hidesWhole),
    })
  }
  if (hideForm.length) {
    const tokens = [...new Set(hideForm.map((entry) => tokenOf(entry.name)))]
    violations.push({
      rule: 1,
      code: 'hide-label',
      message: `${tokens.join(', ')} ${tokens.length === 1 ? 'hides a part, so it is' : 'hide parts, so each is'} a Yes / no labeled "Hide …" whose default is false: the part shows until a page hides it.`,
      nodeIds: at(hideForm),
    })
  }
  const unbound = props.filter((prop) => !bound.has(prop.name))
  if (unbound.length) {
    const one = unbound.length === 1
    // Where each unbound kind goes, once a kind, so the re-ask says what to write.
    const kinds = [...new Set(unbound.map((prop) => prop.type ?? 'text'))]
    violations.push({
      rule: 1,
      code: 'prop-unbound',
      message: `The component declares ${unbound
        .slice(0, 3)
        .map((prop) => tokenOf(prop.name))
        .join(', ')} and binds ${one ? 'it' : 'them'} nowhere, so a page that sets ${one ? 'it' : 'them'} changes nothing. Bind every property you declare where its kind goes: ${kinds
        .map((type) => `${aKind(type)} to ${aiComponentKindBindsTo(type)}`)
        .join('; ')}.`,
    })
  }
  return violations
}

/**
 * Rule 7: the properties the confirmed plan lists for the component are
 * declared, and a field the plan lists as an icon is an icon property, so
 * the plan and the binding checks ask for the same thing (AGL-3054).
 */
export function aiPlannedPropViolations(
  plan: AiJobPlan | null,
  props: readonly Pick<ReusableComponentProp, 'name' | 'type'>[],
): AiDoctrineViolation[] {
  const declared = new Map(props.map((prop) => [prop.name, prop]))
  const planned = aiPlannedComponentFields(plan)
  const violations: AiDoctrineViolation[] = []
  const missing = planned.filter((field) => !declared.has(field.name)).map((field) => field.name)
  if (missing.length) {
    const one = missing.length === 1
    violations.push({
      rule: 7,
      code: 'plan-prop-missing',
      message: `The confirmed plan lists the ${one ? 'property' : 'properties'} ${missing
        .map((name) => `"${name}"`)
        .join(', ')}, and the component does not declare ${one ? 'it' : 'them'}. Declare every property the plan lists.`,
    })
  }
  // A property refused on its reading carries no kind, and is reported there.
  const notIcons = planned.filter((field) => {
    const type = declared.get(field.name)?.type
    return field.type === 'icon' && type !== undefined && type !== 'icon'
  })
  if (notIcons.length) {
    const [first] = notIcons
    violations.push({
      rule: 7,
      code: 'plan-prop-kind',
      message: `The confirmed plan lists "${first.name}" as an icon, and the component declares it as ${aKind(
        declared.get(first.name)?.type,
      )}. Declare it as an icon property ("type": "icon", "defaultValue": "") bound whole to an Icon element’s iconId.`,
    })
  }
  return violations
}

/**
 * Rule 11 on a component's own outline (AGL-3057). A page's outline check
 * reads an instance as one node, and the site inventory carries no component
 * tree to read in its place, so a component's h2 renders beside the h2 that
 * opens the section placing it, and the page reads h2, h2, h2. The component
 * is held to headings a section can hold instead: h3 or below. A component
 * that would be a whole section, its own h2 and all, is refused the same way:
 * that section is built on the page.
 */
export function aiComponentHeadingViolations(
  tree: Pick<AiValidatedTree, 'rootId' | 'nodes' | 'sourceIds'>,
): AiDoctrineViolation[] {
  const nodes = tree.nodes as unknown as Record<string, AiDoctrineNode>
  const high = walkTree({ rootId: tree.rootId, nodes })
    .filter(({ node }) => {
      const level = aiHeadingLevel(node)
      return level !== null && level < AI_COMPONENT_TOP_HEADING_LEVEL
    })
    .map((visit) => visit.id)
  if (!high.length) return []
  return [
    {
      rule: 11,
      code: 'component-heading-level',
      message: `A component sits inside a page section that opens with its own h2, so its headings start at h${AI_COMPONENT_TOP_HEADING_LEVEL}. Set each heading’s Typography "component" to "h${AI_COMPONENT_TOP_HEADING_LEVEL}" or lower.`,
      nodeIds: aiModelNodeIds(high, tree.sourceIds),
    },
  ]
}

/** Rule 14 on the copy a component shows until a page sets it. */
export function aiComponentDefaultCopyViolations(props: readonly ReusableComponentProp[]): AiDoctrineViolation[] {
  return detectOffVoiceCopy(
    props.flatMap((prop, index) =>
      (prop.type === 'text' || prop.type === 'richText') && typeof prop.defaultValue === 'string'
        ? [{ at: `props[${index}].defaultValue`, text: prop.defaultValue }]
        : [],
    ),
  )
}

/**
 * Every check the component door adds to the doctrine's, on a tree it
 * admitted and the answer the tree came in. `onProps` receives the properties
 * that answer declared, so the step keeps the declaration of the answer the
 * loop keeps — the last one it checked.
 */
export function aiComponentCheck(input: {
  inventory: AiSiteInventory | null
  plan: AiJobPlan | null
  onProps: (props: ReusableComponentProp[]) => void
}): (tree: AiValidatedTree, answer: Record<string, unknown>) => AiDoctrineViolation[] {
  const screenIds = new Set((input.inventory?.screens ?? []).map((screen) => screen.id))
  return (tree, answer) => {
    const reading = readAiComponentProps(answer, { screenIds })
    input.onProps(reading.props)
    return [
      ...reading.violations,
      ...aiComponentBindingViolations(tree, reading.props, input.inventory, reading.refused),
      ...aiComponentHeadingViolations(tree),
      ...aiComponentDefaultCopyViolations(reading.props),
      ...aiPlanReuseViolations(input.inventory, input.plan, aiPlacedComponentIds(tree), 'component'),
      ...aiPlannedPropViolations(input.plan, [
        ...reading.props,
        ...reading.refused.map((name) => ({ name })),
      ]),
    ]
  }
}
