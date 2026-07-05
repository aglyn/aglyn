/**
 * @license
 * Copyright 2023 Aglyn LLC
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

import type {
  Literal as UnistLiteral,
  Node as UnistNode,
  Parent as UnistParent,
} from 'unist'

export type { UnistNode as Node }

/**
 * This map registers all node types that may be used as top-level content in
 * the document.
 *
 * These types are accepted inside `root` nodes.
 *
 * This interface can be augmented to register custom node types.
 *
 * @example
 * declare module 'hast' {
 *   interface RootContentMap {
 *     // Allow using raw nodes defined by `rehype-raw`.
 *     raw: Raw;
 *   }
 * }
 */
export interface RootContentMap {
  comment: Comment
  doctype: DocType
  element: Element
  text: Text
}

/**
 * This map registers all node types that may be used as content in an element.
 *
 * These types are accepted inside `element` nodes.
 *
 * This interface can be augmented to register custom node types.
 *
 * @example
 * declare module 'hast' {
 *   interface RootContentMap {
 *     custom: Custom;
 *   }
 * }
 */
export interface ElementContentMap {
  comment: Comment
  element: Element
  text: Text
}

export type Content = RootContent | ElementContent
export type RootContent = RootContentMap[keyof RootContentMap]
export type ElementContent = ElementContentMap[keyof ElementContentMap]

/**
 * Node in hast containing other nodes.
 */
export interface Parent extends UnistParent {
  /**
   * List representing the children of a node.
   */
  children: Content[]
}

/**
 * Nodes in hast containing a value.
 */
export interface Literal extends UnistLiteral {
  value: string
}

/**
 * Root represents a document.
 * Can be used as the rood of a tree, or as a value of the
 * content field on a 'template' Element, never as a child.
 */
export interface Root extends Parent {
  /**
   * Represents this variant of a Node.
   */
  type: 'root'

  /**
   * List representing the children of a node.
   */
  children: RootContent[]
}

/**
 * Element represents an HTML Element.
 */
export interface Element extends Parent {
  /**
   * Represents this variant of a Node.
   */
  type: 'element'

  /**
   * Represents the element’s local name.
   */
  tagName: string

  /**
   * Represents information associated with the element.
   */
  properties?: Properties | undefined

  /**
   * If the tagName field is 'template', a content field can be present.
   */
  content?: Root | undefined

  /**
   * List representing the children of a node.
   */
  children: ElementContent[]
}

/**
 * Represents information associated with an element.
 */
export interface Properties {
  // prettier-ignore
  [PropertyName: string]:
    | boolean
    | number
    | string
    | null
    | undefined
    | Array<string | number>
}

/**
 * Represents information associated with a dynamic element after js.
 */
export interface Props {
  // prettier-ignore
  [PropertyName: string]:
    | boolean
    | number
    | string
    | null
    | undefined
    | Array<string | number>
    | any
}

/**
 * Represents an HTML DocumentType.
 */
export interface DocType extends UnistNode {
  /**
   * Represents this variant of a Node.
   */
  type: 'doctype'

  name: string
}

/**
 * Represents an HTML Comment.
 */
export interface Comment extends Literal {
  /**
   * Represents this variant of a Literal.
   */
  type: 'comment'
}

/**
 * Represents an HTML Text.
 */
export interface Text extends Literal {
  /**
   * Represents this variant of a Literal.
   */
  type: 'text'
}

/**
 * Nodes in hast containing a value of the taxonomy name displayed.
 *
 * `domain` kind is reserved for representing top-level vertical
 * taxonomies. Examples would include things comparative to
 * - `education`
 * - `evolution`
 * - `television`
 *
 * `category` kind is reserved for representing low-level vertical
 * taxonomies. Examples would include things comparative to
 * - `science`
 * - `philosophy`
 * - `biology`
 *
 * `tag` kind is reserved for representing high-level taxonomies, potentially
 * shared across multiple categories and domains. Examples would include things
 * comparative to
 * - `healthy lifestyle`
 * - `intimacy`
 * - `2019 pandemic`
 *
 */
export interface Taxonomy extends Literal {
  /**
   * Represents this variant of a Node.
   */
  type: 'taxonomy'

  /**
   * Represents the variant categorization of a Node.
   */
  kind: 'domain' | 'category' | 'tag'
}

/**
 * Taxonomic represents any node that may be categorized/classified
 */
export interface Taxonomic {
  /**
   * Represents the additional property to declare taxonomies
   */
  taxonomies?: Taxonomy[] | undefined
}
