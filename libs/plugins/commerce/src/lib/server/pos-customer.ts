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

import type { PluginApiHandler, PluginApiRequest } from '@aglyn/aglyn/server'
import type { PluginContactCaptureRequest, PluginContactCaptured } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import {
  searchPluginPeople,
  type PluginPersonRecord,
  type PluginPersonSearchRequest,
} from '@aglyn/aglyn/plugin-manager/plugin-person-records'
import recordCapturedContact from '@aglyn/aglyn/plugin-manager/record-captured-contact'
import { nameSearchKey } from '@aglyn/aglyn/app-utils/name-search'
import { AggregateField } from 'firebase-admin/firestore'
import {
  authorizePosOps,
  defaultPosOpsDeps,
  posOpsBody,
  type PosOpsDeps,
} from './pos-ops-gate'

/*==========================================
 * THE CUSTOMER AT THE REGISTER (AGL-3609): `POST /api/commerce/pos-customer`.
 *
 *   search  name, email or phone → people the site may see
 *   stats   one customer's orders here and what they have spent
 *   create  a new customer, quick-added at the counter
 *
 * The people are the workspace's, kept by whichever plugin keeps people and
 * reached through `plugin-person-records` — never by opening that plugin's
 * collections or importing it. A workspace with no record system answers
 * `available: false`, and the register falls back to typing an email.
 *
 * The STATS are commerce's own: an aggregate over this site's orders by the
 * stored lowercase address, never a scan.
 *=========================================*/

/** The statuses a customer actually paid in. A refund is netted, not excluded. */
export const POS_CUSTOMER_PAID_STATUSES = [
  'paid',
  'partially_fulfilled',
  'fulfilled',
  'delivered',
  'refunded',
] as const

export interface PosCustomerDeps extends PosOpsDeps {
  searchPeople(request: PluginPersonSearchRequest): Promise<PluginPersonRecord[] | null>
  captureContact(request: PluginContactCaptureRequest): Promise<PluginContactCaptured | null>
  /** Orders, spend and refunds for one address on one site, by aggregate. */
  orderStats(
    hostRef: FirebaseFirestore.DocumentReference,
    emailLower: string,
  ): Promise<{ orderCount: number; spentCents: number; refundedCents: number }>
}

export function defaultPosCustomerDeps(): PosCustomerDeps {
  return {
    ...defaultPosOpsDeps(),
    searchPeople: (request) => searchPluginPeople(request),
    captureContact: (request) => recordCapturedContact(request),
    orderStats: async (hostRef, emailLower) => {
      const snapshot = await hostRef
        .collection('orders')
        .where('customerEmailLower', '==', emailLower)
        .where('status', 'in', [...POS_CUSTOMER_PAID_STATUSES])
        .aggregate({
          orderCount: AggregateField.count(),
          spentCents: AggregateField.sum('totals.totalCents'),
          refundedCents: AggregateField.sum('refundedCents'),
        })
        .get()
      const data = snapshot.data()
      return {
        orderCount: Number(data.orderCount ?? 0),
        spentCents: Number(data.spentCents ?? 0),
        refundedCents: Number(data.refundedCents ?? 0),
      }
    },
  }
}

/** One person as the register lists them. */
export interface PosCustomer {
  kind: string
  id: string
  name: string
  email: string | null
  phone: string | null
}

function customerOf(person: PluginPersonRecord): PosCustomer {
  const data = person.data ?? {}
  const name = typeof data['name'] === 'string' ? data['name'] : ''
  const phone = typeof data['phone'] === 'string' ? data['phone'] : ''
  return {
    kind: person.kind,
    id: person.id,
    name: name.trim(),
    email: person.email,
    phone: phone.trim() || null,
  }
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

type Outcome = { status: number; body: Record<string, unknown> }

export async function handlePosCustomer(deps: PosCustomerDeps, req: PluginApiRequest): Promise<Outcome> {
  if (req.method !== 'POST') return { status: 405, body: { error: 'Method not allowed' } }
  const body = posOpsBody(req)
  const gate = await authorizePosOps(deps, req, body['hostId'])
  if ('error' in gate) return { status: gate.status, body: { error: gate.error } }
  const staff = gate.staff
  const action = String(body['action'] ?? '')

  switch (action) {
    case 'search': {
      const text = String(body['text'] ?? '').trim().slice(0, 120)
      if (text.length < 2) return { status: 200, body: { available: true, customers: [] } }
      const people = await deps.searchPeople({
        hostId: staff.hostId,
        orgId: staff.orgId || null,
        text,
        limit: 10,
      })
      if (people === null) return { status: 200, body: { available: false, customers: [] } }
      return { status: 200, body: { available: true, customers: people.map(customerOf) } }
    }

    case 'stats': {
      const email = nameSearchKey(String(body['email'] ?? ''))
      if (!EMAIL.test(email)) return { status: 400, body: { error: 'That is not an email address.' } }
      const stats = await deps.orderStats(staff.hostRef, email)
      return {
        status: 200,
        body: {
          orderCount: stats.orderCount,
          lifetimeSpendCents: Math.max(0, stats.spentCents - stats.refundedCents),
        },
      }
    }

    case 'create': {
      const email = String(body['email'] ?? '').trim().toLowerCase().slice(0, 200)
      const name = String(body['name'] ?? '').trim().slice(0, 120)
      const phone = String(body['phone'] ?? '').trim().slice(0, 40)
      if (!EMAIL.test(email)) {
        return { status: 400, body: { error: 'Add the customer’s email address.' } }
      }
      if (phone && !/^[\d\s()+.-]{4,40}$/.test(phone)) {
        return { status: 400, body: { error: 'That is not a phone number.' } }
      }
      const captured = await deps.captureContact({
        actor: { kind: 'member', uid: staff.uid },
        orgId: staff.orgId,
        hostId: staff.hostId,
        identity: { email, ...(name ? { name } : {}) },
        interaction: { source: 'order', summary: 'Added at the register' },
        surface: 'relationship',
        lifecycleFloor: 'customer',
        ...(phone ? { profileFill: { phone } } : {}),
      })
      if (!captured) {
        return {
          status: 200,
          body: {
            available: false,
            customer: { kind: 'none', id: '', name, email, phone: phone || null },
          },
        }
      }
      if (captured.ok !== true) {
        return { status: 409, body: { error: 'That customer could not be added.' } }
      }
      const id = captured.record === 'contact' ? captured.contactId : captured.leadId
      return {
        status: 200,
        body: {
          available: true,
          customer: { kind: captured.record, id, name, email, phone: phone || null },
          created: captured.created,
        },
      }
    }

    default:
      return { status: 400, body: { error: 'Unknown action' } }
  }
}

export function createPosCustomerHandler(
  deps: () => PosCustomerDeps = defaultPosCustomerDeps,
): PluginApiHandler {
  return async (req, res) => {
    try {
      const outcome = await handlePosCustomer(deps(), req)
      return res.status(outcome.status).json(outcome.body)
    } catch (error) {
      console.error('[pos-customer] failed', error)
      return res.status(500).json({ error: 'Customer lookup failed' })
    }
  }
}

export const posCustomerHandler = createPosCustomerHandler()
