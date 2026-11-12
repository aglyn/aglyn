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
  DEFAULT_ICON,
  mdiCheckCircleOutline,
  mdiInformationOutline,
} from '@aglyn/shared-data-mdi'
import { render } from '@testing-library/react'
import { MdiIcon } from './mdi-icon'

/** The `d` of the one `<path>` an icon drew. */
const drawn = (ui: JSX.Element) => {
  const { container } = render(ui)
  return container.querySelector('svg path')?.getAttribute('d')
}

/**
 * A generated icon is an object (`{ id, name, path, … }`), not a path
 * string. Handing one to `path` used to draw DEFAULT_ICON, the "?" diamond,
 * which is what every tick on the marketplace Install card showed (AGL-4047).
 */
describe('MdiIcon', () => {
  it('draws a path string as given', () => {
    expect(drawn(<MdiIcon path={mdiCheckCircleOutline.path} />)).toBe(
      mdiCheckCircleOutline.path,
    )
  })

  it("draws a generated icon object's own path, not the \"?\" diamond", () => {
    expect(drawn(<MdiIcon path={mdiCheckCircleOutline} />)).toBe(
      mdiCheckCircleOutline.path,
    )
    expect(drawn(<MdiIcon path={mdiInformationOutline} />)).toBe(
      mdiInformationOutline.path,
    )
  })

  it('falls back to the default icon only when there is no path at all', () => {
    expect(drawn(<MdiIcon />)).toBe(DEFAULT_ICON.path)
    expect(drawn(<MdiIcon path="" />)).toBe(DEFAULT_ICON.path)
    expect(drawn(<MdiIcon path={{ path: '' }} />)).toBe(DEFAULT_ICON.path)
  })

  it('hands the resolved path to a render-function child', () => {
    const { container } = render(
      <MdiIcon path={mdiCheckCircleOutline}>
        {(d) => <path data-testid="custom" d={d} />}
      </MdiIcon>,
    )
    expect(
      container.querySelector('[data-testid="custom"]')?.getAttribute('d'),
    ).toBe(mdiCheckCircleOutline.path)
  })
})
