/**
 * @license
 * Copyright 2026 Aglyn LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * A resource's FIRST version, seeded from the resource itself (AGL-3668).
 *
 * A reusable component is created with its design on its own document and no
 * version, and the console's "Open Besigner" mints the first version from
 * that document before it opens it: the decoded node map (or a root-only
 * canvas when it is empty, never `{}`, which renders as "Invalid node"), the
 * canvas root, and the declared properties. The native apps cannot decode a
 * compressed node map, so `/api/hosts/versions` builds the same seed on the
 * server from the stored document (`seedFromParent`), and the node map never
 * crosses the wire. This is that seed, as one pure rule both sides share.
 */

const CANVAS_ROOT_ID = '_@_'

/** The back-pointer key a version of each parent kind carries. */
export const VERSION_PARENT_KEYS: Readonly<Record<string, string>> = {
  screen: 'screenId',
  layout: 'layoutId',
  component: 'componentId',
  form: 'formId',
}

/** A canvas with nothing on it but its root. */
export function rootOnlyCanvas(): Record<string, unknown> {
  return { [CANVAS_ROOT_ID]: { $id: CANVAS_ROOT_ID, componentId: 'div', nodes: [] } }
}

/**
 * The first version's document for [parentId] of [kind], from the parent's
 * stored fields with its node map already DECODED. Null for a kind with no
 * versions.
 */
export function firstVersionSeed(
  kind: string,
  parentId: string,
  hostId: string,
  parent: {
    nodes?: Record<string, unknown> | null
    rootId?: unknown
    props?: unknown
  },
): Record<string, unknown> | null {
  const backPointer = VERSION_PARENT_KEYS[kind]
  if (!backPointer) return null
  const nodes = parent.nodes && Object.keys(parent.nodes).length ? parent.nodes : rootOnlyCanvas()
  return {
    [backPointer]: parentId,
    hostId,
    displayName: 'Initial version',
    nodes,
    ...(typeof parent.rootId === 'string' && parent.rootId ? { rootId: parent.rootId } : {}),
    ...(Array.isArray(parent.props) && parent.props.length ? { props: parent.props } : {}),
  }
}
