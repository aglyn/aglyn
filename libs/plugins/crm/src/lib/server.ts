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
 * The Contacts plugin's SERVER half (AGL-2595).
 *
 * Contacts CRM v1 had none: every console write was client-direct against
 * the Firestore rules, and the one server path that creates a contact —
 * `upsertHostContact` — belongs to the capture doors, not to this plugin.
 * v2 needs a server for the things a browser must not do alone: an import
 * that dedupes forty thousand rows, a bulk action over a selection, an
 * auto-association of contacts to companies by domain. Each of those lands
 * as a `crm/<route>` handler registered here.
 *
 * `crm/ping` exists so the wiring is PROVEN rather than assumed:
 * `plugins.config.json` names this module's register function and the `crm`
 * API prefix, the generated server manifest loads this file, and the
 * console's `/api/[...pluginApi]` dispatcher reaches the handler. A plugin
 * whose first real route also had to be its first wiring test would have two
 * things to debug at once.
 *
 * `crm/contacts-create` (AGL-2596) is the first real route: a person typed
 * into the console by a member of the team. It is a server route and not a
 * client write because creating a contact is the one act on this surface the
 * rules cannot fully judge — the dedupe against every holder's rows is a
 * lookup the capturing site may not read, and the audience band is a count
 * the browser cannot take. Both live in `upsertHostContact`, so the route is
 * the capture doors' own function behind a session check.
 */

import {
  contactFacetPath,
  isContactLifecycleStage,
  isOrgWideMember,
  normalizeAddress,
  normalizeContactEmail,
  normalizePhone,
  type AglynPostalAddress,
  type PluginApiHandler,
  registerPluginApiRoute,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  firebaseAdmin,
  getOrgForHost,
  memberHasOrgPermission,
  orgDataCollectionForHost,
  resolveOrgMembership,
  upsertHostContact,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import { BUNDLE_ID } from './constants/bundle-common'

/**
 * `GET /api/crm/ping` → `{ ok: true, plugin: 'crm' }`.
 *
 * No auth, no host, no data: it answers whether the plugin's server bundle
 * was loaded and its routes registered, which is a fact about the process
 * and not about any org. Anything that reads a document goes behind the
 * same session and role checks the other plugins' console routes use.
 */
export const crmPingHandler: PluginApiHandler = (req, res) => {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  res.status(200).json({ ok: true, plugin: BUNDLE_ID })
}

/**
 * What the create route says when the band refused (AGL-2596).
 *
 * The contacts list's own alert, in the past tense: the list says new
 * visitors are "no longer captured", and this says the one contact the
 * reader just tried to add was not. The remedy is the same sentence in both
 * places, so a reader who sees one and then the other is told one thing.
 */
export const CONTACT_BAND_FULL_MESSAGE =
  'Contact limit reached — this contact was not added. Upgrade in Billing ' +
  'to keep collecting.'

/** The most tags one create may attach, matching the record page's cap. */
const CONTACT_TAGS_MAX = 20

/** What one typed field may be, after the trim every string gets. */
function typed(value: unknown, max: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, max)
}

/**
 * Tags as the record page stores them: lower-cased, trimmed, deduplicated,
 * capped — so a tag typed here and a tag typed on the page are the same tag
 * to the segment filter that matches on them.
 */
function normalizeTags(value: unknown): string[] {
  if (!Array.isArray(value)) return []
  return [
    ...new Set(
      value
        .map((tag) => typed(tag, 40).toLowerCase())
        .filter(Boolean)
        .slice(0, CONTACT_TAGS_MAX),
    ),
  ]
}

/**
 * `POST /api/crm/contacts-create` — a person added by hand (AGL-2596).
 *
 * Body: `{ hostId, email, name?, phone?, jobTitle?, companyName?, address?,
 * ownerUid?, lifecycleStage?, tags?, marketingConsent? }`. Answers
 * `{ contactId, created }`: `created` is false when the address already
 * belonged to somebody, in which case what was typed MERGES into the
 * existing row — the dedupe the shared address book exists for, and the
 * reason a second "create" of one person is not an error.
 *
 * ## Who may call it
 *
 * The caller's ID token, then `data.manage` on the site's org — the same key
 * the console surface itself is gated on, resolved through the same
 * three-layer permission read the members route uses. A scoped member is
 * admitted only for a site they reach: the rules would refuse a browser
 * write outside their tokens, and a server route that admitted it would be
 * a way round the rules rather than a service in front of them.
 *
 * ## What it refuses, and how
 *
 * A malformed email or phone number is a 400 with a sentence the drawer can
 * show under the field. The band is a 409 carrying the list's own wording:
 * it is not a bad request and not a server fault, it is the plan saying no,
 * and the drawer relays the sentence rather than inventing one.
 *
 * ## What it writes beyond the upsert
 *
 * `upsertHostContact` takes the profile — phone, title, address, owner,
 * stage — and writes it into the capturing group's facet. The two things it
 * does not take are written here by DOTTED path afterwards: the tags, which
 * union into whatever the person already carried, and the company name,
 * which is free text until the companies section supplies a picker. Dotted
 * paths because this is an `update()`, and only an update reads a dot as a
 * path — a nested object here would replace the facet map and take every
 * other holder's records with it.
 */
export const crmContactsCreateHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }

  const body = (req.body ?? {}) as Record<string, unknown>
  const hostId = typed(body['hostId'], 128)
  if (!hostId) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const email = normalizeContactEmail(body['email'])
  if (!email) {
    res.status(400).json({ error: 'Enter a valid email address.' })
    return
  }
  const rawPhone = typed(body['phone'], 40)
  const phone = rawPhone ? normalizePhone(rawPhone) : null
  if (rawPhone && !phone) {
    res.status(400).json({
      error:
        'That phone number could not be read. Enter it with its country ' +
        'code, like +1 512 555 0107.',
    })
    return
  }
  const rawStage = typed(body['lifecycleStage'], 40)
  if (rawStage && !isContactLifecycleStage(rawStage)) {
    res.status(400).json({ error: 'Unknown lifecycle stage.' })
    return
  }
  const name = typed(body['name'], 120)
  const jobTitle = typed(body['jobTitle'], 120)
  const companyName = typed(body['companyName'], 120)
  const ownerUid = typed(body['ownerUid'], 128)
  const address =
    body['address'] && typeof body['address'] === 'object'
      ? normalizeAddress(body['address'] as AglynPostalAddress)
      : null
  const tags = normalizeTags(body['tags'])
  const marketingConsent = body['marketingConsent'] === true

  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    res.status(401).json({ error: 'Unauthenticated' })
    return
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    const resolved = await getOrgForHost(hostId)
    if (!resolved) {
      res.status(404).json({ error: 'Unknown site' })
      return
    }
    const isStaff = decoded['staff'] === true
    if (!isStaff) {
      const membership = await resolveOrgMembership(decoded.uid, resolved.orgId)
      const member = membership?.member ?? null
      const reaches =
        isOrgWideMember(member) || Boolean(member?.hostAccess?.[hostId])
      const allowed =
        member &&
        reaches &&
        (await memberHasOrgPermission(resolved.orgId, member, 'data.manage'))
      if (!allowed) {
        res.status(403).json({
          error: 'Adding contacts requires the data.manage permission on this site',
        })
        return
      }
    }

    const result = await upsertHostContact({
      hostId,
      email,
      ...(name ? { name } : {}),
      source: 'manual',
      interaction: { summary: 'Added by hand' },
      marketingConsent,
      facet: {
        ...(phone ? { phone } : {}),
        ...(jobTitle ? { jobTitle } : {}),
        ...(address ? { address } : {}),
        ...(ownerUid ? { ownerUid } : {}),
        ...(rawStage && isContactLifecycleStage(rawStage)
          ? { lifecycleStage: rawStage }
          : {}),
      },
    })

    if (result.outcome === 'refused') {
      if (result.reason === 'band') {
        res.status(409).json({ error: CONTACT_BAND_FULL_MESSAGE, reason: 'band' })
        return
      }
      res.status(400).json({ error: 'Enter a valid email address.' })
      return
    }
    if (result.outcome === 'failed') {
      res.status(500).json({ error: 'The contact could not be saved.' })
      return
    }

    if (tags.length || companyName) {
      const group = await consentGroupForSite(
        hostId,
        resolved.org as Record<string, unknown>,
      )
      const contacts = await orgDataCollectionForHost(hostId, 'contacts')
      await contacts.doc(result.contactId).update({
        ...(tags.length
          ? {
              [contactFacetPath(group.groupId, 'tags')]: FieldValue.arrayUnion(
                ...tags,
              ),
            }
          : {}),
        ...(companyName
          ? {
              [contactFacetPath(group.groupId, 'companyName')]: companyName,
              // The search echo — see `HostContact.companyName`.
              companyName,
            }
          : {}),
        updatedAt: FieldValue.serverTimestamp(),
      })
    }

    res
      .status(result.outcome === 'created' ? 201 : 200)
      .json({ contactId: result.contactId, created: result.outcome === 'created' })
  } catch (error) {
    console.error('[crm] contact create failed', error)
    res.status(500).json({ error: 'The contact could not be saved.' })
  }
}

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerCrmConsoleApi(): void {
  registerPluginApiRoute('crm/ping', crmPingHandler)
  registerPluginApiRoute('crm/contacts-create', crmContactsCreateHandler)
}
