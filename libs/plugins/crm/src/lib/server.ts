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
 * Every other field stays client-direct under the rules.
 */

import {
  contactFacetPath,
  isContactLifecycleStage,
  type PluginApiHandler,
  type PluginApiRequest,
  readContactFacet,
  registerPluginApiRoute,
  visibleToHost,
} from '@aglyn/aglyn/server'
import {
  consentGroupForSite,
  firebaseAdmin,
  orgDataCollectionForHost,
} from '@aglyn/tenant-data-admin'
import { emitHostEvent } from '@aglyn/tenant-runtime'
import { FieldValue } from 'firebase-admin/firestore'
import { CRM_API_ROUTES } from './constants/api-routes'
import { BUNDLE_ID } from './constants/bundle-common'
import { CRM_TASK_ROUTES } from './model/task-routes'
import { crmTaskCompleteHandler, crmTaskSaveHandler } from './server/task-routes'
import { crmContactsImportHandler } from './server/contacts-import'

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
}
