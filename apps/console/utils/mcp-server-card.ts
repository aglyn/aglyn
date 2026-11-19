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
  connectorResourceFor,
  MCP_SERVER_CARD_SCHEMA,
  mcpServerCardName,
} from '@aglyn/aglyn/app-utils/connector-discovery'
import { CUSTOMER_API_VERSION } from './api-v1-openapi'
import { PLATFORM_HOME_URL } from '@aglyn/aglyn/app-utils/platform-brand'
import {
  MCP_SERVER_DESCRIPTION,
  MCP_SERVER_TITLE,
  MCP_SUPPORTED_PROTOCOL_VERSIONS,
} from './mcp-protocol'

/**
 * The MCP Server Card for the endpoint on `origin` (SEP-2127, Final).
 *
 * Fields are the extension schema's (`schema.ts` in
 * modelcontextprotocol/experimental-ext-server-card): `$schema`, `name`,
 * `version` and `description` are required, the rest optional.
 *
 * ## What it says about sign-in, and what it deliberately does not
 *
 * The card format has no authentication field. A client learns that this
 * endpoint takes OAuth the way the MCP authorization specification says it
 * must: from the 401's `WWW-Authenticate: Bearer resource_metadata=…` and the
 * RFC 9728 document it names. Restating that here would be a second,
 * unvalidated copy of the same facts.
 *
 * The API key IS described, as the one optional header the schema provides
 * for it (`isRequired: false`, `isSecret: true`): a client that has a key can
 * send it instead of signing in, and one that has none leaves the header out
 * and is challenged. The card carries no credential — only the shape of one.
 *
 * Tools are not listed. The extension excludes primitives on purpose, because
 * they vary by caller; ours vary by the scopes a key or connection holds.
 */
export function buildMcpServerCard(options: {
  origin: string
  documentationUrl: string
}): Record<string, unknown> {
  return {
    $schema: MCP_SERVER_CARD_SCHEMA,
    name: mcpServerCardName(options.origin),
    version: CUSTOMER_API_VERSION,
    title: MCP_SERVER_TITLE,
    description: MCP_SERVER_DESCRIPTION,
    // The product's home, as the MCP Registry entry lists it; a self-hosted
    // install with no home URL of its own points at its docs instead.
    websiteUrl: PLATFORM_HOME_URL ?? options.documentationUrl,
    remotes: [
      {
        type: 'streamable-http',
        url: connectorResourceFor(options.origin),
        supportedProtocolVersions: [...MCP_SUPPORTED_PROTOCOL_VERSIONS],
        headers: [
          {
            name: 'Authorization',
            description:
              'Optional. An API key, instead of signing in. Leave it out and the client is asked to sign in.',
            isRequired: false,
            isSecret: true,
            value: 'Bearer {api_key}',
            variables: {
              api_key: {
                description: 'An API key from Settings → API keys (aglyn_sk_…).',
                isRequired: false,
                isSecret: true,
              },
            },
          },
        ],
      },
    ],
  }
}
