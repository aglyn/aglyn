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

import { PHONE_API_ROUTES } from '../constants/api-routes'
import { isOpenAt, phoneE164, phoneThreadId } from '../model/phone-rules'
import type { PhoneCall, PhoneCallStatus, PhoneNumberRecord, PhoneSettings } from '../model/phone.types'
import { describeCallForTimeline } from '../model/phone-call-words'
import { twiml, type TwimlNode } from '../twilio/twiml'
import { PhoneServiceError, type PhoneService, type PhoneServiceDeps } from './phone-service'

/**
 * Calls on the business number (AGL-4251): what Twilio is told to do when the
 * number rings, what is kept when it ends, voicemail and its transcript, and
 * a call placed from the business number by ringing the member's own cell
 * first.
 *
 * Recording: only voicemail is ever recorded, after the caller hears the
 * greeting, and the greeting says so. A connected call is never recorded.
 */

const VOICEMAIL_MAX_SECONDS = 120

export function createVoiceService(deps: PhoneServiceDeps, phone: PhoneService) {
  const { repo, twilio } = deps
  const url = (route: string, query: Record<string, string>) => {
    const origin = deps.webhookOrigin()
    if (!origin) return ''
    const search = new URLSearchParams(query).toString()
    return `${origin}/api/${route}${search ? `?${search}` : ''}`
  }

  function voicemail(orgId: string, callId: string, greeting: string, transcribe: boolean): TwimlNode[] {
    return [
      { verb: 'Say', text: greeting },
      {
        verb: 'Record',
        action: url(PHONE_API_ROUTES.hookVoicemail, { org: orgId, call: callId }),
        maxLength: VOICEMAIL_MAX_SECONDS,
        ...(transcribe
          ? { transcribeCallback: url(PHONE_API_ROUTES.hookTranscription, { org: orgId, call: callId }) }
          : {}),
      },
      { verb: 'Hangup' },
    ]
  }

  async function resolveNumber(e164: string | null) {
    if (!e164) return null
    const index = await repo.getNumberIndex(e164)
    if (!index) return null
    const number = await repo.getNumber(index.orgId, index.numberId)
    if (!number || number.status === 'released') return null
    return { orgId: index.orgId, number }
  }

  async function threadContact(orgId: string, number: PhoneNumberRecord, theirs: string) {
    const thread = await repo.getThread(orgId, phoneThreadId(number.e164, theirs))
    if (thread?.contact) return thread.contact
    if (!deps.findPerson) return null
    try {
      return await deps.findPerson({ orgId, hostId: number.hostId, e164: theirs })
    } catch {
      return null
    }
  }

  return {
    /** The number rang. Answers the TwiML that rings the team, or takes a message. */
    async inbound(params: Record<string, string>): Promise<string> {
      const resolved = await resolveNumber(phoneE164(params['To']))
      const from = phoneE164(params['From']) ?? String(params['From'] ?? 'unknown')
      if (!resolved) {
        return twiml([{ verb: 'Say', text: 'This number is not in service.' }, { verb: 'Hangup' }])
      }
      const { orgId, number } = resolved
      const settings: PhoneSettings = await phone.settings(orgId)
      const nowMs = deps.now()
      const callId = String(params['CallSid'] ?? deps.newId())
      const call: PhoneCall = {
        id: callId,
        numberId: number.id,
        direction: 'inbound',
        ours: number.e164,
        theirs: from,
        twilioSid: String(params['CallSid'] ?? ''),
        status: 'ringing',
        startedAtMs: nowMs,
        contact: await threadContact(orgId, number, from),
      }
      await repo.putCall(orgId, call)
      const open = isOpenAt(settings, nowMs)
      const cells = settings.forwardTo.filter((cell) => cell !== number.e164 && cell !== from)
      if (!open || !cells.length) {
        return twiml(
          voicemail(orgId, callId, open ? settings.voicemailGreeting : settings.closedGreeting, settings.voicemailTranscription),
        )
      }
      return twiml([
        {
          verb: 'Dial',
          timeout: settings.ringSeconds,
          // The caller's own number shows on the cell, so whoever answers knows who it is.
          callerId: from.startsWith('+') ? from : number.e164,
          numbers: cells,
          action: url(PHONE_API_ROUTES.hookVoiceDial, { org: orgId, call: callId }),
        },
      ])
    },

    /** The ring ended. Answered: hang up when they do. Not answered: take a message. */
    async dialEnded(query: { org: string; call: string }, params: Record<string, string>): Promise<string> {
      const call = await repo.getCall(query.org, query.call)
      const outcome = String(params['DialCallStatus'] ?? '')
      if (outcome === 'completed' || outcome === 'answered') {
        if (call) {
          await repo.putCall(query.org, { ...call, status: 'completed', answeredBy: 'cell' })
        }
        return twiml([{ verb: 'Hangup' }])
      }
      const settings = await phone.settings(query.org)
      return twiml(voicemail(query.org, query.call, settings.voicemailGreeting, settings.voicemailTranscription))
    },

    /** The message was left. */
    async voicemailLeft(query: { org: string; call: string }, params: Record<string, string>): Promise<string> {
      const call = await repo.getCall(query.org, query.call)
      const duration = Math.max(0, Number(params['RecordingDuration'] ?? 0) || 0)
      if (call && params['RecordingSid'] && duration > 0) {
        const settings = await phone.settings(query.org)
        await repo.putCall(query.org, {
          ...call,
          status: 'voicemail',
          voicemail: {
            recordingSid: String(params['RecordingSid']),
            durationSec: duration,
            transcript: null,
            transcriptStatus: settings.voicemailTranscription ? 'pending' : undefined,
          },
        })
      }
      return twiml([{ verb: 'Say', text: 'Thank you. Goodbye.' }, { verb: 'Hangup' }])
    },

    async transcription(query: { org: string; call: string }, params: Record<string, string>): Promise<void> {
      const call = await repo.getCall(query.org, query.call)
      if (!call?.voicemail) return
      const done = String(params['TranscriptionStatus'] ?? '') === 'completed'
      await repo.putCall(query.org, {
        ...call,
        voicemail: {
          ...call.voicemail,
          transcript: done ? String(params['TranscriptionText'] ?? '').slice(0, 4000) : null,
          transcriptStatus: done ? 'completed' : 'failed',
        },
      })
    },

    /**
     * The call ended (Twilio's status callback). Counts its minutes, files it
     * on the person's timeline, and texts a missed caller back when the
     * workspace wrote a missed-call text.
     */
    async statusChanged(query: { org?: string; call?: string }, params: Record<string, string>): Promise<void> {
      const callSid = String(params['CallSid'] ?? '')
      const resolved =
        (await resolveNumber(phoneE164(params['To']))) ?? (await resolveNumber(phoneE164(params['From'])))
      if (!resolved || !callSid) return
      const { orgId, number } = resolved
      // A call placed from Phone names its record in the callback URL; an
      // inbound call's record is keyed by Twilio's own call sid.
      const call = await repo.getCall(orgId, query.org === orgId && query.call ? query.call : callSid)
      if (!call) return
      const reported = String(params['CallStatus'] ?? '')
      if (!['completed', 'busy', 'failed', 'no-answer', 'canceled'].includes(reported)) return
      const seconds = Math.max(0, Number(params['CallDuration'] ?? 0) || 0)
      const status: PhoneCallStatus =
        call.status === 'voicemail'
          ? 'voicemail'
          : reported === 'completed'
            ? call.status === 'ringing' && call.direction === 'inbound'
              ? 'missed'
              : 'completed'
            : (reported as PhoneCallStatus)
      const endedAtMs = deps.now()
      const next: PhoneCall = { ...call, status, endedAtMs, durationSec: seconds }
      await repo.putCall(orgId, next)
      await phone.countMinutes(number.hostId, endedAtMs, seconds)
      if (next.contact && deps.logActivity) {
        try {
          await deps.logActivity({
            orgId,
            hostId: number.hostId,
            person: next.contact,
            kind: 'call',
            direction: next.direction,
            body: describeCallForTimeline(next),
            atMs: next.startedAtMs,
            byUid: next.byUid ?? null,
            dedupeKey: `phone-call:${next.id}`,
          })
        } catch {
          // The timeline is a convenience.
        }
      }
      if (next.direction === 'inbound' && (status === 'missed' || status === 'voicemail')) {
        const settings = await phone.settings(orgId)
        if (settings.missedCallText.trim() && next.theirs.startsWith('+')) {
          try {
            await phone.sendText(
              orgId,
              { to: next.theirs, numberId: number.id, body: settings.missedCallText },
              { uid: 'phone-auto-reply', name: 'Automatic reply' },
            )
          } catch {
            // Opted out, rate-limited or unregistered: the call is still logged.
          }
        }
      }
    },

    /**
     * Calls a customer from the business number: Twilio rings the member's
     * cell, and when they answer connects them, showing the business number.
     */
    async placeCall(
      orgId: string,
      input: { to: unknown; numberId?: unknown; memberCell: unknown },
      member: { uid: string },
    ): Promise<PhoneCall> {
      const to = phoneE164(input.to)
      const cell = phoneE164(input.memberCell)
      if (!to) throw new PhoneServiceError(400, 'invalid-number', 'That does not read as a phone number.')
      if (!cell) throw new PhoneServiceError(400, 'cell-required', 'Enter your own cell number, so Phone can ring you first.')
      if (!twilio.isConfigured()) throw new PhoneServiceError(503, 'not-configured', 'Phone is not set up on this server yet.')
      const account = await repo.getAccount(orgId)
      const numbers = (await repo.listNumbers(orgId)).filter((one) => one.status === 'active')
      const number = numbers.find((one) => one.id === input.numberId) ?? numbers[0]
      if (!account || !number) {
        throw new PhoneServiceError(409, 'no-number', 'Choose a business number before you place a call.')
      }
      if (!(await deps.consumeSendRate(orgId))) {
        throw new PhoneServiceError(429, 'rate-limited', 'Too many calls and texts this hour. Try again in a few minutes.')
      }
      const settings = await phone.settings(orgId)
      if (settings.memberCells?.[member.uid] !== cell) {
        await phone.saveSettings(orgId, {
          ...settings,
          memberCells: { ...(settings.memberCells ?? {}), [member.uid]: cell },
        })
      }
      const callId = deps.newId()
      // Written before Twilio dials, because the bridge reads the customer's
      // number from it the moment the member answers.
      const pending: PhoneCall = {
        id: callId,
        numberId: number.id,
        direction: 'outbound',
        ours: number.e164,
        theirs: to,
        twilioSid: '',
        status: 'ringing',
        startedAtMs: deps.now(),
        byUid: member.uid,
        contact: await threadContact(orgId, number, to),
      }
      await repo.putCall(orgId, pending)
      let created: { sid: string }
      try {
        created = await twilio.createCall(account.subaccountSid, {
          from: number.e164,
          to: cell,
          twimlUrl: url(PHONE_API_ROUTES.hookOutbound, { org: orgId, call: callId }),
          statusCallback: url(PHONE_API_ROUTES.hookVoiceStatus, { org: orgId, call: callId }),
        })
      } catch (error) {
        await repo.putCall(orgId, { ...pending, status: 'failed', endedAtMs: deps.now() })
        throw new PhoneServiceError(502, 'twilio', `The call could not be placed: ${error instanceof Error ? error.message : String(error)}`)
      }
      const call: PhoneCall = { ...pending, twilioSid: created.sid }
      await repo.putCall(orgId, call)
      return call
    },

    /** The member picked up their cell: connect them to the customer. */
    async outboundBridge(query: { org: string; call: string }): Promise<string> {
      const call = await repo.getCall(query.org, query.call)
      if (!call) return twiml([{ verb: 'Say', text: 'That call has ended.' }, { verb: 'Hangup' }])
      return twiml([
        { verb: 'Say', text: 'Connecting your call.' },
        { verb: 'Dial', timeout: 30, callerId: call.ours, numbers: [call.theirs] },
      ])
    },

    async listCalls(orgId: string) {
      return repo.listCalls(orgId, { limit: 100 })
    },
  }
}

export type VoiceService = ReturnType<typeof createVoiceService>
