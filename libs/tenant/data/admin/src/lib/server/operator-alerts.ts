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

import { createHash, createHmac } from 'node:crypto'
import {
  effectiveOperatorAlertSetting,
  OPERATOR_ALERT_DEFAULT_NOTIFICATION_TYPE,
  OPERATOR_ALERT_TIER_LABELS,
  renderOperatorAlertTemplate,
  type AglynNotificationType,
  type OperatorAlertContext,
  type OperatorAlertDefinition,
  type OperatorAlertSettings,
  type OperatorAlertTypeSetting,
} from '@aglyn/aglyn/server'
import {
  getOperatorAlert,
  registerOperatorAlerts,
} from '@aglyn/aglyn/plugin-manager/operator-alerts'
import { isEmailConfigured, type SendEmailResult } from '@aglyn/shared-util-email'
import firebaseAdmin from './firebase-admin'

/**
 * RAISING AN OPERATOR ALERT (AGL-3377): the one server entry point every
 * alert in the registry goes through.
 *
 * In order, for one call:
 *
 * 1. The type is looked up in the registry (core's catalog plus what plugins
 *    registered). A plugin may pass its definition itself, which registers
 *    it in this process if its declarations have not loaded yet.
 * 2. A `dedupeKey` is claimed against `operatorAlertState`, so a condition
 *    that flaps inside the type's window is told once, and a type with
 *    `minOccurrences` fires only once it has recurred that often.
 * 3. The staff console notification is written for every staff member, as
 *    `notifyStaff` always has.
 * 4. Staff's switches (`platformSettings/operatorAlerts`, coded defaults
 *    until changed) decide the rest: off is console only, `digest` queues it
 *    for the once-a-day digest, `immediate` emails the operator now.
 * 5. The email is the `operator-alert` system email, to
 *    `resolveStaffAlertRecipients()`; the optional out-of-band webhook
 *    (`OPERATOR_ALERT_WEBHOOK_URL`) gets the same alert beside it, so a mail
 *    provider that is itself the outage still reaches somebody.
 *
 * Never throws: an alert is raised from inside the failure it reports, and a
 * second failure there must not replace the first.
 */

/** Where staff's per-type switches live. */
export const OPERATOR_ALERT_SETTINGS_COLLECTION = 'platformSettings'
export const OPERATOR_ALERT_SETTINGS_DOC = 'operatorAlerts'
/** One document per (type, dedupeKey): when it last fired, how often since. */
export const OPERATOR_ALERT_STATE_COLLECTION = 'operatorAlertState'
/** Alerts waiting for the daily digest. */
export const OPERATOR_ALERT_DIGEST_COLLECTION = 'operatorAlertDigest'

/** The hour, UTC, the digest goes out when staff have not chosen one. */
export const OPERATOR_ALERT_DIGEST_DEFAULT_HOUR_UTC = 14

export interface OperatorAlertSettingsDoc extends OperatorAlertSettings {
  /** The hour of the day, UTC, the digest is sent. */
  digestHourUtc?: number
  updatedAtMs?: number
  updatedByEmail?: string | null
}

export interface RaiseOperatorAlertOptions {
  /**
   * What makes two raises the SAME alert — a dispute id, an org and month, a
   * check id. Absent never dedupes: every raise is told.
   */
  dedupeKey?: string
  /** Values for the definition's `{{tokens}}`. Never personal data. */
  context?: OperatorAlertContext
  /** A console path or absolute URL; overrides the definition's link. */
  url?: string
  /** The title as written by the caller; overrides the rendered one. */
  subject?: string
  /** The body as written by the caller; overrides the rendered one. */
  body?: string
  orgId?: string
  hostId?: string
}

export type OperatorAlertOutcome =
  | 'deduped'
  | 'below-threshold'
  | 'console-only'
  | 'queued'
  | 'delivered'
  | 'undelivered'

export interface OperatorAlertResult {
  outcome: OperatorAlertOutcome
  type: string
  email?: SendEmailResult
  webhook?: OperatorAlertWebhookResult
}

export type OperatorAlertWebhookResult =
  | { posted: true; status: number }
  | { posted: false; reason: 'unconfigured' | 'refused' | 'network'; status?: number }

/** One alert, rendered, as it is delivered and queued. */
export interface RenderedOperatorAlert {
  type: string
  label: string
  tier: OperatorAlertDefinition['tier']
  category: OperatorAlertDefinition['category']
  title: string
  body: string
  /** Console path or absolute URL; `''` when there is none. */
  link: string
  notificationType: AglynNotificationType
  orgId?: string
  hostId?: string
}

const firestore = () => firebaseAdmin.app().firestore()

// ── Settings ────────────────────────────────────────────────────────────────

const SETTINGS_TTL_MS = 15_000
let settingsCache: { at: number; doc: OperatorAlertSettingsDoc } | undefined

/** Drop the in-process settings cache; the console calls it after a write. */
export function invalidateOperatorAlertSettingsCache(): void {
  settingsCache = undefined
}

/** Clamps a stored settings document to what the pipeline understands. */
export function normalizeOperatorAlertSettings(
  raw: unknown,
): OperatorAlertSettingsDoc {
  const source = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
  const types: Record<string, OperatorAlertTypeSetting> = {}
  const rawTypes = source['types']
  if (rawTypes && typeof rawTypes === 'object') {
    for (const [type, value] of Object.entries(rawTypes as Record<string, unknown>)) {
      if (!type || !value || typeof value !== 'object') continue
      const entry = value as Record<string, unknown>
      const setting: OperatorAlertTypeSetting = {}
      if (typeof entry['enabled'] === 'boolean') setting.enabled = entry['enabled']
      if (entry['delivery'] === 'immediate' || entry['delivery'] === 'digest') {
        setting.delivery = entry['delivery']
      }
      if (Object.keys(setting).length) types[type] = setting
    }
  }
  const hour = Number(source['digestHourUtc'])
  return {
    types,
    digestHourUtc:
      Number.isInteger(hour) && hour >= 0 && hour <= 23
        ? hour
        : OPERATOR_ALERT_DIGEST_DEFAULT_HOUR_UTC,
    ...(typeof source['updatedAtMs'] === 'number'
      ? { updatedAtMs: source['updatedAtMs'] as number }
      : {}),
    ...(typeof source['updatedByEmail'] === 'string'
      ? { updatedByEmail: source['updatedByEmail'] as string }
      : {}),
  }
}

/**
 * Staff's switches. An unreadable document is the coded defaults, uncached:
 * an alert must still go out when the settings cannot be read.
 */
export async function readOperatorAlertSettings(): Promise<OperatorAlertSettingsDoc> {
  const now = Date.now()
  if (settingsCache && now - settingsCache.at < SETTINGS_TTL_MS) return settingsCache.doc
  try {
    const snapshot = await firestore()
      .collection(OPERATOR_ALERT_SETTINGS_COLLECTION)
      .doc(OPERATOR_ALERT_SETTINGS_DOC)
      .get()
    const doc = normalizeOperatorAlertSettings(snapshot.exists ? snapshot.data() : null)
    settingsCache = { at: now, doc }
    return doc
  } catch (error) {
    console.error('[operator-alerts] settings unreadable; using the defaults', error)
    return normalizeOperatorAlertSettings(null)
  }
}

// ── Dedupe ──────────────────────────────────────────────────────────────────

/** Keys this instance fired, and until when they stay quiet. */
const firedLocally = new Map<string, number>()
const FIRED_LOCALLY_MAX = 500

function stateDocId(type: string, dedupeKey: string): string {
  return createHash('sha256').update(`${type}\u0000${dedupeKey}`).digest('hex').slice(0, 40)
}

export type OperatorAlertClaim =
  | { fire: true; repeats: number }
  | { fire: false; reason: 'deduped' | 'below-threshold' }

/**
 * Whether a raise with this key fires now. One transaction on the key's
 * state document: inside the window after a fire it is counted and
 * suppressed; before it reaches `minOccurrences` it is counted and held.
 * A store that cannot be read FIRES — a duplicate beats a silence.
 */
export async function claimOperatorAlert(
  definition: Pick<OperatorAlertDefinition, 'type' | 'dedupeWindowMinutes' | 'minOccurrences'>,
  dedupeKey: string,
  now = Date.now(),
): Promise<OperatorAlertClaim> {
  const windowMs = Math.max(0, definition.dedupeWindowMinutes) * 60_000
  const minOccurrences = Math.max(1, Math.floor(definition.minOccurrences ?? 1))
  if (!windowMs) return { fire: true, repeats: 0 }
  const localKey = `${definition.type}\u0000${dedupeKey}`
  const quietUntil = firedLocally.get(localKey)
  if (quietUntil && quietUntil > now) return { fire: false, reason: 'deduped' }
  try {
    const ref = firestore()
      .collection(OPERATOR_ALERT_STATE_COLLECTION)
      .doc(stateDocId(definition.type, dedupeKey))
    const claim = await firestore().runTransaction(async (transaction: any) => {
      const snapshot = await transaction.get(ref)
      const state = (snapshot.exists ? snapshot.data() : {}) as Record<string, unknown>
      const lastFiredAtMs = Number(state['lastFiredAtMs'] ?? 0)
      const base = { type: definition.type, dedupeKey: dedupeKey.slice(0, 300), updatedAtMs: now }
      if (lastFiredAtMs && now - lastFiredAtMs < windowMs) {
        transaction.set(ref, { ...base, suppressed: Number(state['suppressed'] ?? 0) + 1 }, { merge: true })
        return { fire: false, reason: 'deduped' } as const
      }
      const windowStartMs = Number(state['windowStartMs'] ?? 0)
      const inWindow = windowStartMs && now - windowStartMs < windowMs
      const occurrences = (inWindow ? Number(state['occurrences'] ?? 0) : 0) + 1
      if (occurrences < minOccurrences) {
        transaction.set(
          ref,
          { ...base, occurrences, windowStartMs: inWindow ? windowStartMs : now },
          { merge: true },
        )
        return { fire: false, reason: 'below-threshold' } as const
      }
      transaction.set(
        ref,
        {
          ...base,
          lastFiredAtMs: now,
          occurrences: 0,
          windowStartMs: 0,
          suppressed: 0,
          fired: Number(state['fired'] ?? 0) + 1,
        },
        { merge: true },
      )
      return { fire: true, repeats: Number(state['suppressed'] ?? 0) } as const
    })
    if (claim.fire) {
      if (firedLocally.size >= FIRED_LOCALLY_MAX) firedLocally.clear()
      firedLocally.set(localKey, now + windowMs)
    }
    return claim
  } catch (error) {
    console.error(`[operator-alerts] dedupe unavailable for ${definition.type}; firing`, error)
    return { fire: true, repeats: 0 }
  }
}

// ── Out-of-band webhook ─────────────────────────────────────────────────────

const WEBHOOK_TIMEOUT_MS = 5_000

/** The webhook URL, when one is configured and is http(s). */
export function operatorAlertWebhookUrl(): string {
  const value = String(process.env['OPERATOR_ALERT_WEBHOOK_URL'] ?? '').trim()
  return /^https?:\/\/\S+$/i.test(value) ? value : ''
}

/**
 * The JSON the webhook receives. `text` is what a Slack-compatible incoming
 * webhook renders on its own; `alert` carries the fields for anything that
 * wants to route on them.
 */
export function operatorAlertWebhookPayload(
  alerts: readonly RenderedOperatorAlert[],
  options: { digest?: boolean; now?: number } = {},
): Record<string, unknown> {
  const origin = consoleOrigin()
  const lines = alerts.map((alert) => {
    const link = operatorAlertAbsoluteLink(alert.link)
    return [
      `[${OPERATOR_ALERT_TIER_LABELS[alert.tier]}] ${alert.title}`,
      alert.body,
      link,
    ]
      .filter(Boolean)
      .join('\n')
  })
  const text = options.digest
    ? [`Operator digest: ${alerts.length} alert${alerts.length === 1 ? '' : 's'}`, ...lines].join('\n\n')
    : lines.join('\n\n')
  const occurredAt = new Date(options.now ?? Date.now()).toISOString()
  const shaped = alerts.map((alert) => ({
    type: alert.type,
    tier: alert.tier,
    category: alert.category,
    title: alert.title,
    body: alert.body,
    url: operatorAlertAbsoluteLink(alert.link) || null,
  }))
  return {
    text,
    ...(options.digest ? { digest: shaped } : { alert: shaped[0] ?? null }),
    occurredAt,
    ...(origin ? { install: origin } : {}),
  }
}

/**
 * Posts alerts to `OPERATOR_ALERT_WEBHOOK_URL`, signed when
 * `OPERATOR_ALERT_WEBHOOK_SECRET` is set: `x-operator-alert-timestamp` is the
 * Unix time and `x-operator-alert-signature` is `sha256=` plus the hex HMAC
 * of `{timestamp}.{body}`. Unset means email only. Never throws.
 */
export async function postOperatorAlertWebhook(
  alerts: readonly RenderedOperatorAlert[],
  options: { digest?: boolean; now?: number } = {},
): Promise<OperatorAlertWebhookResult> {
  const url = operatorAlertWebhookUrl()
  if (!url || !alerts.length) return { posted: false, reason: 'unconfigured' }
  const body = JSON.stringify(operatorAlertWebhookPayload(alerts, options))
  const headers: Record<string, string> = { 'content-type': 'application/json' }
  const secret = String(process.env['OPERATOR_ALERT_WEBHOOK_SECRET'] ?? '').trim()
  if (secret) {
    const timestamp = String(Math.floor((options.now ?? Date.now()) / 1000))
    headers['x-operator-alert-timestamp'] = timestamp
    headers['x-operator-alert-signature'] =
      'sha256=' + createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')
  }
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(WEBHOOK_TIMEOUT_MS),
    })
    if (response.ok) return { posted: true, status: response.status }
    console.error(`[operator-alerts] webhook answered ${response.status}`)
    return { posted: false, reason: 'refused', status: response.status }
  } catch (error) {
    console.error('[operator-alerts] webhook unreachable', error)
    return { posted: false, reason: 'network' }
  }
}

// ── Links ───────────────────────────────────────────────────────────────────

function consoleOrigin(): string {
  return String(process.env['NEXT_PUBLIC_CONSOLE_URL'] ?? '').trim().replace(/\/+$/, '')
}

/** A console path as an inbox or webhook can follow it, or `''`. */
export function operatorAlertAbsoluteLink(link: string | undefined | null): string {
  const value = String(link ?? '').trim()
  if (!value) return ''
  if (/^https?:\/\//i.test(value)) return value
  const origin = consoleOrigin()
  return origin && value.startsWith('/') ? `${origin}${value}` : ''
}

/**
 * The definition's link with its tokens filled, or `''` when a token it
 * needs is missing — `/admin/orgs/` would open the wrong page.
 */
function renderLink(template: string | undefined, context: OperatorAlertContext | undefined): string {
  if (!template) return ''
  const missing = [...template.matchAll(/\{\{\s*([\w.]+)\s*\}\}/g)].some(([, name]) => {
    const value = context?.[name as string]
    return value === null || value === undefined || value === ''
  })
  return missing ? '' : renderOperatorAlertTemplate(template, context)
}

// ── Rendering ───────────────────────────────────────────────────────────────

/** Stands in for a type nobody registered, so it is still told. */
function unregisteredDefinition(type: string): OperatorAlertDefinition {
  return {
    type,
    label: type,
    description: 'An alert type this install has no registry entry for.',
    tier: 'should',
    category: 'ops',
    title: '{{title}}',
    body: '{{body}}',
    delivery: 'immediate',
    dedupeWindowMinutes: 60,
    defaultEnabled: true,
  }
}

/** Resolves the definition a call names, registering a plugin's own. */
export function resolveOperatorAlertDefinition(
  type: string | OperatorAlertDefinition,
): OperatorAlertDefinition {
  if (typeof type !== 'string') {
    const known = getOperatorAlert(type.type)
    if (known) return known
    if (type.pluginId) {
      try {
        registerOperatorAlerts([type], { pluginId: type.pluginId })
      } catch (error) {
        console.error(`[operator-alerts] ${type.type} could not be registered`, error)
      }
    }
    return type
  }
  const known = getOperatorAlert(type)
  if (known) return known
  console.error(`[operator-alerts] "${type}" is not a registered alert type; telling it anyway`)
  return unregisteredDefinition(type)
}

export function renderOperatorAlert(
  definition: OperatorAlertDefinition,
  options: RaiseOperatorAlertOptions = {},
): RenderedOperatorAlert {
  const context: OperatorAlertContext = {
    ...(options.subject ? { title: options.subject } : {}),
    ...(options.body ? { body: options.body } : {}),
    ...(options.context ?? {}),
  }
  const title =
    String(options.subject ?? '').trim() ||
    renderOperatorAlertTemplate(definition.title, context) ||
    definition.label
  const body =
    String(options.body ?? '').trim() || renderOperatorAlertTemplate(definition.body, context)
  return {
    type: definition.type,
    label: definition.label,
    tier: definition.tier,
    category: definition.category,
    title,
    body,
    link: String(options.url ?? '').trim() || renderLink(definition.link, context),
    notificationType: definition.notificationType ?? OPERATOR_ALERT_DEFAULT_NOTIFICATION_TYPE,
    ...(options.orgId ? { orgId: options.orgId } : {}),
    ...(options.hostId ? { hostId: options.hostId } : {}),
  }
}

// ── The entry point ─────────────────────────────────────────────────────────

/** Whether an email to the operator can go at all on this install. */
async function operatorEmailReachable(): Promise<boolean> {
  if (!isEmailConfigured()) return false
  const { resolveStaffAlertRecipients } = await import('./staff-alert-email')
  return (await resolveStaffAlertRecipients()).length > 0
}

/** See the module comment. Never throws. */
export async function raiseOperatorAlert(
  type: string | OperatorAlertDefinition,
  options: RaiseOperatorAlertOptions = {},
): Promise<OperatorAlertResult> {
  const typeId = typeof type === 'string' ? type : type.type
  try {
    const definition = resolveOperatorAlertDefinition(type)
    const dedupeKey = String(options.dedupeKey ?? '').trim()
    let repeats = 0
    if (dedupeKey) {
      const claim = await claimOperatorAlert(definition, dedupeKey)
      if (claim.fire === false) return { outcome: claim.reason, type: typeId }
      repeats = claim.repeats
    }
    const alert = renderOperatorAlert(definition, options)
    if (repeats > 0) {
      alert.body = [alert.body, `Raised ${repeats} more time${repeats === 1 ? '' : 's'} since it was last told.`]
        .filter(Boolean)
        .join(' ')
    }
    const settings = await readOperatorAlertSettings()
    const { enabled, delivery } = effectiveOperatorAlertSetting(definition, settings)
    const emailNow = enabled && delivery === 'immediate' && (await operatorEmailReachable())

    const { notifyStaffConsole } = await import('./notifications')
    await notifyStaffConsole(
      {
        type: alert.notificationType,
        title: alert.title,
        ...(alert.body ? { body: alert.body } : {}),
        ...(alert.link && alert.link.startsWith('/') ? { link: alert.link } : {}),
        ...(alert.orgId ? { orgId: alert.orgId } : {}),
        ...(alert.hostId ? { hostId: alert.hostId } : {}),
      },
      // The operator is emailed; a staff member who also switched email on
      // for this category is not mailed the same alert a second time.
      emailNow ? { skipEmail: true } : {},
    )
    if (!enabled) return { outcome: 'console-only', type: typeId }
    if (delivery === 'digest') {
      await queueOperatorAlertForDigest(alert)
      return { outcome: 'queued', type: typeId }
    }
    return await deliverOperatorAlert(alert, { emailNow })
  } catch (error) {
    console.error(`[operator-alerts] ${typeId} could not be raised`, error)
    return { outcome: 'undelivered', type: typeId }
  }
}

/** Emails and posts one alert now. */
async function deliverOperatorAlert(
  alert: RenderedOperatorAlert,
  options: { emailNow: boolean },
): Promise<OperatorAlertResult> {
  const { sendOperatorAlertEmail } = await import('./staff-alert-email')
  const [email, webhook] = await Promise.all([
    options.emailNow
      ? sendOperatorAlertEmail({
          title: alert.title,
          body: alert.body,
          url: operatorAlertAbsoluteLink(alert.link),
          context: `operator-alert ${alert.type}`,
        })
      : Promise.resolve<SendEmailResult>({ sent: false, reason: 'unconfigured' }),
    postOperatorAlertWebhook([alert]),
  ])
  return {
    outcome: email.sent || webhook.posted ? 'delivered' : 'undelivered',
    type: alert.type,
    email,
    webhook,
  }
}

// ── The digest ──────────────────────────────────────────────────────────────

async function queueOperatorAlertForDigest(alert: RenderedOperatorAlert): Promise<void> {
  try {
    await firestore()
      .collection(OPERATOR_ALERT_DIGEST_COLLECTION)
      .add({ ...alert, atMs: Date.now() })
  } catch (error) {
    // The queue is the only record the digest will have; with it gone, the
    // alert goes now rather than never.
    console.error(`[operator-alerts] digest queue unavailable; sending ${alert.type} now`, error)
    await deliverOperatorAlert(alert, { emailNow: await operatorEmailReachable() })
  }
}

/** At most this many alerts are listed in one digest; the rest are counted. */
export const OPERATOR_DIGEST_MAX_LISTED = 50
const DIGEST_READ_LIMIT = 500

export interface OperatorDigestResult {
  /** Whether a digest went out (or, on a dry run, would). */
  sent: boolean
  reason?: 'not-due' | 'already-sent' | 'empty' | 'dry-run' | 'unavailable'
  count: number
  email?: SendEmailResult
  webhook?: OperatorAlertWebhookResult
}

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10)
}

/** The digest's body: one paragraph per alert, newest last. */
export function composeOperatorDigestBody(
  alerts: readonly RenderedOperatorAlert[],
  total = alerts.length,
): string {
  const listed = alerts.slice(0, OPERATOR_DIGEST_MAX_LISTED).map((alert) => {
    const link = operatorAlertAbsoluteLink(alert.link)
    return [`• ${alert.title}`, alert.body, link].filter(Boolean).join('\n')
  })
  const rest = total - listed.length
  if (rest > 0) listed.push(`…and ${rest} more in the staff console.`)
  return listed.join('\n\n')
}

/**
 * Sends the day's digest once the configured hour has passed: every queued
 * alert in one `operator-alert-digest` email and one webhook post, then
 * clears what it sent. Once per UTC day, claimed by creating
 * `operatorAlertState/digest-{day}`, so two ticks never both send it.
 */
export async function sendOperatorAlertDigest(
  options: { now?: number; dryRun?: boolean; force?: boolean } = {},
): Promise<OperatorDigestResult> {
  const now = options.now ?? Date.now()
  try {
    const settings = await readOperatorAlertSettings()
    const hour = settings.digestHourUtc ?? OPERATOR_ALERT_DIGEST_DEFAULT_HOUR_UTC
    if (!options.force && new Date(now).getUTCHours() < hour) {
      return { sent: false, reason: 'not-due', count: 0 }
    }
    const collection = firestore().collection(OPERATOR_ALERT_DIGEST_COLLECTION)
    const marker = firestore()
      .collection(OPERATOR_ALERT_STATE_COLLECTION)
      .doc(`digest-${dayKey(now)}`)
    if (!options.force && (await marker.get()).exists) {
      return { sent: false, reason: 'already-sent', count: 0 }
    }
    const snapshot = await collection.orderBy('atMs', 'asc').limit(DIGEST_READ_LIMIT).get()
    const queued = snapshot.docs
    if (!queued.length) return { sent: false, reason: 'empty', count: 0 }
    if (options.dryRun) return { sent: false, reason: 'dry-run', count: queued.length }
    if (!options.force) {
      try {
        await marker.create({ atMs: now, count: queued.length })
      } catch {
        return { sent: false, reason: 'already-sent', count: 0 }
      }
    }
    const alerts = queued.map((doc: any) => doc.data() as RenderedOperatorAlert)
    const { sendOperatorAlertDigestEmail } = await import('./staff-alert-email')
    const [email, webhook] = await Promise.all([
      sendOperatorAlertDigestEmail({
        date: dayKey(now),
        count: alerts.length,
        body: composeOperatorDigestBody(alerts),
        url: operatorAlertAbsoluteLink('/admin/operator-alerts'),
      }),
      postOperatorAlertWebhook(alerts, { digest: true, now }),
    ])
    if (email.sent || webhook.posted) {
      const batch = firestore().batch()
      for (const doc of queued) batch.delete(doc.ref)
      await batch.commit()
    } else if (!options.force) {
      // Nothing reached anybody: release the day so the next tick retries.
      await marker.delete().catch(() => undefined)
    }
    return { sent: email.sent || webhook.posted, count: alerts.length, email, webhook }
  } catch (error) {
    console.error('[operator-alerts] digest failed', error)
    return { sent: false, reason: 'unavailable', count: 0 }
  }
}

