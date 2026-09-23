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

import { createFirstTouchKit, type FirstTouchConfig } from './first-touch'
import {
  FIRST_TOUCH_PAGE_GLOBAL,
  FIRST_TOUCH_PAGE_STORAGE_GLOBAL,
} from './first-touch-page'

/**
 * The capture as a script a page runs with no bundler: the kit's own source
 * text, called with this surface's configuration.
 *
 * Served by the platform at one URL so that including the capture on a new
 * surface is one tag — `<script src="…/api/first-touch" async>` — and the
 * host registry, the hand-off endpoint and the storage decision arrive with
 * it rather than being configured on each surface.
 *
 * Two page-side overrides, both read at boot:
 *
 * - `data-consent="pending"` on the tag holds the record in memory until the
 *   page's consent code grants storage — for a surface whose own consent tool
 *   decides after load;
 * - a decision the page's code already left through
 *   `setPageFirstTouchStorage` before the script arrived wins over both the
 *   attribute and the served default, because it is the newest answer.
 *
 * Everything runs inside a `try`: a capture that throws must never cost the
 * page it runs on.
 */
export function firstTouchScript(config: FirstTouchConfig): string {
  const served = JSON.stringify({
    hosts: [...(config.hosts ?? [])],
    storage: config.storage === undefined ? true : config.storage,
    handoffUrl: config.handoffUrl ?? null,
  })
    // Inline in a `<script>` element as well as served, so nothing in the
    // configuration may close the element or break a pre-2019 parser.
    .replace(/</g, '\\u003c')
    .replace(/\u2028/g, '\\u2028')
    .replace(/\u2029/g, '\\u2029')
  return (
    '(function(){try{' +
    `var c=${served};` +
    'var w=window;var s=document.currentScript;' +
    "if(s&&s.getAttribute('data-consent')==='pending')c.storage=null;" +
    `var q=w[${JSON.stringify(FIRST_TOUCH_PAGE_STORAGE_GLOBAL)}];` +
    'if(q===true||q===false||q===null)c.storage=q;' +
    `w[${JSON.stringify(FIRST_TOUCH_PAGE_GLOBAL)}]=(${createFirstTouchKit.toString()})().boot(c);` +
    '}catch(e){}})();'
  )
}
