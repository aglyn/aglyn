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

import { permissionRefusalText } from '@aglyn/aglyn/app-utils/org-permissions'
import { SITE_FONT_PAIRINGS } from '@aglyn/aglyn/app-utils/site-font-pairings'
import { SITE_THEME_BASES } from '@aglyn/aglyn/app-utils/site-starter'
import { siteStarterPresetId } from '@aglyn/aglyn/app-utils/site-starter-theme'
import { runPluginDeclarationsRepair } from '@aglyn/aglyn/plugin-manager/plugin-declarations-repair'
import {
  describeSiteStarter,
  resolveSiteStarterSource,
  type PluginSiteStarterSource,
  type SiteStarterSummary,
  type SiteStarterViewer,
} from '@aglyn/aglyn/plugin-manager/plugin-site-starters'
import { listServerThemePresets } from '@aglyn/aglyn/plugin-manager/plugin-theme-presets'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
  isServerReleaseFlagOnForOrg,
  memberHasOrgPermission,
  resolveOrgMembership,
} from '@aglyn/tenant-data-admin'
import { invalidIdTokenResponse } from '@aglyn/tenant-data-admin/server/id-token-refusal'
import {
  readStarterSummary,
  starterAnswersQueryFrom,
  starterQueryFrom,
  type StarterAnswersAnswer,
  type StarterSearchAnswer,
  type StarterSearchLabels,
} from '../model/starter-query'

/*
 * THE STARTER SEARCH "Choose your starter" ASKS (AGL-4049).
 *
 * `GET /api/marketplace/starters?orgId=&mode=base|ai&q=&kind=&base=&fonts=&limit=&include=`
 * answers `{ rows, labels }`: the starters matching a search, each a summary
 * a card shows, and the names for the theme and font ids they carry.
 *
 * `include` names a listing the answer carries first whatever the search
 * finds: the person's own pick, restored after they went to pay for it,
 * which a search for other words would not list. It is described for this
 * viewer through the seam's `describe`, behind the same gates as a pick, so
 * it lists nothing the person could not pick anyway.
 *
 * Summaries only. A paid AI starter's answers ARE what it sells, and a
 * starter's pages are what a site is created from; both come out of the
 * seam's `resolve`, which is purchase-gated, never out of a search. Each row
 * is read back through `readStarterSummary`, so what the source hands over
 * beyond a summary does not leave this route.
 *
 * The gates, in order, each answered before the next is read:
 *
 *   401  no bearer token, or one the verifier refused
 *   403  an unverified address (impersonation exempt)
 *   400  no workspace named, or a facet no starter can carry
 *   403  not a member of the workspace named
 *   403  a member without "Create sites" (`hosts.create`): searching is the
 *        first step of creating a site, so it takes the create's permission,
 *        and the refusal names the permission, never a role
 *   403  `release_site_starters` off for the workspace, unless the caller is
 *        staff — the same flag, the same words and the same staff pass as
 *        the create route's starter pick; refused BEFORE the source is read
 *   503  no plugin serves starters
 *
 * The dispatcher in front refuses an unverified account and a lockdown too;
 * the verification check is repeated here so the route stands on its own.
 *
 * AN AI STARTER'S ANSWERS (AGL-4049 phase 4).
 *
 * `GET /api/marketplace/starters/answers?orgId=&listingId=` answers
 * `{ answers, facets }`: what an AI starter carries to fill the AI start's
 * questions once a person picks it. Behind the same gates in the same order
 * (its 400 is a listing id no listing can have), then the seam's `resolve`,
 * which is where a priced starter is held to its purchase:
 *
 *   402  a priced starter the workspace has not bought, with its price and
 *        `code: purchase_required`, as the create route words it
 *   403  404  passed on from the source, naming the listing
 *   409  a starter site, which is created as it is and asks nothing
 *
 * The answers and the facets only: never the starter's pages, its layout or
 * its theme, which the site is created from, not the questions.
 */

const NO_STORE = { 'Cache-Control': 'no-store' }

const answer = (body: unknown, status = 200): Response =>
  Response.json(body, { status, headers: NO_STORE })

const refuse = (status: number, error: string): Response => answer({ error }, status)

/** The create route's words for the same flag, so the two doors never disagree. */
export const SITE_STARTERS_UNRELEASED = 'Site starters are not available for this workspace yet'

/** And for a deployment where no plugin serves starters. */
export const SITE_STARTERS_UNAVAILABLE = 'Starters are unavailable right now. Try again in a moment.'

/**
 * The names a card and a filter show for a starter's ids: each built-in
 * theme by the name the theme picker gives its preset, and each font pairing
 * by its families ("Inter", or "Fraunces & Inter" when they differ). A base
 * whose preset no plugin registered in this process is left out, and the
 * surface shows nothing for it rather than an id.
 */
export function starterSearchLabels(): StarterSearchLabels {
  const presets = listServerThemePresets()
  const base: Record<string, string> = {}
  for (const id of SITE_THEME_BASES) {
    const name = presets.find((preset) => preset?.id === siteStarterPresetId(id))?.name
    if (typeof name === 'string' && name) base[id] = name
  }
  const fonts: Record<string, string> = {}
  for (const pairing of SITE_FONT_PAIRINGS) {
    fonts[pairing.id] =
      pairing.heading.family === pairing.body.family
        ? pairing.heading.family
        : `${pairing.heading.family} & ${pairing.body.family}`
  }
  return { base, fonts }
}

/**
 * The source, asking the app to run its boot declarations once when nobody
 * registered one — a boot whose declarations failed leaves the seam empty,
 * and the create route repairs the same way.
 */
async function starterSource(): Promise<PluginSiteStarterSource | null> {
  const registered = resolveSiteStarterSource()
  if (registered) return registered
  await runPluginDeclarationsRepair().catch((error: unknown) => {
    console.error('[marketplace/starters] plugin declarations failed', error)
  })
  return resolveSiteStarterSource()
}

/** A verified caller, as the token says it. */
type Caller = { uid: string } & Record<string, unknown>

/**
 * Both doors' first gates and their failure handling: GET only, a bearer
 * token the verifier accepts, a verified address (impersonation exempt).
 * `run` answers the rest; whatever it throws is a 401 for a credential the
 * verifier refused (AGL-1993) and a 500 in `failed`'s words otherwise.
 */
async function asVerifiedCaller(
  request: Request,
  failed: { log: string; error: string },
  run: (caller: Caller) => Promise<Response>,
): Promise<Response> {
  if (request.method !== 'GET') return refuse(405, 'Method not allowed')
  const authorization = request.headers.get('authorization') ?? ''
  if (!authorization.startsWith('Bearer ')) return refuse(401, 'Unauthenticated')
  try {
    const decoded = await firebaseAdmin
      .app()
      .auth()
      .verifyIdToken(authorization.slice('Bearer '.length))
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    return await run(decoded as unknown as Caller)
  } catch (error) {
    // An unverifiable credential is a 401, not a fault of ours (AGL-1993);
    // anything else keeps its 500.
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error(failed.log, error)
    return refuse(500, failed.error)
  }
}

/**
 * The gates after the question is read, in order: a member of the workspace
 * named, holding "Create sites", the release flag on for it (staff pass
 * without it being asked), and a plugin that serves starters. Answers the
 * viewer every source call is made for — the membership's workspace, never
 * the query's — and the source, or the refusal.
 */
async function admitViewer(
  caller: Caller,
  askedOrgId: string,
): Promise<{ viewer: SiteStarterViewer; source: PluginSiteStarterSource } | Response> {
  // The membership's org, never the query's: every gate below asks about
  // the workspace the caller actually belongs to.
  const membership = await resolveOrgMembership(caller.uid, askedOrgId)
  if (!membership) return refuse(403, 'You are not a member of that organization')
  const orgId = membership.orgId
  if (!(await memberHasOrgPermission(orgId, membership.member, 'hosts.create'))) {
    return refuse(403, permissionRefusalText('hosts.create'))
  }
  if (
    caller['staff'] !== true &&
    !(await isServerReleaseFlagOnForOrg('release_site_starters', orgId))
  ) {
    return refuse(403, SITE_STARTERS_UNRELEASED)
  }
  const source = await starterSource()
  if (!source) return refuse(503, SITE_STARTERS_UNAVAILABLE)
  return { viewer: { orgId, uid: caller.uid }, source }
}

async function handler(request: Request): Promise<Response> {
  return asVerifiedCaller(
    request,
    { log: '[marketplace/starters] search failed', error: 'Starters could not be loaded' },
    async (caller) => {
      const asked = starterQueryFrom(new URL(request.url).searchParams)
      if ('error' in asked) return refuse(400, asked.error)
      const admitted = await admitViewer(caller, asked.orgId)
      if (admitted instanceof Response) return admitted
      const { viewer, source } = admitted
      const found = await source.search(
        { word: asked.word, filter: asked.filter, limit: asked.limit },
        viewer,
      )
      const rows: SiteStarterSummary[] = []
      // The restored pick first, so the card the person chose is the one they
      // see, wherever the search would have put it, or left it out.
      const included = asked.include
        ? readStarterSummary(await describeSiteStarter(source, { listingId: asked.include }, viewer))
        : null
      if (included) rows.push(included)
      for (const value of Array.isArray(found) ? found : []) {
        const row = readStarterSummary(value)
        if (row && row.listingId !== included?.listingId) rows.push(row)
        if (rows.length >= asked.limit + (included ? 1 : 0)) break
      }
      const body: StarterSearchAnswer = { rows, labels: starterSearchLabels() }
      return answer(body)
    },
  )
}

/** What the answers door says of a starter site, which asks nothing. */
export const STARTER_HAS_NO_QUESTIONS = 'This starter is a ready-made site, with no questions to answer'

const isRecord = (value: unknown): value is Record<string, unknown> =>
  !!value && typeof value === 'object' && !Array.isArray(value)

async function answersHandler(request: Request): Promise<Response> {
  return asVerifiedCaller(
    request,
    { log: '[marketplace/starters/answers] read failed', error: 'This starter could not be read' },
    async (caller) => {
      const asked = starterAnswersQueryFrom(new URL(request.url).searchParams)
      if ('error' in asked) return refuse(400, asked.error)
      const admitted = await admitViewer(caller, asked.orgId)
      if (admitted instanceof Response) return admitted
      const { viewer, source } = admitted
      const listingId = asked.listingId
      const resolved = await source.resolve({ listingId }, viewer)
      if (!resolved || typeof resolved !== 'object') {
        return answer({ error: 'That starter is no longer available', listingId }, 404)
      }
      if ('error' in resolved) {
        const status = resolved.status === 402 || resolved.status === 403 ? resolved.status : 404
        return answer(
          {
            error: resolved.error,
            ...(status === 402 ? { code: 'purchase_required' } : {}),
            listingId,
            ...(status === 402 && typeof resolved.priceUsd === 'number' ? { priceUsd: resolved.priceUsd } : {}),
          },
          status,
        )
      }
      if (resolved.mode !== 'ai') return answer({ error: STARTER_HAS_NO_QUESTIONS, listingId }, 409)
      // `resolve` refuses an AI starter without them; checked again, so a
      // source that skipped the check hands over nothing.
      if (!isRecord(resolved.answers)) return answer({ error: 'That starter is no longer available', listingId }, 404)
      const body: StarterAnswersAnswer = {
        answers: resolved.answers,
        facets: readStarterSummary({ listingId, facets: resolved.facets })?.facets ?? resolved.facets,
      }
      return answer(body)
    },
  )
}

export { handler as marketplaceStarters, answersHandler as marketplaceStarterAnswers }
