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

import { normalizeContactEmail } from '@aglyn/aglyn/app-utils/contacts'
import type { PluginWebApiHandler } from '@aglyn/aglyn/server'
import type {
  OutreachMailbox,
  OutreachMailboxStatus,
} from '../model/outreach.types'
import { createGmailClient } from '../transport/gmail-client'
import { GmailTransportError } from '../transport/gmail-errors'
import {
  buildGoogleAuthorizationUrl,
  exchangeGoogleAuthorizationCode,
  grantedScopesInclude,
  OUTREACH_REQUIRED_GRANTED_SCOPES,
  pkceChallenge,
  readGoogleIdToken,
  type GoogleTokenResponse,
} from '../transport/google-oauth'
import type { TransportDeps } from '../transport/http'
import { Rfc5322MessageError } from '../transport/rfc5322'
import { sendOutreachMessage } from '../transport/send-message'
import {
  buildConnectReturnFragment,
  type OutreachApiRefusalReason,
  type OutreachConnectReturn,
  type OutreachMailboxAvailability,
  type OutreachMailboxAvailabilityGate,
  type OutreachMailboxDisconnectResponse,
} from './mailbox-api'
import {
  mailboxCredentialsRef,
  mailboxRef,
  outreachMailboxId,
  readMailboxCredentials,
  sealMailboxRefreshToken,
  type OutreachGoogleMailboxCredentials,
} from './mailbox-credentials'
import { revokeMailboxGrant } from './mailbox-revoke'
import {
  outreachMemberGate,
  refusal,
  type OutreachGateContext,
  type OutreachGateDeps,
} from './mailbox-gate'
import {
  defaultSendAs,
  isValidTimezone,
  OUTREACH_DEFAULT_DAILY_CAP,
  OUTREACH_DEFAULT_WINDOW,
  OUTREACH_MAX_MAILBOXES_PER_MEMBER,
  validateDailyCap,
  validateDisplayName,
  validateSendWindow,
  verifiedSendAsAddresses,
} from './mailbox-settings'
import {
  markOutreachMailboxReconnectRequired,
  openOutreachMailboxClient,
} from './mailbox-transport'
import {
  consumeOutreachOAuthState,
  mintOutreachOAuthState,
  outreachOidcNonce,
  outreachPkceVerifier,
  readOutreachOAuthState,
  recordOutreachOAuthState,
} from './oauth-state'
import {
  OUTREACH_NOT_CONFIGURED_MESSAGE,
  type OutreachGoogleConfigResult,
} from './outreach-config'

/**
 * THE MAILBOX ROUTES (AGL-2978): connect a rep's Google mailbox, keep its
 * settings, pause it, test it, and disconnect it.
 *
 * ## The connect, end to end
 *
 * 1. `connect` (the member's session) mints a signed, single-use state bound
 *    to the member and the organization, records its pending entry, and
 *    answers Google's consent address — offline access, the consent prompt,
 *    a PKCE challenge and an OpenID nonce, both derived from the state.
 * 2. Google redirects the browser to `oauth/callback`. That request carries
 *    no bearer token, so it DOES nothing: it verifies the state's signature,
 *    finds the organization's console path, and redirects to the Mailboxes
 *    page with the code in the URL FRAGMENT, where no server and no `Referer`
 *    sees it. Its release gate was asked about the organization and the
 *    member the state names (the route's declared subject).
 * 3. The page takes the code out of the address bar and posts it to
 *    `connect/complete` with the member's own session. That is where the
 *    state is consumed, where it is refused if it was minted for anyone else,
 *    and where the code is exchanged. So a consent screen someone else was
 *    tricked into completing cannot connect THEIR mailbox to the member who
 *    started it: the code arrives in the wrong browser, whose session is not
 *    the state's member.
 *
 * ## Refusals, in order, on `connect/complete`
 *
 * A state that is invalid, minted for another member or organization,
 * expired, already used or superseded; a code Google refuses; a grant with no
 * refresh token; a grant missing `gmail.send` or `gmail.readonly` (the consent
 * screen lets a person untick them); an ID token that is not about this
 * exchange or whose address Google has not verified; a Gmail profile whose
 * address is not the ID token's; and a member at their mailbox limit.
 *
 * A grant refused after the code exchange is dropped, not revoked. Google's
 * revocation ends the whole grant this client holds for the account, and the
 * same account may already be connected — by this member in another
 * organization, or by a teammate — so revoking a token this route merely
 * declines to keep could disconnect a mailbox that is working.
 *
 * ## Who may do what
 *
 * Every route but the callback climbs `outreachMemberGate`. The member who
 * connected a mailbox manages it; an organization owner or admin may also
 * change its settings, pause it and disconnect it — a departing rep's mailbox
 * has to be stoppable by somebody. Only its own member can send a test from
 * it, since the test lands in their inbox.
 */

export interface OutreachMailboxRouteDeps {
  firestore(): FirebaseFirestore.Firestore
  gate: OutreachGateDeps
  readConfig(): OutreachGoogleConfigResult
  /** Whether the signing secret the OAuth state needs is configured. */
  stateSigningConfigured(): boolean
  redirectUri(requestUrl: string): string | null
  now(): number
  /** The network and retry policy every Google call uses. */
  transport: TransportDeps
  consumeRateLimit(key: string, options: { limit: number; windowMs: number }): Promise<{ allowed: boolean }>
  logOrgActivity(
    orgId: string,
    actor: { uid: string; email?: string | null },
    action: string,
    target: { type: typeof OUTREACH_MAILBOX_ACTIVITY_TARGET; id: string; name: string },
  ): Promise<void>
  confirmAliasesByProvider(
    firestore: FirebaseFirestore.Firestore,
    input: { orgId: string; uid: string; addresses: readonly string[]; nowMs: number },
  ): Promise<{ ok: boolean; confirmed?: string[] }>
}

export interface OutreachMailboxRoutes {
  availability: PluginWebApiHandler
  connect: PluginWebApiHandler
  oauthCallback: PluginWebApiHandler
  connectComplete: PluginWebApiHandler
  settings: PluginWebApiHandler
  status: PluginWebApiHandler
  test: PluginWebApiHandler
  disconnect: PluginWebApiHandler
}

/** Test sends one mailbox may make in an hour. */
export const OUTREACH_TEST_SENDS_PER_HOUR = 5

/**
 * The org activity target a mailbox's rows are filed under: Outreach's own
 * namespaced resource, which the feed reads as "Mailbox".
 */
export const OUTREACH_MAILBOX_ACTIVITY_TARGET = 'outreach:mailbox'

const MAILBOX_ID = /^[A-Za-z0-9_-]{1,128}$/
const MAX_CODE_CHARS = 2048

const noStore = { 'Cache-Control': 'no-store' }

const ok = (body: unknown) => Response.json(body, { status: 200, headers: noStore })

function methodNotAllowed(allow: string): Response {
  return Response.json(
    { error: 'Method not allowed', reason: 'method-not-allowed' satisfies OutreachApiRefusalReason },
    { status: 405, headers: { ...noStore, Allow: allow } },
  )
}

async function readBody(request: Request): Promise<Record<string, unknown>> {
  const body = await request.json().catch(() => null)
  return body && typeof body === 'object' && !Array.isArray(body) ? (body as Record<string, unknown>) : {}
}

function notConfigured(): Response {
  return refusal(503, 'not-configured', OUTREACH_NOT_CONFIGURED_MESSAGE)
}

/** A mailbox document read defensively into the model shape. */
function readMailbox(id: string, data: Record<string, unknown> | undefined): OutreachMailbox | null {
  if (!data) return null
  return { ...(data as unknown as OutreachMailbox), id }
}

const activityName = (mailbox: Pick<OutreachMailbox, 'email'>) => mailbox.email

export function createOutreachMailboxRoutes(deps: OutreachMailboxRouteDeps): OutreachMailboxRoutes {
  /** The gate, then the mailbox the body names, then who may touch it. */
  async function loadManagedMailbox(
    request: Request,
    body: Record<string, unknown>,
    who: 'member-or-admin' | 'member',
  ): Promise<Response | { gate: OutreachGateContext; mailbox: OutreachMailbox }> {
    const gate = await outreachMemberGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const mailboxId = typeof body['mailboxId'] === 'string' ? body['mailboxId'] : ''
    if (!MAILBOX_ID.test(mailboxId)) return refusal(400, 'invalid-request', 'Name the mailbox.')
    const snapshot = await mailboxRef(deps.firestore(), gate.orgId, mailboxId).get()
    const mailbox = readMailbox(mailboxId, snapshot.exists ? snapshot.data() : undefined)
    if (!mailbox) return refusal(404, 'mailbox-not-found', 'That mailbox is not connected to this organization.')
    const own = mailbox.connectedByUid === gate.uid
    if (!own && !(who === 'member-or-admin' && gate.isOrgAdmin)) {
      return refusal(
        403,
        'not-your-mailbox',
        who === 'member'
          ? 'Only the member who connected this mailbox can do that.'
          : 'Only the member who connected this mailbox, or an organization owner or admin, can change it.',
      )
    }
    return { gate, mailbox }
  }

  const availability: PluginWebApiHandler = async (request) => {
    if (request.method !== 'GET') return methodNotAllowed('GET')
    const gate = await outreachMemberGate(request, new URL(request.url).searchParams.get('orgId'), deps.gate)
    if (gate instanceof Response) return gate
    // Every gate is named, not the first: an operator fixing a deployment
    // should see the whole list once rather than one variable per redeploy.
    const missing: OutreachMailboxAvailabilityGate[] = []
    const config = deps.readConfig()
    if (config.configured === false) missing.push({ gate: 'google', missing: config.missing })
    if (!deps.stateSigningConfigured()) missing.push({ gate: 'state' })
    if (!deps.redirectUri(request.url)) missing.push({ gate: 'redirect' })
    return ok({
      configured: missing.length === 0,
      canManageAll: gate.isOrgAdmin,
      ...(missing.length ? { missing } : {}),
    } satisfies OutreachMailboxAvailability)
  }

  const connect: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const gate = await outreachMemberGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const config = deps.readConfig()
    const redirectUri = deps.redirectUri(request.url)
    if (!config.configured || !redirectUri || !deps.stateSigningConfigured()) return notConfigured()

    const nowMs = deps.now()
    const { state, claims } = mintOutreachOAuthState({ orgId: gate.orgId, uid: gate.uid, nowMs })
    await recordOutreachOAuthState(deps.firestore(), { claims, redirectUri, nowMs })
    const url = buildGoogleAuthorizationUrl({
      clientId: config.config.clientId,
      redirectUri,
      state,
      codeChallenge: pkceChallenge(outreachPkceVerifier(claims.nonce)),
      nonce: outreachOidcNonce(claims.nonce),
      loginHint: gate.email,
    })
    return ok({ url })
  }

  const oauthCallback: PluginWebApiHandler = async (request) => {
    if (request.method !== 'GET') return methodNotAllowed('GET')
    const params = new URL(request.url).searchParams
    const read = readOutreachOAuthState(params.get('state'), deps.now())
    const plain = (status: number, text: string) =>
      new Response(text, {
        status,
        headers: { ...noStore, 'Content-Type': 'text/plain; charset=utf-8', 'Referrer-Policy': 'no-referrer' },
      })
    if (read.ok === false && read.refusal === 'state-invalid') {
      return plain(400, 'This connection link is not valid. Return to the console and connect the mailbox again.')
    }
    const claims = read.ok ? read.claims : (read as { claims: { orgId: string } }).claims
    const org = await deps.gate.readOrg(claims.orgId)
    const slug = typeof org?.['slug'] === 'string' ? org['slug'] : ''
    if (!slug) return plain(404, 'That organization could not be found.')

    let fragment: OutreachConnectReturn
    const googleError = params.get('error')
    const code = params.get('code') ?? ''
    if (googleError) {
      fragment = { kind: 'error', reason: googleError === 'access_denied' ? 'access_denied' : 'google_error' }
    } else if (!read.ok) {
      fragment = { kind: 'error', reason: 'expired' }
    } else if (!code || code.length > MAX_CODE_CHARS) {
      fragment = { kind: 'error', reason: 'google_error' }
    } else {
      fragment = { kind: 'code', code, state: params.get('state') ?? '' }
    }
    // A RELATIVE location on the callback's own origin: the path is built from
    // the organization's slug, never from anything the request supplied.
    return new Response(null, {
      status: 303,
      headers: {
        ...noStore,
        'Referrer-Policy': 'no-referrer',
        Location: `/${encodeURIComponent(slug)}/outreach/mailboxes#${buildConnectReturnFragment(fragment)}`,
      },
    })
  }

  const connectComplete: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const gate = await outreachMemberGate(request, body['orgId'], deps.gate)
    if (gate instanceof Response) return gate
    const config = deps.readConfig()
    if (!config.configured || !deps.stateSigningConfigured()) return notConfigured()
    const code = typeof body['code'] === 'string' ? body['code'] : ''
    if (!code || code.length > MAX_CODE_CHARS) return refusal(400, 'invalid-request', 'The connection did not return a code.')

    const firestore = deps.firestore()
    const nowMs = deps.now()
    const read = readOutreachOAuthState(body['state'], nowMs)
    if (read.ok === false && read.refusal === 'state-invalid') {
      return refusal(400, 'state-invalid', 'This connection could not be verified. Connect the mailbox again.')
    }
    const claims = read.ok ? read.claims : (read as { claims: typeof read.claims }).claims
    if (claims.uid !== gate.uid) {
      return refusal(
        403,
        'state-user-mismatch',
        'This connection was started by another member. Sign in as that member, or connect the mailbox again.',
      )
    }
    if (claims.orgId !== gate.orgId) {
      return refusal(400, 'state-org-mismatch', 'This connection was started in another organization.')
    }
    if (!read.ok) return refusal(410, 'state-expired', 'This connection took too long. Connect the mailbox again.')

    const consumed = await consumeOutreachOAuthState(firestore, { claims, nowMs })
    if (consumed.ok === false) {
      if (consumed.refusal === 'state-expired') {
        return refusal(410, 'state-expired', 'This connection took too long. Connect the mailbox again.')
      }
      return refusal(
        409,
        consumed.refusal,
        consumed.refusal === 'state-superseded'
          ? 'A newer connection was started. Finish that one, or connect the mailbox again.'
          : 'This connection was already used. Connect the mailbox again.',
      )
    }

    let grant: GoogleTokenResponse
    try {
      grant = await exchangeGoogleAuthorizationCode(
        {
          clientId: config.config.clientId,
          clientSecret: config.config.clientSecret,
          code,
          redirectUri: consumed.redirectUri,
          codeVerifier: outreachPkceVerifier(claims.nonce),
        },
        deps.transport,
      )
    } catch (error) {
      if (error instanceof GmailTransportError && error.code === 'invalid_grant') {
        return refusal(400, 'code-rejected', "Google's sign-in expired or was already used. Connect the mailbox again.")
      }
      if (error instanceof GmailTransportError && error.code === 'client_misconfigured') {
        return refusal(503, 'not-configured', "Google refused this deployment's OAuth client.")
      }
      return googleUnavailable(error)
    }
    if (!grant.refreshToken) {
      return refusal(
        422,
        'refresh-token-missing',
        'Google did not grant offline access, so the mailbox could not send later. Connect it again.',
      )
    }
    if (!grantedScopesInclude(grant.scope, OUTREACH_REQUIRED_GRANTED_SCOPES)) {
      return refusal(
        422,
        'scopes-missing',
        'Sequences needs permission to send and to read your mail. Connect again and allow both.',
      )
    }
    const identity = readGoogleIdToken(grant.idToken, {
      clientId: config.config.clientId,
      nonce: outreachOidcNonce(claims.nonce),
      nowMs,
    })
    if (identity.ok === false) {
      return refusal(
        422,
        'identity-unverified',
        identity.refusal === 'email-unverified'
          ? "Google has not verified this account's email address."
          : "Google's answer could not be verified. Connect the mailbox again.",
      )
    }

    const client = createGmailClient({
      ...deps.transport,
      clientId: config.config.clientId,
      clientSecret: config.config.clientSecret,
      refreshToken: grant.refreshToken,
    })
    let profileEmail: string
    let sendAsOptions: ReturnType<typeof verifiedSendAsAddresses>
    try {
      const [profile, sendAs] = await Promise.all([client.getProfile(), client.listSendAs()])
      profileEmail = profile.emailAddress
      sendAsOptions = verifiedSendAsAddresses(sendAs)
    } catch (error) {
      if (error instanceof GmailTransportError && error.reconnectRequired) {
        return refusal(
          422,
          'scopes-missing',
          'Sequences needs permission to send and to read your mail. Connect again and allow both.',
        )
      }
      return googleUnavailable(error)
    }
    if (profileEmail !== identity.identity.email) {
      return refusal(422, 'account-mismatch', 'The Gmail account and the Google sign-in did not match. Connect again.')
    }
    if (!sendAsOptions.some((option) => option.email === profileEmail)) {
      sendAsOptions = [
        { email: profileEmail, displayName: '', isPrimary: true, isDefault: !sendAsOptions.some((o) => o.isDefault) },
        ...sendAsOptions,
      ]
    }

    const mailboxId = outreachMailboxId(gate.orgId, gate.uid, identity.identity.sub)
    const mailboxDoc = mailboxRef(firestore, gate.orgId, mailboxId)
    const credentialDoc = mailboxCredentialsRef(firestore, mailboxId)
    const [existingMailbox, existingCredential] = await Promise.all([mailboxDoc.get(), credentialDoc.get()])
    const current = readMailbox(mailboxId, existingMailbox.exists ? existingMailbox.data() : undefined)
    if (!current) {
      const mine = await firestore
        .collection('orgs')
        .doc(gate.orgId)
        .collection('outreachMailboxes')
        .where('connectedByUid', '==', gate.uid)
        .limit(OUTREACH_MAX_MAILBOXES_PER_MEMBER)
        .get()
      if (mine.size >= OUTREACH_MAX_MAILBOXES_PER_MEMBER) {
        return refusal(
          409,
          'mailbox-limit',
          `You can connect up to ${OUTREACH_MAX_MAILBOXES_PER_MEMBER} mailboxes. Disconnect one before connecting another.`,
        )
      }
    }

    const defaultOption = sendAsOptions.find((option) => option.email === defaultSendAs(sendAsOptions, profileEmail))
    let mailbox: OutreachMailbox
    /** On a reconnect, only the fields a connect decides — see the write below. */
    let reconnected: Partial<OutreachMailbox> | null = null
    if (current) {
      const keepSendAs = sendAsOptions.some((option) => option.email === current.sendAs)
      reconnected = {
        provider: 'google',
        email: profileEmail,
        sendAs: keepSendAs ? current.sendAs : (defaultOption?.email ?? profileEmail),
        sendAsOptions,
        // A reconnect restores a mailbox Google had cut off, and leaves a
        // mailbox its member paused paused.
        status: (current.status === 'paused' ? 'paused' : 'connected') satisfies OutreachMailboxStatus,
        connectedAtMs: nowMs,
        updatedAtMs: nowMs,
      }
      mailbox = { ...current, ...reconnected }
    } else {
      const timezone = isValidTimezone(body['timezone']) ? String(body['timezone']) : 'UTC'
      const displayName = validateDisplayName(defaultOption?.displayName || gate.name || '')
      mailbox = {
        id: mailboxId,
        provider: 'google',
        email: profileEmail,
        sendAs: defaultOption?.email ?? profileEmail,
        sendAsOptions,
        displayName: typeof displayName === 'string' ? displayName : '',
        status: 'connected',
        dailyCap: OUTREACH_DEFAULT_DAILY_CAP,
        window: { ...OUTREACH_DEFAULT_WINDOW, days: [...OUTREACH_DEFAULT_WINDOW.days] },
        timezone,
        rampStartedAtMs: nowMs,
        health: {
          sentToday: 0,
          sentOnDay: null,
          bounces: 0,
          replies: 0,
          lastSentAtMs: null,
          lastErrorAtMs: null,
          lastErrorCode: null,
          daily: {},
        },
        connectedByUid: gate.uid,
        connectedAtMs: nowMs,
        createdAtMs: nowMs,
        updatedAtMs: nowMs,
      }
    }
    const credential: OutreachGoogleMailboxCredentials = {
      id: mailboxId,
      orgId: gate.orgId,
      mailboxId,
      provider: 'google',
      connectedByUid: gate.uid,
      providerAccountId: identity.identity.sub,
      email: profileEmail,
      scopes: grant.scope.split(/\s+/).filter(Boolean),
      ...sealMailboxRefreshToken(grant.refreshToken, mailboxId, config.config.keyring),
      createdAtMs: Number(existingCredential.exists ? existingCredential.get('createdAtMs') : 0) || nowMs,
      updatedAtMs: nowMs,
    }
    const batch = firestore.batch()
    // A reconnect MERGES only what a connect decides, so the settings a member
    // chose and the health counters the sending runtime increments are never
    // written back from a read that may already be stale.
    if (reconnected) batch.set(mailboxDoc, reconnected, { merge: true })
    else batch.set(mailboxDoc, mailbox)
    batch.set(credentialDoc, credential)
    await batch.commit()

    const aliases: { ok: boolean; confirmed?: string[] } = await deps
      .confirmAliasesByProvider(firestore, {
        orgId: gate.orgId,
        uid: gate.uid,
        addresses: sendAsOptions.map((option) => option.email),
        nowMs,
      })
      .catch((error: unknown) => {
        console.error('[outreach] confirming member aliases from send-as failed', error)
        return { ok: false }
      })
    await deps.logOrgActivity(
      gate.orgId,
      { uid: gate.uid, email: gate.email },
      current ? 'Reconnected a mailbox in Sequences' : 'Connected a mailbox in Sequences',
      { type: OUTREACH_MAILBOX_ACTIVITY_TARGET, id: mailboxId, name: activityName(mailbox) },
    )
    return ok({
      ok: true,
      mailbox,
      created: !current,
      confirmedAliases: aliases.ok ? (aliases.confirmed ?? []) : [],
    })
  }

  const settings: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const loaded = await loadManagedMailbox(request, body, 'member-or-admin')
    if (loaded instanceof Response) return loaded
    const { gate, mailbox } = loaded
    const update: Partial<OutreachMailbox> = {}
    const invalid = (message: string) => refusal(400, 'invalid-settings', message)

    if (body['sendAs'] !== undefined) {
      const sendAs = typeof body['sendAs'] === 'string' ? body['sendAs'].trim().toLowerCase() : ''
      if (!(mailbox.sendAsOptions ?? []).some((option) => option.email === sendAs)) {
        return invalid('Choose one of the addresses Gmail has verified for this account.')
      }
      update.sendAs = sendAs
    }
    if (body['displayName'] !== undefined) {
      const name = validateDisplayName(body['displayName'])
      if (typeof name !== 'string') return invalid(name.message)
      update.displayName = name
    }
    if (body['dailyCap'] !== undefined) {
      const cap = validateDailyCap(body['dailyCap'])
      if (typeof cap !== 'number') return invalid(cap.message)
      update.dailyCap = cap
    }
    if (body['window'] !== undefined) {
      const window = validateSendWindow(body['window'])
      if (!('days' in window)) return invalid(window.message)
      update.window = window
    }
    if (body['timezone'] !== undefined) {
      if (!isValidTimezone(body['timezone'])) return invalid('Choose a timezone from the list.')
      update.timezone = body['timezone']
    }
    if (!Object.keys(update).length) return ok({ ok: true, mailbox })
    const nowMs = deps.now()
    await mailboxRef(deps.firestore(), gate.orgId, mailbox.id).update({ ...update, updatedAtMs: nowMs })
    return ok({ ok: true, mailbox: { ...mailbox, ...update, updatedAtMs: nowMs } })
  }

  const status: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    if (typeof body['paused'] !== 'boolean') return refusal(400, 'invalid-request', 'Say whether to pause the mailbox.')
    const loaded = await loadManagedMailbox(request, body, 'member-or-admin')
    if (loaded instanceof Response) return loaded
    const { gate, mailbox } = loaded
    if (mailbox.status === 'reconnect_required' || mailbox.status === 'disconnected') {
      return refusal(409, 'reconnect-required', 'Reconnect this mailbox before pausing or resuming it.')
    }
    const next: OutreachMailboxStatus = body['paused'] ? 'paused' : 'connected'
    if (mailbox.status === next) return ok({ ok: true, mailbox })
    const nowMs = deps.now()
    // A member's pause or resume answers an automatic pause (AGL-2981): its
    // reason goes, and the next bounce is judged as new evidence.
    await mailboxRef(deps.firestore(), gate.orgId, mailbox.id).update({
      status: next,
      autoPause: null,
      updatedAtMs: nowMs,
    })
    await deps.logOrgActivity(
      gate.orgId,
      { uid: gate.uid, email: gate.email },
      next === 'paused' ? 'Paused a mailbox in Sequences' : 'Resumed a mailbox in Sequences',
      { type: OUTREACH_MAILBOX_ACTIVITY_TARGET, id: mailbox.id, name: activityName(mailbox) },
    )
    return ok({ ok: true, mailbox: { ...mailbox, status: next, autoPause: null, updatedAtMs: nowMs } })
  }

  const test: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const loaded = await loadManagedMailbox(request, body, 'member')
    if (loaded instanceof Response) return loaded
    const { gate, mailbox } = loaded
    if (mailbox.status === 'reconnect_required' || mailbox.status === 'disconnected') {
      return refusal(409, 'reconnect-required', 'Reconnect this mailbox before sending from it.')
    }
    if (!deps.readConfig().configured) return notConfigured()
    const limited = await deps.consumeRateLimit(`outreach-mailbox-test:${mailbox.id}`, {
      limit: OUTREACH_TEST_SENDS_PER_HOUR,
      windowMs: 60 * 60 * 1000,
    })
    if (!limited.allowed) {
      return refusal(429, 'rate-limited', `A mailbox can send ${OUTREACH_TEST_SENDS_PER_HOUR} tests an hour. Try again later.`)
    }
    /*
     * To the member's own address unless they name another (AGL-3228). A
     * test to oneself never leaves Google, so it arrives with no
     * Authentication-Results at all and cannot show whether the send-as
     * domain's DKIM and DMARC hold; an outside mailbox the member can read
     * is the only place that can be seen. The rate limit above is the
     * whole guard on who may be written to — it is the member's own
     * account sending, as it could from its own compose window.
     */
    const named = body['to']
    const to =
      named === undefined || named === null || String(named).trim() === ''
        ? mailbox.email
        : normalizeContactEmail(String(named))
    if (!to) {
      return refusal(400, 'invalid-request', `"${String(named).trim()}" isn't a valid email address.`)
    }
    const firestore = deps.firestore()
    const nowMs = deps.now()
    const opened = await openOutreachMailboxClient(
      firestore,
      { mailboxId: mailbox.id },
      { ...deps.transport, readConfig: deps.readConfig, now: deps.now },
    )
    if (opened.ok === false) {
      if (opened.reason === 'not-configured') return notConfigured()
      await markOutreachMailboxReconnectRequired(firestore, {
        orgId: gate.orgId,
        mailboxId: mailbox.id,
        errorCode: opened.reason,
        nowMs,
      })
      return refusal(409, 'reconnect-required', 'This mailbox needs to be connected again before it can send.')
    }
    try {
      const sent = await sendOutreachMessage(opened.client, {
        from: { address: mailbox.sendAs, name: mailbox.displayName },
        to,
        subject: 'Sequences test message',
        text: [
          'This is a test message from Sequences.',
          '',
          `It was sent through the connected mailbox ${mailbox.email} as ${mailbox.sendAs}. ` +
            'If it reached the inbox, this mailbox can send.',
          ...(to === mailbox.email
            ? []
            : [
                '',
                'To read whether the sender is authenticated, open this message\u2019s original source ' +
                  'and look for dkim=pass, spf=pass and dmarc=pass in Authentication-Results.',
              ]),
        ].join('\n'),
      })
      return ok({ ok: true, sentTo: to, gmailMessageId: sent.gmailMessageId, sentAtMs: nowMs })
    } catch (error) {
      if (error instanceof GmailTransportError && error.reconnectRequired) {
        await markOutreachMailboxReconnectRequired(firestore, {
          orgId: gate.orgId,
          mailboxId: mailbox.id,
          errorCode: error.code,
          nowMs,
        })
        return refusal(409, 'reconnect-required', 'Google refused this mailbox’s access. Connect it again.')
      }
      if (error instanceof Rfc5322MessageError) {
        return refusal(400, 'invalid-settings', `The test could not be written: ${error.message}`)
      }
      return googleUnavailable(error)
    }
  }

  const disconnect: PluginWebApiHandler = async (request) => {
    if (request.method !== 'POST') return methodNotAllowed('POST')
    const body = await readBody(request)
    const loaded = await loadManagedMailbox(request, body, 'member-or-admin')
    if (loaded instanceof Response) return loaded
    const { gate, mailbox } = loaded
    const firestore = deps.firestore()
    const credentialDoc = mailboxCredentialsRef(firestore, mailbox.id)
    const snapshot = await credentialDoc.get()
    const credential = readMailboxCredentials(snapshot.exists ? snapshot.data() : null)
    const revocation = credential
      ? await revokeMailboxGrant(firestore, credential, deps)
      : ('already-invalid' as const)
    const batch = firestore.batch()
    batch.delete(credentialDoc)
    batch.delete(mailboxRef(firestore, gate.orgId, mailbox.id))
    await batch.commit()
    await deps.logOrgActivity(
      gate.orgId,
      { uid: gate.uid, email: gate.email },
      'Disconnected a mailbox in Sequences',
      { type: OUTREACH_MAILBOX_ACTIVITY_TARGET, id: mailbox.id, name: activityName(mailbox) },
    )
    return ok({ ok: true, revocation } satisfies OutreachMailboxDisconnectResponse)
  }

  return { availability, connect, oauthCallback, connectComplete, settings, status, test, disconnect }
}

function googleUnavailable(error: unknown): Response {
  if (!(error instanceof GmailTransportError)) throw error
  return refusal(
    502,
    'google-unavailable',
    error.retryable ? 'Google did not answer. Try again in a moment.' : `Google refused the request: ${error.message}`,
  )
}
