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
  isCompleteShipFrom,
  isTaxEngineProvider,
  isTaxExemptionType,
  normalizeTaxAddress,
  normalizeTaxCode,
  TAX_ENGINE_PROVIDER_LABELS,
  TAX_ENGINE_PROVIDERS,
  type TaxEngineAddress,
} from '../model/tax-engines'
import { TaxProviderError } from '../providers/http'
import type { TaxProviderCredentials } from '../providers/types'
import { taxProviderFor } from './config'
import { taxEngine } from './engine'
import { taxEnginesGate, taxError, taxJson } from './route-gate'
import {
  connectionRef,
  connectionView,
  exemptionId,
  isDocumentId,
  normalizeEmail,
  openCredentials,
  productCodeId,
  readConnection,
  readExemption,
  readStoredTransaction,
  sealApiToken,
  TAX_ENGINE_COLLECTIONS,
  taxEnginesDb,
  transactionRef,
  transactionView,
} from './store'
import { commitStoredSale } from './transactions'

/**
 * The console routes (AGL-3631), each behind `taxEnginesGate`. A credential
 * is accepted only after the vendor accepted it: a connect that fails its
 * test stores nothing, so a site never holds a key it cannot use.
 */

const MAX_SECRET_LENGTH = 400
const MAX_EXEMPTIONS = 500

function message(error: unknown): string {
  if (error instanceof TaxProviderError) return error.message
  return 'The tax service could not be reached. Try again.'
}

function methodNotAllowed(): Response {
  return taxError(405, 'Method not allowed')
}

/** GET: whether the deployment can hold a connection, and the site's. */
export async function connectionRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: 'viewer' })
  if (gate instanceof Response) return gate
  const connection = await readConnection(gate.hostId)
  return taxJson({
    available: true,
    providers: TAX_ENGINE_PROVIDERS.map((id) => ({ id, label: TAX_ENGINE_PROVIDER_LABELS[id] })),
    connection: connection ? connectionView(connection) : null,
  })
}

/** POST: test the credentials with the vendor, and store them only if they pass. */
export async function connectRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: 'admin' })
  if (gate instanceof Response) return gate
  const { body, hostId } = gate
  const provider = body['provider']
  if (!isTaxEngineProvider(provider)) return taxError(400, 'Choose Avalara AvaTax or TaxJar.')
  const environment = body['environment'] === 'production' ? 'production' : 'sandbox'
  const secret = String(body['secret'] ?? '').trim()
  if (!secret || secret.length > MAX_SECRET_LENGTH) {
    return taxError(400, provider === 'avalara' ? 'Enter your AvaTax license key.' : 'Enter your TaxJar API token.')
  }
  const accountId = String(body['accountId'] ?? '').trim()
  const companyCode = String(body['companyCode'] ?? '').trim().slice(0, 25)
  if (provider === 'avalara' && !/^\d{1,20}$/.test(accountId)) {
    return taxError(400, 'Enter your AvaTax account id, the number on your Avalara account.')
  }
  const credentials: TaxProviderCredentials = {
    provider,
    environment,
    ...(provider === 'avalara' ? { accountId, ...(companyCode ? { companyCode } : {}) } : {}),
    secret,
  }
  let detail: string
  try {
    detail = (await taxProviderFor(provider).testConnection(credentials)).detail
  } catch (error) {
    return taxError(400, message(error))
  }
  const now = Date.now()
  const existing = await readConnection(hostId)
  await connectionRef(hostId).set({
    orgId: gate.orgId,
    hostId,
    provider,
    environment,
    accountId: provider === 'avalara' ? accountId : null,
    companyCode: provider === 'avalara' ? companyCode || null : null,
    ...sealApiToken(secret, hostId, gate.keyring),
    // The site's own settings outlive a change of vendor or of key.
    shipFrom: existing?.shipFrom ?? null,
    shipFromValidated: existing?.provider === provider ? existing.shipFromValidated : false,
    defaultTaxCode: existing?.provider === provider ? existing.defaultTaxCode : null,
    recordTransactions: existing?.recordTransactions ?? true,
    lastTestOk: true,
    lastTestAtMs: now,
    lastError: null,
    connectedByUid: gate.uid,
    createdAtMs: existing?.createdAtMs || now,
    updatedAtMs: now,
  })
  const stored = await readConnection(hostId)
  return taxJson({ connection: stored ? connectionView(stored) : null, detail })
}

/** POST: test the stored credentials again, and record the verdict. */
export async function testRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: 'admin' })
  if (gate instanceof Response) return gate
  const connection = await readConnection(gate.hostId)
  if (!connection) return taxError(404, 'No tax service is connected.')
  let verdict: { ok: boolean; detail: string }
  try {
    const credentials = openCredentials(connection, gate.keyring)
    verdict = { ok: true, detail: (await taxProviderFor(connection.provider).testConnection(credentials)).detail }
  } catch (error) {
    verdict = { ok: false, detail: message(error) }
  }
  await connectionRef(gate.hostId).set(
    {
      lastTestOk: verdict.ok,
      lastTestAtMs: Date.now(),
      lastError: verdict.ok ? null : verdict.detail,
      updatedAtMs: Date.now(),
    },
    { merge: true },
  )
  const stored = await readConnection(gate.hostId)
  return taxJson({ ...verdict, connection: stored ? connectionView(stored) : null })
}

/** POST: forget the credentials. Records of what was sent are kept. */
export async function disconnectRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: 'admin' })
  if (gate instanceof Response) return gate
  await connectionRef(gate.hostId).delete()
  return taxJson({ connection: null })
}

/** POST: ship-from address, default tax code, recording switch. */
export async function settingsRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: 'admin' })
  if (gate instanceof Response) return gate
  const { body, hostId } = gate
  const connection = await readConnection(hostId)
  if (!connection) return taxError(404, 'Connect a tax service first.')
  const patch: Record<string, unknown> = { updatedAtMs: Date.now() }
  const messages: string[] = []
  if ('shipFrom' in body) {
    const typed = normalizeTaxAddress(body['shipFrom'])
    if (!typed || !isCompleteShipFrom(typed)) {
      return taxError(400, 'Enter the full address you ship or sell from: street, city, state and postal code.')
    }
    let shipFrom: TaxEngineAddress = typed
    let validated = false
    try {
      const checked = await taxProviderFor(connection.provider).validateAddress(
        openCredentials(connection, gate.keyring),
        typed,
      )
      messages.push(...checked.messages)
      if (checked.valid && checked.normalized && isCompleteShipFrom(checked.normalized)) {
        shipFrom = checked.normalized
        validated = true
      }
    } catch (error) {
      // An address check the vendor's plan does not include is not a reason
      // to refuse the address; it is saved as typed and shown unconfirmed.
      messages.push(message(error))
    }
    patch['shipFrom'] = shipFrom
    patch['shipFromValidated'] = validated
  }
  if ('defaultTaxCode' in body) {
    const raw = String(body['defaultTaxCode'] ?? '').trim()
    const code = normalizeTaxCode(raw)
    if (raw && !code) return taxError(400, 'A tax code is letters, numbers, dots and dashes.')
    patch['defaultTaxCode'] = code
  }
  if ('recordTransactions' in body) patch['recordTransactions'] = body['recordTransactions'] !== false
  await connectionRef(hostId).set(patch, { merge: true })
  const stored = await readConnection(hostId)
  return taxJson({ connection: stored ? connectionView(stored) : null, messages })
}

/** POST: the engine's reading of an address. */
export async function addressValidateRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const address = normalizeTaxAddress(gate.body['address'])
  if (!address) return taxError(400, 'Enter an address with a two-letter country code.')
  try {
    return taxJson(await taxEngine.validateAddress(gate.hostId, address))
  } catch (error) {
    return taxError(error instanceof TaxProviderError ? 502 : 409, error instanceof Error ? error.message : message(error))
  }
}

/** GET / POST: one product's tax code. */
export async function productTaxCodeRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: request.method === 'GET' ? 'viewer' : 'editor' })
  if (gate instanceof Response) return gate
  const productId = String(gate.body['productId'] ?? new URL(request.url).searchParams.get('productId') ?? '')
  if (!isDocumentId(productId)) return taxError(400, 'Missing productId')
  const ref = taxEnginesDb().collection(TAX_ENGINE_COLLECTIONS.productCodes).doc(productCodeId(gate.hostId, productId))
  if (request.method === 'GET') {
    const snapshot = await ref.get()
    return taxJson({ taxCode: snapshot.exists ? String(snapshot.get('taxCode') ?? '') || null : null })
  }
  const raw = String(gate.body['taxCode'] ?? '').trim()
  if (!raw) {
    await ref.delete()
    return taxJson({ taxCode: null })
  }
  const taxCode = normalizeTaxCode(raw)
  if (!taxCode) return taxError(400, 'A tax code is letters, numbers, dots and dashes.')
  await ref.set({
    orgId: gate.orgId,
    hostId: gate.hostId,
    productId,
    taxCode,
    updatedByUid: gate.uid,
    updatedAtMs: Date.now(),
  })
  return taxJson({ taxCode })
}

/** GET: the site's exempt customers. POST: save one. */
export async function exemptionsRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET' && request.method !== 'POST') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const collection = taxEnginesDb().collection(TAX_ENGINE_COLLECTIONS.exemptions)
  if (request.method === 'GET') {
    const snapshot = await collection
      .where('hostId', '==', gate.hostId)
      .orderBy('email')
      .limit(MAX_EXEMPTIONS)
      .get()
    return taxJson({
      exemptions: snapshot.docs
        .map((doc: { id: string; data: () => unknown }) => readExemption(doc.id, doc.data()))
        .filter(Boolean),
    })
  }
  const { body } = gate
  const email = normalizeEmail(body['email'])
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return taxError(400, 'Enter the customer’s email address.')
  if (!isTaxExemptionType(body['type'])) return taxError(400, 'Choose why the customer is exempt.')
  const regions = (Array.isArray(body['regions']) ? body['regions'] : [])
    .map((region) => String(region ?? '').trim().toUpperCase())
    .filter((region) => /^[A-Z0-9]{1,3}$/.test(region))
  const id = exemptionId(gate.hostId, email)
  const existing = await collection.doc(id).get()
  if (!existing.exists) {
    const count = await collection.where('hostId', '==', gate.hostId).limit(MAX_EXEMPTIONS).get()
    if (count.size >= MAX_EXEMPTIONS) return taxError(409, `A site can record up to ${MAX_EXEMPTIONS} exempt customers.`)
  }
  const record = {
    orgId: gate.orgId,
    hostId: gate.hostId,
    email,
    name: String(body['name'] ?? '').trim().slice(0, 120) || null,
    type: body['type'],
    certificateNumber: String(body['certificateNumber'] ?? '').trim().slice(0, 40) || null,
    regions: [...new Set(regions)].slice(0, 60),
    updatedByUid: gate.uid,
    updatedAtMs: Date.now(),
  }
  await collection.doc(id).set(record)
  return taxJson({ exemption: readExemption(id, record) })
}

/** POST: remove one exempt customer. */
export async function exemptionsDeleteRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const id = String(gate.body['id'] ?? '')
  // The id names the site, so a member of one site cannot remove another's.
  if (!isDocumentId(id) || !id.startsWith(`${gate.hostId}__`)) return taxError(400, 'Missing id')
  await taxEnginesDb().collection(TAX_ENGINE_COLLECTIONS.exemptions).doc(id).delete()
  return taxJson({ deleted: true })
}

/** GET: how one order stands with the engine. */
export async function orderTransactionRoute(request: Request): Promise<Response> {
  if (request.method !== 'GET') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const orderId = String(new URL(request.url).searchParams.get('orderId') ?? '')
  if (!isDocumentId(orderId)) return taxError(400, 'Missing orderId')
  const stored = readStoredTransaction((await transactionRef(gate.hostId, orderId).get()).data())
  return taxJson({ transaction: stored ? transactionView(stored) : null })
}

/** POST: send one order to the engine again. */
export async function orderTransactionRetryRoute(request: Request): Promise<Response> {
  if (request.method !== 'POST') return methodNotAllowed()
  const gate = await taxEnginesGate(request, { role: 'editor' })
  if (gate instanceof Response) return gate
  const orderId = String(gate.body['orderId'] ?? '')
  if (!isDocumentId(orderId)) return taxError(400, 'Missing orderId')
  const ref = transactionRef(gate.hostId, orderId)
  const stored = readStoredTransaction((await ref.get()).data())
  if (!stored) return taxError(404, 'This order was not sent to a tax service.')
  if (stored.status === 'failed') await ref.set({ status: 'pending' }, { merge: true })
  const result = await commitStoredSale(gate.hostId, orderId, { lastAttempt: true }).catch(() => null)
  return taxJson({ transaction: result ? transactionView(result) : transactionView(stored) })
}
