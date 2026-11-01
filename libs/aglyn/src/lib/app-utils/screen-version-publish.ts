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

import {
  blockingRouteOwner,
  composeScreenRoutePath,
  SCREEN_KIND_ERROR,
  SCREEN_KIND_GROUP,
  SCREEN_KIND_TEMPLATE,
  screenRoutePathToUrl,
  toScreenRouteNode,
  type ScreenRouteNode,
} from './screen-route'
import { normalizeScreenSlug, reservedScreenRouteMessage, reservedScreenRouteSegment } from './screen-slug'

/**
 * What Publish does to one version of a page, from outside the Besigner
 * (AGL-3616): the preview of a version an AI job wrote leads with it.
 *
 *  - `live` — the site already serves this version at `path`; nothing to do.
 *  - `replace` — the page is live with another version: Publish makes this
 *    one the version the site serves at `path`. `placeholder` where the page
 *    is the site's placeholder home (AGL-3478), which publishes through the
 *    route seam so it becomes the owner's.
 *  - `first` — the page is not on the site: Publish puts it at `path`, its
 *    own `slug` under its parents, with this version.
 *  - `blocked` — Publish cannot be done from here, and `reason` says why in
 *    the words the person reads. The Besigner is where each is fixed.
 *
 * The same refusals, in the same order, as the page's own Publish: no
 * address, a parent with none, a reserved address, an address another page
 * holds.
 */
export type ScreenVersionPublish =
  | { kind: 'live'; path: string }
  | { kind: 'replace'; path: string; placeholder: boolean }
  | { kind: 'first'; slug: string; path: string }
  | { kind: 'blocked'; reason: string }

export const SCREEN_VERSION_PUBLISH_DELETED = 'This page was deleted.'
export const SCREEN_VERSION_PUBLISH_NO_ADDRESS =
  'This page has no address yet. Give it one in the Besigner, then publish it.'
export const SCREEN_VERSION_PUBLISH_NO_PARENT_ADDRESS =
  'A page above this one is not published, so this page has no address yet. Publish that page first.'
/** Kinds of screen whose Publish is the Besigner's alone, each with why. */
const PUBLISHED_IN_THE_BESIGNER: Readonly<Record<string, string>> = {
  [SCREEN_KIND_TEMPLATE]: 'A collection template is published from the Besigner.',
  [SCREEN_KIND_ERROR]: 'An error page is published from the Besigner.',
  [SCREEN_KIND_GROUP]: 'A page group has no version to publish.',
  email: 'An email is sent by campaigns, not published as a page.',
}

export const screenVersionPublishTakenCopy = (path: string): string =>
  `Another page is already published at ${screenRoutePathToUrl(path)}. Give this one another address in the Besigner.`

export function screenVersionPublish(input: {
  screenId: string
  versionId: string
  /** The page's document, `null` where it is gone. */
  screen: { versionId?: unknown; slug?: unknown; kind?: unknown; parentId?: unknown; deletedAt?: unknown } | null
  /** The site's routing map, `host.screens`. */
  routingMap: Readonly<Record<string, string>> | null | undefined
  /** Every page of the site as path composition reads it (`toScreenRouteNode`). */
  screensById: Readonly<Record<string, ScreenRouteNode | undefined>>
  defaultHomeScreenId?: string | null
}): ScreenVersionPublish {
  const { screenId, versionId, screen, routingMap } = input
  if (!screen || screen.deletedAt != null) return { kind: 'blocked', reason: SCREEN_VERSION_PUBLISH_DELETED }
  const elsewhere = typeof screen.kind === 'string' ? PUBLISHED_IN_THE_BESIGNER[screen.kind] : undefined
  if (elsewhere) return { kind: 'blocked', reason: elsewhere }
  const routed = routingMap?.[screenId]
  if (typeof routed === 'string') {
    return screen.versionId === versionId
      ? { kind: 'live', path: routed }
      : { kind: 'replace', path: routed, placeholder: screenId === input.defaultHomeScreenId }
  }
  const slug = normalizeScreenSlug(typeof screen.slug === 'string' ? screen.slug : '')
  if (!slug) return { kind: 'blocked', reason: SCREEN_VERSION_PUBLISH_NO_ADDRESS }
  const path = composeScreenRoutePath(screenId, {
    ...input.screensById,
    [screenId]: { ...toScreenRouteNode(screen), slug },
  })
  if (!path) return { kind: 'blocked', reason: SCREEN_VERSION_PUBLISH_NO_PARENT_ADDRESS }
  const reserved = reservedScreenRouteSegment(path)
  if (reserved) return { kind: 'blocked', reason: reservedScreenRouteMessage(reserved) }
  const owner = blockingRouteOwner(routingMap, path, input.defaultHomeScreenId)
  if (owner && owner !== screenId) return { kind: 'blocked', reason: screenVersionPublishTakenCopy(path) }
  return { kind: 'first', slug, path }
}
