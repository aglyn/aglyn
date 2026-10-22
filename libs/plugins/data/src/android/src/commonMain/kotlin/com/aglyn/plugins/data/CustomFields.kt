package com.aglyn.plugins.data

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.DatasetFieldDefinition
import com.aglyn.contracts.DatasetFieldType
import com.aglyn.core.FirestoreOrder
import com.aglyn.core.FirestoreQuery
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.media.MediaChooserDialog
import com.aglyn.site.pages.PAGES_WINDOW
import com.aglyn.site.pages.PageNode
import com.aglyn.ui.ChoiceField
import com.aglyn.ui.InputChoice
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

// The named field types a dataset field can ride on a storage type (the
// console's custom field types, AGL-434): the Data plugin's Page address,
// Image and Page (AGL-3616, AGL-3763), and the Marketplace plugin's Rating.
// The field's definition keeps its storage `type` and gains `customType`;
// the records route validates the value, so these helpers only choose and
// show what the route will accept.

/** One named field type, as the console's registry declares it. */
internal data class DatasetCustomType(val name: String, val label: String, val pluginId: String, val baseType: DatasetFieldType)

internal const val RECORD_ADDRESS_FIELD_TYPE = "pageAddress"
internal const val DATASET_IMAGE_FIELD_TYPE = "image"
internal const val DATASET_PAGE_FIELD_TYPE = "page"
internal const val DATASET_RATING_FIELD_TYPE = "rating"

/** The types the console's Type menu lists after the storage types, in its order. */
internal val DATASET_CUSTOM_TYPES = listOf(
  DatasetCustomType(RECORD_ADDRESS_FIELD_TYPE, "Page address", "data", DatasetFieldType.TEXT),
  DatasetCustomType(DATASET_IMAGE_FIELD_TYPE, "Image", "data", DatasetFieldType.TEXT),
  DatasetCustomType(DATASET_PAGE_FIELD_TYPE, "Page", "data", DatasetFieldType.TEXT),
  DatasetCustomType(DATASET_RATING_FIELD_TYPE, "Rating (0–5)", "marketplace", DatasetFieldType.INT32),
)

internal fun datasetCustomType(name: String?): DatasetCustomType? = name?.let { n -> DATASET_CUSTOM_TYPES.firstOrNull { it.name == n } }

/** The Type menu's row for a definition: `custom:{name}` for a named type, else the storage type. */
internal fun datasetTypeSelection(definition: DatasetFieldDefinition): String =
  definition.customType?.takeIf { datasetCustomType(it) != null }?.let { "custom:$it" } ?: (definition.type?.raw ?: "text")

/** Applies a Type menu pick: a named type rides its storage type and stamps `customType`; a storage type clears it. */
internal fun applyDatasetTypeSelection(selection: String, definition: DatasetFieldDefinition): DatasetFieldDefinition {
  if (selection.startsWith("custom:")) {
    val custom = datasetCustomType(selection.removePrefix("custom:")) ?: return definition
    return definition.copy(type = custom.baseType, customType = custom.name)
  }
  return definition.copy(type = DatasetFieldType.entries.firstOrNull { it.raw == selection } ?: DatasetFieldType.TEXT, customType = null)
}

private val RECORD_ADDRESS = Regex("^[a-z0-9]+(?:-[a-z0-9]+)*$")

/** A record's page address is a lowercase URL segment: letters and digits joined by single hyphens, 64 at most. */
internal fun isRecordAddress(value: String): Boolean = value.length <= 64 && RECORD_ADDRESS.matches(value)

private val MEDIA_SEGMENT = Regex("^[A-Za-z0-9_-]{1,64}$")

private fun isSegment(text: String) = MEDIA_SEGMENT.matches(text)

/** A media CDN scope: a site id, `org:{orgId}` or `org:{orgId}:{siteId}`. */
private fun isMediaCdnScope(scope: String): Boolean {
  if (!scope.startsWith("org:")) return isSegment(scope)
  val parts = scope.removePrefix("org:").split(':')
  return parts.size in 1..2 && parts.all(::isSegment)
}

/** A `media:{scope}/{mediaId}[@{hash}]` reference read apart, or null when it is not a well-formed one. */
internal fun parseMediaReference(value: String): Pair<String, String>? {
  if (!value.startsWith("media:")) return null
  val rest = value.removePrefix("media:")
  val slash = rest.indexOf('/')
  if (slash <= 0) return null
  val scope = rest.substring(0, slash)
  val mediaId = rest.substring(slash + 1).substringBefore('@')
  return if (isMediaCdnScope(scope) && isSegment(mediaId)) scope to mediaId else null
}

private val IMAGE_FORBIDDEN = Regex("[\\s\"'<>\\\\]")
private val HTTPS_ADDRESS = Regex("^https://[^/]+")

/**
 * Whether a value is a photo address a record may hold (`isDatasetImageValue`): a `media:` reference, a path on
 * the site, or an https address, with no spaces, quotes or angle brackets, at most 2,000 characters.
 */
internal fun isDatasetImageValue(value: String): Boolean {
  if (value.isEmpty() || value.length > 2_000 || IMAGE_FORBIDDEN.containsMatchIn(value)) return false
  if (value.startsWith("media:")) return parseMediaReference(value) != null
  if (value.startsWith("/")) return !value.startsWith("//")
  return HTTPS_ADDRESS.containsMatchIn(value)
}

/** A page value is `screen:{screenId}`, the form the Besigner's page pickers write into a link. */
internal fun datasetPageValue(screenId: String): String = "screen:$screenId"

private val SCREEN_ID = Regex("^[A-Za-z0-9_-]{1,128}$")

/** The page a stored value names, or null when it names none (`datasetPageScreenId`). */
internal fun datasetPageScreenId(value: String): String? {
  if (!value.startsWith("screen:")) return null
  val key = value.removePrefix("screen:").trim()
  return key.takeIf { SCREEN_ID.matches(it) }
}

/**
 * Where a photo value is served from, for the preview: a reference through the media CDN (qualified for the site
 * being edited, as `resolveMediaSrc` does), a path on the console origin, or the https address.
 */
internal fun datasetImagePreviewUrl(value: String, origin: String, hostId: String?): String? {
  val trimmed = value.trim()
  if (trimmed.isEmpty()) return null
  val base = origin.trimEnd('/')
  parseMediaReference(trimmed)?.let { (scope, mediaId) ->
    val qualified = if (hostId != null && isSegment(hostId) && scope.startsWith("org:")) "org:${scope.removePrefix("org:").substringBefore(':')}:$hostId" else scope
    return "$base/api/media/cdn/$qualified/$mediaId?w=320"
  }
  return if (trimmed.startsWith("/")) base + trimmed else trimmed
}

/**
 * A record's photo: Choose from media opens the library (this site's files and the workspace's), and the pick is
 * stored as a `media:` reference; a photo hosted elsewhere is still possible behind "Use a link instead".
 */
@Composable
internal fun DatasetImageInput(context: NativePluginContext, label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
  var choosing by remember { mutableStateOf(false) }
  var linkOpen by remember { mutableStateOf(value.startsWith("https://")) }
  Column(modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(1f))) {
    Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(2f))) {
      RemoteImage(
        datasetImagePreviewUrl(value, context.api.origin, context.hostId),
        null,
        Modifier.width(96.dp).height(72.dp).clip(MaterialTheme.shapes.small),
        icon = "image",
      )
      Column {
        OutlinedButton(onClick = { choosing = true }, modifier = Modifier.testTag("image-choose")) { Text(if (value.isEmpty()) "Choose from media" else "Change photo") }
        if (value.isNotEmpty()) TextButton(onClick = { onChange(""); linkOpen = false }) { Text("Remove") }
      }
    }
    if (linkOpen) {
      // A picked photo is a reference, not a link: the field stays empty for it rather than showing a value nobody edits by hand.
      OutlinedTextField(
        if (value.startsWith("https://") || value.isEmpty()) value else "",
        { onChange(it.trim()) },
        label = { Text("Photo link (https://)") },
        supportingText = { Text("A photo hosted on another website, starting with https://") },
        singleLine = true,
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Uri),
        modifier = Modifier.fillMaxWidth(),
      )
    } else {
      TextButton(onClick = { linkOpen = true }) { Text("Use a link instead") }
    }
  }
  if (choosing) {
    MediaChooserDialog(context, onChoose = { onChange(it.reference); choosing = false }, onDismiss = { choosing = false })
  }
}

/**
 * A record's page: one of the site's pages, picked by name and stored as `screen:{id}` so a link bound to it follows
 * the page wherever it moves. Datasets belong to the workspace and a page to one site, so the list is the pages of the
 * site whose Data page is open; the workspace's Data page says where to go.
 */
@Composable
internal fun DatasetPageInput(context: NativePluginContext, label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier) {
  val hostId = context.hostId
  val selected = datasetPageScreenId(value).orEmpty()
  if (hostId == null) {
    Column(modifier.fillMaxWidth()) {
      OutlinedTextField(if (selected.isEmpty()) "No page chosen" else "A page is chosen", {}, label = { Text(label) }, enabled = false, singleLine = true, modifier = Modifier.fillMaxWidth())
      Text(
        "Pages belong to a site. Open this dataset from that site's Data page to choose one.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
    return
  }
  val live by remember(hostId, context.firestore) {
    context.firestore.observe(FirestoreQuery("hosts/$hostId/screens", orderBy = listOf(FirestoreOrder("__name__")), limit = PAGES_WINDOW))
  }.collectAsState(Live.Loading)
  val pages = ((live as? Live.Ready)?.value.orEmpty()).mapNotNull(PageNode::from).filter { !it.isGroup }
    .map { InputChoice(it.id, it.name) }.sortedBy { it.label.lowercase() }
  val known = selected.isEmpty() || pages.any { it.value == selected }
  // A page that was deleted, or is not in this site, is named rather than shown as empty.
  val choices = if (known) pages else pages + InputChoice(selected, "⚠ A page this site no longer has")
  ChoiceField(
    label,
    selected,
    choices,
    { onChange(if (it.isEmpty()) "" else datasetPageValue(it)) },
    modifier.testTag("page-picker"),
    supporting = if (live is Live.Loading) "Loading pages…" else null,
    emptyLabel = "No page",
  )
}

/** A rating: a whole number from 0 to 5, or none. */
@Composable
internal fun DatasetRatingInput(label: String, value: String, onChange: (String) -> Unit, modifier: Modifier = Modifier, supporting: String? = null, isError: Boolean = false) {
  ChoiceField(label, value, (0..5).map { InputChoice("$it", "$it") }, onChange, modifier, supporting, isError)
}
