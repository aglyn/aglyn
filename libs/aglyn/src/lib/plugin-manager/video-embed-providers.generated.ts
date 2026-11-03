/**
 * GENERATED FILE — do not edit. Regenerate with:
 *   node tools/scripts/generate-plugin-manifests.mjs
 *
 * Every video host whose own player the Video element frames, declared by
 * the plugin that plays it (AGL-3080). Core names no host. Its own file,
 * not the catalog's, so a published page with no video downloads none of
 * it (AGL-4140).
 */

import type { ResolvedVideoEmbedProvider } from './video-embed-provider'

export const FIRST_PARTY_VIDEO_EMBED_PROVIDERS: readonly ResolvedVideoEmbedProvider[] = [
  {
    "pluginId": "mui",
    "id": "vimeo",
    "label": "Vimeo",
    "domains": [
      "vimeo.com"
    ],
    "mediaIdPaths": [
      "^\\/([0-9]+)\\/?$",
      "^\\/video\\/([0-9]+)\\/?$",
      "^\\/channels\\/[^/]+\\/([0-9]+)\\/?$",
      "^\\/groups\\/[^/]+\\/videos\\/([0-9]+)\\/?$",
      "^\\/showcase\\/[^/]+\\/video\\/([0-9]+)\\/?$",
      "^\\/album\\/[^/]+\\/video\\/([0-9]+)\\/?$",
      "^\\/manage\\/videos\\/([0-9]+)\\/?$"
    ],
    "mediaIdPattern": "^[0-9]{6,12}$",
    "playerOrigin": "https://player.vimeo.com",
    "playerPath": "/video/{id}",
    "playerQuery": [
      {
        "param": "autoplay",
        "option": "autoPlay",
        "on": "1",
        "off": "0"
      },
      {
        "param": "dnt",
        "value": "1"
      },
      {
        "param": "muted",
        "option": "muted",
        "on": "1"
      },
      {
        "param": "loop",
        "option": "loop",
        "on": "1"
      }
    ]
  },
  {
    "pluginId": "mui",
    "id": "wistia",
    "label": "Wistia",
    "domains": [
      "wistia.com",
      "wistia.net",
      "wi.st"
    ],
    "mediaIdPaths": [
      "^\\/medias\\/([^/]+)(?:\\/manage)?\\/?$",
      "^\\/m\\/([^/]+)\\/?$",
      "^\\/embed\\/iframe\\/([^/]+)\\/?$",
      "^\\/embed\\/medias\\/([^/.]+)(?:\\.jsonp?)?\\/?$"
    ],
    "mediaIdPattern": "^[a-z0-9]{10}$",
    "playerOrigin": "https://fast.wistia.net",
    "playerPath": "/embed/iframe/{id}",
    "playerQuery": [
      {
        "param": "autoPlay",
        "option": "autoPlay",
        "on": "true",
        "off": "false"
      },
      {
        "param": "roundedPlayer",
        "value": "false"
      },
      {
        "param": "doNotTrack",
        "option": "doNotTrack",
        "on": "true"
      },
      {
        "param": "muted",
        "option": "muted",
        "on": "true"
      },
      {
        "param": "endVideoBehavior",
        "option": "loop",
        "on": "loop"
      }
    ]
  },
  {
    "pluginId": "mui",
    "id": "youtube",
    "label": "YouTube",
    "domains": [
      "youtube.com",
      "youtube-nocookie.com",
      "youtu.be"
    ],
    "mediaIdPaths": [
      "^\\/embed\\/([^/]+)\\/?$",
      "^\\/shorts\\/([^/]+)\\/?$",
      "^\\/live\\/([^/]+)\\/?$",
      "^\\/v\\/([^/]+)\\/?$"
    ],
    "mediaIdLinks": [
      {
        "path": "^\\/watch\\/?$",
        "param": "v",
        "domains": [
          "youtube.com"
        ]
      },
      {
        "path": "^\\/([^/]+)\\/?$",
        "domains": [
          "youtu.be"
        ]
      }
    ],
    "mediaIdPattern": "^(?!videoseries$)[A-Za-z0-9_-]{11}$",
    "playerOrigin": "https://www.youtube-nocookie.com",
    "playerPath": "/embed/{id}",
    "playerQuery": [
      {
        "param": "autoplay",
        "option": "autoPlay",
        "on": "1",
        "off": "0"
      },
      {
        "param": "playsinline",
        "value": "1"
      },
      {
        "param": "mute",
        "option": "muted",
        "on": "1"
      },
      {
        "param": "loop",
        "option": "loop",
        "on": "1"
      },
      {
        "param": "playlist",
        "option": "loop",
        "on": "{id}"
      }
    ]
  },
]
