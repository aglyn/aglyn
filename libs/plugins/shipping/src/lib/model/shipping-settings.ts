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

import type { PluginShippingAddress } from '@aglyn/aglyn/plugin-manager/plugin-shipping-rates'
import {
  LABEL_FORMATS,
  SIGNATURE_OPTIONS,
  type LabelFormat,
  type SignatureOption,
} from '../providers/types'

/**
 * ONE SITE'S SHIPPING SETTINGS (AGL-3612): what a label is bought with when
 * nobody says otherwise. Client-safe and pure; the server normalizes every
 * save through {@link normalizeShippingHostSettings}, so a hand-written
 * document cannot reach a provider with a negative box or a format the
 * provider has never heard of.
 *
 * What a SHOPPER pays for a carrier rate — the markup, the handling fee,
 * which of the services below a zone offers — is the seller's to decide, on
 * its own rate. These settings decide only what the site can ship with.
 */

/** A box the merchant ships in. */
export interface ShippingPackagePreset {
  id: string
  name: string
  lengthCm: number
  widthCm: number
  heightCm: number
  /** What the empty box weighs, added to the goods. */
  emptyWeightGrams: number
}

export type InsuranceDefault = 'none' | 'order_value'

export interface ShippingHostSettings {
  packages: ShippingPackagePreset[]
  /** The preset a label starts with; the first when unset. */
  defaultPackageId?: string
  /** A place the site keeps (its id), or an address of its own when none fits. */
  shipFromId?: string
  shipFromAddress?: PluginShippingAddress
  labelFormat: LabelFormat
  insurance: InsuranceDefault
  signature: SignatureOption
  /** Services offered at checkout (`carrier:service`); empty offers every one. */
  checkoutServices: string[]
  /** Who certifies a customs declaration. */
  customsSigner?: string
}

export const DEFAULT_PACKAGE: ShippingPackagePreset = {
  id: 'default',
  name: 'Medium box',
  lengthCm: 30,
  widthCm: 23,
  heightCm: 15,
  emptyWeightGrams: 200,
}

export const DEFAULT_SHIPPING_HOST_SETTINGS: ShippingHostSettings = {
  packages: [DEFAULT_PACKAGE],
  labelFormat: 'pdf_4x6',
  insurance: 'none',
  signature: 'none',
  checkoutServices: [],
}

/** The most presets a site keeps, and the largest side a box may have. */
export const MAX_PACKAGE_PRESETS = 20
export const MAX_PACKAGE_SIDE_CM = 300
export const MAX_PACKAGE_WEIGHT_GRAMS = 70_000

const text = (value: unknown, max: number): string => String(value ?? '').trim().slice(0, max)

const positive = (value: unknown, ceiling: number): number => {
  const number = Number(value)
  return Number.isFinite(number) && number > 0 ? Math.min(ceiling, Math.round(number * 10) / 10) : 0
}

/** A stored address, or `undefined` when it names no country. */
export function normalizeShippingAddress(value: unknown): PluginShippingAddress | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const country = text(raw['country'], 2).toUpperCase()
  if (!/^[A-Z]{2}$/.test(country)) return undefined
  const address: PluginShippingAddress = { country }
  for (const field of ['name', 'company', 'line1', 'line2', 'city', 'state', 'postalCode', 'phone', 'email'] as const) {
    const fieldValue = text(raw[field], field === 'line1' || field === 'line2' ? 120 : 80)
    if (fieldValue) address[field] = fieldValue
  }
  if (typeof raw['residential'] === 'boolean') address.residential = raw['residential']
  return address
}

/** Whether an address names enough for a carrier to rate and label it. */
export function isCompleteAddress(address: PluginShippingAddress | undefined): boolean {
  return Boolean(address?.country && address.line1 && address.city && address.postalCode)
}

/** A stored or submitted settings document, made safe. Never throws. */
export function normalizeShippingHostSettings(value: unknown): ShippingHostSettings {
  const raw = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>
  const seen = new Set<string>()
  const packages: ShippingPackagePreset[] = []
  for (const entry of Array.isArray(raw['packages']) ? raw['packages'] : []) {
    const box = (entry ?? {}) as Record<string, unknown>
    const id = text(box['id'], 40).replace(/[^A-Za-z0-9_-]/g, '')
    const lengthCm = positive(box['lengthCm'], MAX_PACKAGE_SIDE_CM)
    const widthCm = positive(box['widthCm'], MAX_PACKAGE_SIDE_CM)
    const heightCm = positive(box['heightCm'], MAX_PACKAGE_SIDE_CM)
    if (!id || seen.has(id) || !lengthCm || !widthCm || !heightCm) continue
    seen.add(id)
    packages.push({
      id,
      name: text(box['name'], 60) || 'Box',
      lengthCm,
      widthCm,
      heightCm,
      emptyWeightGrams: Math.round(positive(box['emptyWeightGrams'], MAX_PACKAGE_WEIGHT_GRAMS)),
    })
    if (packages.length >= MAX_PACKAGE_PRESETS) break
  }
  const labelFormat = LABEL_FORMATS.includes(raw['labelFormat'] as LabelFormat)
    ? (raw['labelFormat'] as LabelFormat)
    : DEFAULT_SHIPPING_HOST_SETTINGS.labelFormat
  const signature = SIGNATURE_OPTIONS.includes(raw['signature'] as SignatureOption)
    ? (raw['signature'] as SignatureOption)
    : 'none'
  const defaultPackageId = text(raw['defaultPackageId'], 40)
  const shipFromId = text(raw['shipFromId'], 80)
  const shipFromAddress = normalizeShippingAddress(raw['shipFromAddress'])
  const customsSigner = text(raw['customsSigner'], 80)
  return {
    packages: packages.length ? packages : [DEFAULT_PACKAGE],
    ...(defaultPackageId && packages.some((box) => box.id === defaultPackageId)
      ? { defaultPackageId }
      : {}),
    ...(shipFromId ? { shipFromId } : {}),
    ...(shipFromAddress ? { shipFromAddress } : {}),
    labelFormat,
    insurance: raw['insurance'] === 'order_value' ? 'order_value' : 'none',
    signature,
    checkoutServices: Array.from(
      new Set(
        (Array.isArray(raw['checkoutServices']) ? raw['checkoutServices'] : [])
          .map((key) => text(key, 80).toLowerCase())
          .filter((key) => /^[a-z0-9_.-]+:[a-z0-9_.-]+$/.test(key)),
      ),
    ).slice(0, 50),
    ...(customsSigner ? { customsSigner } : {}),
  }
}

/** The preset a label starts with. */
export function defaultPackage(settings: ShippingHostSettings): ShippingPackagePreset {
  return (
    settings.packages.find((box) => box.id === settings.defaultPackageId) ??
    settings.packages[0] ??
    DEFAULT_PACKAGE
  )
}

/** Label format names a merchant reads. */
export const LABEL_FORMAT_LABELS: Readonly<Record<LabelFormat, string>> = {
  pdf_4x6: 'PDF, 4 × 6 in (thermal)',
  pdf_letter: 'PDF, letter paper',
  zpl: 'ZPL, 4 × 6 in (Zebra printers)',
}

export const SIGNATURE_LABELS: Readonly<Record<SignatureOption, string>> = {
  none: 'No signature',
  standard: 'Signature required',
  adult: 'Adult signature required',
}
