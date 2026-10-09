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
