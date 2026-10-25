package com.aglyn.site.artifacts

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.FirestoreDoc
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.SearchField
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SvgPathIcon
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull

/** A Material Design icon as a component stores it (`ReusableComponentIcon`): its id, and the SVG path it is drawn from. */
data class ComponentIcon(val id: String, val path: String, val name: String = id) {
  /** The `icon` field a save writes. */
  fun stored(): Map<String, Any?> = mapOf("iconId" to id, "iconPath" to path)
}

/** The icon a component document carries, or null when it has none (a cleared icon is an empty map). */
fun componentIconOf(doc: FirestoreDoc): ComponentIcon? {
  val raw = doc.data["icon"] as? Map<*, *> ?: return null
  val id = (raw["iconId"] as? String)?.takeIf { it.isNotBlank() } ?: return null
  return ComponentIcon(id, (raw["iconPath"] as? String).orEmpty())
}

/** `GET /api/hosts/icons?search=`: the icons a picker lists for what was typed, at most sixty. */
suspend fun searchComponentIcons(api: ConsoleApiClient, search: String): List<ComponentIcon> {
  val answer = api.request("/api/hosts/icons", ApiMethod.GET, query = mapOf("search" to search.trim())) as? JsonObject
  return (answer?.get("icons") as? JsonArray).orEmpty().mapNotNull { entry ->
    val icon = entry as? JsonObject ?: return@mapNotNull null
    fun text(key: String) = (icon[key] as? JsonPrimitive)?.contentOrNull
    ComponentIcon(text("id") ?: return@mapNotNull null, text("path").orEmpty(), text("name") ?: text("id").orEmpty())
  }
}

/** The icon a person picks for a component, in the details dialog: the glyph, its id and the actions to change or remove it. */
@Composable
fun ComponentIconField(icon: ComponentIcon?, enabled: Boolean, onChoose: () -> Unit, onClear: () -> Unit) {
  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    Box(Modifier.size(40.dp), contentAlignment = Alignment.Center) {
      if (icon != null) SvgPathIcon(icon.path, icon.name, size = 28.dp)
    }
    Column(Modifier.weight(1f)) {
      Text("Icon", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      Text(icon?.id ?: "None chosen", style = MaterialTheme.typography.bodyMedium)
    }
    OutlinedButton(onClick = onChoose, enabled = enabled, modifier = Modifier.testTag("component-icon-choose")) { Text(if (icon == null) "Choose" else "Change") }
    if (icon != null) TextButton(onClick = onClear, enabled = enabled, modifier = Modifier.testTag("component-icon-clear")) { Text("Remove") }
  }
}

/** Searches the icon set and returns the one a person taps, as the console's picker does with Choose. */
@Composable
fun ComponentIconPicker(api: ConsoleApiClient, current: ComponentIcon?, onPick: (ComponentIcon) -> Unit, onDismiss: () -> Unit) {
  var search by remember { mutableStateOf("") }
  var picked by remember(current) { mutableStateOf(current) }
  val found by produceState<Result<List<ComponentIcon>>?>(null, search) {
    value = null
    // A pause after the last key, so the route is asked once per word rather than once per letter.
    if (search.isNotEmpty()) delay(300)
    value = try {
      Result.success(searchComponentIcons(api, search))
    } catch (error: kotlinx.coroutines.CancellationException) {
      throw error
    } catch (error: Throwable) {
      Result.failure(error)
    }
  }
  ActionDialog(
    title = "Choose an icon",
    icon = "widgets",
    confirmLabel = "Choose",
    confirmEnabled = picked != null && picked?.id != current?.id,
    onDismiss = onDismiss,
    onConfirm = { picked?.let(onPick) },
  ) {
    SearchField(search, { search = it }, placeholder = "Search icons, such as cart or phone", modifier = Modifier.testTag("icon-search"))
    val result = found
    when {
      result == null -> Text("Searching…", color = MaterialTheme.colorScheme.onSurfaceVariant)
      result.isFailure -> NoticeBanner("The icons could not be loaded. Check the connection and try again.", StatusTone.ERROR)
      result.getOrThrow().isEmpty() -> Text("No icon matches that. Try another word.", color = MaterialTheme.colorScheme.onSurfaceVariant)
      else -> LazyVerticalGrid(
        GridCells.Adaptive(56.dp),
        Modifier.fillMaxWidth().heightIn(max = 320.dp),
        horizontalArrangement = Arrangement.spacedBy(space(0.5f)),
        verticalArrangement = Arrangement.spacedBy(space(0.5f)),
      ) {
        items(result.getOrThrow(), key = { it.id }) { icon ->
          val selected = picked?.id == icon.id
          Box(
            Modifier
              .size(56.dp)
              .clip(RoundedCornerShape(8.dp))
              .background(if (selected) MaterialTheme.colorScheme.primaryContainer else Color.Transparent)
              .clickable { picked = icon }
              .semantics { contentDescription = icon.name + if (selected) ", selected" else "" }
              .testTag("icon-${icon.id}"),
            contentAlignment = Alignment.Center,
          ) {
            SvgPathIcon(icon.path, null, size = 28.dp, tint = if (selected) MaterialTheme.colorScheme.onPrimaryContainer else MaterialTheme.colorScheme.onSurface)
          }
        }
      }
    }
    picked?.let { Text("${it.name} (${it.id})", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
  }
}
