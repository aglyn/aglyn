package com.aglyn.site.artifacts

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.compose.foundation.layout.Row
import com.aglyn.contracts.normalizeScreenSlug
import com.aglyn.pluginhost.ActionRunner
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.site.pages.PagesApi
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.CountedTextField
import com.aglyn.ui.EmptyState
import com.aglyn.ui.LoadContent
import com.aglyn.ui.LoadMoreEffect
import com.aglyn.ui.SearchField
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

/** The words for one template kind. */
private fun noun(kind: String) = when (kind) {
  "component" -> "component"
  "layout" -> "layout"
  else -> "page"
}

/** Where a made component, layout or page opens: its own list, with it picked. */
fun templateUseDestination(kind: String, id: String): Pair<String, Map<String, String>> = when (kind) {
  "component" -> ArtifactKind.COMPONENT.screen to mapOf("id" to id)
  "layout" -> ArtifactKind.LAYOUT.screen to mapOf("id" to id)
  else -> "site.pages" to mapOf("page" to id)
}

/**
 * The templates of one kind to start from, the console's "Start from a
 * template" gallery: this site's saved, installed and starter templates, one
 * tap to choose. A starter site is one row that makes all its pages.
 */
@Composable
fun TemplateGalleryDialog(context: NativePluginContext, hostId: String, kind: String, onChoose: (ArtifactRow) -> Unit, onDismiss: () -> Unit) {
  val scope = rememberCoroutineScope()
  val model = remember(hostId, kind) { ArtifactListModel(ArtifactKind.TEMPLATE, hostId, context.firestore, scope) }
  LaunchedEffect(model) { model.pick(kind) }
  Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Surface(Modifier.widthIn(max = 560.dp).fillMaxWidth(0.96f).heightIn(max = 760.dp).testTag("template-gallery"), shape = MaterialTheme.shapes.extraLarge, color = MaterialTheme.colorScheme.surface) {
      Column {
        Row(Modifier.padding(horizontal = space(2f), vertical = space(1.5f)), verticalAlignment = Alignment.CenterVertically) {
          Text("Start from a ${noun(kind)} template", Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
          TextButton(onClick = onDismiss) { Text("Cancel") }
        }
        HorizontalDivider()
        SearchField(model.search, model::type, placeholder = "Search templates", modifier = Modifier.padding(space(2f)))
        val listState = rememberLazyListState()
        LoadMoreEffect(listState, model.hasMore, onLoadMore = model::loadMore)
        LoadContent(model.rows, onRetry = { model.reload() }, failedTitle = "Could not load templates", skeleton = { SkeletonList(rows = 5, modifier = Modifier.padding(space(2f))) }) { rows ->
          if (rows.isEmpty()) {
            EmptyState(
              if (model.search.isBlank()) "No ${noun(kind)} templates yet" else "No templates match",
              body = if (model.search.isBlank()) "Save one from an existing ${noun(kind)}, or start blank." else "Try another search.",
              icon = AglynIcons.named("dashboard_customize"),
            )
          } else {
            LazyColumn(Modifier.fillMaxSize().testTag("template-gallery-list"), state = listState) {
              items(rows, key = { it.id }) { row ->
                AglynListItem(
                  title = if (row.isStarterBundle) row.starterName ?: row.name else row.name,
                  supporting = row.description ?: "No description",
                  icon = AglynIcons.named("dashboard_customize"),
                  trailing = { StatusChip(if (row.isStarterBundle) "Starter site" else templateSourceLabel(row.sourceType), StatusTone.NEUTRAL) },
                  onClick = { onChoose(row) },
                  modifier = Modifier.testTag("template-${row.id}"),
                )
              }
            }
          }
        }
      }
    }
  }
}

private sealed interface TemplateLoad {
  data object Loading : TemplateLoad
  data object Gone : TemplateLoad
  data class Ready(val pages: List<TemplateContent>) : TemplateLoad
}

/**
 * Use this template: name it, give a page its address, fill in what it asks
 * for, and it becomes a page, component or layout of this site; the template
 * stays in the library. A starter site makes all of its pages.
 */
@Composable
fun UseTemplateDialog(context: NativePluginContext, hostId: String, row: ArtifactRow, onDone: (kind: String, id: String) -> Unit, onDismiss: () -> Unit) {
  val scope = rememberCoroutineScope()
  val runner = remember(row.id) { ActionRunner(scope) }
  val templates = remember(hostId, context.api, context.firestore, context.writer) { TemplatesApi(context.api, context.firestore, context.writer, hostId) }
  val pagesApi = remember(hostId, context.api, context.writer) { PagesApi(context.api, context.writer, hostId) }
  val load by produceState<TemplateLoad>(TemplateLoad.Loading, row.id) {
    value = runCatching {
      val bundle = row.starterId?.let { templates.bundlePages(it) }
      val pages = bundle?.takeIf { it.isNotEmpty() } ?: listOfNotNull(templates.load(row.id))
      if (pages.isEmpty()) TemplateLoad.Gone else TemplateLoad.Ready(pages)
    }.getOrElse { TemplateLoad.Gone }
  }
  when (val state = load) {
    TemplateLoad.Loading -> ActionDialog("Use this template", confirmLabel = "Create", confirmEnabled = false, onConfirm = {}, onDismiss = onDismiss, icon = "dashboard_customize") {
      SkeletonList(rows = 3)
    }
    TemplateLoad.Gone -> ActionDialog("Use this template", confirmLabel = "Close", onConfirm = onDismiss, onDismiss = onDismiss, body = "This template is gone or could not be read.", icon = "dashboard_customize")
    is TemplateLoad.Ready -> {
      val first = state.pages.first()
      val bundle = row.isStarterBundle && state.pages.size > 1
      var name by remember(row.id) { mutableStateOf(first.name) }
      var slug by remember(row.id) { mutableStateOf(first.slug ?: normalizeScreenSlug(first.name) ?: "page") }
      val values = remember(row.id) { mutableStateMapOf<String, String>().apply { first.placeholders.forEach { put(it.name, it.defaultValue) } } }
      val kindNoun = noun(first.kind)
      val addressProblem = if (first.kind == "page" && !bundle) pageAddressProblem(slug, name) else null
      ActionDialog(
        title = "Use this template",
        icon = "dashboard_customize",
        body = when {
          bundle -> "Adds the ${state.pages.size} pages of ${row.starterName ?: row.name}, published at their addresses. The template stays in your library."
          first.kind == "page" -> "Creates a new page from this template and publishes it at the address below. The template stays in your library."
          else -> "Creates a new $kindNoun from this template. The template stays in your library."
        },
        confirmLabel = if (bundle) "Add ${state.pages.size} pages" else "Create $kindNoun",
        confirmEnabled = (bundle || name.isNotBlank()) && addressProblem == null,
        busy = runner.busy,
        error = runner.error,
        onDismiss = onDismiss,
        onConfirm = {
          runner.run {
            if (bundle) {
              val (made, skipped) = templates.useBundle(state.pages, pagesApi)
              if (made.isEmpty()) throw TemplateProblem(skipped.joinToString("; ").ifEmpty { "No page could be added." })
              onDone("page", made.first().screenId)
            } else {
              val id = when (first.kind) {
                "component" -> templates.useComponent(first, name, values.toMap())
                "layout" -> templates.useLayout(first, name, values.toMap())
                else -> templates.usePage(first, name, slug, values.toMap(), templates.takenAddresses(), pagesApi).screenId
              }
              onDone(first.kind, id)
            }
          }
        },
      ) {
        if (!bundle) {
          CountedTextField("${kindNoun.replaceFirstChar { it.uppercase() }} name", name, { name = it }, max = 200, modifier = Modifier.testTag("use-template-name"))
          if (first.kind == "page") {
            CountedTextField(
              "Slug",
              slug,
              { slug = it },
              error = addressProblem,
              supporting = "/" + (normalizeScreenSlug(slug) ?: normalizeScreenSlug(name) ?: "page").trimStart('/'),
              modifier = Modifier.testTag("use-template-slug"),
            )
          }
          if (first.placeholders.isNotEmpty()) {
            Text("This template asks for:", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
            for (placeholder in first.placeholders) {
              CountedTextField(placeholder.label, values[placeholder.name].orEmpty(), { values[placeholder.name] = it })
            }
          }
        }
      }
    }
  }
}

/**
 * Save as template: a copy of a page, component or layout to start new ones
 * from; the original is untouched and the template stays out of the live site
 * until it is used. [load] reads what to capture when the person confirms.
 */
@Composable
fun SaveAsTemplateDialog(context: NativePluginContext, hostId: String, kind: String, defaultName: String, load: suspend (TemplatesApi) -> TemplateSource?, onSaved: (String) -> Unit, onDismiss: () -> Unit) {
  val scope = rememberCoroutineScope()
  val runner = remember(kind, defaultName) { ActionRunner(scope) }
  val templates = remember(hostId, context.api, context.firestore, context.writer) { TemplatesApi(context.api, context.firestore, context.writer, hostId) }
  var name by remember(defaultName) { mutableStateOf(defaultName) }
  var description by remember(defaultName) { mutableStateOf("") }
  ActionDialog(
    title = "Save as template",
    icon = "bookmark",
    body = "Saves a copy of this ${noun(kind)} to your templates. The original is untouched, and the template stays out of your live site until you use it.",
    confirmLabel = "Save template",
    confirmEnabled = name.isNotBlank(),
    busy = runner.busy,
    error = runner.error,
    onDismiss = onDismiss,
    onConfirm = {
      runner.run {
        val source = load(templates) ?: throw TemplateProblem("Nothing to save yet — publish this first, then save it as a template.")
        val placeholders = templates.saveAsTemplate(source, name, description)
        onSaved(
          if (placeholders > 0) "Saved “${name.trim()}” with $placeholders placeholder${if (placeholders == 1) "" else "s"} to fill in when it is used."
          else "Saved “${name.trim()}” to your templates.",
        )
      }
    },
  ) {
    CountedTextField("Template name", name, { name = it }, max = 200, modifier = Modifier.testTag("save-template-name"))
    CountedTextField("Description (optional)", description, { description = it }, max = 500, multiline = true, minLines = 2)
  }
}
