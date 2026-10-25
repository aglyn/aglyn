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

import type { InstallableArtifactType as MarketplaceArtifactType } from '@aglyn/aglyn/app-utils/artifact-provenance'

/**
 * The marketplace's catalog vocabulary, pure (AGL-3668): what each artifact
 * type is called, where each installs, the categories, a plugin's install
 * state from its two pins, and which route installs a type and what its
 * install says. The native apps generate from it; `marketplace.ts` and the
 * install hook re-export and use it.
 */

/**
 * Human-readable label for each artifact type (AGL-864).
 *
 * Shared by browse cards, the listing detail page, and the seller panel so
 * "what kind of thing is this" reads the same everywhere. Resolve a listing's
 * label through {@link listingArtifactLabel}, which tolerates the legacy
 * `type`/`kind` shape the way {@link listingArtifactType} does.
 */
export const ARTIFACT_TYPE_LABELS: Record<MarketplaceArtifactType, string> = {
  plugin: 'Plugin',
  component: 'Component',
  template: 'Site template',
  layout: 'Layout',
  datasetSchema: 'Dataset schema',
  emailTemplate: 'Email template',
  emailStarter: 'Email starter',
  theme: 'Theme',
  siteStarter: 'Site starter',
}

/** Where an installed artifact lives. */
export type InstallTarget = 'org' | 'host'

/**
 * Install targets each artifact type actually supports (AGL-656).
 *
 * This is not a policy choice — it is where the install routes physically
 * write. Only plugins have an org-scoped pin
 * (`orgs/{orgId}/installs/{listingId}`, applying to every site, shadowed by
 * a host pin). Components land in `hosts/{h}/components`, templates and
 * layouts in `hosts/{h}/templates`: all host-scoped by nature, because a
 * screen tree belongs to a site.
 *
 * Exported so the UI can ask rather than assume — an install picker that
 * offers "this whole organization" for a template would be lying.
 */
export const INSTALL_TARGETS: Record<
  MarketplaceArtifactType,
  readonly InstallTarget[]
> = {
  plugin: ['org', 'host'],
  component: ['host'],
  template: ['host'],
  layout: ['host'],
  // Dataset schemas are org-shared data (AGL-237), so they install at org
  // scope — as a new empty dataset, not a pin (AGL-657).
  datasetSchema: ['org'],
  emailTemplate: ['host'],
  // A campaign email is a screen, and a screen belongs to a site.
  emailStarter: ['host'],
  // A theme is one site's visual identity, written to `hosts/{h}.theme`
  // (AGL-1020). Applying one org-wide would repaint every site at once from a
  // control that says "install".
  theme: ['host'],
  // A site starter installs by creating a site from it (AGL-4049), never
  // into an existing one.
  siteStarter: ['host'],
}

/** A plugin install pin — the version-pinned doc the install API writes. */
export interface InstallPin {
  version?: number | string
}

/**
 * The install state of a plugin listing for one site, told honestly (AGL-656).
 *
 * A plugin can be pinned at two scopes: the org pin
 * (`orgs/{orgId}/installs/{listingId}`) applies to every site, and a host pin
 * (`hosts/{hostId}/installs/{listingId}`) applies to just this one AND shadows
 * the org pin. Detecting installs from `hosts/{h}/components` — the COMPONENT
 * collection — never sees either pin, so an installed plugin used to read as
 * "not installed" on both the browse grid and the detail page. This resolves
 * the effective state from the two pins the way the loader does.
 */
export interface PluginInstallState {
  /** Effective pin scope for this site — host wins over org — or null. */
  scope: InstallTarget | null
  /** Version pinned at the effective scope, or null when not installed. */
  installedVersion: string | null
  /** Both pins exist: the host pin takes precedence, shadowing the org one. */
  shadowed: boolean
  /** Installed, but the pinned version is behind the listing's latest. */
  updateAvailable: boolean
}

/**
 * Resolves a plugin listing's install state for a site from its two pins
 * (AGL-656). The host pin shadows the org pin, mirroring the loader, so the
 * effective version and update prompt always describe what actually runs here.
 */
export function resolvePluginInstallState(
  latestVersion: number | string | undefined,
  hostPin: InstallPin | null | undefined,
  orgPin: InstallPin | null | undefined,
): PluginInstallState {
  const effective = hostPin ?? orgPin ?? null
  const installedVersion =
    effective?.version != null ? String(effective.version) : null
  return {
    scope: hostPin ? 'host' : orgPin ? 'org' : null,
    installedVersion,
    shadowed: Boolean(hostPin && orgPin),
    // Any difference is an upgrade prompt, matching the installed-plugins card
    // — pins only ever move forward, so "different" means "behind".
    updateAvailable:
      installedVersion != null &&
      latestVersion != null &&
      String(latestVersion) !== installedVersion,
  }
}

/** Fixed category taxonomy for marketplace listings (AGL-430). */
export const LISTING_CATEGORIES: readonly string[] = [
  'analytics',
  'automation',
  'commerce',
  'communication',
  'content',
  'design',
  'forms',
  'integrations',
  'marketing',
  'productivity',
  'seo',
  'security',
] as const

/**
 * Each artifact type has its own installer route (AGL-672): routing
 * everything to the component one silently installed the wrong thing or
 * 404'd. `listingArtifactType` tolerates the legacy `type`/`kind`
 * discriminators (AGL-654).
 */
export function marketplaceInstallEndpoint(artifactType: string): string {
  switch (artifactType) {
    case 'template':
      return 'marketplace/install-template'
    case 'layout':
      return 'marketplace/install-layout'
    case 'plugin':
      return 'marketplace/install-plugin'
    case 'datasetSchema':
      return 'marketplace/install-dataset-schema'
    case 'emailTemplate':
      return 'marketplace/install-email-template'
    case 'emailStarter':
      return 'marketplace/install-email-starter'
    case 'theme':
      return 'marketplace/install-theme'
    default:
      return 'marketplace/install'
  }
}

/**
 * Artifact types whose install deliberately does NOT touch the running site
 * (AGL-669/671/657) — the copy must not imply otherwise. Templates and layouts
 * land in the Templates library; an email template lands as an inactive
 * version the owner still has to activate.
 */
export function marketplaceLandingMessage(
  artifactType: string,
  displayName: string,
): string | null {
  switch (artifactType) {
    case 'template':
    case 'layout':
      return (
        `Saved "${displayName}" to your Templates — nothing is live until ` +
        'you use it.'
      )
    case 'emailTemplate':
      return (
        `Saved "${displayName}" as a draft version — activate it in the ` +
        'email designer to start sending it.'
      )
    case 'emailStarter':
      // A copy, and saying so is the point: the publisher cannot reach it
      // again, and nothing goes out until a campaign is sent from it.
      return (
        `Added "${displayName}" to your Email templates as your own copy — ` +
        'edit it freely, nothing is sent until you send a campaign.'
      )
    case 'datasetSchema':
      return `Created "${displayName}" as a new, empty dataset.`
    case 'theme':
      // The one type that DOES change the running site on install, so it gets
      // the opposite of the reassurance the others get — plus the way back,
      // because a repainted site is alarming if you cannot see how to undo it.
      return (
        `Applied "${displayName}" to this site. Setup → Theme has a way back ` +
        'to your previous theme.'
      )
    default:
      return null
  }
}

/**
 * ─── WHAT A PLUGIN'S PAGE SAYS ABOUT ITS INSTALLS (AGL-1016, AGL-997, AGL-1027, AGL-3671) ───
 *
 * The version comparison, the update status, the org-wide picture of one listing's pins, which sites an
 * uninstall touches and the sentences the workspace's plugin pages and their dialogs say about them. All of
 * it was spread across `update-state.ts`, `marketplace.ts` and the plugin-site-set components; it lives here,
 * pure, so the native apps replay the very same answers (`libs/native/contracts/function-cases.generated.json`).
 * Those modules re-export what moved.
 */

/**
 * Orders two artifact versions, or returns null when they cannot be ordered.
 *
 * Two numbering schemes are in play and both are real: copied artifacts get a
 * monotonic integer from the publish route, plugins get the semver string off
 * their manifest. A single string compare handles neither ("10" < "9",
 * "1.10.0" < "1.9.0"), so both are parsed as dotted numbers — which covers the
 * integer case as a one-segment version.
 *
 * Anything non-numeric (a prerelease tag, a date-stamped build) is not ordered
 * by guesswork: unequal-and-incomparable is reported as such and surfaces as
 * `unknown`, which is honest, where a string compare would confidently point
 * an update button at an older build.
 */
export function compareArtifactVersions(
  a: string | number | null | undefined,
  b: string | number | null | undefined,
): -1 | 0 | 1 | null {
  if (a == null || b == null || a === '' || b === '') return null
  const left = String(a)
  const right = String(b)
  if (left === right) return 0
  const parse = (value: string): number[] | null => {
    const parts = value.split('.')
    const numbers: number[] = []
    for (const part of parts) {
      if (!/^\d+$/.test(part)) return null
      numbers.push(Number(part))
    }
    return numbers.length ? numbers : null
  }
  const leftParts = parse(left)
  const rightParts = parse(right)
  if (!leftParts || !rightParts) return null
  const length = Math.max(leftParts.length, rightParts.length)
  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0
    const rightPart = rightParts[index] ?? 0
    if (leftPart < rightPart) return -1
    if (leftPart > rightPart) return 1
  }
  // Equal numerically but not as strings — "1.0" and "1.0.0" are the same
  // version written two ways.
  return 0
}

export type UpdateState =
  /** Running the newest version the publisher offers. */
  | 'current'
  /** A newer version exists and can be taken. */
  | 'update-available'
  /**
   * Installed version is NEWER than what is offered. Not a bug: a publisher
   * installs their own unapproved version to test it, and a version can be
   * withdrawn after someone installed it.
   */
  | 'ahead'
  /** Not enough is known to say — no provenance, or nothing published to compare. */
  | 'unknown'

export interface UpdateStatus {
  state: UpdateState
  /** The version running, or null when provenance cannot say. */
  installedVersion: string | null
  /** The newest version on offer — for plugins, the newest APPROVED one. */
  availableVersion: string | null
  /**
   * Why the answer is `unknown`, for a UI that should say which kind of
   * silence this is rather than implying the artifact is current.
   */
  unknownReason?: 'no-provenance' | 'nothing-published' | 'incomparable'
}

/**
 * One sentence describing an update state, so four surfaces do not each invent
 * their own wording for the same fact.
 */
export function updateStateLabel(status: UpdateStatus): string {
  switch (status.state) {
    case 'update-available':
      return `You have v${status.installedVersion} · v${status.availableVersion} available`
    case 'current':
      return `Up to date · v${status.installedVersion}`
    case 'ahead':
      return `You have v${status.installedVersion}, newer than the published v${status.availableVersion}`
    default:
      return status.unknownReason === 'nothing-published'
        ? 'No published version to compare against'
        : status.unknownReason === 'incomparable'
          ? `You have v${status.installedVersion}; v${status.availableVersion} cannot be ordered against it`
          : 'Installed before update tracking — version unknown'
  }
}

/** The pin fields an update comparison reads, in every shape the install routes have written. */
export interface UpdateComparablePin {
  version?: unknown
  installedFrom?: { listingId?: string; version?: unknown } | null
  marketplace?: { listingId?: string; version?: unknown } | null
  source?: { listingId?: string; version?: unknown } | null
  listingId?: string
}

/**
 * What a listing OFFERS right now (the plugin branch of `offeredPluginVersion`): the newest approved version, unless a
 * revocation (`versions` naming it, or `'all'`) has stopped it, in which case nothing is offered.
 */
export function pluginOfferedVersion(
  latestApprovedVersion: unknown,
  revocationVersions: readonly string[] | 'all' | null | undefined,
): string | null {
  const offered = String(latestApprovedVersion ?? '')
  if (!offered) return null
  if (revocationVersions === 'all') return null
  return Array.isArray(revocationVersions) && revocationVersions.includes(offered) ? null : offered
}

/**
 * Whether the installed plugin is still what the publisher ships (the plugin branch of `resolveUpdateState`): the
 * pin's version against the version on offer. A pin that names no listing is the one shape that records no version
 * (`no-provenance`).
 */
export function pluginUpdateStatus(
  pin: UpdateComparablePin | null | undefined,
  offeredVersion: string | null | undefined,
): UpdateStatus {
  const unknown: UpdateStatus = { state: 'unknown', installedVersion: null, availableVersion: null, unknownReason: 'no-provenance' }
  if (!pin) return unknown
  const recorded = pin.installedFrom?.listingId
    ? pin.installedFrom.version
    : pin.marketplace?.listingId
      ? pin.marketplace.version
      : pin.source?.listingId
        ? pin.source.version
        : pin.listingId
          ? pin.version
          : undefined
  const installedVersion = recorded == null || recorded === '' ? null : String(recorded)
  if (!installedVersion) return unknown
  if (offeredVersion == null || offeredVersion === '') {
    return { state: 'unknown', installedVersion, availableVersion: null, unknownReason: 'nothing-published' }
  }
  const availableVersion = String(offeredVersion)
  const order = compareArtifactVersions(installedVersion, availableVersion)
  if (order === null) return { state: 'unknown', installedVersion, availableVersion, unknownReason: 'incomparable' }
  return { state: order === 0 ? 'current' : order < 0 ? 'update-available' : 'ahead', installedVersion, availableVersion }
}


/** One site's slice of an org-scope install picture (AGL-997). */
export interface OrgInstallSite {
  hostId: string
  label: string
  /** The version that actually runs here, from the effective pin. */
  version: string | null
  /** Where that pin lives — a host pin shadows the org one, as the loader does. */
  pinnedBy: InstallTarget
  /** This site has its OWN pin on top of an org pin. */
  shadowed: boolean
}

/**
 * The whole org's install picture for one listing (AGL-997).
 *
 * At org scope, "installed" is a SET, not a boolean. The detail page used to
 * resolve state against the single acting host, so a plugin installed on one
 * of five sites reported "Installed on this site" — describing one arbitrary
 * site and staying silent about the other four — and offered an Uninstall
 * that was all-or-nothing.
 *
 * `orgWide` and per-site pins are not exclusive: an org pin covers every
 * site including ones created later, and a host pin on top of it shadows it
 * for that one site. Both facts have to survive into the UI, which is why
 * this returns the sites AND the pins rather than a single scope.
 */
export interface OrgInstallSummary {
  /** An org pin exists: every site is covered, including future ones. */
  orgWide: boolean
  /** Version of the org pin, when there is one. */
  orgVersion: string | null
  /** Every site the listing effectively runs on. */
  sites: OrgInstallSite[]
  /** Sites carrying their own removable host pin. */
  hostPinnedIds: string[]
  /** Sites with no pin of their own and no org pin covering them. */
  availableHostIds: string[]
  installedAnywhere: boolean
}

export function resolveOrgInstallSummary(
  hosts: ReadonlyArray<{ id: string; label: string }>,
  hostPins: Readonly<Record<string, InstallPin | null | undefined>>,
  orgPin: InstallPin | null | undefined,
): OrgInstallSummary {
  const orgWide = Boolean(orgPin)
  const orgVersion = orgPin?.version != null ? String(orgPin.version) : null
  const sites: OrgInstallSite[] = []
  const hostPinnedIds: string[] = []
  const availableHostIds: string[] = []
  for (const host of hosts) {
    const hostPin = hostPins[host.id]
    if (hostPin) hostPinnedIds.push(host.id)
    if (!hostPin && !orgPin) {
      availableHostIds.push(host.id)
      continue
    }
    sites.push({
      hostId: host.id,
      label: host.label,
      version:
        hostPin?.version != null ? String(hostPin.version) : orgVersion,
      pinnedBy: hostPin ? 'host' : 'org',
      shadowed: Boolean(hostPin && orgPin),
    })
  }
  return {
    orgWide,
    orgVersion,
    sites,
    hostPinnedIds,
    availableHostIds,
    installedAnywhere: orgWide || hostPinnedIds.length > 0,
  }
}

/** One site an uninstall would touch, and whether it really loses the plugin. */
export interface UninstallTarget {
  hostId: string
  label: string
  /**
   * The plugin keeps running here. Removing a HOST pin while an org pin still
   * covers the site, or the ORG pin while the site holds its own host pin,
   * changes which pointer is in use and nothing a visitor can see.
   */
  stillCovered: boolean
}

/**
 * Which sites an uninstall actually affects (AGL-1027).
 *
 * The shadowing case is the whole reason this is a function rather than a
 * filter at the call site. A pin is not a boolean per site: an org pin covers
 * everything, a host pin names one site, and where both exist the host pin
 * wins. So "remove" means three different things depending on which pointer is
 * being dropped and what is left underneath — and the one thing the dialog must
 * never do is tell someone a plugin will stop working when it will not.
 *
 * Returns every site the operation touches, including the ones that keep the
 * plugin, so the dialog can say so explicitly instead of omitting them and
 * leaving the count unexplained.
 */
export function resolveUninstallTargets(
  orgInstall: OrgInstallSummary,
  scope: 'org' | 'host',
  hostId?: string,
): UninstallTarget[] {
  if (scope === 'host') {
    const site = orgInstall.sites.find((entry) => entry.hostId === hostId)
    if (!site) return []
    // Its own pin goes; the org pin, if there is one, still covers it.
    return [
      { hostId: site.hostId, label: site.label, stillCovered: orgInstall.orgWide },
    ]
  }
  // Dropping the org pin: every site loses it EXCEPT those holding a host pin
  // of their own, which were already shadowing the org pin anyway.
  return orgInstall.sites.map((site) => ({
    hostId: site.hostId,
    label: site.label,
    stillCovered: site.pinnedBy === 'host',
  }))
}

// ─── The sentences of a plugin's install pages and their dialogs (AGL-1017, AGL-1027, AGL-3671) ───

/** The sites of an org-wide picture whose running version is behind the one on offer. */
export function staleSites(sites: readonly OrgInstallSite[], latestVersion: string | number | null | undefined): OrgInstallSite[] {
  return sites.filter((site) => (compareArtifactVersions(site.version, latestVersion) ?? 0) < 0)
}

/** What "Where it runs" opens with: the whole organization, or how many of its sites. */
export function pluginSiteSetSummary(install: OrgInstallSummary, siteCount: number): string {
  return install.orgWide
    ? `Installed for the whole organization (v${install.orgVersion}) — every site, including ones you add later.`
    : `Installed on ${install.sites.length} of ${siteCount} sites.`
}

/** What the update confirmation says: the plugin, the version it moves to and where, and what stays put. */
export function pluginUpdatePrompt(input: {
  name: string
  latestVersion: string
  label: string
  /** The update is for one site: other sites stay on the version they run. */
  singleSite: boolean
}): { title: string; body: string; others: string | null; note: string } {
  return {
    title: `Update to v${input.latestVersion}?`,
    body: `${input.name} moves from the version running now to v${input.latestVersion} on ${input.label}.`,
    others: input.singleSite ? 'Other sites stay on the version they are running.' : null,
    note: 'Pins only move forward — there is no going back to the previous version from here.',
  }
}

/** What the update button of a pin that is org-wide, or of the stale per-site ones, is called and aims at. */
export function pluginUpdateAll(install: OrgInstallSummary, stale: readonly OrgInstallSite[], latestVersion: string) {
  return {
    label: install.orgWide ? `Update to v${latestVersion}` : `Update all ${stale.length} to v${latestVersion}`,
    target: install.orgWide ? 'every site in this organization' : `${stale.length} site${stale.length === 1 ? '' : 's'}`,
    hostIds: install.orgWide ? null : stale.map((site) => site.hostId),
  }
}

/** The notice above an org-wide update: one pin moves every site at once. */
export const PLUGIN_ORG_WIDE_UPDATE_NOTE =
  'This is one organization-wide pin, so updating moves every site at once. To take a version on one site first, install per site instead.'

/** One site an uninstall dialog was told about by the impact check. */
export interface UninstallImpactSite {
  hostId: string
  label: string
  stillCovered: boolean
  placements: Array<{ type: 'screen' | 'layout' | 'component'; id: string; name: string; count: number }>
  affectedScreens: number
  truncated: boolean
}

/** What `/api/hosts/plugin-impact` answers. */
export interface UninstallImpact {
  sites: UninstallImpactSite[]
  losingSites: number
  placements: number
  affectedScreens: number
  truncated: boolean
  dataSurvives: boolean
}

/** The word typed to confirm an uninstall that breaks pages, or whose impact could not be checked. */
export const UNINSTALL_ACKNOWLEDGEMENT = 'UNINSTALL'

/** What the uninstall dialog shows, worked out from the targets and the impact check's answer. */
export interface UninstallImpactView {
  title: string
  confirmLabel: string
  /** The check is still running. */
  scanning: boolean
  /** Alerts above the sites, in order. */
  alerts: Array<{ tone: 'warning' | 'error' | 'info'; text: string }>
  /** Sites that lose the plugin and place it on pages: the site, how many pages, and the chips. */
  sites: Array<{ label: string; pages: string; chips: string[] }>
  /** The closing note, when sites lose the plugin. */
  note: string | null
  /** Pages stop rendering it, or the check could not say: the person types {@link UNINSTALL_ACKNOWLEDGEMENT}. */
  needsAcknowledgement: boolean
}

const PLACEMENT_NOUNS = { screen: 'page', layout: 'layout', component: 'component' } as const

/** The uninstall dialog (`UninstallImpactDialog`) as data, so every client says the same things. */
export function uninstallImpactView(input: {
  name: string
  scope: 'org' | 'host'
  /** The listing's plugin id; without one the placements cannot be found. */
  pluginId: string
  targets: readonly UninstallTarget[]
  /** The impact check's answer, once it has come. */
  impact: UninstallImpact | null
  /** The impact check failed. */
  failed: boolean
}): UninstallImpactView {
  const { name, scope, pluginId, targets, impact, failed } = input
  const losing = targets.filter((target) => !target.stillCovered)
  const covered = targets.filter((target) => target.stillCovered)
  const scanning = Boolean(pluginId) && losing.length > 0 && !impact && !failed
  const affected = impact?.affectedScreens ?? 0
  const unknown = failed || (!pluginId && losing.length > 0)
  const alerts: UninstallImpactView['alerts'] = []
  if (unknown && !scanning) {
    alerts.push({
      tone: 'warning',
      text: pluginId
        ? 'The impact check could not run, so this cannot say what would stop working. Nothing here means "nothing breaks".'
        : 'This listing records no plugin id, so its placements cannot be found. Pages using it may stop rendering it.',
    })
  }
  if (!scanning && !unknown && affected > 0) {
    const sites = impact?.losingSites ?? losing.length
    alerts.push({
      tone: 'error',
      text:
        `Removes ${name} from ${sites} site${sites === 1 ? '' : 's'}; ` +
        `${impact?.truncated ? 'at least ' : ''}${affected} published page${affected === 1 ? '' : 's'} ` +
        `place${affected === 1 ? 's' : ''} it and will stop rendering it.`,
    })
  }
  if (!scanning && !unknown && affected === 0 && losing.length) {
    alerts.push({ tone: 'info', text: 'No published page places this plugin, so nothing visitors can see changes.' })
  }
  if (covered.length) {
    alerts.push({
      tone: 'info',
      text:
        covered.length === targets.length
          ? `The plugin keeps running on ${covered.length === 1 ? 'this site' : `all ${covered.length} of these sites`}, ` +
            `because another install still covers ${covered.length === 1 ? 'it' : 'them'}. Only which version is in use changes.`
          : `${covered.length} of these sites keep the plugin — ${covered.map((target) => target.label).join(', ')} — ` +
            'because another install still covers them.',
    })
  }
  const sites = (impact?.sites ?? [])
    .filter((site) => !site.stillCovered && site.placements.length)
    .map((site) => ({
      label: site.label,
      pages: `${site.affectedScreens} published page${site.affectedScreens === 1 ? '' : 's'} affected`,
      chips: [
        ...site.placements
          .slice(0, 12)
          .map((placement) => `${PLACEMENT_NOUNS[placement.type]}: ${placement.name}${placement.count > 1 ? ` ×${placement.count}` : ''}`),
        ...(site.placements.length > 12 ? [`+${site.placements.length - 12} more`] : []),
      ],
    }))
  return {
    title: scope === 'org' ? `Uninstall ${name} across the organization?` : `Remove ${name} from this site?`,
    confirmLabel: scope === 'org' ? 'Uninstall org-wide' : 'Remove',
    scanning,
    alerts,
    sites,
    note:
      !scanning && losing.length
        ? 'Uninstalling removes the install only. The plugin’s settings and any data it stored are kept, and installing it again restores the pages that place it.'
        : null,
    needsAcknowledgement: !scanning && (affected > 0 || unknown),
  }
}

/** What a run of installs (an install, an update, or the several steps of one) says once it is done. */
export function installPlanOutcome(input: {
  name: string
  /** Steps that went through, and the refusals of those that did not. */
  installed: number
  errors: readonly string[]
  /** One of the steps was the org-wide pin. */
  orgWide: boolean
  /** The steps moved existing pins to {@link version}. */
  updating: boolean
  version?: string | null
  /** The artifact lands in a library and is not live (a template, a layout): "Saved", not "Installed". */
  saved?: boolean
}): { tone: 'success' | 'warning' | 'error'; text: string } {
  const { name, installed, errors, orgWide, updating, version, saved } = input
  const noun = updating ? 'Updated' : saved ? 'Saved' : 'Installed'
  const toVersion = updating && version != null ? ` to v${version}` : ''
  if (installed && !errors.length) {
    return {
      tone: 'success',
      text: orgWide
        ? `${noun} "${name}"${toVersion} for the whole organization`
        : `${noun} "${name}"${toVersion} on ${installed} site${installed === 1 ? '' : 's'}`,
    }
  }
  if (installed && errors.length) {
    return { tone: 'warning', text: `${noun} on ${installed} site(s); ${errors.length} failed — ${errors[0]}` }
  }
  return { tone: 'error', text: errors[0] ?? 'Install failed' }
}

/** The row of the plugins list for one install: the version and where it runs. */
export function installedPluginCaption(input: { version?: unknown; orgWide: boolean; siteLabels: readonly string[] }): string {
  return (
    `v${input.version} · ` +
    (input.orgWide ? 'every site in this organization' : input.siteLabels.length === 1 ? input.siteLabels[0] : `${input.siteLabels.length} sites`)
  )
}

// ─── A marketplace plugin's settings, from its manifest (AGL-428, AGL-3671) ───

const MANIFEST_CONFIG_FIELD_LIMIT = 50
const MANIFEST_CONFIG_FIELD_TYPES: ReadonlySet<string> = new Set(['string', 'number', 'boolean', 'select'])

interface ManifestConfigField {
  key: string
  label: string
  type: 'string' | 'number' | 'boolean' | 'select'
  description?: string
  options?: Array<{ value: string; label: string }>
  min?: number
  max?: number
}

/** A stored or declared value as its field takes it (`coerce` of `plugin-config.ts`), else [fallback]. */
function coerceManifestConfigValue(field: ManifestConfigField, raw: unknown, fallback: unknown): unknown {
  switch (field.type) {
    case 'boolean':
      return typeof raw === 'boolean' ? raw : fallback
    case 'number': {
      const value = typeof raw === 'number' && Number.isFinite(raw) ? raw : NaN
      if (Number.isNaN(value)) return fallback
      if (field.min != null && value < field.min) return field.min
      if (field.max != null && value > field.max) return field.max
      return value
    }
    case 'select': {
      const value = typeof raw === 'string' ? raw : undefined
      return field.options?.some((option) => option.value === value) ? value : fallback
    }
    default:
      return typeof raw === 'string' ? raw : fallback
  }
}

/**
 * The fields a plugin's MANIFEST declares for its settings and the values they start from (`pluginConfigSchemaFromManifest`
 * of `plugin-config.ts`, which this repeats without its imports so the native apps replay it). Everything is re-validated
 * rather than trusted: a junk type drops the field, a duplicate key drops the second, a select with nothing to select is
 * dropped, and the count is capped. `null` when the manifest declares nothing usable, which means "this plugin has no
 * settings".
 */
export function manifestSettingsFields(manifest: unknown): { fields: ManifestConfigField[]; defaults: Record<string, unknown> } | null {
  const declared = (manifest as { config?: unknown } | null | undefined)?.config
  const rawFields = (declared as { fields?: unknown } | undefined)?.fields
  if (!Array.isArray(rawFields)) return null
  const seen = new Set<string>()
  const fields: ManifestConfigField[] = []
  for (const raw of rawFields) {
    if (fields.length >= MANIFEST_CONFIG_FIELD_LIMIT) break
    const entry = raw as Record<string, unknown> | null
    const key = typeof entry?.['key'] === 'string' ? entry['key'].trim() : ''
    if (!key || seen.has(key)) continue
    const type = String(entry?.['type'] ?? 'string')
    if (!MANIFEST_CONFIG_FIELD_TYPES.has(type)) continue
    const options = Array.isArray(entry?.['options'])
      ? (entry['options'] as unknown[])
          .map((option) => option as Record<string, unknown> | null)
          .filter((option) => typeof option?.['value'] === 'string' && typeof option?.['label'] === 'string')
          .map((option) => ({ value: String(option?.['value']), label: String(option?.['label']) }))
      : undefined
    if (type === 'select' && !options?.length) continue
    seen.add(key)
    fields.push({
      key,
      label: typeof entry?.['label'] === 'string' && entry['label'].trim() ? String(entry['label']).slice(0, 120) : key,
      type: type as ManifestConfigField['type'],
      description: typeof entry?.['description'] === 'string' ? String(entry['description']).slice(0, 400) : undefined,
      options,
      min: typeof entry?.['min'] === 'number' ? entry['min'] : undefined,
      max: typeof entry?.['max'] === 'number' ? entry['max'] : undefined,
    })
  }
  if (!fields.length) return null
  const rawDefaults = (declared as { defaults?: unknown } | undefined)?.defaults
  const defaults: Record<string, unknown> = {}
  for (const field of fields) {
    const supplied = rawDefaults && typeof rawDefaults === 'object' ? (rawDefaults as Record<string, unknown>)[field.key] : undefined
    const empty =
      field.type === 'boolean' ? false : field.type === 'number' ? (field.min ?? 0) : field.type === 'select' ? (field.options?.[0]?.value ?? '') : ''
    defaults[field.key] = coerceManifestConfigValue(field, supplied, empty)
  }
  return { fields, defaults }
}

const MANIFEST_FIELD_KIND = { string: 'text', number: 'number', boolean: 'toggle', select: 'select' } as const

/**
 * The workspace-settings screen of a marketplace plugin, as a native screen spec: the console's `PluginConfigCards` for a
 * pin's manifest. The same shape the generated screens of the built-in plugins have (`pluginSettingsScreen` of
 * `native-plugin-settings.mjs`), under an id of its own, saved to `orgs/{org}/pluginSettings/{plugin}` as the console
 * saves it. `null` for a plugin that declares no settings.
 */
export function manifestSettingsScreen(pluginId: string, label: string, manifest: unknown): Record<string, unknown> | null {
  const schema = pluginId ? manifestSettingsFields(manifest) : null
  if (!schema) return null
  const fields = schema.fields.map((field) => {
    const out: Record<string, unknown> = {
      key: field.key,
      label: field.label,
      kind: MANIFEST_FIELD_KIND[field.type],
      // `??` keeps a stored false or 0, which `|` would skip for the default.
      initial: `{item.${field.key} ?? const.defaults.${field.key}}`,
    }
    if (field.type === 'select') out['options'] = (field.options ?? []).map(({ value, label: text }) => ({ value, label: text }))
    const band = field.type === 'number' && (field.min != null || field.max != null) ? `Between ${field.min ?? 'any'} and ${field.max ?? 'any'}.` : ''
    const help = [field.description, band].filter(Boolean).join(' ')
    if (help) out['help'] = help
    return out
  })
  const written = Object.fromEntries(schema.fields.map((field) => [field.key, `{form.${field.key}}`]))
  return {
    id: `marketplace.pluginSettings.${pluginId}`,
    title: `${label} settings`,
    subtitle: `How ${label} behaves for this workspace`,
    icon: 'gearshape|settings',
    scope: 'org',
    requires: 'org.manager',
    constants: { defaults: schema.defaults },
    load: { settings: { doc: `orgs/{org.id}/pluginSettings/${pluginId}`, optional: true } },
    blocks: [
      {
        type: 'form',
        id: 'settings',
        object: 'data.settings',
        footer: 'A site can override these on its own plugin page.',
        fields,
        submit: {
          label: 'Save settings',
          write: { doc: `orgs/{org.id}/pluginSettings/${pluginId}`, fields: { ...written, updatedBy: '{user.uid}' } },
          success: 'Settings saved',
        },
      },
    ],
  }
}
