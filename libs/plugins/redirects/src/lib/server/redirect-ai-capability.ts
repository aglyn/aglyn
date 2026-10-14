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
  registerPluginAiCapability,
  type PluginAiCapability,
  type PluginAiCapabilityArgs,
} from '@aglyn/aglyn/plugin-manager/plugin-ai-capabilities'
import { BUNDLE_ID } from '../constants/bundle-common'
import {
  REDIRECT_DRAFT_ACTIONS,
  REDIRECT_DRAFT_DESTINATION_MAX,
  REDIRECT_DRAFT_RESOURCE,
  REDIRECT_DRAFT_SOURCE_MAX,
} from '../model/redirect-draft-content'
import { REDIRECT_KINDS, REDIRECT_STATUS_CODES } from '../model/redirects'

/**
 * WHAT AN AI BUILD CAN DO WITH REDIRECTS (AGL-3745): create, change and remove
 * a site's redirect rules — "redirect /old-menu to /menu", "send /shop to my
 * store page", "stop redirecting /promo".
 *
 * The capability the AI plugin's build planner offers; its item is written by
 * this plugin's `redirect` writer (`redirect-ai-writer.ts`), so every rule is
 * the redirects page's: the publishing role, the `redirects` feature, the
 * `redirectsPerHost` allowance on a create, lockdown, the page's validation,
 * duplicates and loops, and a published page's path kept unless the person
 * asked. No model runs: the planner fills the arguments and they ARE the
 * change, so an item costs no credits.
 *
 * Free has no redirects (`redirectsPerHost: 0`, no `redirects` feature), so a
 * Free workspace's build is never offered one. No page block depends on it.
 *
 * A rule is live once written (`live`): a redirect has no draft state, and the
 * console's own Save writes it live. The build's plan card is the person's
 * agreement to it, so the intent says so.
 */

/** The operation's name in a build plan. */
export const REDIRECT_AI_OP = 'redirect'

/** The writer's content for an item: its arguments, the status code read as the number the rule stores. */
export function redirectDraftContentFromArgs(args: PluginAiCapabilityArgs): Readonly<Record<string, unknown>> {
  const content: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(args)) {
    if (value === undefined || value === null || value === '') continue
    content[key] = key === 'statusCode' && typeof value === 'string' ? Number(value) : value
  }
  return content
}

export const redirectAiCapability: PluginAiCapability = {
  op: REDIRECT_AI_OP,
  noun: 'redirect',
  where: 'Redirects',
  intents: [
    'redirects: send an old or short address on the site to a page it has, or to an https:// address; change where a redirect goes; stop a redirect. Live as soon as the build runs',
  ],
  argsSchema: {
    type: 'object',
    properties: {
      action: {
        type: 'string',
        description: 'create a new redirect, update the one at source, or remove the one at source.',
        enum: REDIRECT_DRAFT_ACTIONS,
      },
      source: {
        type: 'string',
        description:
          'The address that redirects, as a site path like /old-menu (for update and remove, the path the redirect has now). With kind regex, a pattern over the path.',
        maxLength: REDIRECT_DRAFT_SOURCE_MAX,
      },
      destination: {
        type: 'string',
        description:
          'Where visitors are sent: the path of a page the site has, from the site inventory (/menu), or an https:// address the request gives. Never a path or address the request and the inventory do not name. Required for create.',
        maxLength: REDIRECT_DRAFT_DESTINATION_MAX,
      },
      newSource: {
        type: 'string',
        description: 'update only: the new path the redirect answers at, when the request moves it.',
        maxLength: REDIRECT_DRAFT_SOURCE_MAX,
      },
      kind: {
        type: 'string',
        description:
          'exact (the default) matches the path only; prefix also matches every path under it (/blog and /blog/post); regex is a pattern. For update and remove, give it only when the site has two redirects at that path.',
        enum: REDIRECT_KINDS,
      },
      statusCode: {
        type: 'string',
        description:
          '302 (the default) while a move may change; 301 when the request says the move is permanent; 307 and 308 keep a form submission as it was sent.',
        enum: REDIRECT_STATUS_CODES.map(String),
      },
      priority: {
        type: 'integer',
        description: 'Evaluation order, lower first; leave it out for the default, 100.',
      },
      enabled: {
        type: 'boolean',
        description: 'false to keep the redirect but switch it off; leave it out otherwise.',
      },
      replacesLivePage: {
        type: 'boolean',
        description:
          'true only when the request asks to redirect the address of a page the site publishes, so the redirect takes that page\'s place. A redirect from a published page\'s path is refused without it.',
      },
    },
    required: ['action', 'source'],
    additionalProperties: false,
  },
  maxPerPlan: 10,
  // Free includes no redirects: neither the feature nor a slot.
  freeAllowed: false,
  feature: 'redirects',
  quota: 'redirectsPerHost',
  draftResource: REDIRECT_DRAFT_RESOURCE,
  live: true,
  // Written without a model: the planner already filled the arguments.
  estimateCredits: () => 0,
  degrade: 'omit',
  draftContent: (item) => redirectDraftContentFromArgs(item.args),
}

/**
 * Registers the capability; the console's server declarations call it beside
 * the writer, since only the console runs AI jobs (AGL-3026). Idempotent.
 */
export function registerRedirectAiCapability(): void {
  registerPluginAiCapability(redirectAiCapability, { pluginId: BUNDLE_ID })
}
