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

/**
 * The two halves of the help tip keep their own timing (AGL-2706).
 *
 * The excerpts moved into a chunk fetched when a tooltip opens, which is only
 * a saving if the prose still ARRIVES — a broken loader would show an empty
 * tooltip on a hover nobody automates, and every existing help spec would
 * stay green, because they read the title and the href.
 *
 * The other half is the one that must not become deferred. A help button's
 * accessible name is built from its topic's title, and its `href` from the
 * topic's path; both are read before anyone hovers, by a screen reader
 * announcing the control and by a middle-click that opens the docs. So this
 * asserts what each half is: title and href are strings at call time, the
 * excerpt is a node that resolves to the docs description.
 */

import { render, screen } from '@testing-library/react'

import { DOCS_HELP_EXCERPTS } from '../constants/docs-help-excerpts.generated'
import { DOCS_HELP_TOPICS, docsHelp } from '../constants/docs-links'

describe('a help topic resolved through docsHelp', () => {
  it('answers with the title and href before anything is fetched', () => {
    const help = docsHelp('billing')
    expect(help.title).toBe(DOCS_HELP_TOPICS.billing.title)
    expect(help.href).toContain(DOCS_HELP_TOPICS.billing.path)
  })

  it('resolves the excerpt to the docs description once it mounts', async () => {
    render(<div>{docsHelp('billing').excerpt}</div>)
    expect(await screen.findByText(DOCS_HELP_EXCERPTS.billing)).toBeTruthy()
  })

  it('never reaches the chunk when the caller wrote its own excerpt', () => {
    // A card that writes its own sentence is the common case on the pages that
    // cover several subjects, and it has no reason to wait on a fetch.
    const help = docsHelp('billing', { excerpt: 'Just this one control.' })
    expect(help.excerpt).toBe('Just this one control.')
  })
})
