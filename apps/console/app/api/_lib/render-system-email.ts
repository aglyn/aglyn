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
  EMAIL_NODE_ROOT_ID,
  SYSTEM_EMAIL_COLLECTION,
  buildDefaultEmailNodeMap,
  getSystemEmailTemplate,
  isSystemEmailEditable,
  renderEmailHtml,
  substituteMergeTokens,
  type SystemEmailTemplateDefinition,
} from '@aglyn/shared-util-email'
import { firebaseAdmin } from '@aglyn/tenant-data-admin'

/**
 * Blanks any `{{token}}` the caller did not supply.
 *
 * `substituteMergeTokens` leaves unknown tokens untouched, which is right for
 * campaigns (an author wants to see the tag they mistyped) but wrong here —
 * a system email goes to a customer, and "You've been invited to
 * {{org.name}}" is worse than a gap. Applied only in this resolver so
 * campaign behaviour is unchanged.
 */
function blankUnresolvedTokens(value: string): string {
  return value.replace(/\{\{[^}]*\}\}/g, '')
}

export interface RenderedSystemEmail {
  subject: string
  html: string
  text: string
}

/**
 * A staff-designed template loaded from Firestore, ready to render for any
 * number of recipients without touching Firestore again (AGL-768).
 */
export interface LoadedSystemEmail {
  definition: SystemEmailTemplateDefinition
  nodes: Record<string, unknown>
  subjectTemplate: string
  preheaderTemplate: string
}

/**
 * Loads the published staff-designed template for a key — ONE Firestore read
 * — or `null` when there is nothing usable (no document, no published
 * version, an empty node map, an unknown or non-Resend key, or a read
 * failure). Split out from {@link renderSystemEmail} so a batch send resolves
 * the template once and renders it per recipient, rather than one read each
 * (AGL-768): a Firestore read per invite is fine, one per recipient in a
 * usage-email batch is not.
 *
 * Reads through the Admin SDK, which bypasses the staff-only rules on the
 * collection — the send path runs as the server, not as a signed-in user.
 */
export async function loadSystemEmail(
  templateKey: string,
): Promise<LoadedSystemEmail | null> {
  const definition = getSystemEmailTemplate(templateKey)
  if (!definition) return null
  // A Firebase- or Stripe-delivered email is sent by that service from its
  // own templates, so rendering one here would produce output nothing ever
  // sends (AGL-751/767).
  if (definition.deliveredBy !== 'resend') return null

  try {
    const firestore = firebaseAdmin.app().firestore()
    const templateRef = firestore
      .collection(SYSTEM_EMAIL_COLLECTION)
      .doc(templateKey)
    const templateSnapshot = await templateRef.get()
    if (!templateSnapshot.exists) return null

    const versionId = templateSnapshot.get('versionId')
    // Cleared by "reset to default", which nulls the pointer rather than
    // deleting the document so the audit trail survives.
    if (!versionId) return null

    const versionSnapshot = await templateRef
      .collection('versions')
      .doc(String(versionId))
      .get()
    const nodes = versionSnapshot.get('nodes') as
      | Record<string, unknown>
      | undefined
    if (!nodes || !Object.keys(nodes).length) return null

    return {
      definition,
      nodes,
      subjectTemplate:
        String(templateSnapshot.get('subject') ?? '') ||
        definition.defaultSubject,
      preheaderTemplate: String(templateSnapshot.get('preheader') ?? ''),
    }
  } catch (error) {
    // Never let a template problem block the send — the caller falls back to
    // its built-in copy and the recipient still gets their email.
    console.error(`system email template ${templateKey} failed to load`, error)
    return null
  }
}

/**
 * Renders a pre-loaded template for one recipient's merge values (AGL-768).
 * No Firestore access — call {@link loadSystemEmail} once, then this per
 * recipient. Returns `null` if the node map renders empty, so the caller
 * still falls back to its built-in copy.
 */
export function renderLoadedSystemEmail(
  loaded: LoadedSystemEmail,
  merge: Record<string, string> = {},
): RenderedSystemEmail | null {
  const rendered = renderEmailHtml({
    nodes: loaded.nodes as never,
    // Besigner maps are rooted at '_@_', not renderEmailHtml's default
    // 'root' — without this a designed template rendered empty and the send
    // fell back to built-in copy, so designing did nothing (AGL-765).
    rootId: EMAIL_NODE_ROOT_ID,
    subject: substituteMergeTokens(loaded.subjectTemplate, merge),
    preheader: substituteMergeTokens(loaded.preheaderTemplate, merge),
    merge,
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
 * Renders a staff-designed system email template (AGL-750).
 *
 * **Returns `null` whenever there is nothing usable to render** — no
 * template document, no published version, an empty node map, an unknown
 * key, or a Firestore failure. That is the entire safety story of this
 * feature: every caller keeps its existing hard-coded copy as the fallback,
 * so a missing, half-saved or broken template can never mean a customer
 * receives no email at all. It degrades to the status quo, never to silence.
 *
 * A single-recipient convenience over {@link loadSystemEmail} +
 * {@link renderLoadedSystemEmail}; a batch should call those two directly so
 * it reads the template once.
 */
export async function renderSystemEmail(
  templateKey: string,
  merge: Record<string, string> = {},
): Promise<RenderedSystemEmail | null> {
  const loaded = await loadSystemEmail(templateKey)
  return loaded ? renderLoadedSystemEmail(loaded, merge) : null
}

/**
 * Renders the email a template would send RIGHT NOW: the staff-designed
 * version if one is published, otherwise the catalog default (AGL-766).
 *
 * Unlike {@link renderSystemEmail}, which returns null when nothing is
 * published so a send site can fall back to its own hard-coded copy, this
 * always returns something for an editable template — the default is rendered
 * from the same `defaultBody` the editor seeds, so "test" and "design" agree.
 * Returns null only for an unknown or Firebase-delivered key, which have no
 * body to render. Used by the test-send endpoint; not on any real send path.
 */
export async function renderEffectiveSystemEmail(
  templateKey: string,
  merge: Record<string, string> = {},
): Promise<RenderedSystemEmail | null> {
  const definition = getSystemEmailTemplate(templateKey)
  if (!definition || !isSystemEmailEditable(definition)) return null

  const designed = await renderSystemEmail(templateKey, merge)
  if (designed) return designed

  // Nothing published — render the catalog default the editor would seed.
  const nodes = buildDefaultEmailNodeMap(definition)
  const rendered = renderEmailHtml({
    nodes: nodes as never,
    rootId: EMAIL_NODE_ROOT_ID,
    subject: substituteMergeTokens(definition.defaultSubject, merge),
    merge,
  })
  return {
    subject: blankUnresolvedTokens(
      substituteMergeTokens(definition.defaultSubject, merge),
    ),
    html: blankUnresolvedTokens(rendered.html),
    text: blankUnresolvedTokens(rendered.text ?? ''),
  }
}

export default renderSystemEmail
