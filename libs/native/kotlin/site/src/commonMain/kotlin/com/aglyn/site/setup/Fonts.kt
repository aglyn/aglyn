package com.aglyn.site.setup

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.RawBody
import com.aglyn.core.jsonValue
import com.aglyn.ui.PickedFile
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/*
 * A site's own fonts, as the console's font installer keeps them (AGL-3656,
 * AGL-3668): each file goes to `/api/fonts/prepare` (license check, WOFF2
 * conversion and subsetting on the server), into the site's media library
 * through the library's own upload or replace route, and then into the theme
 * through `/api/fonts/theme`, which runs the console's own theme functions
 * against the site's resolved theme. Nothing here edits a theme itself.
 */

/** The largest font file `/api/fonts/prepare` takes (`FONT_UPLOAD_MAX_BYTES`). */
const val FONT_UPLOAD_MAX_BYTES = 4 * 1024 * 1024

/** The extensions the installer takes (`FONT_UPLOAD_EXTENSIONS`). */
val FONT_UPLOAD_EXTENSIONS = listOf("woff2", "woff", "ttf", "otf")

/** The content type every installed face is stored and served as. */
const val FONT_STORED_CONTENT_TYPE = "font/woff2"

/** Whether a picked file is one the installer takes, judged by its name as the chooser's `accept` does. */
fun isFontFileName(name: String): Boolean = name.substringAfterLast('.', "").lowercase() in FONT_UPLOAD_EXTENSIONS

/** A file size as the installer states it (`1.5 MB`). */
fun fontFileSize(bytes: Long): String = when {
  bytes < 1024 -> "$bytes B"
  bytes < 1024 * 1024 -> "${(bytes / 1024.0).let { kotlin.math.round(it).toLong() }} KB"
  else -> "${(kotlin.math.round(bytes / 1024.0 / 1024.0 * 10) / 10)} MB"
}

/** One face the route has read from a file and made ready to store. */
class PreparedFont(
  val family: String,
  val weight: Int,
  val weightMax: Int?,
  val style: String,
  val category: String,
  val fileName: String,
  val contentHash: String,
  val warnings: List<String>,
  val bytesIn: Int,
  val bytesOut: Int,
  /** The stored file, converted and subset. */
  val woff2: ByteArray,
  /** The facts a theme records, in the shape `/api/fonts/theme` reads. */
  val installable: JsonObject,
) {
  /** A weight as the installer shows it: `400`, or `100–900` for a variable file. */
  val weightLabel: String get() = if (weightMax != null && weightMax > weight) "$weight–$weightMax" else "$weight"

  companion object {
    @OptIn(ExperimentalEncodingApi::class)
    fun of(answer: JsonElement?): PreparedFont? {
      val face = (answer as? JsonObject)?.get("face") as? JsonObject ?: return null
      val family = face.str("family") ?: return null
      val weight = face.num("weight") ?: return null
      val style = face.str("style") ?: return null
      val data = answer.str("woff2")?.let { runCatching { Base64.decode(it) }.getOrNull() } ?: return null
      val facts = listOf("family", "weight", "weightMax", "style", "category", "metrics", "unicodeRange").mapNotNull { key -> face[key]?.let { key to it } }
      return PreparedFont(
        family = family,
        weight = weight.toInt(),
        weightMax = face.num("weightMax")?.toInt(),
        style = style,
        category = face.str("category") ?: "sans-serif",
        fileName = face.str("fileName") ?: "$family.woff2",
        contentHash = face.str("contentHash").orEmpty(),
        warnings = face.arr("warnings").mapNotNull { (it as? JsonPrimitive)?.takeIf { p -> p !is JsonNull }?.content },
        bytesIn = face.num("bytesIn")?.toInt() ?: 0,
        bytesOut = face.num("bytesOut")?.toInt() ?: 0,
        woff2 = data,
        installable = JsonObject(facts.toMap()),
      )
    }
  }
}

/** Where a prepared face goes in the site's media library (`planFontUpload`). */
sealed interface FontUploadPlan {
  data class Replace(val mediaId: String) : FontUploadPlan
  data object Upload : FontUploadPlan
}

enum class FontRole(val key: String, val label: String) {
  BODY("body", "Body text"),
  HEADINGS("headings", "Headings"),
}

/** One stored face of an installed family. */
data class InstalledFace(val weight: Int, val weightMax: Int?, val style: String, val label: String) {
  val id: String get() = "$weight-${weightMax ?: 0}-$style"
}

/** One installed family, as the installer lists it. */
data class InstalledFont(val family: String, val category: String?, val roles: List<FontRole>, val faces: List<InstalledFace>)

fun installedFontsOf(answer: JsonElement?): List<InstalledFont> = answer.arr("fonts").mapNotNull { row ->
  val family = row.str("family") ?: return@mapNotNull null
  InstalledFont(
    family = family,
    category = row.str("category"),
    roles = row.arr("roles").mapNotNull { r -> FontRole.entries.firstOrNull { it.key == (r as? JsonPrimitive)?.content } },
    faces = row.arr("faces").mapNotNull { face ->
      val weight = face.num("weight") ?: return@mapNotNull null
      val style = face.str("style") ?: return@mapNotNull null
      InstalledFace(weight.toInt(), face.num("weightMax")?.toInt(), style, face.str("label") ?: "${weight.toInt()}")
    },
  )
}

/** The installer's calls, each the console's own route. */
@OptIn(ExperimentalEncodingApi::class)
class FontsApi(private val api: ConsoleApiClient, private val hostId: String) {
  private suspend fun theme(body: Map<String, Any?>): JsonElement? =
    api.request("/api/fonts/theme", ApiMethod.POST, jsonValue(body), query = mapOf("hostId" to hostId))

  /** The families the site has installed. */
  suspend fun installed(): List<InstalledFont> = installedFontsOf(theme(mapOf("op" to "list")))

  /** Checks the file's embedding license and makes its WOFF2. */
  suspend fun prepare(file: PickedFile): PreparedFont {
    if (!isFontFileName(file.name)) throw ConsoleApiError("This is not a font file. Upload a .woff2, .woff, .ttf or .otf file.", 0, null)
    if (file.size > FONT_UPLOAD_MAX_BYTES) throw ConsoleApiError("A font file can be up to ${FONT_UPLOAD_MAX_BYTES / 1024 / 1024} MB.", 413, null)
    val answer = api.request(
      "/api/fonts/prepare", ApiMethod.POST, query = mapOf("hostId" to hostId),
      rawBody = RawBody(file.bytes, "application/octet-stream"),
    )
    return PreparedFont.of(answer) ?: throw ConsoleApiError("The font could not be checked. Try again.", 0, null)
  }

  suspend fun plan(font: PreparedFont): FontUploadPlan {
    val plan = (theme(mapOf("op" to "plan", "face" to font.installable)) as? JsonObject)?.get("plan")
    val mediaId = plan.str("mediaId")
    return if (plan.str("mode") == "replace" && mediaId != null) FontUploadPlan.Replace(mediaId) else FontUploadPlan.Upload
  }

  /** Where a stored face landed: its media id, its version, and whether it replaced a file. */
  data class Stored(val mediaId: String, val version: String, val replaced: Boolean)

  /**
   * Stores the WOFF2 in the site's media library: over the file the theme's
   * face already points at, else as a new one.
   */
  suspend fun store(font: PreparedFont, plan: FontUploadPlan): Stored {
    val body = mutableMapOf<String, Any?>(
      "hostId" to hostId, "fileName" to font.fileName, "contentType" to FONT_STORED_CONTENT_TYPE, "data" to Base64.encode(font.woff2),
    )
    if (plan is FontUploadPlan.Replace) {
      try {
        val answer = api.request("/api/media/replace", ApiMethod.POST, jsonValue(body + ("mediaId" to plan.mediaId)))
        return Stored(plan.mediaId, answer.str("contentHash") ?: font.contentHash, true)
      } catch (error: ConsoleApiError) {
        // The file left the library since: store it anew.
        if (error.status != 404) throw error
      }
    }
    val answer = api.request("/api/media/upload", ApiMethod.POST, jsonValue(body))
    val mediaId = answer.str("mediaId") ?: throw ConsoleApiError("The font could not be saved to your media library.", 0, null)
    return Stored(mediaId, font.contentHash, false)
  }

  /** Puts a stored face into the theme. */
  suspend fun install(font: PreparedFont, mediaId: String, version: String): List<InstalledFont> =
    installedFontsOf(theme(mapOf("op" to "install", "face" to font.installable, "mediaId" to mediaId, "version" to version)))

  suspend fun setRole(family: String, role: FontRole): List<InstalledFont> =
    installedFontsOf(theme(mapOf("op" to "role", "family" to family, "role" to role.key)))

  suspend fun setCategory(family: String, category: String): List<InstalledFont> =
    installedFontsOf(theme(mapOf("op" to "category", "family" to family, "category" to category)))

  suspend fun remove(face: InstalledFace, family: String): List<InstalledFont> {
    val slot = buildMap<String, Any?> { put("weight", face.weight); put("style", face.style); face.weightMax?.let { put("weightMax", it) } }
    return installedFontsOf(theme(mapOf("op" to "remove-face", "family" to family, "face" to slot)))
  }

  suspend fun remove(family: String): List<InstalledFont> = installedFontsOf(theme(mapOf("op" to "remove-family", "family" to family)))
}
