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

import { hostEmailOrigin } from './email-media-src'
import { decodeEmailNodes } from './stored-email-nodes'
import {
  EMAIL_NODE_ROOT_ID,
  renderEmailHtml,
  substituteMergeTokens,
  type EmailRenderOptions,
} from './email-render'
import {
  getTenantEmail,
  isTenantEmailEditable,
  TENANT_EMAIL_COLLECTION,
  type TenantEmailEntry,
} from './tenant-email-catalog'

/**
 * The slice of the Admin Firestore chain this resolver uses. Structural on
 * purpose (AGL-770): the plugins that call this already hold an Admin
 * Firestore instance, so passing it in keeps `@aglyn/shared-util-email` free
 * of a firebase-admin dependency and importable from every send site.
 */
interface AdminDocSnapshotLike {
  exists: boolean
  get(field: string): unknown
}
interface AdminDocRefLike {
  get(): Promise<AdminDocSnapshotLike>
  collection(path: string): AdminCollectionRefLike
}
interface AdminCollectionRefLike {
  doc(id: string): AdminDocRefLike
}
export interface AdminFirestoreLike {
  collection(path: string): AdminCollectionRefLike
}

export interface RenderedHostEmail {
  subject: string
  html: string
  text: string
}

/**
 * Expands the reusable blocks a site's email places into the blocks they stand
 * for (AGL-3287): a shared header or footer is a `reusableInstance` node naming
 * one of the site's components, and `renderEmailHtml` draws an unknown node as
 * nothing at all. Given the decoded node map and the handle and site it was
 * read with; resolves to the map to render.
 *
 * REQUIRED, for the reason `sanitize` is (see
 * {@link EmailRenderOptions.sanitize}): this module is `scope:shared` and the
 * composition — the component graft, the document reads — is the core's, which
 * nx forbids it to import. A composer a caller may omit is one a new send path
 * omits, and its customers then receive every designed email with the header
 * and footer missing while the canvas shows them in place. So the type makes
 * each caller hand one in; every sender passes the core's
 * `composeHostComponentNodes`.
 *
 * Only style overrides are lost on the way through, and not by the composer:
 * a placement's `styleOverrides` land in `sx`, which the mail renderer never
 * reads. Property values and attribute overrides reach the blocks.
 */
export type HostEmailComposer = (
  nodes: Record<string, unknown>,
  context: { firestore: AdminFirestoreLike; hostId: string },
) => Promise<Record<string, unknown>>

export interface LoadHostEmailOptions {
  /** The site's origin when the caller already knows it; saves the host read. */
  origin?: string
  /** See {@link HostEmailComposer} — required, deliberately. */
  compose: HostEmailComposer
}

/**
 * A site-owner-designed template loaded once, ready to render for any number
 * of recipients without another Firestore read (AGL-770) — the booking
 * reminder job renders one per booking.
 */
export interface LoadedHostEmail {
  entry: TenantEmailEntry
  nodes: Record<string, unknown>
  subjectTemplate: string
  preheaderTemplate: string
  /** Host doc id, so an org-scoped media reference can be host-qualified. */
  hostId: string
  /**
   * The site's absolute origin, for absolutizing picked images (AGL-1224).
   * Undefined only for a host with neither a custom domain nor a subdomain,
   * in which case those images are dropped rather than sent broken.
   */
  origin?: string
}

/** Blanks any `{{token}}` the caller did not supply, so a customer never
 * sees a raw tag. Mirrors the platform system-email resolver. */
function blankUnresolvedTokens(value: string): string {
  return value.replace(/\{\{[^}]*\}\}/g, '')
}

/**
 * Loads a site's published email template, or `null` when there is nothing
 * usable (no document, no published version, an empty node map, an unknown or
 * non-designable key). The host-scoped mirror of the platform
 * `loadSystemEmail`: `hosts/{hostId}/emailTemplates/{key}`.
 *
 * The caller passes its own Admin Firestore, so this reads through the Admin
 * SDK — the send path runs as the server, not a signed-in user.
 *
 * TWO reads, not one (AGL-1224): the host document is read for the site's
 * origin, which picked images need to be fetchable from an inbox. It is read
 * LAST, only once there is something to render, so a site with nothing
 * published still costs a single read — and it is skipped entirely when the
 * caller already knows the origin and passes it. Still once per batch, not
 * once per recipient, which is the property AGL-770 cared about.
 *
 * The components the template places are read and grafted HERE, through
 * `options.compose`, for the same reason: once per load, so a batch renders
 * every recipient's copy from one composed map. A template that places none
 * costs no extra read.
 */
export async function loadHostEmail(
  firestore: AdminFirestoreLike,
  hostId: string,
  templateKey: string,
  options: LoadHostEmailOptions,
): Promise<LoadedHostEmail | null> {
  const entry = getTenantEmail(templateKey)
  if (!entry || !isTenantEmailEditable(entry)) return null
  if (!hostId) return null

  try {
    const hostRef = firestore.collection('hosts').doc(hostId)
    const templateRef = hostRef
      .collection(TENANT_EMAIL_COLLECTION)
      .doc(templateKey)
    const templateSnapshot = await templateRef.get()
    if (!templateSnapshot.exists) return null

    const versionId = templateSnapshot.get('versionId')
    if (!versionId) return null

    const versionSnapshot = await templateRef
      .collection('versions')
      .doc(String(versionId))
      .get()
    // BOTH stored forms. The email besigner compresses like every other
    // besigner document (AGL-1151), and every version written before it did
    // is still a plain map — a plain map comes back unchanged, so a single
    // call serves both and keeps serving both.
    //
    // Reading the field raw is the failure the guard below cannot catch: over
    // a `Buffer`, `Object.keys` counts BYTE INDICES, so the emptiness test
    // passes and the caller renders an empty email instead of falling back to
    // its built-in copy (AGL-1223).
    const stored = decodeEmailNodes<Record<string, unknown>>(
      versionSnapshot.get('nodes'),
    )
    if (!stored || !Object.keys(stored).length) return null
    // Reusable blocks (AGL-3287), BEFORE anything reads the tree: a header or
    // footer the site owner placed is a component reference until this runs.
    // A failed component read throws into the catch below and falls back to
    // the built-in copy — never a send with half its design missing.
    const nodes = await options.compose(stored, { firestore, hostId })

    let origin = options.origin
    if (!origin) {
      const hostSnapshot = await hostRef.get()
      origin = hostEmailOrigin({
        cname: hostSnapshot.get('cname') as string | undefined,
        subdomain: hostSnapshot.get('subdomain') as string | undefined,
      })
    }

    return {
      entry,
      nodes,
      hostId,
      origin,
      subjectTemplate:
        String(templateSnapshot.get('subject') ?? '') ||
        entry.defaultSubject ||
        '',
      preheaderTemplate: String(templateSnapshot.get('preheader') ?? ''),
    }
  } catch (error) {
    // Never let a template problem block the send — the caller falls back to
    // its built-in copy and the customer still gets their email.
    console.error(`host email template ${templateKey} failed to load`, error)
    return null
  }
}

/**
 * Renders a pre-loaded template for one recipient's merge values (AGL-770).
 * No Firestore access; returns `null` if the node map renders empty so the
 * caller still falls back to its built-in copy.
 */
export function renderLoadedHostEmail(
  loaded: LoadedHostEmail,
  merge: Record<string, string> = {},
  sanitize: EmailRenderOptions['sanitize'],
): RenderedHostEmail | null {
  const rendered = renderEmailHtml({
    nodes: loaded.nodes as never,
    // A site owner designs these in the besigner, so a template's richtext is
    // author markup exactly as a campaign's is. The policy has to arrive from
    // above for the reason this lib documents everywhere: `scope:shared`
    // cannot import the aglyn-scoped sanitizer.
    sanitize,
    // Besigner maps are rooted at '_@_' (AGL-765).
    rootId: EMAIL_NODE_ROOT_ID,
    subject: substituteMergeTokens(loaded.subjectTemplate, merge),
    preheader: substituteMergeTokens(loaded.preheaderTemplate, merge),
    merge,
    // A picked image is stored as a reference; the site's own origin is what
    // makes it fetchable from a recipient's inbox (AGL-1224).
    mediaOrigin: loaded.origin,
    mediaHostId: loaded.hostId,
  })
  if (!rendered?.html) return null
  return {
    subject: blankUnresolvedTokens(
      substituteMergeTokens(loaded.subjectTemplate, merge),
    ),
    html: blankUnresolvedTokens(rendered.html),
    text: blankUnresolvedTokens(rendered.text ?? ''),
  }
}

/**
 * Renders a site's designed email, or `null` when nothing usable is published
 * so the send site keeps its built-in copy (AGL-770). Single-recipient
 * convenience over {@link loadHostEmail} + {@link renderLoadedHostEmail}; a
 * batch should call those two so it reads the template once.
 */
export async function renderHostEmail(
  firestore: AdminFirestoreLike,
  hostId: string,
  templateKey: string,
  merge: Record<string, string> = {},
  options: LoadHostEmailOptions & {
    /** See {@link EmailRenderOptions.sanitize} — required, deliberately. */
    sanitize: EmailRenderOptions['sanitize']
  },
): Promise<RenderedHostEmail | null> {
  const loaded = await loadHostEmail(firestore, hostId, templateKey, options)
  return loaded ? renderLoadedHostEmail(loaded, merge, options.sanitize) : null
}
