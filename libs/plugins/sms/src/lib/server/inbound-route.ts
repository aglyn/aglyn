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

import { verifyTwilioSignature } from '../twilio-provider'

/**
 * Inbound texts from Twilio (AGL-3610): the STOP / START half of the opt-out
 * the platform's phone suppression list already models
 * (`sms-keywords.ts` names this webhook as the piece it was waiting for).
 *
 * SIGNATURE FIRST. Anyone can POST a form here; only a request carrying a
 * valid `X-Twilio-Signature` for this URL and these parameters, under our
 * auth token, reaches the keyword parser. An unsigned STOP could otherwise
 * opt any number out of every text it is owed, and an unsigned START could
 * opt back in a person who asked never to be texted again.
 *
 * Twilio's Messaging Service answers STOP itself (Advanced Opt-Out) and
 * forwards the message here; this records it on OUR list too, so the
 * suppression holds across vendors and is checked before any send. The reply
 * is empty TwiML — Twilio has already sent the carrier-required confirmation.
 */
export interface SmsInboundDeps {
  applyKeyword: (input: {
    from: string
    body: string
  }) => Promise<{ verdict: string | null; applied: boolean }>
  verify?: typeof verifyTwilioSignature
}

const EMPTY_TWIML = '<?xml version="1.0" encoding="UTF-8"?><Response></Response>'

/** The URLs Twilio may have signed: as received, and as the public origin. */
function candidateUrls(request: Request): string[] {
  const received = new URL(request.url)
  const host =
    request.headers.get('x-forwarded-host') ?? request.headers.get('host') ?? ''
  const urls = [request.url]
  if (host) urls.push(`https://${host}${received.pathname}${received.search}`)
  return [...new Set(urls)]
}

export async function smsInboundRoute(
  request: Request,
  deps?: SmsInboundDeps,
): Promise<Response> {
  if (request.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }
  const verify = deps?.verify ?? verifyTwilioSignature
  const text = await request.text()
  const params = Object.fromEntries(new URLSearchParams(text).entries())
  const signature = request.headers.get('x-twilio-signature') ?? ''
  const signed = candidateUrls(request).some((url) =>
    verify({ url, params, signature }),
  )
  if (!signed) return new Response('Forbidden', { status: 403 })
  const from = String(params['From'] ?? '')
  const body = String(params['Body'] ?? '')
  if (from) {
    const applyKeyword =
      deps?.applyKeyword ??
      (async (input: { from: string; body: string }) =>
        (await import('../sms-platform.server')).applyInboundSmsKeyword(input))
    try {
      await applyKeyword({ from, body })
    } catch (error) {
      // Answered 500 so Twilio retries: a dropped STOP is a person we go on
      // texting.
      console.error('[sms] inbound keyword failed', error)
      return new Response('Not recorded', { status: 500 })
    }
  }
  return new Response(EMPTY_TWIML, {
    status: 200,
    headers: { 'Content-Type': 'text/xml' },
  })
}
