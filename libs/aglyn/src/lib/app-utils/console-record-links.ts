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

/**
 * Where the CRM's records live, for the console's top-bar search (AGL-2622).
 *
 * ## What is left here, and why
 *
 * Every other surface asks the record-route registry
 * (`plugin-manager/plugin-record-routes`) for a record's address, which the
 * plugin that owns the kind publishes — a contact, an order, a submission, a
 * booking. The top-bar search still builds the CRM's four record kinds itself
 * until its rows come from the plugins that keep them; this is that copy,
 * pinned against the CRM plugin's own `crmRoutes(basePath)` by its spec so
 * the two cannot drift.
 *
 * ## Why the arguments are the two route params and not a host document
 *
 * Every site console page is addressed by `/{orgSlug}/hosts/{host}/…`, and
 * both segments are already in the URL a surface is rendered on. Building
 * from them costs nothing; resolving them from a host id costs two document
 * reads (`hostIndex`, then the org) on every open of a card, to render a
 * link.
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
 * `/{orgSlug}/crm` — the ORGANIZATION-level CRM hub (AGL-2630), the same
 * sections mounted with no site.
 *
 * The org-level twin of {@link crmHubHref}, and separate from it because the
 * two take different arguments: a site address needs the subdomain, and a
 * surface standing at the org hub has none to give. A caller that faked one
 * would put a site's name on a page about all of them.
 */
export function crmOrgHubHref(orgSlug: string): string {
  return buildRoute(Route.ORG_CRM, { orgSlug })
}

/** One section of the org-level hub — the cross-site Deals board. */
export function crmOrgSectionHref(orgSlug: string, section: string): string {
  return `${crmOrgHubHref(orgSlug)}/${section}`
}

/**
 * One record's page at the org level.
 *
 * A LEAD IS NO LONGER EXCLUDED (AGL-3275). It was, by the type rather than a
 * runtime check, because a lead's id is a person key — the same on every site
 * that met the person — while `hosts/{hostId}/leads` was host-scoped by path,
 * so two sites held two documents carrying one id and an org-level address
 * had to name the site to tell them apart. One org collection makes the
 * person key unambiguous, so a lead addresses like every other record.
 */
export function crmOrgRecordHref(
  orgSlug: string,
  kind: CrmRecordKind,
  id: string,
): string {
  return `${crmOrgSectionHref(orgSlug, CRM_RECORD_SECTIONS[kind])}/${encodeURIComponent(id)}`
}

// `crmOrgLeadHref` is gone with the host-path fallback (AGL-3277). It took a
// site it had already stopped using; `crmOrgRecordHref(orgSlug, 'lead', id)`
// is the whole of what it did.
