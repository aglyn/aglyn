package com.aglyn.site.pages

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Row
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.core.ApiMethod
import com.aglyn.core.ConsoleApiClient
import com.aglyn.core.jsonValue
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.artifacts.dependentLabel
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.PlainSection
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull

/*
 * "Used by" for a page (AGL-703), as the console's page view shows it: on
 * demand, because the scan reads every page, layout and component on the site.
 * The Apple kit's PageUsedBy.swift.
 */

/** Something that points at a page, with how (`relation`). */
data class PageDependent(val type: String, val id: String, val name: String, val relation: String?)

/** What a dependent's `relation` is called on its row (`RELATION_LABEL`). */
fun pageRelationLabel(relation: String?): String? = when (relation) {
  "link" -> "links here"
  "child" -> "nested under"
  "template" -> "renders through"
  else -> null
}

/** The console's scope note for a page's scan (`SCOPE_NOTE.screen`). */
const val PAGE_USED_BY_SCOPE_NOTE =
  "Scanned: link targets on the published version of every page and layout, on every component, the pages nested under " +
    "this one, and the collections that render their pages through it. Links typed as plain addresses rather than picked " +
    "as pages are not scanned — nothing records which page those meant."

/** `POST /api/hosts/where-used` for a page: who points at it, and whether the scan read everything. */
suspend fun pageWhereUsed(api: ConsoleApiClient, hostId: String, pageId: String): Pair<List<PageDependent>, Boolean> {
  val answer = api.request("/api/hosts/where-used", ApiMethod.POST, jsonValue(mapOf("hostId" to hostId, "kind" to "screen", "id" to pageId))) as? JsonObject
  fun text(entry: JsonObject, key: String) = (entry[key] as? JsonPrimitive)?.contentOrNull
  val list = (answer?.get("dependents") as? JsonArray).orEmpty().mapNotNull { element ->
    val entry = element as? JsonObject ?: return@mapNotNull null
    val id = text(entry, "id") ?: return@mapNotNull null
    PageDependent(text(entry, "type") ?: "screen", id, text(entry, "name") ?: "Untitled", text(entry, "relation"))
  }
  return list to ((answer?.get("complete") as? JsonPrimitive)?.booleanOrNull == true)
}

private sealed interface UsedByPhase {
  data object Idle : UsedByPhase
  data object Loading : UsedByPhase
  data object Failed : UsedByPhase
  data class Ready(val found: List<PageDependent>, val complete: Boolean) : UsedByPhase
}

/** The page's "Used by" section: Find where this is used, then what points at it, each with how and what kind. */
@Composable
internal fun PageUsedBySection(context: NativePluginContext, hostId: String, pageId: String) {
  var phase by remember(pageId) { mutableStateOf<UsedByPhase>(UsedByPhase.Idle) }
  val scope = rememberCoroutineScope()
  val muted = MaterialTheme.colorScheme.onSurfaceVariant
  fun scan() {
    phase = UsedByPhase.Loading
    scope.launch {
      phase = runCatching { pageWhereUsed(context.api, hostId, pageId) }.fold({ UsedByPhase.Ready(it.first, it.second) }, { UsedByPhase.Failed })
    }
  }
  PlainSection("Used by", Modifier.testTag("page-used-by")) {
    when (val state = phase) {
      UsedByPhase.Idle -> {
        Text("Find every page, layout, and component that renders this page before you change or delete it.", color = muted)
        OutlinedButton(onClick = { scan() }, modifier = Modifier.testTag("page-used-by-scan")) { Text("Find where this is used") }
        Text(PAGE_USED_BY_SCOPE_NOTE, style = MaterialTheme.typography.bodySmall, color = muted)
      }
      UsedByPhase.Loading -> Text("Checking what uses this page…", color = muted)
      UsedByPhase.Failed -> {
        NoticeBanner(
          "Could not check what uses this page. This is not the same as nothing using it — treat deletion as unsafe until the check succeeds.",
          StatusTone.WARNING,
        )
        TextButton(onClick = { scan() }) { Text("Try again") }
      }
      is UsedByPhase.Ready -> {
        if (state.found.isEmpty()) {
          if (state.complete) {
            Text("Nothing uses this page — deleting it changes no live page.")
          } else {
            NoticeBanner("Nothing found, but this site has more content than one pass reads — something may still use this page.", StatusTone.WARNING)
          }
        } else {
          Text("Used in ${state.found.size} place${if (state.found.size == 1) "" else "s"} — deleting this page affects each of them.", color = muted)
          for (item in state.found) {
            AglynListItem(
              title = item.name,
              icon = AglynIcons.named(if (item.type == "screen") "description" else "widgets"),
              trailing = {
                Row(horizontalArrangement = Arrangement.spacedBy(space(0.5f))) {
                  pageRelationLabel(item.relation)?.let { StatusChip(it, if (item.relation == "template") StatusTone.WARNING else StatusTone.NEUTRAL) }
                  StatusChip(dependentLabel(item.type))
                }
              },
            )
          }
        }
        Text(PAGE_USED_BY_SCOPE_NOTE, style = MaterialTheme.typography.bodySmall, color = muted)
        TextButton(onClick = { scan() }, modifier = Modifier.testTag("page-used-by-rescan")) { Text("Rescan") }
      }
    }
  }
}
