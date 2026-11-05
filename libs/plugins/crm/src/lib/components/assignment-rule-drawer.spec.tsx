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
 * The Source menu offers what a capture can carry (AGL-4042): the core's words and
 * every door a plugin declared, read the way the list's own filter reads them, and
 * the rule keeps the word it was picked with.
 */

import { registerPluginContactSource } from '@aglyn/aglyn/plugin-manager/plugin-contact-capture'
import { unregisterPluginServices } from '@aglyn/aglyn/plugin-manager/plugin-services'
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import AssignmentRuleDrawer from './assignment-rule-drawer'

const openSourceMenu = () => {
  fireEvent.mouseDown(screen.getByRole('combobox', { name: 'Source' }))
  return within(screen.getByRole('listbox'))
}

const drawer = (onSubmit = jest.fn()) => {
  render(
    <AssignmentRuleDrawer
      open
      onClose={jest.fn()}
      members={[]}
      membersLoading={false}
      poolSize={2}
      existingIds={[]}
      onSubmit={onSubmit}
    />,
  )
  return onSubmit
}

afterEach(() => unregisterPluginServices('kiosk'))

it('offers the core sources, and no source no plugin declared', () => {
  drawer()
  const menu = openSourceMenu()
  expect(menu.getByRole('option', { name: 'Any source' })).toBeTruthy()
  expect(menu.getByRole('option', { name: 'Form' })).toBeTruthy()
  expect(menu.queryByRole('option', { name: 'Guest book' })).toBeNull()
})

it('offers a source a plugin declared, and the rule keeps its word', async () => {
  registerPluginContactSource({ source: 'kiosk', label: 'Guest book' }, { pluginId: 'kiosk' })
  const onSubmit = drawer()
  fireEvent.click(openSourceMenu().getByRole('option', { name: 'Guest book' }))
  fireEvent.click(screen.getByRole('radio', { name: /round robin/i }))
  fireEvent.click(screen.getByRole('button', { name: /add rule|save/i }))
  await waitFor(() => expect(onSubmit).toHaveBeenCalledTimes(1))
  expect(onSubmit.mock.calls[0][0]).toMatchObject({
    when: { source: 'kiosk' },
    assign: { roundRobin: true },
  })
})
