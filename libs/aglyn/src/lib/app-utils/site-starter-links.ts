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
 * Page links across a site starter's publish and install (AGL-4049).
 *
 * A link to another page of the site names that page by id (`screenId`), so
 * it survives a slug change. A starter's pages have no ids of their own until
 * a site is created from it, so the published starter names each linked page
 * by its routing slug instead (`screenSlug`), and the site it creates turns
 * the slugs back into the ids its new pages were given. After install only
 * `screenId` remains, so nothing that renders a page learns a new prop.
 *
 * Both directions walk each node's `props` one level deep and rewrite only a
 * prop whose value is a string. Pure, no I/O; neither mutates its input.
 */

/** The prop a published starter names a linked page by: its routing slug. */
export const SITE_STARTER_LINK_SLUG_PROP = 'screenSlug'

/** The prop a site's own pages name a linked page by: its id. */
const SCREEN_ID_PROP = 'screenId'

const isRecord = (value: unknown): value is Record<string, any> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

/** `props` without `key`. */
const without = (props: Record<string, any>, key: string): Record<string, any> => {
  const rest = { ...props }
  delete rest[key]
  return rest
}

const own = (map: Record<string, string>, key: string): string | undefined =>
  Object.prototype.hasOwnProperty.call(map, key) && typeof map[key] === 'string' ? map[key] : undefined

/** Each node, with its props rewritten by `rewrite` when it returns new props, else as it was. */
function mapNodeProps(
  nodes: Record<string, any>,
  rewrite: (props: Record<string, any>) => Record<string, any> | null,
): Record<string, any> {
  if (!isRecord(nodes)) return nodes
  const out: Record<string, any> = {}
  for (const [key, node] of Object.entries(nodes)) {
    const next = isRecord(node) && isRecord(node['props']) ? rewrite(node['props']) : null
    out[key] = next ? { ...node, props: next } : node
  }
  return out
}

/**
 * Publish side: every `screenId` prop naming a key of `routing` becomes
 * `screenSlug: routing[id]`. A `screenId` naming a page `routing` does not
 * route is left as it was.
 */
export function starterLinksBySlug(
  nodes: Record<string, any>,
  routing: Record<string, string>,
): Record<string, any> {
  return mapNodeProps(nodes, (props) => {
    const id = props[SCREEN_ID_PROP]
    if (typeof id !== 'string') return null
    const slug = own(routing, id)
    if (slug === undefined) return null
    return { ...without(props, SCREEN_ID_PROP), [SITE_STARTER_LINK_SLUG_PROP]: slug }
  })
}

/**
 * Install side: every `screenSlug` prop becomes `screenId: ids[slug]`; a slug
 * no page has is dropped.
 */
export function starterLinksById(
  nodes: Record<string, any>,
  ids: Record<string, string>,
): Record<string, any> {
  return mapNodeProps(nodes, (props) => {
    const slug = props[SITE_STARTER_LINK_SLUG_PROP]
    if (typeof slug !== 'string') return null
    const rest = without(props, SITE_STARTER_LINK_SLUG_PROP)
    const id = own(ids, slug)
    return id === undefined ? rest : { ...rest, [SCREEN_ID_PROP]: id }
  })
}
