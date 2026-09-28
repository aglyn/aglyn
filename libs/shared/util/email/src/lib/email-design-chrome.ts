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

import type { EmailChrome } from './email-render'

/**
 * WHICH PARTS OF THE SENDER'S HEADER AND FOOTER A DESIGNED EMAIL WEARS
 * (AGL-3372).
 *
 * A design goes out inside the sender's chrome like the built-in copy does,
 * except where the design already draws that part itself: an email that
 * opens with its own logo band gets no second one above it, and one that
 * closes with its own address and "why you get this" gets no second footer.
 *
 * Three ways a design says it has drawn a part:
 *
 * 1. A section marked with {@link EMAIL_ROLE_PROP}: the Besigner's Header and
 *    Footer presets carry the mark, and so does every reusable email block
 *    started from them, which reaches this function already grafted in.
 * 2. A section in exactly the shape those presets had before they carried
 *    the mark — a logo over a subheading, or a divider over two captions —
 *    so a design made from them earlier is read the same way.
 * 3. A placed reusable email block that says nothing about itself. Its tree
 *    is the author's own and could be either band, so the design is treated
 *    as drawing both: no chrome, which is where every such design stood
 *    before this function existed. Never two headers.
 */

/** The section prop a Header or Footer band carries. */
export const EMAIL_ROLE_PROP = 'emailRole'

export type EmailRole = 'header' | 'footer'

/** The component id a placed reusable block has in a stored design. */
const REUSABLE_INSTANCE = 'reusableInstance'

interface DesignNode {
  componentId?: unknown
  props?: Record<string, unknown>
  nodes?: unknown
}

const asNode = (value: unknown): DesignNode | undefined =>
  value && typeof value === 'object' ? (value as DesignNode) : undefined

const childrenOf = (
  map: Readonly<Record<string, unknown>>,
  node: DesignNode,
): DesignNode[] =>
  (Array.isArray(node.nodes) ? node.nodes : [])
    .map((id) => asNode(map[String(id)]))
    .filter((child): child is DesignNode => Boolean(child))

/** The unmarked Header preset: a logo over one subheading. */
function isLegacyHeaderBand(map: Readonly<Record<string, unknown>>, node: DesignNode) {
  const kids = childrenOf(map, node)
  return (
    kids.length === 2 &&
    kids[0].componentId === 'emailImage' &&
    kids[1].componentId === 'emailText' &&
    kids[1].props?.['variant'] === 'subheading'
  )
}

/** The unmarked Footer preset: a divider over two captions. */
function isLegacyFooterBand(map: Readonly<Record<string, unknown>>, node: DesignNode) {
  const kids = childrenOf(map, node)
  return (
    kids.length === 3 &&
    kids[0].componentId === 'emailDivider' &&
    kids.slice(1).every(
      (kid) => kid.componentId === 'emailText' && kid.props?.['variant'] === 'caption',
    )
  )
}

/**
 * The parts of a design's own chrome it draws, read from the tree as it will
 * render (reusable blocks grafted in).
 */
export function designChromeRoles(
  composed: Readonly<Record<string, unknown>> | null | undefined,
): Set<EmailRole> {
  const roles = new Set<EmailRole>()
  for (const value of Object.values(composed ?? {})) {
    const node = asNode(value)
    if (!node || node.componentId !== 'emailSection') continue
    const role = node.props?.[EMAIL_ROLE_PROP]
    if (role === 'header' || role === 'footer') roles.add(role)
    else if (isLegacyHeaderBand(composed ?? {}, node)) roles.add('header')
    else if (isLegacyFooterBand(composed ?? {}, node)) roles.add('footer')
  }
  return roles
}

/**
 * The chrome a designed email is drawn inside: the sender's, less the parts
 * the design draws itself. `undefined` when nothing of it is left.
 *
 * @param stored The design as saved, its reusable blocks still placements.
 *        Pass `null` when those placements will draw nothing in this send.
 * @param composed The tree as it will render.
 * @param chrome The sender's full chrome.
 */
export function chromeForDesign(input: {
  stored: Readonly<Record<string, unknown>> | null | undefined
  composed: Readonly<Record<string, unknown>> | null | undefined
  chrome: EmailChrome | undefined
}): EmailChrome | undefined {
  const { chrome } = input
  if (!chrome) return undefined
  const roles = designChromeRoles(input.composed)
  const placesBlocks = Object.values(input.stored ?? {}).some(
    (value) => asNode(value)?.componentId === REUSABLE_INSTANCE,
  )
  // An unmarked reusable block may be either band: never risk two headers.
  if (placesBlocks && !roles.size) return undefined
  const header = roles.has('header') ? undefined : chrome.header
  const footer = roles.has('footer') ? undefined : chrome.footer
  if (!header && !footer) return undefined
  return { ...(header ? { header } : {}), ...(footer ? { footer } : {}) }
}
