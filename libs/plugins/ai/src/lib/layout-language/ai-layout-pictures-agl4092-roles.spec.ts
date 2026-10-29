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

import type { NodesMap } from '@aglyn/aglyn/types/nodes'
import { aiLayoutPictureRole, aiLayoutPictureSlots } from './ai-layout-pictures'

/*
 * Rut Runners Racing's home page of the 2026-10-28 live check (AGL-4092):
 * its band "The team in pictures: garage, track and podium" was read as
 * portraits of the team, because its name says "team", so every cell was an
 * about picture, searched among people as "motocross race team gate drop",
 * and "Gate drop" took a man posing with a street bike. A band of pictures is
 * the gallery's whatever its name says; a cell of it is a portrait only where
 * its own words are of people. "Meet the riders" is still the team's people.
 * Pure.
 */

const SECTIONS = [
  'Hero with team tagline and Meet the riders button',
  'How to start: four steps to join the team',
  'Programs: classes our riders race in',
  'The team in pictures: garage, track and podium',
  'Meet the riders',
]

/** A page of the five sections, each picture an empty slot in a frame of its section. */
function page(pictures: Record<number, readonly string[]>): NodesMap {
  const nodes: Record<string, { componentId: string; props?: Record<string, unknown>; nodes?: string[] }> = {
    root: { componentId: 'div', nodes: SECTIONS.map((_name, index) => `section-${index}`) },
  }
  for (const [index] of SECTIONS.entries()) {
    const frames = (pictures[index] ?? []).map((alt, at) => {
      const frame = `frame-${index}-${at}`
      nodes[frame] = { componentId: 'muiBox', nodes: [`image-${index}-${at}`] }
      nodes[`image-${index}-${at}`] = { componentId: 'image', props: { alt } }
      return frame
    })
    nodes[`section-${index}`] = { componentId: 'section', nodes: frames }
  }
  return nodes as unknown as NodesMap
}

describe('a band of pictures is the gallery’s (AGL-4092, 2026-10-28)', () => {
  it('reads every cell of "The team in pictures" as the gallery’s, whatever the band’s name says', () => {
    for (const alt of ['Gate drop', 'Garage nights', 'Podium', 'Home track', 'Practice days'])
      expect([alt, aiLayoutPictureRole({ sectionIndex: 3, sectionName: SECTIONS[3] as string, alt })]).toEqual([alt, 'gallery'])
    for (const sectionName of ['The team at the track in pictures', 'Photos from race day', 'Our crew in photos', 'Team photo gallery'])
      expect([sectionName, aiLayoutPictureRole({ sectionIndex: 2, sectionName, alt: 'Gate drop' })]).toEqual([sectionName, 'gallery'])
  })

  it('keeps a cell of people, and "Meet the riders", the team’s', () => {
    expect(aiLayoutPictureRole({ sectionIndex: 3, sectionName: SECTIONS[3] as string, alt: 'Team families at the fence' })).toBe('about')
    expect(aiLayoutPictureRole({ sectionIndex: 3, sectionName: SECTIONS[3] as string, alt: 'Meet the crew' })).toBe('about')
    expect(aiLayoutPictureRole({ sectionIndex: 4, sectionName: SECTIONS[4] as string, alt: 'Youth rider, 65cc class' })).toBe('about')
    expect(aiLayoutPictureRole({ sectionIndex: 0, sectionName: SECTIONS[3] as string, alt: 'Gate drop' })).toBe('hero')
    // A band that is not of pictures still reads the team in its name.
    expect(aiLayoutPictureRole({ sectionIndex: 1, sectionName: SECTIONS[1] as string, alt: 'Signing up at the trailer' })).toBe('about')
  })

  it('reads the slots of the stored page so', () => {
    const slots = aiLayoutPictureSlots(page({ 3: ['Gate drop', 'Garage nights', 'Podium'], 4: ['Youth rider, 65cc class', 'Vet class rider'] }), 'root', {
      ids: SECTIONS.map((_name, index) => `section-${index}`),
      names: SECTIONS,
    })
    expect(slots.map((slot) => [slot.alt, slot.role])).toEqual([
      ['Gate drop', 'gallery'],
      ['Garage nights', 'gallery'],
      ['Podium', 'gallery'],
      ['Youth rider, 65cc class', 'about'],
      ['Vet class rider', 'about'],
    ])
  })
})
