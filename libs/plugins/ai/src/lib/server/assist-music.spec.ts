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

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { aiOwnerAudioRefusal, validateAiNodePatch, validateAiNodeTree } from '../runtime/ai-node-tree'
import { AI_PALETTE_CATALOG, AI_SURFACES } from '../runtime/ai-palette.generated'
import { editCanvasBlock } from './assist-edit'
import { ASSIST_MUSIC_EDIT_LINE, ASSIST_MUSIC_RULES } from './assist-music'

/*
 * Assist and the Music player (AGL-3716). An owner asked Assist to "add some
 * playable musics like daniel Caesar" and was offered only a Video element.
 * Assist now knows the player, places it empty for the owner's own uploads,
 * and declines another artist's songs. No live model call: the prompt and the
 * validator are what decide it.
 */

describe('what Assist is told', () => {
  it('names the Music player and its tracks in its own edit line, which the page catalog leaves to it', () => {
    const block = editCanvasBlock('screen')
    expect(block).toContain('musicPlayer')
    expect(block).toContain('musicTrack')
    expect(block).toContain(ASSIST_MUSIC_EDIT_LINE)
    // Admitted on the page surface, unlisted in its catalog, so a Free page
    // pass never pays for it (AGL-3716).
    expect(AI_SURFACES.screen.allow).toEqual(expect.arrayContaining(['musicPlayer', 'musicTrack']))
    expect(AI_PALETTE_CATALOG.screen).not.toContain('musicPlayer')
    // The owner's rights answer is never on offer to a model.
    expect(AI_PALETTE_CATALOG.screen).not.toContain('rightsConfirmed')
  })

  it('declines another artist’s songs and offers the player for the owner’s own', () => {
    expect(ASSIST_MUSIC_RULES).toMatch(/Never find, link, embed or suggest a recording by another artist/)
    expect(ASSIST_MUSIC_RULES).toMatch(/cannot add another artist's music/)
    expect(ASSIST_MUSIC_RULES).toMatch(/offer the Music player instead/)
  })

  it('rides every chat turn’s static instructions', () => {
    const source = readFileSync(join(__dirname, 'assist-chat.ts'), 'utf8')
    expect(source).toMatch(/const STATIC_SYSTEM = `[\s\S]*\$\{ASSIST_MUSIC_RULES\}[\s\S]*\$\{AI_ACCEPTABLE_USE_BLOCK\}`/)
  })
})

describe('what a model writes on a player is held to the owner’s own audio', () => {
  it('keeps a library reference and drops any other source', () => {
    expect(aiOwnerAudioRefusal('music', 'src', 'media:host1/track1')).toBeNull()
    expect(aiOwnerAudioRefusal('music', 'src', 'https://cdn.example.com/get-you.mp3')).toMatch(/own media library/)
    expect(aiOwnerAudioRefusal('music', 'rightsConfirmed', true)).toMatch(/only the site owner/)
    expect(aiOwnerAudioRefusal('mui', 'src', 'https://example.com/a.mp4')).toBeNull()
  })

  it('drops an external recording and a rights claim from an edit to a player', () => {
    const result = validateAiNodePatch('musicPlayer', {
      props: { src: 'https://cdn.example.com/get-you.mp3', rightsConfirmed: 'true', title: 'Get You' },
    })
    if (result.ok === false) throw new Error(result.error)
    expect(result.props).toEqual({ title: 'Get You' })
    expect(result.repairs.join(' ')).toMatch(/never a recording from elsewhere/)
  })

  it('stores an inserted playlist with its titles and no sources', () => {
    const result = validateAiNodeTree(
      {
        rootId: 'root',
        nodes: {
          root: { componentId: 'div', nodes: ['p'] },
          p: { componentId: 'musicPlayer', props: { heading: 'Listen' }, nodes: ['t1', 't2'] },
          t1: { componentId: 'musicTrack', props: { title: 'One', src: 'https://example.com/one.mp3' } },
          t2: { componentId: 'musicTrack', props: { title: 'Two', rightsConfirmed: true } },
        },
      },
      'screen',
    )
    if (result.ok === false) throw new Error(result.error)
    const nodes = Object.values(result.nodes as Record<string, { componentId: string; props?: Record<string, unknown> }>)
    const tracks = nodes.filter((node) => node.componentId === 'musicTrack')
    expect(tracks.map((node) => node.props?.['title'])).toEqual(['One', 'Two'])
    for (const track of tracks) {
      expect(track.props?.['src']).toBeUndefined()
      expect(track.props?.['rightsConfirmed']).toBeUndefined()
    }
  })
})
