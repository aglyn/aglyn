/**
 * @license
 * Copyright 2022 Aglyn LLC
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

import { operatorIdentity } from '../../app-utils/operator-identity'

/**
 * Who to contact about THIS deployment, in the browser-console greeting
 * (AGL-2016).
 *
 * The banner used to end with *"you may send an email to 'info@aglyn.com'"* on
 * every install. On a self-hosted console that is an invitation, printed by
 * the operator's own product to the operator's own developers, to take their
 * support question to a company with no access to the system.
 *
 * The ASCII art and the copyright line stay, and deliberately: this is
 * Apache-2.0 software and attribution to the authors is correct however it is
 * deployed. What changes is the sentence that confuses *authorship* with
 * *operation* — the project's URL is ours, the support channel is the
 * operator's. Unconfigured prints neither rather than falling back to ours.
 */
function operatorGreetingLine(): string {
  const support = operatorIdentity().supportEmail
  return support ? `\nFor help with this deployment, email '${support}'.` : ''
}

const y = new Date().getFullYear()
export const CONSOLE_GREETING_STYLES =
  'font-family:"Courier New",monospace;color:#E040FB;font-size:12px;'
export const CONSOLE_GREETING = `%c
       d8888          888                         888      888       .d8888b.
      d88888          888                         888      888      d88P  Y88b
     d88P888          888                         888      888      888    888
    d88P 888  .d88b.  888 888  888 88888b.        888      888      888
   d88P  888 d88P"88b 888 888  888 888 "88b       888      888      888
  d88P   888 888  888 888 888  888 888  888       888      888      888    888
 d8888888888 Y88b 888 888 Y88b 888 888  888       888      888      Y88b  d88P
d88P     888  "Y88888 888  "Y88888 888  888       88888888 88888888  "Y8888P"
                  888          888
             Y8b d88P     Y8b d88P
              "Y88P"       "Y88P"

                     Aglyn — open source, Apache-2.0. Copyright (c) ${y} Aglyn LLC.

Hello there, Friend! 👋
${operatorGreetingLine()}
For the software itself, visit 'https://aglyn.com'.

— Aglyn Engineering Team
`

if (typeof window !== 'undefined') {
  console.log(CONSOLE_GREETING, CONSOLE_GREETING_STYLES)
}
