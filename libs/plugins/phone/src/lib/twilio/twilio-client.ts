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

import { createHmac, timingSafeEqual } from 'node:crypto'
import type { PhoneComplianceForm, PhoneNumberKind } from '../model/phone.types'

/**
 * Phone's Twilio client (AGL-4251): the REST APIs over `fetch`, no SDK, with
 * `fetch` injectable so every spec runs against a fake and nothing reaches
 * Twilio in development.
 *
 * The platform's own Twilio account (`TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`,
 * the same account the sms plugin sends order texts through) is the PARENT.
 * Each workspace gets a SUBACCOUNT, which isolates its numbers, its texting
 * registration and its spend. The parent's credentials act on a subaccount's
 * resources by naming the subaccount in the path, so no subaccount secret is
 * stored; the subaccount's own auth token, which signs its webhooks, is read
 * from the parent when a webhook needs checking.
 *
 * ⛔ EVERY CALL HERE COSTS MONEY OR REGISTERS SOMETHING. Development runs with
 * the env unset (the client reports itself unconfigured) or a fake `fetch`.
 */

export const TWILIO_PARENT_ENV = {
  accountSid: 'TWILIO_ACCOUNT_SID',
  authToken: 'TWILIO_AUTH_TOKEN',
} as const

const API = 'https://api.twilio.com/2010-04-01'
const MESSAGING = 'https://messaging.twilio.com/v1'
const TRUSTHUB = 'https://trusthub.twilio.com/v1'
const NUMBERS = 'https://numbers.twilio.com/v1'

/** TrustHub policies Twilio publishes for ISV secondary profiles. */
export const TWILIO_POLICIES = {
  secondaryCustomerProfile: 'RNdfbf3fae0e1107f8aded0e7cead80bf5',
  a2pTrustProduct: 'RNb0d4771c2c98518d916a3d4cd70a8f8b',
} as const

type FetchLike = typeof fetch

export class TwilioError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly code: number | null,
  ) {
    super(message)
    this.name = 'TwilioError'
  }
}

export interface TwilioAvailableNumber {
  e164: string
  friendlyName: string
  locality: string | null
  region: string | null
  capabilities: { sms: boolean; voice: boolean; mms: boolean }
}

export interface TwilioNumberWebhooks {
  smsUrl: string
  smsStatusUrl: string
  voiceUrl: string
  voiceStatusUrl: string
}

export interface TwilioPurchasedNumber {
  sid: string
  e164: string
}

export interface TwilioSentMessage {
  sid: string
  status: string
  segments: number
}

export interface TwilioCreatedCall {
  sid: string
  status: string
}

export interface TwilioPortInRequest {
  numbers: Array<{ e164: string; pin?: string | null }>
  accountHolderName: string
  accountNumber: string
  currentCarrier: string
  serviceAddress: { street: string; city: string; region: string; postalCode: string; country: string }
  notificationEmail: string
  targetDate?: string | null
}

export interface TwilioClient {
  isConfigured(): boolean
  createSubaccount(friendlyName: string): Promise<{ sid: string }>
  /** The subaccount's own auth token: what signs its webhooks. */
  subaccountAuthToken(subaccountSid: string): Promise<string>
  searchNumbers(
    subaccountSid: string,
    query: { kind: PhoneNumberKind; areaCode?: string | null; contains?: string | null; limit?: number },
  ): Promise<TwilioAvailableNumber[]>
  purchaseNumber(
    subaccountSid: string,
    input: { e164: string; friendlyName: string; webhooks: TwilioNumberWebhooks },
  ): Promise<TwilioPurchasedNumber>
  updateNumberWebhooks(subaccountSid: string, numberSid: string, webhooks: TwilioNumberWebhooks): Promise<void>
  releaseNumber(subaccountSid: string, numberSid: string): Promise<void>
  sendMessage(
    subaccountSid: string,
    input: { from: string; to: string; body: string; statusCallback: string },
  ): Promise<TwilioSentMessage>
  createCall(
    subaccountSid: string,
    input: { from: string; to: string; twimlUrl: string; statusCallback: string },
  ): Promise<TwilioCreatedCall>
  submitTollFreeVerification(
    subaccountSid: string,
    input: { numberSid: string; form: PhoneComplianceForm; notificationEmail: string },
  ): Promise<{ sid: string; status: string }>
  readTollFreeVerification(subaccountSid: string, sid: string): Promise<{ status: string; rejectionReason: string | null }>
  submitA2pBrand(
    subaccountSid: string,
    input: { form: PhoneComplianceForm; notificationEmail: string },
  ): Promise<{ brandSid: string; customerProfileSid: string; trustProductSid: string }>
  readA2pBrand(subaccountSid: string, brandSid: string): Promise<{ status: string; rejectionReason: string | null }>
  createA2pCampaign(
    subaccountSid: string,
    input: { brandSid: string; numberSid: string; form: PhoneComplianceForm; inboundUrl: string },
  ): Promise<{ campaignSid: string; messagingServiceSid: string }>
  requestPortIn(subaccountSid: string, input: TwilioPortInRequest): Promise<{ sid: string; status: string }>
  /** Closes a subaccount for good: Twilio releases its numbers. */
  closeSubaccount(subaccountSid: string): Promise<void>
}

function env(name: string): string {
  return String(process.env[name] ?? '').trim()
}

export function createTwilioClient(
  deps: { fetch?: FetchLike; accountSid?: string; authToken?: string } = {},
): TwilioClient {
  const doFetch: FetchLike = deps.fetch ?? ((input, init) => fetch(input, init))
  const parentSid = () => deps.accountSid ?? env(TWILIO_PARENT_ENV.accountSid)
  const parentToken = () => deps.authToken ?? env(TWILIO_PARENT_ENV.authToken)

  async function call(
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    form?: URLSearchParams | Record<string, string | number | boolean | string[] | undefined | null>,
    options: { json?: boolean; as?: string } = {},
  ): Promise<Record<string, unknown>> {
    const sid = parentSid()
    const token = parentToken()
    if (!sid || !token) throw new TwilioError('Twilio is not configured', 503, null)
    // The v1 APIs (messaging, TrustHub, numbers) name no account in the path:
    // they act on the account that authenticates, so a subaccount's request
    // authenticates as the subaccount, with the parent's token.
    const username = options.as || sid
    const headers: Record<string, string> = {
      Authorization: `Basic ${Buffer.from(`${username}:${token}`).toString('base64')}`,
    }
    let body: string | undefined
    if (form && method !== 'GET') {
      if (options.json) {
        headers['Content-Type'] = 'application/json'
        body = JSON.stringify(form)
      } else {
        headers['Content-Type'] = 'application/x-www-form-urlencoded'
        body = toForm(form).toString()
      }
    }
    const target = form && method === 'GET' ? `${url}?${toForm(form).toString()}` : url
    let response: Response
    try {
      response = await doFetch(target, { method, headers, ...(body !== undefined ? { body } : {}) })
    } catch (error) {
      throw new TwilioError(
        `Twilio unreachable: ${error instanceof Error ? error.message : String(error)}`,
        502,
        null,
      )
    }
    if (method === 'DELETE' && response.status === 204) return {}
    const payload = (await response.json().catch(() => ({}))) as Record<string, unknown>
    if (!response.ok) {
      const code = Number(payload['code'])
      throw new TwilioError(
        String(payload['message'] ?? `Twilio answered ${response.status}`),
        response.status,
        Number.isFinite(code) ? code : null,
      )
    }
    return payload
  }

  const account = (subaccountSid: string) => `${API}/Accounts/${encodeURIComponent(subaccountSid)}`

  /** A v1 call made as the subaccount (see `call`). */
  const callAs = (
    as: string,
    method: 'GET' | 'POST' | 'DELETE',
    url: string,
    form?: Parameters<typeof call>[2],
    options: { json?: boolean } = {},
  ) => call(method, url, form, { ...options, as })

  async function assign(subaccountSid: string, profileUrl: string, objectSid: string) {
    await callAs(subaccountSid, 'POST', `${profileUrl}/EntityAssignments`, { ObjectSid: objectSid })
  }

  return {
    isConfigured: () => Boolean(parentSid() && parentToken()),

    async createSubaccount(friendlyName) {
      const created = await call('POST', `${API}/Accounts.json`, { FriendlyName: friendlyName.slice(0, 64) })
      return { sid: String(created['sid'] ?? '') }
    },

    async subaccountAuthToken(subaccountSid) {
      const read = await call('GET', `${account(subaccountSid)}.json`)
      return String(read['auth_token'] ?? '')
    },

    async searchNumbers(subaccountSid, query) {
      const kind = query.kind === 'tollFree' ? 'TollFree' : 'Local'
      const params: Record<string, string> = {
        SmsEnabled: 'true',
        VoiceEnabled: 'true',
        PageSize: String(Math.min(30, Math.max(1, query.limit ?? 20))),
      }
      if (query.areaCode && /^\d{3}$/.test(query.areaCode)) params['AreaCode'] = query.areaCode
      if (query.contains && /^[0-9A-Za-z*]{2,10}$/.test(query.contains)) params['Contains'] = query.contains
      const read = await call('GET', `${account(subaccountSid)}/AvailablePhoneNumbers/US/${kind}.json`, params)
      const list = Array.isArray(read['available_phone_numbers']) ? read['available_phone_numbers'] : []
      return (list as Array<Record<string, unknown>>).map((one) => {
        const capabilities = (one['capabilities'] ?? {}) as Record<string, unknown>
        return {
          e164: String(one['phone_number'] ?? ''),
          friendlyName: String(one['friendly_name'] ?? one['phone_number'] ?? ''),
          locality: typeof one['locality'] === 'string' && one['locality'] ? one['locality'] : null,
          region: typeof one['region'] === 'string' && one['region'] ? one['region'] : null,
          capabilities: {
            sms: capabilities['SMS'] === true || capabilities['sms'] === true,
            voice: capabilities['voice'] === true,
            mms: capabilities['MMS'] === true || capabilities['mms'] === true,
          },
        }
      })
    },

    async purchaseNumber(subaccountSid, input) {
      const bought = await call('POST', `${account(subaccountSid)}/IncomingPhoneNumbers.json`, {
        PhoneNumber: input.e164,
        FriendlyName: input.friendlyName.slice(0, 64),
        ...webhookParams(input.webhooks),
      })
      return { sid: String(bought['sid'] ?? ''), e164: String(bought['phone_number'] ?? input.e164) }
    },

    async updateNumberWebhooks(subaccountSid, numberSid, webhooks) {
      await call(
        'POST',
        `${account(subaccountSid)}/IncomingPhoneNumbers/${encodeURIComponent(numberSid)}.json`,
        webhookParams(webhooks),
      )
    },

    async releaseNumber(subaccountSid, numberSid) {
      await call('DELETE', `${account(subaccountSid)}/IncomingPhoneNumbers/${encodeURIComponent(numberSid)}.json`)
    },

    async sendMessage(subaccountSid, input) {
      const sent = await call('POST', `${account(subaccountSid)}/Messages.json`, {
        From: input.from,
        To: input.to,
        Body: input.body,
        StatusCallback: input.statusCallback,
      })
      const segments = Number(sent['num_segments'])
      return {
        sid: String(sent['sid'] ?? ''),
        status: String(sent['status'] ?? 'queued'),
        segments: Number.isFinite(segments) && segments > 0 ? segments : 1,
      }
    },

    async createCall(subaccountSid, input) {
      const created = await call('POST', `${account(subaccountSid)}/Calls.json`, {
        From: input.from,
        To: input.to,
        Url: input.twimlUrl,
        StatusCallback: input.statusCallback,
        StatusCallbackEvent: ['initiated', 'ringing', 'answered', 'completed'],
      })
      return { sid: String(created['sid'] ?? ''), status: String(created['status'] ?? 'queued') }
    },

    async submitTollFreeVerification(subaccountSid, input) {
      const form = input.form
      const created = await callAs(subaccountSid, 'POST', `${MESSAGING}/Tollfree/Verifications`, {
        TollfreePhoneNumberSid: input.numberSid,
        BusinessName: form.legalBusinessName,
        BusinessWebsite: form.website,
        NotificationEmail: input.notificationEmail,
        UseCaseCategories: ['CUSTOMER_CARE', 'ACCOUNT_NOTIFICATIONS'],
        UseCaseSummary: form.useCaseDescription,
        ProductionMessageSample: form.sampleMessages.filter(Boolean).join('\n\n'),
        OptInType: 'VERBAL',
        OptInImageUrls: [form.website],
        AdditionalInformation: form.optInDescription,
        MessageVolume: volumeBand(form.monthlyVolume),
        BusinessStreetAddress: form.street,
        BusinessCity: form.city,
        BusinessStateProvinceRegion: form.region,
        BusinessPostalCode: form.postalCode,
        BusinessCountry: form.country || 'US',
        BusinessContactFirstName: form.contactFirstName,
        BusinessContactLastName: form.contactLastName,
        BusinessContactEmail: form.contactEmail,
        BusinessContactPhone: form.contactPhone,
      })
      return { sid: String(created['sid'] ?? ''), status: String(created['status'] ?? 'PENDING_REVIEW') }
    },

    async readTollFreeVerification(subaccountSid, sid) {
      const read = await callAs(subaccountSid, 'GET', `${MESSAGING}/Tollfree/Verifications/${encodeURIComponent(sid)}`)
      return {
        status: String(read['status'] ?? ''),
        rejectionReason: typeof read['rejection_reason'] === 'string' ? read['rejection_reason'] : null,
      }
    },

    async submitA2pBrand(subaccountSid, input) {
      const form = input.form
      // 1. The business's secondary customer profile, with its business
      //    details, its authorized representative and its address.
      const profile = await callAs(subaccountSid, 'POST', `${TRUSTHUB}/CustomerProfiles`, {
        FriendlyName: form.legalBusinessName.slice(0, 64),
        Email: input.notificationEmail,
        PolicySid: TWILIO_POLICIES.secondaryCustomerProfile,
      })
      const profileUrl = `${TRUSTHUB}/CustomerProfiles/${String(profile['sid'])}`
      const business = await callAs(subaccountSid, 'POST', `${TRUSTHUB}/EndUsers`, {
        FriendlyName: `${form.legalBusinessName} business`.slice(0, 64),
        Type: 'customer_profile_business_information',
        Attributes: JSON.stringify({
          business_name: form.legalBusinessName,
          business_identity: 'direct_customer',
          business_type: businessTypeLabel(form.businessType),
          business_industry: 'ENTERTAINMENT',
          business_registration_identifier: 'EIN',
          business_registration_number: form.ein.replace(/\D/g, ''),
          business_regions_of_operation: 'USA_AND_CANADA',
          website_url: form.website,
        }),
      })
      await assign(subaccountSid, profileUrl, String(business['sid']))
      const representative = await callAs(subaccountSid, 'POST', `${TRUSTHUB}/EndUsers`, {
        FriendlyName: `${form.contactFirstName} ${form.contactLastName}`.slice(0, 64),
        Type: 'authorized_representative_1',
        Attributes: JSON.stringify({
          first_name: form.contactFirstName,
          last_name: form.contactLastName,
          email: form.contactEmail,
          phone_number: form.contactPhone,
          business_title: 'Owner',
          job_position: 'Director',
        }),
      })
      await assign(subaccountSid, profileUrl, String(representative['sid']))
      const address = await call('POST', `${account(subaccountSid)}/Addresses.json`, {
        CustomerName: form.legalBusinessName,
        Street: form.street,
        City: form.city,
        Region: form.region,
        PostalCode: form.postalCode,
        IsoCountry: form.country || 'US',
      })
      const addressDocument = await callAs(subaccountSid, 'POST', `${TRUSTHUB}/SupportingDocuments`, {
        FriendlyName: `${form.legalBusinessName} address`.slice(0, 64),
        Type: 'customer_profile_address',
        Attributes: JSON.stringify({ address_sids: String(address['sid']) }),
      })
      await assign(subaccountSid, profileUrl, String(addressDocument['sid']))
      await callAs(subaccountSid, 'POST', profileUrl, { Status: 'pending-review' })
      // 2. The A2P trust product built on that profile.
      const product = await callAs(subaccountSid, 'POST', `${TRUSTHUB}/TrustProducts`, {
        FriendlyName: `${form.legalBusinessName} A2P`.slice(0, 64),
        Email: input.notificationEmail,
        PolicySid: TWILIO_POLICIES.a2pTrustProduct,
      })
      const productUrl = `${TRUSTHUB}/TrustProducts/${String(product['sid'])}`
      const messagingProfile = await callAs(subaccountSid, 'POST', `${TRUSTHUB}/EndUsers`, {
        FriendlyName: `${form.legalBusinessName} messaging`.slice(0, 64),
        Type: 'us_a2p_messaging_profile_information',
        Attributes: JSON.stringify({ company_type: form.businessType === 'nonprofit' ? 'non-profit' : 'private' }),
      })
      await assign(subaccountSid, productUrl, String(messagingProfile['sid']))
      await assign(subaccountSid, productUrl, String(profile['sid']))
      await callAs(subaccountSid, 'POST', productUrl, { Status: 'pending-review' })
      // 3. The brand.
      const brand = await callAs(subaccountSid, 'POST', `${MESSAGING}/a2p/BrandRegistrations`, {
        CustomerProfileBundleSid: String(profile['sid']),
        A2PProfileBundleSid: String(product['sid']),
      })
      return {
        brandSid: String(brand['sid'] ?? ''),
        customerProfileSid: String(profile['sid'] ?? ''),
        trustProductSid: String(product['sid'] ?? ''),
      }
    },

    async readA2pBrand(subaccountSid, brandSid) {
      const read = await callAs(subaccountSid, 'GET', `${MESSAGING}/a2p/BrandRegistrations/${encodeURIComponent(brandSid)}`)
      const failure = Array.isArray(read['errors']) ? (read['errors'] as Array<Record<string, unknown>>)[0] : null
      return {
        status: String(read['status'] ?? ''),
        rejectionReason:
          typeof read['failure_reason'] === 'string'
            ? read['failure_reason']
            : failure && typeof failure['description'] === 'string'
              ? failure['description']
              : null,
      }
    },

    async createA2pCampaign(subaccountSid, input) {
      const form = input.form
      const service = await callAs(subaccountSid, 'POST', `${MESSAGING}/Services`, {
        FriendlyName: `${form.legalBusinessName} texts`.slice(0, 64),
        InboundRequestUrl: input.inboundUrl,
        UseInboundWebhookOnNumber: 'true',
      })
      const serviceSid = String(service['sid'] ?? '')
      await callAs(subaccountSid, 'POST', `${MESSAGING}/Services/${encodeURIComponent(serviceSid)}/PhoneNumbers`, {
        PhoneNumberSid: input.numberSid,
      })
      const campaign = await callAs(subaccountSid, 'POST', `${MESSAGING}/Services/${encodeURIComponent(serviceSid)}/Compliance/Usa2p`, {
        BrandRegistrationSid: input.brandSid,
        Description: form.useCaseDescription,
        MessageFlow: form.optInDescription,
        MessageSamples: form.sampleMessages.filter(Boolean).slice(0, 5),
        UsAppToPersonUsecase: 'MIXED',
        HasEmbeddedLinks: 'true',
        HasEmbeddedPhone: 'true',
      })
      return { campaignSid: String(campaign['sid'] ?? ''), messagingServiceSid: serviceSid }
    },

    async closeSubaccount(subaccountSid) {
      await call('POST', `${account(subaccountSid)}.json`, { Status: 'closed' })
    },

    async requestPortIn(subaccountSid, input) {
      const created = await callAs(
        subaccountSid,
        'POST',
        `${NUMBERS}/Porting/PortIn`,
        {
          account_sid: subaccountSid,
          target_port_in_date: input.targetDate ?? undefined,
          notification_emails: [input.notificationEmail],
          losing_carrier_information: {
            customer_name: input.accountHolderName,
            account_number: input.accountNumber,
            account_telephone_number: input.numbers[0]?.e164,
            address_sid: undefined,
            customer_type: 'Business',
            authorized_representative: input.accountHolderName,
            authorized_representative_email: input.notificationEmail,
            address: {
              street: input.serviceAddress.street,
              city: input.serviceAddress.city,
              state: input.serviceAddress.region,
              zip: input.serviceAddress.postalCode,
              country: input.serviceAddress.country || 'US',
            },
          },
          phone_numbers: input.numbers.map((one) => ({ phone_number: one.e164, pin: one.pin ?? undefined })),
        } as unknown as Record<string, string>,
        { json: true },
      )
      return { sid: String(created['port_in_request_sid'] ?? created['sid'] ?? ''), status: String(created['port_in_request_status'] ?? created['status'] ?? 'submitted') }
    },
  }
}

function webhookParams(webhooks: TwilioNumberWebhooks): Record<string, string> {
  return {
    SmsUrl: webhooks.smsUrl,
    SmsMethod: 'POST',
    StatusCallback: webhooks.voiceStatusUrl,
    StatusCallbackMethod: 'POST',
    VoiceUrl: webhooks.voiceUrl,
    VoiceMethod: 'POST',
  }
}

function toForm(
  form: URLSearchParams | Record<string, string | number | boolean | string[] | undefined | null>,
): URLSearchParams {
  if (form instanceof URLSearchParams) return form
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(form)) {
    if (value === undefined || value === null) continue
    if (Array.isArray(value)) for (const one of value) params.append(key, String(one))
    else params.set(key, String(value))
  }
  return params
}

function businessTypeLabel(type: PhoneComplianceForm['businessType']): string {
  switch (type) {
    case 'llc':
      return 'Limited Liability Corporation'
    case 'corporation':
      return 'Corporation'
    case 'partnership':
      return 'Partnership'
    case 'nonprofit':
      return 'Non-profit Corporation'
    default:
      return 'Sole Proprietorship'
  }
}

/** Twilio's toll-free volume bands. */
function volumeBand(monthly: number): string {
  const bands = [10, 100, 1000, 10000, 100000, 250000, 500000, 750000, 1000000]
  const value = Number.isFinite(monthly) && monthly > 0 ? monthly : 1000
  return String(bands.find((band) => value <= band) ?? 1000000)
}

/**
 * Verifies `X-Twilio-Signature`: base64 HMAC-SHA1, keyed by the auth token of
 * the account that owns the number, over the full URL followed by every POST
 * parameter's name and value sorted by name. Constant-time; false when any
 * part is missing, so an unconfigured install accepts nothing.
 */
export function verifyTwilioWebhookSignature(input: {
  url: string
  params: Record<string, string>
  signature: string
  authToken: string
}): boolean {
  if (!input.authToken || !input.signature || !input.url) return false
  const payload =
    input.url +
    Object.keys(input.params)
      .sort()
      .map((key) => `${key}${input.params[key]}`)
      .join('')
  const expected = createHmac('sha1', input.authToken).update(payload).digest('base64')
  const a = Buffer.from(input.signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length) return false
  return timingSafeEqual(new Uint8Array(a), new Uint8Array(b))
}

/** The signature Twilio would send — for specs and the local webhook replayer. */
export function signTwilioWebhook(url: string, params: Record<string, string>, authToken: string): string {
  const payload =
    url +
    Object.keys(params)
      .sort()
      .map((key) => `${key}${params[key]}`)
      .join('')
  return createHmac('sha1', authToken).update(payload).digest('base64')
}
