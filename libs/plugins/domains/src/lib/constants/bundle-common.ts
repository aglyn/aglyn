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

/** Stable plugin id — persisted in org.enabledPlugins; never rename. */
export const BUNDLE_ID = 'domains'

/** Firestore collections this plugin owns (declared in plugins.config.json). */
export const DOMAINS_COLLECTIONS = {
  /** `domainRegistrations/{domain}` — one per domain bought through Aglyn. */
  registrations: 'domainRegistrations',
  /** `domainConnectSessions/{id}` — one-click DNS hand-offs (AGL-3963). */
  connectSessions: 'domainConnectSessions',
} as const

/**
 * The console API routes, under `/api/`. Two prefixes rather than one
 * `domains/`: core already serves `/api/domains/attach` and its siblings,
 * and a plugin path inside a core route's folder would depend on Next's
 * static-before-catch-all ordering to reach the right handler.
 */
export const DOMAINS_API_ROUTES = {
  search: 'registrar/search',
  purchase: 'registrar/purchase',
  registrations: 'registrar/registrations',
  autoRenew: 'registrar/auto-renew',
  renewNow: 'registrar/renew-now',
  transferOut: 'registrar/transfer-out',
  reconnect: 'registrar/reconnect',
  /** The workspace's Domains page (AGL-4040). */
  workspace: 'registrar/workspace',
  connect: 'registrar/connect',
  disconnect: 'registrar/disconnect',
  contact: 'registrar/contact',
  dns: 'registrar/dns',
  transferInQuote: 'registrar/transfer-in-quote',
  transferIn: 'registrar/transfer-in',
  connectDiscover: 'domain-connect/discover',
  connectStart: 'domain-connect/start',
  connectFinish: 'domain-connect/finish',
  /** Where a DNS provider sends the owner's browser back to; no session. */
  connectReturn: 'domain-connect/return',
} as const

/** The console job that finishes one-click DNS sessions (AGL-3963). */
export const DOMAIN_CONNECT_JOB_ID = 'domains-connect-sessions'
