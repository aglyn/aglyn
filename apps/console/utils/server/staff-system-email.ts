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

import {
  getSystemEmailTemplate,
  type SystemEmailTemplateDefinition,
} from '@aglyn/shared-util-email'
import type { AuthActionKind } from '../../app/api/_lib/auth-action-url'

/**
 * WHAT STAFF MAY SEND ONE ACCOUNT BY HAND (AGL-3691).
 *
 * The staff page sends any system email in the catalog to the account it
 * shows, plus a written follow-up. Before this, the only way to resend a
 * stranded sign-up its verification link was a script run from a laptop.
 *
 * The rules that decide what can be sent live here, apart from the route, so
 * that the route spec and the page agree on them.
 */

/**
 * Catalog entries addressed to the platform's own people, never a customer.
 * Sending one to an account would hand a stranger an internal alert's
 * wording and, worse, its links.
 */
export const STAFF_AUDIENCE_SYSTEM_EMAILS: ReadonlySet<string> = new Set([
  'staff-alert',
  'operator-alert',
  'operator-alert-digest',
  'erasure-hold-alert',
  'support-ticket-alert',
])

/** The written follow-up's catalog key. */
export const STAFF_FOLLOW_UP_EMAIL = 'staff-follow-up'

/**
 * Emails whose point is a one-time action link. The link is minted on the
 * server at SEND time, never at preview: a preview shows a placeholder, so
 * opening the drawer neither spends Identity Platform's throttle nor shows a
 * staffer a live credential for somebody else's account.
 */
export const ACTION_LINK_SYSTEM_EMAILS: Readonly<
  Record<string, { kind: AuthActionKind; token: string }>
> = {
  'email-verification': { kind: 'verifyEmail', token: 'verifyUrl' },
  'password-reset': { kind: 'resetPassword', token: 'resetUrl' },
  'admin-password-reset': { kind: 'resetPassword', token: 'resetUrl' },
  'retention-verify-reminder': { kind: 'verifyEmail', token: 'verifyUrl' },
}

/** Emails that only mean something to an account that has not verified. */
const VERIFICATION_ONLY_SYSTEM_EMAILS: ReadonlySet<string> = new Set([
  'email-verification',
  'retention-verify-reminder',
])

/** Stands in for an action link in a preview. */
export const ACTION_LINK_PREVIEW_PLACEHOLDER =
  'https://link-minted-when-you-send.invalid/'

/** Per target, per hour: enough to fix a mistake, too few to be a mailbomb. */
export const STAFF_SYSTEM_EMAIL_LIMIT = 5
export const STAFF_SYSTEM_EMAIL_WINDOW_MS = 60 * 60 * 1000

/** Longest subject and body a written follow-up may carry. */
export const FOLLOW_UP_SUBJECT_MAX = 200
export const FOLLOW_UP_BODY_MAX = 5_000

/**
 * The definition staff may send, or null. Unknown keys, Stripe-delivered
 * entries (Stripe composes those and nothing here can render them) and the
 * staff-audience alerts are all refused.
 */
export function staffSendableSystemEmail(
  key: unknown,
): SystemEmailTemplateDefinition | null {
  const definition = getSystemEmailTemplate(String(key ?? ''))
  if (!definition) return null
  if (definition.deliveredBy !== 'resend') return null
  if (STAFF_AUDIENCE_SYSTEM_EMAILS.has(definition.key)) return null
  return definition
}

/** True when sending this email to a VERIFIED account would be a no-op. */
export function requiresUnverifiedAccount(key: string): boolean {
  return VERIFICATION_ONLY_SYSTEM_EMAILS.has(key)
}

/** What the server knows about the target, for filling merge tokens. */
export interface StaffSendTarget {
  email: string
  displayName?: string | null
  firstName?: string | null
  org?: { name?: string | null; slug?: string | null } | null
}

/** The console origin links are built against, without a trailing slash. */
export function consoleOriginForEmail(): string {
  return (
    (process.env.NEXT_PUBLIC_CONSOLE_URL ?? '').trim().replace(/\/+$/, '') ||
    'https://app.aglyn.com'
  )
}

/** First name to greet with: the profile's, else the display name's first word. */
export function greetingName(target: StaffSendTarget): string {
  const first = String(target.firstName ?? '').trim()
  if (first) return first
  const display = String(target.displayName ?? '').trim().split(/\s+/)[0] ?? ''
  return display || 'there'
}

/**
 * The merge values the server can fill for an account on its own. Only the
 * tokens the email declares are returned, so the drawer shows a field per
 * token with what will be sent already in it.
 */
export function autoMergeValues(
  definition: SystemEmailTemplateDefinition,
  target: StaffSendTarget,
  origin: string = consoleOriginForEmail(),
): Record<string, string> {
  const orgName = String(target.org?.name ?? '').trim()
  const slug = String(target.org?.slug ?? '').trim()
  const known: Record<string, string> = {
    name: greetingName(target),
    'user.email': target.email,
    'org.name': orgName,
    consoleUrl: slug ? `${origin}/${slug}` : origin,
    // The getting-started emails' button (AGL-3692): the workspace, which
    // offers its site and the AI start. Staff can point it anywhere.
    ctaUrl: slug ? `${origin}/${slug}` : `${origin}/signin`,
    signInUrl: `${origin}/signin`,
    billingUrl: slug ? `${origin}/${slug}/billing` : '',
    settingsUrl: `${origin}/manage/notifications/settings`,
    preferencesUrl: `${origin}/manage/user/emails`,
  }
  const action = ACTION_LINK_SYSTEM_EMAILS[definition.key]
  if (action) known[action.token] = ACTION_LINK_PREVIEW_PLACEHOLDER
  const values: Record<string, string> = {}
  for (const token of definition.mergeTokens) {
    if (token.name.startsWith('brand.')) continue
    if (token.name in known) values[token.name] = known[token.name] ?? ''
  }
  return values
}

/**
 * Staff-typed values over the automatic ones, limited to the tokens the
 * email declares. The action link is never taken from the caller: it is the
 * server's to mint, and a typed one would let a staffer send a link to
 * anywhere wearing a password-reset email's words.
 */
export function mergeStaffValues(
  definition: SystemEmailTemplateDefinition,
  automatic: Record<string, string>,
  typed: unknown,
): Record<string, string> {
  const declared = new Set(definition.mergeTokens.map((token) => token.name))
  const action = ACTION_LINK_SYSTEM_EMAILS[definition.key]
  const merged = { ...automatic }
  if (typed && typeof typed === 'object') {
    for (const [name, value] of Object.entries(typed as Record<string, unknown>)) {
      if (!declared.has(name) || name.startsWith('brand.')) continue
      if (action && name === action.token) continue
      merged[name] = String(value ?? '').slice(0, FOLLOW_UP_BODY_MAX)
    }
  }
  return merged
}

/** Why a written follow-up cannot go out, or null when it can. */
export function followUpProblem(values: Record<string, string>): string | null {
  const subject = String(values['message.subject'] ?? '').trim()
  const body = String(values['message.body'] ?? '').trim()
  if (!subject) return 'A follow-up needs a subject.'
  if (!body) return 'A follow-up needs a message.'
  if (subject.length > FOLLOW_UP_SUBJECT_MAX) {
    return `Keep the subject under ${FOLLOW_UP_SUBJECT_MAX} characters.`
  }
  return null
}
