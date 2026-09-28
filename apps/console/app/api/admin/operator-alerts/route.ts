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
 * STAFF → OPERATOR ALERTS (AGL-3377).
 *
 * GET (any staff): every alert type in the registry — core's and each
 * installed plugin's — with its coded default and what staff set; the digest
 * hour; where alert mail goes and whether the out-of-band webhook is set; and
 * the last recorded state of every health check.
 *
 * PUT (SUPER staff only, audited): per-type `enabled` / `delivery` and the
 * digest hour. A type set back to its default is removed, so the document
 * only ever holds the answers staff actually gave.
 *
 * POST `{ action: 'test', type }` (SUPER staff only, audited): one `[Test]`
 * alert of that type to the operator inbox and webhook, past dedupe and the
 * switches, so an operator can prove the channels reach them.
 *
 * The route is the only writer: `platformSettings` is deny-all to clients.
 */

import { pluginRequestFromWeb } from '@aglyn/aglyn/server'
import {
  emailUnverifiedResponse,
  firebaseAdmin,
  isImpersonationSession,
} from '@aglyn/tenant-data-admin'
import {
  describeOperatorAlertRecipients,
  invalidateOperatorAlertSettingsCache,
  normalizeOperatorAlertSettings,
  OPERATOR_ALERT_SETTINGS_COLLECTION,
  OPERATOR_ALERT_SETTINGS_DOC,
  operatorAlertCatalogRows,
  operatorAlertWebhookUrl,
  readOperatorAlertSettings,
  sendOperatorAlertTest,
} from '@aglyn/tenant-data-admin/server/operator-alerts'
import { listHealthStates } from '@aglyn/tenant-data-admin/server/operator-health'
import {
  getOperatorAlert,
  listOperatorAlerts,
} from '@aglyn/aglyn/plugin-manager/operator-alerts'
import { addAdminAudit } from '@aglyn/tenant-data-admin/server/admin-audit-write'
import { FieldValue } from 'firebase-admin/firestore'
import { invalidIdTokenResponse } from '../../_lib/invalid-id-token-response'
import { registerPluginServerDeclarations } from '../../../../constants/plugins.declarations.server.generated'

const TARGET = `${OPERATOR_ALERT_SETTINGS_COLLECTION}/${OPERATOR_ALERT_SETTINGS_DOC}`

async function handler(request: Request): Promise<Response> {
  const { method, body, headers: rawHeaders } = await pluginRequestFromWeb(request)
  const headers = rawHeaders as Partial<Record<string, string>>
  if (method !== 'GET' && method !== 'PUT' && method !== 'POST') {
    return Response.json({ error: 'Method not allowed' }, { status: 405 })
  }
  const authorization = headers.authorization ?? ''
  const idToken = authorization.startsWith('Bearer ')
    ? authorization.slice('Bearer '.length)
    : undefined
  if (!idToken) {
    return Response.json({ error: 'Unauthenticated' }, { status: 401 })
  }

  try {
    const decoded = await firebaseAdmin.app().auth().verifyIdToken(idToken)
    if (!decoded.email_verified && !isImpersonationSession(decoded)) {
      return emailUnverifiedResponse()
    }
    if (!decoded['staff']) {
      return Response.json({ error: 'Staff only' }, { status: 403 })
    }
    const actorRole = String(decoded['staffRole'] ?? 'support')

    // A plugin's types are registered by its declarations; without this the
    // page would list only core's until some other request loaded them.
    await registerPluginServerDeclarations().catch((error: unknown) => {
      console.error('[operator-alerts] plugin declarations failed', error)
    })

    if (method === 'GET') {
      const settings = await readOperatorAlertSettings()
      const [recipients, health] = await Promise.all([
        describeOperatorAlertRecipients(),
        listHealthStates(),
      ])
      return Response.json(
        {
          role: actorRole,
          alerts: operatorAlertCatalogRows(listOperatorAlerts(), settings),
          digestHourUtc: settings.digestHourUtc,
          recipients,
          webhookConfigured: Boolean(operatorAlertWebhookUrl()),
          webhookSigned: Boolean(String(process.env['OPERATOR_ALERT_WEBHOOK_SECRET'] ?? '').trim()),
          health: health
            .map(({ checkId, label, status, sinceMs, detail }) => ({ checkId, label, status, sinceMs, detail }))
            .sort((a, b) => a.label.localeCompare(b.label)),
        },
        { status: 200 },
      )
    }

    if (actorRole !== 'super') {
      return Response.json({ error: 'Requires the super staff role' }, { status: 403 })
    }

    if (method === 'POST') {
      const type = String(body?.type ?? '')
      const definition = body?.action === 'test' ? getOperatorAlert(type) : undefined
      if (!definition) {
        return Response.json({ error: 'Unknown alert type' }, { status: 400 })
      }
      const result = await sendOperatorAlertTest(definition)
      await addAdminAudit(firebaseAdmin.app().firestore(), {
        actorUid: decoded.uid,
        action: 'operatorAlerts.test',
        target: TARGET,
        before: null,
        after: { type, emailSent: result.email.sent, webhookPosted: result.webhook.posted },
        at: FieldValue.serverTimestamp(),
      })
      return Response.json({ ok: true, ...result }, { status: 200 })
    }

    // PUT: validate every answer against the registry, then store only the
    // answers that differ from the coded default.
    const before = await readOperatorAlertSettings()
    const requested = normalizeOperatorAlertSettings({
      types: { ...(before.types ?? {}), ...((body?.types ?? {}) as Record<string, unknown>) },
      digestHourUtc: body?.digestHourUtc ?? before.digestHourUtc,
    })
    const types: Record<string, { enabled?: boolean; delivery?: 'immediate' | 'digest' }> = {}
    for (const [type, answer] of Object.entries(requested.types ?? {})) {
      const definition = getOperatorAlert(type)
      if (!definition) {
        return Response.json({ error: `Unknown alert type: ${type}` }, { status: 400 })
      }
      const kept: { enabled?: boolean; delivery?: 'immediate' | 'digest' } = {}
      if (typeof answer.enabled === 'boolean' && answer.enabled !== definition.defaultEnabled) {
        kept.enabled = answer.enabled
      }
      if (answer.delivery && answer.delivery !== definition.delivery) {
        kept.delivery = answer.delivery
      }
      if (Object.keys(kept).length) types[type] = kept
    }
    const write = {
      types,
      digestHourUtc: requested.digestHourUtc,
      updatedAtMs: Date.now(),
      updatedByEmail: decoded.email ?? null,
    }
    await firebaseAdmin
      .app()
      .firestore()
      .collection(OPERATOR_ALERT_SETTINGS_COLLECTION)
      .doc(OPERATOR_ALERT_SETTINGS_DOC)
      .set(write)
    invalidateOperatorAlertSettingsCache()
    await addAdminAudit(firebaseAdmin.app().firestore(), {
      actorUid: decoded.uid,
      action: 'operatorAlerts.update',
      target: TARGET,
      before: { types: before.types ?? {}, digestHourUtc: before.digestHourUtc },
      after: { types, digestHourUtc: write.digestHourUtc },
      at: FieldValue.serverTimestamp(),
    })
    return Response.json(
      {
        ok: true,
        alerts: operatorAlertCatalogRows(listOperatorAlerts(), normalizeOperatorAlertSettings(write)),
        digestHourUtc: write.digestHourUtc,
      },
      { status: 200 },
    )
  } catch (error) {
    const unauthenticated = invalidIdTokenResponse(error)
    if (unauthenticated) return unauthenticated
    console.error('[operator-alerts] request failed', error)
    return Response.json({ error: 'Operator alerts request failed' }, { status: 500 })
  }
}

export const dynamic = 'force-dynamic'
export { handler as GET, handler as PUT, handler as POST }
