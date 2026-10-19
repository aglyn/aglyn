/**
 * @jest-environment node
 *
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

/**
 * The templates submitted upstream (`tools/domain-connect/`) against what
 * the platform serves (AGL-3963). A DNS provider writes exactly the records
 * in the template it holds, so a CNAME target or an apex address that drifts
 * from `tenant-dns-targets.ts` would have providers pointing customers'
 * domains somewhere the DNS check then refuses — and nothing else in the repo
 * reads these files to notice.
 */

import { generateKeyPairSync } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import {
  CNAME_TARGET,
  HOST_APEX_ADDRESSES,
  RECOMMENDED_APEX_ADDRESS,
} from '@aglyn/aglyn/app-utils/tenant-dns-targets'
import { DOMAIN_CONNECT_SERVICES } from '../../model/domain-connect'
import { readDomainConnectConfig } from './config'

const TEMPLATES = join(__dirname, '../../../../../../../tools/domain-connect')

interface TemplateRecord {
  type: string
  host: string
  pointsTo: string
  ttl: number
}

function template(serviceId: string) {
  return JSON.parse(readFileSync(join(TEMPLATES, `aglyn.com.${serviceId}.json`), 'utf8')) as {
    providerId: string
    providerName: string
    serviceId: string
    version: number
    logoUrl: string
    syncPubKeyDomain: string
    syncRedirectDomain: string
    hostRequired?: boolean
    warnPhishing?: boolean
    records: TemplateRecord[]
  }
}

const apex = template(DOMAIN_CONNECT_SERVICES.apex)
const subdomain = template(DOMAIN_CONNECT_SERVICES.subdomain)

describe('the templates match what the platform serves', () => {
  it('reads the defaults, with no deployment override in the way', () => {
    // The parity below is with the DEFAULT targets, which are what Aglyn's
    // own deployment serves and what the published templates must name.
    expect(process.env['NEXT_PUBLIC_AGLYN_TENANT_HOST_CNAME']).toBeUndefined()
    expect(process.env['NEXT_PUBLIC_AGLYN_TENANT_APEX_ADDRESSES']).toBeUndefined()
  })

  it('points the apex at the recommended address, one of the pool the check accepts', () => {
    const records = apex.records.filter((record) => record.type === 'A')
    expect(records).toEqual([{ type: 'A', host: '@', pointsTo: RECOMMENDED_APEX_ADDRESS, ttl: 3600 }])
    expect(HOST_APEX_ADDRESSES).toContain(RECOMMENDED_APEX_ADDRESS)
  })

  it('points www, and a subdomain, at the CNAME target the card prints', () => {
    expect(apex.records.filter((record) => record.type === 'CNAME')).toEqual([
      { type: 'CNAME', host: 'www', pointsTo: CNAME_TARGET, ttl: 3600 },
    ])
    expect(subdomain.records).toEqual([{ type: 'CNAME', host: '@', pointsTo: CNAME_TARGET, ttl: 3600 }])
  })

  it('writes nothing else: no TXT, no MX, nothing a customer did not ask for', () => {
    expect(apex.records).toHaveLength(2)
    expect(subdomain.records).toHaveLength(1)
  })
})

describe('the templates follow the Domain Connect rules', () => {
  it('are named <providerId>.<serviceId>.json under the provider id the server signs for', () => {
    const pem = generateKeyPairSync('rsa', { modulusLength: 2048 })
      .privateKey.export({ type: 'pkcs8', format: 'pem' })
      .toString()
    const config = readDomainConnectConfig({ DOMAIN_CONNECT_PRIVATE_KEY: pem })
    for (const [file, serviceId] of [
      [apex, DOMAIN_CONNECT_SERVICES.apex],
      [subdomain, DOMAIN_CONNECT_SERVICES.subdomain],
    ] as const) {
      expect(file.providerId).toBe(config?.providerId)
      expect(file.serviceId).toBe(serviceId)
      expect(file.providerName).toBe('Aglyn')
      expect(Number.isInteger(file.version) && file.version >= 1).toBe(true)
      // The provider returns the owner to the console the server names.
      expect(new URL(config?.redirectUri ?? '').hostname).toBe(file.syncRedirectDomain)
    }
  })

  it('require signed links, and never fall back to the phishing warning', () => {
    for (const file of [apex, subdomain]) {
      expect(file.syncPubKeyDomain).toBe('aglyn.com')
      expect(file.syncRedirectDomain).toBe('app.aglyn.com')
      expect(file.warnPhishing).toBeUndefined()
      expect(file.logoUrl).toMatch(/^https:\/\/.+\.(png|svg|jpg)$/)
    }
  })

  it('mark the subdomain template hostRequired, as a CNAME at @ must be', () => {
    expect(subdomain.hostRequired).toBe(true)
    expect(apex.hostRequired).toBeUndefined()
  })
})
