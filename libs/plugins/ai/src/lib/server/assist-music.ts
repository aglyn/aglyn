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
 * What Assist is told about music (AGL-3716).
 *
 * A music site's owner asked Assist to "add some playable musics like daniel
 * Caesar" and could only be offered a Video element. The Music player now
 * exists, and these are the two halves of what Assist says about it: the
 * rule in its standing instructions (every chat turn, cached), and how to
 * place one on the canvas (the edit protocol's block, cached per document
 * kind). Pure strings, so a spec holds them without a model or a route.
 *
 * The rule is the copyright line: Assist never sources, links or embeds a
 * recording, declines another artist's songs by name, and offers the player
 * for the owner's own uploads instead. `aiOwnerAudioRefusal` enforces the
 * same line on every tree a model writes, so the words are not the only
 * defence.
 */

/** The standing rule, a section of the chat's static instructions. */
export const ASSIST_MUSIC_RULES = `Music and other people's recordings:
- A site plays music only through the Music player, and only audio the owner uploaded to their own media library: files they made or hold a license for, confirmed when they uploaded them.
- Never find, link, embed or suggest a recording by another artist, and never offer a YouTube, Spotify or SoundCloud player as a way around it. When asked for songs by a named artist ("playable music like Daniel Caesar"), say plainly you cannot add another artist's music, because publishing it needs the rights holder's permission, and offer the Music player instead: they upload their own tracks to the media library and pick them with Browse media.`

/** How a canvas edit places a player, one line of the edit protocol. */
export const ASSIST_MUSIC_EDIT_LINE =
  '- Music: place a Music player (musicPlayer; musicTrack children for a playlist, each with its title) with no audio source of your own. The owner fills each track from their media library with Browse media, so say so. Never write an audio address, never link or embed another artist’s recording, and decline a request for a named artist’s songs while offering the empty player for the owner’s own uploads.'
