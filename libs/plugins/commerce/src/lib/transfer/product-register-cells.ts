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
  normalizeProductCheckIn,
  type ProductCheckIn,
} from '../model/commerce-check-in-product'
import { commerceSlug } from '../model/commerce'
import {
  variantPriceLabel,
  type ProductModifierGroup,
  type ProductModifierOption,
} from '../model/product-modifiers'

/*
 * A PRODUCT'S ADD-ONS AND CHECK-IN AS FILE CELLS (AGL-4060).
 *
 * Both settings are nested on the document and flat in a spreadsheet, so each
 * is one cell written in words a person can read and type:
 *
 *   Add-ons     Milk (at least 1): Whole, Oat +$0.75; Walls (at most 2, register only): Side +$50.00 (10x20 +$75.00)
 *   Check-in    Yes, 4 people, ask which day
 *
 * Add-ons: groups split by semicolons, a group's name then a colon then its
 * choices split by commas. The parentheses after a group hold what the
 * product editor calls At least, At most and Show on the website (off is
 * "register only"); left out they are what a new group starts with. The
 * parentheses after a choice hold what it adds on a variant, by the name the
 * editor gives that variant. A name holding a comma, semicolon, colon or
 * parenthesis goes in double quotes.
 *
 * A record reads as the same text a file does, so the dry run compares two
 * strings, shows them as before → after, and a re-imported export changes
 * nothing. Reading never decides what a store may hold: limits belong to
 * `validateProduct`, which the plan and the apply both ask.
 */

/** What a cell read as, or why it could not be. */
type Read<T> = { value: T } | { message: string }

const fail = (message: string): { message: string } => ({ message })

const QUOTE_THE_NAME =
  'Put double quotes around a name with a comma, semicolon, colon or parenthesis, such as "Walls (vinyl)".'
const NOT_CLOSED = `A quote or parenthesis is not closed. ${QUOTE_THE_NAME}`

/** A price at the end of a choice: `+$0.75`, `+0.75` or `$0.75`. */
const PRICE_TAIL = /(?:^|\s)([-+]\s?\$?|\$)([\d.,]+)$/
const PRICE_DIGITS = /^(?:\d+(?:\.\d{1,2})?|\.\d{1,2})$/

/**
 * Walks a cell's text outside its quoted names, naming each character and how
 * deep in parentheses it sits. A quote opens a name only where a name starts,
 * so the `"` in `12" wall` is just a character. `false` when something is left
 * open.
 */
function walk(source: string, visit: (character: string, at: number, depth: number) => void): boolean {
  let depth = 0
  let quoted = false
  let atStart = true
  for (let at = 0; at < source.length; at += 1) {
    const character = source[at] as string
    if (quoted) {
      if (character === '"') {
        if (source[at + 1] === '"') at += 1
        else quoted = false
      }
      continue
    }
    if (character === '"' && atStart) {
      quoted = true
      atStart = false
      continue
    }
    if (character === ')') {
      depth -= 1
      if (depth < 0) return false
    }
    visit(character, at, depth)
    if (character === '(') depth += 1
    if (!/\s/.test(character)) atStart = /[(,;:]/.test(character)
  }
  return !quoted && depth === 0
}

/** The pieces between one separator, outside quotes and parentheses; `null` when something is left open. */
function splitTop(source: string, separator: string): string[] | null {
  const parts: string[] = []
  let start = 0
  const closed = walk(source, (character, at, depth) => {
    if (character === separator && depth === 0) {
      parts.push(source.slice(start, at))
      start = at + 1
    }
  })
  if (!closed) return null
  parts.push(source.slice(start))
  return parts
}

/** A piece split into what comes before its parentheses and what is in them. */
function takeParens(source: string): Read<{ head: string; inner: string | null }> {
  let open = -1
  let close = -1
  let groups = 0
  const closed = walk(source, (character, at, depth) => {
    if (character === '(' && depth === 0) {
      groups += 1
      open = at
    }
    if (character === ')' && depth === 0) close = at
  })
  if (!closed) return fail(NOT_CLOSED)
  if (open < 0) return { value: { head: source.trim(), inner: null } }
  if (groups > 1 || source.slice(close + 1).trim()) return fail(QUOTE_THE_NAME)
  return { value: { head: source.slice(0, open).trim(), inner: source.slice(open + 1, close) } }
}

/** A quoted name and what follows it; `null` when the quote never closes. */
function readQuoted(text: string): { name: string; rest: string } | null {
  let name = ''
  for (let at = 1; at < text.length; at += 1) {
    const character = text[at] as string
    if (character !== '"') {
      name += character
    } else if (text[at + 1] === '"') {
      name += '"'
      at += 1
    } else {
      return { name, rest: text.slice(at + 1).trim() }
    }
  }
  return null
}

function readCents(sign: string, digits: string): Read<number> {
  const price = `${sign}${digits}`.replace(/\s/g, '')
  if (sign.startsWith('-') || !PRICE_DIGITS.test(digits)) {
    return fail(`"${price}" is not a price. Write what the choice adds like +$0.75.`)
  }
  return { value: Math.round(Number(digits) * 100) }
}

/** A name with the price after it, if it has one. */
function readNameAndPrice(source: string): Read<{ name: string; cents: number | null }> {
  const text = source.trim()
  let name = text
  let priceText = ''
  if (text.startsWith('"')) {
    const quoted = readQuoted(text)
    if (!quoted) return fail(NOT_CLOSED)
    name = quoted.name
    priceText = quoted.rest
    if (priceText && PRICE_TAIL.exec(priceText)?.index !== 0) return fail(QUOTE_THE_NAME)
  } else {
    const tail = PRICE_TAIL.exec(text)
    if (tail) {
      name = text.slice(0, tail.index).trim()
      priceText = tail[0].trim()
    }
  }
  if (!priceText) return { value: { name, cents: null } }
  const price = PRICE_TAIL.exec(priceText) as RegExpExecArray
  const cents = readCents(price[1] as string, price[2] as string)
  return 'message' in cents ? cents : { value: { name, cents: cents.value } }
}

/*==========================================
 * ADD-ONS
 *=========================================*/

/** One choice as a cell names it. */
export interface AddOnCellChoice {
  name: string
  priceCents: number
  /** What it adds on a variant, by that variant's name. */
  byVariant: Array<{ label: string; priceCents: number }>
}

/** One group as a cell names it. */
export interface AddOnCellGroup {
  name: string
  min: number
  max: number
  online: boolean
  choices: AddOnCellChoice[]
}

/** How many a group takes when its cell does not say: as a new group starts, or its minimum if that is higher. */
const defaultMax = (min: number): number => Math.max(1, min)

function readSettings(
  inner: string | null,
): Read<Pick<AddOnCellGroup, 'min' | 'max' | 'online'>> {
  let min = 0
  let max: number | null = null
  let online = true
  for (const raw of (inner ?? '').split(',')) {
    const setting = raw.trim()
    if (!setting) continue
    const least = /^at least (\d+)$/i.exec(setting)
    const most = /^at most (\d+)$/i.exec(setting)
    if (least) min = Number(least[1])
    else if (most) max = Number(most[1])
    else if (/^register only$/i.test(setting)) online = false
    else {
      return fail(`"${setting}" is not a group setting. Use at least 1, at most 2 or register only. ${QUOTE_THE_NAME}`)
    }
  }
  return { value: { min, max: max ?? defaultMax(min), online } }
}

function readByVariant(inner: string | null, choice: string): Read<AddOnCellChoice['byVariant']> {
  if (inner === null) return { value: [] }
  const parts = splitTop(inner, ',')
  if (!parts) return fail(NOT_CLOSED)
  const byVariant: AddOnCellChoice['byVariant'] = []
  for (const part of parts) {
    if (!part.trim()) continue
    const read = readNameAndPrice(part)
    if ('message' in read) return read
    const { name: label, cents } = read.value
    if (!label || cents === null) {
      return fail(`"${part.trim()}" needs a variant and a price, such as 10x20 +$75.00. ${QUOTE_THE_NAME}`)
    }
    if (byVariant.some((entry) => variantLabelKey(entry.label) === variantLabelKey(label))) {
      return fail(`"${choice}" is priced twice for "${label}".`)
    }
    byVariant.push({ label, priceCents: cents })
  }
  return { value: byVariant }
}

function readChoices(source: string, group: string): Read<AddOnCellChoice[]> {
  const parts = splitTop(source, ',')
  if (!parts) return fail(NOT_CLOSED)
  const choices: AddOnCellChoice[] = []
  let previousPriced = false
  for (const part of parts) {
    if (!part.trim()) continue
    const shape = takeParens(part)
    if ('message' in shape) return shape
    const read = readNameAndPrice(shape.value.head)
    if ('message' in read) return read
    const { name, cents } = read.value
    if (!name) return fail(`Name every choice in "${group}".`)
    // `+$1,000.00` would read as a $1 choice and a free one named 000.00.
    if (previousPriced && /^\d{3}(?:\.\d*)?$/.test(name)) {
      return fail('Write a price without a comma, such as +$1000.00.')
    }
    const byVariant = readByVariant(shape.value.inner, name)
    if ('message' in byVariant) return byVariant
    choices.push({ name, priceCents: cents ?? 0, byVariant: byVariant.value })
    previousPriced = cents !== null
  }
  return { value: choices }
}

/** An add-ons cell as its groups, or what is wrong with it for the person to fix. */
export function readAddOnCell(cell: unknown): Read<AddOnCellGroup[]> {
  const groups: AddOnCellGroup[] = []
  const parts = splitTop(String(cell ?? ''), ';')
  if (!parts) return fail(NOT_CLOSED)
  for (const part of parts) {
    if (!part.trim()) continue
    const sides = splitTop(part, ':')
    if (!sides) return fail(NOT_CLOSED)
    if (sides.length === 1) {
      return fail(`"${part.trim()}" needs its choices after a colon, such as Milk: Whole, Oat +$0.75.`)
    }
    if (sides.length > 2) return fail(QUOTE_THE_NAME)
    const head = takeParens(sides[0] as string)
    if ('message' in head) return head
    let name = head.value.head
    if (name.startsWith('"')) {
      const quoted = readQuoted(name)
      if (!quoted) return fail(NOT_CLOSED)
      if (quoted.rest) return fail(QUOTE_THE_NAME)
      name = quoted.name
    }
    if (!name) return fail('Name every add-on group.')
    const settings = readSettings(head.value.inner)
    if ('message' in settings) return settings
    const choices = readChoices(sides[1] as string, name)
    if ('message' in choices) return choices
    groups.push({ name, ...settings.value, choices: choices.value })
  }
  return { value: groups }
}

function writeName(name: string): string {
  const plain =
    name.trim() === name &&
    Boolean(name) &&
    !name.startsWith('"') &&
    !/[,;:()]/.test(name) &&
    !PRICE_TAIL.test(name)
  return plain ? name : `"${name.replace(/"/g, '""')}"`
}

const writeCents = (cents: number): string => `+$${(cents / 100).toFixed(2)}`

function writeChoice(choice: AddOnCellChoice): string {
  const price = choice.priceCents ? ` ${writeCents(choice.priceCents)}` : ''
  const byVariant = choice.byVariant.length
    ? ` (${choice.byVariant.map((entry) => `${writeName(entry.label)} ${writeCents(entry.priceCents)}`).join(', ')})`
    : ''
  return `${writeName(choice.name)}${price}${byVariant}`
}

/** Groups as the one way a cell writes them, so two cells saying the same thing are the same text. */
export function writeAddOnCell(groups: readonly AddOnCellGroup[]): string {
  return groups
    .map((group) => {
      const settings = [
        ...(group.min > 0 ? [`at least ${group.min}`] : []),
        ...(group.max !== defaultMax(group.min) ? [`at most ${group.max}`] : []),
        ...(group.online ? [] : ['register only']),
      ]
      const head = settings.length ? `${writeName(group.name)} (${settings.join(', ')})` : writeName(group.name)
      return `${head}: ${group.choices.map(writeChoice).join(', ')}`
    })
    .join('; ')
}

type LabelledVariant = { id: string; options?: Record<string, string> }

/** A stored product's add-ons as a cell; `null` when it has none. */
export function addOnCellOf(stored: unknown, variants: readonly LabelledVariant[]): string | null {
  if (!Array.isArray(stored) || !stored.length) return null
  const groups = (stored as Array<Partial<ProductModifierGroup> | null>).map((group): AddOnCellGroup => ({
    name: String(group?.name ?? ''),
    min: Number(group?.min) || 0,
    max: Number(group?.max) || 0,
    online: group?.online === true,
    choices: (Array.isArray(group?.options) ? group.options : []).map((option): AddOnCellChoice => {
      const byVariant: AddOnCellChoice['byVariant'] = []
      for (const variant of variants) {
        const priceCents = option?.priceCentsByVariant?.[variant.id]
        if (typeof priceCents !== 'number') continue
        const label = variantPriceLabel(variant)
        if (!byVariant.some((entry) => entry.label === label && entry.priceCents === priceCents)) {
          byVariant.push({ label, priceCents })
        }
      }
      return { name: String(option?.name ?? ''), priceCents: Number(option?.priceCents) || 0, byVariant }
    }),
  }))
  return writeAddOnCell(groups)
}

/** A variant's name in a cell, in any case and whichever order its option values come in. */
export function variantLabelKey(label: string): string {
  return label
    .split('/')
    .map((part) => part.trim().toLowerCase())
    .sort()
    .join('|')
}

/** The ids of a product's variants by the name a cell gives them. */
export function addOnVariantIds(variants: readonly LabelledVariant[]): Record<string, string[]> {
  const out: Record<string, string[]> = {}
  for (const variant of variants) {
    const key = variantLabelKey(variantPriceLabel(variant))
    out[key] = [...(out[key] ?? []), variant.id]
  }
  return out
}

/** An id nothing else holds, the same one for the same name so a retried write finds what it wrote. */
function freeId(prefix: string, name: string, taken: Set<string>): string {
  const base = `${prefix}-${commerceSlug(name) || 'choice'}`
  let id = base
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`
  taken.add(id)
  return id
}

/** Takes the first stored entry holding a name, so two entries with one name each find their own. */
function takeByName<T extends { name?: string }>(pool: T[], name: string): T | undefined {
  const key = name.trim().toLowerCase()
  const at = pool.findIndex((entry) => String(entry.name ?? '').trim().toLowerCase() === key)
  return at < 0 ? undefined : pool.splice(at, 1)[0]
}

/**
 * The groups an add-ons cell stores. A group or choice the product already
 * has keeps its id, so a cart holding that choice still finds it; one it does
 * not have gets a new id. `problem` names a variant no price can land on.
 * `groups` is `null` for a cell that cannot be read at all.
 */
export function modifierGroupsFromAddOnCell(
  cell: unknown,
  existing: readonly ProductModifierGroup[] | undefined,
  variantIds: Readonly<Record<string, string[]>>,
): { groups: ProductModifierGroup[] | null; problem: string | null } {
  const read = readAddOnCell(cell)
  if ('message' in read) return { groups: null, problem: read.message }
  let problem: string | null = null
  const stored = Array.isArray(existing) ? existing : []
  const pool = [...stored]
  const groupIds = new Set(stored.map((group) => group.id))
  const groups = read.value.map((group): ProductModifierGroup => {
    const held = takeByName(pool, group.name)
    const heldOptions = Array.isArray(held?.options) ? [...held.options] : []
    const optionIds = new Set(heldOptions.map((option) => option.id))
    const options = group.choices.map((choice): ProductModifierOption => {
      const heldOption = takeByName(heldOptions, choice.name)
      const prices: Record<string, number> = {}
      for (const entry of choice.byVariant) {
        const ids = variantIds[variantLabelKey(entry.label)]
        if (!ids?.length) {
          problem ??= `"${choice.name}" is priced for "${entry.label}", and this product has no variant by that name.`
          continue
        }
        for (const id of ids) prices[id] = entry.priceCents
      }
      const option: ProductModifierOption = {
        ...heldOption,
        id: heldOption?.id ?? freeId('o', choice.name, optionIds),
        name: choice.name,
        priceCents: choice.priceCents,
      }
      if (Object.keys(prices).length) option.priceCentsByVariant = prices
      else delete option.priceCentsByVariant
      return option
    })
    return {
      ...(held ?? {}),
      id: held?.id ?? freeId('g', group.name, groupIds),
      name: group.name,
      min: group.min,
      max: group.max,
      online: group.online,
      options,
    }
  })
  return { groups, problem }
}

/*==========================================
 * CHECK-IN
 *=========================================*/

const CHECK_IN_WORDS: Readonly<Record<string, boolean>> = {
  yes: true,
  y: true,
  true: true,
  on: true,
  no: false,
  n: false,
  false: false,
  off: false,
}

const CHECK_IN_HELP = 'Write No, Yes, or Yes, 4 people, ask which day.'

/** A check-in cell as the setting it names, or what is wrong with it. How many people is the model's to refuse. */
export function readCheckInCell(cell: unknown): Read<ProductCheckIn> {
  const [first = '', ...rest] = String(cell ?? '')
    .split(',')
    .map((part) => part.trim())
  const enabled = CHECK_IN_WORDS[first.toLowerCase()]
  if (enabled === undefined) return fail(`"${first}" is not a check-in setting. ${CHECK_IN_HELP}`)
  if (!enabled) return rest.some(Boolean) ? fail(`A product with no check-in has nothing else to set. ${CHECK_IN_HELP}`) : { value: { enabled: false } }
  const setting: ProductCheckIn = { enabled: true, headcount: 1 }
  for (const part of rest) {
    if (!part) continue
    const people = /^(\d+) (?:people|person)$/i.exec(part)
    if (people) setting.headcount = Number(people[1])
    else if (/^ask which day$/i.test(part)) setting.askUseDate = true
    else return fail(`"${part}" is not a check-in setting. ${CHECK_IN_HELP}`)
  }
  return { value: setting }
}

/** A setting as the one way a cell writes it. */
export function writeCheckInCell(setting: ProductCheckIn): string {
  if (!setting.enabled) return 'No'
  const headcount = setting.headcount ?? 1
  return [
    'Yes',
    ...(headcount === 1 ? [] : [`${headcount} people`]),
    ...(setting.askUseDate === true ? ['ask which day'] : []),
  ].join(', ')
}

/** A stored check-in setting as a cell; `null` when it has none. */
export function checkInCellOf(stored: unknown): string | null {
  const setting = normalizeProductCheckIn(stored)
  return setting ? writeCheckInCell(setting) : null
}

/** The setting a cell stores; `undefined` for a blank cell. */
export function checkInFromCell(cell: unknown): ProductCheckIn | undefined {
  const read = readCheckInCell(cell)
  return 'message' in read ? undefined : read.value
}
