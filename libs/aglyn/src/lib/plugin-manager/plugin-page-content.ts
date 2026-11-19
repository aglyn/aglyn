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
  definePluginServiceContract,
  registerPluginService,
  resolvePluginService,
} from './plugin-services'

/**
 * Reading and editing what is on a page, as the platform's SERVER does it
 * (AGL-4235).
 *
 * The public API reads a page's elements and edits them, and every edit lands
 * in the page's DRAFT, exactly where an edit in the Besigner waits, never in
 * what is live. The only server-side page editor belongs to a plugin, and the
 * core never imports a plugin, so the core names the two questions the API
 * asks and one plugin answers them (the `core.site-style-looks` pattern).
 * With none registered, a caller answers that reading or editing a page's
 * content is not available, and nothing else changes.
 *
 * Nothing here names the plugin that answers: the shapes are the page's, not
 * the editor's.
 */

/** One element on the page, flattened: its children are named by id. */
export interface PageContentElement {
  id: string
  /** The kind of element, e.g. a heading or a section. */
  kind: string
  /** The plugin that provides the kind, when it is not a core one. */
  pluginId?: string
  /** The name a person gave the element in the editor's layers. */
  name?: string
  /** The element it sits in, or `null` for the page's root. */
  parentId: string | null
  /** The elements inside it, in order. */
  children: string[]
  props: Record<string, unknown>
  style?: Record<string, unknown>
  hidden?: boolean
}

/** One setting a kind of element takes, as far as an editor needs to fill it. */
export interface PageContentKindProp {
  /** What the setting is for, e.g. the text a person reads, or a link. */
  role?: string
  /** The type of value, e.g. `string`, `number`, `boolean`, `image`. */
  type?: string
  /** The values a setting with a fixed list of choices takes. */
  values?: string[]
  maxLength?: number
}

/** What is known about one kind of element on the page. */
export interface PageContentKind {
  label: string
  acceptsChildren: boolean
  props: Record<string, PageContentKindProp>
}

/** A page's elements, as a read answers them. */
export interface PageContentRead {
  ok: true
  pageId: string
  versionId: string
  /** Which tree was read: the waiting draft, or the saved version. */
  base: 'draft' | 'saved'
  /** Changes whenever the base tree changes; an edit may require it to match. */
  revision: string
  rootId: string
  /** How many elements the page has, which may exceed `elements` when one branch was read. */
  total: number
  elements: PageContentElement[]
  /** Every kind of element in `elements`, by kind. */
  kinds: Record<string, PageContentKind>
}

/** An element to add, with anything inside it. */
export interface PageContentNewElement {
  kind: string
  props?: Record<string, unknown>
  style?: Record<string, unknown>
  name?: string
  children?: PageContentNewElement[]
}

/** One change to a page's draft. A batch of edits applies all or none. */
export type PageContentEdit =
  | { op: 'updateProps'; elementId: string; props: Record<string, unknown> }
  | { op: 'updateStyle'; elementId: string; style: Record<string, unknown> }
  | { op: 'rename'; elementId: string; name: string }
  | { op: 'insert'; parentId: string; index?: number | null; element: PageContentNewElement }
  | { op: 'move'; elementId: string; parentId: string; index: number }
  | { op: 'remove'; elementId: string }

/** A read or an edit that was refused, with the status and code an API answers. */
export interface PageContentRefusal {
  ok: false
  status: 400 | 404 | 409 | 413 | 422
  code: string
  message: string
  /** The edit or field each problem was found in, when there is one. */
  fields?: Record<string, string>
}

/** A batch of edits saved to the page's draft. */
export interface PageContentEditResult {
  ok: true
  pageId: string
  versionId: string
  /** The draft's revision after the edits. */
  revision: string
  /** How many edits were applied. */
  applied: number
  /** The ids given to inserted elements, by the index of the edit that inserted them. */
  created: Array<{ index: number; id: string }>
}

export interface PageContentReadInput {
  /** The server's Firestore, as the caller holds it. */
  firestore: unknown
  orgId: string
  hostId: string
  pageId: string
  /** Read only this element and what is inside it. */
  elementId?: string
}

export interface PageContentEditInput {
  /** The server's Firestore, as the caller holds it. */
  firestore: unknown
  orgId: string
  hostId: string
  pageId: string
  edits: PageContentEdit[]
  /** Refuse with a 409 when the base tree's revision is no longer this one. */
  ifRevision?: string
  /** Who the edit is made for, for the page's history: a person's uid, or `null` for a key. */
  actor: { uid: string | null; label: string }
  /** A caller-chosen id for the batch, so a replay saves it once. */
  editId: string
  /** The media scopes the caller holds, for edits that name a media file. */
  mediaScopes: string[]
}

export interface PageContentService {
  read(input: PageContentReadInput): Promise<PageContentRead | PageContentRefusal>
  editDraft(input: PageContentEditInput): Promise<PageContentEditResult | PageContentRefusal>
}

export const PLUGIN_PAGE_CONTENT = definePluginServiceContract<PageContentService>('core.page-content', {
  multiple: false,
})

/** Registers the plugin that reads and edits page content. One per deployment; a second is refused. */
export function registerPluginPageContent(impl: PageContentService, options: { pluginId: string }): void {
  registerPluginService(PLUGIN_PAGE_CONTENT, impl, { pluginId: options.pluginId })
}

/** The registered page content service, or `null` when no plugin answers. */
export function resolvePluginPageContent(): PageContentService | null {
  return resolvePluginService(PLUGIN_PAGE_CONTENT) ?? null
}
