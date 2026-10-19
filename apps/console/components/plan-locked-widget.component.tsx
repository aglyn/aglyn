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

import { CardDisplay } from '@aglyn/shared-ui-jsx'
import { PlanUpsellNotice } from '@aglyn/shared-ui-jsx/components/plan-upsell-notice.component'
import { docsHelp } from '../constants/docs-links'

/** What the shell hands the card it draws in a locked widget's place. */
export interface PlanLockedWidgetContent {
  /** The widget's own title: the card a paid plan would show here. */
  title: string
  /** The widget's `lockedPreview.description`. */
  description: string
  planLabel: string | undefined
  upgradeHref: string | undefined
}

/**
 * The card a dashboard shows in place of a widget whose feature the plan
 * lacks (`ConsoleWidget.lockedPreview`, AGL-3977): the card's name, what it
 * does, and the plan that includes it, with one click to the plan grid.
 *
 * The shell mounts this instead of the widget, so nothing the plan does not
 * allow is read to draw it. It takes the zone's props like any widget and
 * ignores them.
 */
export function PlanLockedWidget(props: { lockedWidget?: PlanLockedWidgetContent }) {
  const { lockedWidget } = props
  if (!lockedWidget) return null
  return (
    <CardDisplay
      header={lockedWidget.title}
      help={docsHelp('billing', {
        anchor: '#locked-features',
        excerpt: 'Why a card is locked, and the plan that turns it on.',
      })}
      contentGutterX
      contentGutterY
    >
      <PlanUpsellNotice
        planLabel={lockedWidget.planLabel}
        upgradeHref={lockedWidget.upgradeHref}
      >
        {lockedWidget.description}
      </PlanUpsellNotice>
    </CardDisplay>
  )
}

PlanLockedWidget.displayName = 'PlanLockedWidget'

export default PlanLockedWidget
