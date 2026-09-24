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
 * THE COMPONENTS ONE DOCUMENT PLACES, READ ON DEMAND (AGL-3287).
 *
 * A published page composes against every component the site has, read in one
 * collection query and held in the render cache — `getComponents` in the tenant
 * runtime. That is the right trade for a page, which is rendered constantly and
 * served from cache. It is the wrong one for a document rendered on demand: an
 * email sent, test-sent or previewed, a design being published elsewhere. Those
 * are not cached pages, a cache would serve a header the site has since
 * republished, and most of them place no component at all.
 *
 * So this reads ONLY what a node map references, following nesting to the same
 * depth the graft expands ({@link MAX_COMPONENT_DEPTH}), a level at a time, each
 * level in parallel. A document that places nothing costs no read at all.
 *
 * It knows nothing about Firestore. A caller hands it a {@link
 * ReadComponentDocument} — the Admin SDK through {@link hostComponentReader},
 * the client SDK in a console preview — so the same walk serves a send, a
 * browser and a spec's fake. Pure otherwise, and client-safe: no Node builtin,
 * no cache, no Next.
 *
 * What a stored document MEANS as a tree is {@link readStoredComponentTree},
 * which `getComponents` reads its collection through too, so the page and the
 * mail cannot come to disagree about a component's published design.
 */

import type {
  AglynNodeSchema,
  NodeId,
  ReusableComponentProp,
} from '../foundation'
import {
  collectReferencedComponentIds,
  composeReusableComponentNodes,
  MAX_COMPONENT_DEPTH,
  type ReusableComponentTree,
} from './compose-reusable-components'
import { decodeStoredNodes } from './stored-nodes'

/**
 * The fields of `hosts/{hostId}/components/{id}` a render reads: the PUBLISHED
 * snapshot. `rootId`, `nodes` and the declared `props` live on the component
 * document itself, never on its versions (AGL-679), so one read per component
 * is the whole cost.
 */
export interface StoredComponentDocument {
  rootId?: unknown
  nodes?: unknown
  props?: unknown
  deletedAt?: unknown
}

/** Why a referenced component gave no tree to graft. */
export type ComponentSkipReason =
  /** No such document. */
  | 'missing'
  /** Soft-deleted: it renders nothing, wherever it was placed. */
  | 'deleted'
  /** Created but never published — no `rootId`/`nodes` on the document. */
  | 'unpublished'
  /** Its `nodes` could not be decoded; `decodeStoredNodes` logs why. */
  | 'undecodable'
  /** Not usable as one document id, so it was never read (AGL-1771). */
  | 'invalid'
  /** Past {@link REFERENCED_COMPONENTS_READ_LIMIT}; not read. */
  | 'limit'

export type StoredComponentTreeRead =
  | { ok: true; tree: ReusableComponentTree }
  | { ok: false; reason: Exclude<ComponentSkipReason, 'invalid' | 'limit'> }

/**
 * A stored component document as the tree `composeReusableComponentNodes`
 * grafts, or why it is not one.
 *
 * BOTH STORED FORMS (AGL-1151). A published definition is msgpack for anything
 * promoted since components were compressed and a plain map for everything
 * older, and nothing migrates them — `decodeStoredNodes` returns a map
 * unchanged, so one call serves both forever. Reading the field raw is a
 * SILENT failure: the graft looks up `nodes[rootId]` on a `Buffer`, finds
 * nothing, and every placement of the component renders empty.
 *
 * An undecodable definition is skipped rather than grafted empty. The page or
 * the mail comes out the same either way, but `decodeStoredNodes` logs the
 * reason, and a definition that silently became `{}` would not say why the
 * component vanished.
 */
export function readStoredComponentTree(
  stored: StoredComponentDocument | null | undefined,
): StoredComponentTreeRead {
  if (!stored) return { ok: false, reason: 'missing' }
  if (stored.deletedAt) return { ok: false, reason: 'deleted' }
  if (!stored.nodes || !stored.rootId)
    return { ok: false, reason: 'unpublished' }
  const nodes = decodeStoredNodes<ReusableComponentTree['nodes']>(stored.nodes)
  if (!nodes) return { ok: false, reason: 'undecodable' }
  return {
    ok: true,
    tree: {
      rootId: stored.rootId as NodeId,
      nodes,
      // Declared props (AGL-1247): without these the graft leaves every
      // `{{prop.*}}` token unresolved wherever the component is placed.
      ...(Array.isArray(stored.props) &&
        stored.props.length && {
          props: stored.props as ReusableComponentProp[],
        }),
    },
  }
}

/**
 * One component document by id — `null` or `undefined` when there is none. A
 * rejection is a failed READ and fails the whole load: an email must not go out
 * missing its footer because a request timed out, and every caller has a
 * better answer to an error than a quietly partial design.
 */
export type ReadComponentDocument = (
  componentId: string,
) => Promise<StoredComponentDocument | null | undefined>

/** A referenced component that gave no tree, and why. */
export interface SkippedComponent {
  id: string
  reason: ComponentSkipReason
}

/**
 * Documents one load may read — the same bound `getComponents` reads a whole
 * site under, so an on-demand render can never cost more than a page does.
 */
export const REFERENCED_COMPONENTS_READ_LIMIT = 200

export interface LoadReferencedComponentsOptions {
  /** Levels of nesting to follow; the graft's own bound by default. */
  maxDepth?: number
  /** Documents one load may read; {@link REFERENCED_COMPONENTS_READ_LIMIT} by default. */
  maxDocuments?: number
  /**
   * Told once, after the load, about every referenced id that gave no tree.
   * The default logs a warning: a placement of a deleted component renders
   * nothing, and nothing else would say why.
   */
  onSkipped?: (skipped: readonly SkippedComponent[]) => void
}

/**
 * Whether a referenced id may be handed to a reader as ONE document id.
 *
 * `refId` is author-controlled, and `doc()` appends a slash-separated PATH:
 * `half/path` throws where the reference is built and `a/b/c` reads beneath a
 * document that does not exist (AGL-1771, `isDocumentId` in
 * `@aglyn/tenant-data-admin/server/document-id`). That predicate is
 * server-only — it measures with `Buffer` — and this walk also runs in a
 * browser, so the same clauses are restated with `TextEncoder`.
 */
function isReadableComponentId(id: string): boolean {
  return (
    id.length > 0 &&
    !id.includes('/') &&
    id !== '.' &&
    id !== '..' &&
    !/^__.*__$/.test(id) &&
    new TextEncoder().encode(id).length <= 1500
  )
}

function warnSkipped(skipped: readonly SkippedComponent[]): void {
  console.warn('reusable components skipped', skipped)
}

/**
 * The published definitions `nodes` places — directly, or through another
 * definition — keyed by id, in the shape `composeReusableComponentNodes`
 * takes.
 *
 * Reads a LEVEL at a time: the ids the document places, then the ids those
 * definitions place, and so on to {@link MAX_COMPONENT_DEPTH}. Each level's
 * reads run in parallel, and an id is never read twice, so a cycle costs one
 * read per component in it. Deleted, never-published, undecodable and missing
 * definitions are left out — a placement of one renders nothing, exactly as it
 * does on a page — and reported through `onSkipped`.
 */
export async function loadReferencedComponents(
  nodes: Readonly<Record<string, unknown>> | null | undefined,
  read: ReadComponentDocument,
  options: LoadReferencedComponentsOptions = {},
): Promise<Record<string, ReusableComponentTree>> {
  const maxDepth = options.maxDepth ?? MAX_COMPONENT_DEPTH
  const maxDocuments = options.maxDocuments ?? REFERENCED_COMPONENTS_READ_LIMIT
  const source = nodes as Record<string, AglynNodeSchema | undefined> | null
  const definitions: Record<string, ReusableComponentTree> = {}
  /** Every id already read, refused or skipped — never asked about again. */
  const settled = new Set<string>()
  const skipped: SkippedComponent[] = []
  let reads = 0

  for (let depth = 0; depth < maxDepth; depth++) {
    // The whole reference set through what has loaded so far, minus what is
    // settled — which is exactly the next level down.
    const wanted = [
      ...collectReferencedComponentIds(source, definitions),
    ].filter((id) => !settled.has(id))
    if (!wanted.length) break
    const batch: string[] = []
    for (const id of wanted) {
      settled.add(id)
      if (!isReadableComponentId(id)) {
        skipped.push({ id, reason: 'invalid' })
      } else if (reads + batch.length >= maxDocuments) {
        skipped.push({ id, reason: 'limit' })
      } else {
        batch.push(id)
      }
    }
    reads += batch.length
    const results = await Promise.all(
      batch.map(
        async (id) => [id, readStoredComponentTree(await read(id))] as const,
      ),
    )
    for (const [id, outcome] of results) {
      if (outcome.ok === true) definitions[id] = outcome.tree
      else skipped.push({ id, reason: outcome.reason })
    }
  }

  if (skipped.length) (options.onSkipped ?? warnSkipped)(skipped)
  return definitions
}

/**
 * `nodes` with every reusable-component placement expanded from the published
 * definitions it references — {@link loadReferencedComponents} then
 * `composeReusableComponentNodes`.
 *
 * After it, each placement IS its component's root, carrying the placement's
 * id (AGL-2521): a renderer sees the component's own blocks, with the
 * placement's property values (AGL-1247) and attribute overrides (AGL-1899)
 * applied, and knows nothing about components. Tokens the graft does not own
 * — merge tokens, host tokens, site variables — pass through untouched for the
 * renderer that does.
 *
 * A document that places nothing comes back AS GIVEN, the same reference, with
 * no read made. A placement whose component did not load is left exactly as
 * authored, which is how a deleted definition never takes a document down.
 */
export async function composeReferencedComponents<
  M extends Readonly<Record<string, unknown>>,
>(
  nodes: M,
  read: ReadComponentDocument,
  options?: LoadReferencedComponentsOptions,
): Promise<M> {
  if (!collectReferencedComponentIds(nodes as never).size) return nodes
  const definitions = await loadReferencedComponents(nodes, read, options)
  return composeReusableComponentNodes(
    nodes as unknown as Record<NodeId, AglynNodeSchema>,
    definitions,
  ) as unknown as M
}

/** A document snapshot, as far as {@link hostComponentReader} reads one. */
interface ComponentSnapshotLike {
  exists: boolean
  get(field: string): unknown
}
interface ComponentDocumentRefLike {
  get(): Promise<ComponentSnapshotLike>
  collection(path: string): ComponentCollectionRefLike
}
interface ComponentCollectionRefLike {
  doc(id: string): ComponentDocumentRefLike
}

/**
 * The slice of the Admin Firestore chain {@link hostComponentReader} walks.
 * Structural, so a caller holding any Admin handle — or a spec's fake — passes
 * it without a cast, and so this core module takes no `firebase-admin`
 * dependency. `@aglyn/shared-util-email`'s `AdminFirestoreLike` satisfies it.
 */
export interface ComponentStoreLike {
  collection(path: string): ComponentCollectionRefLike
}

/**
 * A {@link ReadComponentDocument} over `hosts/{hostId}/components` through the
 * Admin SDK — one document get per component, the four fields a render needs.
 */
export function hostComponentReader(
  firestore: ComponentStoreLike,
  hostId: string,
): ReadComponentDocument {
  return async (componentId) => {
    const snapshot = await firestore
      .collection('hosts')
      .doc(hostId)
      .collection('components')
      .doc(componentId)
      .get()
    if (!snapshot.exists) return null
    return {
      rootId: snapshot.get('rootId'),
      nodes: snapshot.get('nodes'),
      props: snapshot.get('props'),
      deletedAt: snapshot.get('deletedAt'),
    }
  }
}

/**
 * {@link composeReferencedComponents} for a site's own document, read through
 * the Admin SDK: what every server path that sends, previews or publishes an
 * email composes with.
 *
 * Shaped `(nodes, { firestore, hostId })` so it is passed as it stands wherever
 * a composer is asked for — `loadHostEmail`'s `compose` is one — rather than
 * wrapped at each call site. Skips are logged with the site they belong to.
 */
export function composeHostComponentNodes<
  M extends Readonly<Record<string, unknown>>,
>(
  nodes: M,
  context: { firestore: ComponentStoreLike; hostId: string },
): Promise<M> {
  const { firestore, hostId } = context
  return composeReferencedComponents(
    nodes,
    hostComponentReader(firestore, hostId),
    {
      onSkipped: (skipped) =>
        console.warn(
          JSON.stringify({
            tag: 'AGL-3287:components-skipped',
            hostId,
            skipped,
          }),
        ),
    },
  )
}
