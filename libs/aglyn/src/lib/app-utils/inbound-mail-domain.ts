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

/** Where the platform receives mail when the deployment names no domain. */
export const INBOUND_MAIL_DEFAULT_DOMAIN = 'in.aglyn.com'

const DOMAIN_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$/

/**
 * The domain the platform receives mail on for the workspaces it serves —
 * the one its mail provider's inbound route answers, and so one no member
 * may claim an address on (AGL-2657, AGL-2975). `CRM_INBOUND_DOMAIN`, the
 * name the deployment has always set it under, or the platform's default
 * when it names none or names something that is not a hostname. Lowercased,
 * because a domain is.
 */
export function inboundMailDomain(
  env: Record<string, string | undefined> = process.env,
): string {
  const configured = String(env['CRM_INBOUND_DOMAIN'] ?? '')
    .trim()
    .toLowerCase()
  return DOMAIN_PATTERN.test(configured) ? configured : INBOUND_MAIL_DEFAULT_DOMAIN
}
