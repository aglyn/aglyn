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

// Activity-feed presenter (AGL-810). The `hosts/{id}/activity` and
// `orgs/{id}/activity` logs store a free-text `action` plus a `{ type, id,
// name }` target, written from ~40 scattered call sites. The three renderers
// (host card, host table, org card) used to each format entries their own
// way — one dropped the target entirely, one printed the raw Firestore doc
// id when no name was recorded. This module is the single place that turns a
// stored entry into something a human reads, and into a deep link to the
// thing that changed. It is deliberately dependency-free (only the string
// route table) so plugin libs and the console app can both import it via
// `@aglyn/aglyn/app-utils/activity-presenter`.

import { Route, buildRoute } from './console-routes'

/** The stored `target` sub-object, read defensively (any field may be absent). */
export interface ActivityTargetLike {
  type?: string
  id?: string
  name?: string
  /** Present on screen saves so the deep link can hit the exact version. */
  versionId?: string
}

/** A stored activity document, read defensively. */
export interface ActivityEntryLike {
  action?: string
  target?: ActivityTargetLike | null
  // Some early org entries carried the type/target id at the top level rather
  // than nested under `target` — tolerate both so no entry renders blank.
  type?: string
  targetId?: string
}

/**
 * What the presenter needs to build a link. `host` is the `[host]` URL
 * segment — the site SLUG the console routes by (AGL-622), NOT the host doc
 * id — so pass `useParams().host`, not the doc id. When it is present the
 * entry is treated as host-scoped, otherwise org-scoped — which
 * disambiguates `member`, the one type both logs use.
 */
export interface ActivityLinkContext {
  orgSlug?: string
  host?: string
}

/** Human, singular noun for a target type. Falls back to the raw type. */
const TYPE_LABELS: Record<string, string> = {
  host: 'Site',
  screen: 'Screen',
  layout: 'Layout',
  theme: 'Theme',
  media: 'Media',
  content: 'Content',
  variable: 'Variable',
  function: 'Function',
  workflow: 'Workflow',
  member: 'Member',
  component: 'Component',
  template: 'Template',
  org: 'Organization',
  invite: 'Invitation',
}

/** Human noun for a target type, e.g. `'screen'` → `'Screen'`. */
export function activityTypeLabel(type: string | undefined): string {
  if (!type) return 'Item'
  return TYPE_LABELS[type] ?? type.charAt(0).toUpperCase() + type.slice(1)
}

/**
 * A label for the target column/link. Prefers the recorded name; when none
 * was written (older entries, id-only saves) it degrades to the humanized
 * type — NEVER the raw doc id, which is meaningless to a reader.
 */
export function activityTargetLabel(
  target: ActivityTargetLike | null | undefined,
): string {
  if (target?.name) return target.name
  return activityTypeLabel(target?.type)
}

/**
 * The primary line for a feed entry: the action, suffixed with the target
 * name when one is known, so "Saved the screen" becomes "Saved the screen —
 * Home". A missing action degrades to the target label rather than blank.
 */
export function activityPrimaryText(entry: ActivityEntryLike): string {
  const action = entry.action?.trim()
  const name = entry.target?.name?.trim()
  if (action && name) return `${action} — ${name}`
  if (action) return action
  return activityTargetLabel(entry.target)
}

/**
 * A deep link to the resource an entry points at, or `undefined` when it
 * cannot be built (missing context, or a type with nowhere sensible to go).
 * `buildRoute` emits `<orgSlug?>` placeholders for missing params, so every
 * branch guards its inputs and returns `undefined` rather than a dead link.
 */
export function activityHref(
  entry: ActivityEntryLike,
  ctx: ActivityLinkContext,
): string | undefined {
  const { orgSlug, host } = ctx
  if (!orgSlug) return undefined
  const target = entry.target ?? undefined
  const type = target?.type ?? entry.type
  const id = target?.id ?? entry.targetId
  const versionId = target?.versionId

  // Host-scoped entries: every host route needs both orgSlug and host.
  if (host) {
    switch (type) {
      case 'host':
        return buildRoute(Route.HOST_DASHBOARD, { orgSlug, host })
      case 'screen':
        // The screen detail page is version-addressed; without a versionId
        // there is no "current" pointer to route through, so land on the list.
        return id && versionId
          ? buildRoute(Route.SCREEN_DETAILS, {
              orgSlug,
              host,
              screenId: id,
              versionId,
            })
          : buildRoute(Route.SCREEN_LIST, { orgSlug, host })
      case 'component':
        return id
          ? buildRoute(Route.COMPONENT_DETAILS, {
              orgSlug,
              host,
              componentId: id,
            })
          : buildRoute(Route.HOST_COMPONENTS, { orgSlug, host })
      case 'template':
        return id
          ? buildRoute(Route.TEMPLATE_DETAILS, {
              orgSlug,
              host,
              templateId: id,
            })
          : buildRoute(Route.HOST_TEMPLATES, { orgSlug, host })
      case 'layout':
        return id
          ? buildRoute(Route.LAYOUT_DETAILS, { orgSlug, host, layoutId: id })
          : buildRoute(Route.LAYOUT_LIST, { orgSlug, host })
      case 'theme':
        return buildRoute(Route.HOST_THEME, { orgSlug, host })
      case 'media':
        return buildRoute(Route.HOST_MEDIA, { orgSlug, host })
      case 'content':
        return buildRoute(Route.HOST_CONTENT, { orgSlug, host })
      case 'variable':
        return buildRoute(Route.HOST_DATA, { orgSlug, host })
      case 'function':
        return buildRoute(Route.HOST_LOGIC, { orgSlug, host })
      case 'workflow':
        return buildRoute(Route.HOST_WORKFLOWS, { orgSlug, host })
      case 'member':
        // Site team is managed on the Setup page — there is no per-member
        // host route.
        return buildRoute(Route.HOST_SETUP, { orgSlug, host })
      default:
        return undefined
    }
  }

  // Org-scoped entries.
  switch (type) {
    case 'org':
      return buildRoute(Route.ORG_SETTINGS, { orgSlug })
    case 'member':
      return id
        ? buildRoute(Route.MANAGE_TEAM_MEMBER, { orgSlug, uid: id })
        : buildRoute(Route.MANAGE_TEAM, { orgSlug })
    case 'invite':
      return buildRoute(Route.MANAGE_TEAM, { orgSlug })
    default:
      return undefined
  }
}
