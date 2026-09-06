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
 * THE RECIPES, INSTALLED FROM THE ORGANIZATION (AGL-2639).
 *
 * On a site, a recipe opens the Actions editor prefilled and writes nothing
 * until the person saves — the editor is the writer, and the site's own
 * role is the authority. The organization-level CRM hub has no editor: it
 * mounts over every site with no site of its own, and an org running five
 * sites installed "Welcome a new lead" five times by hand. These two routes
 * are the org hub's door to a site's automations.
 *
 * `crm/recipe-install` writes the action a recipe builds into ONE site's
 * `hosts/{hostId}/actions`, as the site editor would have saved it — the
 * same builder, the same validator, the same stored shape — and refuses a
 * second install of the same recipe on the same site by the stamp the
 * builder puts on it. A server route rather than a client write for three
 * reasons the browser cannot supply: the document is created by a server
 * on every plan (the rules close `actions` to client creates, and the
 * per-site cap is counted here); the stamp is the server's word, not the
 * caller's; and the site is checked to be one the caller may manage —
 * at the org level, a site OF THE ORG the caller holds org-wide reach in,
 * so a host id typed into the body cannot reach a site under another
 * workspace.
 *
 * `crm/recipe-status` reads the stamps back for every site of the org, so
 * the card can say which sites carry which recipe. An action with no stamp
 * at all — saved before the stamp existed — is counted, not ignored: it
 * may well be a recipe, and the reader is told the site "may already have
 * it" rather than shown a clean slate.
 *
 * Both routes serve the site variant too (`hostId` alone, authorized by the
 * host role that creates actions today), so a site-level caller gets the
 * same answers; the org variant (`orgId` in the body) is the one the org
 * hub uses.
 */

import {
  ACTIONS_MAX_PER_HOST,
  type AglynOrganization,
  checkEntitlement,
  createResourceUid,
  crmActionRecipe,
  type CrmActionRecipeId,
  hostActionDocument,
  hostActionRecipeId,
  hostRoleCanWrite,
  planLabelGrantingFeature,
  type PluginApiHandler,
  type PluginApiRequest,
  validateHostAction,
} from '@aglyn/aglyn/server'
import {
  firebaseAdmin,
  getOrgForHost,
  logHostActivity,
  logOrgActivity,
} from '@aglyn/tenant-data-admin'
import { FieldValue } from 'firebase-admin/firestore'
import {
  CRM_API_ROUTES,
  type CrmRecipeInstallRequest,
  type CrmRecipeInstallResult,
  type CrmRecipeSiteStatus,
} from '../constants/api-routes'
import { authorizeOrgCaller, orgHostIds, readCrmRouteScope } from './org-caller'

export const CRM_RECIPE_INSTALL_ROUTE = CRM_API_ROUTES.recipeInstall
export const CRM_RECIPE_STATUS_ROUTE = CRM_API_ROUTES.recipeStatus

type Refusal = { ok: false; status: number; error: string }

/** A verified caller who may write a site's actions, and the site's org. */
interface SiteWriter {
  ok: true
  uid: string
  email: string | null
  staff: boolean
  orgId: string
  org: Partial<AglynOrganization>
  host: FirebaseFirestore.DocumentSnapshot
}

const INSTALL_REFUSAL =
  'Installing a recipe requires the data permission across the whole workspace'
const STATUS_REFUSAL =
  'Reading which sites carry a recipe requires the data permission across the whole workspace'

function typed(value: unknown, max: number): string {
  return String(value ?? '')
    .trim()
    .slice(0, max)
}

/**
 * The site variant's authority: the role on the host document that creates
 * an action through `/api/hosts/resources` today. Staff pass, as they pass
 * that route. Answers the host snapshot it read, so the caller reads it
 * once.
 */
async function authorizeSiteWriter(
  req: PluginApiRequest,
  hostId: string,
): Promise<SiteWriter | Refusal> {
  const authorization = String(req.headers.authorization ?? '')
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) return { ok: false, status: 401, error: 'Unauthenticated' }
  let decoded: { uid: string; email?: string; staff?: unknown }
  try {
    decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
  } catch {
    return { ok: false, status: 401, error: 'Unauthenticated' }
  }
  const staff = decoded.staff === true
  const host = await firebaseAdmin
    .app()
    .firestore()
    .collection('hosts')
    .doc(hostId)
    .get()
  if (!host.exists) return { ok: false, status: 404, error: 'Unknown site' }
  const role = (host.get('memberRoles') ?? {})[decoded.uid]
  if (!staff && !hostRoleCanWrite(role)) {
    return { ok: false, status: 403, error: 'Editing requires the editor role' }
  }
  const resolved = await getOrgForHost(hostId)
  if (!resolved) return { ok: false, status: 404, error: 'Unknown site' }
  return {
    ok: true,
    uid: decoded.uid,
    email: decoded.email ?? null,
    staff,
    orgId: resolved.orgId,
    org: resolved.org,
    host,
  }
}

/**
 * The org variant's site check: the host document, when it belongs to the
 * organization the caller was admitted to. A site under another workspace
 * — or none — reads as unknown, so a probe learns nothing from the answer.
 */
async function siteOfOrg(
  firestore: FirebaseFirestore.Firestore,
  hostId: string,
  orgId: string,
): Promise<FirebaseFirestore.DocumentSnapshot | null> {
  const host = await firestore.collection('hosts').doc(hostId).get()
  return host.exists && host.get('orgId') === orgId ? host : null
}

/** How a site reads in a feed line: its display name, its subdomain, its id. */
function siteLabel(host: FirebaseFirestore.DocumentSnapshot): string {
  return (
    String(host.get('displayName') ?? '').trim() ||
    String(host.get('subdomain') ?? '').trim() ||
    host.id
  )
}

/**
 * The stamps a site's LIVE actions carry, read with a field mask: the
 * install's duplicate check and the status sweep ask the same question,
 * and neither needs a trigger or a step list to answer it. A soft-deleted
 * action (`deletedAt`) is a freed slot and counts for nothing.
 */
function readSiteStamps(rows: FirebaseFirestore.QuerySnapshot): {
  installed: Map<CrmActionRecipeId, string>
  unstamped: number
  live: number
} {
  const installed = new Map<CrmActionRecipeId, string>()
  let unstamped = 0
  let live = 0
  for (const row of rows.docs) {
    if (row.get('deletedAt') != null) continue
    live += 1
    const stamp = hostActionRecipeId(row.data())
    if (stamp === undefined) unstamped += 1
    else if (stamp && !installed.has(stamp)) installed.set(stamp, row.id)
  }
  return { installed, unstamped, live }
}

const stampsQuery = (host: FirebaseFirestore.DocumentReference) =>
  host.collection('actions').select('recipe', 'deletedAt')

/**
 * `POST /api/crm/recipe-install`
 *
 * The body is a CrmRecipeInstallRequest: the site, the recipe, the form a
 * recipe that needs one is keyed on, and the org at the organization level.
 * Answers 201 with a CrmRecipeInstallResult once the action is written, and
 * 409 when a live action on the site already carries the stamp — naming it,
 * so the caller can say "already installed" rather than install it twice.
 *
 * The write is one transaction: the stamps are read, the duplicate and the
 * per-site cap are judged, and the document is created — all inside it, so
 * two installs racing for the same site cannot both land.
 */
export const crmRecipeInstallHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body: Partial<CrmRecipeInstallRequest> =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const scope = readCrmRouteScope(body as Record<string, unknown>)
  const hostId = scope?.hostId ?? ''
  if (!scope || !hostId) {
    res.status(400).json({ error: 'Missing hostId' })
    return
  }
  const recipe = crmActionRecipe(typed(body.recipeId, 64))
  if (!recipe) {
    res.status(400).json({ error: 'Pick a recipe' })
    return
  }
  const formId = typed(body.formId, 200)

  try {
    const firestore = firebaseAdmin.app().firestore()
    let writer: SiteWriter
    if (scope.level === 'org') {
      const caller = await authorizeOrgCaller(req, scope.orgId, {
        needs: 'data.manage',
        refusal: INSTALL_REFUSAL,
      })
      if (caller.ok === false) {
        res.status(caller.status).json({ error: caller.error })
        return
      }
      const host = await siteOfOrg(firestore, hostId, caller.orgId)
      if (!host) {
        res.status(404).json({ error: 'Unknown site' })
        return
      }
      writer = {
        ok: true,
        uid: caller.uid,
        email: caller.email,
        staff: caller.staff,
        orgId: caller.orgId,
        org: caller.org,
        host,
      }
    } else {
      const caller = await authorizeSiteWriter(req, hostId)
      if (caller.ok === false) {
        res.status(caller.status).json({ error: caller.error })
        return
      }
      writer = caller
    }

    // The gate the site's own Recipes menu applies, judged here from the
    // org document rather than trusted from the console: a recipe is an
    // action, and the plan that carries one carries the other.
    if (!checkEntitlement(writer.org, 'actions')) {
      res.status(403).json({
        error:
          `The actions builder requires the ${planLabelGrantingFeature('actions') ?? 'Pro'} ` +
          'plan — see Billing to upgrade',
      })
      return
    }

    const hostRef = writer.host.ref
    let form: { id: string; name: string } | undefined
    if (recipe.needs === 'form') {
      if (!formId) {
        res.status(400).json({ error: 'Pick one of the site’s forms' })
        return
      }
      const snapshot = await hostRef.collection('forms').doc(formId).get()
      if (!snapshot.exists) {
        res.status(404).json({ error: 'Unknown form' })
        return
      }
      // An archived form collects nothing, so a recipe keyed on it would
      // never fire; the name falls back to the id the way every form list's does.
      if (snapshot.get('archivedAt') != null) {
        res.status(400).json({ error: 'That form is archived and collects nothing' })
        return
      }
      form = {
        id: snapshot.id,
        name: String(snapshot.get('displayName') ?? '').trim() || snapshot.id,
      }
    }

    const action = recipe.build(form ? { form } : undefined)
    const problem = validateHostAction(action)
    if (problem) {
      res.status(400).json({ error: problem })
      return
    }

    const actionId = createResourceUid()
    const outcome = await firestore.runTransaction(async (tx) => {
      const stamps = readSiteStamps(await tx.get(stampsQuery(hostRef)))
      const existing = stamps.installed.get(recipe.id)
      if (existing) {
        return {
          status: 409,
          error: 'Already installed on this site',
          actionId: existing,
        }
      }
      if (stamps.live >= ACTIONS_MAX_PER_HOST) {
        return {
          status: 403,
          error: `interactions and actions are capped at ${ACTIONS_MAX_PER_HOST} per site`,
        }
      }
      tx.create(hostRef.collection('actions').doc(actionId), {
        ...hostActionDocument(action),
        createdAt: FieldValue.serverTimestamp(),
        updatedAt: FieldValue.serverTimestamp(),
        createdBy: writer.uid,
      })
      return null
    })
    if (outcome) {
      res.status(outcome.status).json({
        error: outcome.error,
        ...(outcome.actionId ? { actionId: outcome.actionId } : {}),
      })
      return
    }

    const actor = { uid: writer.uid, email: writer.email }
    await logHostActivity(hostId, actor, 'Installed recipe', {
      type: 'content',
      id: actionId,
      name: action.name,
    })
    // The org hub's own feed line, for the act it performed (AGL-2634).
    if (scope.level === 'org') {
      await logOrgActivity(
        writer.orgId,
        actor,
        `Installed the “${recipe.title}” recipe on ${siteLabel(writer.host)}`,
        { type: 'host', id: hostId, name: siteLabel(writer.host) },
      )
    }
    const answer: CrmRecipeInstallResult = {
      ok: true,
      actionId,
      name: action.name,
      recipeId: recipe.id,
    }
    res.status(201).json(answer)
  } catch (error) {
    console.error('[crm] recipe install failed', hostId, error)
    res.status(500).json({ error: 'The recipe could not be installed' })
  }
}

/**
 * `POST /api/crm/recipe-status`
 *
 * The body names the organization (`orgId`) for every one of its sites, or
 * one site (`hostId`) for that site alone. Answers `ok: true` and `sites`,
 * one CrmRecipeSiteStatus per site swept.
 */
export const crmRecipeStatusHandler: PluginApiHandler = async (req, res) => {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    res.status(405).json({ error: 'Method not allowed' })
    return
  }
  const body: Record<string, unknown> =
    typeof req.body === 'string' ? JSON.parse(req.body) : (req.body ?? {})
  const scope = readCrmRouteScope(body)
  if (!scope) {
    res.status(400).json({ error: 'Missing orgId or hostId' })
    return
  }
  try {
    const firestore = firebaseAdmin.app().firestore()
    let hostIds: string[]
    if (scope.level === 'org') {
      const caller = await authorizeOrgCaller(req, scope.orgId, {
        needs: 'data.manage',
        refusal: STATUS_REFUSAL,
      })
      if (caller.ok === false) {
        res.status(caller.status).json({ error: caller.error })
        return
      }
      hostIds = await orgHostIds(firestore, caller.orgId)
    } else {
      const caller = await authorizeSiteWriter(req, scope.hostId)
      if (caller.ok === false) {
        res.status(caller.status).json({ error: caller.error })
        return
      }
      hostIds = [scope.hostId]
    }
    const sites = await Promise.all(
      hostIds.map(async (hostId): Promise<CrmRecipeSiteStatus> => {
        const stamps = readSiteStamps(
          await stampsQuery(firestore.collection('hosts').doc(hostId)).get(),
        )
        return {
          hostId,
          installed: [...stamps.installed.keys()],
          unstamped: stamps.unstamped,
        }
      }),
    )
    res.status(200).json({ ok: true, sites })
  } catch (error) {
    console.error('[crm] recipe status failed', error)
    res.status(500).json({ error: 'The recipe status could not be read' })
  }
}
