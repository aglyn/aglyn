/**
 * @jest-environment node
 */
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

import { MemoryFirestore } from '../testing/memory-firestore'

const store = { current: new MemoryFirestore() }
const entitled = { value: true }

jest.mock('@aglyn/tenant-data-admin', () => ({
  firebaseAdmin: { app: () => ({ firestore: () => store.current }) },
  getOrgForHost: jest.fn(async () => ({ orgId: 'org1', org: { id: 'org1' } })),
}))
jest.mock('@aglyn/aglyn/server', () => ({
  checkEntitlement: jest.fn(() => entitled.value),
}))
jest.mock('./download', () => ({ tokenSigningSecret: () => 'test-signing-secret' }))

import type { PosPrinter } from '../model/commerce-printers'
import { enqueuePrintJob } from './print-queue'
import { cloudPrntRoute, epsonServerDirectPrintRoute } from './printer-poll'
import { printerPollUrl, printerSecret, printerSecretMatches } from './printer-secret'

const HOST = 'host1'
const MAC = '00:11:62:ab:cd:ef'

function addPrinter(id: string, overrides: Partial<PosPrinter> = {}): PosPrinter {
  const printer: PosPrinter = {
    name: 'Counter',
    brand: 'star',
    deviceId: MAC,
    registerId: 'reg1',
    autoPrintReceipts: true,
    kickDrawer: true,
    secretVersion: 1,
    createdAtMs: 1,
    ...overrides,
  }
  store.current.write(`hosts/${HOST}/printers/${id}`, printer as any)
  return printer
}

const params = (printerId: string, secret = printerSecret(HOST, printerId, 1)) => ({
  params: { hostId: HOST, printerId, secret },
})

const url = (printerId: string, query = '') =>
  `https://console.test/api/commerce/cloudprnt/${HOST}/${printerId}/x${query}`

const job = (id: string) => store.current.read(`hosts/${HOST}/printJobs/${id}`) as any
const printer = (id: string) => store.current.read(`hosts/${HOST}/printers/${id}`) as any

const starPoll = (printerId: string, body: Record<string, unknown>, secret?: string) =>
  cloudPrntRoute(
    new Request(url(printerId), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    }),
    params(printerId, secret),
  )

beforeEach(() => {
  store.current = new MemoryFirestore()
  entitled.value = true
})

describe('the per-printer secret (AGL-3619)', () => {
  it('is derived, versioned and compared in constant time', () => {
    const one = printerSecret(HOST, 'p1', 1)
    expect(one).toMatch(/^[0-9a-f]{40}$/)
    expect(printerSecret(HOST, 'p1', 2)).not.toBe(one)
    expect(printerSecretMatches(HOST, 'p1', 1, one)).toBe(true)
    expect(printerSecretMatches(HOST, 'p1', 2, one)).toBe(false)
    expect(printerSecretMatches(HOST, 'p2', 1, one)).toBe(false)
    expect(printerSecretMatches(HOST, 'p1', 1, 'short')).toBe(false)
  })

  it('is the last segment of the poll URL', () => {
    expect(printerPollUrl('star', HOST, 'p1', 1)).toMatch(
      new RegExp(`/api/commerce/cloudprnt/${HOST}/p1/${printerSecret(HOST, 'p1', 1)}$`),
    )
    expect(printerPollUrl('epson', HOST, 'p1', 1)).toContain('/api/commerce/epson-sdp/')
  })
})

describe('Star CloudPRNT: POST status, GET job, DELETE confirm', () => {
  const status = { printerMAC: MAC, statusCode: '200%20OK', status: '23 6 0 0 0 0 0 0 0' }

  it('refuses a wrong secret, a regenerated secret, the wrong brand and the wrong MAC with a bare 404', async () => {
    addPrinter('p1')
    addPrinter('p2', { secretVersion: 2 })
    addPrinter('e1', { brand: 'epson', deviceId: 'counter' })
    expect((await starPoll('p1', status, 'f'.repeat(40))).status).toBe(404)
    expect((await starPoll('p2', status, printerSecret(HOST, 'p2', 1))).status).toBe(404)
    expect((await starPoll('e1', status, printerSecret(HOST, 'e1', 1))).status).toBe(404)
    expect((await starPoll('p1', { ...status, printerMAC: '00:11:62:00:00:01' })).status).toBe(404)
    expect((await starPoll('missing', status)).status).toBe(404)
  })

  it('with nothing queued: jobReady false, asks the poll interval once, records the printer online', async () => {
    addPrinter('p1')
    const first = await starPoll('p1', status)
    expect(first.status).toBe(200)
    expect(first.headers.get('cache-control')).toContain('no-store')
    expect(await first.json()).toEqual({
      jobReady: false,
      clientAction: [{ request: 'GetPollInterval', options: '' }],
    })
    expect(printer('p1').status).toMatchObject({ state: 'online', detail: '200 OK' })
    const second = await starPoll('p1', {
      ...status,
      clientAction: [{ request: 'GetPollInterval', result: '5' }],
    })
    expect(await second.json()).toEqual({ jobReady: false })
    expect(printer('p1').status.pollSeconds).toBe(5)
  })

  it('records paper and cover states from the status code', async () => {
    addPrinter('p1')
    await starPoll('p1', { ...status, statusCode: '410%20Out%20of%20paper' })
    expect(printer('p1').status.state).toBe('paper_out')
  })

  it('offers a queued job by token, serves its bytes, and closes it on a 2xx DELETE', async () => {
    addPrinter('p1', { logoKey: '1' })
    const { jobId } = await enqueuePrintJob(store.current, HOST, 'p1', { kind: 'drawer' })
    const offered = await (await starPoll('p1', status)).json()
    expect(offered).toEqual({
      jobReady: true,
      mediaTypes: ['application/vnd.star.starprntcore', 'text/plain'],
      jobToken: jobId,
      deleteMethod: 'DELETE',
    })
    expect(job(jobId).status).toBe('queued')

    const query = `?uid=&type=application%2Fvnd.star.starprntcore&mac=${encodeURIComponent(MAC)}&token=${jobId}`
    const download = await cloudPrntRoute(new Request(url('p1', query)), params('p1'))
    expect(download.status).toBe(200)
    expect(download.headers.get('content-type')).toBe('application/vnd.star.starprntcore')
    // Initialize, then the drawer kick.
    expect(Array.from(new Uint8Array(await download.arrayBuffer()))).toEqual([0x1b, 0x40, 0x07])
    expect(job(jobId)).toMatchObject({ status: 'printing', attempts: 1 })

    const confirm = await cloudPrntRoute(
      new Request(url('p1', `?code=200%20OK&mac=${encodeURIComponent(MAC)}&token=${jobId}`), {
        method: 'DELETE',
      }),
      params('p1'),
    )
    expect(confirm.status).toBe(200)
    expect(job(jobId)).toMatchObject({ status: 'done', resultCode: '200 OK' })
    expect(await (await starPoll('p1', status)).json()).toMatchObject({ jobReady: false })
  })

  it('serves text/plain when the printer chooses it', async () => {
    addPrinter('p1')
    const { jobId } = await enqueuePrintJob(store.current, HOST, 'p1', {
      kind: 'test',
      storeName: 'Corner Cafe',
    })
    const download = await cloudPrntRoute(
      new Request(url('p1', `?type=text%2Fplain&mac=${encodeURIComponent(MAC)}&token=${jobId}`)),
      params('p1'),
    )
    expect(download.headers.get('content-type')).toContain('text/plain')
    expect(await download.text()).toContain('TEST PRINT')
  })

  it('a failed print goes back in the queue and the printer shows why', async () => {
    addPrinter('p1')
    const { jobId } = await enqueuePrintJob(store.current, HOST, 'p1', { kind: 'test' })
    await cloudPrntRoute(
      new Request(url('p1', `?type=text%2Fplain&mac=${encodeURIComponent(MAC)}&token=${jobId}`)),
      params('p1'),
    )
    await cloudPrntRoute(
      new Request(url('p1', `?code=410%20Out%20of%20paper&mac=${encodeURIComponent(MAC)}&token=${jobId}`), {
        method: 'DELETE',
      }),
      params('p1'),
    )
    expect(job(jobId)).toMatchObject({ status: 'queued', resultCode: '410 Out of paper' })
    expect(printer('p1').status.state).toBe('paper_out')
  })

  it('accepts the GET form of the confirmation, and one with no token (older firmware)', async () => {
    addPrinter('p1')
    const { jobId } = await enqueuePrintJob(store.current, HOST, 'p1', { kind: 'test' })
    await cloudPrntRoute(
      new Request(url('p1', `?type=text%2Fplain&mac=${encodeURIComponent(MAC)}`)),
      params('p1'),
    )
    expect(job(jobId).status).toBe('printing')
    const confirm = await cloudPrntRoute(
      new Request(url('p1', `?delete&code=200%20OK&mac=${encodeURIComponent(MAC)}`)),
      params('p1'),
    )
    expect(confirm.status).toBe(200)
    expect(job(jobId).status).toBe('done')
  })

  it('hands over nothing once the plan no longer carries POS', async () => {
    addPrinter('p1')
    const { jobId } = await enqueuePrintJob(store.current, HOST, 'p1', { kind: 'test' })
    entitled.value = false
    expect(await (await starPoll('p1', status)).json()).toMatchObject({ jobReady: false })
    const download = await cloudPrntRoute(
      new Request(url('p1', `?type=text%2Fplain&mac=${encodeURIComponent(MAC)}&token=${jobId}`)),
      params('p1'),
    )
    expect(download.status).toBe(404)
    expect(job(jobId).status).toBe('queued')
  })
})

describe('Epson Server Direct Print: GetRequest delivers, SetResponse confirms', () => {
  const epsonPost = (printerId: string, form: Record<string, string>, method = 'POST') =>
    epsonServerDirectPrintRoute(
      new Request(`https://console.test/api/commerce/epson-sdp/${HOST}/${printerId}/x`, {
        method,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        ...(method === 'POST' ? { body: new URLSearchParams(form).toString() } : {}),
      }),
      params(printerId),
    )

  beforeEach(() => {
    addPrinter('e1', { brand: 'epson', deviceId: 'counter-1', name: 'Epson' })
  })

  it('refuses the wrong ID, and anything but POST', async () => {
    expect((await epsonPost('e1', { ConnectionType: 'GetRequest', ID: 'other' })).status).toBe(404)
    expect((await epsonPost('e1', {}, 'GET')).status).toBe(405)
  })

  it('answers an empty 200 when there is nothing to print', async () => {
    const response = await epsonPost('e1', { ConnectionType: 'GetRequest', ID: 'counter-1' })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/xml; charset=utf-8')
    expect(await response.text()).toBe('')
    expect(printer('e1').status.state).toBe('online')
  })

  it('delivers the job in the poll response and takes it', async () => {
    const { jobId } = await enqueuePrintJob(store.current, HOST, 'e1', { kind: 'drawer' })
    const xml = await (await epsonPost('e1', { ConnectionType: 'GetRequest', ID: 'counter-1' })).text()
    expect(xml).toContain(`<printjobid>${jobId}</printjobid>`)
    expect(xml).toContain('<pulse drawer="drawer_1" time="pulse_100"/>')
    expect(job(jobId)).toMatchObject({ status: 'printing', attempts: 1 })
    // The next poll does not get it again while the claim is fresh.
    expect(await (await epsonPost('e1', { ConnectionType: 'GetRequest', ID: 'counter-1' })).text()).toBe('')
  })

  it('closes a job on success and re-queues it on a printer error', async () => {
    const ok = await enqueuePrintJob(store.current, HOST, 'e1', { kind: 'test' })
    const bad = await enqueuePrintJob(store.current, HOST, 'e1', { kind: 'test' })
    await epsonPost('e1', { ConnectionType: 'GetRequest', ID: 'counter-1' })
    await epsonPost('e1', { ConnectionType: 'GetRequest', ID: 'counter-1' })
    const result = (id: string, success: boolean, code: string, status: number) =>
      `<ePOSPrint><Parameter><devid>local_printer</devid><printjobid>${id}</printjobid></Parameter>` +
      `<PrintResponse><response success="${success}" code="${code}" status="${status}" battery="0"/></PrintResponse></ePOSPrint>`
    const response = await epsonPost('e1', {
      ConnectionType: 'SetResponse',
      ID: 'counter-1',
      ResponseFile:
        '<?xml version="1.0" encoding="utf-8"?><PrintResponseInfo Version="2.00">' +
        result(ok.jobId, true, '', 2) +
        result(bad.jobId, false, 'EPTR_REC_EMPTY', 0x00080000) +
        '</PrintResponseInfo>',
    })
    expect(response.status).toBe(200)
    expect(job(ok.jobId).status).toBe('done')
    expect(job(bad.jobId)).toMatchObject({ status: 'queued', resultCode: 'EPTR_REC_EMPTY' })
    expect(printer('e1').status.state).toBe('paper_out')
  })

  it('ignores a result for another printer’s job', async () => {
    addPrinter('e2', { brand: 'epson', deviceId: 'counter-2' })
    const other = await enqueuePrintJob(store.current, HOST, 'e2', { kind: 'test' })
    await epsonPost('e1', {
      ConnectionType: 'SetResponse',
      ID: 'counter-1',
      ResponseFile: `<PrintResponseInfo Version="2.00"><ePOSPrint><Parameter><printjobid>${other.jobId}</printjobid></Parameter><PrintResponse><response success="true" code="" status="2"/></PrintResponse></ePOSPrint></PrintResponseInfo>`,
    })
    expect(job(other.jobId).status).toBe('queued')
  })
})
