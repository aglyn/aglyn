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
   * A component: its props as `name:type`, an icon as `name:icon`
   * (AGL-3054). A layout: the regions it has, from the closed vocabulary
   * `AI_LAYOUT_REGIONS` holds (AGL-3024) — a layout has no props, and a
   * region named here is what the built layout is held to. A template: the
   * binding tokens its page shows, from the subject's own closed catalog
   * (`AI_TEMPLATE_SUBJECT_DEFINITIONS[subject].tokens`, AGL-3143) — the
   * template's analogue of a layout's regions, and what the built template is
   * held to. A form or a dataset: its field names. A theme change: the
   * palette paths it adds or changes.
   */
  fields: string[]
  /**
   * The id the draft this creation becomes is written under, where a unit of
   * the job builds it (AGL-3079). Minted when the job keeps the plan, never
   * part of the model's answer.
   */
  id?: string
}

export interface AiBuildPlanSection {
  /** A few words: "hero", "services grid", "contact form". */
  name: string
  /** What the section places: inventory ids or `new:<name>` references. */
  uses: string[]
  /** How many repeated items it shows (cards, rows, tiles); 0 when none. */
  items: number
}

/**
 * A screen that is one dataset's record template (AGL-3475): the data plugin
 * serves it once per record at `/{base}/{slug}`, its copy bound with
 * `{{item.<field>}}`. The plan names the binding and the build drafts the
 * page; the member saves the binding in Page Properties → Record pages, since
 * a binding is a route and a job writes drafts only (rule 13).
 */
export interface AiBuildPlanRecord {
  /** The dataset: an inventory id or `new:<name>`. */
  dataset: string
  /** The path its record pages live under, one or more segments: `services`, `services/residential`. */
  base: string
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
  /**
   * The dataset this page is the record template of, or null for a page that
   * is one page. A plan kept before record templates carries none, which
   * reads as null.
   */
  record: AiBuildPlanRecord | null
  /**
   * The id the draft screen is written under, where a unit of the job builds
   * it (AGL-3079). Minted when the job keeps the plan, never part of the
   * model's answer.
   */
  id?: string
}

/** The third-party players a plan may embed: the hosts the Video embed element plays. */
export type AiBuildPlanEmbedHost = 'youtube' | 'vimeo'

export const AI_BUILD_PLAN_EMBED_HOSTS: readonly AiBuildPlanEmbedHost[] = ['youtube', 'vimeo']

/** What each host is called in a sentence. */
export const AI_BUILD_PLAN_EMBED_HOST_NAMES: Record<AiBuildPlanEmbedHost, string> = {
  youtube: 'YouTube',
  vimeo: 'Vimeo',
}

/**
 * A third-party player the brief asks for (rule 16, AGL-3433). It loads its
 * host's code on the page that carries it, so it is planned, where the member
 * reads that cost before confirming, and a build admits only what the
 * confirmed plan lists.
 */
export interface AiBuildPlanEmbed {
  host: AiBuildPlanEmbedHost
  /** Where it plays: a screen of the plan by its slug, or `new:<name>` for a component the plan creates. */
  where: string
  /** The brief's own words asking for it, which the plan step finds in the brief. */
  asked: string
  /** The video's link as the brief gives it, or null for the site owner to paste. */
  url: string | null
}

/** How the items that depend on a failed item behave (AGL-3616). */
export type AiBuildItemDegrade = 'omit' | 'fallback'

export const AI_BUILD_ITEM_DEGRADES: readonly AiBuildItemDegrade[] = ['omit', 'fallback']

/** One argument value of an item: scalars and lists of text only. */
export type AiBuildItemArg = string | number | boolean | string[]

/**
 * One thing a `build` plan makes that its creations and screens do not
 * (AGL-3616): an operation another plugin — or this one — registered as an
 * AI capability, with the arguments its schema declares. `reuse`, `create`
 * and `screens` keep their meaning; an item is everything else.
 */
export interface AiBuildItem {
  /** Stable within the plan: `i0`, `i1`… in plan order. */
  slot: string
  /** The capability's operation. */
  op: string
  /** Unique within the plan, creations included; referenced as `new:<name>`. */
  name: string
  /** Why the brief needs it, in one sentence. */
  why: string
  /** What it is built after: `new:<name>` of a creation or another item. */
  dependsOn: string[]
  /** How the items that depend on it behave when it fails. */
  degrade: AiBuildItemDegrade
  /** The operation's arguments, in the shape its capability declares. */
  args: Record<string, AiBuildItemArg>
  /** The id its draft is written under, minted when the job keeps the plan; never the model's. */
  id?: string
  /** The most it can cost in credits, from its capability, recorded when the plan is kept. */
  credits?: number
}

export interface AiBuildPlan {
  reuse: AiBuildPlanReuse[]
  create: AiBuildPlanCreate[]
  screens: AiBuildPlanScreen[]
  /**
   * The third-party players the brief asks for. Absent is none: a plan kept
   * before the list existed, and every plan whose brief asks for no player.
   */
  embeds?: AiBuildPlanEmbed[]
  /**
   * What a `build` plan makes beyond its creations and pages (AGL-3616).
   * Absent is none: every other kind's plan.
   */
  items?: AiBuildItem[]
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
  embeds: 4,
  text: 200,
  seoDescription: 320,
  items: 500,
  /** A build plan's items (AGL-3616). */
  buildItems: 16,
  /** What one item depends on. */
  dependsOn: 8,
  /** The arguments one item carries, as JSON. */
  argsChars: 2_000,
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
    'Submit the build plan: what the site already has that this job reuses, what it creates and why, and the pages it builds from them.',
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
              `A component: its props as name:type, an icon as name:icon. A layout: the regions it has, each one of header, nav, sidebar, main, footer — list every region the finished layout has, not only the ones it gains. A form or dataset: its field names. A theme change: the palette paths it adds or changes. Each ${atMost()}.`,
            ),
          },
        },
      },
      screens: {
        type: 'array',
        description: 'The pages the job builds, each a new draft.',
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
            title: string(`The page name, ${atMost()}.`),
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
              'The inventory page it starts from as a duplicate, or null.',
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

/** Words that ask for a video, or a link to one. */
export const AI_PLAN_ASKS_FOR_VIDEO = /\b(?:videos?|films?|clips?|youtube|vimeo|player)\b|youtu\.be/i

const EMBEDS_SCHEMA = {
  type: 'array',
  description:
    'A YouTube or Vimeo player the brief asks for, on a screen or a created component. Empty unless the brief asks; a library film is a Video.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['host', 'where', 'asked', 'url'],
    properties: {
      host: { type: 'string', enum: [...AI_BUILD_PLAN_EMBED_HOSTS] },
      where: string('A screen slug, or new:<name> of a component.'),
      asked: string('The words of the brief that ask for it, copied exactly.'),
      url: nullableString('The video link the brief gives, or null.'),
    },
  },
}

/**
 * The plan tool with its list of third-party players, offered only to a brief
 * that asks for a video (AGL-3433). Every other plan's request is the plain
 * tool, byte for byte, so the list costs nothing on the plans that cannot use
 * it, and a model answering a brief that names no video has nowhere to plan a
 * player it was never asked for.
 */
export const AI_BUILD_PLAN_EMBEDS_TOOL: AiTool = {
  ...AI_BUILD_PLAN_TOOL,
  inputSchema: {
    ...AI_BUILD_PLAN_TOOL.inputSchema,
    required: [...(AI_BUILD_PLAN_TOOL.inputSchema['required'] as string[]), 'embeds'],
    properties: {
      ...(AI_BUILD_PLAN_TOOL.inputSchema['properties'] as Record<string, unknown>),
      embeds: EMBEDS_SCHEMA,
    },
  },
}

const RECORD_SCHEMA = {
  anyOf: [
    {
      type: 'object',
      additionalProperties: false,
      required: ['dataset', 'base'],
      properties: {
        dataset: string('The dataset: an inventory id or new:<name>.'),
        base: string('The path its record pages live under, e.g. services for /services/roofing.'),
      },
    },
    { type: 'null' },
  ],
  description:
    "When this page is one dataset's record template, serving a page per record at /<base>/<record address> with its copy bound as {{item.<field>}}: the dataset and the base. Otherwise null.",
}

/** A plan tool whose screens each name the dataset they are the record template of, or null. */
function withRecords(tool: AiTool): AiTool {
  const properties = tool.inputSchema['properties'] as Record<string, unknown>
  const screens = properties['screens'] as { items: Record<string, unknown> }
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      properties: {
        ...properties,
        screens: {
          ...screens,
          items: {
            ...screens.items,
            required: [...(screens.items['required'] as string[]), 'record'],
            properties: {
              ...(screens.items['properties'] as Record<string, unknown>),
              record: RECORD_SCHEMA,
            },
          },
        },
      },
    },
  }
}

/**
 * The plan tools with a record template on every screen (AGL-3475), offered
 * only where the job may bind a dataset: a site with a dataset, or a job that
 * may create one. Record pages are a Starter feature, and every other plan's
 * request is the plain tool, byte for byte, so the field costs a Free taste
 * nothing and a model planning a site with no dataset has none to bind.
 */
export const AI_BUILD_PLAN_RECORDS_TOOL: AiTool = withRecords(AI_BUILD_PLAN_TOOL)
export const AI_BUILD_PLAN_EMBEDS_RECORDS_TOOL: AiTool = withRecords(AI_BUILD_PLAN_EMBEDS_TOOL)

const ITEMS_SCHEMA = {
  type: 'array',
  description:
    'What the plan makes beyond its creations and pages, each one operation from the list in the request. Empty when the brief asks for nothing else.',
  items: {
    type: 'object',
    additionalProperties: false,
    required: ['op', 'name', 'why', 'dependsOn', 'degrade', 'args'],
    properties: {
      op: string('The operation, exactly as the request lists it.'),
      name: string(`Unique within the plan, creations included, ${atMost()}; other entries refer to it as new:<name>.`),
      why: string(`Why the brief needs it, in one sentence of ${atMost()}.`),
      dependsOn: strings('What it is built after: new:<name> of a creation or another item. Empty when nothing.'),
      degrade: {
        type: 'string',
        enum: [...AI_BUILD_ITEM_DEGRADES],
        description:
          'omit: what depends on it is built without it if it fails. fallback: what depends on it uses something the site already has instead.',
      },
      args: string('Its arguments as one JSON object, with exactly the fields the request lists for the operation.'),
    },
  },
}

/**
 * Any plan tool with a build's items (AGL-3616), offered only to a `build`
 * job. The items' arguments travel as one JSON string whose fields the
 * request lists per operation, so the tool stays byte for byte the same
 * whichever plugins registered operations, and the prompt cache keeps it.
 */
export function withBuildItems(tool: AiTool): AiTool {
  return {
    ...tool,
    inputSchema: {
      ...tool.inputSchema,
      required: [...(tool.inputSchema['required'] as string[]), 'items'],
      properties: {
        ...(tool.inputSchema['properties'] as Record<string, unknown>),
        items: ITEMS_SCHEMA,
      },
    },
  }
}

/** The plan tool a brief is answered with, on a job that may or may not bind a dataset. */
export function aiBuildPlanToolFor(
  brief: string,
  options: { records?: boolean; items?: boolean } = {},
): AiTool {
  const video = AI_PLAN_ASKS_FOR_VIDEO.test(brief)
  const tool = options.records
    ? video
      ? AI_BUILD_PLAN_EMBEDS_RECORDS_TOOL
      : AI_BUILD_PLAN_RECORDS_TOOL
    : video
      ? AI_BUILD_PLAN_EMBEDS_TOOL
      : AI_BUILD_PLAN_TOOL
  return options.items ? withBuildItems(tool) : tool
}

export type AiBuildPlanParse =
  | { ok: true; plan: AiBuildPlan; repairs: string[] }
  | { ok: false; error: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

class PlanShapeError extends Error {}

/**
 * An item's arguments as the plan keeps them: the model writes one JSON
 * string, a kept plan stores the object. Values are scalars and lists of
 * text; anything else is a shape the item cannot be built from.
 */
function buildItemArgs(value: unknown, path: string): Record<string, AiBuildItemArg> {
  let parsed: unknown = value
  if (value === undefined || value === null || value === '') return {}
  if (typeof value === 'string') {
    if (value.length > AI_BUILD_PLAN_LIMITS.argsChars) {
      throw new PlanShapeError(`${path} is over ${AI_BUILD_PLAN_LIMITS.argsChars} characters`)
    }
    try {
      parsed = JSON.parse(value)
    } catch {
      throw new PlanShapeError(`${path} is not a JSON object`)
    }
  }
  if (!isRecord(parsed)) throw new PlanShapeError(`${path} is not a JSON object`)
  const args: Record<string, AiBuildItemArg> = {}
  for (const [key, raw] of Object.entries(parsed)) {
    if (raw === null || raw === undefined) continue
    if (typeof raw === 'string' || typeof raw === 'boolean' || (typeof raw === 'number' && Number.isFinite(raw))) {
      args[key] = raw
    } else if (Array.isArray(raw) && raw.every((one) => typeof one === 'string')) {
      args[key] = raw as string[]
    } else {
      throw new PlanShapeError(`${path}.${key} is not text, a number, true or false, or a list of text`)
    }
  }
  return args
}

/**
 * Read a plan out of a tool call, or name what makes it unreadable.
 *
 * Structure is refused — a missing list, an unknown kind, more screens than
 * a job holds, two creations under one name — because a plan that reads
 * differently from what the model meant is worse than a re-ask. Length is
 * repaired: copy past a ceiling is cut and the cut is listed.
 */
/**
 * A layout's regions, one word each. A plan sometimes writes the whole list as
 * one entry — "regions: header, nav, main, footer" — which names regions the
 * platform builds but reads as one unknown word, and the plan was refused for
 * it (job AvVxbFbzQx). A leading label is dropped and a list is split on its
 * commas, slashes, plus signs and "and", so each region is checked on its own;
 * a duplicate keeps its first place.
 */
export function aiPlanLayoutRegionWords(fields: readonly string[]): string[] {
  const words: string[] = []
  for (const field of fields) {
    const listed = /^\s*(?:the\s+)?(?:layout\s+)?(?:regions?|areas?)\s*[:=-]\s*(.+)$/i.exec(field)?.[1] ?? field
    const parts = /[,/+]|\band\b/i.test(listed)
      ? listed.split(/\s*(?:,|\/|\+|\band\b)\s*/i)
      : [listed]
    for (const part of parts) {
      const word = part.trim()
      if (word && !words.some((seen) => seen.toLowerCase() === word.toLowerCase())) words.push(word)
    }
  }
  return words
}

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
  // Absent or null is a page that is one page. A base is held to the shape a
  // record page's address takes, so the binding the member saves from it is
  // one the save route admits.
  const planRecord = (value: unknown, path: string): AiBuildPlanRecord | null => {
    if (value === null || value === undefined) return null
    const entry = record(value, path)
    const dataset = text(entry['dataset'], `${path}.dataset`)
    if (!dataset) throw new PlanShapeError(`${path}.dataset is empty`)
    const base = aiPlanRecordBase(text(entry['base'], `${path}.base`))
    if (!base) throw new PlanShapeError(`${path}.base is not a path of lowercase words joined by hyphens`)
    return { dataset, base }
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
        const kind = oneOf(entry['kind'], AI_BUILD_PLAN_CREATE_KINDS, `create[${index}].kind`)
        const fields = list(entry['fields'] ?? [], `create[${index}].fields`, AI_BUILD_PLAN_LIMITS.fields)
          .map((field, fieldIndex) => text(field, `create[${index}].fields[${fieldIndex}]`))
          .filter(Boolean)
        return {
          kind,
          name,
          why: text(entry['why'], `create[${index}].why`),
          duplicateOf: nullable(entry['duplicateOf'], `create[${index}].duplicateOf`),
          fields: kind === 'layout' ? aiPlanLayoutRegionWords(fields) : fields,
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
          record: planRecord(entry['record'], `screens[${index}].record`),
        }
      },
    )
    const embeds = list(root['embeds'] ?? [], 'embeds', AI_BUILD_PLAN_LIMITS.embeds).map(
      (raw, index) => {
        const entry = record(raw, `embeds[${index}]`)
        const where = text(entry['where'], `embeds[${index}].where`)
        if (!where) throw new PlanShapeError(`embeds[${index}].where is empty`)
        return {
          host: oneOf(entry['host'], AI_BUILD_PLAN_EMBED_HOSTS, `embeds[${index}].host`),
          where,
          asked: text(entry['asked'], `embeds[${index}].asked`),
          url: nullable(entry['url'], `embeds[${index}].url`),
        }
      },
    )
    const items = list(root['items'] ?? [], 'items', AI_BUILD_PLAN_LIMITS.buildItems).map(
      (raw, index): AiBuildItem => {
        const path = `items[${index}]`
        const entry = record(raw, path)
        const op = text(entry['op'], `${path}.op`)
        if (!op) throw new PlanShapeError(`${path}.op is empty`)
        const name = text(entry['name'], `${path}.name`)
        if (!name) throw new PlanShapeError(`${path}.name is empty`)
        const key = name.toLowerCase()
        if (names.has(key)) throw new PlanShapeError(`${path}.name "${name}" is used twice`)
        names.add(key)
        return {
          slot: `i${index}`,
          op,
          name,
          why: text(entry['why'] ?? '', `${path}.why`),
          dependsOn: list(entry['dependsOn'] ?? [], `${path}.dependsOn`, AI_BUILD_PLAN_LIMITS.dependsOn)
            .map((ref, refIndex) => text(ref, `${path}.dependsOn[${refIndex}]`))
            .filter(Boolean),
          degrade:
            entry['degrade'] === undefined || entry['degrade'] === null
              ? 'omit'
              : oneOf(entry['degrade'], AI_BUILD_ITEM_DEGRADES, `${path}.degrade`),
          args: buildItemArgs(entry['args'], `${path}.args`),
          ...(typeof entry['id'] === 'string' && entry['id'] ? { id: entry['id'] } : {}),
          ...(typeof entry['credits'] === 'number' && Number.isFinite(entry['credits'])
            ? { credits: Math.max(0, Math.floor(entry['credits'])) }
            : {}),
        }
      },
    )
    // A plan whose brief asks for no player carries no list, as it did before the list existed;
    // so does a plan with no items.
    return {
      ok: true,
      plan: {
        reuse,
        create,
        screens,
        ...(embeds.length ? { embeds } : {}),
        ...(items.length ? { items } : {}),
      },
      repairs,
    }
  } catch (error) {
    if (error instanceof PlanShapeError) return { ok: false, error: error.message }
    throw error
  }
}

/**
 * A record template's base as the data plugin's save route stores it
 * (`normalizeRecordPageBase`, which this plugin may not import): one to four
 * lowercase segments of letters, digits and hyphens, with no leading or
 * trailing slash; null for a base that is no such path.
 */
export function aiPlanRecordBase(base: string): string | null {
  const segments = base.trim().toLowerCase().split('/').filter(Boolean)
  if (!segments.length || segments.length > 4) return null
  return segments.every(
    (segment) => segment.length <= 60 && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(segment),
  )
    ? segments.join('/')
    : null
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

/** The item a `new:<name>` reference names, case-insensitively (AGL-3616). */
export function aiPlanItemFor(
  plan: Pick<AiBuildPlan, 'items'>,
  ref: string,
): AiBuildItem | undefined {
  if (!isAiPlanNewRef(ref)) return undefined
  const name = ref.slice(AI_PLAN_NEW_REF_PREFIX.length).trim().toLowerCase()
  return (plan.items ?? []).find((entry) => entry.name.toLowerCase() === name)
}

/** A slug as two spellings of one path compare: lowercase, one leading slash, no trailing one. */
export function aiPlanSlugKey(slug: string): string {
  const path = slug.trim().toLowerCase().replace(/^\/*/, '/').replace(/\/+$/, '')
  return path || '/'
}

/**
 * The players the plan lists for one output (AGL-3433): a screen by its slug,
 * or a creation by its name. A build admits these and no other.
 */
export function aiPlanEmbedsFor(
  plan: Pick<AiBuildPlan, 'embeds'> | null | undefined,
  target: { slug: string } | { create: string },
): AiBuildPlanEmbed[] {
  const key =
    'slug' in target
      ? aiPlanSlugKey(target.slug)
      : `${AI_PLAN_NEW_REF_PREFIX}${target.create.trim().toLowerCase()}`
  return (plan?.embeds ?? []).filter((embed) =>
    'slug' in target
      ? !isAiPlanNewRef(embed.where) && aiPlanSlugKey(embed.where) === key
      : embed.where.trim().toLowerCase() === key,
  )
}

/** The host a video link plays from, or null for a link neither host serves. */
export function aiEmbedHostOf(url: string): AiBuildPlanEmbedHost | null {
  try {
    const parsed = new URL(url.trim())
    if (parsed.protocol !== 'https:') return null
    const host = parsed.hostname.replace(/^(?:www|m)\./, '')
    if (host === 'youtu.be' || host === 'youtube.com' || host === 'youtube-nocookie.com') {
      return 'youtube'
    }
    if (host === 'vimeo.com' || host === 'player.vimeo.com') return 'vimeo'
  } catch {
    /* not a link */
  }
  return null
}

/**
 * One video however its link is spelled — `youtu.be/<id>`, a watch link, an
 * embed or a Shorts link — as `<host>:<id>`, the way the Video embed element
 * reads a link; null for a link it cannot play.
 */
export function aiEmbedVideoKey(url: string): string | null {
  const host = aiEmbedHostOf(url)
  if (!host) return null
  const parsed = new URL(url.trim())
  const parts = parsed.pathname.split('/').filter(Boolean)
  const id =
    host === 'vimeo'
      ? parts.find((part) => /^\d{6,}$/.test(part))
      : parsed.hostname.endsWith('youtu.be')
        ? parts[0]
        : (parsed.searchParams.get('v') ??
          (parts[0] === 'embed' || parts[0] === 'shorts' ? parts[1] : undefined))
  return id && /^[\w-]{6,20}$/.test(id) ? `${host}:${id}` : null
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
    isAiPlanNewRef(ref) && !aiPlanCreateFor(plan, ref) && !aiPlanItemFor(plan, ref)
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
