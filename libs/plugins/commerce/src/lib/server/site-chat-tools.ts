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

import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/app-utils/api-plugins'
import { resolveMediaSrc } from '@aglyn/aglyn/app-utils/media-ref'
import { buildSectionIndex, rankSections } from '@aglyn/aglyn/app-utils/section-retrieval'
import type {
  SiteChatCard,
  SiteChatToolAnswer,
  SiteChatToolRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-site-chat-tools'
import { firebaseAdmin } from '@aglyn/tenant-data-admin/server/firebase-admin'
import { CART_UPDATED_EVENT } from '../constants/cart-events'
import * as CommerceModel from '../model'
import { reservationAvailabilityHandler } from './reservation-availability'

/**
 * The store's site chat tools (AGL-4250). Each reads the one site it is
 * handed and nothing else; a proposal checks what it proposes against the
 * same rules the door it names will apply, so a card the visitor presses
 * goes through. The prices and dates it states are the store's own.
 */

const PRODUCT_SCAN = 300
const RESOURCE_SCAN = 100

const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : '')
const money = (usd: number): string =>
  `$${Number.isInteger(usd) ? usd : usd.toFixed(2)}`
const DAY = /^\d{4}-\d{2}-\d{2}$/
const dayMs = (day: string): number => (DAY.test(day) ? Date.parse(`${day}T00:00:00Z`) : 0)
const dayLabel = (ms: number): string =>
  new Date(ms).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })

const hostRef = (hostId: string) => firebaseAdmin.app().firestore().collection('hosts').doc(hostId)

interface FoundProduct {
  id: string
  data: Record<string, any>
  product: CommerceModel.HostProduct
}

/** The site's online product best named by `name`, or `null`. */
async function findProduct(hostId: string, name: string): Promise<FoundProduct | null> {
  if (!name) return null
  const snapshot = await hostRef(hostId)
    .collection('products')
    .where('deletedAt', '==', null)
    .where('status', '==', 'active')
    .limit(PRODUCT_SCAN)
    .get()
  const listed = snapshot.docs
    .map((doc) => ({ id: doc.id, data: doc.data() as Record<string, any> }))
    .filter(
      ({ data }) =>
        CommerceModel.productListedOnline(data) &&
        CommerceModel.productSellsOnline(data) &&
        !CommerceModel.productIsSample(data),
    )
  const exact = listed.find(({ data }) => str(data['name']).toLowerCase() === name.toLowerCase())
  const best =
    exact ??
    rankSections(
      buildSectionIndex(
        listed.map((entry) => ({
          title: str(entry.data['name']),
          heading: '',
          text: [str(entry.data['slug']).replace(/-/g, ' '), ...(entry.data['tags'] ?? [])].join(' '),
          entry,
        })),
      ),
      name,
      { limit: 1 },
    )[0]?.section.entry
  if (!best) return null
  return { ...best, product: CommerceModel.liftLegacyProduct(best.data as never) }
}

const optionName = (variant: CommerceModel.ProductVariant): string =>
  Object.values(variant.options ?? {}).filter(Boolean).join(' / ') || 'Standard'

function productCardOf(hostId: string, found: FoundProduct, variant?: CommerceModel.ProductVariant): SiteChatCard {
  const [min, max] = CommerceModel.productPriceRange(found.product)
  const image = resolveMediaSrc(variant?.imageUrl ?? found.data['imageUrl'] ?? found.data['mediaUrls']?.[0], { hostId })
  const slug = str(found.data['slug'])
  return {
    kind: 'product',
    title: str(found.data['name']) || found.id,
    ...(slug ? { url: `/products/${slug}` } : {}),
    ...(image ? { imageUrl: image } : {}),
    price: variant ? money(variant.priceUsd) : CommerceModel.productPriceText(found.product, min, max),
    ...(variant?.compareAtPriceUsd && variant.compareAtPriceUsd > variant.priceUsd
      ? { compareAtPrice: money(variant.compareAtPriceUsd) }
      : {}),
  }
}

function needsAddOns(product: CommerceModel.HostProduct, variantId: string | undefined): boolean {
  const resolved = CommerceModel.resolveWebsiteLineModifiers(product as never, [], variantId)
  return !resolved.ok
}

export async function commerceProductDetails(request: SiteChatToolRequest): Promise<SiteChatToolAnswer> {
  const found = await findProduct(request.hostId, str(request.input['product']))
  if (!found) return { text: 'No product on this site matches that name.' }
  const variants = found.product.variants ?? []
  const lines = variants.slice(0, 12).map((variant) => {
    const sale =
      variant.compareAtPriceUsd && variant.compareAtPriceUsd > variant.priceUsd
        ? ` (was ${money(variant.compareAtPriceUsd)})`
        : ''
    const day = CommerceModel.productAsksUseDate(found.product, variant.id) ? '; asks for the day it will be used' : ''
    return `- ${optionName(variant)}: ${CommerceModel.variantHasPrice(variant) ? money(variant.priceUsd) : 'price coming soon'}${sale}${day}`
  })
  const addOns = needsAddOns(found.product, variants[0]?.id)
    ? 'It has add-ons the visitor must choose on its page, so it cannot be added from the chat.'
    : ''
  return {
    text: [
      `${str(found.data['name'])}${found.data['slug'] ? ` (page /products/${found.data['slug']})` : ''}`,
      variants.length > 1 ? 'Options:' : 'Price:',
      ...lines,
      addOns,
    ]
      .filter(Boolean)
      .join('\n'),
    cards: [productCardOf(request.hostId, found)],
  }
}

export async function commerceProposeAddToCart(request: SiteChatToolRequest): Promise<SiteChatToolAnswer> {
  const found = await findProduct(request.hostId, str(request.input['product']))
  if (!found) return { text: 'No product on this site matches that name.' }
  const variants = found.product.variants ?? []
  const asked = str(request.input['option']).toLowerCase()
  const variant =
    variants.length <= 1
      ? variants[0]
      : variants.find((entry) => optionName(entry).toLowerCase() === asked) ??
        variants.find((entry) => asked && optionName(entry).toLowerCase().includes(asked))
  if (!variant) {
    return { text: `Ask which option the visitor wants: ${variants.map(optionName).join(', ')}.` }
  }
  if (!CommerceModel.variantHasPrice(variant)) return { text: 'That option has no price yet, so it cannot be added.' }
  if (needsAddOns(found.product, variant.id)) {
    const slug = str(found.data['slug'])
    return {
      text: `This product has add-ons to choose on its page${slug ? ` (/products/${slug})` : ''}; send the visitor there.`,
    }
  }
  const day = str(request.input['day'])
  const asksDay = CommerceModel.productAsksUseDate(found.product, variant.id)
  if (asksDay && !DAY.test(day)) return { text: 'Ask the visitor which day they will use it.' }
  const quantity = Math.min(CommerceModel.CART_MAX_QUANTITY, Math.max(1, Math.round(Number(request.input['quantity']) || 1)))
  const name = str(found.data['name'])
  const option = variants.length > 1 ? ` (${optionName(variant)})` : ''
  return {
    text: `Offered the visitor a card to add ${quantity} × ${name}${option} to their cart.`,
    proposal: {
      kind: 'add-to-cart',
      title: `Add ${name}${option} to your cart?`,
      summary: `${quantity} × ${money(variant.priceUsd)}${asksDay ? `, for ${dayLabel(dayMs(day))}` : ''}. You can review it in your cart before checkout.`,
      confirmLabel: 'Add to cart',
      afterEvent: CART_UPDATED_EVENT,
      card: productCardOf(request.hostId, found, variant),
      request: {
        path: 'commerce/cart',
        body: {
          hostId: request.hostId,
          action: 'add',
          productId: found.id,
          ...(variant.id && variant.id !== 'default' ? { variantId: variant.id } : {}),
          quantity,
          ...(asksDay ? { useDayKey: day } : {}),
        },
      },
    },
  }
}

interface FoundResource {
  id: string
  resource: CommerceModel.HostResource
}

async function findResource(hostId: string, name: string): Promise<FoundResource | null> {
  if (!name) return null
  const snapshot = await hostRef(hostId).collection('resources').limit(RESOURCE_SCAN).get()
  const all = snapshot.docs.map((doc) => ({ id: doc.id, resource: doc.data() as CommerceModel.HostResource }))
  const exact = all.find(({ resource }) => str(resource.name).toLowerCase() === name.toLowerCase())
  if (exact) return exact
  return (
    rankSections(
      buildSectionIndex(all.map((entry) => ({ title: str(entry.resource.name), heading: '', text: '', entry }))),
      name,
      { limit: 1 },
    )[0]?.section.entry ?? null
  )
}

/** A registered handler answered in-process, for its JSON. */
async function answerOf(
  handler: PluginApiHandler,
  query: Record<string, string>,
): Promise<{ status: number; body: any }> {
  let status = 200
  let body: unknown = null
  const res = {
    status(code: number) {
      status = code
      return res
    },
    json(value: unknown) {
      body = value
    },
    send(value: unknown) {
      body = value
    },
    setHeader() {
      return undefined
    },
    redirect() {
      return undefined
    },
    end() {
      return undefined
    },
  }
  const req: PluginApiRequest = { method: 'GET', query, body: undefined, headers: {}, cookies: {} } as never
  await handler(req, res as never)
  return { status, body }
}

interface StayCheck {
  found: FoundResource
  checkInDayMs: number
  checkOutDayMs: number
  free: boolean
  quote: CommerceModel.ReservationQuote
}

async function checkStay(request: SiteChatToolRequest): Promise<StayCheck | string> {
  const found = await findResource(request.hostId, str(request.input['stay']))
  if (!found) return 'No stay on this site matches that name.'
  const checkInDayMs = dayMs(str(request.input['checkIn']))
  const checkOutDayMs = dayMs(str(request.input['checkOut']))
  if (!checkInDayMs || !checkOutDayMs) return 'Ask the visitor for the check-in and check-out days.'
  if (checkOutDayMs <= checkInDayMs) return 'The check-out day must be after the check-in day.'
  const todayMs = Date.parse(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`)
  if (checkInDayMs < todayMs) return 'That check-in day has passed.'
  const { status, body } = await answerOf(reservationAvailabilityHandler, {
    hostId: request.hostId,
    resourceId: found.id,
  })
  if (status !== 200 || !body?.resource) return 'Availability for that stay is not available right now.'
  const quote = CommerceModel.computeReservationQuote(found.resource, checkInDayMs, checkOutDayMs)
  const free = CommerceModel.isRangeAvailable(
    found.resource,
    (body.unavailable ?? []).map((range: { fromDayMs: number; toDayMs: number }) => ({
      checkInDayMs: range.fromDayMs,
      checkOutDayMs: range.toDayMs,
      status: 'confirmed' as const,
    })),
    checkInDayMs,
    checkOutDayMs,
  )
  return { found, checkInDayMs, checkOutDayMs, free, quote }
}

function stayCard(hostId: string, found: FoundResource, quote?: CommerceModel.ReservationQuote): SiteChatCard {
  const image = resolveMediaSrc(found.resource.photoUrls?.[0], { hostId })
  return {
    kind: 'stay',
    title: found.resource.name,
    ...(image ? { imageUrl: image } : {}),
    price: quote && quote.totalCents ? money(quote.totalCents / 100) : `${money(found.resource.nightlyRateUsd)} a night`,
    ...(quote && quote.nights ? { caption: `${quote.nights} ${quote.nights === 1 ? 'night' : 'nights'}` } : {}),
  }
}

export async function commerceStayAvailability(request: SiteChatToolRequest): Promise<SiteChatToolAnswer> {
  const check = await checkStay(request)
  if (typeof check === 'string') return { text: check }
  const { found, checkInDayMs, checkOutDayMs, free, quote } = check
  const range = `${dayLabel(checkInDayMs)} to ${dayLabel(checkOutDayMs)}`
  if (quote.problem) return { text: `${found.resource.name}: ${quote.problem}.` }
  return {
    text: free
      ? `${found.resource.name} is free from ${range}: ${quote.nights} nights, ${money(quote.totalCents / 100)} in all${
          quote.depositCents && quote.depositCents < quote.totalCents ? `, ${money(quote.depositCents / 100)} due now as a deposit` : ''
        }.`
      : `${found.resource.name} is not free for every night from ${range}.`,
    cards: [stayCard(request.hostId, found, free ? quote : undefined)],
  }
}

export async function commerceProposeReservation(request: SiteChatToolRequest): Promise<SiteChatToolAnswer> {
  const check = await checkStay(request)
  if (typeof check === 'string') return { text: check }
  const { found, checkInDayMs, checkOutDayMs, free, quote } = check
  if (quote.problem) return { text: `${found.resource.name}: ${quote.problem}.` }
  if (!free) return { text: `${found.resource.name} is not free for those nights; offer other dates.` }
  const guests = Math.max(0, Math.round(Number(request.input['guests']) || 0))
  const ceiling = CommerceModel.resourceGuestCeiling(found.resource)
  if (guests && ceiling && guests > ceiling) return { text: `${found.resource.name} sleeps ${ceiling} at most.` }
  const due = quote.depositCents && quote.depositCents < quote.totalCents ? quote.depositCents : quote.totalCents
  return {
    text: `Offered the visitor a card to reserve ${found.resource.name}.`,
    proposal: {
      kind: 'reserve',
      title: `Reserve ${found.resource.name}?`,
      summary: `${dayLabel(checkInDayMs)} to ${dayLabel(checkOutDayMs)}, ${quote.nights} nights, ${money(
        quote.totalCents / 100,
      )}. You pay ${money(due / 100)} at checkout.`,
      confirmLabel: 'Reserve and pay',
      idempotent: true,
      fields: [
        { name: 'guestName', label: 'Your name', type: 'text', required: true },
        { name: 'guestEmail', label: 'Your email', type: 'email', required: true },
      ],
      card: stayCard(request.hostId, found, quote),
      request: {
        path: 'commerce/reserve',
        body: {
          hostId: request.hostId,
          resourceId: found.id,
          checkInDayMs,
          checkOutDayMs,
          ...(guests ? { guests } : {}),
        },
      },
    },
  }
}

const RUNNERS: Record<string, (request: SiteChatToolRequest) => Promise<SiteChatToolAnswer>> = {
  commerce_product_details: commerceProductDetails,
  commerce_propose_add_to_cart: commerceProposeAddToCart,
  commerce_stay_availability: commerceStayAvailability,
  commerce_propose_reservation: commerceProposeReservation,
}

export function runCommerceSiteChatTool(name: string, request: SiteChatToolRequest): Promise<SiteChatToolAnswer> {
  const run = RUNNERS[name]
  if (!run) return Promise.resolve({ text: 'That tool is not available.' })
  return run(request)
}
