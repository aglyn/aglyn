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
 * What shopping channels ask of a product beyond what the store shows
 * (AGL-3637): the brand, the manufacturer's identifiers, the condition and
 * Google's category. Entered in the product editor's channel fields and read
 * by the product catalog the store publishes to other plugins
 * (`server/product-catalog.ts`). Every field is optional: a channel feed
 * falls back to the store's defaults and says what is missing.
 */
export interface ProductChannelFacts {
  /** The brand a shopper knows it by; at most 70 characters. */
  brand?: string
  /**
   * The product's GTIN (UPC, EAN, ISBN, JAN or ITF-14), digits only. For a
   * product with several configurations each variant's barcode is its own.
   */
  gtin?: string
  /** The manufacturer's part number; at most 70 characters. */
  mpn?: string
  condition?: 'new' | 'refurbished' | 'used'
  /** A Google product taxonomy id (`2271`) or full path. */
  googleProductCategory?: string
}

export const PRODUCT_CHANNEL_CONDITIONS = ['new', 'refurbished', 'used'] as const

/** Digits only, at most 14: what a barcode field holds once spaces and dashes are gone. */
export function normalizeGtin(value: unknown): string {
  return String(value ?? '')
    .replace(/[\s-]/g, '')
    .replace(/[^0-9]/g, '')
    .slice(0, 14)
}

const text = (value: unknown, max: number): string =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max)

/**
 * A stored product's channel facts made safe; `undefined` when nothing is
 * set. Never throws: the field is written by the editor, the importer and the
 * REST API, and read on every feed fetch.
 */
export function normalizeProductChannelFacts(value: unknown): ProductChannelFacts | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const facts: ProductChannelFacts = {}
  const brand = text(raw['brand'], 70)
  if (brand) facts.brand = brand
  const gtin = normalizeGtin(raw['gtin'])
  if (gtin.length >= 8) facts.gtin = gtin
  const mpn = text(raw['mpn'], 70)
  if (mpn) facts.mpn = mpn
  const condition = String(raw['condition'] ?? '').trim().toLowerCase()
  if ((PRODUCT_CHANNEL_CONDITIONS as readonly string[]).includes(condition)) {
    facts.condition = condition as ProductChannelFacts['condition']
  }
  const category = text(raw['googleProductCategory'], 750)
  if (category) facts.googleProductCategory = category
  return Object.keys(facts).length ? facts : undefined
}

/**
 * Channel facts as the product editor stages them, keystroke by keystroke:
 * what {@link normalizeProductChannelFacts} keeps, except that a field being
 * typed is kept as typed — a barcode shorter than eight digits, a brand with
 * the space before its next word. The editor runs this on every keystroke, so
 * the strict form would erase the field under the cursor; readers normalize
 * what is stored, so a half-typed value never reaches a channel.
 */
export function draftProductChannelFacts(value: unknown): ProductChannelFacts | undefined {
  if (!value || typeof value !== 'object') return undefined
  const raw = value as Record<string, unknown>
  const facts: ProductChannelFacts = {}
  const typed = (field: string, max: number) => String(raw[field] ?? '').replace(/^\s+/, '').slice(0, max)
  const brand = typed('brand', 70)
  if (brand) facts.brand = brand
  const gtin = normalizeGtin(raw['gtin'])
  if (gtin) facts.gtin = gtin
  const mpn = typed('mpn', 70)
  if (mpn) facts.mpn = mpn
  const condition = String(raw['condition'] ?? '').trim().toLowerCase()
  if ((PRODUCT_CHANNEL_CONDITIONS as readonly string[]).includes(condition)) {
    facts.condition = condition as ProductChannelFacts['condition']
  }
  const category = typed('googleProductCategory', 750)
  if (category) facts.googleProductCategory = category
  return Object.keys(facts).length ? facts : undefined
}
