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
 * Duplicating a resource whole (AGL-2936): the catalog every surface reads.
 *
 * One list of the kinds that can be copied, what a copy is called, how its
 * name and slug are made unique, and the activity code the copy writes —
 * shared by the row menus and More menus that offer the action, the routes
 * that perform it, the AI tool that exposes it, and the feed that reports
 * it. A kind missing from the catalog cannot be offered anywhere, so the
 * three surfaces cannot disagree about what is duplicable.
 *
 * The activity rows are CODES rather than the prose sentences the rest of
 * the feed stores, for the reason the AI rows are (`ai-activity-actions`):
 * the code names the kind, the feed translates it once, and a reader who
 * filters on "duplicated" sees every kind's copies together.
 *
 * A theme is absent on purpose. A site holds exactly one, as fields on its
 * host document rather than as a row in a collection, so there is no list
 * for a second one to appear in: copying a theme means carrying it to
 * another site or saving it into a template, and both of those doors
 * already exist (marketplace install, Save as template).
 */

/** The resource kinds a whole copy can be made of. */
export const DUPLICABLE_RESOURCE_KINDS = [
  'screen',
  'component',
  'layout',
  'template',
  'form',
  'emailDesign',
  'emailTemplate',
  'campaign',
  'workflow',
] as const

export type DuplicableResourceKind = (typeof DUPLICABLE_RESOURCE_KINDS)[number]

export function isDuplicableResourceKind(
  value: unknown,
): value is DuplicableResourceKind {
  return (
    typeof value === 'string' &&
    (DUPLICABLE_RESOURCE_KINDS as readonly string[]).includes(value)
  )
}

/**
 * The kinds that live under a site and are copied by the core server module;
 * the other two belong to the plugins that own their collections.
 */
export const DUPLICABLE_HOST_RESOURCE_KINDS = [
  'screen',
  'component',
  'layout',
  'template',
  'form',
  'emailDesign',
  'workflow',
] as const satisfies readonly DuplicableResourceKind[]

export type DuplicableHostResourceKind =
  (typeof DUPLICABLE_HOST_RESOURCE_KINDS)[number]

export function isDuplicableHostResourceKind(
  value: unknown,
): value is DuplicableHostResourceKind {
  return (
    typeof value === 'string' &&
    (DUPLICABLE_HOST_RESOURCE_KINDS as readonly string[]).includes(value)
  )
}

/** The one-line refusal a client shows when the copy is already being made. */
export const DUPLICATE_BUSY_MESSAGE = 'That copy is still being made'

/** What a person calls one of each, in the dialog and the feed. */
export const DUPLICABLE_RESOURCE_NOUNS: Record<DuplicableResourceKind, string> = {
  screen: 'screen',
  component: 'component',
  layout: 'layout',
  template: 'template',
  form: 'form',
  emailDesign: 'email design',
  emailTemplate: 'email template',
  campaign: 'campaign',
  workflow: 'workflow',
}

/**
 * What the copy carries, per kind — the sentence the dialog shows before the
 * copy is made, so nobody is surprised by what came along and what did not.
 */
export const DUPLICATE_COPIES: Record<DuplicableResourceKind, readonly string[]> = {
  screen: [
    'The latest version, with its full element tree and layout values',
    'Description and SEO fields',
    'A new draft — the copy is not published and has no address yet',
  ],
  component: [
    'The definition and its properties',
    'The latest version as a new draft',
    'No instances — screens keep pointing at the original',
  ],
  layout: [
    'The latest version, with its full element tree and properties',
    'A new draft — no screen uses the copy yet',
  ],
  template: [
    'The element tree, placeholders and properties',
    'Description, slug and SEO fields',
  ],
  form: [
    'The design, fields, validation, consent and routing',
    'A new form of its own — submissions stay with the original',
  ],
  emailDesign: [
    'The latest version, with its full element tree',
    'A new draft — not published',
  ],
  emailTemplate: ['The subject and body, with their merge fields'],
  campaign: [
    'The subject, message, sender and design',
    'A new draft — the audience and the send time are cleared',
  ],
  workflow: [
    'Every step and the return value',
    'The trigger is cleared, so the copy runs nothing until you arm it',
  ],
}

/** The action code each copy writes to the activity logs. */
export const DUPLICATE_ACTIVITY_ACTIONS: Record<DuplicableResourceKind, string> = {
  screen: 'screen.duplicated',
  component: 'component.duplicated',
  layout: 'layout.duplicated',
  template: 'template.duplicated',
  form: 'form.duplicated',
  emailDesign: 'emailDesign.duplicated',
  emailTemplate: 'emailTemplate.duplicated',
  campaign: 'campaign.duplicated',
  workflow: 'workflow.duplicated',
}

/** `a screen`, `an email design` — the article the noun takes. */
const withArticle = (noun: string): string =>
  `${/^[aeiou]/i.test(noun) ? 'an' : 'a'} ${noun}`

/** What a person reads for each code, in the feed and the actor table. */
export const DUPLICATE_ACTIVITY_ACTION_LABELS: Record<string, string> =
  Object.fromEntries(
    DUPLICABLE_RESOURCE_KINDS.map((kind) => [
      DUPLICATE_ACTIVITY_ACTIONS[kind],
      `Duplicated ${withArticle(DUPLICABLE_RESOURCE_NOUNS[kind])}`,
    ]),
  )

/** Whether a stored action is one of the duplicate codes. */
export function isDuplicateActivityAction(action: unknown): boolean {
  return typeof action === 'string' && action in DUPLICATE_ACTIVITY_ACTION_LABELS
}

/** The readable label for a duplicate code; `undefined` for any other action. */
export function duplicateActivityActionLabel(action: unknown): string | undefined {
  return isDuplicateActivityAction(action)
    ? DUPLICATE_ACTIVITY_ACTION_LABELS[action as string]
    : undefined
}

/** The name a copy is offered under before anyone edits it. */
export const DUPLICATE_NAME_PREFIX = 'Copy of '

/** The longest name a copy may carry, matching the create drawers' field. */
export const DUPLICATE_NAME_MAX = 200

/**
 * The default name for a copy of `sourceName`, before uniqueness.
 *
 * A copy of a copy does not stack prefixes — `Copy of Copy of Home` tells
 * nobody anything — so a name already carrying the prefix keeps it, and the
 * counter {@link uniqueDuplicateName} appends is what tells the two apart.
 */
export function duplicateDisplayName(sourceName: string | null | undefined): string {
  const name = String(sourceName ?? '').trim() || 'Untitled'
  const base = name.startsWith(DUPLICATE_NAME_PREFIX)
    ? name
    : `${DUPLICATE_NAME_PREFIX}${name}`
  return base.slice(0, DUPLICATE_NAME_MAX)
}

/**
 * The first of `requested`, `requested 2`, `requested 3`, … that no sibling
 * already carries, compared case-insensitively so `Home` and `home` are one
 * name. A blank request falls back to the prefix alone, never to an empty
 * name; the counter starts at 2 because the unnumbered name IS the first.
 */
export function uniqueDuplicateName(
  requested: string | null | undefined,
  taken: Iterable<string | null | undefined>,
): string {
  const base =
    String(requested ?? '')
      .trim()
      .slice(0, DUPLICATE_NAME_MAX) || DUPLICATE_NAME_PREFIX.trim()
  const used = new Set<string>()
  for (const name of taken) {
    const key = String(name ?? '').trim().toLowerCase()
    if (key) used.add(key)
  }
  if (!used.has(base.toLowerCase())) return base
  for (let counter = 2; ; counter += 1) {
    const suffix = ` ${counter}`
    const candidate = `${base.slice(0, DUPLICATE_NAME_MAX - suffix.length)}${suffix}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

/** The suffix a copied slug takes so it never claims the original's address. */
export const DUPLICATE_SLUG_SUFFIX = '-copy'

/**
 * `<slug>-copy`, then `<slug>-copy-2`, `<slug>-copy-3`, … — the first the
 * siblings do not carry. A source with no slug yields no slug: the copy is a
 * draft with no address, and inventing one would be a publish decision made
 * by a copy button.
 *
 * A source that is itself a copy (`about-copy`) does not stack suffixes:
 * its base is recovered and numbered instead, so a copy of a copy is
 * `about-copy-2` rather than `about-copy-copy`.
 */
export function uniqueDuplicateSlug(
  sourceSlug: string | null | undefined,
  taken: Iterable<string | null | undefined>,
): string | undefined {
  const slug = String(sourceSlug ?? '').trim()
  if (!slug) return undefined
  const used = new Set<string>()
  for (const value of taken) {
    const key = String(value ?? '').trim().toLowerCase()
    if (key) used.add(key)
  }
  const base = slug.replace(
    new RegExp(`${DUPLICATE_SLUG_SUFFIX}(?:-\\d+)?$`),
    '',
  )
  const first = `${base}${DUPLICATE_SLUG_SUFFIX}`
  if (!used.has(first.toLowerCase())) return first
  for (let counter = 2; ; counter += 1) {
    const candidate = `${first}-${counter}`
    if (!used.has(candidate.toLowerCase())) return candidate
  }
}

/** The note the copy's first version carries: `Duplicated from Home v3`. */
export function duplicateVersionNote(
  sourceName: string | null | undefined,
  sourceVersionNumber: number | null | undefined,
): string {
  const name = String(sourceName ?? '').trim() || 'Untitled'
  const version =
    typeof sourceVersionNumber === 'number' && sourceVersionNumber > 0
      ? ` v${Math.floor(sourceVersionNumber)}`
      : ''
  return `Duplicated from ${name}${version}`
}

/** The AI runtime tool that opens this door for the planner. */
export const DUPLICATE_RESOURCE_TOOL_NAME = 'duplicate_resource'
