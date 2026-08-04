/**
 * @jest-environment jsdom
 */
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

import Button from '@mui/material/Button'
import { render } from '@testing-library/react'
import { dropClearedProps } from './drop-cleared-props'

describe('dropClearedProps (AGL-1226)', () => {
  it('drops null and empty-string values', () => {
    expect(dropClearedProps({ color: null, variant: 'text' })).toEqual({
      variant: 'text',
    })
    expect(dropClearedProps({ size: '' })).toEqual({})
  })

  it('keeps 0 and false, which are real author choices', () => {
    expect(dropClearedProps({ elevation: 0, disabled: false })).toEqual({
      elevation: 0,
      disabled: false,
    })
  })

  it('returns the same object when nothing was cleared', () => {
    const props = { color: 'primary', variant: 'contained' }
    expect(dropClearedProps(props)).toBe(props)
  })

  it('leaves undefined alone (React already defaults it)', () => {
    expect(dropClearedProps({ color: undefined })).toEqual({
      color: undefined,
    })
  })
})

/**
 * The bug itself, reproduced against real MUI rather than asserted.
 *
 * `color={null}` took every /product/* page on the public marketing site to a
 * 500 — MUI builds `color${capitalize(color)}` and capitalize throws on a
 * non-string. React does not substitute a default for an explicit null.
 */
describe('the throw this exists to prevent', () => {
  const renderButton = (props: Record<string, unknown>) =>
    render(<Button {...(props as never)}>Go</Button>)

  it('MUI really does throw on a null color', () => {
    // Guard the premise: if MUI ever stops throwing, the fix is moot and this
    // test should be the thing that tells us.
    expect(() => renderButton({ color: null })).toThrow(
      /capitalize|Minified MUI error #7/,
    )
  })

  it('does not throw once the cleared prop is dropped', () => {
    expect(() => renderButton(dropClearedProps({ color: null }))).not.toThrow()
  })

  it('renders the author-chosen colour when one is set', () => {
    const { container } = renderButton(dropClearedProps({ color: 'secondary' }))
    expect(container.querySelector('.MuiButton-colorSecondary')).not.toBeNull()
  })
})
