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
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  INVOICE_FILTER_HEADERS,
  INVOICE_STATUS_OPTIONS,
  readInvoiceQueryParams,
} from '../utils/billing-invoice-query'

/*
 * The apps' Billing › Invoices filters (libs/native/screens/billing.screens.json)
 * offer the console's statuses with the console's words, and ask the route for
 * the parameters it reads back.
 */
const spec = JSON.parse(
  readFileSync(join(__dirname, '../../../libs/native/screens/billing.screens.json'), 'utf8'),
) as { screens: Array<Record<string, any>> }
const invoices = spec.screens.find((screen) => screen.id === 'core.billing.invoices')!

describe('native invoice filters', () => {
  it('offers the console’s statuses, in its words', () => {
    expect(invoices.constants.statuses).toEqual(INVOICE_STATUS_OPTIONS)
  })

  it('names its filters as the console’s chips do', () => {
    const filter = invoices.actions.find((action: any) => action.id === 'filter')
    const labels = filter.prompt.map((field: any) => field.label)
    expect(labels).toContain(INVOICE_FILTER_HEADERS['status'])
    expect(labels).toContain(INVOICE_FILTER_HEADERS['number'])
  })

  it('asks only for parameters the route reads back', () => {
    const url: string = invoices.load.invoices.url
    const keys = [...new URL(url, 'http://local').searchParams.keys()].filter((key) => key !== 'orgId')
    expect(keys).toEqual(['status', 'number', 'createdGte', 'createdLt'])
    const read = readInvoiceQueryParams({
      status: 'open',
      number: 'A-1',
      createdGte: '1793512800',
      createdLt: '1796191200',
    })
    expect(Object.keys(read).sort()).toEqual([...keys].sort())
  })
})
