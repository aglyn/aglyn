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

import * as Aglyn from '@aglyn/aglyn'
import { resolveVisitorCountry } from '@aglyn/aglyn/app-utils/visitor-country'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { formatOrderMoney } from '../model/buyer-notifications'
import type { FixedPrices, PublicCurrencyAnswer, StoreCurrency } from '../model/commerce-currency'

/**
 * The conversion model (country map, names, rounding), a chunk of its own:
 * loaded only for a store that sells in more than one currency, so a
 * one-currency store's pages carry none of it (check:plugin-budgets).
 */
type CurrencyModel = typeof import('../model/commerce-currency')

/**
 * The shopper's currency on a storefront (AGL-4248), the way Shopify Markets
 * does it: prices in the visitor's own currency, picked from their country
 * among the currencies the merchant sells in, switchable, and remembered.
 *
 * Tenant pages are ISR-cached (one HTML for everyone), so this resolves on
 * the CLIENT after hydrate: the first render, on the server and in the
 * browser, prints the store currency, and every block re-prices once the
 * store's answer (`commerce/currency`) is in. One fetch per page, shared by
 * every block through a module-level cache; the visitor's country is asked
 * only of a store that sells in more than one currency.
 */

/** Blocks re-price when a shopper switches currency anywhere on the page. */
export const SHOPPER_CURRENCY_CHANGED_EVENT = 'aglyn:currency-changed'

/** Where the shopper's own choice is kept, per store. */
export function shopperCurrencyStorageKey(hostId: string): string {
  return `aglyn.currency.${hostId}`
}

export function readChosenCurrency(hostId: string): string | null {
  try {
    const value = window.localStorage.getItem(shopperCurrencyStorageKey(hostId))
    return value && /^[A-Z]{3}$/.test(value) ? value : null
  } catch {
    return null
  }
}

function writeChosenCurrency(hostId: string, code: string): void {
  try {
    window.localStorage.setItem(shopperCurrencyStorageKey(hostId), code)
  } catch {
    // Private-mode storage: the choice lasts this page only.
  }
}

/** What a store sells in, plus the visitor's country when it was needed. */
interface CurrencyLookup {
  answer: PublicCurrencyAnswer | null
  country: string | null
  /** Loaded with a store that sells in several currencies; absent otherwise. */
  model?: CurrencyModel
}

const lookups = new Map<string, Promise<CurrencyLookup>>()

async function lookUpCurrency(hostId: string): Promise<CurrencyLookup> {
  let answer: PublicCurrencyAnswer | null = null
  try {
    const response = await fetch(`/api/commerce/currency?hostId=${encodeURIComponent(hostId)}`)
    if (response.ok) {
      const payload = (await response.json().catch(() => null)) as PublicCurrencyAnswer | null
      if (payload && typeof payload.base === 'string' && Array.isArray(payload.currencies)) {
        answer = payload
      }
    }
  } catch {
    // The store currency, as before multi-currency.
  }
  if (!answer || answer.currencies.length < 2) return { answer, country: null }
  // The country is asked only where it can change anything: a store selling
  // in one currency, or one with auto-detect off, never sends the request.
  const [country, model] = await Promise.all([
    answer.autoDetect ? resolveVisitorCountry().catch((): null => null) : null,
    import('../model/commerce-currency').catch((): undefined => undefined),
  ])
  // Without the model nothing can be converted: the store currency it is.
  return model ? { answer, country, model } : { answer: { ...answer, currencies: answer.currencies.slice(0, 1) }, country: null }
}

/** One lookup per store per page, however many blocks ask. */
export function loadShopperCurrency(hostId: string): Promise<CurrencyLookup> {
  let pending = lookups.get(hostId)
  if (!pending) {
    pending = lookUpCurrency(hostId)
    lookups.set(hostId, pending)
    // A failed store answer is not pinned: the next page asks again.
    void pending.then((lookup) => {
      if (!lookup.answer && lookups.get(hostId) === pending) lookups.delete(hostId)
    })
  }
  return pending
}

/** Test seam. */
export function resetShopperCurrencyCache(): void {
  lookups.clear()
}

/** A variant as the storefront has it: its store price in major units. */
export interface PricedVariant {
  priceUsd?: number | null
  fixedPrices?: FixedPrices
}

/** An add-on choice as the storefront has it. */
export interface PricedAddOn {
  priceCents: number
  priceCentsByVariant?: Record<string, number>
  fixedPriceCents?: Record<string, number>
}

export interface ShopperCurrency {
  /** The currency prices print in (upper case). */
  code: string
  /** The store currency. */
  base: string
  /** What the store sells in, the store currency first. */
  currencies: StoreCurrency[]
  /** The store's answer is in. Before it, everything prints in the store currency. */
  ready: boolean
  /** Prices print in another currency than the store's. */
  foreign: boolean
  setCurrency: (code: string) => void
  /** A variant's price in the shopper currency, minor units (fixed price wins). */
  variantMinor: (variant: PricedVariant) => number
  /** A store amount (add-on, fee, delivery) in the shopper currency, minor units. */
  amountMinor: (baseCents: number, fixedMinor?: Record<string, number>) => number
  /** An add-on's price on a variant in the shopper currency, minor units. */
  addOnMinor: (option: PricedAddOn, variantId?: string | null) => number
  /** A currency's name ("New Zealand dollar"), once the store's currencies are in. */
  currencyName: (code: string) => string | undefined
  /** Minor units already in the shopper currency, as money. */
  format: (minor: number) => string
  /** Minor units in a named currency (a server answer), as money. */
  formatIn: (minor: number, code: string | undefined) => string
  formatBaseCents: (cents: number) => string
  formatVariant: (variant: PricedVariant) => string
  formatAddOn: (option: PricedAddOn, variantId?: string | null) => string
}

/** The pure half: the currency a store's answer and a shopper resolve to. */
export function shopperCurrencyFrom(input: {
  answer: PublicCurrencyAnswer | null
  country: string | null
  chosen: string | null
  model?: CurrencyModel
}): { code: string; base: string; currencies: StoreCurrency[]; entry: StoreCurrency } {
  const { answer, model } = input
  if (!answer) {
    return { code: 'USD', base: 'USD', currencies: [], entry: { code: 'USD', rounding: 'none' } }
  }
  const base = answer.base
  const currencies = answer.currencies.length
    ? answer.currencies
    : [{ code: base, rounding: 'none' as const }]
  if (!model || currencies.length < 2) {
    return { code: base, base, currencies: currencies.slice(0, 1), entry: { code: base, rounding: 'none' } }
  }
  const code = model.resolveShopperCurrency({
    settings: { enabled: true, autoDetect: answer.autoDetect, currencies },
    base,
    country: input.country,
    chosen: input.chosen,
  })
  const entry = currencies.find((item) => item.code === code)
  // A currency the store cannot price (no daily rate and no rate of the
  // merchant's own) prints in the store currency, as checkout would charge
  // it. Asked through the converter, so it follows however the model rates it.
  if (!entry || (code !== base && model.convertMinor(100, base, entry, answer.rates ?? undefined) == null)) {
    return { code: base, base, currencies, entry: { code: base, rounding: 'none' } }
  }
  return { code, base, currencies, entry }
}

/**
 * The shopper's currency and its formatters, for any storefront block. Safe
 * on the canvas and in a test with no site: it prints the store currency.
 */
export function useShopperCurrency(): ShopperCurrency {
  const { hostId } = Aglyn.useSite()
  const [lookup, setLookup] = useState<CurrencyLookup | null>(null)
  const [chosen, setChosen] = useState<string | null>(null)

  useEffect(() => {
    if (!hostId) return
    let live = true
    setChosen(readChosenCurrency(hostId))
    void loadShopperCurrency(hostId).then((next) => {
      if (live) setLookup(next)
    })
    const onChange = () => setChosen(readChosenCurrency(hostId))
    window.addEventListener(SHOPPER_CURRENCY_CHANGED_EVENT, onChange)
    return () => {
      live = false
      window.removeEventListener(SHOPPER_CURRENCY_CHANGED_EVENT, onChange)
    }
  }, [hostId])

  const setCurrency = useCallback(
    (code: string) => {
      if (!hostId) return
      writeChosenCurrency(hostId, code.toUpperCase())
      setChosen(code.toUpperCase())
      window.dispatchEvent(new Event(SHOPPER_CURRENCY_CHANGED_EVENT))
    },
    [hostId],
  )

  return useMemo(() => {
    const answer = lookup?.answer ?? null
    const ready = Boolean(answer)
    const model = lookup?.model
    const resolved = shopperCurrencyFrom({ answer, country: lookup?.country ?? null, chosen, model })
    const { code, base, entry } = resolved
    const rates = answer?.rates ?? undefined
    const foreign = Boolean(model) && ready && code !== base
    const disambiguate = model
      ? model.currenciesShareSign(resolved.currencies.map((item) => item.code))
      : false
    const formatIn = (minor: number, currency: string | undefined) =>
      // A one-currency store, and any store before it answers, prints
      // exactly what the page printed before multi-currency.
      model
        ? model.formatShopperMoney(minor, currency || base, { disambiguate })
        : formatOrderMoney(minor, currency || (ready ? base : 'USD'))
    const variantMinor = (variant: PricedVariant) => {
      const baseMinor = Math.round(Number(variant.priceUsd ?? 0) * 100)
      if (!foreign) return baseMinor
      return (
        model?.variantPriceMinor(
          { priceUsd: Number(variant.priceUsd ?? 0), fixedPrices: variant.fixedPrices },
          base,
          entry,
          rates,
        ) ?? baseMinor
      )
    }
    const amountMinor = (baseCents: number, fixedMinor?: Record<string, number>) =>
      foreign ? (model?.amountMinorIn(baseCents, base, entry, rates, fixedMinor) ?? baseCents) : baseCents
    const addOnMinor = (option: PricedAddOn, variantId?: string | null) => {
      const byVariant = variantId ? option.priceCentsByVariant?.[variantId] : undefined
      const cents = typeof byVariant === 'number' && Number.isFinite(byVariant) ? byVariant : option.priceCents
      return amountMinor(cents, option.fixedPriceCents)
    }
    const shown = ready ? code : undefined
    const format = (minor: number) => formatIn(minor, shown)
    return {
      code,
      base,
      currencies: resolved.currencies,
      ready,
      foreign,
      setCurrency,
      currencyName: (currency: string) => model?.CURRENCY_NAMES[currency],
      variantMinor,
      amountMinor,
      addOnMinor,
      format,
      formatIn,
      formatBaseCents: (cents: number) => format(amountMinor(cents)),
      formatVariant: (variant: PricedVariant) => format(variantMinor(variant)),
      formatAddOn: (option: PricedAddOn, variantId?: string | null) =>
        format(addOnMinor(option, variantId)),
    }
  }, [lookup, chosen, setCurrency])
}
