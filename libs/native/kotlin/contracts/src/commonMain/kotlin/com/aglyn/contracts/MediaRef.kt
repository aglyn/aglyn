package com.aglyn.contracts

import kotlin.math.floor

/*
 * How a picked library file is stored on a page, and how a stored value is
 * shown, ported once from libs/aglyn/src/lib/app-utils/media-ref.ts
 * (`mediaNodeSrc`, `resolveMediaSrc` and what they read), scope-tokens.ts
 * (`hostQualifiedCdnPath`) and media-metadata.ts (`inheritedMediaAlt`). The
 * cases in function-cases.generated.json are the TypeScript's own answers, and
 * the tests replay every one.
 *
 * A reference names an ASSET, not a file: `media:{scope}/{mediaId}`, so a
 * replace or a move never breaks what holds it. The Storage-emulator host and
 * the content-version query the console also reads are left out; no app runs
 * against the one or stores the other.
 */

const val MEDIA_REF_PREFIX = "media:"
const val MEDIA_CDN_ROUTE = "/api/media/cdn"

private const val ORG_SCOPE_PREFIX = "org:"
private const val HASH_SEPARATOR = '@'
private const val POSTER_OBJECT_SUFFIX = "__poster"
private const val STORAGE_DOWNLOAD_HOST = "firebasestorage.googleapis.com"
private val SEGMENT = Regex("[A-Za-z0-9_-]{1,64}")

/** A parsed `media:` reference. */
data class MediaRef(val scope: String, val mediaId: String, val contentHash: String? = null)

/** A host id, an org id, a media id or a content hash: one path segment of the CDN route. */
private fun isSegment(text: String) = SEGMENT.matches(text)

/** `{hostId}`, `org:{orgId}` or `org:{orgId}:{hostId}`. */
fun isMediaCdnScope(scope: String): Boolean {
  if (!scope.startsWith(ORG_SCOPE_PREFIX)) return isSegment(scope)
  val parts = scope.removePrefix(ORG_SCOPE_PREFIX).split(':')
  if (parts.size !in 1..2) return false
  return parts.all(::isSegment)
}

/** The reference for an asset, or null when the scope or id does not fit the grammar. */
fun formatMediaRef(scope: String?, mediaId: String?, contentHash: String? = null): String? {
  if (scope.isNullOrEmpty() || mediaId.isNullOrEmpty()) return null
  if (!isMediaCdnScope(scope) || !isSegment(mediaId)) return null
  val pin = if (!contentHash.isNullOrEmpty() && isSegment(contentHash)) "$HASH_SEPARATOR$contentHash" else ""
  return "$MEDIA_REF_PREFIX$scope/$mediaId$pin"
}

fun isMediaRef(value: String?): Boolean = value != null && value.startsWith(MEDIA_REF_PREFIX)

/** What a reference names; a malformed pin loses the pin, never the reference. */
fun parseMediaRef(value: String?): MediaRef? {
  if (value == null || !isMediaRef(value)) return null
  val rest = value.removePrefix(MEDIA_REF_PREFIX)
  val slash = rest.indexOf('/')
  if (slash <= 0) return null
  val scope = rest.substring(0, slash)
  val tail = rest.substring(slash + 1)
  val at = tail.indexOf(HASH_SEPARATOR)
  val mediaId = if (at == -1) tail else tail.substring(0, at)
  val hash = if (at == -1) null else tail.substring(at + 1)
  if (!isMediaCdnScope(scope) || !isSegment(mediaId)) return null
  if (hash != null && !isSegment(hash)) return MediaRef(scope, mediaId)
  return MediaRef(scope, mediaId, hash)
}

/** The reference a stored CDN path (`/api/media/cdn/{scope}/{id}`) names. */
fun mediaRefFromCdnPath(cdnPath: String?): String? {
  if (cdnPath.isNullOrEmpty()) return null
  val marker = "$MEDIA_CDN_ROUTE/"
  val at = cdnPath.indexOf(marker)
  if (at == -1) return null
  val parts = cdnPath.substring(at + marker.length).split('/')
  return formatMediaRef(parts.getOrNull(0), parts.getOrNull(1))
}

/** The asset a Storage object key (`hosts/{h}/media/{id}`, `orgs/{o}/media/{id}`) holds. */
private fun mediaAssetOfObjectKey(objectPath: String): Pair<String, String>? {
  val segments = objectPath.split('/')
  if (segments.size < 4 || segments[2] != "media") return null
  if (segments.any { it.isEmpty() || it == ".." }) return null
  val scope = when (segments[0]) {
    "hosts" -> segments[1]
    "orgs" -> "$ORG_SCOPE_PREFIX${segments[1]}"
    else -> return null
  }
  val leaf = segments.last()
  if (leaf.endsWith(POSTER_OBJECT_SUFFIX)) return null
  val ref = parseMediaRef("$MEDIA_REF_PREFIX$scope/$leaf") ?: return null
  return ref.scope to ref.mediaId
}

/** `decodeURIComponent`: null where the console's would throw (a stray `%`, bytes that are not UTF-8). */
private fun percentDecoded(text: String): String? {
  val input = text.encodeToByteArray()
  val out = ArrayList<Byte>(input.size)
  var index = 0
  while (index < input.size) {
    val byte = input[index]
    if (byte == '%'.code.toByte()) {
      val high = hexValue(input.getOrNull(index + 1))
      val low = hexValue(input.getOrNull(index + 2))
      if (high < 0 || low < 0) return null
      out.add((high * 16 + low).toByte())
      index += 3
    } else {
      out.add(byte)
      index += 1
    }
  }
  return try {
    out.toByteArray().decodeToString(throwOnInvalidSequence = true)
  } catch (_: CharacterCodingException) {
    null
  }
}

private fun hexValue(byte: Byte?): Int = when (byte?.toInt()?.toChar()) {
  in '0'..'9' -> byte!!.toInt() - '0'.code
  in 'a'..'f' -> byte!!.toInt() - 'a'.code + 10
  in 'A'..'F' -> byte!!.toInt() - 'A'.code + 10
  else -> -1
}

/** The reference a Firebase Storage download URL names, for a file uploaded before every plan had the CDN. */
fun mediaRefFromStorageUrl(value: String?): String? {
  if (value == null || !value.contains("/v0/b/")) return null
  val match = Regex("^[A-Za-z][A-Za-z0-9+.-]*://([^/?#]*)([^?#]*)").find(value) ?: return null
  val authority = match.groupValues[1].substringAfterLast('@')
  val host = authority.substringBefore(':').lowercase()
  if (host != STORAGE_DOWNLOAD_HOST) return null
  val key = Regex("^/v0/b/[^/]+/o/([^/]+)$").find(match.groupValues[2])?.groupValues?.get(1) ?: return null
  val decoded = percentDecoded(key) ?: return null
  val asset = mediaAssetOfObjectKey(decoded) ?: return null
  return formatMediaRef(asset.first, asset.second)
}

/**
 * What the media picker writes into a field: the asset's reference, from its
 * CDN path; a file with no CDN path that is not private has it read off its
 * Storage URL; anything else keeps the URL it has.
 */
fun mediaNodeSrc(url: String?, cdnPath: String?, private: Boolean?): String? =
  mediaRefFromCdnPath(cdnPath) ?: (if (private == true) null else mediaRefFromStorageUrl(url)) ?: url

/** `org:{orgId}` becomes `org:{orgId}:{hostId}` when the site using it is known; anything else stays. */
fun hostQualifiedScope(scope: String, hostId: String?): String {
  if (hostId.isNullOrEmpty() || !isSegment(hostId)) return scope
  if (!scope.startsWith(ORG_SCOPE_PREFIX)) return scope
  val orgId = scope.removePrefix(ORG_SCOPE_PREFIX).substringBefore(':')
  if (orgId.isEmpty() || !isSegment(orgId)) return scope
  return "$ORG_SCOPE_PREFIX$orgId:$hostId"
}

/**
 * Where a stored value is served from: a reference (or a Storage URL that
 * names an asset) becomes the CDN path, qualified for the site being shown; any
 * other value is returned as stored. Null for nothing, or a reference that does
 * not parse.
 */
fun resolveMediaSrc(value: String?, hostId: String? = null): String? {
  if (value.isNullOrEmpty()) return null
  val stored = (if (isMediaRef(value)) value else mediaRefFromStorageUrl(value)) ?: return value
  val ref = parseMediaRef(stored) ?: return null
  return "$MEDIA_CDN_ROUTE/${hostQualifiedScope(ref.scope, hostId)}/${ref.mediaId}"
}

/**
 * An org asset's CDN path rewritten to name the site using it, but only for an
 * asset restricted to some sites; an org-wide asset, a site's own file and a
 * path already naming a site are returned untouched.
 */
fun hostQualifiedCdnPath(cdnPath: String?, visibleTo: List<String>?, hostId: String?): String? {
  if (cdnPath.isNullOrEmpty()) return cdnPath
  if (hostId.isNullOrEmpty() || (visibleTo != null && "org" in visibleTo)) return cdnPath
  val marker = "$MEDIA_CDN_ROUTE/"
  val at = cdnPath.indexOf(marker)
  if (at == -1) return cdnPath
  val head = cdnPath.substring(0, at + marker.length)
  val parts = cdnPath.substring(at + marker.length).split('/')
  val scope = parts[0]
  if (!scope.startsWith(ORG_SCOPE_PREFIX) || scope.indexOf(':', 4) != -1) return cdnPath
  return (listOf("$head$scope:$hostId") + parts.drop(1)).joinToString("/")
}

/**
 * The alt text a placement takes from the picked file: the file's own, when
 * the placement has none of its own and is not decorative; nothing otherwise.
 * Never invented, and capped at the length the library saves.
 */
fun inheritedMediaAlt(placementAlt: String?, assetAlt: String?, decorative: Boolean = false): String? {
  if (decorative) return null
  if (!placementAlt.isNullOrBlank()) return null
  val inherited = assetAlt?.trim().orEmpty()
  if (inherited.isEmpty()) return null
  return inherited.take(Contracts.mediaAltMaxLength.toInt())
}

private const val VIDEO_MAX_DURATION_MS = 24.0 * 60 * 60 * 1000
private const val VIDEO_MAX_DIMENSION = 16384.0

/**
 * How long a library film runs, in whole seconds, from its document's measured
 * `video` record (`durationMs`, `width`, `height`: all three or none), or null
 * when it records none. Never rounds to zero: a sub-second clip is still a clip
 * (`videoMediaProps`).
 */
fun libraryVideoSeconds(video: Any?): Long? {
  val record = video as? Map<*, *> ?: return null
  fun whole(key: String): Double? {
    val number = when (val raw = record[key]) {
      is Number -> raw.toDouble()
      is String -> raw.trim().toDoubleOrNull()
      else -> null
    } ?: return null
    return if (number.isNaN() || number.isInfinite()) null else floor(number + 0.5)
  }
  val duration = whole("durationMs") ?: return null
  val width = whole("width") ?: return null
  val height = whole("height") ?: return null
  if (duration <= 0 || duration > VIDEO_MAX_DURATION_MS) return null
  if (width <= 0 || width > VIDEO_MAX_DIMENSION || height <= 0 || height > VIDEO_MAX_DIMENSION) return null
  return maxOf(1L, floor(duration / 1000 + 0.5).toLong())
}
