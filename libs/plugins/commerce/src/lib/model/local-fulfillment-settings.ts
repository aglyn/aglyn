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
  parseOpeningHours,
  type OpeningHoursDay,
  type OpeningHoursRow,
} from '@aglyn/aglyn/app-utils/local-business'
import { zonedDateTime, zonedWallTimeToInstant } from '@aglyn/shared-util-timestamp/zoned-time'
import type { InventoryLocation, PostalAddress } from './commerce'
import type { PickupLocationSettings } from './order-local-fulfillment'

/**
 * Buy online, pick up in store, and the store's own local delivery (AGL-3624):
 * what a merchant configures, and the pure decisions checkout takes from it.
 *
 * PICKUP is per location. A location of `hosts/{hostId}/locations` (AGL-286,
 * the same stock buckets the register sells from) offers pickup when its
 * `pickup.enabled` is on, with its own hours and arrival instructions. The
 * buyer picks one at the cart; the order is routed there and its stock comes
 * off that location's bucket.
 *
 * LOCAL DELIVERY is per store, on `settings/store.localDelivery`: zones
 * matched by postal code (no outside service needed) or by distance from the
 * store (only where the store's address check returns map coordinates — see
 * `server/local-fulfillment.ts`), each with a fee, an order minimum and a
 * free-over threshold, and delivery windows written in the same
 * `Mo-Fr 09:00-12:00` syntax as a business's opening hours.
 */

/** A pickup location as the cart and the order show it. Public facts only. */
export interface PickupLocationOption {
  id: string
  name: string
  address?: string
  hours?: string
  instructions?: string
  readyWithinMinutes?: number
}

export const PICKUP_INSTRUCTIONS_MAX = 400
export const PICKUP_HOURS_MAX = 600
export const PICKUP_LOCATIONS_MAX = 25

const text = (value: unknown, max: number): string =>
  typeof value === 'string' ? value.trim().slice(0, max) : ''

const wholeMinutes = (value: unknown, max: number): number | undefined => {
  const minutes = Math.round(Number(value))
  return Number.isFinite(minutes) && minutes > 0 ? Math.min(minutes, max) : undefined
}

/** A stored pickup block made safe; never throws. */
export function normalizePickupSettings(value: unknown): PickupLocationSettings {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const settings: PickupLocationSettings = {}
  if (raw['enabled'] === true) settings.enabled = true
  const hours = text(raw['hours'], PICKUP_HOURS_MAX)
  if (hours) settings.hours = hours
  const instructions = text(raw['instructions'], PICKUP_INSTRUCTIONS_MAX)
  if (instructions) settings.instructions = instructions
  const ready = wholeMinutes(raw['readyWithinMinutes'], 14 * 24 * 60)
  if (ready) settings.readyWithinMinutes = ready
  return settings
}

/** A postal address on one line, or the location's free-text address. */
export function formatPostalAddressLine(address?: PostalAddress | null, fallback?: string | null): string {
  const parts = [
    address?.line1,
    address?.line2,
    [address?.city, address?.state].filter(Boolean).join(', '),
    address?.postalCode,
  ]
    .map((part) => String(part ?? '').trim())
    .filter(Boolean)
  return parts.length ? parts.join(', ') : String(fallback ?? '').trim()
}

/**
 * The locations a buyer may pick up from, default location first, then by
 * name. A location without pickup switched on is never offered, however
 * complete the rest of it is.
 */
export function pickupLocationOptions(
  locations: ReadonlyArray<(InventoryLocation & { id: string }) | null | undefined>,
): PickupLocationOption[] {
  return locations
    .filter((location): location is InventoryLocation & { id: string } =>
      Boolean(location?.id && normalizePickupSettings(location.pickup).enabled),
    )
    .sort(
      (a, b) =>
        Number(Boolean(b.isDefault)) - Number(Boolean(a.isDefault)) ||
        String(a.name ?? '').localeCompare(String(b.name ?? '')),
    )
    .slice(0, PICKUP_LOCATIONS_MAX)
    .map((location) => {
      const pickup = normalizePickupSettings(location.pickup)
      const address = formatPostalAddressLine(location.postalAddress, location.address)
      return {
        id: location.id,
        name: String(location.name || 'Store').slice(0, 80),
        ...(address ? { address } : {}),
        ...(pickup.hours ? { hours: pickup.hours } : {}),
        ...(pickup.instructions ? { instructions: pickup.instructions } : {}),
        ...(pickup.readyWithinMinutes ? { readyWithinMinutes: pickup.readyWithinMinutes } : {}),
      }
    })
}

/** "Usually ready in 2 hours" from a preparation time, or `''`. */
export function pickupReadyWithinLabel(minutes: number | undefined): string {
  if (!minutes || minutes <= 0) return ''
  if (minutes < 60) return `Usually ready in ${minutes} minutes`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `Usually ready in ${hours} hour${hours === 1 ? '' : 's'}`
  const days = Math.round(hours / 24)
  return `Usually ready in ${days} days`
}

// ---------------------------------------------------------------------------
// Local delivery
// ---------------------------------------------------------------------------

export interface LocalDeliveryCoordinates {
  lat: number
  lng: number
}

export interface LocalDeliveryZone {
  id: string
  name: string
  /**
   * `postcode` matches the buyer's postal code against `postcodes`;
   * `radius` measures the distance from the store's `origin`.
   */
  kind: 'postcode' | 'radius'
  /**
   * Codes this zone delivers to: `10001` exactly, `100*` by prefix, or
   * `10001-10099` as a numeric range.
   */
  postcodes?: string[]
  /** Kilometers from the store's origin, for a `radius` zone. */
  radiusKm?: number
  /** The delivery fee, in cents. */
  feeCents: number
  /** The smallest order (items, in cents) this zone delivers. */
  minimumCents?: number
  /** Items total (cents) at or above which delivery is free. */
  freeOverCents?: number
}

/** `settings/store.localDelivery`. */
export interface LocalDeliverySettings {
  enabled?: boolean
  /** The one country delivered within, ISO-3166 alpha-2. */
  country?: string
  /** The location orders leave from, and whose stock they take. */
  locationId?: string
  /** Where radius zones measure from, as the store's address check placed it. */
  origin?: LocalDeliveryCoordinates
  zones?: LocalDeliveryZone[]
  /** Delivery windows, one line per set of days: `Mo-Fr 09:00-12:00`. */
  windows?: string
  /** How long before a window opens an order must be placed, in minutes. */
  leadTimeMinutes?: number
  /** How many days ahead a window can be booked. */
  daysAhead?: number
  /** What the buyer is told about delivery: "We call when we're 10 minutes away". */
  instructions?: string
}

export const LOCAL_DELIVERY_ZONES_MAX = 20
export const LOCAL_DELIVERY_POSTCODES_MAX = 200
export const LOCAL_DELIVERY_DEFAULT_LEAD_MINUTES = 120
export const LOCAL_DELIVERY_DEFAULT_DAYS_AHEAD = 7
export const LOCAL_DELIVERY_MAX_DAYS_AHEAD = 30
/** A cart offers at most this many windows; the earliest are kept. */
export const LOCAL_DELIVERY_WINDOWS_OFFERED_MAX = 40
export const LOCAL_DELIVERY_RADIUS_MAX_KM = 200

const wholeCents = (value: unknown): number => {
  const cents = Math.round(Number(value ?? 0))
  return Number.isFinite(cents) && cents > 0 ? cents : 0
}

const coordinates = (value: unknown): LocalDeliveryCoordinates | undefined => {
  if (!value || typeof value !== 'object') return undefined
  const lat = Number((value as Record<string, unknown>)['lat'])
  const lng = Number((value as Record<string, unknown>)['lng'])
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return undefined
  if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return undefined
  return { lat, lng }
}

/**
 * One postal code as zones compare it: upper-cased with spaces removed, and a
 * US ZIP+4 cut to its five digits so `10001-1234` is in the `10001` zone.
 */
export function normalizePostcode(value: unknown, country?: string): string {
  const code = String(value ?? '').toUpperCase().replace(/\s+/g, '').slice(0, 16)
  if (String(country ?? '').toUpperCase() === 'US') {
    const zip = /^(\d{5})(?:-?\d{4})?$/.exec(code)
    if (zip) return zip[1]
  }
  return code
}

/** One zone entry as the console saves it: trimmed, upper-cased, spaces gone. */
function normalizePostcodePattern(value: unknown): string {
  return String(value ?? '').toUpperCase().replace(/\s+/g, '').slice(0, 24)
}

/** Whether a postal code is one a zone entry names. */
export function postcodePatternMatches(pattern: string, postcode: string): boolean {
  const entry = normalizePostcodePattern(pattern)
  const code = String(postcode ?? '').toUpperCase().replace(/\s+/g, '')
  if (!entry || !code) return false
  if (entry.endsWith('*')) {
    const prefix = entry.slice(0, -1)
    return prefix.length > 0 && code.startsWith(prefix)
  }
  const range = /^(\d+)-(\d+)$/.exec(entry)
  if (range && range[1].length === range[2].length && /^\d+$/.test(code)) {
    if (code.length !== range[1].length) return false
    const value = Number(code)
    const low = Math.min(Number(range[1]), Number(range[2]))
    const high = Math.max(Number(range[1]), Number(range[2]))
    return value >= low && value <= high
  }
  return entry === code
}

/** A stored zone made safe, or `null` when it cannot deliver anywhere. */
function normalizeZone(value: unknown): LocalDeliveryZone | null {
  if (!value || typeof value !== 'object') return null
  const raw = value as Record<string, unknown>
  const id = text(raw['id'], 60)
  if (!id) return null
  const kind = raw['kind'] === 'radius' ? 'radius' : 'postcode'
  const zone: LocalDeliveryZone = {
    id,
    name: text(raw['name'], 80) || 'Local delivery',
    kind,
    feeCents: wholeCents(raw['feeCents']),
  }
  if (kind === 'postcode') {
    const codes = Array.isArray(raw['postcodes']) ? (raw['postcodes'] as unknown[]) : []
    zone.postcodes = [...new Set(codes.map(normalizePostcodePattern).filter(Boolean))].slice(
      0,
      LOCAL_DELIVERY_POSTCODES_MAX,
    )
  } else {
    const radius = Number(raw['radiusKm'])
    zone.radiusKm =
      Number.isFinite(radius) && radius > 0
        ? Math.min(Math.round(radius * 10) / 10, LOCAL_DELIVERY_RADIUS_MAX_KM)
        : 0
  }
  const minimum = wholeCents(raw['minimumCents'])
  if (minimum) zone.minimumCents = minimum
  const freeOver = wholeCents(raw['freeOverCents'])
  if (freeOver) zone.freeOverCents = freeOver
  return zone
}

/** The stored settings made safe; never throws. */
export function normalizeLocalDeliverySettings(value: unknown): LocalDeliverySettings {
  if (!value || typeof value !== 'object') return {}
  const raw = value as Record<string, unknown>
  const settings: LocalDeliverySettings = {}
  if (raw['enabled'] === true) settings.enabled = true
  const country = String(raw['country'] ?? '').trim().toUpperCase()
  if (/^[A-Z]{2}$/.test(country)) settings.country = country
  const locationId = text(raw['locationId'], 120)
  if (locationId) settings.locationId = locationId
  const origin = coordinates(raw['origin'])
  if (origin) settings.origin = origin
  const zones = (Array.isArray(raw['zones']) ? (raw['zones'] as unknown[]) : [])
    .map(normalizeZone)
    .filter((zone): zone is LocalDeliveryZone => Boolean(zone))
    .slice(0, LOCAL_DELIVERY_ZONES_MAX)
  if (zones.length) settings.zones = zones
  const windows = text(raw['windows'], PICKUP_HOURS_MAX)
  if (windows) settings.windows = windows
  const lead = Math.round(Number(raw['leadTimeMinutes']))
  if (Number.isFinite(lead) && lead >= 0) settings.leadTimeMinutes = Math.min(lead, 14 * 24 * 60)
  const days = Math.round(Number(raw['daysAhead']))
  if (Number.isFinite(days) && days >= 1) settings.daysAhead = Math.min(days, LOCAL_DELIVERY_MAX_DAYS_AHEAD)
  const instructions = text(raw['instructions'], PICKUP_INSTRUCTIONS_MAX)
  if (instructions) settings.instructions = instructions
  return settings
}

/** Great-circle distance in kilometers (haversine). */
export function distanceKm(a: LocalDeliveryCoordinates, b: LocalDeliveryCoordinates): number {
  const radians = (degrees: number) => (degrees * Math.PI) / 180
  const dLat = radians(b.lat - a.lat)
  const dLng = radians(b.lng - a.lng)
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(radians(a.lat)) * Math.cos(radians(b.lat)) * Math.sin(dLng / 2) ** 2
  return 2 * 6371 * Math.asin(Math.min(1, Math.sqrt(h)))
}

/** Whether any zone measures distance, so checkout needs the full address placed on a map. */
export function localDeliveryHasRadiusZones(settings: LocalDeliverySettings | undefined): boolean {
  return Boolean(settings?.origin) && (settings?.zones ?? []).some((zone) => zone.kind === 'radius' && (zone.radiusKm ?? 0) > 0)
}

/**
 * The zone a destination falls in, or `null`. Postal-code zones are asked
 * first, in the order the store listed them, so a store can carve a cheaper
 * neighbourhood out of a wider one by listing it above. Radius zones answer
 * only with both ends on a map — the store's origin and the destination's
 * coordinates — and the tightest radius that reaches wins.
 */
export function matchLocalDeliveryZone(
  settings: LocalDeliverySettings | undefined,
  destination: { country?: string; postalCode?: string; coordinates?: LocalDeliveryCoordinates | null },
): LocalDeliveryZone | null {
  if (!settings?.country) return null
  const country = String(destination.country ?? settings.country).toUpperCase()
  if (country !== settings.country) return null
  const postcode = normalizePostcode(destination.postalCode, settings.country)
  const zones = settings.zones ?? []
  if (postcode) {
    for (const zone of zones) {
      if (zone.kind !== 'postcode') continue
      if ((zone.postcodes ?? []).some((pattern) => postcodePatternMatches(pattern, postcode))) return zone
    }
  }
  const at = destination.coordinates ? coordinates(destination.coordinates) : undefined
  if (!at || !settings.origin) return null
  const distance = distanceKm(settings.origin, at)
  return (
    zones
      .filter((zone) => zone.kind === 'radius' && (zone.radiusKm ?? 0) > 0 && distance <= (zone.radiusKm ?? 0))
      .sort((a, b) => (a.radiusKm ?? 0) - (b.radiusKm ?? 0))[0] ?? null
  )
}

/** What a zone charges for an order of `itemsCents`. */
export function localDeliveryFeeCents(zone: LocalDeliveryZone, itemsCents: number): number {
  if (zone.freeOverCents && itemsCents >= zone.freeOverCents) return 0
  return Math.max(0, Math.round(zone.feeCents || 0))
}

/** How far an order of `itemsCents` is below the zone's minimum; 0 when it meets it. */
export function localDeliveryMinimumShortfall(zone: LocalDeliveryZone, itemsCents: number): number {
  return Math.max(0, (zone.minimumCents ?? 0) - Math.max(0, Math.round(itemsCents || 0)))
}

/** One bookable delivery window. `id` is its start instant, which is what the buyer sends back. */
export interface LocalDeliveryWindow {
  id: string
  startMs: number
  endMs: number
}

const DAY_NAMES: readonly OpeningHoursDay[] = [
  'Sunday',
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
]

/** The windows rows a store's settings parse to. Lines that do not read are dropped. */
export function localDeliveryWindowRows(settings: LocalDeliverySettings | undefined): OpeningHoursRow[] {
  return parseOpeningHours(settings?.windows ?? '')
}

/**
 * The windows a buyer may book now, soonest first: every row on every day
 * from today to `daysAhead`, in the store's time zone, that opens at least
 * the lead time from now. Pure in `nowMs`, so a spec can stand at any hour.
 */
export function upcomingLocalDeliveryWindows(
  settings: LocalDeliverySettings | undefined,
  context: { nowMs: number; timeZone: string },
): LocalDeliveryWindow[] {
  const rows = localDeliveryWindowRows(settings)
  if (!rows.length) return []
  const lead = (settings?.leadTimeMinutes ?? LOCAL_DELIVERY_DEFAULT_LEAD_MINUTES) * 60_000
  const daysAhead = settings?.daysAhead ?? LOCAL_DELIVERY_DEFAULT_DAYS_AHEAD
  const today = zonedDateTime(context.nowMs, context.timeZone)
  const windows: LocalDeliveryWindow[] = []
  const seen = new Set<number>()
  for (let offset = 0; offset <= daysAhead; offset++) {
    // Noon of the day, so a daylight-saving change never lands it on the
    // wrong calendar date.
    const noon = zonedWallTimeToInstant(
      { year: today.year, month: today.month, day: today.day + offset, hour: 12 },
      context.timeZone,
    )
    const day = zonedDateTime(noon, context.timeZone)
    const name = DAY_NAMES[day.weekday]
    for (const row of rows) {
      if (!row.days.includes(name)) continue
      const [openHour, openMinute] = row.opens.split(':').map(Number)
      const [closeHour, closeMinute] = row.closes.split(':').map(Number)
      const startMs = zonedWallTimeToInstant(
        { year: day.year, month: day.month, day: day.day, hour: openHour, minute: openMinute },
        context.timeZone,
      )
      const overnight = closeHour * 60 + closeMinute <= openHour * 60 + openMinute
      const endMs = zonedWallTimeToInstant(
        {
          year: day.year,
          month: day.month,
          day: day.day + (overnight ? 1 : 0),
          hour: closeHour,
          minute: closeMinute,
        },
        context.timeZone,
      )
      if (startMs < context.nowMs + lead || seen.has(startMs)) continue
      seen.add(startMs)
      windows.push({ id: String(startMs), startMs, endMs })
    }
  }
  return windows.sort((a, b) => a.startMs - b.startMs).slice(0, LOCAL_DELIVERY_WINDOWS_OFFERED_MAX)
}

/** The bookable window starting at `startMs`, or `null` when no such window is open now. */
export function findLocalDeliveryWindow(
  settings: LocalDeliverySettings | undefined,
  startMs: unknown,
  context: { nowMs: number; timeZone: string },
): LocalDeliveryWindow | null {
  const wanted = Math.round(Number(startMs))
  if (!Number.isFinite(wanted)) return null
  return upcomingLocalDeliveryWindows(settings, context).find((window) => window.startMs === wanted) ?? null
}

/** Whether checkout can offer local delivery at all. */
export function localDeliveryOffered(settings: LocalDeliverySettings | undefined): boolean {
  return Boolean(
    settings?.enabled &&
      settings.country &&
      (settings.zones ?? []).length > 0 &&
      localDeliveryWindowRows(settings).length > 0,
  )
}

/**
 * What stops saved settings from offering delivery, in the console's words.
 * Empty when checkout will offer it (or when it is switched off).
 */
export function localDeliveryProblems(settings: LocalDeliverySettings | undefined): string[] {
  if (!settings?.enabled) return []
  const problems: string[] = []
  if (!settings.country) problems.push('Choose the country you deliver in.')
  const zones = settings.zones ?? []
  if (!zones.length) problems.push('Add at least one delivery zone.')
  for (const zone of zones) {
    if (zone.kind === 'postcode' && !(zone.postcodes ?? []).length) {
      problems.push(`"${zone.name}" lists no postal codes.`)
    }
    if (zone.kind === 'radius' && !settings.origin) {
      problems.push(`"${zone.name}" measures distance, but your store has no map position yet.`)
    }
  }
  if (!localDeliveryWindowRows(settings).length) problems.push('Add at least one delivery window.')
  return problems
}

/** "Tue, Oct 14, 9:00 AM – 12:00 PM" in the store's zone. */
export function formatLocalDeliveryWindow(
  window: { startMs: number; endMs: number },
  timeZone: string,
): string {
  try {
    const day = new Intl.DateTimeFormat('en-US', {
      timeZone,
      weekday: 'short',
      month: 'short',
      day: 'numeric',
    }).format(new Date(window.startMs))
    const time = new Intl.DateTimeFormat('en-US', { timeZone, hour: 'numeric', minute: '2-digit' })
    return `${day}, ${time.format(new Date(window.startMs))} – ${time.format(new Date(window.endMs))}`
  } catch {
    return new Date(window.startMs).toISOString()
  }
}
