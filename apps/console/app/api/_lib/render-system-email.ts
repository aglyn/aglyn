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
  SYSTEM_EMAIL_COLLECTION,
  getSystemEmailTemplate,
  renderEmailHtml,
  substituteMergeTokens,
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
 * Renders a staff-designed system email template (AGL-750).
 *
 * **Returns `null` whenever there is nothing usable to render** — no
 * template document, no published version, an empty node map, an unknown
 * key, or a Firestore failure. That is the entire safety story of this
 * feature: every caller keeps its existing hard-coded copy as the fallback,
 * so a missing, half-saved or broken template can never mean a customer
 * receives no email at all. It degrades to the status quo, never to silence.
 *
 * Reads through the Admin SDK, which bypasses the staff-only rules on the
 * collection — the send path runs as the server, not as a signed-in user.
 *
 * Resolve this **once per run**, not once per recipient: a Firestore read
 * per invite is fine, one per recipient in a usage-email batch is not.
 */
export async function renderSystemEmail(
  templateKey: string,
  merge: Record<string, string> = {},
): Promise<RenderedSystemEmail | null> {
  const definition = getSystemEmailTemplate(templateKey)
  if (!definition) return null
  // A Firebase-delivered email is sent by Firebase from its own templates,
  // so rendering one here would produce output nothing ever sends (AGL-751).
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

    const subjectTemplate =
      String(templateSnapshot.get('subject') ?? '') ||
      definition.defaultSubject
    const rendered = renderEmailHtml({
      nodes: nodes as never,
      subject: substituteMergeTokens(subjectTemplate, merge),
      preheader: substituteMergeTokens(
        String(templateSnapshot.get('preheader') ?? ''),
        merge,
      ),
      merge,
    })
    if (!rendered?.html) return null

    return {
      subject: blankUnresolvedTokens(
        substituteMergeTokens(subjectTemplate, merge),
      ),
      html: blankUnresolvedTokens(rendered.html),
      text: blankUnresolvedTokens(rendered.text ?? ''),
    }
  } catch (error) {
    // Never let a template problem block the send — the caller falls back to
    // its built-in copy and the recipient still gets their email.
    console.error(`system email template ${templateKey} failed to render`, error)
    return null
  }
}

export default renderSystemEmail
