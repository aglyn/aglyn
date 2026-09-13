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
 * How a Link Container's link gets its accessible name (AGL-2886).
 *
 * An `<a>` is named by the text inside it. A Link Container holding only an
 * Icon has none, so a screen reader announces "link" and nothing else
 * (WCAG 2.4.4, 4.1.2). Two attributes answer that, and this module holds both
 * halves of them: what the anchor renders, and the warning the Attributes
 * panel shows while neither has been used.
 */

import * as Aglyn from '@aglyn/aglyn'
import { ID as boxId } from './box'
import { ID as containerId } from './container'
import { ID as gridId } from './grid'
import { ID as iconId } from './icon'
import { ID as imageId } from './image'
import { ID as inlineTextId } from './inline-text'
import { ID as paperId } from './paper'
import { ID as sectionId } from './section'
import { ID as stackId } from './stack'
import { ID as typographyId } from './typography'

/** The Link Container attribute that marks it as a second link. */
export const REDUNDANT_ATTRIBUTE = 'redundant'

/**
 * The anchor attributes that name the link, or take it out of the
 * accessibility tree and the tab order.
 *
 * Redundant wins over a label. A link hidden from assistive tech announces no
 * name, so the label would be an attribute every visitor downloads for
 * nothing. Read through `readYesNoValue` because a switch bound to a Yes / no
 * property can arrive as the string `'false'`, which plain truthiness reads
 * as a yes.
 *
 * `tabIndex` goes with `aria-hidden` because either alone is a defect: a
 * hidden link that still takes focus leaves a keyboard user on a stop that
 * announces nothing, and a skipped link that is still announced is the
 * duplicate this option exists to remove.
 */
export function linkContainerA11yProps(
  ariaLabel: unknown,
  redundant: unknown,
): { 'aria-label'?: string; 'aria-hidden'?: 'true'; tabIndex?: number } {
  if (Aglyn.readYesNoValue(redundant) === true) {
    return { 'aria-hidden': 'true', tabIndex: -1 }
  }
  const label = typeof ariaLabel === 'string' ? ariaLabel.trim() : ''
  return label ? { 'aria-label': label } : {}
}

/**
 * Elements that add no words of their own to a link they sit inside.
 *
 * An Icon draws an SVG glyph with no text alternative, and a layout container
 * is only the box around its children. Image and the two text elements are
 * listed because their words live in props the walk below reads directly
 * (`alt`, `children`, `html`), so one of them holding none is as silent as an
 * Icon.
 *
 * An element NOT listed, holding none of those props, is taken to name the
 * link. A reusable component keeps its words in its definition, a collection
 * or product element takes them from data, and List Item Text keeps its lines
 * in props of its own. A warning about any of those would be a guess, and a
 * warning that is wrong about correct content teaches an author to ignore the
 * one that is right.
 */
const WORDLESS_ELEMENTS: ReadonlySet<string> = new Set([
  boxId,
  containerId,
  gridId,
  iconId,
  imageId,
  inlineTextId,
  paperId,
  sectionId,
  stackId,
  typographyId,
])

const hasText = (value: unknown): boolean =>
  typeof value === 'string' && value.trim().length > 0

/**
 * Whether an element inside the link carries words of its own.
 *
 * A binding counts: `{{…}}` is not blank, and what it resolves to is not
 * known until the page renders. An image's alt text counts unless the image
 * is marked decorative, because the renderer drops the alt then.
 */
function carriesWords(props: Record<string, unknown> | undefined): boolean {
  if (!props) return false
  if (hasText(props['children']) || hasText(props['html'])) return true
  if (hasText(props['ariaLabel'])) return true
  return (
    hasText(props['alt']) && Aglyn.readYesNoValue(props['decorative']) !== true
  )
}

/**
 * Whether what is inside a Link Container gives its link a name, or `true`
 * when that cannot be decided from the document.
 *
 * Walks every descendant. A hidden element is skipped, because the page
 * renders it with `display: none` and that removes it from the accessibility
 * tree. A child the lookup cannot find is an unknown, not a silence.
 */
export function linkContentNamesLink(
  node: Aglyn.NodeSchema<any>,
  getNode: Aglyn.AttributeFieldContext['getNode'],
): boolean {
  // The renderer draws a node's own `children` string inside the element.
  if (hasText((node.props as Record<string, unknown> | undefined)?.['children'])) {
    return true
  }
  const pending = [...(node.nodes ?? [])]
  const visited = new Set<string>()
  while (pending.length) {
    const id = pending.pop() as string
    if (visited.has(id)) continue
    visited.add(id)
    const child = getNode(id)
    if (!child) return true
    if (child.hidden) continue
    if (carriesWords(child.props as Record<string, unknown> | undefined)) {
      return true
    }
    if (!WORDLESS_ELEMENTS.has(String(child.componentId))) return true
    pending.push(...(child.nodes ?? []))
  }
  return false
}

/** What the Accessible label field says while the link has no name. */
export const UNNAMED_LINK_CONTAINER_WARNING =
  'Nothing inside this box can be read aloud, so screen readers announce ' +
  'it as just "link". Describe where it goes here, or turn on Duplicate of ' +
  'another link if a link beside it already goes to the same place.'

/**
 * The Accessible label field's `resolveProps`: the warning above as its
 * helper text while the link would render with no name, and the field's own
 * description otherwise.
 *
 * Silent without the panel's context, since it cannot see what is inside the
 * box, and silent while Duplicate of another link holds a binding, since each
 * page that places the component decides that for itself.
 */
export function linkContainerLabelFieldProps(
  _props: unknown,
  field: { input?: { value?: unknown } },
  formOptions?: { getState?: () => { values?: Record<string, unknown> } },
  context?: Aglyn.AttributeFieldContext,
): { helperText?: string } {
  if (!context?.node || hasText(field?.input?.value)) return {}
  const redundant = formOptions?.getState?.()?.values?.[REDUNDANT_ATTRIBUTE]
  const marked = Aglyn.readYesNoValue(redundant)
  if (marked === true || (marked === undefined && redundant != null)) {
    return {}
  }
  return linkContentNamesLink(context.node, context.getNode)
    ? {}
    : { helperText: UNNAMED_LINK_CONTAINER_WARNING }
}
