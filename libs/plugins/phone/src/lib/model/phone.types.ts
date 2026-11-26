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
 * Aglyn Phone's stored shapes (AGL-4251). Every document is written by the
 * plugin's server routes only; no client reads or writes them directly, so
 * the console and the apps reach them through `phone/*` routes.
 *
 * Paths (all under `orgs/{orgId}`, except the two indexes):
 *   phoneAccount/current            the workspace's Twilio subaccount
 *   phoneNumbers/{numberId}         a number the workspace holds
 *   phoneThreads/{threadId}         one conversation: our number × their number
 *   phoneThreads/{threadId}/messages/{messageId}
 *   phoneCalls/{callId}             one call, with its voicemail
 *   phoneSettings/current           hours, forwarding, voicemail greeting
 *   phoneCompliance/current         texting registration (A2P 10DLC / toll-free)
 *   phonePorts/{portId}             a request to move an existing number in
 *   phoneNumberIndex/{e164}         TOP-LEVEL, server-only: number → org, for webhooks
 *   phoneSubaccountIndex/{sid}      TOP-LEVEL, server-only: subaccount → org
 */

export const PHONE_COLLECTIONS = {
  account: 'phoneAccount',
  numbers: 'phoneNumbers',
  threads: 'phoneThreads',
  messages: 'messages',
  calls: 'phoneCalls',
  settings: 'phoneSettings',
  compliance: 'phoneCompliance',
  ports: 'phonePorts',
  numberIndex: 'phoneNumberIndex',
  subaccountIndex: 'phoneSubaccountIndex',
} as const

/** The singleton document id for account, settings and compliance. */
export const PHONE_SINGLETON_ID = 'current'

export type PhoneNumberKind = 'local' | 'tollFree'

/** The workspace's Twilio subaccount. Its auth token is never stored: the platform account reads it. */
export interface PhoneAccount {
  subaccountSid: string
  friendlyName: string
  createdAtMs: number
  createdByUid: string
}

export type PhoneNumberStatus = 'active' | 'porting' | 'released'

export interface PhoneNumberRecord {
  id: string
  /** E.164. */
  e164: string
  kind: PhoneNumberKind
  /** Twilio's IncomingPhoneNumber sid. */
  twilioSid: string
  status: PhoneNumberStatus
  /** The site the number answers for: its links, and the counters its use is kept on. */
  hostId: string
  /** What the team calls it in the inbox ("Front desk"). */
  label: string
  /** City and region Twilio reported, for a local number. */
  locality?: string | null
  region?: string | null
  createdAtMs: number
  createdByUid: string
  releasedAtMs?: number | null
}

/** Server-only index a webhook resolves its number through. */
export interface PhoneNumberIndexEntry {
  orgId: string
  numberId: string
  subaccountSid: string
}

export type PhoneDirection = 'inbound' | 'outbound'

export type PhoneMessageStatus =
  | 'queued'
  | 'sent'
  | 'delivered'
  | 'received'
  | 'undelivered'
  | 'failed'

export interface PhoneThread {
  id: string
  numberId: string
  /** Our number, E.164. */
  ours: string
  /** Theirs, E.164. */
  theirs: string
  /** The CRM record the number matched, when one did. */
  contact?: { kind: string; id: string; name: string | null } | null
  lastMessageAtMs: number
  lastMessagePreview: string
  lastDirection: PhoneDirection
  /** Inbound messages nobody has opened yet. */
  unread: number
  /** The person texted STOP: the composer is closed until they text START. */
  optedOut?: boolean
  archived?: boolean
}

export interface PhoneMessage {
  id: string
  threadId: string
  direction: PhoneDirection
  body: string
  /** Picture message links Twilio stored, inbound only. */
  mediaUrls?: string[]
  status: PhoneMessageStatus
  segments: number
  twilioSid: string | null
  atMs: number
  /** Who on the team sent it; absent for inbound and automatic replies. */
  byUid?: string | null
  byName?: string | null
  error?: string | null
}

export type PhoneCallStatus =
  | 'ringing'
  | 'in-progress'
  | 'completed'
  | 'missed'
  | 'voicemail'
  | 'busy'
  | 'failed'
  | 'no-answer'
  | 'canceled'

export interface PhoneCall {
  id: string
  numberId: string
  direction: PhoneDirection
  ours: string
  theirs: string
  twilioSid: string
  status: PhoneCallStatus
  startedAtMs: number
  endedAtMs?: number | null
  /** Billed duration in seconds, as Twilio reported it. */
  durationSec?: number | null
  /** Who answered or placed it: a member uid, or the forwarded number. */
  answeredBy?: string | null
  contact?: { kind: string; id: string; name: string | null } | null
  voicemail?: {
    recordingSid: string
    durationSec: number
    /** Plain text once Twilio's transcription arrives. */
    transcript?: string | null
    transcriptStatus?: 'pending' | 'completed' | 'failed'
  } | null
  /** Who on the team placed an outbound call. */
  byUid?: string | null
}

/** A weekday's open hours, minutes after local midnight. */
export interface PhoneOpenSpan {
  /** 0 = Sunday … 6 = Saturday. */
  day: number
  openMinute: number
  closeMinute: number
}

/**
 * Who rings during hours. Only `cells` is offered until the Aglyn apps can
 * ring (the calling SDK is the native slice still to build); `apps` and
 * `both` are kept for that slice, and the voice route treats them as `cells`
 * while no app is registered.
 */
export type PhoneRingTarget = 'apps' | 'cells' | 'both'

export interface PhoneSettings {
  /** IANA zone the hours are in. */
  timeZone: string
  /** Empty: always open. */
  hours: PhoneOpenSpan[]
  /** During hours, who rings. */
  ringDuringHours: PhoneRingTarget
  /** Cell phones a call forwards to, E.164. */
  forwardTo: string[]
  /** Seconds a call rings before voicemail. */
  ringSeconds: number
  /** What callers hear before the tone. Read by text to speech. */
  voicemailGreeting: string
  /** What callers hear outside hours, before the tone. */
  closedGreeting: string
  /** Whether a call is recorded for voicemail only (the default) — whole calls are never recorded. */
  voicemailTranscription: boolean
  /** A text sent back automatically to a missed caller, or empty for none. */
  missedCallText: string
  /** Saved replies the composer offers. `{siteLink}` and `{businessName}` fill in from the number's site. */
  templates: PhoneTemplate[]
  /**
   * Each member's own cell, E.164, by uid: what "Call" rings first before it
   * connects them to the customer from the business number.
   */
  memberCells?: Record<string, string>
  updatedAtMs: number
}

export interface PhoneTemplate {
  id: string
  label: string
  body: string
}

/** Texting registration a US number needs before carriers deliver its texts. */
export type PhoneComplianceKind = 'a2p10dlc' | 'tollFree'

export type PhoneComplianceStatus =
  | 'draft'
  | 'submitted'
  | 'in-review'
  | 'approved'
  | 'rejected'

export interface PhoneComplianceForm {
  kind: PhoneComplianceKind
  legalBusinessName: string
  /** EIN for a registered business; empty for a sole proprietor. */
  ein: string
  businessType: 'sole-proprietor' | 'llc' | 'corporation' | 'partnership' | 'nonprofit'
  website: string
  street: string
  city: string
  region: string
  postalCode: string
  country: string
  contactFirstName: string
  contactLastName: string
  contactEmail: string
  contactPhone: string
  /** What the texts are for, in the business's words. */
  useCaseDescription: string
  /** Two example texts. */
  sampleMessages: string[]
  /** How people agree to be texted. */
  optInDescription: string
  /** Expected texts a month, for toll-free verification. */
  monthlyVolume: number
}

export interface PhoneCompliance {
  form: PhoneComplianceForm
  status: PhoneComplianceStatus
  /** Twilio's ids for what was registered. */
  brandSid?: string | null
  campaignSid?: string | null
  tollFreeVerificationSid?: string | null
  rejectionReason?: string | null
  submittedAtMs?: number | null
  updatedAtMs: number
}

export type PhonePortStatus = 'submitted' | 'in-progress' | 'completed' | 'rejected' | 'canceled'

export interface PhonePortRequest {
  id: string
  /** The numbers to move in, E.164. */
  numbers: string[]
  /** As the current carrier's bill shows it. */
  accountHolderName: string
  currentCarrier: string
  accountNumber: string
  /** The carrier's transfer PIN, never stored: sent to Twilio once. */
  serviceAddress: { street: string; city: string; region: string; postalCode: string; country: string }
  hostId: string
  status: PhonePortStatus
  twilioPortInSid?: string | null
  targetDate?: string | null
  rejectionReason?: string | null
  createdAtMs: number
  createdByUid: string
}
