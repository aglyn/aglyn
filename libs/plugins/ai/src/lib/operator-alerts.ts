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

import type { OperatorAlertDefinition } from '@aglyn/aglyn/app-utils/operator-alerts'
import { AI_PLUGIN_ID } from './constants'

/**
 * The AI plugin's operator alert (AGL-3377): the platform's provider account
 * refused its key or ran out of credit, so every AI feature on the install
 * fails. Provider-generic — each adapter classifies its own vendor's answer
 * as an `accountProblem`, and the runtime raises this with the provider's
 * label — so a self-hoster on any provider hears the same thing.
 */
export const AI_PROVIDER_UNAVAILABLE: OperatorAlertDefinition = {
  type: 'ai.providerUnavailable',
  pluginId: AI_PLUGIN_ID,
  label: 'Platform AI provider unavailable',
  description:
    'The platform’s AI provider refused its key or ran out of credit, so every AI feature on the install is failing until the key or the balance is fixed.',
  tier: 'should',
  category: 'ops',
  title: '{{provider}} is refusing requests',
  body:
    'The platform’s {{provider}} account refused a request because {{reason}}. AI features fail until it is fixed ({{keyEnv}}).',
  delivery: 'immediate',
  dedupeWindowMinutes: 6 * 60,
  defaultEnabled: true,
}

/**
 * An AI job failed on our side: a provider error, a step that produced
 * nothing usable, a build that delivered nothing. Not a model declining the
 * brief, and not a site with AI switched off — those are the customer's, and
 * the customer is told. Deduped per job kind, so an outage is one alert an
 * hour for each kind it breaks rather than one per job; the runner's own
 * words are in `{{error}}`, and every failure is in the log as `ai job failed`.
 */
export const AI_JOB_FAILED: OperatorAlertDefinition = {
  type: 'ai.jobFailed',
  pluginId: AI_PLUGIN_ID,
  label: 'An AI job failed',
  description:
    'An AI job (a site, page, build, theme…) failed on the platform’s side, so a customer got nothing for their request. Read the error, then search the logs for “ai job failed” to see whether it is one job or every job of that kind.',
  tier: 'should',
  category: 'ops',
  title: 'An AI {{kind}} job failed',
  body:
    'AI job {{jobId}} ({{kind}}) in workspace {{orgId}} failed at step {{step}}: {{error}}. The customer was told and given back the credits. Further {{kind}} failures within the hour are counted into the next alert.',
  link: '/admin/orgs/{{orgId}}',
  delivery: 'immediate',
  dedupeWindowMinutes: 60,
  defaultEnabled: true,
}

/**
 * A build finished with part of it missing: it delivered something, so the
 * job is `done`, but one or more of its items failed on our side (AGL-3683).
 * The customer has a site or build with holes in it and no failed job to
 * show for it, which is why it is its own alert. Items the model declined
 * are the customer's and do not count. Deduped per job kind, like
 * `ai.jobFailed`.
 */
export const AI_BUILD_PARTLY_FAILED: OperatorAlertDefinition = {
  type: 'ai.buildPartlyFailed',
  pluginId: AI_PLUGIN_ID,
  label: 'An AI build finished with parts missing',
  description:
    'An AI build (a site, or a multi-part build) finished, but some of its parts failed on the platform’s side, so the customer got less than they asked for. Read which parts and why, then search the logs for the job id.',
  tier: 'should',
  category: 'ops',
  title: 'An AI {{kind}} build finished with {{failed}} of {{total}} parts failed',
  body:
    'AI job {{jobId}} ({{kind}}) in workspace {{orgId}} finished, but {{failed}} of its {{total}} parts failed on our side: {{items}}. The customer was given back those parts’ credits. Further partial {{kind}} builds within the hour are counted into the next alert.',
  link: '/admin/orgs/{{orgId}}',
  delivery: 'immediate',
  dedupeWindowMinutes: 60,
  defaultEnabled: true,
}
