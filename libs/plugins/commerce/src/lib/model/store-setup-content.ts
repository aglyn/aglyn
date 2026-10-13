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

import { invalidOpeningHoursLines } from '@aglyn/aglyn/app-utils/local-business'
import { COMMERCE_MAX_PRICE_USD } from './commerce'
import {
  summarizeShippingCoverage,
  type ShippingRate,
  type ShippingSettings,
  type ShippingTier,
  type ShippingZone,
} from './commerce-shipping'
import type { TaxRate, TaxSettings } from './commerce-tax'
import { storefrontTaxMisconfiguration } from './commerce-tax-decision'
import {
  LOCAL_DELIVERY_POSTCODES_MAX,
  LOCAL_DELIVERY_ZONES_MAX,
  PICKUP_HOURS_MAX,
  PICKUP_INSTRUCTIONS_MAX,
  localDeliveryProblems,
  normalizeLocalDeliverySettings,
  normalizePickupSettings,
  type LocalDeliverySettings,
  type LocalDeliveryZone,
} from './local-fulfillment-settings'
import type { PickupLocationSettings } from './order-local-fulfillment'

/*==========================================
 * STORE SETUP AN AI BUILD CHANGES (AGL-3749)
 *
 * One change to the store's shipping, pickup, local delivery or tax settings,
 * as the `store-settings` writer receives it, and the pure step that turns
 * the settings a site has into the settings it has after the change.
 *
 * Every field is one the console's cards already save, in the shape they
 * save it:
 *
 *  - `shipping`: a zone (`settings/store.shipping.zones`) and one rate in it
 *    (`.rates`), priced flat, free over a subtotal, or by subtotal or weight
 *    tiers — the Shipping card's four kinds. Carrier rates are not offered:
 *    they quote through a carrier account a person connects.
 *  - `pickup`: the store-wide "Offer free local pickup" switch
 *    (`shipping.localPickup`), or pickup at one of the store's inventory
 *    locations (`locations/{id}.pickup`), as the Inventory locations card
 *    saves it. A location is found, never created.
 *  - `local-delivery`: the Local delivery card's settings
 *    (`settings/store.localDelivery`) with postal-code zones. Distance zones
 *    need the store placed on a map first, which is the card's to do.
 *  - `tax`: how the store handles sales tax (`settings/store.tax.mode`),
 *    whether prices include it, the store origin and manual rates. The
 *    lodging and service rates are kept as they are.
 *
 * Nothing here names a price or a rate the change did not carry: a blank
 * flat rate charges nothing at checkout, so a flat or free-over rate needs
 * its amount, and a tax rate needs its percentage. Pure.
 *=========================================*/

/** The resource the writer is registered under; the commerce record route `store-settings` links it. */
export const STORE_SETUP_RESOURCE = 'store-settings'

export const STORE_SETUP_SECTIONS = ['shipping', 'pickup', 'local-delivery', 'tax'] as const
export type StoreSetupSection = (typeof STORE_SETUP_SECTIONS)[number]

/** The rate kinds an AI change may set: every kind of the Shipping card except carrier rates. */
export const STORE_SHIPPING_AI_KINDS = ['flat', 'free_over', 'price_tiers', 'weight_tiers'] as const
export type StoreShippingAiKind = (typeof STORE_SHIPPING_AI_KINDS)[number]

export const STORE_SHIPPING_ACTIONS = ['set', 'remove'] as const
export const STORE_TAX_MODES = ['manual', 'stripe', 'none'] as const

export const STORE_SETUP_NAME_MAX = 80
export const STORE_SETUP_COUNTRIES_MAX = 60
export const STORE_SHIPPING_TIERS_MAX = 10
export const STORE_SETUP_LOCATION_MAX = 80
export const STORE_TAX_LABEL_MAX = 60
/** Grams; the heaviest tier a weight table may name (1,000 kg). */
export const STORE_SHIPPING_MAX_GRAMS = 1_000_000
/** Two weeks, the longest preparation or lead time the cards keep. */
export const STORE_SETUP_MAX_MINUTES = 14 * 24 * 60

export interface StoreShippingChange {
  section: 'shipping'
  action: 'set' | 'remove'
  zoneName: string
  countries?: string[]
  rateName?: string
  kind?: StoreShippingAiKind
  amountCents?: number
  freeOverCents?: number
  tiers?: ShippingTier[]
}

export interface StorePickupChange {
  section: 'pickup'
  /** An inventory location's name, city or address; absent = the store-wide switch. */
  location?: string
  enabled: boolean
  hours?: string
  instructions?: string
  readyWithinMinutes?: number
}

export interface StoreLocalDeliveryChange {
  section: 'local-delivery'
  enabled: boolean
  country?: string
  location?: string
  zoneName?: string
  postcodes?: string[]
  feeCents?: number
  minimumCents?: number
  freeOverCents?: number
  removeZone?: boolean
  windows?: string
  leadTimeMinutes?: number
  daysAhead?: number
  instructions?: string
}

export interface StoreTaxChange {
  section: 'tax'
  mode?: 'manual' | 'stripe' | 'none'
  pricesIncludeTax?: boolean
  originCountry?: string
  originState?: string
  rateCountry?: string
  rateState?: string
  ratePct?: number
  rateLabel?: string
  removeRate?: boolean
}

export type StoreSetupChange = StoreShippingChange | StorePickupChange | StoreLocalDeliveryChange | StoreTaxChange

export type StoreSetupRead = { ok: true; value: StoreSetupChange } | { ok: false; problems: string[] }

const COUNTRY = /^[A-Z]{2}$/
const STATE = /^[A-Z0-9]{1,3}$/

type Raw = Readonly<Record<string, unknown>>

const has = (raw: Raw, key: string) => raw[key] !== undefined && raw[key] !== null && raw[key] !== ''

function text(raw: Raw, key: string, max: number, problems: string[]): string | undefined {
  if (!has(raw, key)) return undefined
  const value = raw[key]
  if (typeof value !== 'string') {
    problems.push(`"${key}" must be text`)
    return undefined
  }
  const trimmed = value.trim()
  if (trimmed.length > max) problems.push(`"${key}" must be at most ${max} characters`)
  return trimmed || undefined
}

function bool(raw: Raw, key: string, problems: string[]): boolean | undefined {
  if (!has(raw, key)) return undefined
  if (typeof raw[key] !== 'boolean') {
    problems.push(`"${key}" must be true or false`)
    return undefined
  }
  return raw[key] as boolean
}

function number(raw: Raw, key: string, min: number, max: number, problems: string[]): number | undefined {
  if (!has(raw, key)) return undefined
  const value = raw[key]
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    problems.push(`"${key}" must be a number`)
    return undefined
  }
  if (value < min || value > max) {
    problems.push(`"${key}" must be between ${min} and ${max}`)
    return undefined
  }
  return value
}

function minutes(raw: Raw, key: string, problems: string[]): number | undefined {
  const value = number(raw, key, 0, STORE_SETUP_MAX_MINUTES, problems)
  return value === undefined ? undefined : Math.round(value)
}

/** Dollars to the cents the settings store. */
function cents(raw: Raw, key: string, problems: string[]): number | undefined {
  const value = number(raw, key, 0, COMMERCE_MAX_PRICE_USD, problems)
  return value === undefined ? undefined : Math.round(value * 100)
}

function list(raw: Raw, key: string, max: number, problems: string[]): string[] | undefined {
  if (!has(raw, key)) return undefined
  const value = raw[key]
  if (!Array.isArray(value) || value.some((one) => typeof one !== 'string')) {
    problems.push(`"${key}" must be a list of text`)
    return undefined
  }
  const items = (value as string[]).map((one) => one.trim()).filter(Boolean)
  if (items.length > max) problems.push(`"${key}" must hold at most ${max}`)
  return items
}

function countryCode(raw: Raw, key: string, problems: string[]): string | undefined {
  const value = text(raw, key, 2, problems)?.toUpperCase()
  if (value !== undefined && !COUNTRY.test(value)) problems.push(`"${key}" must be a two-letter country code like US`)
  return value
}

function stateCode(raw: Raw, key: string, problems: string[]): string | undefined {
  const value = text(raw, key, 3, problems)?.toUpperCase()
  if (value !== undefined && !STATE.test(value)) problems.push(`"${key}" must be a state or region code like TX`)
  return value
}

/** Opening-hours lines; a `;` separates lines as a newline does. */
function hoursText(raw: Raw, key: string, problems: string[]): string | undefined {
  const value = text(raw, key, PICKUP_HOURS_MAX, problems)
  if (value === undefined) return undefined
  const lines = value
    .split(/\s*(?:;|\r?\n)\s*/)
    .filter(Boolean)
    .join('\n')
  const bad = invalidOpeningHoursLines(lines)
  if (bad.length) {
    problems.push(`"${key}" must be lines like "Mo-Fr 09:00-17:00" or "Sa 10:00-14:00"`)
  }
  return lines
}

/** "50:5" → up to 50 (dollars, or grams for weight) costs $5. */
function tiersOf(raw: Raw, kind: StoreShippingAiKind | undefined, problems: string[]): ShippingTier[] | undefined {
  const entries = list(raw, 'tiers', STORE_SHIPPING_TIERS_MAX, problems)
  if (entries === undefined) return undefined
  const weight = kind === 'weight_tiers'
  const tiers: ShippingTier[] = []
  for (const entry of entries) {
    const match = /^\s*\$?([0-9]+(?:\.[0-9]+)?)\s*(?:g)?\s*:\s*\$?([0-9]+(?:\.[0-9]+)?)\s*$/.exec(entry)
    const upTo = match ? Number(match[1]) : NaN
    const amount = match ? Number(match[2]) : NaN
    if (!match || !(upTo > 0) || amount > COMMERCE_MAX_PRICE_USD || (weight && upTo > STORE_SHIPPING_MAX_GRAMS)) {
      problems.push(`"tiers" holds "${entry}", which is not "up to:price" like "50:5"`)
      return undefined
    }
    tiers.push({ upTo: weight ? Math.round(upTo) : Math.round(upTo * 100), amountCents: Math.round(amount * 100) })
  }
  tiers.sort((a, b) => a.upTo - b.upTo)
  if (tiers.some((tier, index) => index > 0 && tier.upTo === tiers[index - 1].upTo)) {
    problems.push('"tiers" names the same limit twice')
  }
  return tiers
}

const KNOWN: Record<StoreSetupSection, readonly string[]> = {
  shipping: ['action', 'zoneName', 'countries', 'rateName', 'kind', 'amountUsd', 'freeOverUsd', 'tiers'],
  pickup: ['location', 'enabled', 'hours', 'instructions', 'readyWithinMinutes'],
  'local-delivery': [
    'enabled',
    'country',
    'location',
    'zoneName',
    'postcodes',
    'feeUsd',
    'minimumUsd',
    'freeOverUsd',
    'removeZone',
    'windows',
    'leadTimeMinutes',
    'daysAhead',
    'instructions',
  ],
  tax: [
    'mode',
    'pricesIncludeTax',
    'originCountry',
    'originState',
    'rateCountry',
    'rateState',
    'ratePercent',
    'rateLabel',
    'removeRate',
  ],
}

function readShipping(raw: Raw, problems: string[]): StoreShippingChange {
  const action = has(raw, 'action') ? raw['action'] : 'set'
  if (!STORE_SHIPPING_ACTIONS.includes(action as never)) problems.push('"action" must be set or remove')
  const zoneName = text(raw, 'zoneName', STORE_SETUP_NAME_MAX, problems)
  if (!zoneName) problems.push('"zoneName" is required: the shipping zone, like "United States"')
  const countries = list(raw, 'countries', STORE_SETUP_COUNTRIES_MAX, problems)?.map((code) => code.toUpperCase())
  for (const code of countries ?? []) {
    if (code !== '*' && !COUNTRY.test(code)) {
      problems.push(`"countries" holds "${code}", which is not a two-letter country code or *`)
      break
    }
  }
  const rateName = text(raw, 'rateName', STORE_SETUP_NAME_MAX, problems)
  const kind = has(raw, 'kind') ? (raw['kind'] as StoreShippingAiKind) : undefined
  if (kind !== undefined && !STORE_SHIPPING_AI_KINDS.includes(kind)) {
    problems.push(`"kind" must be one of ${STORE_SHIPPING_AI_KINDS.join(', ')}`)
  }
  const amountCents = cents(raw, 'amountUsd', problems)
  const freeOverCents = cents(raw, 'freeOverUsd', problems)
  const tiers = tiersOf(raw, kind, problems)
  if (action === 'set') {
    // A rate with no name is dropped at checkout (AGL-1791), and a blank
    // amount charges nothing: both are the person's to state.
    if (!rateName) problems.push('"rateName" is required: what the shopper sees, like "Standard"')
    if (!kind) problems.push('"kind" is required')
    if ((kind === 'flat' || kind === 'free_over') && amountCents === undefined) {
      problems.push(`"amountUsd" is required for a ${kind === 'flat' ? 'flat' : 'free-over'} rate`)
    }
    if (kind === 'free_over' && !freeOverCents) problems.push('"freeOverUsd" is required for a free-over rate')
    if ((kind === 'price_tiers' || kind === 'weight_tiers') && !tiers?.length) {
      problems.push('"tiers" is required for a tiered rate')
    }
  }
  return {
    section: 'shipping',
    action: action as StoreShippingChange['action'],
    zoneName: zoneName ?? '',
    ...(countries ? { countries } : {}),
    ...(rateName ? { rateName } : {}),
    ...(kind ? { kind } : {}),
    ...(amountCents !== undefined ? { amountCents } : {}),
    ...(freeOverCents !== undefined ? { freeOverCents } : {}),
    ...(tiers ? { tiers } : {}),
  }
}

function readPickup(raw: Raw, problems: string[]): StorePickupChange {
  const location = text(raw, 'location', STORE_SETUP_LOCATION_MAX, problems)
  const hours = hoursText(raw, 'hours', problems)
  const instructions = text(raw, 'instructions', PICKUP_INSTRUCTIONS_MAX, problems)
  const readyWithinMinutes = minutes(raw, 'readyWithinMinutes', problems)
  if (!location && (hours !== undefined || instructions !== undefined || readyWithinMinutes !== undefined)) {
    problems.push('Pickup hours, instructions and preparation time belong to a location: name the inventory location')
  }
  return {
    section: 'pickup',
    enabled: bool(raw, 'enabled', problems) ?? true,
    ...(location ? { location } : {}),
    ...(hours !== undefined ? { hours } : {}),
    ...(instructions !== undefined ? { instructions } : {}),
    ...(readyWithinMinutes !== undefined ? { readyWithinMinutes } : {}),
  }
}

function readLocalDelivery(raw: Raw, problems: string[]): StoreLocalDeliveryChange {
  const zoneName = text(raw, 'zoneName', STORE_SETUP_NAME_MAX, problems)
  const postcodes = list(raw, 'postcodes', LOCAL_DELIVERY_POSTCODES_MAX, problems)
  const feeCents = cents(raw, 'feeUsd', problems)
  const minimumCents = cents(raw, 'minimumUsd', problems)
  const freeOverCents = cents(raw, 'freeOverUsd', problems)
  const removeZone = bool(raw, 'removeZone', problems)
  if (!zoneName && (postcodes || feeCents !== undefined || minimumCents !== undefined || freeOverCents !== undefined || removeZone)) {
    problems.push('"zoneName" is required to add, change or remove a delivery zone')
  }
  const daysAhead = number(raw, 'daysAhead', 1, 30, problems)
  return {
    section: 'local-delivery',
    enabled: bool(raw, 'enabled', problems) ?? true,
    ...(has(raw, 'country') ? { country: countryCode(raw, 'country', problems) } : {}),
    ...(has(raw, 'location') ? { location: text(raw, 'location', STORE_SETUP_LOCATION_MAX, problems) } : {}),
    ...(zoneName ? { zoneName } : {}),
    ...(postcodes ? { postcodes } : {}),
    ...(feeCents !== undefined ? { feeCents } : {}),
    ...(minimumCents !== undefined ? { minimumCents } : {}),
    ...(freeOverCents !== undefined ? { freeOverCents } : {}),
    ...(removeZone ? { removeZone } : {}),
    ...(has(raw, 'windows') ? { windows: hoursText(raw, 'windows', problems) } : {}),
    ...(has(raw, 'leadTimeMinutes') ? { leadTimeMinutes: minutes(raw, 'leadTimeMinutes', problems) } : {}),
    ...(daysAhead !== undefined ? { daysAhead: Math.round(daysAhead) } : {}),
    ...(has(raw, 'instructions') ? { instructions: text(raw, 'instructions', PICKUP_INSTRUCTIONS_MAX, problems) } : {}),
  }
}

function readTax(raw: Raw, problems: string[]): StoreTaxChange {
  const mode = has(raw, 'mode') ? raw['mode'] : undefined
  if (mode !== undefined && !STORE_TAX_MODES.includes(mode as never)) {
    problems.push(`"mode" must be one of ${STORE_TAX_MODES.join(', ')}`)
  }
  const change: StoreTaxChange = {
    section: 'tax',
    ...(mode !== undefined ? { mode: mode as StoreTaxChange['mode'] } : {}),
  }
  const pricesIncludeTax = bool(raw, 'pricesIncludeTax', problems)
  if (pricesIncludeTax !== undefined) change.pricesIncludeTax = pricesIncludeTax
  const originCountry = countryCode(raw, 'originCountry', problems)
  if (originCountry) change.originCountry = originCountry
  const originState = stateCode(raw, 'originState', problems)
  if (originState) change.originState = originState
  const rateCountry = countryCode(raw, 'rateCountry', problems)
  if (rateCountry) change.rateCountry = rateCountry
  const rateState = stateCode(raw, 'rateState', problems)
  if (rateState) change.rateState = rateState
  if (has(raw, 'ratePercent')) {
    const value = raw['ratePercent']
    if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0 || value > 100) {
      problems.push('"ratePercent" must be a percentage above 0 and at most 100')
    } else change.ratePct = value
  }
  const rateLabel = text(raw, 'rateLabel', STORE_TAX_LABEL_MAX, problems)
  if (rateLabel) change.rateLabel = rateLabel
  const removeRate = bool(raw, 'removeRate', problems)
  if (removeRate) change.removeRate = true

  const touchesRate = change.ratePct !== undefined || change.removeRate || change.rateState || change.rateLabel
  if (touchesRate && !change.rateCountry) problems.push('"rateCountry" is required with a tax rate')
  if (change.rateCountry && change.ratePct === undefined && !change.removeRate) {
    // Never a rate the person did not state.
    problems.push('"ratePercent" is required with a tax rate: the percentage the request states')
  }
  if (change.ratePct !== undefined && change.removeRate) problems.push('Give "ratePercent" or "removeRate", not both')
  if (originState && !originCountry) problems.push('"originCountry" is required with "originState"')
  const said = Object.keys(change).filter((key) => key !== 'section')
  if (!said.length) {
    problems.push(
      'Say how the store handles sales tax: manual rates (with the percentage), automatic calculation, or not collecting it',
    )
  }
  return change
}

/** Reads a change from content; the problems name what is wrong, in words a person reads. */
export function readStoreSetupChange(content: Raw): StoreSetupRead {
  const section = content['section'] as StoreSetupSection
  if (!STORE_SETUP_SECTIONS.includes(section)) {
    return { ok: false, problems: [`"section" must be one of ${STORE_SETUP_SECTIONS.join(', ')}`] }
  }
  const problems: string[] = []
  for (const key of Object.keys(content)) {
    if (key !== 'section' && !KNOWN[section].includes(key)) problems.push(`"${key}" is not a ${section} setting`)
  }
  const value =
    section === 'shipping'
      ? readShipping(content, problems)
      : section === 'pickup'
        ? readPickup(content, problems)
        : section === 'local-delivery'
          ? readLocalDelivery(content, problems)
          : readTax(content, problems)
  return problems.length ? { ok: false, problems } : { ok: true, value }
}

// ---------------------------------------------------------------------------
// Applying a change
// ---------------------------------------------------------------------------

/** An inventory location as the writer reads it. */
export interface StoreSetupLocation {
  id: string
  name?: string
  address?: string
  city?: string
  pickup?: unknown
}

/** What the change writes: one map of the settings document, or one location's pickup. */
export type StoreSetupWrite =
  | { target: 'settings'; field: 'shipping' | 'localDelivery' | 'tax'; value: Record<string, unknown> }
  | { target: 'location'; locationId: string; value: PickupLocationSettings }

export type StoreSetupApplied =
  | {
      ok: true
      /** `null` when the settings already say what the change asks: nothing to write. */
      write: StoreSetupWrite | null
      /** One sentence on what the store now does. */
      summary: string
      /** What the person should know, in the console's words. */
      warnings: string[]
    }
  | { ok: false; status: 400 | 404 | 409; error: string }

export interface StoreSetupState {
  /** `hosts/{hostId}/settings/store`, or `{}`. */
  settings: Readonly<Record<string, unknown>>
  locations: readonly StoreSetupLocation[]
}

/** Ids for what a change creates, derived from the request so a retry makes the same ones. */
export interface StoreSetupIds {
  zoneId: string
  rateId: string
}

const fail = (status: 400 | 404 | 409, error: string): StoreSetupApplied => ({ ok: false, status, error })

/** Key-order-blind equality over plain JSON values. */
export function sameSetting(a: unknown, b: unknown): boolean {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b)) {
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((one, index) => sameSetting(one, b[index]))
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const left = Object.entries(a as Record<string, unknown>).filter(([, value]) => value !== undefined)
    const right = Object.entries(b as Record<string, unknown>).filter(([, value]) => value !== undefined)
    return left.length === right.length && left.every(([key, value]) => sameSetting(value, (b as Record<string, unknown>)[key]))
  }
  return false
}

const lower = (value: unknown) => String(value ?? '').trim().toLowerCase()
const usd = (centsValue: number) => `$${(centsValue / 100).toFixed(centsValue % 100 ? 2 : 0)}`
const sameSet = (a: readonly string[], b: readonly string[]) =>
  a.length === b.length && [...a].sort().join(',') === [...b].sort().join(',')

/** The store's locations a phrase names: by exact name first, then by city or address. */
export function matchStoreLocations(
  locations: readonly StoreSetupLocation[],
  phrase: string,
): StoreSetupLocation[] {
  const wanted = lower(phrase)
  const byName = locations.filter((one) => lower(one.name) === wanted)
  if (byName.length) return byName
  return locations.filter(
    (one) => lower(one.city) === wanted || (wanted.length >= 3 && lower(one.address).includes(wanted)) || lower(one.name).includes(wanted),
  )
}

function findLocation(
  locations: readonly StoreSetupLocation[],
  phrase: string,
): StoreSetupLocation | StoreSetupApplied {
  const found = matchStoreLocations(locations, phrase)
  if (!found.length) {
    return fail(
      404,
      `The store has no inventory location matching "${phrase}". Add it under Products → Inventory locations, then ask again.`,
    )
  }
  if (found.length > 1) {
    return fail(409, `More than one location matches "${phrase}" (${found.map((one) => one.name || one.id).join(', ')}); say which`)
  }
  return found[0]
}

function rateSummary(rate: ShippingRate): string {
  switch (rate.kind) {
    case 'flat':
      return rate.amountCents ? `${usd(rate.amountCents)} flat` : 'free'
    case 'free_over':
      return `free over ${usd(rate.freeOverCents ?? 0)}, otherwise ${usd(rate.amountCents ?? 0)}`
    case 'price_tiers':
      return `${(rate.tiers ?? []).length} subtotal tiers`
    case 'weight_tiers':
      return `${(rate.tiers ?? []).length} weight tiers`
    default:
      return rate.kind
  }
}

function applyShipping(state: StoreSetupState, change: StoreShippingChange, ids: StoreSetupIds): StoreSetupApplied {
  const current = (state.settings['shipping'] ?? {}) as ShippingSettings
  const zones: ShippingZone[] = [...(current.zones ?? [])]
  const rates: ShippingRate[] = [...(current.rates ?? [])]
  const zoneIndex = (() => {
    const byName = zones.findIndex((zone) => lower(zone.name) === lower(change.zoneName))
    if (byName >= 0 || !change.countries?.length) return byName
    return zones.findIndex((zone) => sameSet((zone.countries ?? []).map((code) => String(code).trim().toUpperCase()), change.countries ?? []))
  })()
  const zone = zoneIndex >= 0 ? zones[zoneIndex] : undefined

  if (change.action === 'remove') {
    if (!zone) return { ok: true, write: null, summary: `There is no "${change.zoneName}" shipping zone.`, warnings: [] }
    if (change.rateName) {
      const kept = rates.filter((rate) => !(rate.zoneId === zone.id && lower(rate.name) === lower(change.rateName)))
      if (kept.length === rates.length) {
        return { ok: true, write: null, summary: `"${zone.name}" has no "${change.rateName}" rate.`, warnings: [] }
      }
      return shippingResult(current, { ...current, zones, rates: kept }, `Removed the "${change.rateName}" rate from ${zone.name}.`)
    }
    // The card's ✕ on a zone: the zone and its rates go together.
    return shippingResult(
      current,
      { ...current, zones: zones.filter((one) => one.id !== zone.id), rates: rates.filter((rate) => rate.zoneId !== zone.id) },
      `Removed the ${zone.name} shipping zone and its rates.`,
    )
  }

  let zoneId: string
  if (zone) {
    zoneId = zone.id
    if (change.countries?.length && !sameSet(zone.countries ?? [], change.countries)) {
      zones[zoneIndex] = { ...zone, countries: [...change.countries] }
    }
  } else {
    if (!change.countries?.length) {
      return fail(400, `Say which countries the new "${change.zoneName}" zone ships to (two-letter codes, or * for everywhere else)`)
    }
    zoneId = ids.zoneId
    zones.push({ id: zoneId, name: change.zoneName, countries: [...change.countries] })
  }
  const rateIndex = rates.findIndex((rate) => rate.zoneId === zoneId && lower(rate.name) === lower(change.rateName))
  const existing = rateIndex >= 0 ? rates[rateIndex] : undefined
  if (existing?.kind === 'carrier') {
    return fail(409, `"${existing.name}" is a carrier rate; change it in Shipping settings`)
  }
  const kind = change.kind as StoreShippingAiKind
  const rate: ShippingRate = {
    id: existing?.id ?? ids.rateId,
    zoneId,
    name: change.rateName as string,
    kind,
    ...(kind === 'flat' || kind === 'free_over' ? { amountCents: change.amountCents } : {}),
    ...(kind === 'free_over' ? { freeOverCents: change.freeOverCents } : {}),
    ...(kind === 'price_tiers' || kind === 'weight_tiers' ? { tiers: change.tiers } : {}),
  }
  if (rateIndex >= 0) rates[rateIndex] = rate
  else rates.push(rate)
  const zoneName = zone?.name ?? change.zoneName
  return shippingResult(current, { ...current, zones, rates }, `${zoneName}: "${rate.name}" is ${rateSummary(rate)}.`, rate)
}

function shippingResult(
  before: ShippingSettings,
  after: ShippingSettings,
  summary: string,
  changed?: ShippingRate,
): StoreSetupApplied {
  const coverage = summarizeShippingCoverage(after)
  const warnings: string[] = []
  if (coverage.unserved.length && !coverage.shipsNowhere) {
    warnings.push(`Checkout turns away buyers in ${coverage.unserved.join(', ')}: no rate reaches them.`)
  }
  if (changed?.kind === 'price_tiers' || changed?.kind === 'weight_tiers') {
    warnings.push(`"${changed.name}" applies only up to its last tier; a larger or heavier order gets no rate from it.`)
  }
  return {
    ok: true,
    write: sameSetting(before, after) ? null : { target: 'settings', field: 'shipping', value: after as Record<string, unknown> },
    summary,
    warnings,
  }
}

function applyPickup(state: StoreSetupState, change: StorePickupChange): StoreSetupApplied {
  if (!change.location) {
    const current = (state.settings['shipping'] ?? {}) as ShippingSettings
    const after: ShippingSettings = { ...current, localPickup: change.enabled }
    return {
      ok: true,
      write: Boolean(current.localPickup) === change.enabled ? null : { target: 'settings', field: 'shipping', value: after as Record<string, unknown> },
      summary: change.enabled ? 'Checkout offers free local pickup.' : 'Checkout no longer offers free local pickup.',
      warnings: change.enabled ? ['Pickup is a collection choice; it does not widen where the store ships.'] : [],
    }
  }
  const found = findLocation(state.locations, change.location)
  if ('ok' in found) return found
  const before = normalizePickupSettings(found.pickup)
  const after = normalizePickupSettings({
    ...before,
    enabled: change.enabled,
    ...(change.hours !== undefined ? { hours: change.hours } : {}),
    ...(change.instructions !== undefined ? { instructions: change.instructions } : {}),
    ...(change.readyWithinMinutes !== undefined ? { readyWithinMinutes: change.readyWithinMinutes } : {}),
  })
  const name = found.name || 'the location'
  return {
    ok: true,
    write: sameSetting(before, after) ? null : { target: 'location', locationId: found.id, value: after },
    summary: after.enabled ? `Buyers can pick up orders at ${name}.` : `Pickup at ${name} is off.`,
    warnings: after.enabled && !after.hours ? [`${name} has no pickup hours yet; buyers are not told when to come.`] : [],
  }
}

function applyLocalDelivery(state: StoreSetupState, change: StoreLocalDeliveryChange, ids: StoreSetupIds): StoreSetupApplied {
  const before = normalizeLocalDeliverySettings(state.settings['localDelivery'])
  const after: LocalDeliverySettings = { ...before, zones: [...(before.zones ?? [])] }
  if (!after.zones?.length) delete after.zones
  if (change.enabled) after.enabled = true
  else delete after.enabled
  if (change.country) after.country = change.country
  if (change.location) {
    const found = findLocation(state.locations, change.location)
    if ('ok' in found) return found
    after.locationId = found.id
  }
  if (change.windows !== undefined) after.windows = change.windows
  if (change.leadTimeMinutes !== undefined) after.leadTimeMinutes = change.leadTimeMinutes
  if (change.daysAhead !== undefined) after.daysAhead = change.daysAhead
  if (change.instructions !== undefined) after.instructions = change.instructions
  if (change.zoneName) {
    const zones: LocalDeliveryZone[] = [...(after.zones ?? [])]
    const index = zones.findIndex((zone) => lower(zone.name) === lower(change.zoneName))
    if (change.removeZone) {
      if (index >= 0) zones.splice(index, 1)
    } else if (index >= 0) {
      const zone = zones[index]
      if (change.postcodes && zone.kind === 'radius') {
        return fail(409, `"${zone.name}" is a distance zone; change it under Local delivery`)
      }
      zones[index] = {
        ...zone,
        ...(change.postcodes ? { postcodes: change.postcodes } : {}),
        ...(change.feeCents !== undefined ? { feeCents: change.feeCents } : {}),
        ...(change.minimumCents !== undefined ? { minimumCents: change.minimumCents } : {}),
        ...(change.freeOverCents !== undefined ? { freeOverCents: change.freeOverCents } : {}),
      }
    } else {
      if (!change.postcodes?.length) return fail(400, `Say which postal codes the "${change.zoneName}" zone delivers to`)
      if (change.feeCents === undefined) return fail(400, `Say what delivery to "${change.zoneName}" costs (0 for free)`)
      if (zones.length >= LOCAL_DELIVERY_ZONES_MAX) return fail(409, `Local delivery holds at most ${LOCAL_DELIVERY_ZONES_MAX} zones`)
      zones.push({
        id: ids.zoneId,
        name: change.zoneName,
        kind: 'postcode',
        postcodes: change.postcodes,
        feeCents: change.feeCents,
        ...(change.minimumCents !== undefined ? { minimumCents: change.minimumCents } : {}),
        ...(change.freeOverCents !== undefined ? { freeOverCents: change.freeOverCents } : {}),
      })
    }
    after.zones = zones
  }
  const normalized = normalizeLocalDeliverySettings(after)
  const problems = localDeliveryProblems(normalized)
  if (problems.length) {
    return fail(400, `Local delivery can't be switched on yet: ${problems.join(' ')}`)
  }
  return {
    ok: true,
    write: sameSetting(before, normalized)
      ? null
      : { target: 'settings', field: 'localDelivery', value: normalized as Record<string, unknown> },
    summary: normalized.enabled
      ? `The store delivers locally to ${(normalized.zones ?? []).length} zone${(normalized.zones ?? []).length === 1 ? '' : 's'}.`
      : 'Local delivery is off.',
    warnings: normalized.enabled && !normalized.locationId ? ['No location is set for delivery orders to leave from.'] : [],
  }
}

const TAX_MODE_WORDS: Record<string, string> = {
  manual: 'manual rates',
  stripe: 'automatic calculation',
  none: 'not collecting sales tax',
}

function applyTax(state: StoreSetupState, change: StoreTaxChange): StoreSetupApplied {
  const before = (state.settings['tax'] ?? {}) as TaxSettings
  const after: TaxSettings = { ...before }
  const settingRate = change.ratePct !== undefined
  if (change.mode) after.mode = change.mode
  else if (settingRate && after.mode === undefined) after.mode = 'manual'
  if (settingRate && after.mode !== 'manual') {
    return fail(
      409,
      `This store uses ${TAX_MODE_WORDS[String(after.mode)] ?? 'another tax mode'}, so a manual rate would not apply. Ask to switch to manual rates as well.`,
    )
  }
  if (change.pricesIncludeTax !== undefined) after.pricesIncludeTax = change.pricesIncludeTax
  if (change.originCountry) {
    after.origin = {
      country: change.originCountry,
      ...(change.originState ? { state: change.originState } : {}),
    }
  }
  if (change.rateCountry) {
    const rates: TaxRate[] = [...(before.rates ?? [])]
    const index = rates.findIndex(
      (rate) =>
        String(rate.country ?? '').toUpperCase() === change.rateCountry &&
        String(rate.state ?? '').toUpperCase() === (change.rateState ?? ''),
    )
    if (change.removeRate) {
      if (index >= 0) rates.splice(index, 1)
    } else {
      const rate: TaxRate = {
        country: change.rateCountry,
        ...(change.rateState ? { state: change.rateState } : {}),
        pct: change.ratePct as number,
        ...(change.rateLabel ? { label: change.rateLabel } : index >= 0 && rates[index].label ? { label: rates[index].label } : {}),
      }
      if (index >= 0) rates[index] = rate
      else rates.push(rate)
    }
    after.rates = rates
  }
  // Manual mode with no origin refuses every sale (AGL-2145): never leave a store there.
  if (storefrontTaxMisconfiguration(after)) {
    return fail(400, 'Manual tax rates need the store’s address: say which country (and state) the store sells from.')
  }
  const warnings: string[] = []
  if (after.mode === 'manual' && !(after.rates ?? []).length) {
    warnings.push('No tax rate is set yet, so orders are charged no sales tax.')
  }
  if (after.mode === 'stripe') {
    warnings.push('Automatic tax is calculated per buyer location at checkout; the register cannot calculate it for in-person sales.')
  }
  const mode = TAX_MODE_WORDS[String(after.mode)] ?? 'undecided'
  const rateLine = settingRate
    ? ` ${change.ratePct}% for ${change.rateCountry}${change.rateState ? `-${change.rateState}` : ''}.`
    : ''
  return {
    ok: true,
    write: sameSetting(before, after) ? null : { target: 'settings', field: 'tax', value: after as Record<string, unknown> },
    summary: `Sales tax: ${mode}.${rateLine}`,
    warnings,
  }
}

/** The settings after a change, what to write, and what the person is told. */
export function applyStoreSetupChange(
  state: StoreSetupState,
  change: StoreSetupChange,
  ids: StoreSetupIds,
): StoreSetupApplied {
  switch (change.section) {
    case 'shipping':
      return applyShipping(state, change, ids)
    case 'pickup':
      return applyPickup(state, change)
    case 'local-delivery':
      return applyLocalDelivery(state, change, ids)
    case 'tax':
      return applyTax(state, change)
  }
}

/** What a reader is told about a store's setup, for the writer's `read`. */
export function storeSetupFacts(settings: Readonly<Record<string, unknown>>): Record<string, unknown> {
  const shipping = (settings['shipping'] ?? {}) as ShippingSettings
  const tax = (settings['tax'] ?? {}) as TaxSettings
  const delivery = normalizeLocalDeliverySettings(settings['localDelivery'])
  return {
    shippingZones: (shipping.zones ?? []).length,
    shippingRates: (shipping.rates ?? []).length,
    localPickup: Boolean(shipping.localPickup),
    localDelivery: Boolean(delivery.enabled),
    taxMode: tax.mode ?? null,
    taxRates: (tax.rates ?? []).length,
    live: true,
  }
}
