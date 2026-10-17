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

import { retentionDocsMergeValues } from './retention-emails'

/** Which door made the workspace the welcome email is for. */
export type WelcomeStart = 'workspace-page' | 'first-site'

export interface WelcomeEmailInput {
  /** The workspace's name, as its owner typed it. */
  orgName: string
  /** The workspace's slug; empty links the console home instead. */
  slug: string
  /** Console origin, without a trailing slash. */
  consoleOrigin: string
  /** Docs origin, without a trailing slash. */
  docsOrigin: string
  start?: WelcomeStart
}

/**
 * The welcome email's `welcome.intro` and `welcome.steps`: what is ready and
 * the next few things to do, each a "Step — link" line the email's links
 * block turns into a link. Someone whose workspace came with their first
 * site is pointed at finishing that site; someone who made an empty
 * workspace is pointed at starting one.
 */
export function welcomeEmailMergeValues(
  input: WelcomeEmailInput,
): Record<'welcome.intro' | 'welcome.steps', string> {
  const origin = input.consoleOrigin.trim().replace(/\/+$/, '')
  const slug = input.slug.trim()
  // A workspace page, or the console home when the slug is unknown.
  const page = (path: string) => (slug ? `${origin}/${slug}${path}` : origin)
  const docs = retentionDocsMergeValues(input.docsOrigin)
  const name = input.orgName.trim() || 'Your workspace'
  const firstSite = input.start === 'first-site'
  const intro = firstSite
    ? `${name} is ready, and your first site is in it. Here is how most people take it live.`
    : `${name} is ready. Here is how most people get their first site live.`
  const steps = firstSite
    ? [
        `Finish and publish your site — ${page('/hosts')}`,
        `Connect your own domain — ${docs['docs.connectDomainUrl']}`,
        `Collect leads with a form — ${docs['docs.formsUrl']}`,
        `Invite your team — ${page('/team')}`,
      ]
    : [
        `Build your first site — ${page('/hosts')}`,
        `Let AI draft it for you — ${docs['docs.generateSiteUrl']}`,
        `Invite your team — ${page('/team')}`,
        `Connect your own domain — ${docs['docs.connectDomainUrl']}`,
      ]
  return { 'welcome.intro': intro, 'welcome.steps': steps.join('\n') }
}
