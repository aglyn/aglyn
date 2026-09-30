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
 * A VIDEO HOST WHOSE OWN PLAYER A VIDEO PLAYS IN (AGL-3080).
 *
 * Some video hosts hand an author a link to a page, not to a file: the film
 * plays only inside the host's player, framed from the host's origin. The
 * Video element recognizes such a link, keeps only the media id it names,
 * and frames the host's player for it. Core never names a host. A plugin
 * DECLARES one — the domains its links live on, where in the path the media
 * id sits, the one origin its player is framed from, and the query that
 * player reads — and core's resolvers answer from the declarations alone.
 *
 * This sits beside `media-delivery-provider.ts` and is not that seam. A
 * delivery provider is where the platform serves ITS OWN copy of a file
 * from; an embed provider is a host whose player the author chose, which the
 * platform never serves a byte of.
 *
 * ## Only the media id survives
 *
 * The string an author pasted never reaches a frame. {@link videoEmbedOf}
 * reads the media id out of it, and every address below is rebuilt from the
 * declaration and that id alone, so a declared player is framed from its
 * declared origin and nowhere else. That closed set is what lets a published
 * page's `frame-src` name the origin for every site
 * ({@link videoEmbedPlayerOrigins}). The id must match the declaration's own
 * pattern AND {@link SAFE_MEDIA_ID}, so no declaration can widen the path it
 * is put into.
 *
 * ## Compiled, and deliberately without a runtime registrar
 *
 * The readers are the published page and its policy: the Video element that
 * plays the link, the `VideoObject` a crawler reads, the built-in entry page
 * that decides whether a featured film can play, and the tenant middleware
 * whose `frame-src` must admit the player. None of them loads a plugin's
 * console code, and the middleware loads no plugin at all. A registry one of
 * them had not filled would render a customer's link as a `<video>` pointed
 * at an HTML page, or refuse the frame, and nothing would go red — the
 * AGL-3025 shape, on the customer's own film. So a first-party plugin
 * declares its hosts under `videoEmbedProviders` in `plugins.config.json`,
 * `tools/scripts/generate-plugin-manifests.mjs` validates and compiles them,
 * and this module reads the compiled list.
 *
 * A marketplace plugin cannot add a host this way, and that is the point
 * rather than a gap: a declaration widens every published page's
 * `frame-src`, which is a platform decision, not one a plugin's own code
 * makes at runtime.
 *
 * ## What "absent" means
 *
 * A link no declaration recognizes is an ordinary URL, rendered exactly as
 * any other link is. Removing a declaration therefore turns its links back
 * into plain URLs, which play nothing — so the declaring plugin's spec holds
 * the declaration to the links it must keep reading.
 */

import { FIRST_PARTY_VIDEO_EMBED_PROVIDERS } from './first-party-plugins.generated'

/**
 * A choice the Video element makes for each player it frames. A declaration
 * says how its player spells each one it supports; one it does not name is
 * never sent.
 *
 *  - `autoPlay` — start as soon as the player is ready. ON unless the caller
 *    passes exactly `false`: the usual frame is the one a visitor's press
 *    loads, and a second play button inside it would ask them twice.
 *  - `doNotTrack` — ask the host not to record the viewing session.
 *  - `muted` — start without sound.
 *  - `loop` — restart at the end.
 */
export type VideoEmbedPlayerOption = 'autoPlay' | 'doNotTrack' | 'muted' | 'loop'

export const VIDEO_EMBED_PLAYER_OPTIONS: readonly VideoEmbedPlayerOption[] = [
  'autoPlay',
  'doNotTrack',
  'muted',
  'loop',
]

export type VideoEmbedPlayerOptions = Partial<
  Record<VideoEmbedPlayerOption, boolean>
>

/**
 * One query parameter of a player address, in the order the declaration
 * lists them. Either `value`, sent on every address, or an `option` whose
 * state picks `on` or `off`; a state with no value leaves the parameter out.
 */
export type VideoEmbedPlayerParam =
  | { param: string; value: string }
  | {
      param: string
      option: VideoEmbedPlayerOption
      on?: string
      off?: string
    }

export interface VideoEmbedProviderDeclaration {
  /** Stable id, unique across plugins. */
  id: string
  /** The host's name as an author knows it, for labels and help text. */
  label: string
  /**
   * The domains a link's host must equal or end in (after a dot). Exact or
   * dot-anchored only, so a domain that merely contains one is refused.
   */
  domains: readonly string[]
  /**
   * Regular expressions over a link's PATH, anchored at both ends, whose
   * first capture group is the media id. The host is checked separately,
   * against {@link domains}.
   */
  mediaIdPaths: readonly string[]
  /** A regular expression, anchored at both ends, a media id must match. */
  mediaIdPattern: string
  /** The one origin the host's player is framed from. */
  playerOrigin: string
  /** The player page's path on {@link playerOrigin}; `{id}` is the media id. */
  playerPath: string
  /** The query every player address carries, in this order. */
  playerQuery?: readonly VideoEmbedPlayerParam[]
}

/** A declaration, with the plugin that made it. */
export interface ResolvedVideoEmbedProvider
  extends VideoEmbedProviderDeclaration {
  pluginId: string
}

/** A link a declared host recognized. */
export interface VideoEmbed {
  provider: ResolvedVideoEmbedProvider
  /** The media id the link named, and nothing else of it. */
  mediaId: string
  /**
   * The player page with no per-visit options — what a `VideoObject`
   * publishes as `embedUrl`.
   */
  embedUrl: string
}

/**
 * The floor every media id stands on, whatever a declaration's own pattern
 * admits: no separator, dot, query or fragment can reach the player path.
 */
const SAFE_MEDIA_ID = /^[A-Za-z0-9_-]{1,64}$/

/** The placeholder a `playerPath` names the media id with. */
const ID_PLACEHOLDER = '{id}'

/** Every host a first-party plugin declares. */
export function videoEmbedProviders(): readonly ResolvedVideoEmbedProvider[] {
  return FIRST_PARTY_VIDEO_EMBED_PROVIDERS
}

interface CompiledProvider {
  paths: RegExp[]
  mediaId: RegExp
}

const compiled = new WeakMap<VideoEmbedProviderDeclaration, CompiledProvider>()

function compile(provider: VideoEmbedProviderDeclaration): CompiledProvider {
  let answer = compiled.get(provider)
  if (!answer) {
    answer = {
      paths: provider.mediaIdPaths.map((source) => new RegExp(source)),
      mediaId: new RegExp(provider.mediaIdPattern),
    }
    compiled.set(provider, answer)
  }
  return answer
}

function onDomain(hostname: string, domains: readonly string[]): boolean {
  return domains.some(
    (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
  )
}

/**
 * The declared host a link belongs to, with the media id it names, or
 * `undefined` for anything else: a value that is not an http(s) URL, a host
 * nothing declares, or a path that names no id the host's pattern accepts.
 */
export function videoEmbedOf(
  value: unknown,
  providers: readonly ResolvedVideoEmbedProvider[] = videoEmbedProviders(),
): VideoEmbed | undefined {
  if (typeof value !== 'string' || !providers.length) return undefined
  let url: URL
  try {
    url = new URL(value.trim())
  } catch {
    return undefined
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return undefined
  for (const provider of providers) {
    if (!onDomain(url.hostname, provider.domains)) continue
    const { paths, mediaId } = compile(provider)
    for (const pattern of paths) {
      const id = pattern.exec(url.pathname)?.[1]
      if (id && mediaId.test(id) && SAFE_MEDIA_ID.test(id)) {
        return {
          provider,
          mediaId: id,
          embedUrl: `${provider.playerOrigin}${provider.playerPath.replace(ID_PLACEHOLDER, id)}`,
        }
      }
    }
  }
  return undefined
}

/** The player page for a declared host's link, with no per-visit options. */
export function videoEmbedUrl(
  value: unknown,
  providers?: readonly ResolvedVideoEmbedProvider[],
): string | undefined {
  return videoEmbedOf(value, providers)?.embedUrl
}

/**
 * The address of a declared host's player frame for this visit, carrying the
 * declaration's query in its own order. See {@link VideoEmbedPlayerOption}
 * for what each option means and which way it defaults.
 */
export function videoEmbedPlayerSrc(
  value: unknown,
  options: VideoEmbedPlayerOptions = {},
  providers?: readonly ResolvedVideoEmbedProvider[],
): string | undefined {
  const embed = videoEmbedOf(value, providers)
  if (!embed) return undefined
  const params = new URLSearchParams()
  for (const entry of embed.provider.playerQuery ?? []) {
    if ('value' in entry) {
      params.set(entry.param, entry.value)
      continue
    }
    const on =
      entry.option === 'autoPlay'
        ? options.autoPlay !== false
        : Boolean(options[entry.option])
    const sent = on ? entry.on : entry.off
    if (sent !== undefined) params.set(entry.param, sent)
  }
  const query = params.toString()
  return query ? `${embed.embedUrl}?${query}` : embed.embedUrl
}

/**
 * Every origin a declared player is framed from: what a published page's
 * `frame-src` admits for the Video element.
 */
export function videoEmbedPlayerOrigins(
  providers: readonly ResolvedVideoEmbedProvider[] = videoEmbedProviders(),
): string[] {
  return [...new Set(providers.map((provider) => provider.playerOrigin))]
}

/** The declared hosts' names, as an author knows them. */
export function videoEmbedProviderLabels(
  providers: readonly ResolvedVideoEmbedProvider[] = videoEmbedProviders(),
): string[] {
  return providers.map((provider) => provider.label)
}
