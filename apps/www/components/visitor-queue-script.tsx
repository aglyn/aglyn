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

const visitorQueueScriptContent = 'function vqTrackId(){return \'9afe17e1-01f4-4b18-9704-28a3d489dcef\';} (function(d, e) { var el = d.createElement(e); el.sa = function(an, av){this.setAttribute(an, av); return this;}; el.sa(\'id\', \'vq_tracking\').sa(\'src\', \'//t.visitorqueue.com/p/tracking.min.js?id=\'+vqTrackId()).sa(\'async\', 1).sa(\'data-id\', vqTrackId()); d.getElementsByTagName(e)[0].parentNode.appendChild(el); })(document, \'script\'); '

function VisitorQueueScript() {
  return (
    <script dangerouslySetInnerHTML={{__html: visitorQueueScriptContent}} />
  )
}
VisitorQueueScript.displayName = 'VisitorQueueScript'
VisitorQueueScript.aglyn = true

export {VisitorQueueScript}
export default VisitorQueueScript
