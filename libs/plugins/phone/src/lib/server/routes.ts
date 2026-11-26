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

import { PHONE_ADDON_KEY } from '../constants/bundle-common'
import { phoneE164, sanitizePhoneSettings } from '../model/phone-rules'
import type { PhoneComplianceForm, PhoneNumberKind, PhoneSettings } from '../model/phone.types'
import { verifyTwilioWebhookSignature } from '../twilio/twilio-client'
import { EMPTY_TWIML, twimlResponse } from '../twilio/twiml'
import { PhoneServiceError, type PhoneService } from './phone-service'
import {
  phoneMethodNotAllowed,
  phoneOk,
  phoneRefusal,
  phoneRouteGate,
  readPhoneId,
  readPhoneJsonBody,
  type PhoneCaller,
  type PhoneGateDeps,
} from './route-gate'
import type { VoiceService } from './voice-service'

/**
 * Phone's console routes as web handlers (AGL-4251). Each member route climbs
 * {@link phoneRouteGate}; each `hooks/*` route checks Twilio's signature with
 * the subaccount's own token before it reads a parameter.
 */

export type PhoneWebHandler = (request: Request) => Promise<Response>

export interface PhoneRouteDeps {
  gate: PhoneGateDeps
  phone: PhoneService
  voice: VoiceService
  /** Where Twilio posted, as it signed it: the public origin. */
  webhookOrigin(): string | null
  /** Org-wide Phone add-on units the org bought (0 or 1 today). */
  addonUnits(org: Record<string, unknown>): number
  verifySignature?: typeof verifyTwilioWebhookSignature
}

function orgIdOf(request: Request, body: Record<string, unknown>): unknown {
  return new URL(request.url).searchParams.get('orgId') ?? body['orgId']
}

/** Wraps a member route: the gate, a JSON body, and the service's refusals as answers. */
function member(
  deps: PhoneRouteDeps,
  methods: readonly ('GET' | 'POST')[],
  run: (caller: PhoneCaller, request: Request, body: Record<string, unknown>) => Promise<Response>,
  options: { manage?: boolean | ((request: Request) => boolean) } = {},
): PhoneWebHandler {
  return async (request) => {
    if (!methods.includes(request.method as 'GET' | 'POST')) return phoneMethodNotAllowed(methods.join(', '))
    const body = request.method === 'POST' ? await readPhoneJsonBody(request) : {}
    const manage = typeof options.manage === 'function' ? options.manage(request) : options.manage
    const caller = await phoneRouteGate(request, orgIdOf(request, body), deps.gate, { manage })
    if (caller instanceof Response) return caller
    try {
      return await run(caller, request, body)
    } catch (error) {
      if (error instanceof PhoneServiceError) return phoneRefusal(error.status, error.reason, error.message)
      console.error('[phone] route failed', error)
      return phoneRefusal(500, 'internal', 'Something went wrong. Try again.')
    }
  }
}

/** Settings as a member reads them: never another member's cell number. */
function withoutCells(settings: PhoneSettings): PhoneSettings {
  const { memberCells: _cells, ...rest } = settings
  return rest
}

function text(value: unknown, max = 400): string {
  return typeof value === 'string' ? value.trim().slice(0, max) : ''
}

function readComplianceForm(raw: unknown): PhoneComplianceForm {
  const form = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const businessType = form['businessType']
  return {
    kind: form['kind'] === 'tollFree' ? 'tollFree' : 'a2p10dlc',
    legalBusinessName: text(form['legalBusinessName'], 120),
    ein: text(form['ein'], 20),
    businessType:
      businessType === 'llc' ||
      businessType === 'corporation' ||
      businessType === 'partnership' ||
      businessType === 'nonprofit' ||
      businessType === 'sole-proprietor'
        ? businessType
        : 'llc',
    website: text(form['website'], 200),
    street: text(form['street'], 120),
    city: text(form['city'], 80),
    region: text(form['region'], 40),
    postalCode: text(form['postalCode'], 20),
    country: text(form['country'], 2) || 'US',
    contactFirstName: text(form['contactFirstName'], 60),
    contactLastName: text(form['contactLastName'], 60),
    contactEmail: text(form['contactEmail'], 120),
    contactPhone: phoneE164(form['contactPhone']) ?? text(form['contactPhone'], 20),
    useCaseDescription: text(form['useCaseDescription'], 1000),
    sampleMessages: Array.isArray(form['sampleMessages'])
      ? (form['sampleMessages'] as unknown[]).map((one) => text(one, 320)).filter(Boolean).slice(0, 5)
      : [],
    optInDescription: text(form['optInDescription'], 1000),
    monthlyVolume: Math.max(0, Math.min(1_000_000, Number(form['monthlyVolume']) || 0)),
  }
}

export function createPhoneMemberRoutes(deps: PhoneRouteDeps): Record<string, PhoneWebHandler> {
  const { phone, voice } = deps
  const orgName = (caller: PhoneCaller) => text(caller.org['name'], 60) || caller.orgId
  const allowance = (caller: PhoneCaller) => Math.max(1, deps.addonUnits(caller.org))
  return {
    status: member(deps, ['GET'], async (caller) => {
      const status = await phone.status(caller.orgId)
      return phoneOk({
        ...status,
        settings: withoutCells(status.settings),
        myCell: status.settings.memberCells?.[caller.uid] ?? null,
        canManage: caller.canManage,
        addonKey: PHONE_ADDON_KEY,
      })
    }),
    numbersSearch: member(
      deps,
      ['POST'],
      async (caller, _request, body) => {
        const kind: PhoneNumberKind = body['kind'] === 'tollFree' ? 'tollFree' : 'local'
        const numbers = await phone.searchNumbers(caller.orgId, orgName(caller), caller.uid, {
          kind,
          areaCode: text(body['areaCode'], 3) || null,
          contains: text(body['contains'], 10) || null,
        })
        return phoneOk({ numbers })
      },
      { manage: true },
    ),
    numbersBuy: member(
      deps,
      ['POST'],
      async (caller, _request, body) => {
        const number = await phone.buyNumber(
          caller.orgId,
          orgName(caller),
          caller.uid,
          {
            e164: text(body['e164'], 20),
            kind: body['kind'] === 'tollFree' ? 'tollFree' : 'local',
            hostId: readPhoneId(body['hostId']) ?? '',
            label: text(body['label'], 60),
          },
          allowance(caller),
        )
        return phoneOk({ number })
      },
      { manage: true },
    ),
    numbersUpdate: member(
      deps,
      ['POST'],
      async (caller, _request, body) => {
        const numberId = readPhoneId(body['numberId'])
        if (!numberId) return phoneRefusal(400, 'number-required', 'Name the number to change.')
        const hostId = body['hostId'] === undefined ? undefined : readPhoneId(body['hostId'])
        return phoneOk({ number: await phone.updateNumber(caller.orgId, numberId, { label: body['label'], hostId }) })
      },
      { manage: true },
    ),
    numbersRelease: member(
      deps,
      ['POST'],
      async (caller, _request, body) => {
        const numberId = readPhoneId(body['numberId'])
        if (!numberId) return phoneRefusal(400, 'number-required', 'Name the number to release.')
        await phone.releaseNumber(caller.orgId, numberId)
        return phoneOk({ released: true })
      },
      { manage: true },
    ),
    threads: member(deps, ['GET'], async (caller, request) => {
      const search = new URL(request.url).searchParams
      const before = Number(search.get('before'))
      const threads = await phone.listThreads(caller.orgId, {
        archived: search.get('archived') === '1',
        beforeMs: Number.isFinite(before) && before > 0 ? before : null,
      })
      return phoneOk({ threads })
    }),
    thread: member(deps, ['GET'], async (caller, request) => {
      const search = new URL(request.url).searchParams
      const threadId = readPhoneId(search.get('threadId'))
      if (!threadId) return phoneRefusal(400, 'thread-required', 'Open a conversation.')
      return phoneOk(await phone.readThread(caller.orgId, threadId, { markRead: search.get('peek') !== '1' }))
    }),
    threadArchive: member(deps, ['POST'], async (caller, _request, body) => {
      const threadId = readPhoneId(body['threadId'])
      if (!threadId) return phoneRefusal(400, 'thread-required', 'Open a conversation.')
      await phone.archiveThread(caller.orgId, threadId, body['archived'] !== false)
      return phoneOk({ ok: true })
    }),
    send: member(deps, ['POST'], async (caller, _request, body) =>
      phoneOk(
        await phone.sendText(
          caller.orgId,
          {
            threadId: readPhoneId(body['threadId']),
            to: text(body['to'], 24) || null,
            numberId: readPhoneId(body['numberId']),
            body: typeof body['body'] === 'string' ? body['body'] : '',
          },
          { uid: caller.uid, name: caller.name },
        ),
      ),
    ),
    settings: member(
      deps,
      ['GET', 'POST'],
      async (caller, request, body) => {
        const current = await phone.settings(caller.orgId)
        if (request.method === 'GET') return phoneOk({ settings: withoutCells(current) })
        const next = sanitizePhoneSettings(body['settings'], current, Date.now())
        const saved = await phone.saveSettings(caller.orgId, { ...next, memberCells: current.memberCells })
        return phoneOk({ settings: withoutCells(saved) })
      },
      { manage: (request) => request.method === 'POST' },
    ),
    compliance: member(
      deps,
      ['GET', 'POST'],
      async (caller, request, body) => {
        if (request.method === 'GET') return phoneOk({ compliance: await phone.compliance(caller.orgId) })
        const compliance = await phone.saveCompliance(caller.orgId, readComplianceForm(body['form']), {
          submit: body['submit'] === true,
          notificationEmail: caller.email ?? '',
        })
        return phoneOk({ compliance })
      },
      { manage: (request) => request.method === 'POST' },
    ),
    complianceRefresh: member(
      deps,
      ['POST'],
      async (caller) => phoneOk({ compliance: await phone.refreshCompliance(caller.orgId) }),
      { manage: true },
    ),
    ports: member(
      deps,
      ['GET', 'POST'],
      async (caller, request, body) => {
        if (request.method === 'GET') return phoneOk({ ports: (await phone.status(caller.orgId)).ports })
        const address = (body['serviceAddress'] && typeof body['serviceAddress'] === 'object'
          ? body['serviceAddress']
          : {}) as Record<string, unknown>
        const port = await phone.requestPort(caller.orgId, orgName(caller), caller.uid, {
          numbers: Array.isArray(body['numbers']) ? (body['numbers'] as unknown[]).map((one) => text(one, 24)) : [],
          accountHolderName: text(body['accountHolderName'], 120),
          accountNumber: text(body['accountNumber'], 60),
          currentCarrier: text(body['currentCarrier'], 80),
          pin: text(body['pin'], 20) || null,
          hostId: readPhoneId(body['hostId']) ?? '',
          targetDate: /^\d{4}-\d{2}-\d{2}$/.test(text(body['targetDate'], 10)) ? text(body['targetDate'], 10) : null,
          serviceAddress: {
            street: text(address['street'], 120),
            city: text(address['city'], 80),
            region: text(address['region'], 40),
            postalCode: text(address['postalCode'], 20),
            country: text(address['country'], 2) || 'US',
          },
          notificationEmail: caller.email ?? '',
        })
        return phoneOk({ port })
      },
      { manage: true },
    ),
    calls: member(deps, ['GET'], async (caller) => phoneOk({ calls: await voice.listCalls(caller.orgId) })),
    callsPlace: member(deps, ['POST'], async (caller, _request, body) =>
      phoneOk({
        call: await voice.placeCall(
          caller.orgId,
          { to: body['to'], numberId: readPhoneId(body['numberId']), memberCell: body['memberCell'] },
          { uid: caller.uid },
        ),
      }),
    ),
  }
}

/** The URLs Twilio may have signed: the configured public origin, then as received. */
function candidateUrls(request: Request, origin: string | null): string[] {
  const received = new URL(request.url)
  const urls: string[] = []
  if (origin) urls.push(`${origin}${received.pathname}${received.search}`)
  const host = request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  if (host) urls.push(`https://${host}${received.pathname}${received.search}`)
  urls.push(request.url)
  return [...new Set(urls)]
}

/**
 * Wraps a Twilio webhook: POST only, the form body read once, and the
 * signature checked against the token of the subaccount that owns the number
 * (`To`, then `From` for a call we placed, then the `AccountSid` Twilio names).
 */
function hook(
  deps: PhoneRouteDeps,
  run: (params: Record<string, string>, query: URLSearchParams) => Promise<Response>,
): PhoneWebHandler {
  const verify = deps.verifySignature ?? verifyTwilioWebhookSignature
  return async (request) => {
    if (request.method !== 'POST') return new Response('Method not allowed', { status: 405 })
    const params = Object.fromEntries(new URLSearchParams(await request.text()).entries())
    const signature = request.headers.get('x-twilio-signature') ?? ''
    const candidates = [phoneE164(params['To']), phoneE164(params['From'])].filter((n): n is string => !!n)
    let token: string | null = null
    for (const e164 of candidates) {
      token = await deps.phone.webhookAuthToken(e164, null)
      if (token) break
    }
    token ??= await deps.phone.webhookAuthToken(null, params['AccountSid'] ?? null)
    const signed =
      !!token &&
      candidateUrls(request, deps.webhookOrigin()).some((url) =>
        verify({ url, params, signature, authToken: token! }),
      )
    if (!signed) return new Response('Forbidden', { status: 403 })
    try {
      return await run(params, new URL(request.url).searchParams)
    } catch (error) {
      // 500 so Twilio retries: a dropped text is a customer nobody answers.
      console.error('[phone] webhook failed', error)
      return new Response('Not recorded', { status: 500 })
    }
  }
}

export function createPhoneHookRoutes(deps: PhoneRouteDeps): Record<string, PhoneWebHandler> {
  const { phone, voice } = deps
  const ids = (query: URLSearchParams) => ({
    org: readPhoneId(query.get('org')) ?? '',
    call: readPhoneId(query.get('call')) ?? '',
  })
  return {
    hookSms: hook(deps, async (params) => {
      await phone.receiveText(params)
      return twimlResponse(EMPTY_TWIML)
    }),
    hookSmsStatus: hook(deps, async (params, query) => {
      const org = readPhoneId(query.get('org'))
      const thread = readPhoneId(query.get('thread'))
      const message = readPhoneId(query.get('message'))
      if (org && thread && message) await phone.messageStatus({ org, thread, message }, params)
      return new Response(null, { status: 204 })
    }),
    hookVoice: hook(deps, async (params) => twimlResponse(await voice.inbound(params))),
    hookVoiceDial: hook(deps, async (params, query) => twimlResponse(await voice.dialEnded(ids(query), params))),
    hookVoicemail: hook(deps, async (params, query) => twimlResponse(await voice.voicemailLeft(ids(query), params))),
    hookTranscription: hook(deps, async (params, query) => {
      await voice.transcription(ids(query), params)
      return new Response(null, { status: 204 })
    }),
    hookVoiceStatus: hook(deps, async (params, query) => {
      await voice.statusChanged(ids(query), params)
      return new Response(null, { status: 204 })
    }),
    hookOutbound: hook(deps, async (_params, query) => twimlResponse(await voice.outboundBridge(ids(query)))),
  }
}
