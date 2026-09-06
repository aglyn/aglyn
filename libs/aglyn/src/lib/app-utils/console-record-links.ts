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

import { buildRoute, Route } from './console-routes'
import type { ContactInteraction, ContactSource } from './contacts'

/**
 * Where the console's records live, for a surface that is not the one the
 * record belongs to (AGL-2622).
 *
 * ## Why these addresses are built here and not where they are used
 *
 * A CRM record is reached from six surfaces that are not the CRM — the
 * top-bar search, an Inbox row, a form's page, an order, a booking, a site
 * user — and a CRM timeline points back at four of them. Two of those
 * readers are the console APP, which the module boundaries forbid from
 * importing a feature plugin at all: a plugin reaches the app only through
 * the generated loader manifests, so the app cannot ask the CRM for its own
 * route builder. The CRM plugin's `crmRoutes(basePath)` stays the builder
 * inside the plugin family; this module is the same address spelled once
 * for the console side, in the shared library both may import, and the
 * plugin's builder is pinned against it by a spec so the two cannot drift.
 *
 * ## Why the arguments are the two route params and not a host document
 *
 * Every site console page is addressed by `/{orgSlug}/hosts/{host}/…`, and
 * both segments are already in the URL a surface is rendered on. Building
 * from them costs nothing; resolving them from a host id costs two document
 * reads (`hostIndex`, then the org) on every open of a card, to render a
 * link. `useConsoleHubPath` in the marketing plugin makes the same choice
 * for the same reason.
 */
export interface SiteConsoleContext {
  orgSlug: string
  host: string
}

/** The CRM's nav slug — the `[pluginSlug]` segment the shell resolves. */
export const CRM_CONSOLE_SLUG = 'crm'

/** The four record kinds a surface outside the CRM may name. */
export type CrmRecordKind = 'contact' | 'lead' | 'company' | 'deal'

/**
 * The hub section each kind's record lives under, which is also the list a
 * kind-only link lands on. Named here rather than in the plugin's section
 * registry so the console app can address a record without the plugin.
 */
export const CRM_RECORD_SECTIONS: Record<CrmRecordKind, string> = {
  contact: 'contacts',
  lead: 'leads',
  company: 'companies',
  deal: 'deals',
}

/** `/{orgSlug}/hosts/{host}/crm` — the CRM hub on the site being read. */
export function crmHubHref(context: SiteConsoleContext): string {
  return buildRoute(Route.HOST_PLUGIN, {
    orgSlug: context.orgSlug,
    host: context.host,
    pluginSlug: CRM_CONSOLE_SLUG,
  })
}

/** One section of the hub — the Leads list, the Deals board. */
export function crmSectionHref(
  context: SiteConsoleContext,
  section: string,
): string {
  return `${crmHubHref(context)}/${section}`
}

/**
 * One record's own page. The id is URL-encoded because a Firestore id is
 * opaque — the console mints its own, but an import or an API caller may
 * not, and a slash in an id would otherwise read as a further segment.
 */
export function crmRecordHref(
  context: SiteConsoleContext,
  kind: CrmRecordKind,
  id: string,
): string {
  return `${crmSectionHref(context, CRM_RECORD_SECTIONS[kind])}/${encodeURIComponent(id)}`
}

/**
 * The query key the Contacts list reads to OPEN the one person with an
 * address (AGL-2612). A surface that holds only an email — an order, a
 * booking, a site user — links to the list with this key, the list filters
 * on the address and moves on to the record when exactly one matches. The
 * plugin re-exports this constant as `CONTACTS_LIST_EMAIL_PARAM` so its
 * parser and the console's builders read one string.
 */
export const CRM_CONTACTS_EMAIL_PARAM = 'email'

/** The Contacts list asked to open the person with this address. */
export function crmContactByEmailHref(
  context: SiteConsoleContext,
  email: string,
): string {
  return `${crmSectionHref(context, CRM_RECORD_SECTIONS.contact)}?${new URLSearchParams(
    { [CRM_CONTACTS_EMAIL_PARAM]: email },
  ).toString()}`
}

/**
 * The query keys a site record page reads on arrival, so a CRM timeline can
 * open the submission or the order it names rather than the list it sits
 * in. Each page parses its own key from `useSearchParams`; the CRM writes
 * them through `siteRecordLinks`, and the constant is shared so neither
 * side can misspell the other.
 */
export const INBOX_SUBMISSION_PARAM = 'submission'
export const ORDERS_ORDER_PARAM = 'order'
/**
 * The orders list narrowed to one buyer. The same word as the CRM's own
 * email key, deliberately: a reader who edits one URL into the other is
 * not surprised.
 */
export const ORDERS_CUSTOMER_PARAM = 'email'

/**
 * Where the site records a contact's captured history names are read
 * (AGL-2622): the Inbox for a submission, the Orders section of the
 * Products hub for an order, the Bookings page and the Users page for the
 * rest. Built from the route table so a section that moves is found here
 * by its route name rather than by searching for a string.
 */
export function siteRecordLinks(context: SiteConsoleContext) {
  const { orgSlug, host } = context
  const inbox = `${buildRoute(Route.HOST_INBOX, { orgSlug, host })}/submissions`
  const orders = `${buildRoute(Route.HOST_PRODUCTS, { orgSlug, host })}/orders`
  const withQuery = (base: string, key: string, value: string) =>
    `${base}?${new URLSearchParams({ [key]: value }).toString()}`
  return {
    /** The Inbox's Submissions tab, with the reader open on one submission. */
    submission: (submissionId: string) =>
      withQuery(inbox, INBOX_SUBMISSION_PARAM, submissionId),
    /** The Orders list. */
    orders: () => orders,
    /** The Orders list with one order's dialog open. */
    order: (orderId: string) => withQuery(orders, ORDERS_ORDER_PARAM, orderId),
    /** The Orders list narrowed to one buyer's address. */
    ordersByCustomer: (email: string) =>
      withQuery(orders, ORDERS_CUSTOMER_PARAM, email),
    /** The Bookings page; a booking has no page of its own. */
    bookings: () => buildRoute(Route.HOST_BOOKINGS, { orgSlug, host }),
    /** The Users page, where a site account's row and drawer are. */
    members: () => buildRoute(Route.HOST_USERS, { orgSlug, host }),
  }
}

export type SiteRecordLinks = ReturnType<typeof siteRecordLinks>

/**
 * What the link on a captured timeline entry says. Only the doors that
 * leave a record the console can open are named; a newsletter opt-in, an
 * API create, an import or a by-hand add leave nothing to open, so they
 * carry no link and no label.
 */
export const INTERACTION_LINK_LABELS: Partial<Record<ContactSource, string>> = {
  form: 'Open submission',
  order: 'Open order',
  booking: 'Open bookings',
  member: 'Open site users',
}

/**
 * The console page a captured interaction points back at, or `null` when
 * the door left nothing to open.
 *
 * A submission and an order are addressed by the `refId` the capture door
 * stamped — `formSubmissions/{id}`, `orders/{id}` — and an interaction that
 * predates the stamp lands on nothing rather than on a list that would read
 * as "the record is gone". A booking and a member sign-up land on their
 * pages, which list them; neither page addresses one row.
 */
export function contactInteractionHref(
  interaction: Pick<ContactInteraction, 'type' | 'refId'>,
  context: SiteConsoleContext,
): string | null {
  const links = siteRecordLinks(context)
  switch (interaction.type) {
    case 'form':
      return interaction.refId ? links.submission(interaction.refId) : null
    case 'order':
      return interaction.refId ? links.order(interaction.refId) : null
    case 'booking':
      return links.bookings()
    case 'member':
      return links.members()
    default:
      return null
  }
}
