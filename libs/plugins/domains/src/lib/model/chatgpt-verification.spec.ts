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
  CHATGPT_CLAIM_RECORD_NAME,
  chatgptClaimRecord,
  chatgptClaimValue,
  chatgptClaimValueError,
  findChatgptClaimRecord,
  siteDomainForChatgpt,
} from './chatgpt-verification'
import { invalidDnsRecordFields, type DnsRecordView } from './dns-records'

const CODE = 'pMWmOoxSrczpNWx3baISGFkU5Xl33YxUTyJjCdG1TFk'
const VALUE = `openai-business-claim=${CODE}`

const view = (patch: Partial<DnsRecordView>): DnsRecordView => ({
  id: 'rec_1',
  type: 'TXT',
  name: '',
  value: '',
  ttl: 60,
  priority: null,
  managed: false,
  editable: true,
  ...patch,
})

describe('chatgptClaimValue', () => {
  it('takes the whole value, the code alone, and a quoted paste', () => {
    expect(chatgptClaimValue(VALUE)).toBe(VALUE)
    expect(chatgptClaimValue(CODE)).toBe(VALUE)
    expect(chatgptClaimValue(`  "${VALUE}" `)).toBe(VALUE)
  })

  it('refuses anything that is not one of ChatGPT’s values', () => {
    expect(chatgptClaimValue('')).toBeNull()
    expect(chatgptClaimValue('google-site-verification=abc')).toBeNull()
    expect(chatgptClaimValue('openai-business-claim=')).toBeNull()
    expect(chatgptClaimValue('v=spf1 include:example.com ~all')).toBeNull()
    expect(chatgptClaimValue(undefined)).toBeNull()
  })
})

describe('chatgptClaimValueError', () => {
  it('asks for the value when empty and names the shape when wrong', () => {
    expect(chatgptClaimValueError('')).toBe('Paste the value ChatGPT shows.')
    expect(chatgptClaimValueError('hello world')).toMatch(/starts with openai-business-claim=/)
    expect(chatgptClaimValueError(VALUE)).toBeNull()
  })
})

describe('chatgptClaimRecord', () => {
  it('is a TXT record the DNS editor accepts', () => {
    const record = chatgptClaimRecord(VALUE)
    expect(record).toEqual({ type: 'TXT', name: CHATGPT_CLAIM_RECORD_NAME, value: VALUE, ttl: 60 })
    expect(invalidDnsRecordFields(record, 'testbakery.com')).toEqual([])
  })
})

describe('findChatgptClaimRecord', () => {
  it('finds the TXT record under ChatGPT’s name and no other', () => {
    const claim = view({ id: 'rec_2', name: 'openai-business-claim', value: VALUE })
    expect(findChatgptClaimRecord([view({ name: '_dmarc' }), claim])).toBe(claim)
    expect(findChatgptClaimRecord([view({ type: 'CNAME', name: 'openai-business-claim' })])).toBeNull()
    expect(findChatgptClaimRecord([])).toBeNull()
  })
})

describe('siteDomainForChatgpt', () => {
  it('is the site’s domain without www, and null with none', () => {
    expect(siteDomainForChatgpt('www.TestBakery.com')).toBe('testbakery.com')
    expect(siteDomainForChatgpt('shop.testbakery.com')).toBe('shop.testbakery.com')
    expect(siteDomainForChatgpt('')).toBeNull()
    expect(siteDomainForChatgpt(null)).toBeNull()
  })
})
