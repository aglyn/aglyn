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
 * TwiML, the XML a Twilio webhook answers with (AGL-4251). A tiny builder:
 * the verbs Phone uses, every value escaped, nothing else.
 */

export type TwimlNode =
  | { verb: 'Say'; text: string }
  | { verb: 'Pause'; seconds: number }
  | { verb: 'Hangup' }
  | {
      verb: 'Dial'
      timeout: number
      action?: string
      callerId?: string
      numbers?: string[]
      clients?: string[]
    }
  | {
      verb: 'Record'
      action: string
      maxLength: number
      transcribeCallback?: string
      recordingStatusCallback?: string
    }

export function escapeXml(value: string): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;')
}

function attributes(values: Record<string, string | number | boolean | undefined>): string {
  return Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== '')
    .map(([key, value]) => ` ${key}="${escapeXml(String(value))}"`)
    .join('')
}

function render(node: TwimlNode): string {
  switch (node.verb) {
    case 'Say':
      return `<Say voice="Polly.Joanna">${escapeXml(node.text)}</Say>`
    case 'Pause':
      return `<Pause${attributes({ length: node.seconds })}/>`
    case 'Hangup':
      return '<Hangup/>'
    case 'Dial': {
      const nouns = [
        ...(node.clients ?? []).map((identity) => `<Client>${escapeXml(identity)}</Client>`),
        ...(node.numbers ?? []).map((number) => `<Number>${escapeXml(number)}</Number>`),
      ].join('')
      return `<Dial${attributes({ timeout: node.timeout, action: node.action, method: node.action ? 'POST' : undefined, callerId: node.callerId })}>${nouns}</Dial>`
    }
    case 'Record':
      return `<Record${attributes({
        action: node.action,
        method: 'POST',
        maxLength: node.maxLength,
        playBeep: true,
        transcribe: node.transcribeCallback ? true : undefined,
        transcribeCallback: node.transcribeCallback,
        recordingStatusCallback: node.recordingStatusCallback,
      })}/>`
  }
}

export function twiml(nodes: readonly TwimlNode[]): string {
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${nodes.map(render).join('')}</Response>`
}

/** What Twilio is answered with when there is nothing to do. */
export const EMPTY_TWIML = twiml([])

export function twimlResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'Content-Type': 'text/xml; charset=utf-8', 'Cache-Control': 'no-store' },
  })
}
