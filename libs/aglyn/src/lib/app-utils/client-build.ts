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
 * A SITE STAFF BUILD FOR A CLIENT, ON ONE SCREEN (AGL-3958).
 *
 * At a booth or on a doorstep there is no laptop: staff create the client's
 * workspace with "Build for a client" on (AGL-3952), and land on one screen
 * that asks the business details once, records the domain the owner wants,
 * shows the photo link's QR (AGL-3957), starts the guided AI start with those
 * answers, and sends the owner the preview. This module is that screen's
 * vocabulary: what is asked, what an answer may be, and the intent the
 * hand-off carries into the owner's checkout.
 *
 * Pure: shapes, bounds and parsers, read by the screen, the staff route that
 * stores the record and the hand-off that reads its intent. No React, no
 * network.
 */

import type { OrgPlan, OrgSeatAddons } from '../foundation/definitions/org-billing.types'
import { normalizePhone } from '../foundation/definitions/contact.types'
import { SELF_SERVE_PLANS } from './plan-entitlements'

/** What staff ask the owner, once, and the guided start reads instead of asking again. */
export interface ClientBuildIntake {
  /** The business's name, as its header and footer will say it. */
  businessName: string
  /** What the business does, in a few words: the guided start's first answer. */
  whatTheyDo: string
  /** The towns or area it serves; empty when it serves no one place. */
  towns: string
  /** The owner's phone: the preview is texted here, and the site may show it. */
  phone: string
  /** The owner's email: the preview is emailed here, and the site may show it. */
  email: string
  /**
   * Opening hours as the owner says them, e.g. "Mon–Fri 8am–5pm". Said with
   * am or pm, they also fill the guided start's opening hours (AGL-3995).
   */
  hours: string
  /** The owner's own words about the business, in one box. */
  ownerWords: string
}

export type ClientBuildIntakeField = keyof ClientBuildIntake

/** The longest each answer may be, in characters. */
export const CLIENT_BUILD_LIMITS: Readonly<Record<ClientBuildIntakeField, number>> = {
  // The three the guided start passes on as its own inputs, which it bounds
  // at 120 (`AI_SITE_INPUT_MAX_CHARS`).
  businessName: 120,
  whatTheyDo: 120,
  towns: 120,
  phone: 32,
  email: 254,
  hours: 200,
  ownerWords: 1_500,
}

/** An intake with nothing typed: what the screen starts on. */
export const EMPTY_CLIENT_BUILD_INTAKE: ClientBuildIntake = {
  businessName: '',
  whatTheyDo: '',
  towns: '',
  phone: '',
  email: '',
  hours: '',
  ownerWords: '',
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

/**
 * Why each answer cannot be used, in a sentence shown beside it; an answer
 * that is fine has no entry. The name and what they do are required, since
 * the site cannot be named or planned without them; the phone and the email
 * are each optional, but the preview needs one of them to reach the owner.
 */
export function clientBuildIntakeErrors(
  intake: ClientBuildIntake,
): Partial<Record<ClientBuildIntakeField, string>> {
  const errors: Partial<Record<ClientBuildIntakeField, string>> = {}
  for (const field of Object.keys(CLIENT_BUILD_LIMITS) as ClientBuildIntakeField[]) {
    if (intake[field].trim().length > CLIENT_BUILD_LIMITS[field]) {
      errors[field] = `Keep this under ${CLIENT_BUILD_LIMITS[field].toLocaleString('en-US')} characters.`
    }
  }
  if (!intake.businessName.trim()) errors.businessName ??= 'Name the business.'
  if (!intake.whatTheyDo.trim()) errors.whatTheyDo ??= 'Say what the business does.'
  const phone = intake.phone.trim()
  const email = intake.email.trim()
  if (phone && !normalizePhone(phone)) errors.phone ??= 'Type a phone number with its area code.'
  if (email && !EMAIL_PATTERN.test(email)) errors.email ??= 'Type an email address like name@example.com.'
  if (!phone && !email) errors.phone ??= 'Add a phone or an email, so the owner gets the preview.'
  return errors
}

/**
 * An intake as the route admits it: every answer a trimmed string within its
 * bound, or the first reason it is not. Fields the body does not carry are
 * empty, never `undefined`, so the record always has the same shape.
 */
export function parseClientBuildIntake(raw: unknown): ClientBuildIntake | string {
  if (!raw || typeof raw !== 'object') return 'Missing the business details'
  const source = raw as Record<string, unknown>
  const intake = { ...EMPTY_CLIENT_BUILD_INTAKE }
  for (const field of Object.keys(CLIENT_BUILD_LIMITS) as ClientBuildIntakeField[]) {
    const value = source[field]
    if (value === undefined || value === null) continue
    if (typeof value !== 'string') return `${field} must be text`
    intake[field] = value.trim()
  }
  const errors = clientBuildIntakeErrors(intake)
  const first = Object.values(errors)[0]
  return first ?? intake
}

/** The owner's phone as a text goes to it, E.164, or `null` when there is none to text. */
export function clientBuildPhone(intake: Pick<ClientBuildIntake, 'phone'>): string | null {
  return normalizePhone(intake.phone)
}

// ── The domain ─────────────────────────────────────────────────────────────

/**
 * What the owner chose on the Domain step (Zach, 2026-10-19).
 *
 * - `free`: the site stays on its free address for now.
 * - `register`: a name the owner wants to buy. NOT bought here: it rides the
 *   bundle link, so the owner buys it on their own phone after they
 *   subscribe, with their own registrant details and their own tick on the
 *   registrar's terms.
 * - `own`: a domain the owner already has, which the hand-off and the Site
 *   Care intake connect (one-click DNS opens the owner's provider and needs
 *   their login, so staff do it with them, or hand them the records).
 */
export type ClientBuildDomain =
  | { choice: 'free' }
  | { choice: 'register'; name: string; firstYearUsd: number; renewalUsd: number }
  | { choice: 'own'; name: string }

/** A registrable name: labels of letters, digits and hyphens, and a TLD of letters. */
const DOMAIN_PATTERN = /^(?=.{3,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/

/**
 * A domain name as typed, normalized — lower case, no scheme, no `www.`, no
 * path — or `null` when it is not one. "I have example.com" is typed on a
 * phone, often as the address bar showed it.
 */
export function normalizeClientBuildDomainName(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const name = raw
    .trim()
    .toLowerCase()
    .replace(/^[a-z]+:\/\//, '')
    .replace(/^www\./, '')
    .replace(/[/?#].*$/, '')
    .replace(/\.$/, '')
  return DOMAIN_PATTERN.test(name) ? name : null
}

const isPrice = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 && value < 1_000_000

/** A Domain step answer as the route admits it, or the reason it is not one. */
export function parseClientBuildDomain(raw: unknown): ClientBuildDomain | string {
  if (!raw || typeof raw !== 'object') return 'Missing the domain choice'
  const source = raw as Record<string, unknown>
  if (source['choice'] === 'free') return { choice: 'free' }
  const name = normalizeClientBuildDomainName(source['name'])
  if (source['choice'] === 'own') {
    return name ? { choice: 'own', name } : 'Type the domain the owner has, like example.com'
  }
  if (source['choice'] === 'register') {
    if (!name) return 'Pick a domain from the search'
    if (!isPrice(source['firstYearUsd']) || !isPrice(source['renewalUsd'])) {
      return 'The domain needs its first-year and renewal prices'
    }
    return {
      choice: 'register',
      name,
      firstYearUsd: source['firstYearUsd'],
      renewalUsd: source['renewalUsd'],
    }
  }
  return 'Unknown domain choice'
}

/** "$12.99" for a whole-dollar-and-cents price. */
export function formatDomainUsd(amount: number): string {
  return `$${amount.toFixed(2)}`
}

/** "$12.99 the first year, then $18.99 a year": both prices together, always. */
export function domainPriceText(prices: { firstYearUsd: number; renewalUsd: number }): string {
  return prices.firstYearUsd === prices.renewalUsd
    ? `${formatDomainUsd(prices.firstYearUsd)} a year`
    : `${formatDomainUsd(prices.firstYearUsd)} the first year, then ${formatDomainUsd(prices.renewalUsd)} a year`
}

// ── The intent the hand-off carries ────────────────────────────────────────

/** Add-ons, by their `OrgSeatAddons` key, as Billing sells them. */
export type ClientBuildAddon = keyof OrgSeatAddons

/**
 * What the owner is asked to buy, as the build leaves it for the hand-off
 * (AGL-3955, AGL-3956): the plan, the add-ons, the interval, a coupon, and
 * the domain they picked. The hand-off dialog opens on it and the bundle
 * link preselects it, so the owner's checkout is one tap from paid.
 *
 * `domain` is a name to REGISTER, bought by the owner after they subscribe;
 * `existingDomain` is one they already hold, which is connected rather than
 * bought. At most one of the two is set.
 */
export interface ClientBuildIntent {
  plan: OrgPlan
  addons: ClientBuildAddon[]
  interval: 'month' | 'year'
  coupon?: string
  domain?: { name: string; firstYearUsd: number; renewalUsd: number }
  existingDomain?: string
}

/** Site Care rides every build for a client unless staff take it off (AGL-3954). */
export const CLIENT_BUILD_DEFAULT_ADDONS: readonly ClientBuildAddon[] = ['siteCare']

/** The plans a build may propose: every self-serve tier but Free. */
const INTENT_PLANS: readonly OrgPlan[] = SELF_SERVE_PLANS.filter((plan) => plan !== 'free')

/** The intent a build starts with: the plan the workspace was comped on, Site Care, monthly. */
export function clientBuildIntent(options: {
  plan: OrgPlan | null | undefined
  domain?: ClientBuildDomain | null
}): ClientBuildIntent {
  const plan = options.plan && INTENT_PLANS.includes(options.plan) ? options.plan : 'starter'
  const domain = options.domain
  return {
    plan,
    addons: [...CLIENT_BUILD_DEFAULT_ADDONS],
    interval: 'month',
    ...(domain?.choice === 'register'
      ? { domain: { name: domain.name, firstYearUsd: domain.firstYearUsd, renewalUsd: domain.renewalUsd } }
      : {}),
    ...(domain?.choice === 'own' ? { existingDomain: domain.name } : {}),
  }
}

/**
 * A stored intent, narrowed, or `null` when it is not one worth acting on.
 * What the hand-off reads: a plan this build cannot sell, an add-on it does
 * not know or a malformed domain reads as absent rather than as a checkout
 * for something that does not exist.
 */
export function readClientBuildIntent(raw: unknown): ClientBuildIntent | null {
  if (!raw || typeof raw !== 'object') return null
  const source = raw as Record<string, unknown>
  const plan = source['plan']
  if (typeof plan !== 'string' || !(INTENT_PLANS as readonly string[]).includes(plan)) return null
  const addons = Array.isArray(source['addons'])
    ? source['addons'].filter((addon): addon is ClientBuildAddon => typeof addon === 'string' && addon.length > 0)
    : []
  const interval = source['interval'] === 'year' ? 'year' : 'month'
  const coupon = typeof source['coupon'] === 'string' && source['coupon'].trim() ? source['coupon'].trim() : undefined
  const rawDomain = source['domain']
  const parsed =
    rawDomain && typeof rawDomain === 'object' ? parseClientBuildDomain({ ...rawDomain, choice: 'register' }) : null
  const domain = parsed && typeof parsed === 'object' && parsed.choice === 'register' ? parsed : null
  const existing = normalizeClientBuildDomainName(source['existingDomain'])
  return {
    plan: plan as OrgPlan,
    addons,
    interval,
    ...(coupon ? { coupon } : {}),
    ...(domain
      ? { domain: { name: domain.name, firstYearUsd: domain.firstYearUsd, renewalUsd: domain.renewalUsd } }
      : existing
        ? { existingDomain: existing }
        : {}),
  }
}

// ── The record ─────────────────────────────────────────────────────────────

/**
 * The build as it is stored, one per workspace, at
 * `orgs/{orgId}/clientBuild/{CLIENT_BUILD_DOC_ID}`: a subcollection the rules
 * open to no client, written and read only by `/api/admin/client-build`
 * (staff) through the Admin SDK. Not on the org document, which every
 * member reads: the owner's phone and email are staff's to hold until the
 * owner joins.
 */
export interface ClientBuildRecord {
  intake: ClientBuildIntake
  /** `null` until the Domain step is answered. */
  domain: ClientBuildDomain | null
  intent: ClientBuildIntent
  /** The site the build made, once it has. */
  hostId: string | null
  /** Its subdomain, which is what a console URL names a site by. */
  host: string | null
  /** The guided start's job, once it is started. */
  jobId: string | null
  /**
   * The starter site was given instead of a guided start (no AI on the
   * workspace, or staff chose it), so the build step is finished without a job.
   */
  starter: boolean
  /** When the preview was last sent to the owner, ms; `null` before. */
  previewSentAt: number | null
  updatedAt: number
  /** The staff uid that last wrote it. */
  updatedBy: string
}

/** The subcollection and document the record lives at under its org. */
export const CLIENT_BUILD_COLLECTION = 'clientBuild'
export const CLIENT_BUILD_DOC_ID = 'current'

/** The screen's steps, in order. */
export const CLIENT_BUILD_STEPS = ['details', 'domain', 'photos', 'build', 'send'] as const
export type ClientBuildStep = (typeof CLIENT_BUILD_STEPS)[number]

/**
 * Where a stored build resumes: the first step it has not finished. A phone
 * that reloads mid-build, or a second phone, opens where the first left off.
 */
export function clientBuildResumeStep(
  record: Pick<ClientBuildRecord, 'domain' | 'hostId' | 'jobId'> & { starter?: boolean } | null,
): ClientBuildStep {
  if (!record) return 'details'
  if (!record.domain) return 'domain'
  // The site exists before its photos are asked for, and the guided start
  // waits on them: until a job is started, or the starter site was given
  // instead, the build is at the photos.
  if (!record.hostId || (!record.jobId && !record.starter)) return 'photos'
  return 'send'
}

/**
 * The address the site is going to live at, as the owner is told it: the
 * domain they picked or already have, else the free address it is on.
 */
export function clientBuildSiteAddress(
  domain: ClientBuildDomain | null | undefined,
  liveUrl: string | null,
): string | null {
  if (domain && domain.choice !== 'free') return domain.name
  return liveUrl ? liveUrl.replace(/^https?:\/\//, '') : null
}

/**
 * The text the owner gets with their preview: short enough for one or two
 * segments, and naming who it is from, since it arrives from a number they
 * do not know. The email says the same at length, from the catalog.
 */
export function clientBuildPreviewText(options: {
  businessName: string
  previewUrl: string
  siteAddress: string | null
  productName: string
}): string {
  const name = options.businessName.trim() || 'your business'
  const address =
    options.siteAddress && options.siteAddress !== options.previewUrl.replace(/^https?:\/\//, '')
      ? ` It will live at ${options.siteAddress}.`
      : ''
  return `${options.productName}: the new website for ${name} is ready to look at: ${options.previewUrl}${address}`
}
