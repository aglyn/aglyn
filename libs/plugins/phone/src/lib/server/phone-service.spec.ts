/**
 * @jest-environment node
 */
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

import { createFakeTwilio } from '../testing/fake-twilio'
import { createMemoryPhoneRepository } from './phone-repository'
import { createPhoneService, PhoneServiceError, type PhoneServiceDeps } from './phone-service'
import { createVoiceService } from './voice-service'
import type { PhoneComplianceForm } from '../model/phone.types'

const ORG = 'org1'
const SITE = 'site1'

function setup(overrides: Partial<PhoneServiceDeps> = {}) {
  const repo = createMemoryPhoneRepository()
  const twilio = createFakeTwilio()
  let id = 0
  let now = Date.UTC(2026, 10, 26, 16, 0)
  const activity: unknown[] = []
  let rateLeft = 100
  const deps: PhoneServiceDeps = {
    repo,
    twilio: twilio.client,
    now: () => now,
    newId: () => `id${++id}`,
    webhookOrigin: () => 'https://app.aglyn.io',
    findPerson: async ({ e164 }) => (e164 === '+18305550142' ? { kind: 'contact', id: 'c1', name: 'Rider One' } : null),
    logActivity: async (input) => {
      activity.push(input)
    },
    consumeSendRate: async () => rateLeft-- > 0,
    ...overrides,
  }
  const phone = createPhoneService(deps)
  const voice = createVoiceService(deps, phone)
  return {
    repo,
    twilio,
    phone,
    voice,
    activity,
    tick: (ms: number) => (now += ms),
    spendRate: () => (rateLeft = 0),
  }
}

async function withNumber(env: ReturnType<typeof setup>) {
  return env.phone.buyNumber(ORG, 'Ranch', 'u1', { e164: '+18305550100', kind: 'local', hostId: SITE, label: 'Front desk' }, 1)
}

describe('phone service: numbers (AGL-4251)', () => {
  it('opens a subaccount once and buys a number with every webhook pointed at the console', async () => {
    const env = setup()
    const number = await withNumber(env)
    expect(env.twilio.called('createSubaccount')).toHaveLength(1)
    const [purchase] = env.twilio.called('purchaseNumber')
    expect(purchase.args[0]).toBe('AC_sub_1')
    expect((purchase.args[1] as { webhooks: Record<string, string> }).webhooks).toEqual({
      smsUrl: 'https://app.aglyn.io/api/phone/hooks/sms',
      smsStatusUrl: 'https://app.aglyn.io/api/phone/hooks/sms-status',
      voiceUrl: 'https://app.aglyn.io/api/phone/hooks/voice',
      voiceStatusUrl: 'https://app.aglyn.io/api/phone/hooks/voice-status',
    })
    expect(await env.repo.getNumberIndex('+18305550100')).toEqual({ orgId: ORG, numberId: number.id, subaccountSid: 'AC_sub_1' })
    await env.phone.searchNumbers(ORG, 'Ranch', 'u1', { kind: 'local', areaCode: '830' })
    expect(env.twilio.called('createSubaccount')).toHaveLength(1)
  })

  it('refuses a second number and a number with no add-on', async () => {
    const env = setup()
    await expect(
      env.phone.buyNumber(ORG, 'Ranch', 'u1', { e164: '+18305550100', kind: 'local', hostId: SITE, label: '' }, 0),
    ).rejects.toMatchObject({ reason: 'number-limit' })
    await withNumber(env)
    await expect(
      env.phone.buyNumber(ORG, 'Ranch', 'u1', { e164: '+18305550101', kind: 'local', hostId: SITE, label: '' }, 1),
    ).rejects.toBeInstanceOf(PhoneServiceError)
    expect(env.twilio.called('purchaseNumber')).toHaveLength(1)
  })

  it('releases a number at Twilio and forgets it for webhooks', async () => {
    const env = setup()
    const number = await withNumber(env)
    await env.phone.releaseNumber(ORG, number.id)
    expect(env.twilio.called('releaseNumber')[0].args).toEqual(['AC_sub_1', 'PN_1'])
    expect(await env.repo.getNumberIndex('+18305550100')).toBeNull()
    expect((await env.phone.status(ORG)).numbers).toEqual([])
  })
})

describe('phone service: texts (AGL-4251)', () => {
  it('files an inbound text on its thread once, counts it, and logs it on the CRM person', async () => {
    const env = setup()
    await withNumber(env)
    const params = { To: '+18305550100', From: '+18305550142', Body: 'Open today?', MessageSid: 'SM00000000000000000000000000000001', NumSegments: '1' }
    expect(await env.phone.receiveText(params)).toEqual({ filed: true })
    expect(await env.phone.receiveText(params)).toEqual({ filed: true })
    const [thread] = await env.phone.listThreads(ORG, {})
    expect(thread).toMatchObject({ theirs: '+18305550142', unread: 1, lastMessagePreview: 'Open today?', contact: { id: 'c1' } })
    expect(env.repo.usage[`${SITE}/phoneTexts/2026-11`]).toBe(1)
    expect(env.activity).toHaveLength(1)
    expect(env.activity[0]).toMatchObject({ kind: 'text', direction: 'inbound', dedupeKey: 'phone-text:SM00000000000000000000000000000001' })
    const read = await env.phone.readThread(ORG, thread.id, { markRead: true })
    expect(read.messages).toHaveLength(1)
    expect(read.thread.unread).toBe(0)
  })

  it('ignores a text to a number nobody holds', async () => {
    const env = setup()
    expect(await env.phone.receiveText({ To: '+18305559999', From: '+18305550142', Body: 'hi' })).toMatchObject({ filed: false })
  })

  it('answers from the business number with a status callback naming the message', async () => {
    const env = setup()
    await withNumber(env)
    const { thread, message } = await env.phone.sendText(ORG, { to: '830-555-0142', body: 'Yes, 9 to 5.' }, { uid: 'u1', name: 'Sam' })
    const [send] = env.twilio.called('sendMessage')
    expect(send.args[1]).toMatchObject({ from: '+18305550100', to: '+18305550142', body: 'Yes, 9 to 5.' })
    expect((send.args[1] as { statusCallback: string }).statusCallback).toBe(
      `https://app.aglyn.io/api/phone/hooks/sms-status?org=${ORG}&thread=${thread.id}&message=${message.id}`,
    )
    await env.phone.messageStatus({ org: ORG, thread: thread.id, message: message.id }, { MessageStatus: 'delivered' })
    await env.phone.messageStatus({ org: ORG, thread: thread.id, message: message.id }, { MessageStatus: 'sent' })
    expect((await env.repo.getMessage(ORG, thread.id, message.id))?.status).toBe('delivered')
    expect(env.activity[0]).toMatchObject({ direction: 'outbound', byUid: 'u1' })
  })

  it('stops texting a person who texted STOP until they text START', async () => {
    const env = setup()
    await withNumber(env)
    await env.phone.receiveText({ To: '+18305550100', From: '+18305550142', Body: 'STOP', MessageSid: 'SM00000000000000000000000000000002' })
    const [thread] = await env.phone.listThreads(ORG, {})
    await expect(env.phone.sendText(ORG, { threadId: thread.id, body: 'hi' }, { uid: 'u1', name: null })).rejects.toMatchObject({
      reason: 'opted-out',
    })
    await env.phone.receiveText({ To: '+18305550100', From: '+18305550142', Body: 'start', MessageSid: 'SM00000000000000000000000000000003' })
    await expect(env.phone.sendText(ORG, { threadId: thread.id, body: 'hi' }, { uid: 'u1', name: null })).resolves.toBeTruthy()
  })

  it('refuses past the hourly ceiling, before Twilio is called', async () => {
    const env = setup()
    await withNumber(env)
    env.spendRate()
    await expect(env.phone.sendText(ORG, { to: '+18305550142', body: 'hi' }, { uid: 'u1', name: null })).rejects.toMatchObject({
      reason: 'rate-limited',
    })
    expect(env.twilio.called('sendMessage')).toHaveLength(0)
  })
})

const FORM: PhoneComplianceForm = {
  kind: 'a2p10dlc',
  legalBusinessName: 'Ranch LLC',
  ein: '12-3456789',
  businessType: 'llc',
  website: 'https://example.com',
  street: '1 Main',
  city: 'Town',
  region: 'TX',
  postalCode: '78000',
  country: 'US',
  contactFirstName: 'A',
  contactLastName: 'B',
  contactEmail: 'a@example.com',
  contactPhone: '+18305550142',
  useCaseDescription: 'Answering customers',
  sampleMessages: ['We are open 9 to 5.', 'Your booking is confirmed.'],
  optInDescription: 'Customers text us first.',
  monthlyVolume: 500,
}

describe('phone service: texting registration (AGL-4251)', () => {
  it('saves a draft without calling Twilio, refuses an incomplete submit', async () => {
    const env = setup()
    await withNumber(env)
    await env.phone.saveCompliance(ORG, { ...FORM, ein: '' }, { submit: false, notificationEmail: 'a@example.com' })
    expect(env.twilio.called('submitA2pBrand')).toHaveLength(0)
    await expect(
      env.phone.saveCompliance(ORG, { ...FORM, ein: '' }, { submit: true, notificationEmail: 'a@example.com' }),
    ).rejects.toMatchObject({ reason: 'incomplete' })
  })

  it('registers a brand, then creates the campaign once the brand is approved', async () => {
    const env = setup()
    await withNumber(env)
    const submitted = await env.phone.saveCompliance(ORG, FORM, { submit: true, notificationEmail: 'a@example.com' })
    expect(submitted).toMatchObject({ status: 'submitted', brandSid: 'BN_1' })
    await expect(env.phone.saveCompliance(ORG, FORM, { submit: true, notificationEmail: 'a@example.com' })).rejects.toMatchObject({
      reason: 'already-submitted',
    })
    const refreshed = await env.phone.refreshCompliance(ORG)
    expect(refreshed).toMatchObject({ status: 'in-review', campaignSid: 'QE_1' })
    expect((env.twilio.called('createA2pCampaign')[0].args[1] as { numberSid: string }).numberSid).toBe('PN_1')
  })

  it('sends a sole proprietor to toll-free', async () => {
    const env = setup()
    await withNumber(env)
    await expect(
      env.phone.saveCompliance(ORG, { ...FORM, businessType: 'sole-proprietor', ein: '' }, { submit: true, notificationEmail: '' }),
    ).rejects.toMatchObject({ reason: 'sole-proprietor' })
  })
})

describe('voice service (AGL-4251)', () => {
  it('rings the cells during hours and takes a message when nobody answers', async () => {
    const env = setup()
    const number = await withNumber(env)
    await env.phone.saveSettings(ORG, { ...(await env.phone.settings(ORG)), forwardTo: ['+15125550000'] })
    const twiml = await env.voice.inbound({ To: number.e164, From: '+18305550142', CallSid: 'CA1' })
    expect(twiml).toContain('<Number>+15125550000</Number>')
    expect(twiml).toContain('hooks/voice-dial?org=org1&amp;call=CA1')
    const unanswered = await env.voice.dialEnded({ org: ORG, call: 'CA1' }, { DialCallStatus: 'no-answer' })
    expect(unanswered).toContain('<Record')
    expect(unanswered).toContain('transcribeCallback=')
    await env.voice.voicemailLeft({ org: ORG, call: 'CA1' }, { RecordingSid: 'RE1', RecordingDuration: '12' })
    await env.voice.transcription({ org: ORG, call: 'CA1' }, { TranscriptionStatus: 'completed', TranscriptionText: 'Call me back' })
    await env.voice.statusChanged({}, { CallSid: 'CA1', To: number.e164, From: '+18305550142', CallStatus: 'completed', CallDuration: '40' })
    const [call] = await env.voice.listCalls(ORG)
    expect(call).toMatchObject({ status: 'voicemail', durationSec: 40, voicemail: { transcript: 'Call me back' }, contact: { id: 'c1' } })
    expect(env.repo.usage[`${SITE}/phoneMinutes/2026-11`]).toBe(1)
  })

  it('sends every call to voicemail outside hours', async () => {
    const env = setup()
    const number = await withNumber(env)
    const settings = await env.phone.settings(ORG)
    await env.phone.saveSettings(ORG, {
      ...settings,
      forwardTo: ['+15125550000'],
      hours: [{ day: 1, openMinute: 540, closeMinute: 600 }],
    })
    const twiml = await env.voice.inbound({ To: number.e164, From: '+18305550142', CallSid: 'CA2' })
    expect(twiml).not.toContain('<Dial')
    expect(twiml).toContain(settings.closedGreeting)
  })

  it('texts a missed caller back when the workspace wrote a missed-call text', async () => {
    const env = setup()
    const number = await withNumber(env)
    await env.phone.saveSettings(ORG, { ...(await env.phone.settings(ORG)), missedCallText: 'Sorry we missed you!' })
    await env.voice.inbound({ To: number.e164, From: '+18305550142', CallSid: 'CA3' })
    await env.voice.statusChanged({}, { CallSid: 'CA3', To: number.e164, From: '+18305550142', CallStatus: 'completed', CallDuration: '5' })
    expect(env.twilio.called('sendMessage')[0].args[1]).toMatchObject({ to: '+18305550142', body: 'Sorry we missed you!' })
  })

  it('places a call by ringing the member first, then bridging from the business number', async () => {
    const env = setup()
    const number = await withNumber(env)
    const call = await env.voice.placeCall(ORG, { to: '830 555 0142', memberCell: '512 555 0000' }, { uid: 'u1' })
    const [created] = env.twilio.called('createCall')
    expect(created.args[1]).toMatchObject({ from: number.e164, to: '+15125550000' })
    const bridge = await env.voice.outboundBridge({ org: ORG, call: call.id })
    expect(bridge).toContain(`callerId="${number.e164}"`)
    expect(bridge).toContain('<Number>+18305550142</Number>')
    expect((await env.phone.settings(ORG)).memberCells).toEqual({ u1: '+15125550000' })
  })
})
