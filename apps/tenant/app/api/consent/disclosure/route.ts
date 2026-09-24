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
  consentGroupForSite,
  firebaseAdmin,
  isDocumentId,
  visitorContentRefusal,
} from '@aglyn/tenant-data-admin'
import {
  consentGroupDisclosure,
  consentGroupDisclosureKey,
} from '@aglyn/aglyn/app-utils/consent-groups'

export const dynamic = 'force-dynamic'

/**
 * What a capture surface on this site must say beside its opt-in checkbox,
 * and the key that proves it said it (AGL-3320).
 *
 * `GET /api/consent/disclosure?hostId=…&formId=…` answers
 * `{ fieldName, text, key }`:
 *
 *  - `text` — the site's consent-group sentence (`consentGroupDisclosure`),
 *    or `null` for a site that sends on its own, whose form needs no second
 *    name beside its own;
 *  - `key` — the `consentGroupDisclosureKey` of exactly that sentence, which
 *    the surface posts back with the submission. The opt-in pools across
 *    the group only when the key is still the group's current one, so a page
 *    that rendered before a rename or before a site joined records the one
 *    site its visitor was on;
 *  - `fieldName` — the field the bound form declares as its opt-in, so the
 *    sentence sits under the checkbox it describes; `null` when the form
 *    declares none, where the surface falls back to the field names the
 *    submit route reads an opt-in from.
 *
 * Asked by the browser rather than composed into the page because the pages
 * are cached and the declaration is not: a cached sentence would outlive the
 * group it names. A short cache here is safe for the reason the key exists —
 * a stale answer can only ever narrow a grant, never widen one.
 *
 * Generic on purpose, and under `consent/` rather than `forms/`: the
 * sentence is the site's, any capture surface may render it, and the Form
 * block is only the first that does.
 */
export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url)
  const hostId = (url.searchParams.get('hostId') ?? '').trim()
  const formId = (url.searchParams.get('formId') ?? '').trim()
  if (!hostId || !isDocumentId(hostId)) {
    return Response.json({ error: 'Missing hostId' }, { status: 400 })
  }
  // A site taken down under a full lock serves none of its content over
  // `/api`, and the sentence its forms carry is some of it.
  const down = await visitorContentRefusal({ hostId })
  if (down) return down

  try {
    const group = await consentGroupForSite(hostId)
    const text = consentGroupDisclosure(group)
    const key = consentGroupDisclosureKey(group)
    /*
     * The declared opt-in field, only when there is a sentence to place and
     * a bound form to read it off: an unbound form has no document, and a
     * site that sends on its own has nothing to put under the field.
     */
    let fieldName: string | null = null
    if (text && formId && isDocumentId(formId)) {
      const declared = await firebaseAdmin
        .app()
        .firestore()
        .collection('hosts')
        .doc(hostId)
        .collection('forms')
        .doc(formId)
        .get()
        .then((snapshot) =>
          snapshot.exists ? snapshot.get('consentFieldName') : null,
        )
      fieldName =
        typeof declared === 'string' && declared.trim() ? declared.trim() : null
    }
    return Response.json(
      { fieldName, text, key },
      { headers: { 'Cache-Control': 'public, max-age=60, s-maxage=60' } },
    )
  } catch (error) {
    /*
     * No sentence on a failed read, which is the safe answer: the form
     * renders without it, posts no key, and its opt-in records the one site
     * the visitor is on.
     */
    console.error('[consent] disclosure lookup failed', error)
    return Response.json(
      { fieldName: null, text: null, key: null },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  }
}
