package com.aglyn.site.sites

import com.aglyn.contracts.mediaNodeSrc
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.SiteBrandFiles
import com.aglyn.site.media.MediaApi
import com.aglyn.site.media.MediaScope
import com.aglyn.ui.PickedFile
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/*
 * The logo, the dark logo and the favicon a new site is created with (AGL-4119), the console's `site-brand-files.ts`. The
 * sheet holds the files, and they go into the new site's own library once it exists. The site is what the person asked for
 * and these are optional, so a file that does not make it never costs them the site: they are told which, and where to add
 * it.
 */

/** The types a logo may be, with the names a file with no type is read from. */
private val LOGO_FILE_TYPES = listOf(
  "image/png" to listOf(".png"),
  "image/jpeg" to listOf(".jpg", ".jpeg"),
  "image/webp" to listOf(".webp"),
  "image/svg+xml" to listOf(".svg"),
)

/** What a favicon may also be. An `.ico` is linked as it is, and never reaches a logo slot. */
private val FAVICON_FILE_TYPES = LOGO_FILE_TYPES + listOf("image/x-icon" to listOf(".ico"), "image/vnd.microsoft.icon" to listOf(".ico"))

/** The other spellings of a type, folded to the stored one (`normalizeImageContentType`). */
private val IMAGE_TYPE_ALIASES = mapOf(
  "image/jpg" to "image/jpeg",
  "image/pjpeg" to "image/jpeg",
  "image/x-png" to "image/png",
  "image/ico" to "image/x-icon",
  "image/x-icon+xml" to "image/x-icon",
  "image/svg" to "image/svg+xml",
)

/**
 * The content type to upload a file under, or null for one the field does not take. Read off the file's name when the
 * device reports none, because the upload route refuses an empty type.
 */
fun siteBrandFileType(name: String, mimeType: String, slot: String): String? {
  val types = if (slot == "favicon") FAVICON_FILE_TYPES else LOGO_FILE_TYPES
  val bare = mimeType.substringBefore(';').trim().lowercase()
  if (bare.isNotEmpty() && bare != "application/octet-stream") {
    val reported = IMAGE_TYPE_ALIASES[bare] ?: bare
    return reported.takeIf { type -> types.any { it.first == type } }
  }
  val lower = name.lowercase()
  return types.firstOrNull { (_, extensions) -> extensions.any(lower::endsWith) }?.first
}

/** Why a field will not take this file, said on the field before anything is created, or null when it will. */
fun siteBrandFileRefusal(file: PickedFile, slot: String, maxBytes: Long = SiteBrandFiles.MAX_BYTES.toLong()): String? = when {
  siteBrandFileType(file.name, file.mimeType, slot) == null ->
    if (slot == "favicon") "Use a PNG, JPEG, WebP, SVG or ICO file." else "Use a PNG, JPEG, WebP or SVG file."
  file.size == 0L -> "That file is empty."
  file.size > maxBytes -> "That file is over ${maxBytes / (1024 * 1024)} MB."
  else -> null
}

/** The host fields a create writes; `favicon` lands on `seo.favicon`. */
data class SiteBrandFields(val logoUrl: String? = null, val logoDarkUrl: String? = null, val favicon: String? = null) {
  internal val isEmpty: Boolean get() = logoUrl == null && logoDarkUrl == null && favicon == null

  /** The fields under the route's names. */
  internal fun body(): Map<String, String> = buildMap {
    logoUrl?.let { put("logoUrl", it) }
    logoDarkUrl?.let { put("logoDarkUrl", it) }
    favicon?.let { put("favicon", it) }
  }
}

/** [saved] is what was written, null when nothing was; [missed] the chosen files that did not make it, in field order. */
data class SiteBrandSaveOutcome(val saved: SiteBrandFields?, val missed: List<String>)

/**
 * Uploads the files a form is holding and writes what they became, one after the other so the storage count stays right.
 * [upload] answers what the field stores. Never throws for a refusal: each failure is reported in `missed`. A favicon left
 * blank is the logo, the same asset rather than a second copy, and with no logo and no favicon nothing is written.
 */
suspend fun saveSiteBrandFiles(
  files: Map<String, PickedFile>,
  upload: suspend (PickedFile, String) -> String?,
  save: suspend (SiteBrandFields) -> Unit,
): SiteBrandSaveOutcome {
  val stored = mutableMapOf<String, String>()
  val missed = mutableListOf<String>()
  for (slot in SiteBrandFiles.slots.map { it.slot }) {
    val file = files[slot] ?: continue
    val src = try {
      upload(file, slot)
    } catch (error: CancellationException) {
      throw error
    } catch (_: Throwable) {
      null
    }
    if (src.isNullOrEmpty()) missed += slot else stored[slot] = src
  }
  val fields = SiteBrandFields(stored["logo"], stored["logoDark"], stored["favicon"] ?: stored["logo"])
  if (fields.isEmpty) return SiteBrandSaveOutcome(null, missed)
  return try {
    save(fields)
    SiteBrandSaveOutcome(fields, missed)
  } catch (error: CancellationException) {
    throw error
  } catch (_: Throwable) {
    // Every file is in the library, and nothing points at any of them.
    SiteBrandSaveOutcome(null, SiteBrandFiles.slots.map { it.slot }.filter { it in files })
  }
}

/** The one line that says which files did not make it, or null when all did. */
fun siteBrandMissedNotice(missed: List<String>): String? {
  val nouns = SiteBrandFiles.slots.filter { it.slot in missed }.map { it.noun }
  if (nouns.isEmpty()) return null
  val list = if (nouns.size > 1) "${nouns.dropLast(1).joinToString(", ")} and ${nouns.last()}" else nouns.single()
  return "Your site is ready, but your $list didn’t upload. Add ${if (nouns.size > 1) "them" else "it"} in Site settings."
}

/**
 * The files a Create site sheet holds, into the new site's own library and onto the site, through the console's routes
 * (`uploadHostImage`, `saveMirroredHostFields`), awaited before the site opens.
 */
suspend fun saveSiteBrand(api: ConsoleApiClient, hostId: String, files: Map<String, PickedFile>): SiteBrandSaveOutcome {
  val media = MediaApi(api, MediaScope.Site(hostId))
  return saveSiteBrandFiles(
    files,
    upload = { file, slot ->
      val type = siteBrandFileType(file.name, file.mimeType, slot) ?: file.mimeType
      val stored = media.store(PickedFile(file.name, type, file.bytes), null)
      mediaNodeSrc(stored.url, stored.cdnPath, null)
    },
    save = { fields ->
      val body = buildJsonObject {
        put("hostId", JsonPrimitive(hostId))
        fields.body().forEach { (key, value) -> put(key, JsonPrimitive(value)) }
      }
      api.request("/api/hosts/sync-memberships", ApiMethod.POST, body)
    },
  )
}
