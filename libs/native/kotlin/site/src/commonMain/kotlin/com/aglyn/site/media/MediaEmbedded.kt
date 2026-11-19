// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.site.media

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.width
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.formatLocalDay
import com.aglyn.contracts.localDayStart
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.jsonValue
import com.aglyn.core.plainJson
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlin.math.abs
import kotlin.time.ExperimentalTime
import kotlin.time.Instant

// What a file carries inside itself (the console's "Inside the file" in File info, AGL-3331): the camera, exposure,
// date taken, place, rights and the rest, as `POST /api/media/metadata` read them from the bytes, grouped as the console
// groups them, and "Remove location from file", which erases the GPS position from the file itself. The values are the
// machine form every writer agrees on (`media-embedded-fields.ts`); `embeddedFieldDisplay` is the one place they are
// dressed for a person. Editing the other fields stays in the console for now. The Apple kit's MediaEmbedded.swift.

/** `MEDIA_EMBEDDED_METADATA_VERSION`: a stored record of another version is read again rather than shown. */
const val MEDIA_EMBEDDED_METADATA_VERSION = 1

/** The types a reader exists for (`READABLE_TYPES`); a file of any other type has no "Inside the file". */
val MEDIA_EMBEDDED_READABLE_TYPES: Set<String> = setOf(
  "image/jpeg", "image/png", "image/webp", "image/gif", "image/tiff", "image/heic", "image/heif", "image/avif",
  "image/svg+xml", "application/pdf", "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", "video/mp4", "video/quicktime", "video/webm",
)

fun embeddedMetadataReadable(contentType: String): Boolean =
  contentType.lowercase().split(';').first().trim() in MEDIA_EMBEDDED_READABLE_TYPES

/** `MEDIA_EMBEDDED_GROUP_ORDER` with `MEDIA_EMBEDDED_GROUP_LABELS`. */
val MEDIA_EMBEDDED_GROUPS: List<Pair<String, String>> = listOf(
  "description" to "Description", "rights" to "Rights", "location" to "Location", "capture" to "Camera",
  "document" to "Document", "technical" to "Technical", "other" to "Other embedded fields",
)

data class MediaEmbeddedField(
  val key: String,
  val label: String,
  val group: String,
  val value: String? = null,
  val values: List<String>? = null,
  val editable: Boolean = false,
) {
  companion object {
    fun from(raw: Any?): MediaEmbeddedField? {
      val map = raw as? Map<*, *> ?: return null
      val key = (map["key"] as? String)?.takeIf { it.isNotEmpty() } ?: return null
      return MediaEmbeddedField(
        key, map["label"] as? String ?: key, map["group"] as? String ?: "other", map["value"] as? String,
        (map["values"] as? List<*>)?.filterIsInstance<String>(), map["editable"] as? Boolean ?: false,
      )
    }
  }
}

/** `embeddedMetadata` on a media document, or the route's answer. */
data class MediaEmbeddedRecord(
  val version: Int = MEDIA_EMBEDDED_METADATA_VERSION,
  val format: String?,
  val fields: List<MediaEmbeddedField>,
  val writable: Boolean,
  val readOnlyReason: String? = null,
  val truncated: Boolean = false,
  val contentSha256: String? = null,
) {
  /** `embeddedMetadataIsCurrent`: this reader's version, and read from the bytes the document now holds. */
  fun isCurrent(documentSha: String?): Boolean =
    version == MEDIA_EMBEDDED_METADATA_VERSION && (documentSha == null || contentSha256 == documentSha)

  /** The location, when the file carries one. */
  val gps: MediaEmbeddedField? get() = fields.firstOrNull { it.key == "gps" }

  /** The fields in the console's group order, empty groups left out. */
  val groups: List<Pair<String, List<MediaEmbeddedField>>>
    get() = MEDIA_EMBEDDED_GROUPS.mapNotNull { (id, label) -> fields.filter { it.group == id }.takeIf { it.isNotEmpty() }?.let { label to it } }

  companion object {
    /** From a Firestore map or a decoded JSON object; null for anything without a `fields` list. */
    fun from(raw: Any?): MediaEmbeddedRecord? {
      val map = raw as? Map<*, *> ?: return null
      val fields = map["fields"] as? List<*> ?: return null
      return MediaEmbeddedRecord(
        version = (map["version"] as? Number)?.toInt() ?: 0,
        format = map["format"] as? String,
        fields = fields.mapNotNull(MediaEmbeddedField::from),
        writable = map["writable"] as? Boolean ?: false,
        readOnlyReason = map["readOnlyReason"] as? String,
        truncated = map["truncated"] as? Boolean ?: false,
        contentSha256 = map["contentSha256"] as? String,
      )
    }
  }
}

/**
 * A field's value for a person (`embeddedFieldDisplay`): lists joined, dates in the reader's style, the place as degrees,
 * the rating as stars. [timeZone] is the device's when null.
 */
fun embeddedFieldDisplay(field: MediaEmbeddedField, timeZone: String? = null): String {
  field.values?.let { return it.joinToString(", ") }
  val value = field.value.orEmpty()
  return when (field.key) {
    "createdAt", "modifiedAt" -> {
      val dateOnly = Regex("""^\d{4}-\d{2}-\d{2}$""").matches(value)
      val at = parseEmbeddedDate(value, timeZone) ?: return value
      formatLocalDay(at, if (dateOnly) "MMM d, yyyy" else "MMM d, yyyy, h:mm a", timeZone)
    }
    "gps" -> {
      val parts = value.split(',').map { it.trim().toDoubleOrNull() }
      val lat = parts.getOrNull(0)
      val lon = parts.getOrNull(1)
      if (parts.size != 2 || lat == null || lon == null || !lat.isFinite() || !lon.isFinite()) return value
      "${degrees(lat)}° ${if (lat < 0) "S" else "N"}, ${degrees(lon)}° ${if (lon < 0) "W" else "E"}"
    }
    "rating" -> {
      val stars = value.toIntOrNull() ?: return value
      when {
        stars == -1 -> "Rejected"
        stars !in 0..5 -> value
        else -> "★".repeat(stars) + "☆".repeat(5 - stars)
      }
    }
    else -> value
  }
}

/** `toFixed(5)` of the absolute value. */
private fun degrees(n: Double): String {
  val scaled = kotlin.math.round(abs(n) * 100_000).toLong()
  return "${scaled / 100_000}.${(scaled % 100_000).toString().padStart(5, '0')}"
}

/**
 * An ISO date as the console's `new Date` reads it: a zone when it has one, local time when it does not, and a
 * date-only value at local noon so it stays on its own day west of Greenwich.
 */
@OptIn(ExperimentalTime::class)
fun parseEmbeddedDate(value: String, timeZone: String? = null): Long? {
  if (Regex("""(Z|[+-]\d{2}:\d{2})$""").containsMatchIn(value)) {
    return runCatching { Instant.parse(value).toEpochMilliseconds() }.getOrNull()
  }
  val match = Regex("""^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2})(?::(\d{2}))?(?:\.\d+)?)?$""").matchEntire(value) ?: return null
  val (y, mo, d, h, mi, s) = match.destructured
  val day = runCatching { localDayStart(y.toInt(), mo.toInt(), d.toInt(), timeZone) }.getOrNull() ?: return null
  if (h.isEmpty()) return day + 12 * 3_600_000L
  return day + h.toInt() * 3_600_000L + mi.toInt() * 60_000L + (s.toIntOrNull() ?: 0) * 1_000L
}

/** What a write into the file answered. */
data class MediaEmbeddedWrite(val record: MediaEmbeddedRecord?, val unchanged: Boolean)

/** `POST /api/media/metadata`, the file's own details, for one library. */
class MediaEmbeddedApi(private val api: ConsoleApiClient, private val scope: MediaScope) {
  private suspend fun post(vararg fields: Pair<String, Any?>): JsonElement? = api.request(
    "/api/media/metadata",
    ApiMethod.POST,
    jsonValue(
      buildMap {
        put(scope.bodyKey, scope.id)
        (scope as? MediaScope.Org)?.forHostId?.let { put("forHostId", it) }
        putAll(fields)
      },
    ),
  )

  /** Reads the details inside the file; the server keeps what it read, so the next open needs no read. */
  suspend fun read(mediaId: String): MediaEmbeddedRecord? =
    MediaEmbeddedRecord.from(plainJson((post("mediaId" to mediaId, "action" to "read") as? JsonObject)?.get("embeddedMetadata")))

  /**
   * Erases the GPS position from the file itself — what every page serves and every download carries. Names the digest
   * it was shown, so a file replaced meanwhile is a 409 rather than an overwrite.
   */
  suspend fun removeLocation(mediaId: String, expectedSha256: String?): MediaEmbeddedWrite {
    val answer = post("mediaId" to mediaId, "action" to "write", "patch" to mapOf("gps" to null), "expectedSha256" to expectedSha256) as? JsonObject
    return MediaEmbeddedWrite(
      MediaEmbeddedRecord.from(plainJson(answer?.get("embeddedMetadata"))),
      (answer?.get("unchanged") as? JsonPrimitive)?.booleanOrNull == true,
    )
  }
}

/** "Inside the file": the details the file carries, grouped, with Remove location from file where the file can take it. */
@Composable
fun MediaEmbeddedSection(item: MediaItem, api: MediaEmbeddedApi, canEdit: Boolean) {
  if (!embeddedMetadataReadable(item.contentType)) return
  val scope = rememberCoroutineScope()
  var read by remember(item.id) { mutableStateOf<MediaEmbeddedRecord?>(null) }
  var loading by remember(item.id) { mutableStateOf(false) }
  var loadError by remember(item.id) { mutableStateOf<String?>(null) }
  var confirming by remember { mutableStateOf(false) }
  var saving by remember { mutableStateOf(false) }
  var notice by remember(item.id) { mutableStateOf<Pair<String, StatusTone>?>(null) }
  val stored = item.embedded?.takeIf { it.isCurrent(item.contentSha256) }
  val record = stored ?: read

  // The backfill, as the console's drawer does it: a file with no current record is read the first time it is opened,
  // by someone who may write to the library (the read stores what it found).
  LaunchedEffect(item.id, item.contentSha256, canEdit) {
    if (stored != null || read != null || !canEdit) return@LaunchedEffect
    loading = true
    loadError = null
    try {
      read = api.read(item.id) ?: MediaEmbeddedRecord(format = null, fields = emptyList(), writable = false)
    } catch (error: CancellationException) {
      throw error
    } catch (error: Exception) {
      loadError = error.message ?: "Reading the file failed"
    } finally {
      loading = false
    }
  }

  Column(Modifier.fillMaxWidth().testTag("media-embedded"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text("Inside the file", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
    when {
      record != null -> {
        if (record.fields.isEmpty()) {
          Text("This file carries no details of its own.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
        for ((label, fields) in record.groups) {
          Text(label.uppercase(), style = MaterialTheme.typography.labelSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          for (field in fields) {
            Row(Modifier.fillMaxWidth().semantics(mergeDescendants = true) {}, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
              Text(field.label, Modifier.width(104.dp), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
              Text(embeddedFieldDisplay(field), Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
            }
          }
        }
        if (record.gps?.editable == true && canEdit) {
          OutlinedButton(onClick = { confirming = true }, enabled = !saving, modifier = Modifier.testTag("media-remove-location")) {
            Text(if (saving) "Removing…" else "Remove location from file", color = MaterialTheme.colorScheme.error)
          }
        }
        record.readOnlyReason?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        if (record.truncated) {
          Text("Some long values are shortened here and cannot be edited from this panel.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        }
      }
      loading -> {
        Text("Reading the details inside the file…", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
        LinearProgressIndicator(Modifier.fillMaxWidth())
      }
      loadError != null -> Text(loadError.orEmpty(), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
      !canEdit -> Text("The details inside this file have not been read yet.", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
    notice?.let { (message, tone) -> NoticeBanner(message, tone) }
  }

  if (confirming) {
    ActionDialog(
      title = "Remove the location from this file?",
      confirmLabel = "Remove location",
      body = "The GPS position is erased from the file itself, so pages that show it and anyone who downloads it no longer get it. It cannot be put back afterwards.",
      destructive = true,
      onConfirm = {
        confirming = false
        scope.launch {
          saving = true
          notice = null
          try {
            val answer = api.removeLocation(item.id, item.contentSha256)
            answer.record?.let { read = it }
            notice = if (answer.unchanged) "Nothing in the file needed to change" to StatusTone.INFO else "Saved into the file" to StatusTone.SUCCESS
          } catch (error: CancellationException) {
            throw error
          } catch (error: Exception) {
            notice = (error.message ?: "Saving into the file failed") to StatusTone.ERROR
          } finally {
            saving = false
          }
        }
      },
      onDismiss = { confirming = false },
    )
  }
}
