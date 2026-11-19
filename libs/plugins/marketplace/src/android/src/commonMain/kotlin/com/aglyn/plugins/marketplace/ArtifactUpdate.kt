// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.marketplace

import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.jsonBody
import com.aglyn.pluginhost.jsNumber
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull

/*
 * Updating a COPIED listing (a component, a layout or a theme the site edited), as the console's listing page does
 * (AGL-1018): never a plain re-install, but a review of what the update would do field by field, then Apply or Install as a
 * new copy, through `/api/marketplace/update-artifact`. Ports of `resolveProvenance` (artifact-provenance.ts),
 * `describeChange` and `summarizeValue` (artifact-merge.ts), replayed from the console's own cases. The Swift plugin's
 * ArtifactUpdate.swift holds the same.
 */

/** The console route that previews and applies an update of a copied listing. */
internal const val ARTIFACT_UPDATE_ROUTE = "/api/marketplace/update-artifact"

/** Where an installed copy came from (`resolveProvenance`): the listing and the version it was installed at. */
data class ArtifactProvenance(
  /** `recorded`, `inferred` or `unknown`. */
  val state: String,
  val listingId: String?,
  val version: String?,
  val sha256: String?,
  val artifactType: String?,
  val publisherOrgId: String?,
  /** A base snapshot exists, so the copy can be diffed and safely updated. */
  val updatable: Boolean,
) {
  companion object {
    val UNKNOWN = ArtifactProvenance("unknown", null, null, null, null, null, false)
  }
}

private fun asVersion(value: Any?): String? = when (value) {
  null -> null
  is String -> value.ifEmpty { null }
  is Number -> jsNumber(value.toDouble())
  else -> value.toString()
}

private fun Map<*, *>.text(key: String): String? = (this[key] as? String)?.ifEmpty { null }

/**
 * `resolveProvenance`: the full `installedFrom` stamp when it carries a hash and a type; else the legacy stamp of a component
 * (`marketplace`), a template, layout or schema (`source`), or a plugin pin (flat on the document).
 */
fun resolveProvenance(doc: Map<String, Any?>?, fallbackArtifactType: String? = null): ArtifactProvenance {
  if (doc == null) return ArtifactProvenance.UNKNOWN
  val stamped = doc["installedFrom"] as? Map<*, *>
  val stampedListing = stamped?.text("listingId")
  val sha = stamped?.text("sha256")
  val type = stamped?.text("artifactType")
  if (stampedListing != null && sha != null && type != null) {
    return ArtifactProvenance("recorded", stampedListing, asVersion(stamped["version"]), sha, type, stamped["publisherOrgId"] as? String, true)
  }
  val marketplace = doc["marketplace"] as? Map<*, *>
  val source = doc["source"] as? Map<*, *>
  val legacy: Triple<String, Any?, String?> = when {
    stampedListing != null -> Triple(stampedListing, stamped["version"], null)
    marketplace?.text("listingId") != null -> Triple(marketplace.text("listingId")!!, marketplace["version"], marketplace["profileId"] as? String)
    source?.text("listingId") != null -> Triple(source.text("listingId")!!, source["version"], null)
    (doc["listingId"] as? String)?.isNotEmpty() == true -> Triple(doc["listingId"] as String, doc["version"], doc["profileId"] as? String)
    else -> return ArtifactProvenance.UNKNOWN
  }
  val pin = (doc["pluginId"] as? String)?.isNotEmpty() == true && (doc["sha256"] as? String)?.isNotEmpty() == true
  return ArtifactProvenance(
    state = if (pin) "recorded" else "inferred",
    listingId = legacy.first,
    version = asVersion(legacy.second),
    sha256 = doc["sha256"] as? String,
    artifactType = if (pin) "plugin" else fallbackArtifactType,
    publisherOrgId = legacy.third,
    updatable = pin,
  )
}

/**
 * Whether a copy is behind its listing, as `resolveUpdateState` answers for anything but a plugin: `current`,
 * `update-available`, `ahead` or `unknown` (no version, nothing published, or versions that do not compare).
 */
fun copyUpdateState(installed: Map<String, Any?>?, latestVersion: String?, artifactType: String): Pair<String, String?> {
  val provenance = resolveProvenance(installed, artifactType)
  val version = provenance.version
  if (installed == null || provenance.state == "unknown" || version == null) return "unknown" to null
  if (latestVersion.isNullOrEmpty()) return "unknown" to version
  val order = compareArtifactVersions(version, latestVersion) ?: return "unknown" to version
  return (if (order == 0) "current" else if (order < 0) "update-available" else "ahead") to version
}

/** The listing's install button for a copied listing, as the console words it (never "Update": pressing it writes nothing). */
fun copyInstallLabel(state: String, installedVersion: String?, offeredVersion: String?): String = when (state) {
  "current" -> "Installed (v${installedVersion.orEmpty()})"
  "update-available" -> "Review update to v${offeredVersion.orEmpty()}"
  else -> "Review this version"
}

/** One field the update would touch; [current] and [incoming] are null when the field is absent on that side. */
data class ArtifactChange(val path: String, val current: JsonElement?, val incoming: JsonElement?, val added: Boolean, val removed: Boolean) {
  companion object {
    fun from(json: JsonElement): ArtifactChange {
      val obj = json as? JsonObject ?: JsonObject(emptyMap())
      return ArtifactChange(
        path = (obj["path"] as? JsonPrimitive)?.contentOrNull.orEmpty(),
        current = obj["current"],
        incoming = obj["incoming"],
        added = (obj["added"] as? JsonPrimitive)?.booleanOrNull == true,
        removed = (obj["removed"] as? JsonPrimitive)?.booleanOrNull == true,
      )
    }
  }
}

/** `describeChange`: the field's path, with the publisher's addition or removal said out loud. */
fun describeChange(path: String, added: Boolean, removed: Boolean): String {
  val label = path.ifEmpty { "the whole artifact" }
  return when {
    added -> "$label — added by the publisher"
    removed -> "$label — removed by the publisher"
    else -> label
  }
}

/** `summarizeValue`: a one-line preview of a value for a diff row; an absent value is "—". */
fun summarizeValue(value: JsonElement?): String = when (value) {
  null -> "—"
  is JsonNull -> "null"
  is JsonArray -> "${value.size} item${if (value.size == 1) "" else "s"}"
  is JsonObject -> {
    val keys = value.keys.sorted()
    "{ ${keys.take(3).joinToString(", ")}${if (keys.size > 3) ", …" else ""} }"
  }
  is JsonPrimitive -> when {
    value.isString -> value.content.let { if (it.isEmpty()) "(empty)" else if (it.length > 60) it.take(57) + "…" else it }
    value.booleanOrNull != null -> value.content
    value.doubleOrNull != null -> jsNumber(value.doubleOrNull!!)
    else -> value.content
  }
}

/** A dataset schema's change: fields added, removed and retyped, and the records it holds. */
data class ArtifactSchemaChange(val added: Int, val removed: Int, val retyped: Int, val additiveOnly: Boolean, val recordCount: Int)

private fun JsonElement?.field(key: String): JsonElement? = (this as? JsonObject)?.get(key)
private fun JsonElement?.textOf(key: String): String? = (field(key) as? JsonPrimitive)?.takeIf { it !is JsonNull }?.let { p ->
  if (p.isString) p.content else p.doubleOrNull?.let { jsNumber(it) }
}
private fun JsonElement?.flag(key: String): Boolean = (field(key) as? JsonPrimitive)?.booleanOrNull == true
private fun JsonElement?.count(key: String): Int = (field(key) as? JsonPrimitive)?.doubleOrNull?.toInt() ?: 0

/** What the route's `preview` answers: the version pair, whether the copy can be merged, and the changes by kind. */
data class ArtifactUpdatePreview(
  val installedVersion: String?,
  val availableVersion: String?,
  val mergeable: Boolean,
  val reason: String?,
  val safe: List<ArtifactChange>,
  val kept: List<ArtifactChange>,
  val conflicts: List<ArtifactChange>,
  val unchanged: Int,
  val identical: Boolean,
  val schema: ArtifactSchemaChange?,
) {
  /** Removing or retyping a schema field changes how stored records read, which the apply must confirm. */
  val destructive: Boolean get() = schema?.additiveOnly == false

  /** The version line at the top of the review. */
  val versionLine: String
    get() = installedVersion?.let { "You have v$it; v${availableVersion.orEmpty()} is available." } ?: "v${availableVersion.orEmpty()} is available."

  /** The apply button, as the console labels it for what it does. */
  fun applyLabel(taken: Int): String = when {
    identical -> "Take v${availableVersion.orEmpty()} (no content changes)"
    taken > 0 -> "Apply ($taken taken from publisher)"
    else -> "Apply safe changes"
  }

  companion object {
    fun from(json: JsonElement?): ArtifactUpdatePreview {
      fun changes(key: String) = (json.field(key) as? JsonArray).orEmpty().map(ArtifactChange::from)
      val schema = json.field("schema") as? JsonObject
      return ArtifactUpdatePreview(
        installedVersion = json.textOf("installedVersion"),
        availableVersion = json.textOf("availableVersion"),
        mergeable = json.flag("mergeable"),
        reason = json.textOf("reason"),
        safe = changes("safe"),
        kept = changes("kept"),
        conflicts = changes("conflicts"),
        unchanged = json.count("unchanged"),
        identical = json.flag("identical"),
        schema = schema?.let {
          ArtifactSchemaChange(
            (it["added"] as? JsonArray)?.size ?: 0, (it["removed"] as? JsonArray)?.size ?: 0, (it["retyped"] as? JsonArray)?.size ?: 0,
            it.flag("additiveOnly"), it.count("recordCount"),
          )
        },
      )
    }
  }
}

/** What a finished update says, as the console's: a new copy, a version-only bump, or what moved and what was kept. */
fun artifactUpdateSummary(mode: String, answer: JsonElement?): String {
  val version = answer.textOf("version").orEmpty()
  if (mode == "copy") return "Installed v$version as a new copy — your customized version is kept, no longer linked to the listing."
  val applied = answer.count("applied")
  val kept = answer.count("keptLocal")
  val skipped = (answer.field("skipped") as? JsonArray)?.size ?: 0
  if (applied == 0 && kept == 0 && skipped == 0) return "Now on v$version — this version changes nothing in your copy."
  return "Updated to v$version — $applied change(s) applied, $kept of yours kept" + (if (skipped > 0) ", $skipped conflict(s) left as yours" else "") + "."
}

/** The update route, as the signed-in member. */
class ArtifactUpdateApi(private val api: ConsoleApiClient, private val hostId: String) {
  /** What an update would do. Writes nothing. */
  suspend fun preview(listingId: String): ArtifactUpdatePreview =
    ArtifactUpdatePreview.from(api.request(ARTIFACT_UPDATE_ROUTE, ApiMethod.POST, jsonBody("listingId" to listingId, "hostId" to hostId, "action" to "preview")).field("preview"))

  /** Writes the update and answers what to tell the person: `merge` takes the safe changes plus the picked conflicts, `copy` detaches. */
  suspend fun apply(listingId: String, mode: String, takePaths: List<String> = emptyList(), confirmDestructive: Boolean = false): String =
    artifactUpdateSummary(
      mode,
      api.request(
        ARTIFACT_UPDATE_ROUTE, ApiMethod.POST,
        jsonBody("listingId" to listingId, "hostId" to hostId, "action" to "apply", "mode" to mode, "takePaths" to takePaths, "confirmDestructive" to confirmDestructive),
      ),
    )
}
