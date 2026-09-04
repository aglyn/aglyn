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
'use client'

import SiteEmailsCard from '../../../../../../../../components/site-emails-card.component'

/**
 * Emails — the site's transactional templates (AGL-769).
 *
 * The rows are a code catalog; the only Firestore read behind them is a
 * pointer document per CUSTOMIZED template, so this section is the cheapest of
 * the five despite listing every message the platform can send.
 */
export default function HostSetupEmailsSection() {
  return <SiteEmailsCard />
}
