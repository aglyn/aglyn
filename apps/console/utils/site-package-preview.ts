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

/*==========================================
 * A PACKAGE ITEM, RENDERED (AGL-3534) — where the package import wizard's
 * side-by-side diff points its frames.
 *
 * The console's document preview route renders a snapshot from
 * `localStorage` before anything stored (AGL-1203, AGL-3204), so each side
 * of an item is written as a snapshot under a version id of its own —
 * `package-site` or `package-file`, never a real version's, so opening an
 * import cannot change what the real version's Preview shows — and the
 * frame opens that route. Both sides render the item's own design the same
 * way, without the layout around a page, so the difference shown is the
 * item's.
 *=========================================*/

import type { NodesMap } from '@aglyn/aglyn'
import { decodeStoredNodes, definitionToCanvasTree } from '@aglyn/aglyn'
import type { PackagePreviewInput } from '@aglyn/aglyn-transfer-ui'
import { buildRoute, Route } from '../constants/route-links'
import { type PreviewKind, writePreviewState } from '../constants/preview-state'

type Doc = Record<string, unknown>

/** The package kinds the preview route renders, and where each keeps its design. */
const PREVIEWABLE: Record<string, { preview: PreviewKind; design: 'version' | 'document' }> = {
  page: { preview: 'screen', design: 'version' },
  email: { preview: 'screen', design: 'version' },
  layout: { preview: 'layout', design: 'version' },
  component: { preview: 'component', design: 'document' },
}

/** The version id each side's snapshot is written under. */
export const PACKAGE_PREVIEW_VERSION = { site: 'package-site', file: 'package-file' } as const

const isDoc = (value: unknown): value is Doc => typeof value === 'object' && value !== null && !Array.isArray(value)

/** The canvas tree of an item's design, or `null` when it holds none. */
export function packagePreviewTree(kind: string, content: unknown): NodesMap | null {
  const target = PREVIEWABLE[kind]
  if (!target || !isDoc(content)) return null
  const design = target.design === 'version' ? content['version'] : content
  if (!isDoc(design)) return null
  const nodes = decodeStoredNodes<NodesMap>(design['nodes'] ?? design['elements'])
  if (!nodes || !Object.keys(nodes).length) return null
  return definitionToCanvasTree({
    rootId: typeof design['rootId'] === 'string' ? design['rootId'] : undefined,
    nodes,
  }) as NodesMap
}

/**
 * The wizard's `previewHref` for one site: writes the side's snapshot and
 * answers its preview route, or `null` for a kind the route does not render.
 */
export function sitePackagePreviewHref(site: { orgSlug: string; host: string; hostId: string }) {
  return (input: PackagePreviewInput): string | null => {
    const target = PREVIEWABLE[input.kind]
    const tree = packagePreviewTree(input.kind, input.content)
    if (!target || !tree) return null
    const versionId = PACKAGE_PREVIEW_VERSION[input.side]
    writePreviewState({ hostId: site.hostId, kind: target.preview, docId: input.id, versionId }, tree)
    const { orgSlug, host } = site
    if (target.preview === 'layout') {
      return buildRoute(Route.LAYOUT_PREVIEW, { orgSlug, host, layoutId: input.id, versionId })
    }
    if (target.preview === 'component') {
      return buildRoute(Route.COMPONENT_PREVIEW, { orgSlug, host, componentId: input.id, versionId })
    }
    return buildRoute(Route.SCREEN_PREVIEW, { orgSlug, host, screenId: input.id, versionId })
  }
}
