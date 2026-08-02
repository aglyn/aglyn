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
 * Why a plugin version was rejected (AGL-977).
 *
 * Rejection used to be a free-text box, so the reason was whatever the
 * reviewer typed. That is three problems at once: a publisher cannot reliably
 * tell what to fix, nobody can ask what we reject most, and it is weak
 * evidence if a publisher disputes a takedown.
 *
 * A category plus an optional comment fixes all three without taking the
 * comment away — the category is what makes it comparable, the comment is
 * what makes it actionable.
 *
 * The ids are PERSISTED on the version doc and in `adminAudit`, so they are a
 * data contract: renaming one silently reclassifies history. Add new ones
 * freely; change an existing id only with a migration.
 */

export interface PluginRejectionCategory {
  /** Persisted. Never rename without migrating existing rows. */
  id: string
  /** What the reviewer picks, and what leads the publisher's email subject. */
  label: string
  /** What the publisher is told to do about it. */
  guidance: string
  /**
   * A comment is required for this category.
   *
   * Only "other" today: every other category says enough on its own, and
   * demanding prose for all of them is how a required field becomes ".".
   */
  requiresComment?: boolean
}

export const PLUGIN_REJECTION_CATEGORIES: readonly PluginRejectionCategory[] = [
  {
    id: 'readme',
    label: 'Missing or inadequate README',
    guidance:
      'Describe what the plugin does, how to configure it, and what it needs access to.',
  },
  {
    id: 'license',
    label: 'No license, or a license we cannot accept',
    guidance:
      'Include a license file. It has to permit redistribution through the marketplace.',
  },
  {
    id: 'repository',
    label: 'Repository missing, private, or unrelated to the bundle',
    guidance:
      'The declared repository must resolve, be readable, and plausibly contain the code that produced this bundle.',
  },
  {
    id: 'capabilities',
    label: 'Declared capabilities exceed what the plugin needs',
    guidance:
      'Ask only for what the plugin uses. Extra capabilities are the difference between a plugin and a liability.',
  },
  {
    id: 'undeclared-network',
    label: 'Undeclared network access or data collection',
    guidance:
      'Every endpoint the bundle talks to, and every field it collects, has to be declared in the manifest and named in the listing.',
  },
  {
    id: 'obfuscated',
    label: 'Obfuscated or unreadable bundle',
    guidance:
      'Ship readable code, or a source map. Nobody can review what nobody can read.',
  },
  {
    id: 'verifier',
    label: 'Fails the static verifier',
    guidance:
      'Resolve the findings on the version page and publish a new version.',
  },
  {
    id: 'not-as-described',
    label: 'Does not work as described',
    guidance:
      'The plugin has to do what the listing says it does, on a site that installs it.',
  },
  {
    id: 'duplicate',
    label: 'Duplicate or spam listing',
    guidance:
      'This listing duplicates existing content or has no plausible use.',
  },
  {
    id: 'other',
    label: 'Other',
    guidance: 'See the reviewer’s comment.',
    requiresComment: true,
  },
]

const BY_ID = new Map(
  PLUGIN_REJECTION_CATEGORIES.map((category) => [category.id, category]),
)

export function isPluginRejectionCategory(value: unknown): boolean {
  return typeof value === 'string' && BY_ID.has(value)
}

export function pluginRejectionCategory(
  id: string | null | undefined,
): PluginRejectionCategory | null {
  return (id && BY_ID.get(id)) || null
}

/**
 * The line a publisher reads first — the category, or the free-text reason
 * when the row predates this (AGL-977).
 *
 * Rejections written before categories existed still have to render, and
 * showing them as "Other" would be a claim the reviewer never made.
 */
export function rejectionHeadline(
  categoryId: string | null | undefined,
  reason: string | null | undefined,
): string {
  const category = pluginRejectionCategory(categoryId)
  if (category) return category.label
  const text = String(reason ?? '').trim()
  return text ? text.slice(0, 120) : 'Rejected'
}

/**
 * Why this rejection input is not acceptable, or `null` when it is.
 *
 * One function for both rejection paths — the version verdict and the listing
 * verdict — because two copies of "what counts as a valid rejection" is how
 * one of them quietly starts accepting a blank.
 */
export function rejectionInputError(
  categoryId: string | null | undefined,
  comment: string | null | undefined,
): string | null {
  const category = pluginRejectionCategory(categoryId)
  if (!category) return 'Pick a rejection reason'
  // "Other" says nothing on its own, so the comment IS the reason. Every
  // other category is self-explanatory and a required comment there would
  // just collect ".".
  if (category.requiresComment && !String(comment ?? '').trim()) {
    return `“${category.label}” needs a comment saying what is wrong`
  }
  return null
}
