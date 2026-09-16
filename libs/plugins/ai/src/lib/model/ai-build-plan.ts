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

import type { AiTool } from '../providers/contract'

/**
 * The plan a generation job builds from (AGL-2935): what the job's plan step
 * (`jobs/ai-job-plan-step.ts`) returns, before a single node is generated.
 *
 * This module is the plan's MODEL — its shape, its tool schema and its
 * reader — and imports nothing at runtime, so the doctrine validators, the
 * plan step, the job document and the proposal can all read it without
 * importing each other.
 *
 * A plan is REFERENCES, never documents (AGL-2937). It names what the site
 * already has by inventory id, what the job will create by a short name, and
 * which screens it builds from which of those — so the doctrine can be held
 * against the plan while fixing it costs a sentence, not a regenerated page,
 * and the customer reads what the job will do before it spends a credit on
 * doing it.
 *
 * `new:<name>` is how an entry refers to something the plan itself creates;
 * any other reference is an id from the site inventory.
 */

export const AI_PLAN_NEW_REF_PREFIX = 'new:'

/** Records a plan may reuse, by the inventory list they come from. */
export type AiBuildPlanReuseKind =
  | 'component'
  | 'layout'
  | 'template'
  | 'form'
  | 'dataset'
  | 'collection'
  | 'screen'
  | 'theme'

export const AI_BUILD_PLAN_REUSE_KINDS: readonly AiBuildPlanReuseKind[] = [
  'component',
  'layout',
  'template',
  'form',
  'dataset',
  'collection',
  'screen',
  'theme',
]

/** What a plan may create. A theme change is a draft through the theme door, never a literal. */
export type AiBuildPlanCreateKind =
  | 'component'
  | 'layout'
  | 'template'
  | 'form'
  | 'theme-change'
  | 'dataset'
  | 'email'

/**
 * What each creation is called in a sentence, and where a member makes one.
 *
 * Total over the union deliberately: a refusal that cannot name a creation is
 * a refusal a member cannot act on, so widening `AiBuildPlanCreateKind`
 * without saying where the new thing is made does not compile.
 */
export const AI_BUILD_PLAN_CREATION_NOUNS: Record<
  AiBuildPlanCreateKind,
  { noun: string; where: string }
> = {
  component: { noun: 'component', where: 'on the Components page' },
  form: { noun: 'form', where: 'on the Forms page' },
  layout: { noun: 'layout', where: 'on the Layouts page' },
  template: { noun: 'template', where: 'in the Templates library' },
  'theme-change': { noun: 'theme change', where: 'in the Theme section' },
  dataset: { noun: 'dataset', where: 'on the Datasets page' },
  email: { noun: 'email design', where: 'in Emails → Templates' },
}

export const AI_BUILD_PLAN_CREATE_KINDS: readonly AiBuildPlanCreateKind[] = [
  'component',
  'layout',
  'template',
  'form',
  'theme-change',
  'dataset',
  'email',
]

export interface AiBuildPlanReuse {
  kind: AiBuildPlanReuseKind
  /** The inventory id. */
  id: string
  /** What the plan uses it for, in a few words. */
  purpose: string
}

export interface AiBuildPlanCreate {
  kind: AiBuildPlanCreateKind
  /** Unique within the plan; referenced as `new:<name>`. */
  name: string
  /** Why nothing the site has will do — shown in the proposal. */
  why: string
  /** The inventory id this starts from as a duplicate, or null. */
  duplicateOf: string | null
  /**
   * A component or layout: its props as `name:type`. A form or a dataset:
   * its field names. A theme change: the palette paths it adds or changes.
   */
  fields: string[]
}

export interface AiBuildPlanSection {
  /** A few words: "hero", "services grid", "contact form". */
  name: string
  /** What the section places: inventory ids or `new:<name>` references. */
  uses: string[]
  /** How many repeated items it shows (cards, rows, tiles); 0 when none. */
  items: number
}

export interface AiBuildPlanScreen {
  title: string
  slug: string
  /** The layout it renders inside. */
  layout: string | null
  /** The template it applies, or null for a one-off page. */
  template: string | null
  /** The inventory screen it starts from as a duplicate, or null. */
  duplicateOf: string | null
  /** Whether the site navigation gains an entry for it. */
  nav: boolean
  seoTitle: string
  seoDescription: string
  sections: AiBuildPlanSection[]
}

export interface AiBuildPlan {
  reuse: AiBuildPlanReuse[]
  create: AiBuildPlanCreate[]
  screens: AiBuildPlanScreen[]
}

/**
 * How much one plan may hold. A job builds what one proposal can describe
 * and one person can read before confirming; a brief asking for more is
 * several jobs.
 */
export const AI_BUILD_PLAN_LIMITS = {
  reuse: 40,
  create: 20,
  screens: 12,
  sections: 16,
  uses: 8,
  fields: 30,
  text: 200,
  seoDescription: 320,
  items: 500,
} as const

const string = (description: string) => ({ type: 'string', description })
const nullableString = (description: string) => ({
  anyOf: [{ type: 'string' }, { type: 'null' }],
  description,
})
const strings = (description: string) => ({
  type: 'array',
  items: { type: 'string' },
  description,
})

/**
 * The ceiling `parseAiBuildPlan` cuts a field's text at, in words (AGL-3022).
 * The reader repairs an overlong value by cutting it, and a model never told
 * where the cut falls writes a rationale that stops mid-sentence there.
 */
const atMost = (limit: number = AI_BUILD_PLAN_LIMITS.text) => `at most ${limit} characters`

/**
 * The plan as a strict tool's input schema. Only the keywords strict
 * structured output accepts: every object closes its properties and lists
 * every one as required, an optional value is a `null` branch, and no
 * length or count bound appears as a keyword — those are enforced by
 * `parseAiBuildPlan`, which every answer passes through anyway.
 *
 * A text ceiling is stated in words instead, on each field the model writes.
 * A reference is copied from the inventory or from a creation's name, so its
 * length is not the model's to choose. A search title and description are
 * held by rule 10 to ceilings far inside the reader's, which the doctrine
 * states, so naming the reader's here would contradict the rule.
 */
export const AI_BUILD_PLAN_TOOL: AiTool = {
  name: 'submit_build_plan',
  description:
    'Submit the build plan: what the site already has that this job reuses, what it creates and why, and the screens it builds from them.',
  strict: true,
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['reuse', 'create', 'screens'],
    properties: {
      reuse: {
        type: 'array',
        description: 'Records the site already has that this plan uses, by inventory id.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'id', 'purpose'],
          properties: {
            kind: { type: 'string', enum: [...AI_BUILD_PLAN_REUSE_KINDS] },
            id: string('The id from the site inventory.'),
            purpose: string(`What the plan uses it for, in a few words, ${atMost()}.`),
          },
        },
      },
      create: {
        type: 'array',
        description:
          'What the plan creates. Creating is the exception: each entry says why nothing listed will do.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: ['kind', 'name', 'why', 'duplicateOf', 'fields'],
          properties: {
            kind: { type: 'string', enum: [...AI_BUILD_PLAN_CREATE_KINDS] },
            name: string(
              `Unique within the plan, ${atMost()}; other entries refer to it as new:<name>.`,
            ),
            why: string(`Why nothing the site already has will do, in one sentence of ${atMost()}.`),
            duplicateOf: nullableString(
              'The inventory id this starts from as a duplicate, or null.',
            ),
            fields: strings(
              `A component or layout: its props as name:type. A form or dataset: its field names. A theme change: the palette paths it adds or changes. Each ${atMost()}.`,
            ),
          },
        },
      },
      screens: {
        type: 'array',
        description: 'The screens the job builds, each a new draft.',
        items: {
          type: 'object',
          additionalProperties: false,
          required: [
            'title',
            'slug',
            'layout',
            'template',
            'duplicateOf',
            'nav',
            'seoTitle',
            'seoDescription',
            'sections',
          ],
          properties: {
            title: string(`The screen name, ${atMost()}.`),
            slug: string(
              `The path, ${atMost()}: lowercase words joined by hyphens, e.g. /services/roof-repair.`,
            ),
            layout: nullableString(
              'The layout it renders inside: an inventory id or new:<name>.',
            ),
            template: nullableString(
              'The template it applies (inventory id or new:<name>), or null for a one-off page.',
            ),
            duplicateOf: nullableString(
              'The inventory screen it starts from as a duplicate, or null.',
            ),
            nav: {
              type: 'boolean',
              description: 'Whether the site navigation gains an entry for it.',
            },
            seoTitle: string('The search-result title.'),
            seoDescription: string('The search-result description.'),
            sections: {
              type: 'array',
              description: 'The sections, top to bottom.',
              items: {
                type: 'object',
                additionalProperties: false,
                required: ['name', 'uses', 'items'],
                properties: {
                  name: string(`A few words, ${atMost()}: hero, services grid, contact form.`),
                  uses: strings('What the section places: inventory ids or new:<name>.'),
                  items: {
                    type: 'integer',
                    description: 'How many repeated items it shows; 0 when none.',
                  },
                },
              },
            },
          },
        },
      },
    },
  },
}

export type AiBuildPlanParse =
  | { ok: true; plan: AiBuildPlan; repairs: string[] }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class PlanShapeError extends Error {}

/**
 * Read a plan out of a tool call, or name what makes it unreadable.
 *
 * Structure is refused — a missing list, an unknown kind, more screens than
 * a job holds, two creations under one name — because a plan that reads
 * differently from what the model meant is worse than a re-ask. Length is
 * repaired: copy past a ceiling is cut and the cut is listed.
 */
export function parseAiBuildPlan(input: unknown): AiBuildPlanParse {
  const repairs: string[] = []
  const text = (
    value: unknown,
    path: string,
    limit: number = AI_BUILD_PLAN_LIMITS.text,
  ): string => {
    if (typeof value !== 'string') throw new PlanShapeError(`${path} is not text`)
    const trimmed = value.trim()
    if (trimmed.length > limit) {
      repairs.push(`${path} was over ${limit} characters; truncated`)
      // On the last word break inside the ceiling, not through a word: a
      // rationale is read by the member confirming the plan, and half a word
      // reads as a broken answer rather than a long one (AGL-3022). A run of
      // `limit` characters with no break in it still has to be cut where the
      // ceiling falls.
      const cut = trimmed.slice(0, limit)
      const brk = cut.search(/\s\S*$/)
      return (brk > 0 ? cut.slice(0, brk) : cut).trimEnd()
    }
    return trimmed
  }
  const nullable = (value: unknown, path: string): string | null =>
    value === null || value === undefined || value === '' ? null : text(value, path) || null
  const list = (value: unknown, path: string, limit: number): unknown[] => {
    if (!Array.isArray(value)) throw new PlanShapeError(`${path} is not a list`)
    if (value.length > limit) {
      throw new PlanShapeError(`${path} lists ${value.length}; one plan holds at most ${limit}`)
    }
    return value
  }
  const record = (value: unknown, path: string): Record<string, unknown> => {
    if (!isRecord(value)) throw new PlanShapeError(`${path} is not an object`)
    return value
  }
  const oneOf = <T extends string>(value: unknown, allowed: readonly T[], path: string): T => {
    if (typeof value !== 'string' || !(allowed as readonly string[]).includes(value)) {
      throw new PlanShapeError(`${path} is not one of ${allowed.join(', ')}`)
    }
    return value as T
  }

  try {
    const root = record(input, 'plan')
    const reuse = list(root['reuse'], 'reuse', AI_BUILD_PLAN_LIMITS.reuse).map((raw, index) => {
      const entry = record(raw, `reuse[${index}]`)
      const id = text(entry['id'], `reuse[${index}].id`)
      if (!id) throw new PlanShapeError(`reuse[${index}].id is empty`)
      return {
        kind: oneOf(entry['kind'], AI_BUILD_PLAN_REUSE_KINDS, `reuse[${index}].kind`),
        id,
        purpose: text(entry['purpose'], `reuse[${index}].purpose`),
      }
    })
    const names = new Set<string>()
    const create = list(root['create'], 'create', AI_BUILD_PLAN_LIMITS.create).map(
      (raw, index) => {
        const entry = record(raw, `create[${index}]`)
        const name = text(entry['name'], `create[${index}].name`)
        if (!name) throw new PlanShapeError(`create[${index}].name is empty`)
        const key = name.toLowerCase()
        if (names.has(key)) {
          throw new PlanShapeError(`create[${index}].name "${name}" is used twice`)
        }
        names.add(key)
        return {
          kind: oneOf(entry['kind'], AI_BUILD_PLAN_CREATE_KINDS, `create[${index}].kind`),
          name,
          why: text(entry['why'], `create[${index}].why`),
          duplicateOf: nullable(entry['duplicateOf'], `create[${index}].duplicateOf`),
          fields: list(entry['fields'] ?? [], `create[${index}].fields`, AI_BUILD_PLAN_LIMITS.fields)
            .map((field, fieldIndex) => text(field, `create[${index}].fields[${fieldIndex}]`))
            .filter(Boolean),
        }
      },
    )
    const screens = list(root['screens'], 'screens', AI_BUILD_PLAN_LIMITS.screens).map(
      (raw, index) => {
        const entry = record(raw, `screens[${index}]`)
        if (typeof entry['nav'] !== 'boolean') {
          throw new PlanShapeError(`screens[${index}].nav is not true or false`)
        }
        return {
          title: text(entry['title'], `screens[${index}].title`),
          slug: text(entry['slug'], `screens[${index}].slug`),
          layout: nullable(entry['layout'], `screens[${index}].layout`),
          template: nullable(entry['template'], `screens[${index}].template`),
          duplicateOf: nullable(entry['duplicateOf'], `screens[${index}].duplicateOf`),
          nav: entry['nav'],
          seoTitle: text(entry['seoTitle'], `screens[${index}].seoTitle`),
          seoDescription: text(
            entry['seoDescription'],
            `screens[${index}].seoDescription`,
            AI_BUILD_PLAN_LIMITS.seoDescription,
          ),
          sections: list(
            entry['sections'],
            `screens[${index}].sections`,
            AI_BUILD_PLAN_LIMITS.sections,
          ).map((rawSection, sectionIndex) => {
            const path = `screens[${index}].sections[${sectionIndex}]`
            const section = record(rawSection, path)
            const items = Number(section['items'] ?? 0)
            if (!Number.isInteger(items) || items < 0 || items > AI_BUILD_PLAN_LIMITS.items) {
              throw new PlanShapeError(`${path}.items is not a count`)
            }
            return {
              name: text(section['name'], `${path}.name`),
              uses: list(section['uses'] ?? [], `${path}.uses`, AI_BUILD_PLAN_LIMITS.uses)
                .map((ref, refIndex) => text(ref, `${path}.uses[${refIndex}]`))
                .filter(Boolean),
              items,
            }
          }),
        }
      },
    )
    return { ok: true, plan: { reuse, create, screens }, repairs }
  } catch (error) {
    if (error instanceof PlanShapeError) return { ok: false, error: error.message }
    throw error
  }
}

/** Whether a reference names something the plan creates. */
export function isAiPlanNewRef(ref: string | null | undefined): ref is string {
  return typeof ref === 'string' && ref.startsWith(AI_PLAN_NEW_REF_PREFIX)
}

/** The creation a `new:<name>` reference names, case-insensitively. */
export function aiPlanCreateFor(
  plan: AiBuildPlan,
  ref: string,
): AiBuildPlanCreate | undefined {
  if (!isAiPlanNewRef(ref)) return undefined
  const name = ref.slice(AI_PLAN_NEW_REF_PREFIX.length).trim().toLowerCase()
  return plan.create.find((entry) => entry.name.toLowerCase() === name)
}

/**
 * A `new:<name>` reference that names no entry of the plan's create list: a
 * screen's own layout or template, or what one of its sections places, with
 * that section's index.
 */
export type AiPlanUndeclaredRef = {
  /** The name the reference gives the creation, as written after `new:`. */
  name: string
  /** Where the plan writes it: `screens[0].template`, `screens[0].sections[4].uses[0]`. */
  path: string
  /** The screen that writes it, by index. */
  screenIndex: number
} & ({ field: 'layout' | 'template'; sectionIndex: null } | { field: 'uses'; sectionIndex: number })

/**
 * Every `new:<name>` reference the plan's create list does not carry, in plan
 * order: each screen's layout, then its template, then what its sections
 * place. A plan that places a creation it never declares has nothing to build
 * it from, so the plan rules refuse each (AGL-3040), and the page and
 * scaffold doors still name one in a plan confirmed before they did.
 */
export function aiPlanUndeclaredRefs(plan: AiBuildPlan): AiPlanUndeclaredRef[] {
  const found: AiPlanUndeclaredRef[] = []
  const undeclared = (ref: string | null): ref is string =>
    isAiPlanNewRef(ref) && !aiPlanCreateFor(plan, ref)
  const nameOf = (ref: string) => ref.slice(AI_PLAN_NEW_REF_PREFIX.length).trim()
  plan.screens.forEach((screen, screenIndex) => {
    for (const field of ['layout', 'template'] as const) {
      const ref = screen[field]
      if (!undeclared(ref)) continue
      found.push({
        name: nameOf(ref),
        path: `screens[${screenIndex}].${field}`,
        screenIndex,
        field,
        sectionIndex: null,
      })
    }
    screen.sections.forEach((section, sectionIndex) => {
      section.uses.forEach((ref, useIndex) => {
        if (!undeclared(ref)) return
        found.push({
          name: nameOf(ref),
          path: `screens[${screenIndex}].sections[${sectionIndex}].uses[${useIndex}]`,
          screenIndex,
          field: 'uses',
          sectionIndex,
        })
      })
    })
  })
  return found
}
