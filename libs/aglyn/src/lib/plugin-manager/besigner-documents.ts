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
  FIRST_PARTY_PLUGINS,
  PLUGIN_BESIGNER_DOCUMENTS_DECLARED,
} from './first-party-plugins.generated'

/**
 * A DOCUMENT A PLUGIN KEEPS UNDER A SITE AND AUTHORS IN THE BESIGNER.
 *
 * Screens, layouts and components are the platform's own documents, and the
 * console has an editor route for each. A plugin can keep one too — a
 * versioned node tree under `hosts/{hostId}/{collection}/{docId}`, its
 * working copies under `versions/{versionId}`, and a published copy on the
 * document itself — and it gets the same editor without the console naming
 * it: the console serves one besigner and one preview route for every
 * declared kind, at `/{orgSlug}/hosts/{host}/{segment}/{docId}/versions/
 * {versionId}/besigner` and `/preview`.
 *
 * ## Publishing belongs to the plugin
 *
 * The editor saves the working version itself; that is a plain node write,
 * the same for every document. Making a version the one the site serves is
 * not: a document can be a contract as well as a drawing, and only its
 * plugin knows what the design owes. So the editor never writes the
 * published copy. It POSTs `{ hostId, [idField]: docId, versionId }` to the
 * plugin's declared `publish.path`, a server route that reads the stored
 * version itself, refuses a design that breaks what the document promises,
 * writes the published copy and drops the live pages that place it. A
 * refusal answers `{ error, violations?: [{ message }] }`, and the editor
 * shows it as {@link besignerPublishRefusal} words it.
 *
 * Compiled from `plugins.config.json` (`besignerDocuments`) rather than
 * registered: the route resolves its segment on the server, in a layout that
 * loads no plugin code, and a kind nothing had registered yet would 404 an
 * editor link that works a second later.
 */

/** How the editor asks the plugin to publish a version. */
export interface BesignerDocumentPublish {
  /** The console route that publishes, e.g. `/api/hosts/<segment>/promote`. */
  path: string
  /** The body field that carries the document id. */
  idField: string
}

export interface BesignerDocumentDeclaration {
  /**
   * The kind the editor's shared machinery keys on — presence rooms, saved
   * drafts and previews — and so a stored value: never renamed.
   */
  kind: string
  /** The URL segment under a site, and the editor route's `[documentSegment]`. */
  segment: string
  /** The subcollection under `hosts/{hostId}` its documents live in. */
  collection: string
  /** What one is called in the editor's sentences, lower case: "form". */
  noun: string
  publish: BesignerDocumentPublish
}

/** A declaration with the plugin that made it. */
export type ResolvedBesignerDocument = BesignerDocumentDeclaration & {
  pluginId: string
}

/** Every declared kind, in declared order. */
export function besignerDocuments(): readonly ResolvedBesignerDocument[] {
  return PLUGIN_BESIGNER_DOCUMENTS_DECLARED
}

/** The kind served under a site's `segment`, or `null`. */
export function besignerDocumentForSegment(
  segment: string | undefined | null,
): ResolvedBesignerDocument | null {
  if (!segment) return null
  return (
    PLUGIN_BESIGNER_DOCUMENTS_DECLARED.find((one) => one.segment === segment) ??
    null
  )
}

/** The noun with its first letter raised, for the start of a sentence. */
export function besignerDocumentTitle(noun: string): string {
  return noun ? noun.charAt(0).toUpperCase() + noun.slice(1) : noun
}

/**
 * What to tell the author when a publish is refused.
 *
 * The first violation in full plus a count, rather than every message
 * joined: the messages are sentences, and a stack of six of them in one
 * notice is read as a wall rather than as instructions. The count is what
 * says the list does not end at the one being shown. A refusal with no
 * violations says its `error`; one with neither says the publish failed.
 */
export function besignerPublishRefusal(
  body: unknown,
  noun: string,
): string {
  const payload = (body ?? {}) as {
    error?: unknown
    violations?: Array<{ message?: unknown }>
  }
  const violations = Array.isArray(payload.violations)
    ? payload.violations.filter(
        (violation) => typeof violation?.message === 'string',
      )
    : []
  const [first, ...rest] = violations
  if (first) {
    const message = String(first.message)
    if (!rest.length) return message
    return (
      `${message} There ${rest.length === 1 ? 'is' : 'are'} ${rest.length} ` +
      `other problem${rest.length === 1 ? '' : 's'} to fix before this ` +
      `${noun} can be published.`
    )
  }
  return typeof payload.error === 'string' && payload.error
    ? payload.error
    : `The ${noun} could not be published.`
}

/**
 * Why a document cannot be published on a site that switched its plugin off.
 *
 * The plugin's publish route is behind the platform's per-site switch, so on
 * such a site it would answer as if it did not exist. The editor asks the
 * site's plugin set first and says this instead, naming the plugin the way
 * the site's plugin settings do.
 */
export function besignerDocumentOffForSite(
  declared: ResolvedBesignerDocument,
): string {
  const label =
    FIRST_PARTY_PLUGINS.find((plugin) => plugin.id === declared.pluginId)
      ?.label ?? declared.pluginId
  return (
    `${label} is switched off for this site, so a ${declared.noun} published ` +
    `here would not show on its pages. Switch ${label} back on for this site ` +
    `in Admin › Plugins to publish it.`
  )
}
