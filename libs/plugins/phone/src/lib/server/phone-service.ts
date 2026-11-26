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

import { PLATFORM_BRAND_NAME } from '@aglyn/aglyn/app-utils/platform-brand'
import { PHONE_MAX_BODY_CHARS, PHONE_MINUTES_COUNTER, PHONE_TEXTS_COUNTER } from '../constants/usage'
import { PHONE_API_ROUTES } from '../constants/api-routes'
import {
  defaultPhoneSettings,
  inboundKeyword,
  missingComplianceFields,
  phoneE164,
  phoneThreadId,
} from '../model/phone-rules'
import {
  type PhoneCompliance,
  type PhoneComplianceForm,
  type PhoneMessage,
  type PhoneNumberKind,
  type PhoneNumberRecord,
  type PhonePortRequest,
  type PhoneSettings,
  type PhoneThread,
} from '../model/phone.types'
import type { PhoneRepository } from './phone-repository'
import { TwilioError, type TwilioClient, type TwilioNumberWebhooks } from '../twilio/twilio-client'

/**
 * Phone's behavior (AGL-4251), written once against a repository and a Twilio
 * client so the routes stay thin and every rule runs in a spec.
 */

/** The CRM person a number matched. */
export interface PhonePersonMatch {
  kind: string
  id: string
  name: string | null
}

export interface PhoneServiceDeps {
  repo: PhoneRepository
  twilio: TwilioClient
  now(): number
  newId(): string
  /** `https://app.aglyn.io` — where Twilio's webhooks reach the console. Null: unusable. */
  webhookOrigin(): string | null
  /** The CRM person a number belongs to on a site, or null. */
  findPerson?(input: { orgId: string; hostId: string; e164: string }): Promise<PhonePersonMatch | null>
  /** Files a text or call on the person's CRM timeline. Never throws. */
  logActivity?(input: {
    orgId: string
    hostId: string
    person: PhonePersonMatch
    kind: 'text' | 'call'
    direction: 'inbound' | 'outbound'
    body: string
    atMs: number
    byUid: string | null
    dedupeKey: string
  }): Promise<void>
  /** One send against the workspace's hourly ceiling: false when it is spent. */
  consumeSendRate(orgId: string): Promise<boolean>
}

/** A refusal the routes turn into a status and a sentence. */
export class PhoneServiceError extends Error {
  constructor(
    readonly status: number,
    readonly reason: string,
    message: string,
  ) {
    super(message)
    this.name = 'PhoneServiceError'
  }
}

/** `YYYY-MM` in UTC: the month the usage counters are keyed by. */
export function usageMonth(atMs: number): string {
  return new Date(atMs).toISOString().slice(0, 7)
}

export function phoneWebhooks(origin: string): TwilioNumberWebhooks {
  return {
    smsUrl: `${origin}/api/${PHONE_API_ROUTES.hookSms}`,
    smsStatusUrl: `${origin}/api/${PHONE_API_ROUTES.hookSmsStatus}`,
    voiceUrl: `${origin}/api/${PHONE_API_ROUTES.hookVoice}`,
    voiceStatusUrl: `${origin}/api/${PHONE_API_ROUTES.hookVoiceStatus}`,
  }
}

export function createPhoneService(deps: PhoneServiceDeps) {
  const { repo, twilio } = deps

  function origin(): string {
    const value = deps.webhookOrigin()
    if (!value) throw new PhoneServiceError(503, 'no-origin', 'Phone is not set up on this server yet.')
    return value
  }

  function requireTwilio(): void {
    if (!twilio.isConfigured()) {
      throw new PhoneServiceError(503, 'not-configured', 'Phone is not set up on this server yet.')
    }
  }

  async function twilioCall<T>(run: () => Promise<T>): Promise<T> {
    try {
      return await run()
    } catch (error) {
      if (error instanceof TwilioError) {
        throw new PhoneServiceError(
          error.status >= 500 ? 502 : 400,
          'twilio',
          `The phone company refused that: ${error.message}`,
        )
      }
      throw error
    }
  }

  async function settings(orgId: string): Promise<PhoneSettings> {
    return (await repo.getSettings(orgId)) ?? defaultPhoneSettings(deps.now())
  }

  async function ensureAccount(orgId: string, orgName: string, uid: string) {
    const existing = await repo.getAccount(orgId)
    if (existing) return existing
    requireTwilio()
    const created = await twilioCall(() => twilio.createSubaccount(`${PLATFORM_BRAND_NAME} ${orgName || orgId}`.slice(0, 64)))
    const account = {
      subaccountSid: created.sid,
      friendlyName: `${PLATFORM_BRAND_NAME} ${orgName || orgId}`.slice(0, 64),
      createdAtMs: deps.now(),
      createdByUid: uid,
    }
    await repo.putAccount(orgId, account)
    return account
  }

  async function activeNumbers(orgId: string): Promise<PhoneNumberRecord[]> {
    return (await repo.listNumbers(orgId)).filter((number) => number.status !== 'released')
  }

  async function matchPerson(orgId: string, hostId: string, e164: string): Promise<PhonePersonMatch | null> {
    if (!deps.findPerson) return null
    try {
      return await deps.findPerson({ orgId, hostId, e164 })
    } catch {
      return null
    }
  }

  async function logActivity(input: Parameters<NonNullable<PhoneServiceDeps['logActivity']>>[0]) {
    try {
      await deps.logActivity?.(input)
    } catch {
      // The timeline is a convenience: a failure never undoes a text.
    }
  }

  /** Opens (or reads) the thread for a pair of numbers, matching the person on first sight. */
  async function threadFor(orgId: string, number: PhoneNumberRecord, theirs: string): Promise<PhoneThread> {
    const id = phoneThreadId(number.e164, theirs)
    const existing = await repo.getThread(orgId, id)
    if (existing) return existing
    return {
      id,
      numberId: number.id,
      ours: number.e164,
      theirs,
      contact: await matchPerson(orgId, number.hostId, theirs),
      lastMessageAtMs: 0,
      lastMessagePreview: '',
      lastDirection: 'inbound',
      unread: 0,
      archived: false,
    }
  }

  return {
    settings,

    async status(orgId: string) {
      const [account, numbers, compliance, current, ports] = await Promise.all([
        repo.getAccount(orgId),
        activeNumbers(orgId),
        repo.getCompliance(orgId),
        settings(orgId),
        repo.listPorts(orgId),
      ])
      return {
        configured: twilio.isConfigured(),
        hasAccount: Boolean(account),
        numbers,
        compliance,
        settings: current,
        ports,
      }
    },

    async searchNumbers(
      orgId: string,
      orgName: string,
      uid: string,
      query: { kind: PhoneNumberKind; areaCode?: string | null; contains?: string | null },
    ) {
      const account = await ensureAccount(orgId, orgName, uid)
      return twilioCall(() => twilio.searchNumbers(account.subaccountSid, { ...query, limit: 20 }))
    },

    /**
     * Buys a number. One number per Phone add-on: a workspace that holds one
     * already is refused, so a second number is never bought by accident.
     */
    async buyNumber(
      orgId: string,
      orgName: string,
      uid: string,
      input: { e164: string; kind: PhoneNumberKind; hostId: string; label: string },
      allowance: number,
    ): Promise<PhoneNumberRecord> {
      const e164 = phoneE164(input.e164)
      if (!e164) throw new PhoneServiceError(400, 'invalid-number', 'Pick a number from the search results.')
      if (!input.hostId) throw new PhoneServiceError(400, 'site-required', 'Choose the site this number answers for.')
      const held = await activeNumbers(orgId)
      if (held.length >= allowance) {
        throw new PhoneServiceError(
          409,
          'number-limit',
          allowance > 0
            ? 'This workspace already has its business number.'
            : 'Add Phone to your plan on Billing before you choose a number.',
        )
      }
      const account = await ensureAccount(orgId, orgName, uid)
      const bought = await twilioCall(() =>
        twilio.purchaseNumber(account.subaccountSid, {
          e164,
          friendlyName: input.label || orgName || PLATFORM_BRAND_NAME,
          webhooks: phoneWebhooks(origin()),
        }),
      )
      const record: PhoneNumberRecord = {
        id: deps.newId(),
        e164: bought.e164,
        kind: input.kind,
        twilioSid: bought.sid,
        status: 'active',
        hostId: input.hostId,
        label: (input.label || 'Business line').slice(0, 60),
        createdAtMs: deps.now(),
        createdByUid: uid,
      }
      await repo.putNumber(orgId, record)
      await repo.putNumberIndex(record.e164, {
        orgId,
        numberId: record.id,
        subaccountSid: account.subaccountSid,
      })
      if (!(await repo.getSettings(orgId))) await repo.putSettings(orgId, defaultPhoneSettings(deps.now()))
      return record
    },

    async updateNumber(orgId: string, numberId: string, patch: { label?: unknown; hostId?: unknown }) {
      const number = await repo.getNumber(orgId, numberId)
      if (!number || number.status === 'released') {
        throw new PhoneServiceError(404, 'not-found', 'That number is not on this workspace.')
      }
      const next: PhoneNumberRecord = {
        ...number,
        ...(typeof patch.label === 'string' && patch.label.trim() ? { label: patch.label.trim().slice(0, 60) } : {}),
        ...(typeof patch.hostId === 'string' && patch.hostId ? { hostId: patch.hostId } : {}),
      }
      await repo.putNumber(orgId, next)
      return next
    },

    /** Gives the number back to the phone company. It cannot be bought back once someone else takes it. */
    async releaseNumber(orgId: string, numberId: string) {
      const number = await repo.getNumber(orgId, numberId)
      if (!number || number.status === 'released') {
        throw new PhoneServiceError(404, 'not-found', 'That number is not on this workspace.')
      }
      const account = await repo.getAccount(orgId)
      if (account) await twilioCall(() => twilio.releaseNumber(account.subaccountSid, number.twilioSid))
      await repo.putNumber(orgId, { ...number, status: 'released', releasedAtMs: deps.now() })
      await repo.deleteNumberIndex(number.e164)
    },

    async listThreads(orgId: string, options: { archived?: boolean; beforeMs?: number | null }) {
      return repo.listThreads(orgId, { limit: 50, ...options })
    },

    async readThread(orgId: string, threadId: string, options: { markRead: boolean }) {
      const thread = await repo.getThread(orgId, threadId)
      if (!thread) throw new PhoneServiceError(404, 'not-found', 'That conversation is gone.')
      const [messages, calls] = await Promise.all([
        repo.listMessages(orgId, threadId, 200),
        repo.listCalls(orgId, { limit: 20, theirs: thread.theirs }),
      ])
      if (options.markRead && thread.unread > 0) await repo.putThread(orgId, { ...thread, unread: 0 })
      return { thread: options.markRead ? { ...thread, unread: 0 } : thread, messages, calls }
    },

    async archiveThread(orgId: string, threadId: string, archived: boolean) {
      const thread = await repo.getThread(orgId, threadId)
      if (!thread) throw new PhoneServiceError(404, 'not-found', 'That conversation is gone.')
      await repo.putThread(orgId, { ...thread, archived })
    },

    /**
     * Sends a text from the business number. `to` opens a new conversation;
     * `threadId` answers one. A person who texted STOP is not texted again.
     */
    async sendText(
      orgId: string,
      input: { threadId?: string | null; to?: string | null; numberId?: string | null; body: string },
      member: { uid: string; name: string | null },
    ): Promise<{ thread: PhoneThread; message: PhoneMessage }> {
      const body = String(input.body ?? '').trim()
      if (!body) throw new PhoneServiceError(400, 'empty', 'Write a message first.')
      if (body.length > PHONE_MAX_BODY_CHARS) {
        throw new PhoneServiceError(400, 'too-long', `Keep a text under ${PHONE_MAX_BODY_CHARS} characters.`)
      }
      requireTwilio()
      const numbers = await activeNumbers(orgId)
      let thread: PhoneThread | null = null
      let number: PhoneNumberRecord | undefined
      if (input.threadId) {
        thread = await repo.getThread(orgId, input.threadId)
        if (!thread) throw new PhoneServiceError(404, 'not-found', 'That conversation is gone.')
        number = numbers.find((one) => one.id === thread?.numberId)
      } else {
        const to = phoneE164(input.to)
        if (!to) throw new PhoneServiceError(400, 'invalid-number', 'That does not read as a phone number.')
        number = numbers.find((one) => one.id === input.numberId) ?? numbers[0]
        if (number) thread = await threadFor(orgId, number, to)
      }
      if (!number || !thread) {
        throw new PhoneServiceError(409, 'no-number', 'Choose a business number before you text anyone.')
      }
      if (thread.optedOut) {
        throw new PhoneServiceError(409, 'opted-out', 'This person texted STOP. They have to text START before you can text them again.')
      }
      if (!(await deps.consumeSendRate(orgId))) {
        throw new PhoneServiceError(429, 'rate-limited', 'Too many texts this hour. Try again in a few minutes.')
      }
      const account = await repo.getAccount(orgId)
      if (!account) throw new PhoneServiceError(409, 'no-number', 'Choose a business number before you text anyone.')
      const messageId = deps.newId()
      const atMs = deps.now()
      const statusCallback = `${origin()}/api/${PHONE_API_ROUTES.hookSmsStatus}?org=${encodeURIComponent(orgId)}&thread=${encodeURIComponent(thread.id)}&message=${encodeURIComponent(messageId)}`
      const sent = await twilioCall(() =>
        twilio.sendMessage(account.subaccountSid, { from: number!.e164, to: thread!.theirs, body, statusCallback }),
      )
      const message: PhoneMessage = {
        id: messageId,
        threadId: thread.id,
        direction: 'outbound',
        body,
        status: sent.status === 'sent' ? 'sent' : 'queued',
        segments: sent.segments,
        twilioSid: sent.sid,
        atMs,
        byUid: member.uid,
        byName: member.name,
      }
      const nextThread: PhoneThread = {
        ...thread,
        lastMessageAtMs: atMs,
        lastMessagePreview: body.slice(0, 140),
        lastDirection: 'outbound',
        archived: false,
      }
      await repo.putMessage(orgId, message)
      await repo.putThread(orgId, nextThread)
      await repo.incrementUsage(number.hostId, PHONE_TEXTS_COUNTER, usageMonth(atMs), sent.segments)
      if (nextThread.contact) {
        await logActivity({
          orgId,
          hostId: number.hostId,
          person: nextThread.contact,
          kind: 'text',
          direction: 'outbound',
          body,
          atMs,
          byUid: member.uid,
          dedupeKey: `phone-text:${message.id}`,
        })
      }
      return { thread: nextThread, message }
    },

    /**
     * A text to a business number, from Twilio's signed webhook. Answers what
     * was filed; the route answers Twilio with empty TwiML either way.
     */
    async receiveText(params: Record<string, string>): Promise<{ filed: boolean; reason?: string }> {
      const to = phoneE164(params['To'])
      const from = phoneE164(params['From'])
      if (!to || !from) return { filed: false, reason: 'unreadable-number' }
      const index = await repo.getNumberIndex(to)
      if (!index) return { filed: false, reason: 'unknown-number' }
      const number = await repo.getNumber(index.orgId, index.numberId)
      if (!number || number.status === 'released') return { filed: false, reason: 'released-number' }
      const orgId = index.orgId
      const sid = String(params['MessageSid'] ?? params['SmsSid'] ?? '')
      const thread = await threadFor(orgId, number, from)
      const body = String(params['Body'] ?? '')
      const mediaCount = Math.min(10, Math.max(0, Number(params['NumMedia'] ?? 0) || 0))
      const mediaUrls = Array.from({ length: mediaCount }, (_, i) => params[`MediaUrl${i}`]).filter(
        (url): url is string => typeof url === 'string' && url.startsWith('https://'),
      )
      const atMs = deps.now()
      const segments = Math.max(1, Number(params['NumSegments'] ?? 1) || 1)
      // Twilio delivers a webhook at least once: the message sid is the id,
      // so a retry overwrites the same message instead of adding a second.
      const messageId = sid && /^[A-Za-z0-9]{10,64}$/.test(sid) ? sid : deps.newId()
      const already = await repo.getMessage(orgId, thread.id, messageId)
      const keyword = inboundKeyword(body)
      const message: PhoneMessage = {
        id: messageId,
        threadId: thread.id,
        direction: 'inbound',
        body,
        ...(mediaUrls.length ? { mediaUrls } : {}),
        status: 'received',
        segments,
        twilioSid: sid || null,
        atMs: already?.atMs ?? atMs,
      }
      await repo.putMessage(orgId, message)
      await repo.putThread(orgId, {
        ...thread,
        lastMessageAtMs: message.atMs,
        lastMessagePreview: (body || (mediaUrls.length ? 'Picture' : '')).slice(0, 140),
        lastDirection: 'inbound',
        unread: thread.unread + (already ? 0 : 1),
        archived: false,
        ...(keyword === 'stop' ? { optedOut: true } : keyword === 'start' ? { optedOut: false } : {}),
      })
      if (!already) {
        await repo.incrementUsage(number.hostId, PHONE_TEXTS_COUNTER, usageMonth(atMs), segments)
        if (thread.contact) {
          await logActivity({
            orgId,
            hostId: number.hostId,
            person: thread.contact,
            kind: 'text',
            direction: 'inbound',
            body,
            atMs,
            byUid: null,
            dedupeKey: `phone-text:${messageId}`,
          })
        }
      }
      return { filed: true }
    },

    /** A delivery report for a text we sent. The URL names the message, and the signature covers the URL. */
    async messageStatus(query: { org: string; thread: string; message: string }, params: Record<string, string>) {
      const message = await repo.getMessage(query.org, query.thread, query.message)
      if (!message) return
      const reported = String(params['MessageStatus'] ?? params['SmsStatus'] ?? '')
      const status: PhoneMessage['status'] | null =
        reported === 'delivered'
          ? 'delivered'
          : reported === 'undelivered'
            ? 'undelivered'
            : reported === 'failed'
              ? 'failed'
              : reported === 'sent'
                ? 'sent'
                : null
      if (!status) return
      // Never step backwards: a late "sent" must not hide "delivered".
      if (message.status === 'delivered' && status === 'sent') return
      await repo.putMessage(query.org, {
        ...message,
        status,
        ...(params['ErrorCode'] ? { error: `Carrier error ${params['ErrorCode']}` } : {}),
      })
    },

    /** The subaccount's own token, for checking a webhook's signature. */
    async webhookAuthToken(e164: string | null, accountSid: string | null): Promise<string | null> {
      const fromNumber = e164 ? await repo.getNumberIndex(e164) : null
      const sid = fromNumber?.subaccountSid ?? accountSid
      if (!sid) return null
      if (!fromNumber && !(await repo.orgForSubaccount(sid))) return null
      try {
        return (await twilio.subaccountAuthToken(sid)) || null
      } catch {
        return null
      }
    },

    async saveSettings(orgId: string, next: PhoneSettings) {
      await repo.putSettings(orgId, next)
      return next
    },

    async compliance(orgId: string): Promise<PhoneCompliance | null> {
      return repo.getCompliance(orgId)
    },

    /**
     * Saves the registration form and, with `submit`, sends it to the carriers'
     * registry: toll-free verification for a toll-free number, an A2P 10DLC
     * brand for a local one (its campaign follows once the brand is approved).
     */
    async saveCompliance(
      orgId: string,
      form: PhoneComplianceForm,
      options: { submit: boolean; notificationEmail: string },
    ): Promise<PhoneCompliance> {
      const now = deps.now()
      const current = await repo.getCompliance(orgId)
      if (current && ['submitted', 'in-review', 'approved'].includes(current.status)) {
        throw new PhoneServiceError(409, 'already-submitted', 'This registration is already with the carriers.')
      }
      const draft: PhoneCompliance = {
        ...(current ?? {}),
        form,
        status: 'draft',
        updatedAtMs: now,
      }
      if (!options.submit) {
        await repo.putCompliance(orgId, draft)
        return draft
      }
      const missing = missingComplianceFields(form)
      if (missing.length) {
        throw new PhoneServiceError(400, 'incomplete', `Fill in: ${missing.join(', ')}.`)
      }
      requireTwilio()
      const account = await repo.getAccount(orgId)
      const number = (await activeNumbers(orgId))[0]
      if (!account || !number) {
        throw new PhoneServiceError(409, 'no-number', 'Choose a business number before you register it for texting.')
      }
      if (form.kind === 'tollFree') {
        if (number.kind !== 'tollFree') {
          throw new PhoneServiceError(400, 'wrong-kind', 'Toll-free verification is for a toll-free number.')
        }
        const verification = await twilioCall(() =>
          twilio.submitTollFreeVerification(account.subaccountSid, {
            numberSid: number.twilioSid,
            form,
            notificationEmail: options.notificationEmail,
          }),
        )
        const submitted: PhoneCompliance = {
          ...draft,
          status: 'submitted',
          tollFreeVerificationSid: verification.sid,
          submittedAtMs: now,
        }
        await repo.putCompliance(orgId, submitted)
        return submitted
      }
      if (form.businessType === 'sole-proprietor') {
        throw new PhoneServiceError(
          400,
          'sole-proprietor',
          'Sole proprietors register for texting with a toll-free number. Choose a toll-free number, or enter your EIN.',
        )
      }
      const brand = await twilioCall(() =>
        twilio.submitA2pBrand(account.subaccountSid, { form, notificationEmail: options.notificationEmail }),
      )
      const submitted: PhoneCompliance = {
        ...draft,
        status: 'submitted',
        brandSid: brand.brandSid,
        submittedAtMs: now,
      }
      await repo.putCompliance(orgId, submitted)
      return submitted
    },

    /**
     * Asks the registry where a submitted registration stands. A 10DLC brand
     * that was approved gets its campaign created here, which is the last step.
     */
    async refreshCompliance(orgId: string): Promise<PhoneCompliance | null> {
      const current = await repo.getCompliance(orgId)
      const account = await repo.getAccount(orgId)
      if (!current || !account || current.status === 'draft' || current.status === 'approved') return current
      requireTwilio()
      const now = deps.now()
      if (current.form.kind === 'tollFree' && current.tollFreeVerificationSid) {
        const read = await twilioCall(() =>
          twilio.readTollFreeVerification(account.subaccountSid, current.tollFreeVerificationSid!),
        )
        const status = tollFreeStatus(read.status)
        const next = { ...current, status, rejectionReason: read.rejectionReason, updatedAtMs: now }
        await repo.putCompliance(orgId, next)
        return next
      }
      if (current.brandSid && !current.campaignSid) {
        const brand = await twilioCall(() => twilio.readA2pBrand(account.subaccountSid, current.brandSid!))
        if (brand.status === 'FAILED') {
          const next = { ...current, status: 'rejected' as const, rejectionReason: brand.rejectionReason, updatedAtMs: now }
          await repo.putCompliance(orgId, next)
          return next
        }
        if (brand.status !== 'APPROVED') {
          const next = { ...current, status: 'in-review' as const, updatedAtMs: now }
          await repo.putCompliance(orgId, next)
          return next
        }
        const number = (await activeNumbers(orgId))[0]
        if (!number) return current
        const campaign = await twilioCall(() =>
          twilio.createA2pCampaign(account.subaccountSid, {
            brandSid: current.brandSid!,
            numberSid: number.twilioSid,
            form: current.form,
            inboundUrl: phoneWebhooks(origin()).smsUrl,
          }),
        )
        const next = { ...current, status: 'in-review' as const, campaignSid: campaign.campaignSid, updatedAtMs: now }
        await repo.putCompliance(orgId, next)
        return next
      }
      return current
    },

    /** Starts moving an existing number in. The carrier PIN goes to Twilio once and is never stored. */
    async requestPort(
      orgId: string,
      orgName: string,
      uid: string,
      input: Omit<PhonePortRequest, 'id' | 'status' | 'createdAtMs' | 'createdByUid' | 'twilioPortInSid'> & {
        pin?: string | null
        notificationEmail: string
      },
    ): Promise<PhonePortRequest> {
      const numbers = [...new Set(input.numbers.map(phoneE164).filter((n): n is string => !!n))]
      if (!numbers.length) throw new PhoneServiceError(400, 'invalid-number', 'Enter the number you want to move.')
      if (!input.accountHolderName.trim() || !input.accountNumber.trim() || !input.currentCarrier.trim()) {
        throw new PhoneServiceError(400, 'incomplete', 'Enter the account holder, account number and current carrier as your bill shows them.')
      }
      requireTwilio()
      const account = await ensureAccount(orgId, orgName, uid)
      const created = await twilioCall(() =>
        twilio.requestPortIn(account.subaccountSid, {
          numbers: numbers.map((e164) => ({ e164, pin: input.pin ?? null })),
          accountHolderName: input.accountHolderName.trim(),
          accountNumber: input.accountNumber.trim(),
          currentCarrier: input.currentCarrier.trim(),
          serviceAddress: input.serviceAddress,
          notificationEmail: input.notificationEmail,
          targetDate: input.targetDate ?? null,
        }),
      )
      const port: PhonePortRequest = {
        id: deps.newId(),
        numbers,
        accountHolderName: input.accountHolderName.trim(),
        currentCarrier: input.currentCarrier.trim(),
        accountNumber: input.accountNumber.trim(),
        serviceAddress: input.serviceAddress,
        hostId: input.hostId,
        status: 'submitted',
        twilioPortInSid: created.sid,
        targetDate: input.targetDate ?? null,
        createdAtMs: deps.now(),
        createdByUid: uid,
      }
      await repo.putPort(orgId, port)
      return port
    },

    /** Adds call minutes to the number's site counter. */
    async countMinutes(hostId: string, atMs: number, seconds: number) {
      const minutes = Math.ceil(Math.max(0, seconds) / 60)
      if (minutes > 0) await repo.incrementUsage(hostId, PHONE_MINUTES_COUNTER, usageMonth(atMs), minutes)
    },
  }
}

export type PhoneService = ReturnType<typeof createPhoneService>

function tollFreeStatus(status: string): PhoneCompliance['status'] {
  switch (status) {
    case 'TWILIO_APPROVED':
      return 'approved'
    case 'TWILIO_REJECTED':
      return 'rejected'
    case 'IN_REVIEW':
      return 'in-review'
    default:
      return 'submitted'
  }
}
