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

import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import OrderWebhooksCard, { DeliveriesDialog } from './order-webhooks-card.component'

/**
 * The Order webhooks card (AGL-3611): hidden unless the route says this
 * person may manage webhooks on a deployment that can sign; what it posts for
 * add, test and resend; the secret shown once; and the delivery log's status
 * filter as a Firestore query, not a filter over loaded rows.
 */

const mockQueries: unknown[][] = []
jest.mock('firebase/firestore', () => ({
  collection: (_db: unknown, ...path: string[]) => ({ path: path.join('/') }),
  query: (...parts: unknown[]) => {
    mockQueries.push(parts)
    return parts
  },
  where: (field: string, op: string, value: unknown) => ({ where: [field, op, value] }),
  orderBy: (field: string, direction: string) => ({ orderBy: [field, direction] }),
  limit: (n: number) => ({ limit: n }),
}))

const mockRows: { endpoints: unknown[]; deliveries: unknown[] } = { endpoints: [], deliveries: [] }
const mockUser = { uid: 'admin-1' }
jest.mock('@aglyn/tenant-feature-instance', () => ({
  useFirestore: () => ({}),
  useFirestoreCollection: (build: () => unknown[]) => {
    const parts = build()
    const path = (parts[0] as { path: string }).path
    return { data: path.endsWith('orderWebhooks') ? mockRows.endpoints : mockRows.deliveries }
  },
  // One page of ten, read with the probe row the hook asks for.
  usePagedCollection: (build: (pageLimit: number) => unknown[]) => {
    build(11)
    return {
      rows: mockRows.deliveries,
      hasMore: false,
      page: 0,
      setPage: jest.fn(),
      pageSize: 10,
      setPageSize: jest.fn(),
    }
  },
  useUser: () => ({ data: mockUser }),
}))

const mockFetch = jest.fn()
jest.mock('@aglyn/shared-util-http/authorized-token', () => ({
  authorizedFetch: (_user: unknown, url: string, init: unknown) => mockFetch(url, init),
}))

jest.mock('@aglyn/shared-ui-snackstack', () => {
  const enqueueSnackbar = jest.fn()
  return { useSnackbar: () => ({ enqueueSnackbar }), __snackbar: enqueueSnackbar }
})

jest.mock('@aglyn/shared-ui-jsx', () => ({
  useConfirmationContext: () => ({ confirm: jest.fn(async () => undefined) }),
  CardDisplay: (props: Record<string, any>) => (
    <section>
      <h2>{props.header}</h2>
      {props.HeaderProps?.action}
      {props.children}
    </section>
  ),
}))

jest.mock('@aglyn/aglyn', () => ({ pluginDocsHelp: () => ({ title: '', excerpt: '', href: '' }) }))

const answer = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body })
const STATUS = {
  configured: true,
  maxEndpoints: 10,
  events: [
    { event: 'order.paid', label: 'Order paid', description: 'Paid.' },
    { event: 'order.refunded', label: 'Order refunded', description: 'Refunded.' },
  ],
}
const bodyOf = (call: unknown[]) => JSON.parse((call[1] as { body: string }).body)

beforeEach(() => {
  jest.clearAllMocks()
  mockQueries.length = 0
  mockRows.endpoints = []
  mockRows.deliveries = []
})

it('renders nothing when the route refuses or signing is not configured', async () => {
  mockFetch.mockResolvedValueOnce(answer(403, { error: 'no' }))
  const { container, unmount } = render(<OrderWebhooksCard hostId="h1" />)
  await waitFor(() => expect(mockFetch).toHaveBeenCalled())
  expect(container.innerHTML).toBe('')
  unmount()
  mockFetch.mockResolvedValueOnce(answer(200, { ...STATUS, configured: false }))
  const second = render(<OrderWebhooksCard hostId="h1" />)
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
  expect(second.container.innerHTML).toBe('')
})

it('adds an endpoint with the chosen events and shows its secret once', async () => {
  mockFetch.mockResolvedValueOnce(answer(200, STATUS))
  render(<OrderWebhooksCard hostId="h1" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Add endpoint' }))
  fireEvent.change(screen.getByLabelText('Endpoint URL'), { target: { value: 'https://erp.test/hook' } })
  fireEvent.click(screen.getByRole('checkbox', { name: /Order refunded/ }))
  mockFetch.mockResolvedValueOnce(answer(200, { ok: true, id: 'w1', secret: 'whsec_abc' }))
  const dialogButtons = screen.getAllByRole('button', { name: 'Add endpoint' })
  fireEvent.click(dialogButtons[dialogButtons.length - 1])
  await waitFor(() => expect(mockFetch).toHaveBeenCalledTimes(2))
  expect(mockFetch.mock.calls[1][0]).toBe('/api/commerce/order-webhooks')
  expect(bodyOf(mockFetch.mock.calls[1])).toEqual({
    hostId: 'h1',
    action: 'create',
    url: 'https://erp.test/hook',
    description: '',
    events: ['order.paid'],
  })
  expect(await screen.findByDisplayValue('whsec_abc')).toBeTruthy()
})

it('sends a test event and resends from the log', async () => {
  mockRows.endpoints = [
    { $id: 'w1', url: 'https://erp.test/hook', events: ['order.paid'], enabled: true, secretHint: 'abcd', createdAtMs: 1 },
  ]
  mockRows.deliveries = [
    { $id: 'd1', endpointId: 'w1', event: 'order.paid', status: 'failed', attempts: [{ atMs: 1, httpStatus: 500, error: 'The endpoint answered 500', durationMs: 3 }], body: '{}', createdAtMs: 1 },
  ]
  mockFetch.mockResolvedValueOnce(answer(200, STATUS))
  render(<OrderWebhooksCard hostId="h1" />)
  mockFetch.mockResolvedValueOnce(answer(200, { ok: true, delivered: true }))
  fireEvent.click(await screen.findByRole('button', { name: 'Send test event' }))
  await waitFor(() => expect(bodyOf(mockFetch.mock.calls[1])).toEqual({ hostId: 'h1', action: 'test', endpointId: 'w1' }))
  fireEvent.click(screen.getByRole('button', { name: 'Deliveries' }))
  expect(await screen.findByText(/last 500 — The endpoint answered 500/)).toBeTruthy()
  mockFetch.mockResolvedValueOnce(answer(200, { ok: true, delivered: true }))
  fireEvent.click(screen.getByRole('button', { name: 'Resend' }))
  await waitFor(() => expect(bodyOf(mockFetch.mock.calls[2])).toEqual({ hostId: 'h1', action: 'resend', deliveryId: 'd1' }))
})

it('filters and pages the delivery log with a Firestore query', () => {
  render(
    <DeliveriesDialog
      hostId="h1"
      endpoint={{ $id: 'w1', url: 'https://erp.test/hook' } as never}
      labelFor={(event) => event}
      busy={false}
      onResend={jest.fn()}
      onClose={jest.fn()}
    />,
  )
  const last = () => mockQueries[mockQueries.length - 1]
  expect(last()).toEqual([
    { path: 'hosts/h1/orderWebhookDeliveries' },
    { where: ['endpointId', '==', 'w1'] },
    { orderBy: ['createdAtMs', 'desc'] },
    { limit: 11 },
  ])
  fireEvent.mouseDown(screen.getByLabelText('Status'))
  fireEvent.click(screen.getByRole('option', { name: 'Failed' }))
  expect(last()).toEqual([
    { path: 'hosts/h1/orderWebhookDeliveries' },
    { where: ['endpointId', '==', 'w1'] },
    { where: ['status', '==', 'failed'] },
    { orderBy: ['createdAtMs', 'desc'] },
    { limit: 11 },
  ])
})
