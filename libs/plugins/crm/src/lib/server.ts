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
 * `plugins.config.json` names this module's register function and the
 * `crm` API prefix, the generated server manifest loads this file, and the
 * console's `/api/[...pluginApi]` dispatcher reaches the handler. A plugin
 * whose first real route also had to be its first wiring test would have
 * two things to debug at once.
 *
 * The real routes are the writes with a side effect outside the document:
 * `crm/contact-stage` (AGL-2605) exists for the EVENT — `contactStageChanged`
 * can only be emitted by a server path that performed the write, so a record
 * page that moved the stage client-direct would move the person and tell no
 * automation; the task routes (AGL-2599) carry an assignee's notification and
 * the `taskCompleted` event; `crm/contacts-import` (AGL-2602) pushes one chunk
 * of a file through the same capture door every other server door uses.
 * `crm/deal-stage` (AGL-2598) is the one writer of a deal's stage, won and lost,
 * because a stage change is what automations listen for (`server-deal-stage.ts`).
 * `crm/contacts-create` (AGL-2596) is a person typed into the console by a
 * member of the team — a server route because the dedupe against every
 * holder's rows and the audience band are judgments the browser cannot make.
 * Every other field stays client-direct under the rules.
 */

import {
  contactFacetPath,
  CRM_COLLECTIONS,
  crmReadTokens,
  isContactLifecycleStage,
  isOrgWideMember,
  normalizeAddress,
  normalizeContactEmail,
  normalizePhone,
  type AglynPostalAddress,
  type PluginApiHandler,
  type PluginApiRequest,
  readContactFacet,
  registerPluginApiRoute,
  visibleToHost,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  firebaseAdmin,
  getOrgForHost,
  logHostActivity,
  memberHasOrgPermission,
  orgDataCollectionForHost,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { captureHostContact, emitHostEvent } from '@aglyn/tenant-runtime'
import { FieldValue } from 'firebase-admin/firestore'
import { CRM_API_ROUTES } from './constants/api-routes'
import { BUNDLE_ID } from './constants/bundle-common'
import { CRM_TASK_ROUTES } from './model/task-routes'
import { crmTaskCompleteHandler, crmTaskSaveHandler } from './server/task-routes'
import { crmContactsImportHandler } from './server/contacts-import'
import { crmDealStageHandler } from './server-deal-stage'
import { crmEmailSendHandler } from './server/email-send'
import { leadConvertHandler } from './server/lead-convert'
import {
  CONTACT_EMAIL_HISTORY_ROUTE,
  contactEmailHistoryHandler,
} from './server/contact-email-history'

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

type Refusal = { ok: false; status: number; error: string }

/**
 * Who is calling, and whether they may edit this site's CRM.
 *
 * The same check the inbox, bookings and email console routes make: a
 * bearer ID token, verified, and an `admin` or `editor` role on the host
 * document. A contact is a site's business record, so the site's own role
 * map is the right authority; org-wide reach is not required, because a
 * site editor who can open the record in the console can already write
 * every other field on it client-direct.
 */
async function authorizeSiteEditor(
  req: PluginApiRequest,
  hostId: string,
): Promise<{ ok: true; uid: string } | Refusal> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return { ok: false, status: 401, error: 'Unauthenticated' }
  let uid: string
  try {
    uid = (await firebaseAdmin.app().auth().verifyIdToken(idToken)).uid
  } catch {
    return { ok: false, status: 401, error: 'Unauthenticated' }
  }
  const hostSnapshot = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .get()
  if (!hostSnapshot.exists) {
    return { ok: false, status: 404, error: 'Unknown site' }
  }
  const memberRole = (hostSnapshot.get('memberRoles') ?? {})[uid]
  if (memberRole !== 'admin' && memberRole !== 'editor') {
    return { ok: false, status: 403, error: 'Not a site admin or editor' }
  }
  return { ok: true, uid }
}

/**
 * `POST /api/crm/contact-stage` with `{ hostId, contactId, lifecycleStage }`.
 *
 * Writes the stage into THIS site's facet on the contact — a dotted
 * `update()`, never a top-level field, because the row is shared by every
 * site in the org and a stage is one holder's reading of the person — and
 * then announces `contactStageChanged` with the stage it replaced.
 *
 * A stage set to what it already is writes nothing and announces nothing:
 * the response says `changed: false`, and no automation listening for a
 * change hears one that did not happen.
 *
 * The contact is looked up by id and then checked against `visibleTo`,
 * because the Admin SDK evaluates no rules: a caller who can edit site A
 * must not be able to restage a contact only site B holds by guessing its
 * id, and the scoped query the list uses is not available to a `doc()` read.
 */
export const contactStageHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const hostId = String(req.body?.hostId ?? '').trim()
  const contactId = String(req.body?.contactId ?? '').trim()
  const lifecycleStage: unknown = req.body?.lifecycleStage
  if (!hostId || !contactId) {
    res.status(400).json({ error: 'Missing hostId or contactId' })
    return
  }
  if (!isContactLifecycleStage(lifecycleStage)) {
    res.status(400).json({ error: 'Pick a lifecycle stage' })
    return
  }
  const caller = await authorizeSiteEditor(req, hostId)
  if (caller.ok === false) {
    res.status(caller.status).json({ error: caller.error })
    return
  }
  try {
    const contactsRef = await orgDataCollectionForHost(hostId, 'contacts')
    const snapshot = await contactsRef.doc(contactId).get()
    if (!snapshot.exists || !visibleToHost(snapshot.get('visibleTo'), hostId)) {
      res.status(404).json({ error: 'Unknown contact' })
      return
    }
    const group = await consentGroupForSite(hostId)
    const facet = readContactFacet(
      snapshot.data() as Record<string, unknown>,
      group.groupId,
    )
    const previousStage = facet.lifecycleStage ?? ''
    if (previousStage === lifecycleStage) {
      res
        .status(200)
        .json({ ok: true, changed: false, lifecycleStage, previousStage })
      return
    }
    await snapshot.ref.update({
      [contactFacetPath(group.groupId, 'lifecycleStage')]: lifecycleStage,
      updatedAt: FieldValue.serverTimestamp(),
    })
    // Awaited, not floated: a serverless response ending cancels in-flight
    // work, and the event is the reason this route exists.
    await emitHostEvent(hostId, 'contactStageChanged', {
      contactId,
      email: String(snapshot.get('email') ?? ''),
      lifecycleStage,
      previousStage,
    })
    res
      .status(200)
      .json({ ok: true, changed: true, lifecycleStage, previousStage })
  } catch (error) {
    console.error('[crm] contact-stage failed', hostId, contactId, error)
    res.status(500).json({ error: 'The stage could not be changed' })
  }
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
 * Body: `{ hostId, email, name?, phone?, jobTitle?, companyName?,
 * companyId?, address?, ownerUid?, lifecycleStage?, tags?,
 * marketingConsent? }`. Answers `{ contactId, created }`: `created` is
 * false when the address already belonged to somebody, in which case what
 * was typed MERGES into the existing row — the dedupe the shared address
 * book exists for, and the reason a second "create" of one person is not
 * an error.
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
 * ## The company (AGL-2613)
 *
 * `companyId` is the picker's choice, and it is checked before anything is
 * written: the company has to exist and be visible to the capturing site's
 * scope, or a caller could file a person under a record they cannot open —
 * the same refusal the lead conversion makes. It reaches the upsert as
 * `facet.companyId`, which is where the link is kept in step with its mirror
 * and the company's contacts count; a merge onto somebody already at another
 * company is a MOVE there, not a second link. The stored company's own name
 * is what is echoed, over whatever the client sent, because the name on the
 * record is the company's and not the form's.
 *
 * ## What it writes beyond the upsert
 *
 * `upsertHostContact` takes the profile — phone, title, address, owner,
 * stage, company — and writes it into the capturing group's facet. The two
 * things it does not take are written here by DOTTED path afterwards: the
 * tags, which union into whatever the person already carried, and the
 * company name — the picked company's, or free text for a person filed
 * under a name no company record carries yet. Dotted paths because this is
 * an `update()`, and only an update reads a dot as a path — a nested object
 * here would replace the facet map and take every other holder's records
 * with it.
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
  let companyName = typed(body['companyName'], 120)
  const companyId = typed(body['companyId'], 128)
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

    if (companyId) {
      const group = await consentGroupForSite(
        hostId,
        resolved.org as Record<string, unknown>,
      )
      const readable = new Set<string>(crmReadTokens(group))
      const companySnapshot = await firebaseAdmin
        .app()
        .firestore()
        .collection('orgs')
        .doc(resolved.orgId)
        .collection(CRM_COLLECTIONS.companies)
        .doc(companyId)
        .get()
      const tokens: unknown = companySnapshot.exists
        ? companySnapshot.get('visibleTo')
        : undefined
      const visible =
        Array.isArray(tokens) && tokens.some((token) => readable.has(String(token)))
      if (!visible) {
        res.status(404).json({ error: 'Unknown company' })
        return
      }
      companyName = typed(companySnapshot.get('name'), 120) || companyName
    }

    const result = await captureHostContact({
      hostId,
      email,
      ...(name ? { name } : {}),
      source: 'manual',
      interaction: { summary: 'Added by hand' },
      marketingConsent,
      facet: {
        ...(phone ? { phone } : {}),
        ...(jobTitle ? { jobTitle } : {}),
        ...(companyId ? { companyId } : {}),
        ...(address ? { address } : {}),
        ...(ownerUid ? { ownerUid } : {}),
        ...(rawStage && isContactLifecycleStage(rawStage)
          ? { lifecycleStage: rawStage }
          : {}),
      },
    })

    if ('refused' in result) {
      if (result.refused === 'band') {
        res.status(409).json({ error: CONTACT_BAND_FULL_MESSAGE, reason: 'band' })
        return
      }
      if (result.refused === 'invalid-email') {
        res.status(400).json({ error: 'Enter a valid email address.' })
        return
      }
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

    /*
     * The audit line, written HERE rather than by the console (AGL-2622):
     * a route that verified the caller and performed the write is the one
     * writer that cannot record an act that did not happen, which is the
     * reason `check-activity-coverage.mjs` counts this file. A merge into
     * a person the org already held is said to be one — the row was
     * updated, not added — so the feed cannot claim two people for one.
     */
    await logHostActivity(
      hostId,
      { uid: decoded.uid, email: decoded.email ?? null },
      result.created ? 'Added contact' : 'Updated contact',
      { type: 'contact', id: result.contactId, name: name || email },
    )

    res
      .status(result.created ? 201 : 200)
      .json({ contactId: result.contactId, created: result.created })
  } catch (error) {
    console.error('[crm] contact create failed', error)
    res.status(500).json({ error: 'The contact could not be saved.' })
  }
}

/** Console API registration, named in `plugins.config.json` as `consoleApi`. */
export function registerCrmConsoleApi(): void {
  registerPluginApiRoute(CRM_API_ROUTES.ping, crmPingHandler)
  registerPluginApiRoute(CRM_API_ROUTES.contactStage, contactStageHandler)
  // Tasks (AGL-2599): the two writes with a side effect outside the document
  // — an assignee's notification, and the `taskCompleted` host event.
  registerPluginApiRoute(CRM_TASK_ROUTES.save, crmTaskSaveHandler)
  registerPluginApiRoute(CRM_TASK_ROUTES.complete, crmTaskCompleteHandler)
  // One chunk of a contact file (AGL-2602), judged and written through the
  // same door every capture uses.
  registerPluginApiRoute('crm/contacts-import', crmContactsImportHandler)
  // The one writer of a deal's stage, won and lost (AGL-2598): the browser
  // could write the field, but only a server can emit the event an
  // automation listens for.
  registerPluginApiRoute('crm/deal-stage', crmDealStageHandler)
  // A person typed into the console (AGL-2596): the capture doors' own
  // function behind a session check, so the dedupe and the band are judged
  // where every other door judges them.
  registerPluginApiRoute('crm/contacts-create', crmContactsCreateHandler)
  // A lead becomes a contact, a company and a deal (AGL-2608) — the one CRM
  // write a browser cannot make alone, because only the server may create a
  // contact through the dedupe-and-meter door.
  registerPluginApiRoute('crm/lead-convert', leadConvertHandler)
  // The one READ behind a route (AGL-2616): the per-recipient delivery log
  // is closed to clients, so a contact's campaign mail is projected here.
  registerPluginApiRoute(CONTACT_EMAIL_HISTORY_ROUTE, contactEmailHistoryHandler)
  // One email to one person from their record (AGL-2615): the recipient is
  // read off the record, the daily cap and both suppression lists are
  // judged, and the message leaves on the site's sending identity.
  registerPluginApiRoute(CRM_API_ROUTES.emailSend, crmEmailSendHandler)
}
