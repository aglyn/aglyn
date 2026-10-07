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
 * Feature-plugin pattern (AGL-277, AGL-395). Each feature ships as one lib
 * under `libs/plugins/{feature}` (moved out of the old `.../ui/` nesting)
 * that owns both halves and never merges into `plugins-mui` (which stays
 * pure component/theme definitions):
 *
 *  - UI half → besigner/host components. Builds its bundle with
 *    `defineUiFeatureBundle` (which depends on the mui bundle so
 *    primitives/theming resolve first) and registers it with
 *    `Aglyn.plugins.addDependency`, exactly like the mui bundle itself.
 *    Registered per-editor via `register{Feature}Plugin()`.
 *  - Console half → a `ConsoleExtension` registered with
 *    `registerConsoleExtension` via a separate `register{Feature}Console()`
 *    entry point (so app-load registration pulls no canvas code). The
 *    console shell renders nav items + their pages, dashboard cards, and
 *    settings sections from the registry, gated by the feature flag.
 *
 * This module is pure (no registry singletons) per app-utils layering;
 * the plugin libs close the loop by passing `Aglyn.components` in.
 * Reference implementation: events-calendar (AGL-313/394); commerce and
 * email follow the same shape (AGL-290/346, relocated in AGL-395).
 */

import { runInAction } from 'mobx'
import type { OrgPermissions } from '../app-utils/org-permissions'
import type { ReleaseFlagKey } from '../app-utils/release-flags'
import type { SeoAuditReport } from '../app-utils/seo-audit'
import type { SeoListingFieldKey } from '../app-utils/seo-listing-fields'
import type { AglynOrgBilling, OrgFeatureFlags } from '../foundation'
import type {
  ComponentSchema,
  MdiIconProps,
  PresetSchema,
} from '../types/nodes'
import type { Plugin, PluginId } from './plugin-manager'
import type { HostThemeSource } from '../app-utils/site-theme'
import type { HostTheme, HostThemeScheme } from '@aglyn/shared-data-types'
import type { ComponentType } from 'react'
export type {
  ConsoleImportMappingZoneProps,
  ConsoleRecordEmailZoneProps,
  ConsoleRecordInsightsZoneProps,
} from './record-zone-props'

/** The mui bundle id every UI feature bundle depends on. */
export const MUI_BUNDLE_ID: PluginId = 'mui'

export interface FeatureBundleEntry {
  component: any
  schema: ComponentSchema<any>
  presets?: PresetSchema[]
}

/** The slice of ComponentManager a feature bundle needs (structural). */
export interface ComponentRegistrar {
  registerComponent(component: any, schema: ComponentSchema<any>): void
  registerPreset(presets: PresetSchema[]): void
  unregisterComponent(componentId: string): void
  unregisterPreset(presetIds: string[]): void
}

export interface UiFeatureBundleOptions {
  /** Stable bundle id — persisted as `pluginId` in screen docs; never rename. */
  bundleId: PluginId
  displayName: string
  description?: string
  icon?: MdiIconProps
  /** Extra bundle ids this feature needs beyond mui. */
  dependsOn?: PluginId[]
  components: FeatureBundleEntry[]
}

/**
 * UI half of the pattern: a plugin-registry bundle whose load/destroy
 * register the feature's components + presets against the given
 * registrar (`Aglyn.components` in apps), declared as depending on the
 * mui bundle so the registry loads mui first.
 */
export function defineUiFeatureBundle(
  options: UiFeatureBundleOptions,
  registrar: ComponentRegistrar,
): Plugin {
  const dependencies: Record<PluginId, true> = { [MUI_BUNDLE_ID]: true }
  for (const id of options.dependsOn ?? []) dependencies[id] = true
  return {
    $id: options.bundleId,
    displayName: options.displayName,
    title: options.displayName,
    description: options.description,
    icon: options.icon,
    dependencies,
    load(): void {
      // One mobx transaction per bundle (AGL-371): observers (component
      // drawer, canvas) re-render once instead of once per registration.
      runInAction(() => {
        for (const entry of options.components) {
          registrar.registerComponent(entry.component, entry.schema)
        }
        for (const entry of options.components) {
          if (entry.presets?.length) registrar.registerPreset(entry.presets)
        }
      })
    },
    destroy(): void {
      runInAction(() => {
        for (const entry of options.components) {
          if (entry.presets?.length) {
            registrar.unregisterPreset(
              entry.presets.map((preset) => preset.$id),
            )
          }
        }
        for (const entry of options.components) {
          registrar.unregisterComponent(entry.schema.$id)
        }
      })
    },
  }
}

/**
 * One of the organization's sites, as the shell hands them to a surface
 * mounted at the ORGANIZATION level (AGL-2630).
 *
 * The three facts a cross-site surface needs and a record never carries: a
 * record holds a host DOCUMENT ID, a console URL under `/hosts/[host]` takes
 * the SUBDOMAIN, and a person reads the NAME. `subdomain` is null for a site
 * whose document did not answer — such a site is still named (the
 * relationship is real) and never linked (the route would not exist).
 */
export interface ConsolePluginOrgHost {
  id: string
  name: string
  subdomain: string | null
}

/**
 * The organization a surface is mounted under when it is mounted at the
 * org level rather than under a site (AGL-2630).
 *
 * The CRM exists at two levels: the site hub, where `hostId` names the site
 * and every read is scoped to it, and `/[orgSlug]/crm`, where an org-wide
 * member sees every site's records at once. At the org level there is no
 * site, so the shell hands the org's own site list instead — the pickers a
 * create needs (a record is always captured BY a site) and the names a
 * cross-site fact is shown under. `hostsReady` separates "no sites" from
 * "not yet".
 */
export interface ConsolePluginOrgMount {
  orgId: string
  /**
   * The organization's URL slug (AGL-3080) — the segment its console pages
   * hang under, and what a surface needs to link to one of its siblings.
   *
   * Carried because plugins were reconstructing it: from `hostsPath` by
   * splitting a string, or by resolving a site's org through an async lookup
   * that can come back empty and leave a link unbuilt (AGL-867). The shell
   * has it synchronously; every plugin paying for it again, differently, is
   * the cost of not handing it over.
   */
  orgSlug: string
  hosts: readonly ConsolePluginOrgHost[]
  hostsReady: boolean
  /**
   * The console path every site's own hub hangs beneath — `/[orgSlug]/hosts`
   * — so a cross-site fact can link a person into the site that holds them:
   * a site's CRM is `${hostsPath}/${subdomain}/crm`. A path rather than a
   * builder because the mount is data the shell hands over and a plugin
   * cannot import the console's route table.
   */
  hostsPath: string
  /**
   * Where this organization manages its PLAN — the console's billing page
   * for the org (AGL-3080).
   *
   * Here for the same reason `hostsPath` is: a plugin cannot import the
   * console's route table, and a surface that has to say "on a paid plan the
   * cut is lower" is useless without somewhere to send the person who just
   * read it. The shell's own upgrade notice covers an ENTITLEMENT refusal,
   * where the surface never renders; this covers the case the surface renders
   * fine and the plan is still the answer — a marketplace publisher seeing
   * the free-plan fee on a listing they are about to price.
   *
   * OPTIONAL, and a plugin must branch on it rather than assume it: a
   * deployment that bills nobody has no such page, and a self-hoster who
   * removed it should not get a plugin's link into a 404. The shell's own
   * upgrade notice makes the same allowance. `resolveOrgMount` supplies it
   * for every mount this console builds.
   *
   * A plugin renders a link to it or does not, and never parses it.
   */
  billingPath?: string
}

/**
 * Props every plugin-contributed console page receives from the shell's
 * generic host route. The shell owns auth + chrome + flag gating and
 * passes the resolved host and entitlement state in, so plugin pages stay
 * free of console-app hooks.
 */
export interface ConsolePluginPageProps {
  /**
   * The site this surface is mounted under — or `null` when it is mounted at
   * the ORGANIZATION level, where there is no site and {@link orgMount} says
   * which org (AGL-2630). Two things mount there: the CRM's own org route,
   * and every {@link ConsoleExtension.orgNavItems} surface through the
   * generic org route (AGL-2974). A surface reached through a site route
   * always receives a string.
   */
  hostId: string | null
  /** Present only at an org-level mount — see {@link ConsolePluginOrgMount}. */
  orgMount?: ConsolePluginOrgMount
  /**
   * Every workspace the SIGNED-IN PERSON belongs to, as the org switcher
   * already names them (AGL-3080) — not the mounted org's siblings, and
   * nothing about what any of them contain.
   *
   * For a surface whose subject crosses workspaces. The marketplace's
   * licences panel is the case: a purchase licenses one organization, so
   * "I bought this once — which workspace did the licence land in?" is a
   * question about the BUYER, and the answer is a name the reader already
   * sees in the switcher. Resolving it from ids would be a read per row of
   * documents the shell is already holding.
   *
   * Absent when the shell has not resolved them, and a surface must name the
   * id rather than wait: this is a label, and a row with a raw id in it is
   * worse than nothing only if the row does not appear at all.
   */
  viewerOrgs?: readonly { id: string; name: string }[]
  /** True when the org holds the extension's `featureFlag` entitlement. */
  entitled: boolean
  /**
   * The absolute console path this surface is mounted at — the nav item's
   * `href` under the active org and site, e.g. `/acme/hosts/shop/products`
   * (AGL-2501).
   *
   * A plugin page is handed a host DOC ID and nothing else, so building a
   * link to itself meant resolving the org slug and subdomain from Firestore
   * — two `getDoc`s that answer `null` on first paint, which for a section
   * rail means drawing it without hrefs. The shell already knows this string
   * synchronously; the alternative is paying for it again, later, per page.
   */
  basePath?: string
  /**
   * The nav item's declared {@link ConsoleNavItem.sections}, resolved: an
   * absolute `href` per section, and the release-flag verdict already applied
   * to `visible` (AGL-2501).
   *
   * The plugin DECLARES sections; the shell RESOLVES them. Release flags live
   * in `scope:app` and a `scope:lib` plugin may not import the hooks that read
   * them, so a page that filtered its own rail could only do it by guessing —
   * and a rail offering a link into the shell's own "coming soon" notice is
   * the guess going wrong. Feed this straight to `HubSections`.
   */
  sections?: readonly ResolvedConsoleNavSection[]
  /**
   * The id of the section the URL names, or undefined on the nav item's own
   * href (AGL-2501).
   *
   * Always one of the declared `sections` — the shell 404s an id it does not
   * recognize rather than passing it down, so a page may switch on this
   * without a fallback branch for a section it does not have.
   */
  section?: string
  /**
   * Path segments beneath `basePath`, `[]` on the nav item's own href
   * (AGL-2501). `segments[0]` is `section`; anything after it is the section's
   * own, so a section can own deeper routes (`…/orders/ord_123`) without a
   * further registry change.
   */
  segments?: readonly string[]
  /**
   * The ORG billing doc (`orgs/{orgId}`) the shell already loaded to
   * compute `entitled` (prop renamed from `tenant` in AGL-444). Passed
   * through so a plugin page can run its own `checkEntitlement`/
   * `checkQuota` (e.g. per-plan service limits) without reaching for the
   * console-app org/session hooks.
   */
  org?: Partial<AglynOrgBilling>
  /**
   * The signed-in user's resolved org permissions (AGL-395), passed through
   * so a plugin page can gate actions (e.g. install/publish) without the
   * console-app session/permission hooks.
   */
  /**
   * Widened past the legacy six (AGL-2474): plugin-declared keys such as
   * commerce's `managePos` are resolved into the same map, and typing this
   * `Partial<OrgPermissions>` meant a plugin could not read its OWN
   * permission without a cast — the declared key was not assignable.
   */
  permissions?: Partial<OrgPermissions> & Record<string, boolean | undefined>
  /**
   * The verdict for the release flag that governs this surface (AGL-1662),
   * resolved by the shell from the nav item's `navTabId` — the same flag
   * `FeatureGate` applies around the page body.
   *
   * `FeatureGate` admits staff with the flag OFF, so a plugin page can be
   * looking at an org that does not have the feature and is not being
   * billed for it. Anything the page says about MONEY has to follow the
   * flag rather than the viewer, and this is how a plugin page gets that
   * answer without reaching for the console-app release-flag hooks (which
   * live in `scope:app` and are off-limits to a `scope:lib` plugin).
   */
  releaseFlag?: {
    /**
     * The rollout verdict for this ORG — staff bypass deliberately NOT
     * applied. `visible` is what decides who sees a page; this is what
     * decides what the invoice carries, and staff opening a page must not
     * put a line on a customer's bill.
     */
    released: boolean
    /**
     * True once the flag verdict has settled. Release flags are default-off
     * before Remote Config activation, so an ungated claim asserts the
     * withheld case for one paint on an org that may well be billed.
     */
    ready: boolean
  }
  /**
   * What the viewer's role on THIS SITE lets them do, for a surface that
   * publishes.
   *
   * The `author` host role edits content and may not make it live; that is
   * enforced in the Firestore rules and by the promotion routes, and the
   * console's job is to say no with a reason rather than let a click come
   * back as a bare `permission-denied`. Resolving it needs the org member
   * document and the host-access predicate over it, which the shell already
   * reaches for — a plugin cannot, for the same reason it cannot read a
   * release flag.
   *
   * `loaded` separates "no" from "not yet", so a surface disables with a
   * reason rather than hiding a control that is about to be allowed. Read it
   * the safe way round: `canPublish` is false until the read lands.
   */
  hostRole?: {
    canPublish: boolean
    loaded: boolean
  }
}

export type ConsolePluginPage = ComponentType<ConsolePluginPageProps>

/**
 * One routed section of a plugin console page (AGL-2501).
 *
 * A section is a real URL beneath the nav item's `href`, not a panel: it is
 * linkable, the back button walks sections, and the page mounts the one being
 * read. That last part is the reason this exists — a six-panel hub subscribes
 * every panel's queries on load, and the reader is looking at one.
 */
export interface ConsoleNavSection {
  /**
   * URL segment beneath the nav item's `href`, and the id the shell hands the
   * page as `section`. Appears in links people keep — treat it as persisted.
   */
  id: string
  label: string
  /**
   * Release-flag nav-tab id gating THIS section, when it ships on a different
   * schedule than the surface around it. Omit to inherit the nav item's gate,
   * which is the common case.
   *
   * Declaring one NARROWS, never widens: the nav item's own gate is applied
   * outside this one, so a section of a flagged-off surface stays unreachable
   * whatever it declares. A section gated by its own flag is refused on a deep
   * link exactly as it is hidden from the rail — one verdict, both places.
   */
  navTabId?: string
  /**
   * Entitlement flag gating THIS section, when the org's plan may include
   * the surface and not the whole of it (AGL-2611). Omit to inherit the
   * extension's `featureFlag`, which is the common case.
   *
   * Composes by AND with the extension's, the way `navTabId` composes with
   * the nav item's release gate: the shell answers the extension's flag
   * first and this one inside it, so a section can only ever be NARROWER
   * than the surface holding it. A section this refuses is resolved
   * `locked` for the rail and refused on a deep link with the shell's own
   * upgrade notice — one verdict, both places — and the page body never
   * mounts, which is the whole of the shell's promise about entitlements.
   *
   * The case it exists for is a hub whose first section ships on every
   * plan and whose others do not: the CRM's contacts list is on Free, and
   * the sales suite built on that list starts at Starter.
   */
  featureFlag?: keyof OrgFeatureFlags
  /**
   * Permission key gating THIS section, when the surface is open to every
   * member and part of it is not (AGL-3080). Omit to inherit the
   * extension's and the nav item's, which is the common case.
   *
   * The third gate, composed the way the other two are: ANDed with what the
   * extension and the nav item already require, so a section can only ever
   * be narrower than the surface holding it. A section this refuses is not
   * drawn in the rail at all — unlike a `featureFlag` refusal, which draws
   * locked and links to the notice that sells it, because a permission is
   * not something the reader can buy — and a deep link to it is answered
   * with the shell's refusal instead of its body. One verdict, both places.
   *
   * ⚠️ NOT a replacement for the server's rule. The rules and the plugin's
   * own handlers enforce this regardless of what renders; this keeps a
   * reader from being offered a page that is about to refuse them.
   *
   * The case it exists for is a hub most of a workspace uses and whose
   * seller half only a publisher does: the Marketplace's browse, installed
   * and licences sections are every member's, and listings, upload, sales
   * and payouts read the organization's revenue.
   */
  permission?: string
  /**
   * Query keys that land a BARE hub URL on this section instead of on the
   * first one the reader may open (AGL-3080).
   *
   * The case it exists for is a return URL held by somebody else. Stripe
   * bakes `?connect=` into account-onboarding links and `?purchase=` into
   * checkout sessions, so a seller part-way through onboarding is carrying
   * one right now — in a third party's records, not ours, and unfixable from
   * this side once it lands somewhere that means nothing to them. A seller
   * coming back from Connect wants Payouts; a buyer coming back from
   * checkout wants what they now own.
   *
   * The key's VALUE is not read, only its presence: these are markers, and a
   * marker nothing routes on still survives the hop, which is what makes it
   * safe for anyone to add one. The gates still apply — a section this
   * claims but the reader may not open is not landed on, and the bare rule
   * takes over.
   */
  landsOnQuery?: readonly string[]
}

/** A {@link ConsoleNavSection} with the shell's answers filled in. */
export interface ResolvedConsoleNavSection {
  id: string
  label: string
  /** Absolute console path — `${basePath}/${id}`. */
  href: string
  /** False when this section's release flag hides it from this viewer. */
  visible: boolean
  /**
   * True when the org's SETTLED plan does not carry the section's
   * `featureFlag` (AGL-2611). The rail draws it locked and still links it —
   * the notice behind the link is the way to buy it — and the shell refuses
   * the body. Never true while the org read is pending: an unsettled plan
   * is not a refusal, and a lock that appeared for one paint on a paying
   * workspace would be the AGL-1380 defect in a new place.
   */
  locked?: boolean
  /**
   * True when this section's own `permission` refuses this reader
   * (AGL-3080) — the reason it is not `visible`, kept apart from the
   * release flag's so a deep link is answered with the refusal that
   * applies rather than with "coming soon". Never true while the member
   * read is pending: the permission map answers as an admin's until it
   * lands, so an unsettled read is neither a grant nor a refusal.
   */
  refused?: boolean
  /** The section's declared {@link ConsoleNavSection.landsOnQuery}, carried
   * through so the shell's landing rule can read it (AGL-3080). */
  landsOnQuery?: readonly string[]
}

export interface ConsoleNavItem {
  label: string
  /**
   * Host-relative console route (e.g. '/events'). The shell mounts it
   * under the active host ('/[hostId]/events') via its generic plugin
   * route, so the same string keys both the nav link and the page.
   */
  href: string
  icon?: MdiIconProps
  /**
   * Release-flag nav-tab id (e.g. 'nav-tab-events'). Lets the shell apply
   * the same staff-preview gating hardcoded tabs get; omit for always-on.
   */
  navTabId?: string
  /**
   * The permission THIS surface requires, when it is narrower than the
   * extension's own {@link ConsoleExtension.permission}.
   *
   * Declaring one NARROWS, never widens: the extension's requirement is
   * applied alongside this one and both must be held, so a surface cannot
   * escape its extension's gate by naming a key its reader happens to have.
   * The composition is the release-flag one a nav item and its section
   * already have, for the same reason.
   *
   * The granularity exists because one extension can register surfaces with
   * genuinely different answers — a catalog anyone who edits the site may
   * open, beside a register that takes money.
   */
  permission?: string
  /**
   * Page body rendered by the shell's generic host route. When present,
   * the plugin owns the whole surface — no core page file needed.
   */
  Component?: ConsolePluginPage
  /**
   * Routed sections of this page (AGL-2501). Each becomes a URL at
   * `${href}/${section.id}`, and the shell tells the page which one it is on.
   *
   * Optional, and omitting it is not a lesser option — it means the surface is
   * ONE page, which is what every plugin surface was before this existed and
   * what most should stay. A nav item without sections resolves exactly as it
   * always has: its own href and nothing beneath it, so a path under it is a
   * 404 rather than this page rendered again.
   */
  sections?: readonly ConsoleNavSection[]
  /**
   * Whether this nav item claims every path beneath its own href, with no
   * declared section naming them.
   *
   * The case is a surface whose deeper URLs are ENTITIES rather than
   * sections: `/forms` is a list, `/forms/{formId}` is one of its rows, and
   * the set of ids is a property of the workspace's data, so no static
   * `sections` list could enumerate them. Without this a nav item matches its
   * own href and nothing else, and every row's page is a 404.
   *
   * The trade is deliberate and is why it must be asked for. A surface that
   * owns its subtree can no longer distinguish a typo'd path from an entity
   * id — `/forms/bogus` reaches the page rather than the shell's 404 — so it
   * takes on the duty of saying "no such thing" itself, which a list-detail
   * surface has to be able to do anyway for an id that was deleted while a
   * link to it was still in someone's inbox.
   *
   * Sections win where both are declared: an id the `sections` list names is
   * resolved as a section, and this only widens what happens when none
   * matches.
   */
  ownsSubtree?: boolean
  /**
   * The browser tab's noun on a RECORD beneath a surface that
   * {@link ownsSubtree} (AGL-3596), where the surface's `label` would stand
   * otherwise: `AI jobs` lists a site's jobs at `/ai-jobs`, and one job's
   * page at `/ai-jobs/{jobId}` is `Building your site`.
   *
   * The tab title is built on the server from the URL alone, which never
   * reads the record, so this is one fixed string per surface — the noun for
   * what a record's page is, not the record's name. It is read from the
   * plugin's source by `tools/scripts/generate-plugin-manifests.mjs` into the
   * titles manifest, and so must be a string literal beside a literal `href`.
   */
  recordTitle?: string
  /**
   * A page with an address and no tab (AGL-3594): served at its `href` like
   * any nav item, and left off the site's tab strip. For a surface a person
   * is SENT to — the page a flow lands on, the page a notification opens —
   * rather than one they browse to; the gates and the matching are the same.
   */
  unlisted?: boolean
  /**
   * Hrefs this nav item answered to before it moved (AGL-2595).
   *
   * A console path is something people keep — a bookmark, a docs link, an
   * email from the console itself — and a nav item that changes its `href`
   * would otherwise turn every one of them into the shell's "not available"
   * notice. Matching here is identical to matching on `href` (the same
   * sections, the same subtree rule), and the resolved page carries
   * `legacy: true` so the shell can replace the address with the current one
   * rather than leave a moved page living at two.
   */
  legacyHrefs?: readonly string[]
  /**
   * Where this item's tab sits among the plugin tabs of its strip
   * (AGL-3294): lower first, absent is 0, and a tie keeps registration
   * order.
   *
   * Registration order is otherwise the order, and it is not a tab's to
   * choose: it follows the plugin registry, which also orders the staff
   * strip, the providers and every widget zone the plugin fills — so moving
   * one tab by moving its plugin would move everything else it registers.
   * This moves the tab and nothing else. The shell's own tabs are not in the
   * comparison; the plugin tabs sit as one block between them.
   */
  tabOrder?: number
  /**
   * Dashboard header for the plugin page (title + icon), and the docs topic
   * its help `?` explains.
   *
   * `docsTopic` is a plain string rather than the console's
   * `DocsHelpTopicKey` because that registry lives in `apps/console` and a
   * lib cannot import from an app. The console validates it and falls back
   * to the marketplace topic when it does not resolve — which is not just
   * defensive: a third-party plugin can name any string, and the alternative
   * to a fallback is a help button that throws on hover (AGL-1074).
   *
   * Every surface mounted by the shell's generic plugin route shares one
   * `help=` prop, so a surface that omits this is not "help-less" — it
   * inherits Plugins & Marketplace, which reads as if it were its own.
   *
   * `docsAnchor` deep-links the help to one heading of that topic's page
   * (`#at-the-organization-level`), for a surface whose page explains this
   * mount under a heading of its own. It is validated the same way: an
   * anchor the topic's page does not carry is dropped, and the help opens the
   * top of the page.
   */
  header?: {
    title: string
    icon?: MdiIconProps
    docsTopic?: string
    docsAnchor?: string
  }
}

export interface ConsoleDashboardCard {
  /** Card registry key the dashboard resolves to a component. */
  cardId: string
  title: string
}

export interface ConsoleSettingsSection {
  sectionId: string
  title: string
  /** Rendered inside the org/host settings surface when present (AGL-419). */
  Component?: ComponentType<ConsolePluginPageProps>
}

/**
 * The injection-zone catalog (AGL-433, Strapi injection-zone parity):
 * every named slot the console shell renders through `PluginWidgetSlot`,
 * with what the slot receives. `slot` stays an open string so apps can
 * add custom zones without a core release; these are the guaranteed ones.
 */
export const CONSOLE_WIDGET_SLOTS = {
  /** Host dashboard + screen view activity column. Props: hostId. */
  hostActivity: 'hostActivity',
  /**
   * The host dashboard's glance row — one card per capability the site
   * actually has. Props: hostId.
   *
   * The dashboard's own cards used to be imported by the page, which made
   * enablement a decision nobody was making: `New site users` rendered on a
   * site that has never turned member accounts on, and `Last campaign` on a
   * workspace with the email plugin switched off. A card that answers a
   * question about a capability belongs to the capability, so it registers
   * here and the shell's entitlement + enablement gate decides.
   */
  hostDashboard: 'hostDashboard',
  /**
   * The organization's sites page, above the site grid (AGL-2636): the
   * org-level twin of `hostDashboard`, for a card that totals the
   * organization rather than one site. Props: `hostId` (always `null`),
   * `orgMount` (the org and its sites — the {@link ConsolePluginOrgMount}
   * the org-level hub page hands its plugin page), `basePath` (that hub's
   * own path, `/[orgSlug]/crm`, for the links a widget builds when there is
   * no site to derive them from).
   *
   * Every widget here reads ACROSS the host boundary — an org-wide total
   * carries no scope clause — which is the one read a site collaborator may
   * never make, so the page gates the whole row on the org hub's own access
   * verdict before any widget mounts, and renders nothing at all (no empty
   * row, no heading) when no widget survives the gates.
   */
  orgDashboard: 'orgDashboard',
  /** Host dashboard commerce summary. Props: hostId, org. */
  commerceGlance: 'commerceGlance',
  /** Org Data page body. Props: orgId, org. */
  orgData: 'orgData',
  /** Besigner functions (ƒx) panel. Props: hostId. */
  besignerFunctions: 'besignerFunctions',
  /**
   * Wherever a console page offers to publish something it holds (AGL-3080).
   * Props: {@link ConsoleArtifactPublishZoneProps}.
   *
   * A layouts page, a components page and the org publish panel each held a
   * dialog that posted to `marketplace/publish-layout` and read the
   * marketplace's price floor. The console knows it has a layout; where a
   * layout can be PUBLISHED, what a listing costs at the least, and what to
   * call the thing in the copy all belong to whatever sells it.
   *
   * ── The page says what it has, never where it goes ───────────────────────
   *
   * The zone is handed a {@link ConsolePublishableArtifact} in the console's
   * own vocabulary — a kind, the site or org it belongs to, the document id —
   * and the widget decides the endpoint, the noun and the form. A kind the
   * widget does not publish is one it draws nothing for, which is the same
   * answer as no widget at all.
   *
   * ── An offer with nowhere to go must not be made ─────────────────────────
   *
   * The control that OPENS this — a menu item, a button — belongs to the page
   * and is not a widget, because it is one entry of a list the page builds.
   * So a page offering it asks `useSlotWidgets` whether this zone has a
   * widget at all and leaves the entry out when it does not. Drawing it
   * anyway would be a menu item that opens nothing on a workspace with no
   * marketplace.
   */
  hostArtifactPublish: 'hostArtifactPublish',
  /*
   * `marketplaceListing`, `marketplaceCapability`, `orgMarketplace` and
   * `orgAddons` were here until AGL-3080, and are gone rather than deprecated.
   *
   * Each existed for one reason: a CONSOLE ROUTE had to show marketplace UI
   * and an app may not import a plugin. AGL-3080 moved those routes into the
   * marketplace plugin, where the components are plain imports — so the four
   * zones had no drawer left, and a zone nothing draws is a contract nothing
   * can be held to. `plugin-widget-slot-zones.spec.ts` is what noticed, which
   * is the whole reason that inventory exists.
   *
   * `pluginSiteSet` and `hostArtifactPublish` stayed, and the difference is
   * the test: both are drawn by a console page that is NOT the marketplace —
   * the installation detail page and a site's layouts list — offering a
   * marketplace action in passing.
   */
  /**
   * The org Plugins page, above the built-in plugins (AGL-3080): the code a
   * plugin has INSTALLED into this workspace, one row per installation.
   * Props: {@link ConsoleOrgPluginInstallsZoneProps}.
   *
   * The Plugins page is the workspace's inventory — what it runs, wherever it
   * came from. The built-in half is the shell's own: the switchboard catalog
   * says what ships. The installed half is not: where an installation is
   * pinned, what version it runs, whether a newer one may be installed and
   * whether its publisher's kill switch is thrown are all facts held by the
   * plugin that installed it, in collections that are its own. So the page
   * hands over the sites it can see and the plugin draws its installations.
   *
   * Every row links to `/[orgSlug]/plugins/[pluginRef]`, the shell's
   * installation page, keyed by whatever id the installing plugin pins by —
   * that page is the one place an installation is managed, whoever drew the
   * row.
   */
  orgPluginInstalls: 'orgPluginInstalls',
  /**
   * The installation page of a plugin some plugin INSTALLED, above where it
   * runs (AGL-3080): what the installer says about the version this
   * workspace runs. Props: {@link ConsolePluginInstallStatusZoneProps}.
   *
   * Drawn only for an installation that exists — a first-party plugin has no
   * version to be behind, and a page for code installed nowhere says so
   * itself. A widget here reports; it never installs. Applying an update is
   * the installing plugin's own surface, which the widget may link to.
   */
  pluginInstallStatus: 'pluginInstallStatus',
  /**
   * The template gallery — "Start from a template" on a site's Screens,
   * Layouts and Components pages — below the site's own templates and the
   * starters (AGL-3080): a shelf of templates a plugin offers to INSTALL.
   * Props: {@link ConsoleTemplateGalleryZoneProps}.
   *
   * The gallery is the shell's: what the site holds and what ships with the
   * platform. Templates offered from elsewhere are the offering plugin's —
   * what it lists, how it is searched, what it costs and the route that
   * installs one, with every check that route makes — so the dialog hands
   * over the kind it picks and the word typed in its search, and the plugin
   * draws its own shelf. An install lands in the site's library and
   * publishes nothing; the widget calls `onInstalled` so the gallery closes.
   *
   * The dialog's "nothing matches" line covers every shelf, so a widget
   * reports whether its shelf is loading, empty or showing something through
   * `reportShelf`. A widget that never reports is a shelf the line ignores;
   * with no widget at all the gallery is the site's own and the starters.
   */
  templateGallery: 'templateGallery',
  /**
   * One row of a site's Templates library whose template a plugin INSTALLED,
   * beside its Source badge (AGL-3080): what the installer says about the
   * copy the site holds — that a newer version can be installed, and the
   * control that installs it. Props: {@link ConsoleTemplateInstallStatusZoneProps}.
   *
   * Drawn once per such row, and never for a template saved here or a
   * starter. A widget draws nothing for a template it did not install, and
   * nothing when there is nothing to say. Applying an update goes through
   * the installing plugin's own route, which keeps all its checks; the
   * library's rows re-read the templates it replaced.
   */
  templateInstallStatus: 'templateInstallStatus',
  /** Bottom of the host dashboard. Props: hostId, org. (AGL-433) */
  dashboardFooter: 'dashboardFooter',
  /** Org settings page, below the tabbed cards. Props: orgId, org. */
  orgSettings: 'orgSettings',
  /** Host setup page, below the built-in cards. Props: hostId, org. */
  hostSettings: 'hostSettings',
  /**
   * The top of the page a newly created site lands on (AGL-2918): where a
   * widget may offer to START the site for the person rather than leave them
   * an empty one. Props: {@link ConsoleHostFirstRunZoneProps}.
   *
   * ── The blank path is the default, not the fallback ──────────────────────
   *
   * The site already exists, blank, and the page beneath this zone is the
   * ordinary one every site gets. A widget here is an OFFER on top of that
   * page: it asks the person what they want, it builds only what they then
   * confirm, and everything it makes is a draft the site does not serve.
   *
   * So a zone with no widget — no plugin loaded, a feature not released, a
   * reader without the permission — is not a degraded state. It is the blank
   * path, unchanged and complete, which is why nothing on the page below
   * depends on anything here.
   *
   * ── A widget here MUST offer `startBlank` ────────────────────────────────
   *
   * A guided start that a person cannot leave turns creating a site into a
   * funnel, so `startBlank` is handed down rather than left to each widget to
   * invent: a widget draws it where its questions START, not at the end of
   * them, and taking it leaves the person on this same page with nothing
   * begun behind them. The shell remembers the choice for this site and stops
   * asking.
   *
   * A widget that takes the screen rather than sitting on the page — a full
   * screen dialog, an overlay — owes the same exit in every shape it has one:
   * a close control, and the key a person presses to dismiss it. Each of them
   * is `startBlank`, because a takeover somebody can only dismiss BACK INTO is
   * the funnel this zone exists to refuse, and nothing here is a half-answered
   * state worth returning to.
   */
  hostFirstRun: 'hostFirstRun',
  /**
   * The host setup Theme section, between the Theme picker and the editor
   * (AGL-2938). Props: {@link ConsoleHostThemeZoneProps} — the
   * site, the theme the editor shows, where that theme came from, the
   * editor's own preview, and `proposeDraft`, which puts a theme in the
   * editor as unsaved changes.
   *
   * A widget here proposes and never writes. The person saves what it
   * proposed through the editor's own Save — the guarded write that stores
   * an installed theme's edits as its override patch — or discards it. A
   * palette importer, a brand kit and a generator are the same shape of
   * widget.
   */
  hostTheme: 'hostTheme',
  /**
   * The staff overview, among its platform-wide cards (AGL-3080). No props:
   * the overview is about the platform, not one org, so a widget here reads
   * what its plugin holds across every workspace through its own staff
   * route. A staff zone — see {@link CONSOLE_STAFF_WIDGET_SLOTS}.
   */
  staffOverview: 'staffOverview',
  /**
   * Staff admin org detail (staff-only surfaces). Props: orgId. A staff
   * zone — see {@link CONSOLE_STAFF_WIDGET_SLOTS}.
   */
  adminOrgDetail: 'adminOrgDetail',
  /**
   * Billing → Usage, below the meters (AGL-2940). Props: `orgId`, `org` (the
   * billing-merged org doc), `canManage` (the reader holds
   * `billing.manage`). A card here explains or controls consumption the
   * meters above it show.
   */
  orgBillingUsage: 'orgBillingUsage',
  /**
   * Billing → Overview, among the plan and add-on cards (AGL-2940). Props:
   * `orgId`, `org`, `plan` (the page's own defaulted plan), `canManage`.
   */
  orgBillingOverview: 'orgBillingOverview',
  /**
   * The staff org page, among its cards (AGL-2940). Props: `orgId`. Staff
   * only — the page is behind `StaffOnly`, and a widget here may read the
   * staff-only routes. A staff zone — see {@link CONSOLE_STAFF_WIDGET_SLOTS}.
   */
  staffOrg: 'staffOrg',
  /**
   * The staff user page, below the account's activity. Props: `uid`. A
   * staff zone — see {@link CONSOLE_STAFF_WIDGET_SLOTS}.
   */
  staffUser: 'staffUser',
  /**
   * The staff site page, below its own cards (AGL-3379). Props: `hostId`,
   * `orgId` (the site's organization, `''` for none) and `host` (the site
   * document as the page read it, or `undefined` while it loads). What a
   * plugin holds for one site — its automations, its sends — is shown here,
   * by the plugin that owns it. A staff zone — see
   * {@link CONSOLE_STAFF_WIDGET_SLOTS}.
   */
  staffSite: 'staffSite',
  /**
   * A COLUMN of the staff Organizations list (AGL-2984) — see
   * {@link ConsoleWidget.column}. The list renders the widget's component
   * once per row with `{ row, orgId, orgIds }`: the row as the list route
   * serves it, that row's org id, and every org id on the page, so a column
   * that reads figures of its own asks once for the page rather than once
   * per row. Its `Header` receives `{ orgIds }` beside the sort props. A
   * staff zone — see {@link CONSOLE_STAFF_WIDGET_SLOTS}.
   */
  staffOrgsListColumn: 'staffOrgsListColumn',
  /**
   * The staff org usage table (AGL-2984): the monthly rollups on the staff
   * org page and in the Organizations list's usage dialog. A widget with a
   * `column` is a column of the table, between Forms and Cost, rendered once
   * per month with `{ month, orgId }` — `month` is the rollup row as
   * `/api/admin/org-usage` serves it. A widget without one renders above
   * the table with `{ orgId, org }`, where `org` is the org document when the
   * surface holds one and `undefined` when it does not. A staff zone — see
   * {@link CONSOLE_STAFF_WIDGET_SLOTS}.
   */
  staffOrgUsageColumn: 'staffOrgUsageColumn',
  /**
   * The org's team member detail page, below the member's activity
   * (AGL-2940). Props: `orgId`, `orgSlug`, `uid`, `member` (the org member
   * document as the page loaded it), `hosts` (the org's sites, for naming
   * them), `canManage` (the reader may manage the org).
   */
  orgMember: 'orgMember',
  /**
   * A COLUMN of the org Team table (AGL-2940) — see
   * {@link ConsoleWidget.column}: the widget declares the header and the
   * shell renders its component once per row with `{ member, orgId,
   * canManage }`. A widget on this slot without a `column` renders nothing.
   */
  orgMembersListColumn: 'orgMembersListColumn',
  /**
   * The site collaborators card (AGL-2940). A widget with a `column` is a
   * column of its table, rendered per row with `{ member, orgId, hostId,
   * canManage }` — the owner's row too, with `member` carrying the owner's
   * `uid` and `role: 'owner'`; a widget without one renders beneath the
   * table with `{ hostId, canManage }`.
   */
  hostMembers: 'hostMembers',
  /**
   * One visitor account's drawer on a site's Users page (AGL-546), under the
   * account's password controls and above its saved addresses: what a plugin
   * holds about the person behind the account — what they bought, what they
   * subscribe to. Props: {@link ConsoleSiteMemberZoneProps}. Each widget is
   * one section of the drawer's own column, which spaces it; the drawer
   * draws the account itself, its suspension and its password help.
   */
  siteMember: 'siteMember',
  /**
   * The console dock (AGL-2940): the one position above every route boundary
   * in both the `(app)` and `(editor)` shells, where a floating panel — an
   * assistant, a helper — survives a navigation. Props:
   * {@link ConsoleDockZoneProps}. Named for the position, not for what a
   * plugin puts there (AGL-3080: it was `assistPanel`).
   */
  consoleDock: 'consoleDock',
  /**
   * The console's top bar, among its own status controls just ahead of the
   * notifications bell (AGL-3593), in both shells: a compact indicator a
   * plugin keeps in view on every page — work in progress, something waiting
   * on the reader — that opens the plugin's own surface when pressed. Props:
   * {@link ConsoleTopBarZoneProps}, the dock's answers, because both sit
   * above every route and answer the same questions. A widget here is one
   * control in a row the bar spaces; it draws nothing at all when it has
   * nothing to say, and never more than one small control.
   */
  consoleTopBar: 'consoleTopBar',
  /**
   * A section at the bottom of the besigner's Attributes panel (AGL-2940),
   * under the selected element's own fields. Props: `hostId` (`null` on an
   * editor that names no site), and `node`, the selected element (AGL-2984)
   * — present wherever the designer draws the panel for a selection.
   */
  besignerInspector: 'besignerInspector',
  /**
   * The besigner's Interactions section, on every editor that offers one
   * (AGL-3080): the section experiments a plugin runs on a page's elements.
   * Props: {@link ConsoleBesignerInteractionsZoneProps}.
   *
   * The section is the designer's, and so are an element's own interactions:
   * they live on its node and ride the document's save. A section experiment
   * is not a node's: it is a record of whichever plugin runs experiments,
   * stored where that plugin keeps them. So a widget here draws nothing. It
   * reads its own records and REPORTS them, and the section badges an element
   * and offers to start one from what was reported. With no widget the
   * section offers none, which is a workspace with no plugin that runs them.
   */
  besignerInteractions: 'besignerInteractions',
  /**
   * Inside a SEARCH LISTING editor (AGL-2910), under its fields. Props:
   * {@link ConsoleSeoFieldsZoneProps} — what the listing describes, the
   * fields the editor edits and what they hold, and `proposeValues`, which
   * stages values in those fields as unsaved edits.
   *
   * Two editors host it: the screen detail page's SEO card, and the commerce
   * product editor's search engine listing, which draws it through
   * `useConsoleWidgetSlot` because a plugin's dialog cannot mount the shell's
   * slot itself. A widget here proposes and never writes: the editor's own
   * Save is the write, with the guards that write carries. A keyword checker,
   * a translation memory and a generator are the same shape of widget.
   */
  seoFields: 'seoFields',
  /**
   * The host setup SEO section, under the site's SEO check and above the site
   * SEO form (AGL-2910). Props: {@link ConsoleHostSeoZoneProps} — the site,
   * its stored SEO settings, the check's last report, and `proposeDraft`,
   * which puts values in the form as unsaved edits. The form's Update stores
   * them; nothing a widget proposes reaches the published site before that.
   */
  hostSeo: 'hostSeo',
  /** {@link ConsoleRecordInsightsZoneProps} */
  recordInsights: 'recordInsights',
  /** {@link ConsoleRecordEmailZoneProps} */
  recordEmail: 'recordEmail',
  /** {@link ConsoleImportMappingZoneProps} */
  importMapping: 'importMapping',
  /**
   * The besigner's secondary toolbar, after the undo and redo controls
   * (AGL-2984), on every editor the designer opens: screens, layouts,
   * components, forms, templates and email designs. A control here acts on
   * the document in the editor. Props: `hostId` (`null` on an editor that
   * names no site).
   */
  besignerToolbar: 'besignerToolbar',
  /**
   * A section at the foot of the besigner's Page Properties drawer
   * (AGL-3475), under the page's publishing, layout, SEO and password
   * sections: what a plugin makes of the PAGE itself, such as serving it once
   * per record. Props: {@link ConsoleBesignerPagePropertiesZoneProps}. The
   * drawer's column spaces each widget as one of its sections; a widget saves
   * through its own routes, never through the drawer's buttons.
   */
  besignerPageProperties: 'besignerPageProperties',
  /**
   * Inside one row of a site's Pages list (AGL-3475), beside the page's name:
   * a chip a plugin draws about that page — that it is a record template,
   * and how many pages it serves. Props:
   * {@link ConsoleHostScreenRowZoneProps}. Drawn once per row, so a widget
   * reads what it needs once for the site and answers each row from that.
   */
  hostScreenRow: 'hostScreenRow',
  /**
   * A site's Screens page, beside its Templates and Create New Screen actions
   * (AGL-2907): another way to start a screen. Props:
   * {@link ConsoleHostScreensZoneProps}. A widget here runs its own flow and
   * writes nothing through the page; the screens list shows what it makes once
   * it exists.
   */
  hostScreens: 'hostScreens',
  /**
   * A site's Templates page, beside its Create Template action (AGL-3043):
   * another way to start a template. Props:
   * {@link ConsoleHostTemplatesZoneProps}. The `hostScreens` contract: a
   * widget here runs its own flow and writes nothing through the page, and
   * the template list shows what it makes once it exists.
   */
  hostTemplates: 'hostTemplates',
  /**
   * A site's Layouts page, beside its Templates and Create New Layout actions
   * (AGL-3043): another way to start a layout. Props:
   * {@link ConsoleHostLayoutsZoneProps}, on the `hostScreens` contract.
   */
  hostLayouts: 'hostLayouts',
  /**
   * A site's Components page, beside its Templates and Create Component
   * actions (AGL-3051): another way to start a reusable component. Props:
   * {@link ConsoleHostComponentsZoneProps}, on the `hostScreens` contract.
   */
  hostComponents: 'hostComponents',
  /**
   * The organization's sites page, beside the sites themselves (AGL-2911):
   * an action a member takes across MANY of the org's sites at once, rather
   * than a card totaling them. Props: {@link ConsoleOrgSitesZoneProps}.
   *
   * Distinct from `orgDashboard`, which is on the same page and gated on the
   * org CRM hub's reach verdict because every card there reads across the
   * host boundary. A widget here reads nothing of the kind: the sites it acts
   * on are the ones the page already resolved for this reader, and its own
   * door proves the reader's permission on each of them again. So the zone
   * carries no gate beyond the slot's own — enablement, entitlement, and the
   * widget's declared permission.
   */
  orgSites: 'orgSites',
  /**
   * One side of one item in a site package import's Changes step, beside
   * the other side (AGL-3545): the item drawn the way its owner previews it.
   * Props: {@link ConsoleSitePackageItemPreviewZoneProps}.
   *
   * A package carries items of many kinds, and how one looks belongs to
   * whoever keeps that kind — a form through the form's own preview, a site
   * email through the email preview. So a widget here names the kinds it
   * draws in its `itemKinds`, the import draws it for those and nothing else,
   * and an item of a kind no widget names keeps the console's own rendering
   * or its value list. The widget reads nothing it is not handed beyond what
   * its preview always reads, and never writes: the import writes, after the
   * person decides.
   */
  sitePackageItemPreview: 'sitePackageItemPreview',
} as const

export type ConsoleWidgetSlot =
  (typeof CONSOLE_WIDGET_SLOTS)[keyof typeof CONSOLE_WIDGET_SLOTS]

/** What the `besignerPageProperties` zone hands each widget (AGL-3475). */
export interface ConsoleBesignerPagePropertiesZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  /** The page in the editor. */
  screenId: string
  /** The page's `kind` as stored: `'template'` for a template, absent for a page. */
  screenKind?: string
}

/** What the `hostScreenRow` zone hands each widget (AGL-3475). */
export interface ConsoleHostScreenRowZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  /** The row's page. */
  screenId: string
  /** The page's `kind` as stored. */
  screenKind?: string
}

/** What the `hostScreens` zone hands each widget (AGL-2907). */
export interface ConsoleHostScreensZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
}

/**
 * What the `hostTemplates` and `hostLayouts` zones (AGL-3043) and the
 * `hostComponents` zone (AGL-3051) hand each widget: the site and its org, as
 * `hostScreens` hands them. A plugin that hosts a resource page of its own
 * hands the same contract from a zone it declares (the forms plugin's
 * `hostForms`).
 */
export type ConsoleHostTemplatesZoneProps = ConsoleHostScreensZoneProps
/** See {@link ConsoleHostTemplatesZoneProps}. */
export type ConsoleHostLayoutsZoneProps = ConsoleHostScreensZoneProps
/** See {@link ConsoleHostTemplatesZoneProps}. */
export type ConsoleHostComponentsZoneProps = ConsoleHostScreensZoneProps

/** What the `orgSites` zone hands each widget (AGL-2911). */
export interface ConsoleOrgSitesZoneProps {
  /** Always `null`: the zone belongs to the organization, not to one site. */
  hostId: null
  /** The org and the sites the page resolved for this reader. */
  orgMount: ConsolePluginOrgMount
  /** The sites page's own path, for the links a widget builds. */
  basePath: string
}


/** What the `hostFirstRun` zone hands each widget (AGL-2918). */
export interface ConsoleHostFirstRunZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  /** Path slug for building `/[orgSlug]/…` links. */
  orgSlug: string
  /** The site's subdomain, which is what a console URL names a site by. */
  host: string | null
  /**
   * Leaves the guided start for a blank site: this same page, with nothing
   * begun. The shell records the choice for this site, draws the zone no more,
   * and gives a site born for the guided start its starter — the published
   * Home page and layout every other new site is born with (AGL-3594).
   *
   * Required of every widget on this zone, drawn where its questions start
   * rather than after them, and — for a widget that takes the screen — what
   * every way of dismissing it does BEFORE it has started anything. See
   * `hostFirstRun` in {@link CONSOLE_WIDGET_SLOTS}.
   */
  startBlank: () => void
  /**
   * Closes the zone after its widget STARTED the site some other way — a
   * guided start whose job is running (AGL-3594). The shell records that the
   * site was asked and draws the zone no more, and writes no starter: the
   * site's pages are the job's to build. A widget that started nothing calls
   * `startBlank` instead. Optional, so a shell that predates it still closes
   * the zone through `startBlank`.
   */
  leave?: () => void
}

/**
 * Something a console page holds that somebody may want to publish
 * (AGL-3080).
 *
 * The console's own vocabulary and nothing else: a `kind` naming what the
 * thing IS, the scope that holds it, and the document. Where it can be
 * published to, what a listing of it is called and what it may cost are the
 * publishing plugin's, which is the whole point of handing this over rather
 * than building a request.
 *
 * `kind` is an open string for the reason a plugin's zone ids are: core
 * listing every publishable noun would be core holding the catalog again. A
 * widget that does not publish a kind draws nothing for it.
 */
export interface ConsolePublishableArtifact {
  /** What the thing is: `layout`, `component`, `theme`, `site`, … */
  kind: string
  /** The site it belongs to, where the kind belongs to one. */
  hostId?: string | null
  /** The organization, for a kind held by the org rather than a site. */
  orgId?: string | null
  /**
   * The document, in the holding surface's terms. Absent for a kind that IS
   * the site or the org — a theme, a whole site template — where the scope
   * above already names it.
   */
  artifactId?: string | null
  /** Seeds the listing's name; the person may change it. */
  displayName?: string
  description?: string
}

/** One site of the workspace, as the console names it. */
export interface ConsoleZoneSite {
  id: string
  label: string
}

/** What the `orgPluginInstalls` zone hands each widget (AGL-3080). */
export interface ConsoleOrgPluginInstallsZoneProps {
  /** The organization whose inventory the page is. */
  orgId: string
  /** Path slug for building `/[orgSlug]/…` links. */
  orgSlug: string
  /**
   * The sites of the organization the reader can see. An installation may be
   * pinned to some of them rather than to the whole organization, so a widget
   * reads each site's pins through this list rather than listing sites
   * itself.
   */
  hosts: ReadonlyArray<ConsoleZoneSite>
}

/** What the `pluginInstallStatus` zone hands each widget (AGL-3080). */
export interface ConsolePluginInstallStatusZoneProps {
  /** Path slug for building `/[orgSlug]/…` links. */
  orgSlug: string
  /** The installation's id: the segment of the page, which is the pin's key. */
  pluginRef: string
  /**
   * One pin of the installation — org-wide if there is one, else any site's.
   * Every pin carries the same version and manifest, which is what a status
   * is about.
   */
  pin: Readonly<Record<string, unknown>>
}

/** A release flag's verdict as the console applies it: the staff bypass included. */
export interface ConsoleReleaseVerdict {
  /** Released, or the reader is staff. */
  visible: boolean
  /** Visible ONLY because the reader is staff. */
  staffPreview: boolean
}

/** What the `consoleDock` zone hands each widget (AGL-2940, AGL-3080). */
export interface ConsoleDockZoneProps {
  orgId?: string
  org?: unknown
  orgReady: boolean
  /**
   * The org a widget may speak for, act as, and be METERED against — or
   * `undefined` where the page named none, or where the membership positively
   * contradicts the URL (AGL-1130, AGL-1916, AGL-1934).
   */
  scopedOrgId?: string
  /** Path slug for building `/[orgSlug]/…` links. */
  orgSlug: string
  /** The site in view, or null off a host route. */
  hostId: string | null
  /** The product's name as this org reads it (AGL-2319). */
  productName: string
  /**
   * The verdict for any release flag the widget names, staff bypass applied.
   * The shell names no plugin's flag; a widget asks for its own.
   */
  releaseVerdict: (key: string) => ConsoleReleaseVerdict
  isStaff: boolean
  /** The reader's verdict for every declared permission key on the site in view. */
  permissionsOnHost?: { loaded: boolean; granted: Readonly<Record<string, boolean>> }
}

/**
 * What the `consoleTopBar` zone hands each widget (AGL-3593): the same
 * answers the console dock gets, from the same shell resolution.
 */
export type ConsoleTopBarZoneProps = ConsoleDockZoneProps

/** How one plugin's shelf of the template gallery stands (AGL-3080). */
export type ConsoleTemplateGalleryShelfState = 'loading' | 'empty' | 'shown'

/** What the `templateGallery` zone hands each widget (AGL-3080). */
export interface ConsoleTemplateGalleryZoneProps {
  /** The site a template installs into. */
  hostId: string
  /**
   * The kind of template the gallery picks: `page` on the Screens page,
   * `layout` and `component` on theirs. A shelf offering only one kind
   * draws nothing for the others.
   */
  kind: 'page' | 'component' | 'layout'
  /** The word typed in the gallery's search box, `''` for none. */
  search: string
  /** Closes the gallery once an install has landed in the library. */
  onInstalled: () => void
  /**
   * Says how this shelf stands, keyed by a name the widget chooses and keeps,
   * so the gallery's "nothing matches" line counts it. Report `empty` rather
   * than nothing once a read answers with nothing.
   */
  reportShelf: (shelfId: string, state: ConsoleTemplateGalleryShelfState) => void
}

/** What the `siteMember` zone hands each widget (AGL-3080). */
export interface ConsoleSiteMemberZoneProps {
  /** The site whose visitor account it is. */
  hostId: string
  /**
   * The account's `siteMembers` document as the drawer holds it, `$id`
   * included. Its `email` is how a plugin finds what the person did on the
   * site.
   */
  member: Readonly<Record<string, unknown>> & { $id: string }
}

/** One section experiment, as the besigner's Interactions section lists it (AGL-3080). */
export interface ConsoleBesignerSectionExperiment {
  id: string
  name?: string
  /** The element the experiment varies. */
  nodeId: string
  status?: string
}

/** What one plugin reports to the besigner's Interactions section (AGL-3080). */
export interface ConsoleBesignerSectionExperiments {
  experiments: ConsoleBesignerSectionExperiment[]
  /**
   * Starts a draft experiment on an element. Reported only where the editor's
   * document is a page (`screenId` is set): a layout or a component is no
   * page for an experiment to run on.
   */
  create?: (options: { nodeId: string }) => void
}

/** What the `besignerInteractions` zone hands each widget (AGL-3080). */
export interface ConsoleBesignerInteractionsZoneProps {
  /** The site whose editor this is. */
  hostId: string
  /** The page under edit, or `null` on a layout or a component. */
  screenId: string | null
  /**
   * Hands the section what this plugin runs, keyed by a name the widget
   * chooses and keeps; `null` withdraws it. Call it from an effect.
   */
  reportSectionExperiments: (
    reporterId: string,
    report: ConsoleBesignerSectionExperiments | null,
  ) => void
}

/** What the `templateInstallStatus` zone hands each widget (AGL-3080). */
export interface ConsoleTemplateInstallStatusZoneProps {
  /** The site whose library the row is in. */
  hostId: string
  /**
   * The row's template document as the library read it, `$id` included:
   * its server-managed `source` and `installedFrom` stamps say who installed
   * it, and `editedAt` whether the site has edited its copy since.
   */
  template: Readonly<Record<string, unknown>>
}

/** What the `sitePackageItemPreview` zone hands each widget (AGL-3545). */
export interface ConsoleSitePackageItemPreviewZoneProps {
  /** The site the package is being imported into. */
  hostId: string
  /** Which side this is: the site's copy, or the file's. */
  side: 'site' | 'file'
  /** The item's package key, `<kind>/<id>`. */
  itemKey: string
  /** One of the kinds the widget names in `itemKinds`. */
  kind: string
  /** The document the side is: the site's item, or the id the file's would land under. */
  itemId: string
  /** The item as an import would write it: the document, without `$id`. */
  content: unknown
  /** What the import calls the item. */
  title: string
}

/** What the `hostArtifactPublish` zone hands each widget (AGL-3080). */
export interface ConsoleArtifactPublishZoneProps {
  /**
   * What the page asked to publish, or `null` while nothing is open. The
   * page owns the open/closed state because the control that opens this is
   * the page's own.
   */
  artifact: ConsolePublishableArtifact | null
  /** Closes it, however it was closed — cancelled, published, or refused. */
  onClose: () => void
}

/** What the `hostTheme` zone hands each widget (AGL-2938). */
export interface ConsoleHostThemeZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  /** Path slug for building `/[orgSlug]/…` links. */
  orgSlug: string
  /** The site's subdomain, which is what a console URL names a site by. */
  host: string | null
  /** The theme the editor shows: the site's theme with its overrides resolved. */
  theme: HostTheme | undefined
  /** Where that theme came from, which decides how an edit to it is stored. */
  themeSource: HostThemeSource
  /** The editor's own preview, which renders a theme over the brand base. */
  ThemePreview: ComponentType<{ theme: HostTheme; scheme: HostThemeScheme }>
  /**
   * Puts `theme` in the editor as unsaved changes under `key`. A new key
   * replaces the previous draft; the same key again changes nothing until
   * the editor has saved or discarded it.
   */
  proposeDraft: (theme: HostTheme, key: string) => void
}

/**
 * The zones on the STAFF pages (AGL-2939): the staff overview, the staff org
 * page, its detail zone, and the staff user page.
 *
 * No workspace names the plugin set there. A staff page is ABOUT an org or
 * an account, and the reader's own memberships have nothing to do with what
 * it shows, so the console reads these zones from the plugins it loads for
 * the staff area — every plugin that declares a `staff` register surface —
 * and consults neither a widget's entitlement nor its permission: both are
 * answers about a workspace, and the staff area's guard is what admits the
 * reader.
 */
export const CONSOLE_STAFF_WIDGET_SLOTS: readonly ConsoleWidgetSlot[] = [
  CONSOLE_WIDGET_SLOTS.staffOverview,
  CONSOLE_WIDGET_SLOTS.adminOrgDetail,
  CONSOLE_WIDGET_SLOTS.staffOrg,
  CONSOLE_WIDGET_SLOTS.staffUser,
  CONSOLE_WIDGET_SLOTS.staffSite,
  CONSOLE_WIDGET_SLOTS.staffOrgsListColumn,
  CONSOLE_WIDGET_SLOTS.staffOrgUsageColumn,
]

/** Whether a slot is one of the {@link CONSOLE_STAFF_WIDGET_SLOTS}. */
export function isConsoleStaffWidgetSlot(slot: string): boolean {
  return (CONSOLE_STAFF_WIDGET_SLOTS as readonly string[]).includes(slot)
}

/**
 * The zones whose HOST decides who reads them (AGL-3554): each widget draws
 * only the props the host hands it, and the host page is already gated on
 * what its own route requires — a site package import's side-by-side diff,
 * opened by whoever may import a package into the site. So the console asks
 * the widget's own `permission` there and not its extension's: an
 * extension's permission guards the extension's own surfaces and reads (the
 * Email plugin's `data.manage`, for the audiences its page lists), and
 * would otherwise hide a preview from the very person importing the item.
 * The extension's plan feature is still asked.
 */
export const CONSOLE_HOST_GATED_WIDGET_SLOTS: readonly ConsoleWidgetSlot[] = [
  CONSOLE_WIDGET_SLOTS.sitePackageItemPreview,
]

/** Whether a slot is one of the {@link CONSOLE_HOST_GATED_WIDGET_SLOTS}. */
export function isConsoleHostGatedWidgetSlot(slot: string): boolean {
  return (CONSOLE_HOST_GATED_WIDGET_SLOTS as readonly string[]).includes(slot)
}

/** Search listing values by field; a field the editor does not hold is absent. */
export type ConsoleSeoFieldValues = Partial<Record<SeoListingFieldKey, string>>

/**
 * What a search listing describes (AGL-2910). A screen is read from its own
 * documents by whoever needs more than its name; a product travels with its
 * name and description, because the product document is the commerce
 * plugin's and nothing else reads it.
 */
export type ConsoleSeoFieldsSubject =
  | {
      kind: 'screen'
      /** The screen document id. */
      id: string
      /** The version the page is showing, whose content the listing is about. */
      versionId: string | null
      name: string
    }
  | {
      kind: 'product'
      /** `null` for a product that has not been saved yet. */
      id: string | null
      name: string
      description: string
    }

/** What the `seoFields` zone hands each widget (AGL-2910). */
export interface ConsoleSeoFieldsZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  /** Path slug for building `/[orgSlug]/…` links. */
  orgSlug: string
  subject: ConsoleSeoFieldsSubject
  /**
   * The fields this editor edits, in its order — the only ones a widget may
   * propose. Keys of the `seo-listing-fields` catalog, which carries each
   * field's label and length.
   */
  fields: readonly SeoListingFieldKey[]
  /** What each field holds as the editor shows it: saved, or staged and unsaved. */
  values: ConsoleSeoFieldValues
  /** Whether the listing has a social image — an image description needs one. */
  hasImage: boolean
  /**
   * Stages `values` in the editor as unsaved edits under `key`. Fields the
   * editor does not edit are ignored. The editor's own Save is what stores
   * them; a widget never writes the listing itself.
   */
  proposeValues: (values: ConsoleSeoFieldValues, key: string) => void
}

/**
 * The site's SEO check as the SEO section last ran it: the platform's
 * findings (`app-utils/seo-audit`), which the section draws for every site
 * owner, and the target keyword lines the check was run with.
 */
export interface ConsoleSeoCheck {
  report: SeoAuditReport
  /** The keyword lines as typed, one page a line: `/pricing: plans, pricing`. */
  keywords: string
}

/** What the `hostSeo` zone hands each widget (AGL-2910). */
export interface ConsoleHostSeoZoneProps {
  hostId: string
  /** The org the page names; `undefined` while it resolves. */
  orgId: string | undefined
  /** Path slug for building `/[orgSlug]/…` links. */
  orgSlug: string
  /** The site's subdomain, which is what a console URL names a site by. */
  host: string | null
  /** The site's stored `seo` settings, as the form was seeded with them. */
  seo: Record<string, unknown> | undefined
  /**
   * Puts `values` in the site SEO form as unsaved edits, keyed by the form's
   * field names (`seo.entity.description`, `seo.agent.whenToUse`). Proposals
   * land in the form's draft beside what was typed, the same `key` twice
   * applies once, and the form's Update is what stores them.
   */
  proposeDraft: (values: Record<string, string>, key: string) => void
  /**
   * The SEO check the section drew above the zone, once somebody has run it
   * this visit; `null` before. The section lists the findings: a widget adds
   * what it has for them — a proposed fix, say — and never lists them again.
   */
  check: ConsoleSeoCheck | null
}

/**
 * A column a widget contributes to a shell-owned table (AGL-2940) — the org
 * Team table and the site collaborators table read these. The widget's
 * `Component` is the CELL renderer, mounted once per row with the row as a
 * prop beside the slot's own props; the header and the sort key are the
 * table's to draw.
 */
export interface ConsoleWidgetColumn {
  /** The header cell's text, and the column's name wherever it is listed. */
  header: string
  /**
   * The row field a table that sorts orders this column by. Carried for
   * every column contract so a sortable table can honor it; the two member
   * tables render in fetch order and do not read it today.
   */
  sortKey?: string
  align?: 'left' | 'right' | 'center'
  /**
   * The header cell's content when a plain `header` is not enough
   * (AGL-2939): a hint, or a sort over values only the plugin can read.
   * Mounted once per table with the slot's props beside
   * {@link ConsoleWidgetColumnHeaderProps}; without it the table draws
   * `header` as text.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Header?: ComponentType<any>
}

/**
 * What a column's own header receives beside the slot's props (AGL-2939).
 * The table keeps one sort at a time, so a column that sorts replaces
 * another's order.
 */
export interface ConsoleWidgetColumnHeaderProps {
  /**
   * Hands the table a row comparator, or `null` to put the rows back in the
   * table's own order. Stable for the life of the table.
   */
  onSort: (compare: ((a: never, b: never) => number) | null) => void
  /** Whether the rows are in this column's order. */
  sorted: boolean
}

/**
 * A component a plugin renders into a NAMED console slot (AGL-419/433) —
 * see {@link CONSOLE_WIDGET_SLOTS} for the guaranteed zones and their
 * props. The shell owns placement; the plugin owns the UI.
 */
export interface ConsoleWidget {
  slot: string
  /**
   * Present when the widget is a table COLUMN rather than a card (AGL-2940)
   * — see {@link ConsoleWidgetColumn}. Only the slots documented as column
   * slots read it; elsewhere it is ignored.
   */
  column?: ConsoleWidgetColumn
  /**
   * The kinds of item the widget draws, for a zone that draws one item of
   * many kinds (`sitePackageItemPreview`, AGL-3545). Only the slots
   * documented as reading it do; elsewhere it is ignored.
   */
  itemKinds?: readonly string[]
  /**
   * Stable identity for this widget, unique within the plugin per slot.
   * The id names the CARD, not its placement: the same card registered on
   * a second slot — the CRM's glance on the host dashboard and again on the
   * org's sites page — carries one id on both.
   *
   * A PERSISTED IDENTIFIER wherever the shell lets someone arrange the
   * surface it lands on — the console stores dashboard cards a reader has
   * switched off by this string, and reads it back sessions later. Giving a
   * retired id to a different card therefore shows that reader an
   * arrangement they never chose. Retire an id by leaving it reserved and
   * minting a new one, never by reusing it.
   */
  widgetId: string
  /**
   * What to call this widget where it is LISTED rather than rendered — the
   * console's dashboard customize dialog is the one such place today.
   *
   * Match the card's own heading: the two names sit a click apart, and a
   * switch labeled differently from the card it controls reads as a switch
   * for something else. Omitting it falls back to the extension's
   * `displayName`, which is right for a plugin contributing one card and
   * ambiguous for one contributing several.
   */
  title?: string
  /**
   * The permission a reader must hold for this card, when it is narrower
   * than its extension's own {@link ConsoleExtension.permission}.
   *
   * Composes by AND with the extension's, like a nav item's does: a widget
   * cannot escape its extension's gate by naming a key its reader happens to
   * hold, and declaring nothing here inherits the extension's requirement
   * rather than clearing it.
   *
   * A card is a surface the reader never asked for — the shell drops it onto
   * a page they opened for something else — so there is nowhere in it to put
   * an upsell or a refusal, and a widget its reader may not have is simply
   * absent. That is the same treatment the entitlement gate gives a widget,
   * and for the same reason.
   */
  permission?: string
  /**
   * The entitlement THIS card needs, when it is narrower than its
   * extension's {@link ConsoleExtension.featureFlag} (AGL-2611).
   *
   * Composes by AND with the extension's, exactly as `permission` above
   * does: a card cannot escape its extension's gate by declaring nothing,
   * and declaring one here can only narrow. The case is an extension whose
   * surface ships on every plan while one of its cards belongs to a paid
   * part of it. Absent without an upsell, for the reason `permission` gives.
   */
  featureFlag?: keyof OrgFeatureFlags
  /**
   * Mount this widget as its own upsell when the ONLY thing missing is the
   * plan entitlement (AGL-3601).
   *
   * Without it a widget whose `featureFlag` the plan lacks is absent, as
   * above. With it, the shell still mounts it — with `entitled={false}` and
   * an `upgrade` prop ({@link ConsoleWidgetUpgrade}) — but only when every
   * other gate passes (the reader's permission, the plugin being on for this
   * workspace and this site) and the missing flag is one an add-on this
   * workspace can buy switches on. Where nothing can be bought the widget
   * stays absent, so the widget never has to decide that itself.
   *
   * The widget owns what it draws in that state, and must not open the
   * feature: the shell has decided the plan does not include it.
   */
  showWhenNotEntitled?: boolean
  /**
   * The release flag this widget is behind, which the shell resolves from the
   * flags it already loads for every page (AGL-3601) — staff bypass applied,
   * as the server's own doors apply it. The widget is absent while the flag
   * is off for this workspace, and while the flags have not settled, so a
   * control is never drawn and then taken away.
   *
   * For a widget that would otherwise have to ask a server door whether its
   * feature exists before it draws anything.
   */
  releaseFlag?: ReleaseFlagKey
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  Component: ComponentType<any>
}

/**
 * Where a widget mounted by {@link ConsoleWidget.showWhenNotEntitled} sends a
 * reader to buy what it lacks. The shell builds it, so no extension supplies a
 * URL the console's own chrome then renders.
 */
export interface ConsoleWidgetUpgrade {
  /** The workspace's Billing page, at the section that sells add-ons. */
  billingHref: string
  /** Whether the reader may buy it (`billing.manage`). */
  canManageBilling: boolean
}

/**
 * The props the shell adds to a widget that declared
 * {@link ConsoleWidget.showWhenNotEntitled}, beside its zone's own.
 * `entitled` is `true` when the plan includes the feature, and `upgrade`
 * is present only when it is `false`.
 */
export interface ConsoleWidgetEntitlementProps {
  entitled?: boolean
  upgrade?: ConsoleWidgetUpgrade
}

/**
 * Console half of the pattern: everything a feature contributes to the
 * console shell. Declarative — the shell owns rendering and applies the
 * feature-flag gate, so extensions cannot bypass entitlements.
 *
 * That sentence describes `apps/console/utils/extension-entitlement.ts`,
 * which the plugin route and `PluginWidgetSlot` both call before they mount
 * anything an extension registered (AGL-2484). It was an aspiration until
 * then: the route resolved the entitlement and handed it to the extension as
 * the `entitled` PROP, and the widget slot did not resolve it at all, so
 * enforcement rested on each extension policing itself — which one
 * first-party page did not do.
 *
 * What the gate covers, exactly: a `featureFlag` refuses to RENDER the
 * extension's page body and its widgets. Nav items stay visible on purpose.
 * Hiding the tab would hide the only route most workspaces have to the page
 * that sells the feature, and a nav entry leading to the shell's own upgrade
 * notice bypasses nothing.
 *
 * TWO QUESTIONS, BOTH ANSWERED BY THE SHELL. `featureFlag` is about the
 * organization's plan; `permission` is about the person reading, and it is
 * enforced in the same place and the same way — resolved from the member's
 * own permission map, never from anything the extension supplies, and read
 * before the surface is constructed. An extension declares what it requires
 * and the shell decides whether the requirement is met, so the sentence
 * above holds for authorization as well as for entitlements.
 */
/**
 * What a blocked org is told about a feature it does not hold, in the
 * extension's own words.
 *
 * PRESENTATION ONLY. The shell decides entitlement from the org billing doc
 * and this extension's `featureFlag`, and reads this object solely to render
 * a refusal it has ALREADY decided on. Nothing here is an input to that
 * decision, and an extension supplying it gains no access — the surface it
 * describes stays unmounted either way.
 *
 * It exists because the shell's own copy can only speak in generalities. An
 * entitlement that no plan grants — one sold as a per-organization add-on —
 * is described exactly wrong by "not included in your current plan", which
 * sends the reader to compare plan tiers that would not have helped.
 */
export interface ConsoleUpgradeNotice {
  /**
   * The sentence a blocked org reads. Plain text: the shell renders it as a
   * string, never as markup, and a third-party extension writes this.
   */
  message: string
  /**
   * Which card on the billing page sells it, as a bare fragment id
   * ('addons'). The console validates it against the anchors that page
   * actually has and drops it otherwise — the `docsTopic` treatment, for the
   * same reason: an extension can name any string, and an unrecognized one
   * must degrade to the plain Billing link rather than build a dead URL.
   *
   * Deliberately not an href. A full URL from an extension would be an
   * open redirect rendered by the console's own chrome; the shell keeps
   * ownership of the route and accepts only which part of it to scroll to.
   */
  billingAnchor?: string
}

/** What the console's generic staff route hands a staff page. */
export interface ConsoleStaffPageProps {
  /** The page's own console path, `/admin/{id}`. */
  basePath: string
  /**
   * Path segments beneath {@link basePath}, `[]` on the page's own URL
   * (AGL-3080). Only ever non-empty for a page that declared
   * {@link ConsoleStaffPage.ownsSubtree}.
   *
   * The staff twin of {@link ConsolePluginPageProps.segments}, and for the
   * same case: a queue is a list, and a row of it is a page. A staff page
   * without this could only ever BE the list.
   */
  segments?: readonly string[]
  /**
   * The viewer's staff ROLE, or `null` while the claim is still resolving
   * (AGL-3080).
   *
   * Not every staff act is open to every staff role — six are `super`-only
   * on the server — and a page that cannot tell renders live controls to a
   * `support` engineer who clicks them and gets a raw 403. Pass it to
   * `resolveStaffRoleGate` and render the verdict with
   * `BlockedControl`; `null` must never be treated as a refusal, or every
   * page flashes a disabled button at the people who may use it.
   *
   * ⚠️ NOT the boundary. The routes verify the decoded token per request and
   * refuse regardless of what rendered. This exists so the console stops
   * promising what the server will refuse.
   */
  staffRole?: string | null
  /**
   * Console destinations a staff page may link ACROSS to, built by the shell
   * (AGL-3080) — the staff twin of {@link ConsolePluginOrgMount}'s paths,
   * and for the same reason: a plugin cannot import the console's route
   * table, and a plugin that rebuilt one of these from a string would break
   * silently the day the console moved it.
   */
  staffPaths?: ConsoleStaffPagePaths
}

export interface ConsoleStaffPagePaths {
  /**
   * The staff console's page for one workspace. `undefined` on a deployment
   * that has no such page, which a caller renders as no link rather than a
   * dead one.
   */
  orgDetail(orgId: string): string | undefined
}

/**
 * A page a plugin adds to the STAFF area (AGL-2939): a tab in the staff
 * strip and a page at `/admin/{id}`, rendered by the console's generic staff
 * route. The shell owns the layout, the header, the breadcrumbs, the staff
 * guard and the tab; the plugin owns the body.
 *
 * Staff pages load with the staff area's plugins — those declaring a `staff`
 * register surface — not with a workspace's, because no org names the plugin
 * set on `/admin`. They are admitted by the staff claim alone, so the
 * extension's `featureFlag` and `permission` do not apply, and every read a
 * staff page makes is refused server-side to a caller without the claim.
 */
export interface ConsoleStaffPage {
  /**
   * The URL segment under `/admin`, and the page's identity. The console's
   * own staff routes win a segment they use, so pick one they do not. It is
   * in links staff keep — treat it as persisted.
   */
  id: string
  /** The tab's label in the staff strip. */
  label: string
  /**
   * The page header (title and icon), and the docs topic its help `?`
   * explains — a plain string for the reason {@link ConsoleNavItem.header}
   * gives, validated by the console.
   */
  header?: { title: string; icon?: MdiIconProps; docsTopic?: string }
  /**
   * Whether this page claims every path beneath `/admin/{id}` too
   * (AGL-3080) — the staff twin of {@link ConsoleNavItem.ownsSubtree}, with
   * the same trade and the same duty.
   *
   * The case is a staff QUEUE: the list is the page, and each row opens one
   * submission. The set of ids is a property of the data, so no static list
   * could enumerate them, and without this every row's URL is a 404.
   *
   * A page that claims its subtree can no longer tell a typo from an id, so
   * it takes on saying "no such thing" itself — which a queue has to be able
   * to do anyway for a submission withdrawn while a link to it was still in
   * a reviewer's inbox.
   *
   * The console's own staff routes keep winning their segments either way:
   * a static path beats a dynamic one segment by segment, so `/admin/orgs/1`
   * is still the orgs route and never a staff page's subtree.
   */
  ownsSubtree?: boolean
  Component: ComponentType<ConsoleStaffPageProps>
}

export interface ConsoleExtension {
  pluginId: PluginId
  displayName: string
  /** Entitlement flag gating every surface this extension registers. */
  featureFlag?: keyof OrgFeatureFlags
  /**
   * The permission a reader must hold for every surface this extension
   * registers — the AUTHORIZATION half of the sentence above `featureFlag`.
   *
   * `featureFlag` answers what the ORGANIZATION bought; this answers what
   * the PERSON reading may open, and the two are independent: an org can
   * hold a feature that most of its members have no business using.
   *
   * A key in the console's permission vocabulary, which is two spaces and
   * they are not interchangeable. Either a dotted {@link OrgPermission} from
   * the built-in catalog ('data.manage'), which the shell answers from the
   * member's resolved granular map; or a key some plugin declared through
   * `registerPluginPermissions` ('managePos'), which the shell answers from
   * the resolved permission map that carries those keys. A key belonging to
   * NEITHER space refuses the surface rather than passing it — a requirement
   * nothing can answer is not a requirement that has been met.
   *
   * Declared here rather than checked inside the page for the reason the
   * entitlement gate moved out of the pages: a check the extension performs
   * on itself is enforcement only for as long as every extension remembers
   * to perform it, and the surface has already mounted and opened its
   * listeners by the time it runs.
   *
   * Omit for a surface every member of the workspace may open.
   */
  permission?: string
  /**
   * Refusal copy for an org that does not hold `featureFlag`, rendered by
   * the shell in place of the surface. Omit to get the shell's generic
   * plan-tier sentence.
   */
  upgradeNotice?: ConsoleUpgradeNotice
  navItems?: ConsoleNavItem[]
  /**
   * Surfaces mounted at the ORGANIZATION level rather than under a site
   * (AGL-2974): each is served at `/[orgSlug]{href}` by the console's generic
   * org route and listed on the organization's tab strip.
   *
   * A separate list rather than a flag on {@link ConsoleNavItem}, because the
   * two levels are read by different consumers. The site strip, the site
   * route and every title and section lookup iterate `navItems`, and a scope
   * field on one of those entries would reach each of them as a site surface
   * until every one of them learned to skip it. Nothing that reads `navItems`
   * sees these.
   *
   * The same contract a site nav item has, with the site taken away: the
   * page receives `hostId: null` and an `orgMount` naming the organization
   * and its sites, sections resolve and gate the same way, and the
   * extension's `featureFlag` and `permission` apply unchanged. The shell
   * admits only a reader whose reach is the whole organization, because a
   * surface with no site has no scope to narrow a site collaborator to.
   *
   * The href must not name one of the console's own organization routes
   * (`/hosts`, `/team`, `/settings`, `/crm` and the rest): a named route
   * always wins over the generic one, so such a surface would never render.
   */
  orgNavItems?: ConsoleNavItem[]
  dashboardCards?: ConsoleDashboardCard[]
  settingsSections?: ConsoleSettingsSection[]
  /** Slot-addressed components the shell renders in place (AGL-419). */
  widgets?: ConsoleWidget[]
  /**
   * Built-in themes this plugin adds to every site's theme picker
   * (AGL-3404) — see {@link ConsoleThemePreset}. Loaded with the plugin at
   * the {@link THEME_PRESETS_LOAD_POINT}, which the plugin declares among its
   * `console.slots`.
   */
  themePresets?: readonly ConsoleThemePreset[]
  /**
   * The kinds of record this plugin lets the console's search find — see
   * {@link ConsoleSearchSource}. Loaded with the plugin at the
   * {@link CONSOLE_SEARCH_LOAD_POINT}, which the plugin declares among its
   * `console.slots`.
   */
  searchSources?: readonly ConsoleSearchSource[]
  /**
   * Pages in the STAFF area (AGL-2939) — see {@link ConsoleStaffPage}.
   * Neither `featureFlag` nor `permission` applies to them.
   */
  staffPages?: readonly ConsoleStaffPage[]
  /**
   * App-level providers the shell mounts around every console page
   * (AGL-419) — e.g. the marketplace plugin's AI-assist provider.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  providers?: Array<ComponentType<any>>
}

const consoleExtensions = new Map<PluginId, ConsoleExtension>()

/** Idempotent by pluginId — re-registration replaces the previous entry. */
export function registerConsoleExtension(extension: ConsoleExtension): void {
  consoleExtensions.set(extension.pluginId, extension)
}

export function unregisterConsoleExtension(pluginId: PluginId): void {
  consoleExtensions.delete(pluginId)
}

/**
 * Registration-ordered extensions; the console shell filters by flag.
 *
 * AGL-758: the registry is a module-global that only ever grows — nothing
 * outside tests unregisters, and loaded chunks can't unload — so after
 * visiting two workspaces it holds the UNION of both plugin sets. Every
 * read is therefore scoped by the caller's effective enabled set; pass the
 * current org's plugin ids so one workspace never serves another's nav
 * items, widgets, pages or providers. Omitting the argument keeps the
 * unfiltered union (tests, and non-org surfaces that have no such set).
 */
export function listConsoleExtensions(
  enabledPluginIds?: readonly PluginId[],
): ConsoleExtension[] {
  const all = Array.from(consoleExtensions.values())
  if (!enabledPluginIds) return all
  const enabled = new Set(enabledPluginIds)
  return all.filter((extension) => enabled.has(extension.pluginId))
}

/** A nav item flattened with its owning extension's id + entitlement flag. */
export interface ConsoleNavEntry extends ConsoleNavItem {
  pluginId: PluginId
  featureFlag?: keyof OrgFeatureFlags
}

/**
 * Every registered nav item, flattened for the shell's nav strip. The
 * shell appends these to its static tabs, so a plugin adds a menu item
 * by registering here — no edit to the console's nav constants.
 */
export function listConsoleNavItems(
  enabledPluginIds?: readonly PluginId[],
): ConsoleNavEntry[] {
  return inTabOrder(
    listConsoleExtensions(enabledPluginIds).flatMap((extension) =>
      (extension.navItems ?? []).filter((navItem) => !navItem.unlisted).map((navItem) => ({
        ...navItem,
        pluginId: extension.pluginId,
        featureFlag: extension.featureFlag,
      })),
    ),
    (entry) => entry.tabOrder,
  )
}

/**
 * A strip's plugin entries by {@link ConsoleNavItem.tabOrder}, lower first,
 * a tie in the order they arrived — which is registration order.
 */
function inTabOrder<T>(
  entries: readonly T[],
  tabOrderOf: (entry: T) => number | undefined,
): T[] {
  return entries
    .map((entry, index) => ({ entry, index, order: tabOrderOf(entry) ?? 0 }))
    .sort((a, b) => a.order - b.order || a.index - b.index)
    .map(({ entry }) => entry)
}

/** What {@link resolveConsolePluginPage} answers for a matched href. */
export interface ResolvedConsolePluginPage {
  extension: ConsoleExtension
  navItem: ConsoleNavItem
  /**
   * The section the href names, when the nav item declares sections and the
   * href reaches past its own. Undefined on the nav item's own href.
   */
  section?: ConsoleNavSection
  /** Path segments beneath `navItem.href`; `[]` on the nav item's own href. */
  segments: readonly string[]
  /**
   * The href was one of the nav item's `legacyHrefs`, not its current one.
   * The shell redirects to `navItem.href` plus the same section and segments.
   */
  legacy?: boolean
}

/**
 * One nav item against one href: exact, a declared section beneath it, or —
 * for a nav item that asks — anything beneath it.
 *
 * A nav item that declares neither `sections` nor `ownsSubtree` matches its
 * own href and nothing else. That is what keeps every plugin written before
 * AGL-2501 behaving as it did: without it, prefix matching would quietly hand
 * `/products/anything` to the Products page, which is the "it opened the wrong
 * page" report rather than a 404.
 */
function matchNavItem(
  navItem: ConsoleNavItem,
  href: string,
): { section?: ConsoleNavSection; segments: readonly string[]; legacy?: boolean } | undefined {
  const current = matchNavItemHref(navItem, navItem.href, href)
  if (current) return current
  for (const legacyHref of navItem.legacyHrefs ?? []) {
    const match = matchNavItemHref(navItem, legacyHref, href)
    if (match) return { ...match, legacy: true }
  }
  return undefined
}

function matchNavItemHref(
  navItem: ConsoleNavItem,
  itemHref: string,
  href: string,
): { section?: ConsoleNavSection; segments: readonly string[] } | undefined {
  if (itemHref === href) return { segments: [] }
  if (!navItem.sections?.length && !navItem.ownsSubtree) return undefined
  // On a separator boundary, so `/products` cannot claim `/products-archive`.
  if (!href.startsWith(`${itemHref}/`)) return undefined
  const segments = href.slice(itemHref.length + 1).split('/').filter(Boolean)
  const section = navItem.sections?.find((item) => item.id === segments[0])
  if (section) return { section, segments }
  // An id the nav item never declared is NOT this page — unless the surface
  // claimed the subtree, in which case the deeper segments are its own
  // entity ids and it answers for them. Returning the nav item otherwise
  // would render the surface's default section under a URL naming a
  // different one, which reads to the person who typed it as the wrong page
  // opening rather than as a typo.
  return navItem.ownsSubtree ? { segments } : undefined
}

/**
 * Resolves a host-relative href (e.g. '/events', '/products/orders') to the
 * extension + nav item that owns a renderable page for it, and the section
 * within it. The shell's generic host route uses this to render plugin pages
 * without a per-plugin page file.
 *
 * ## Which registration wins (AGL-2501)
 *
 * LONGEST declared `href` wins, and an exact match therefore always beats a
 * section match — an exact `href` spans the whole path, so nothing matching a
 * prefix of it can be longer. `/products/orders` goes to a plugin that
 * declares that path over one that declares `/products` with an `orders`
 * section, and a prefix only matches on a SEGMENT boundary, so `/products`
 * never claims `/products-archive`.
 *
 * A TIE REFUSES. Two enabled plugins matching the same path at the same length
 * resolve to nothing, and the console 404s. Registry insertion order is an
 * accident of which chunk loaded first, so picking from it means one
 * workspace serves plugin A's page at a URL where another serves plugin B's —
 * silently, and differently per session. Nobody can debug that from the
 * symptom, so it is refused and logged instead. Two nav items of the SAME
 * extension are not a tie: that order is authored, and the first wins as it
 * always has.
 *
 * This is a rule rather than an accident because the registry is a
 * session-wide UNION across plugins from different authors (AGL-758) — one
 * plugin registering `/products` and another `/products/orders` is two
 * workspaces' code meeting in one module-global, not one author's tidiness
 * problem. Scoping is unchanged and load-bearing: every candidate still comes
 * from `listConsoleExtensions(enabledPluginIds)`, so a plugin the current org
 * has not enabled cannot win a path — or collide with one.
 */
export function resolveConsolePluginPage(
  href: string,
  enabledPluginIds?: readonly PluginId[],
): ResolvedConsolePluginPage | undefined {
  return resolvePluginPageAmong(
    href,
    enabledPluginIds,
    (extension) => extension.navItems,
  )
}

/** One organization-level nav item with the extension that declared it. */
export interface ConsoleOrgNavEntry {
  extension: ConsoleExtension
  navItem: ConsoleNavItem
}

/**
 * Every registered {@link ConsoleExtension.orgNavItems} entry, in
 * {@link ConsoleNavItem.tabOrder} and then registration order, for the
 * organization's tab strip (AGL-2974).
 *
 * Carries the extension whole rather than a flattened copy of two of its
 * fields: a tab for a surface the reader cannot open is hidden, and deciding
 * that takes the extension's `permission`, `featureFlag` and
 * `upgradeNotice`, which is the same set the org route reads.
 */
export function listConsoleOrgNavItems(
  enabledPluginIds?: readonly PluginId[],
): ConsoleOrgNavEntry[] {
  return inTabOrder(
    listConsoleExtensions(enabledPluginIds).flatMap((extension) =>
      (extension.orgNavItems ?? []).map((navItem) => ({ extension, navItem })),
    ),
    (entry) => entry.navItem.tabOrder,
  )
}

/**
 * {@link resolveConsolePluginPage} for the ORGANIZATION level (AGL-2974): an
 * org-relative href (`/outreach/sequences`) against every enabled
 * extension's `orgNavItems`, with the same matching, the same longest-href
 * rule and the same refusal of a tie between two plugins. Site nav items are
 * never candidates, so a surface registered under a site cannot be opened
 * without one.
 */
export function resolveConsoleOrgPluginPage(
  href: string,
  enabledPluginIds?: readonly PluginId[],
): ResolvedConsolePluginPage | undefined {
  return resolvePluginPageAmong(
    href,
    enabledPluginIds,
    (extension) => extension.orgNavItems,
  )
}

/** The resolver both levels share; `navItemsOf` picks which list is read. */
function resolvePluginPageAmong(
  href: string,
  enabledPluginIds: readonly PluginId[] | undefined,
  navItemsOf: (extension: ConsoleExtension) => ConsoleNavItem[] | undefined,
): ResolvedConsolePluginPage | undefined {
  let best: ResolvedConsolePluginPage | undefined
  /** Extensions matching at `best`'s length — more than one is the tie. */
  let contenders: PluginId[] = []
  for (const extension of listConsoleExtensions(enabledPluginIds)) {
    for (const navItem of navItemsOf(extension) ?? []) {
      if (!navItem.Component) continue
      const match = matchNavItem(navItem, href)
      if (!match) continue
      const bestLength = best?.navItem.href.length ?? -1
      if (navItem.href.length > bestLength) {
        best = { extension, navItem, ...match }
        contenders = [extension.pluginId]
        continue
      }
      // Same length, different plugin: ambiguous. Same plugin: authored order,
      // and the first nav item keeps the path.
      if (
        navItem.href.length === bestLength &&
        !contenders.includes(extension.pluginId)
      ) {
        contenders.push(extension.pluginId)
      }
    }
  }
  if (contenders.length > 1) {
    // Loud, because the symptom — a 404 on a page that is plainly installed —
    // names neither plugin. This line is the only place the collision is
    // visible, so it carries both ids and the path they are fighting over.
    console.error(
      `[aglyn] console page path "${href}" is claimed by more than one ` +
        `enabled plugin (${contenders.join(', ')}); refusing to guess which ` +
        'one owns it. Change one plugin\'s nav item href.',
    )
    return undefined
  }
  return best
}

/** A staff page flattened with its owning extension's id. */
export interface ConsoleStaffPageEntry extends ConsoleStaffPage {
  pluginId: PluginId
}

/**
 * Every registered staff page, in registration order — the staff strip's
 * plugin tabs, after the console's own.
 */
export function listConsoleStaffPages(
  enabledPluginIds?: readonly PluginId[],
): ConsoleStaffPageEntry[] {
  return listConsoleExtensions(enabledPluginIds).flatMap((extension) =>
    (extension.staffPages ?? []).map((page) => ({
      ...page,
      pluginId: extension.pluginId,
    })),
  )
}

/**
 * The staff page at `/admin/{id}` (AGL-2939), or `undefined`.
 *
 * Two plugins claiming one id resolve to nothing, and say so: registry order
 * is an accident of which chunk loaded first, and a staff page that is one
 * plugin's on one load and another's on the next cannot be debugged from the
 * symptom — the same rule {@link resolveConsolePluginPage} applies to paths.
 */
export function resolveConsoleStaffPage(
  id: string,
  enabledPluginIds?: readonly PluginId[],
): ConsoleStaffPageEntry | undefined {
  const matches = listConsoleStaffPages(enabledPluginIds).filter(
    (page) => page.id === id,
  )
  const owners = [...new Set(matches.map((page) => page.pluginId))]
  if (owners.length > 1) {
    console.error(
      `[aglyn] staff page "/admin/${id}" is claimed by more than one plugin ` +
        `(${owners.join(', ')}); refusing to guess which one owns it. ` +
        "Change one plugin's staff page id.",
    )
    return undefined
  }
  return matches[0]
}

/** Widgets registered for a slot, across every extension (AGL-419). */
export function listConsoleWidgets(
  slot: string,
  enabledPluginIds?: readonly PluginId[],
): Array<{ extension: ConsoleExtension; widget: ConsoleWidget }> {
  const out: Array<{ extension: ConsoleExtension; widget: ConsoleWidget }> = []
  for (const extension of listConsoleExtensions(enabledPluginIds)) {
    for (const widget of extension.widgets ?? []) {
      if (widget.slot === slot) out.push({ extension, widget })
    }
  }
  return out
}

/**
 * A built-in theme a plugin contributes (AGL-3404): a complete, JSON
 * {@link HostTheme} a site can pick on Setup → Theme.
 *
 * Picking one COPIES it onto the site, and the site's edits are an override
 * on top, so a preset is never modified by a site and a later version of the
 * plugin never repaints a site that did not pick it again. That is also why a
 * preset needs no server surface: the console sends the picked theme with the
 * request.
 */
export interface ConsoleThemePreset {
  /**
   * Unique across every plugin, and persisted in the site's selection — so
   * namespace it with the plugin (`themes.bootstrap`) and never rename it.
   */
  id: string
  /** The name in the picker. */
  name: string
  /** One line under the name: what the theme looks like. */
  description?: string
  theme: HostTheme
}

/**
 * The load point a plugin contributing theme presets declares in its
 * `console.slots`, and the theme page loads before it lists them — so the
 * presets' code is fetched there and nowhere else.
 */
export const THEME_PRESETS_LOAD_POINT = 'hostThemePresets'

/**
 * Every built-in theme the enabled plugins contribute, in registration order,
 * with the plugin each came from. A second preset with an id already listed
 * is dropped rather than shown twice, so two plugins cannot make one entry of
 * the picker ambiguous.
 */
export function listConsoleThemePresets(
  enabledPluginIds?: readonly PluginId[],
): Array<ConsoleThemePreset & { pluginId: PluginId }> {
  const seen = new Set<string>()
  const out: Array<ConsoleThemePreset & { pluginId: PluginId }> = []
  for (const extension of listConsoleExtensions(enabledPluginIds)) {
    for (const preset of extension.themePresets ?? []) {
      if (!preset?.id || seen.has(preset.id)) continue
      seen.add(preset.id)
      out.push({ ...preset, pluginId: extension.pluginId })
    }
  }
  return out
}

/**
 * A kind of record a plugin lets the console's search find (AGL-3080): the
 * collection its rows are read from, the fields a row is named and matched
 * by, and where a row opens.
 *
 * The palette reads a source the way it reads the console's own groups — one
 * capped window per collection, ordered by document id and matched in the
 * browser — so a source describes a read the Firestore rules already admit
 * and needs no index of its own. `host` reads `hosts/{hostId}/{collection}`
 * under the site that is open; `orgData` reads `orgs/{orgId}/{collection}`,
 * the organization's shared data, through the reader's `visibleTo` tokens
 * under a site (the predicate the rules evaluate) and unfiltered at the
 * organization level, where only an org-wide member is offered it.
 *
 * Gated as every surface the extension registers is: the plugin must be on
 * for the workspace and the site, and the extension's `featureFlag` and
 * `permission` compose with the source's own. A source the reader may not
 * open is never read, because a row that links to a page the reader is
 * refused is a dead row.
 */
export interface ConsoleSearchSource {
  /**
   * The group's id, unique across the palette: its rows, its cache and its
   * key in the rendered list are held under it. Name it by the plugin's own
   * words (`contacts`, `products`) and keep it stable.
   */
  id: string
  /** The heading above the group's rows. */
  group: string
  /** The kind in a sentence: "Only the first 30 {noun} were searched." */
  noun: string
  /** Where the collection hangs, which decides the path and who may read it. */
  scope: 'host' | 'orgData'
  /** The collection's name under the scope's root. */
  collection: string
  /** The field holding a row's human-readable name. */
  nameField: string
  /** The field a row is labeled by when `nameField` is empty. */
  fallbackNameField?: string
  /** Further fields a reader may find a row by (an address, a slug). */
  extraFields?: readonly string[]
  /**
   * A plan quota that must be non-zero for the group to be read at all: a
   * collection the organization cannot hold costs a read to render nothing.
   */
  entitlementKey?: string
  /** A plan flag this group needs beyond the extension's `featureFlag`. */
  featureFlag?: keyof OrgFeatureFlags
  /** A permission this group needs beyond the extension's `permission`. */
  permission?: string
  /**
   * Where the group is listed, ascending. The console's own groups hold 10
   * (sites), 20 (pages), 30 (emails) and 100 to 140 (components, layouts,
   * templates, content, authors); equal numbers keep registration order.
   */
  order: number
  /**
   * Where one row opens, or `null` when it cannot be addressed from here — a
   * row with nowhere to go is dropped rather than drawn dead. `host` is the
   * open site's subdomain, or `null` at the organization level.
   */
  href(
    row: Readonly<Record<string, unknown>>,
    context: ConsoleSearchLinkContext,
  ): string | null
}

/** The two route params a search row is linked from. */
export interface ConsoleSearchLinkContext {
  orgSlug: string
  host: string | null
}

/**
 * The load point a plugin contributing search sources declares in its
 * `console.slots`, and the palette loads before it lists them.
 */
export const CONSOLE_SEARCH_LOAD_POINT = 'consoleSearch'

/**
 * Every search source the enabled plugins contribute, with the extension
 * each came from so the caller can apply its gates. A second source with an
 * id already listed is dropped, so two plugins cannot share one group.
 */
export function listConsoleSearchSources(
  enabledPluginIds?: readonly PluginId[],
): Array<{ extension: ConsoleExtension; source: ConsoleSearchSource }> {
  const seen = new Set<string>()
  const out: Array<{ extension: ConsoleExtension; source: ConsoleSearchSource }> = []
  for (const extension of listConsoleExtensions(enabledPluginIds)) {
    for (const source of extension.searchSources ?? []) {
      if (!source?.id || seen.has(source.id)) continue
      seen.add(source.id)
      out.push({ extension, source })
    }
  }
  return out
}

/** Providers registered by every extension, in registration order. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function listConsoleProviders(
  enabledPluginIds?: readonly PluginId[],
): Array<ComponentType<any>> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const out: Array<ComponentType<any>> = []
  for (const extension of listConsoleExtensions(enabledPluginIds)) {
    out.push(...(extension.providers ?? []))
  }
  return out
}
