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

/*==========================================
 * BOUNCES (AGL-2979).
 *
 * A mail server that cannot deliver says so in a DELIVERY STATUS
 * NOTIFICATION (RFC 3464): a `multipart/report; report-type=delivery-status`
 * message, usually from `mailer-daemon@` or `postmaster@`, whose
 * `message/delivery-status` part carries one block per recipient —
 * `Final-Recipient`, `Action` and `Status`, an enhanced code like `5.1.1`.
 * Gmail writes one into the sender's own thread when a message it relayed is
 * refused, and a receiving server that accepted a message and then gave up
 * sends one of its own.
 *
 * ## Hard and soft
 *
 * A `5.x.x` status on a `failed` action is HARD: the address does not
 * exist, the domain refuses the sender, the mailbox is closed — trying again
 * will not help, and the enrollment stops. A `4.x.x` status, or a `delayed`
 * action, is SOFT: the server is busy or the mailbox is full, the sending
 * server is still retrying, and nothing changes. A report whose action is
 * `delivered`, `relayed` or `expanded` is not a bounce at all.
 *
 * ## Reports that are not standard
 *
 * Some servers send a bounce as plain prose. A message from a mailer daemon
 * whose subject or text reads like one is read for the status code the prose
 * quotes (`550 5.1.1`, `421 4.7.0`), and failing that for the words that say
 * permanent or temporary — soft when it says it will retry, hard otherwise.
 *==========================================*/

import { emailAddressOf } from '@aglyn/aglyn/app-utils/crm-inbound'
import { outreachHeader, type OutreachThreadMessage } from './thread-message'

export type OutreachBounceKind = 'hard' | 'soft'

/** What a delivery report says about one recipient. */
export interface OutreachDeliveryRecipient {
  /** `Final-Recipient`, or `Original-Recipient` when that is all there is; normalized. */
  address: string | null
  /** `Action`, lowercased: `failed`, `delayed`, `delivered`, `relayed`, `expanded`. */
  action: string | null
  /** `Status`: the enhanced code, `5.1.1`. */
  status: string | null
  /** `Diagnostic-Code`, without its type prefix. */
  diagnostic: string | null
  /** `hard`, `soft`, or `null` for a block that reports no failure. */
  kind: OutreachBounceKind | null
}

export interface OutreachDeliveryReport {
  /** The worst failure the report carries, or `null` when it reports none. */
  kind: OutreachBounceKind | null
  /** Every recipient the report names, in order. */
  recipients: OutreachDeliveryRecipient[]
  /**
   * The addresses `kind` is about, normalized — `X-Failed-Recipients` when no
   * block names one. Empty when nothing says which recipient failed.
   */
  failedAddresses: string[]
  /** The status code of the worst failure, when one was found. */
  status: string | null
  /** The diagnostic of the worst failure, when one was given. */
  diagnostic: string | null
}

const DAEMON_LOCAL_PART = /^(mailer-daemon|postmaster|mail-daemon|maildaemon)$/i
const DAEMON_NAME = /\bmail delivery (subsystem|system|service)\b/i
const BOUNCE_WORDS =
  /undeliver|delivery status notification|delivery (has )?failed|delivery failure|failure notice|returned mail|mail delivery failed|could not be delivered|wasn't delivered|was not delivered|not delivered|address not found|message blocked/i

/** Whether a message comes from a mail system rather than from a person. */
export function isMailerDaemonMessage(message: Pick<OutreachThreadMessage, 'from'>): boolean {
  const raw = String(message?.from ?? '')
  const address = emailAddressOf(raw)
  const local = address ? address.slice(0, address.lastIndexOf('@')) : ''
  return DAEMON_LOCAL_PART.test(local) || DAEMON_NAME.test(raw)
}

function isDeliveryStatusReport(message: OutreachThreadMessage): boolean {
  const contentType = outreachHeader(message, 'Content-Type').toLowerCase()
  if (
    contentType.includes('multipart/report') &&
    /report-type\s*=\s*"?delivery-status"?/.test(contentType)
  ) {
    return true
  }
  return (message.parts ?? []).some(
    (part) =>
      part.mimeType === 'message/delivery-status' ||
      part.mimeType === 'message/global-delivery-status',
  )
}

/** `Name: value` fields, continuation lines folded in, one list per blank-line block. */
function fieldBlocks(text: string): Array<Record<string, string>> {
  const blocks: Array<Record<string, string>> = []
  let current: Record<string, string> = {}
  let last: string | null = null
  const close = () => {
    if (Object.keys(current).length) blocks.push(current)
    current = {}
    last = null
  }
  for (const line of text.replace(/\r\n?/g, '\n').split('\n')) {
    if (!line.trim()) {
      close()
      continue
    }
    if (/^[ \t]/.test(line) && last) {
      current[last] = `${current[last]} ${line.trim()}`
      continue
    }
    const field = /^([A-Za-z][A-Za-z0-9-]*)\s*:\s*(.*)$/.exec(line)
    if (field) {
      last = field[1].toLowerCase()
      if (!(last in current)) current[last] = field[2].trim()
    }
  }
  close()
  return blocks
}

/** `rfc822; someone@example.com` → the address. */
function typedAddress(value: string | undefined): string | null {
  if (!value) return null
  const typed = /^[a-z0-9-]+\s*;\s*(.*)$/i.exec(value)
  return emailAddressOf(typed ? typed[1] : value)
}

/** An enhanced status code, any class: what a `Status` field holds. */
const STATUS_CODE = /\b([245])\.(\d{1,3})\.(\d{1,3})\b/
/** A failure's enhanced status code, quoted somewhere in prose. */
const FAILURE_STATUS_CODE = /\b([45])\.(\d{1,3})\.(\d{1,3})\b/
/** A failure's basic SMTP reply code, as a transcript quotes it: `550-` or `421 `. */
const FAILURE_REPLY_CODE = /\b([45])[0-5]\d(?=[ -])/

function kindFor(action: string | null, status: string | null): OutreachBounceKind | null {
  if (action === 'delivered' || action === 'relayed' || action === 'expanded') return null
  const statusClass = status ? status.charAt(0) : null
  if (statusClass === '4' || action === 'delayed') return 'soft'
  if (statusClass === '5') return action === null || action === 'failed' ? 'hard' : 'soft'
  if (action === 'failed') return 'hard'
  return null
}

const SEVERITY: Record<OutreachBounceKind, number> = { soft: 1, hard: 2 }

function failedRecipientsHeader(message: OutreachThreadMessage): string[] {
  return outreachHeader(message, 'X-Failed-Recipients')
    .split(/[,\s]+/)
    .map((value) => emailAddressOf(value))
    .filter((value): value is string => value !== null)
}

function prose(message: OutreachThreadMessage): string {
  return [message.subject, message.textBody, message.snippet]
    .filter((value) => typeof value === 'string' && value)
    .join('\n')
}

/**
 * What a delivery report says, or `null` when the message is not one — see
 * the module note for how a standard report and a prose bounce are read.
 */
export function readOutreachDeliveryReport(
  message: OutreachThreadMessage,
): OutreachDeliveryReport | null {
  const standard = isDeliveryStatusReport(message)
  const daemon = isMailerDaemonMessage(message)
  if (!standard && !(daemon && BOUNCE_WORDS.test(prose(message)))) return null

  const statusText = (message.parts ?? [])
    .filter(
      (part) =>
        part.mimeType === 'message/delivery-status' ||
        part.mimeType === 'message/global-delivery-status',
    )
    .map((part) => part.text ?? '')
    .join('\n\n')
  // The first block describes the report itself (`Reporting-MTA`,
  // `Arrival-Date`); each later one describes a recipient.
  const recipients: OutreachDeliveryRecipient[] = fieldBlocks(statusText)
    .filter(
      (block) =>
        block['final-recipient'] || block['original-recipient'] || block['action'] || block['status'],
    )
    .map((block) => {
      const action = block['action'] ? block['action'].toLowerCase().split(/\s/)[0] : null
      const statusMatch = STATUS_CODE.exec(block['status'] ?? '')
      const status = statusMatch ? statusMatch[0] : null
      const diagnostic = block['diagnostic-code']
        ? block['diagnostic-code'].replace(/^[a-z0-9-]+\s*;\s*/i, '')
        : null
      return {
        address: typedAddress(block['final-recipient']) ?? typedAddress(block['original-recipient']),
        action,
        status,
        diagnostic,
        kind: kindFor(action, status),
      }
    })

  let worst: OutreachDeliveryRecipient | null = null
  for (const recipient of recipients) {
    if (recipient.kind && (!worst || SEVERITY[recipient.kind] > SEVERITY[worst.kind])) {
      worst = recipient
    }
  }

  if (!worst && !recipients.length) {
    // A report without readable blocks, or a bounce written as prose: the
    // code the text quotes, else the words.
    const text = prose(message)
    const code = FAILURE_STATUS_CODE.exec(text)
    const reply = FAILURE_REPLY_CODE.exec(text)
    const statusClass = code?.[1] ?? reply?.[1] ?? null
    const retrying =
      /\b(delay(ed)?|will (keep )?retry|not (been )?delivered yet|temporar(y|ily))\b/i.test(text)
    const kind: OutreachBounceKind =
      statusClass === '5' ? 'hard' : statusClass === '4' || retrying ? 'soft' : 'hard'
    return {
      kind,
      recipients: [],
      failedAddresses: failedRecipientsHeader(message),
      status: code ? code[0] : null,
      diagnostic: null,
    }
  }

  // Only the addresses the report's own kind is about: a report that
  // hard-bounced one recipient and delayed another does not bounce both.
  const failedAddresses = worst
    ? recipients
        .filter((recipient) => recipient.kind === worst.kind && recipient.address)
        .map((recipient) => recipient.address as string)
    : []
  return {
    kind: worst?.kind ?? null,
    recipients,
    failedAddresses:
      failedAddresses.length || !worst ? failedAddresses : failedRecipientsHeader(message),
    status: worst?.status ?? null,
    diagnostic: worst?.diagnostic ?? null,
  }
}
