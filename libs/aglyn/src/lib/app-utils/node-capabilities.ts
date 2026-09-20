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
  FieldComponentType,
  type AglynAttributeSchema,
} from '../foundation/definitions/components.types'
import { REPEAT_MAX_RECORDS, REPEAT_SELF_PROP } from './expand-repeatables'

/**
 * What every NODE can do, as against what one component declares (AGL-3156).
 *
 * A component schema says what its own element is: a Stack's direction, a
 * Button's label. A capability here says what any element can be made to do
 * whatever it is — repeat over records, today — and the editor offers it on
 * all of them, the way it offers visibility and animation.
 *
 * The declarations live in core because the capability does. The Attributes
 * panel draws these fields, the published page's composition consumes the
 * props they persist, and anything that has to DESCRIBE the palette an author
 * works with reads them from here. Before this module each of those held its
 * own copy of the list, so a capability that moved off a component schema fell
 * out of every reader that walked component schemas to find it: repeat became a
 * node capability and stopped being offered to a draft entirely, because the
 * only list that named it was the one it had just left.
 *
 * Reached by path, never through a barrel. These are labels, descriptions and
 * field kinds — editor weight, which a published page must not download.
 */

/**
 * One field a capability contributes to every node, in the same shape a
 * component schema declares an attribute in, so a reader that already walks
 * attributes needs no second code path for these.
 */
export interface NodeCapabilityAttribute extends AglynAttributeSchema {
  /**
   * Offered only on a node that holds a child list. A control whose options
   * both do the same thing is worse than no control.
   */
  requiresChildren?: boolean
  /** The fragment of the capability's docs page that explains this field. */
  docsAnchor?: string
}

/** One thing every node can be made to do. */
export interface NodeCapability {
  /** Stable id, and the docs page the fields link to. */
  id: string
  /** What the Attributes panel calls the section. */
  label: string
  /** One sentence describing the capability, for a catalog that lists it. */
  summary: string
  /**
   * The fields the capability contributes to every node. What a repeat is
   * OVER is not among them — that belongs to the plugin that owns the rows,
   * which registers a source of its own (`repeat-sources.ts`). These are the
   * properties of the capability itself, shared by every source.
   */
  attributes: readonly NodeCapabilityAttribute[]
}

/**
 * Repeating, on any element (AGL-3111).
 *
 * The bounds are properties of the REPEAT and not of the rows: the composition
 * applies the same scope, filter, sort and limit whatever answered with the
 * records, so they are declared once here rather than per source.
 */
export const REPEAT_NODE_CAPABILITY: NodeCapability = {
  id: 'repeat',
  label: 'Repeat',
  summary: 'Renders an element once per record of the data it repeats over.',
  attributes: [
    {
      name: REPEAT_SELF_PROP,
      component: FieldComponentType.SELECT,
      label: 'Repeat',
      description:
        'Whether each record gets a copy of this element, or a copy of what ' +
        'is inside it. A row of cards repeats the card; a list that IS the ' +
        'row repeats its contents.',
      docsAnchor: '#what-repeats-the-element-or-whats-inside-it',
      requiresChildren: true,
      // A real value on the default option, never `''` (AGL-1451): an empty
      // value cannot persist, so an author who switched to "This element"
      // could never switch back.
      initialValue: 'false',
      options: [
        { value: 'false', label: 'What is inside this element' },
        { value: 'true', label: 'This element' },
      ],
    },
    {
      name: 'repeatLimit',
      component: FieldComponentType.TEXT_FIELD,
      type: 'number',
      label: 'Repeat limit',
      description: `Most records to render (blank = all, capped at ${REPEAT_MAX_RECORDS}).`,
      docsAnchor: '#the-hundred-record-ceiling',
    },
    {
      name: 'repeatFilter',
      component: FieldComponentType.TEXT_FIELD,
      label: 'Repeat filter',
      description:
        'Optional "field op value" filter, e.g. "price <= 20", ' +
        '"tier == plus", or "tags contains red". Ops: == != > >= < <= ' +
        `contains. Applies to the first ${REPEAT_MAX_RECORDS} records.`,
      docsAnchor: '#bound-what-renders',
    },
    {
      name: 'repeatSort',
      component: FieldComponentType.TEXT_FIELD,
      label: 'Repeat sort',
      description:
        'Optional "field" or "field desc" ordering, e.g. "price desc".',
      docsAnchor: '#bound-what-renders',
    },
  ],
}

/**
 * Every node-level capability, in the order an editor offers them.
 *
 * A reader that describes what an author can build reads this list beside the
 * component schemas rather than instead of them. One that reads only the
 * schemas is answering a question the product stopped being shaped like.
 */
export const NODE_CAPABILITIES: readonly NodeCapability[] = [
  REPEAT_NODE_CAPABILITY,
]

/** The capability registered under `id`. */
export function getNodeCapability(id: string): NodeCapability | undefined {
  return NODE_CAPABILITIES.find((capability) => capability.id === id)
}
