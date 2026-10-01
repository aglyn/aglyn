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

import { INBOUND_MAIL_DEFAULT_DOMAIN, inboundMailDomain } from './inbound-mail-domain'

describe('the domain the platform receives mail on (AGL-2657)', () => {
  it('reads the domain off the environment and falls back to the platform default', () => {
    expect(inboundMailDomain({})).toBe(INBOUND_MAIL_DEFAULT_DOMAIN)
    expect(inboundMailDomain({ CRM_INBOUND_DOMAIN: ' In.Example.COM ' })).toBe('in.example.com')
    // Not a hostname: the default, not a broken address.
    expect(inboundMailDomain({ CRM_INBOUND_DOMAIN: 'not a domain' })).toBe(
      INBOUND_MAIL_DEFAULT_DOMAIN,
    )
  })

})
