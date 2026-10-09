package com.aglyn.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.ExposedDropdownMenuAnchorType
import androidx.compose.material3.ExposedDropdownMenuBox
import androidx.compose.material3.ExposedDropdownMenuDefaults
import androidx.compose.material3.FilledTonalButton
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.VerticalDivider
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateMapOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.WidthClass
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

internal fun tone(name: String?): StatusTone = when (name) {
  "success" -> StatusTone.SUCCESS
  "warning" -> StatusTone.WARNING
  "error" -> StatusTone.ERROR
  "info" -> StatusTone.INFO
  else -> StatusTone.NEUTRAL
}

internal fun toneFor(spec: JsonElement, value: String, context: JsonElement): StatusTone {
  val map = spec.obj("tones") as? JsonObject
  if (map != null) return tone((map[value] as? JsonPrimitive)?.content ?: (map["*"] as? JsonPrimitive)?.content)
  return tone(spec.str("tone")?.let { ScreenValues.render(it, context) })
}

internal fun renderParams(params: JsonElement?, context: JsonElement): NativeParams =
  ((params as? JsonObject) ?: JsonObject(emptyMap())).mapValues { (_, value) ->
    ScreenValues.render((value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ScreenValues.text(value), context)
  }

private data class Selection(val screen: String, val params: NativeParams)

private class Pending(val action: ActionSpec, val scope: JsonElement, val reauthMessage: String? = null)

/**
 * Draws a console screen from its spec: sections in cards, list and detail
 * side by side on a wide window when the spec asks, pull to refresh,
 * skeleton, empty and error states, and every action with its confirmation,
 * inputs, re-auth and result. Twin of the Apple `SpecScreenView`.
 */
@Composable
fun SpecScreen(
  spec: ScreenSpec,
  plugin: NativePluginContext,
  params: NativeParams = emptyMap(),
  embedded: Boolean = false,
  /** Data to show instead of loading (snapshot tests). */
  seed: JsonElement? = null,
) {
  val session = LocalScreenSession.current
  val base = session.context(plugin, params)
  if (!ScreenValues.condition(spec.requires, base)) {
    EmptyState(
      if (spec.scope == "staff") "Staff only" else "Not available to your role",
      body = if (spec.scope == "staff") "This page is for Aglyn staff." else "Ask an owner or admin of this workspace for access.",
      icon = AglynIcons.named("lock"),
    )
    return
  }
  val key = "${spec.id}:${plugin.orgId}:${plugin.hostId}:$params"
  val model = remember(key) { ScreenModel(spec, base, plugin.api, plugin.firestore, plugin.writer, session.account) }
  LaunchedEffect(key) { if (seed != null) model.seed(seed) else model.load() }
  var selection by remember(key) { mutableStateOf<Selection?>(null) }
  val split = !embedded && spec.blocks.any { it.type == "list" && it.flag("split") && it["open"] != null }
  val wide = currentWidthClass() != WidthClass.COMPACT
  if (split && wide) {
    Row(Modifier.fillMaxSize()) {
      Box(Modifier.weight(0.42f).fillMaxHeight()) {
        SpecBody(model, plugin, selection, onSelect = { selection = it }, splitting = true)
      }
      VerticalDivider()
      Box(Modifier.weight(0.58f).fillMaxHeight()) {
        val picked = selection
        val detail = picked?.let { ScreenCatalog.spec(it.screen) }
        if (picked != null && detail != null) {
          SpecScreen(detail, plugin, picked.params, embedded = true)
        } else {
          EmptyState("Nothing selected", body = "Pick a row to see it here.", icon = AglynIcons.named("chevron_right"))
        }
      }
    }
  } else {
    SpecBody(model, plugin, selection, onSelect = { selection = it }, splitting = false)
  }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun SpecBody(
  model: ScreenModel,
  plugin: NativePluginContext,
  selection: Selection?,
  onSelect: (Selection) -> Unit,
  splitting: Boolean,
) {
  val session = LocalScreenSession.current
  val scope = rememberCoroutineScope()
  @Suppress("DEPRECATION") val clipboard = LocalClipboardManager.current
  var confirming by remember { mutableStateOf<Pending?>(null) }
  var prompting by remember { mutableStateOf<Pending?>(null) }
  var reauthing by remember { mutableStateOf<Pending?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var revealed by remember { mutableStateOf<Pair<String, String>?>(null) }
  var running by remember { mutableStateOf<String?>(null) }
  var refreshing by remember { mutableStateOf(false) }
  val context = model.context

  fun show(text: String, tone: StatusTone) {
    notice = text to tone
    scope.launch {
      delay(4000)
      if (notice?.first == text) notice = null
    }
  }

  fun open(screen: String, params: NativeParams) {
    if (splitting && ScreenCatalog.spec(screen) != null) onSelect(Selection(screen, params)) else plugin.navigate(screen, params)
  }

  suspend fun execute(action: ActionSpec, actionScope: JsonElement) {
    action.copy?.let {
      clipboard.setText(AnnotatedString(ScreenValues.render(it, actionScope)))
      show("Copied", StatusTone.SUCCESS)
      return
    }
    action.besigner?.let {
      if (!plugin.openBesigner(ScreenValues.render(it, actionScope), com.aglyn.pluginhost.ConsoleScope.ABSOLUTE)) {
        show("That page does not open in the app.", StatusTone.WARNING)
      }
      return
    }
    action.link?.let {
      val rendered = ScreenValues.render(it, actionScope)
      session.openHostedPage(if (rendered.startsWith("/")) session.origin + rendered else rendered)
      return
    }
    running = action.id
    val outcome = model.run(action, actionScope)
    running = null
    when (outcome) {
      is ActionOutcome.NeedsReauth -> reauthing = Pending(action, actionScope, outcome.message)
      is ActionOutcome.Failed -> show(outcome.message, StatusTone.ERROR)
      is ActionOutcome.Done -> {
        val after = ScreenContext.with(actionScope, "response", outcome.response)
        outcome.message?.takeIf { it.isNotEmpty() }?.let { show(it, StatusTone.SUCCESS) }
        action.reveal?.let { path -> ScreenValues.lookup(path, outcome.response ?: JsonNull)?.let { revealed = action.label to ScreenValues.text(it) } }
        action.openUrl?.let { path -> (ScreenValues.lookup(path, outcome.response ?: JsonNull) as? JsonPrimitive)?.content?.let(session.openHostedPage) }
        action.navigate?.let { nav -> plugin.navigate(nav.screen, nav.params.mapValues { ScreenValues.render(it.value, after) }) }
        if (action.back) session.back() else if (action.reload) model.load()
      }
    }
  }

  fun trigger(action: ActionSpec, actionScope: JsonElement) {
    when {
      action.inputs.isNotEmpty() -> prompting = Pending(action, actionScope)
      action.confirm != null && ScreenValues.condition(action.confirmWhen, actionScope) -> confirming = Pending(action, actionScope)
      else -> scope.launch { execute(action, actionScope) }
    }
  }

  when (val phase = model.phase) {
    ScreenModel.Phase.Loading -> SkeletonList(rows = 6)
    is ScreenModel.Phase.Failed -> EmptyState(
      "This did not load",
      body = phase.message,
      icon = AglynIcons.named("error"),
      action = { OutlinedButton(onClick = { scope.launch { model.load() } }) { Text("Try again") } },
    )
    ScreenModel.Phase.Ready -> {
      val blocks = model.spec.blocks.filter { ScreenValues.condition(it.whenCondition, context) }
      val actions = model.spec.actions.filter { ScreenValues.condition(it.whenCondition, context) }
      val searchLoad = model.spec.blocks.firstOrNull { it.type == "list" && it.flag("search") }?.string("load")
      PullToRefreshBox(
        isRefreshing = refreshing,
        onRefresh = { scope.launch { refreshing = true; model.load(); refreshing = false } },
        modifier = Modifier.fillMaxSize().testTag("spec-${model.spec.id}"),
      ) {
        LazyColumn(
          Modifier.fillMaxSize(),
          horizontalAlignment = Alignment.CenterHorizontally,
          verticalArrangement = Arrangement.spacedBy(space(1.5f)),
          contentPadding = androidx.compose.foundation.layout.PaddingValues(space(2f)),
        ) {
          notice?.let { (text, tone) ->
            item("notice") { NoticeBanner(text, tone, Modifier.widthIn(max = 840.dp).fillMaxWidth().testTag("spec-notice")) }
          }
          if (actions.isNotEmpty()) {
            item("actions") {
              FlowRow(Modifier.widthIn(max = 840.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
                actions.forEachIndexed { index, action ->
                  val content: @Composable () -> Unit = {
                    Icon(AglynIcons.named(action.icon ?: "add"), null, Modifier.size(18.dp))
                    Text(ScreenValues.render(action.label, context), Modifier.padding(start = space(1f)))
                  }
                  if (index == 0) {
                    Button(onClick = { trigger(action, context) }, enabled = running == null, modifier = Modifier.testTag("toolbar-${action.id}")) { content() }
                  } else {
                    OutlinedButton(onClick = { trigger(action, context) }, enabled = running == null, modifier = Modifier.testTag("toolbar-${action.id}")) { content() }
                  }
                }
              }
            }
          }
          if (searchLoad != null) {
            item("search") {
              var query by remember { mutableStateOf(model.search[searchLoad].orEmpty()) }
              SearchField(
                query = query,
                onQuery = {
                  query = it
                  if (it.isEmpty()) { model.search[searchLoad] = ""; scope.launch { model.load() } }
                },
                placeholder = "Search",
                modifier = Modifier.widthIn(max = 840.dp),
                onSearch = { model.search[searchLoad] = query; scope.launch { model.load() } },
              )
            }
          }
          items(blocks, key = { it.id }) { block ->
            Box(Modifier.widthIn(max = 840.dp).fillMaxWidth()) {
              Block(
                block, model, context, selection, running,
                open = ::open,
                trigger = ::trigger,
                copy = { clipboard.setText(AnnotatedString(it)); show("Copied", StatusTone.SUCCESS) },
              )
            }
          }
        }
      }
    }
  }

  confirming?.let { pending ->
    ActionDialog(
      title = ScreenValues.render(pending.action.confirm ?: pending.action.label, pending.scope),
      confirmLabel = ScreenValues.render(pending.action.label, pending.scope),
      destructive = pending.action.destructive,
      dismissLabel = "Cancel",
      onConfirm = { confirming = null; scope.launch { execute(pending.action, pending.scope) } },
      onDismiss = { confirming = null },
    )
  }
  prompting?.let { pending -> PromptDialog(pending, onRun = { filled -> prompting = null; scope.launch { execute(pending.action, filled) } }) { prompting = null } }
  reauthing?.let { pending ->
    var password by remember(pending) { mutableStateOf("") }
    var error by remember(pending) { mutableStateOf<String?>(null) }
    var busy by remember(pending) { mutableStateOf(false) }
    ActionDialog(
      title = "Confirm it is you",
      body = pending.reauthMessage ?: "Confirm it is you to continue.",
      confirmLabel = "Continue",
      busy = busy,
      error = error,
      confirmEnabled = password.isNotEmpty(),
      dismissLabel = "Cancel",
      icon = "lock",
      onConfirm = {
        busy = true
        scope.launch {
          try {
            session.reauthenticate(password)
            session.refreshClaims()
            reauthing = null
            execute(pending.action, pending.scope)
          } catch (failure: Throwable) {
            error = failure.message ?: "That password did not work."
          }
          busy = false
        }
      },
      onDismiss = { reauthing = null },
    ) {
      OutlinedTextField(
        value = password,
        onValueChange = { password = it },
        label = { Text("Password") },
        singleLine = true,
        visualTransformation = PasswordVisualTransformation(),
        keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Password),
        modifier = Modifier.fillMaxWidth().testTag("reauth-password"),
      )
    }
  }
  revealed?.let { (title, value) ->
    ActionDialog(
      title = title,
      body = value,
      confirmLabel = "Copy",
      dismissLabel = "Done",
      onConfirm = { clipboard.setText(AnnotatedString(value)); revealed = null },
      onDismiss = { revealed = null },
    )
  }
}

@Composable
private fun PromptDialog(pending: Pending, onRun: (JsonElement) -> Unit, onDismiss: () -> Unit) {
  val values = remember(pending) { mutableStateMapOf<String, FieldValue>() }
  val inputs = pending.action.inputs
  fun filled(): JsonElement = ScreenContext.with(
    pending.scope, "form",
    JsonObject(inputs.associate { it.key to fieldJson(it, values[it.key] ?: initialValue(it, pending.scope)) }),
  )
  val missing = inputs.any { it.unmet(fieldJson(it, values[it.key] ?: initialValue(it, pending.scope)), pending.scope) }
  ActionDialog(
    title = ScreenValues.render(pending.action.label, pending.scope),
    body = pending.action.confirm?.let { ScreenValues.render(it, pending.scope) },
    confirmLabel = ScreenValues.render(pending.action.label, pending.scope),
    destructive = pending.action.destructive,
    confirmEnabled = !missing,
    dismissLabel = "Cancel",
    onConfirm = { onRun(filled()) },
    onDismiss = onDismiss,
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      val now = filled()
      for (field in inputs.filter { ScreenValues.condition(it.whenCondition, now) }) {
        FieldInput(field, pending.scope, values[field.key] ?: initialValue(field, pending.scope)) { values[field.key] = it }
      }
    }
  }
}

@Composable
private fun Block(
  block: BlockSpec,
  model: ScreenModel,
  context: JsonElement,
  selection: Selection?,
  running: String?,
  open: (String, NativeParams) -> Unit,
  trigger: (ActionSpec, JsonElement) -> Unit,
  copy: (String) -> Unit,
) {
  val title = block.title?.let { ScreenValues.render(it, context) }?.takeIf { it.isNotEmpty() }
  val footer = block.footer?.let { ScreenValues.render(it, context) }?.takeIf { it.isNotEmpty() }
  when (block.type) {
    "notice" -> NoticeBanner(ScreenValues.render(block.string("text").orEmpty(), context), tone(block.string("tone")))
    "list" -> ListBlock(block, title, footer, model, context, selection, open, trigger)
    "zone" -> {
      // A core screen's zone: whatever plugin screens contribute to it, never named here.
      val contributions = ScreenCatalog.zone(block.string("name").orEmpty()).filter { ScreenValues.condition(it.requires, context) }
      if (contributions.isNotEmpty()) {
        SectionCard(title) {
          Column(Modifier.fillMaxWidth()) {
            contributions.forEachIndexed { index, spec ->
              if (index > 0) HorizontalDivider()
              AglynListItem(
                title = spec.label,
                supporting = spec.subtitle,
                icon = AglynIcons.named(spec.icon),
                trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
                onClick = { open(spec.id, renderParams(block["params"], context)) },
                modifier = Modifier.testTag("zone-${spec.id}"),
              )
            }
          }
        }
      }
    }
    else -> SectionCard(title) {
      Column(Modifier.fillMaxWidth()) {
        when (block.type) {
          "fields" -> FieldsBlock(block, context, copy)
          "meters" -> MetersBlock(block, context)
          "form" -> FormBlock(block, context, running != null, trigger)
          "actions" -> {
            val items = block.raw.arr("items").mapNotNull { ActionSpec.parse(it) }.filter { ScreenValues.condition(it.whenCondition, context) }
            items.forEachIndexed { index, action ->
              if (index > 0) HorizontalDivider()
              AglynListItem(
                title = ScreenValues.render(action.label, context),
                icon = AglynIcons.named(action.icon ?: "chevron_right"),
                trailing = if (running == action.id) ({ CircularProgressIndicator(Modifier.size(18.dp), strokeWidth = 2.dp) }) else null,
                onClick = if (running == null) ({ trigger(action, context) }) else null,
                modifier = Modifier.testTag("action-${action.id}"),
              )
            }
          }
          "links" -> {
            val links = block.raw.arr("items").filter { ScreenValues.condition(it.str("when"), context) && it.str("screen") != null }
            links.forEachIndexed { index, link ->
              if (index > 0) HorizontalDivider()
              AglynListItem(
                title = ScreenValues.render(link.str("title") ?: link.str("screen")!!, context),
                supporting = link.str("subtitle")?.let { ScreenValues.render(it, context) },
                icon = AglynIcons.named(materialIcon(link.str("icon"))),
                trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
                onClick = { open(link.str("screen")!!, renderParams(link.obj("params"), context)) },
                modifier = Modifier.testTag("link-${link.str("screen")}"),
              )
            }
          }
        }
        footer?.let { Text(it, Modifier.padding(horizontal = space(2f), vertical = space(1f)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      }
    }
  }
}

@Composable
private fun FieldsBlock(block: BlockSpec, context: JsonElement, copy: (String) -> Unit) {
  val base = block.string("object")?.let { ScreenValues.lookup(it, context) }
  val scope = base?.let { ScreenContext.withItem(context, it) } ?: context
  for (row in block.raw.arr("rows")) {
    if (!ScreenValues.condition(row.str("when"), scope)) continue
    val label = ScreenValues.render(row.str("label").orEmpty(), scope)
    val value = ScreenValues.render(row.str("value").orEmpty(), scope)
    val shown = value.ifEmpty { row.str("empty") ?: "—" }
    Row(
      Modifier.fillMaxWidth().clickable(enabled = value.isNotEmpty()) { copy(value) }
        .padding(horizontal = space(2f), vertical = space(1.25f))
        .semantics(mergeDescendants = true) {},
      verticalAlignment = Alignment.CenterVertically,
    ) {
      Text(label, Modifier.weight(0.45f), style = MaterialTheme.typography.bodyMedium)
      Box(Modifier.weight(0.55f), contentAlignment = Alignment.CenterEnd) {
        if (row.isTrue("chip")) {
          StatusChip(shown, toneFor(row, value, scope))
        } else {
          Text(
            shown,
            style = MaterialTheme.typography.bodyMedium,
            color = if (row.obj("tone") != null) toneColor(toneFor(row, value, scope)) else MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End,
          )
        }
      }
    }
  }
}

@Composable
private fun toneColor(tone: StatusTone) = when (tone) {
  StatusTone.SUCCESS -> com.aglyn.ui.LocalAglynPalette.current.success.text
  StatusTone.WARNING -> com.aglyn.ui.LocalAglynPalette.current.warning.text
  StatusTone.ERROR -> MaterialTheme.colorScheme.error
  StatusTone.INFO -> MaterialTheme.colorScheme.primary
  StatusTone.NEUTRAL -> MaterialTheme.colorScheme.onSurfaceVariant
}

@Composable
private fun MetersBlock(block: BlockSpec, context: JsonElement) {
  val rows: List<Pair<JsonElement, JsonElement>> = block.string("items")?.let { path ->
    val template = block["meter"] ?: JsonObject(emptyMap())
    ScreenValues.rows(ScreenValues.lookup(path, context)).map { template to it }
  } ?: block.raw.arr("meters").map { it to JsonNull }
  for ((meter, item) in rows) {
    val scope = if (item == JsonNull) context else ScreenContext.withItem(context, item)
    if (!ScreenValues.condition(meter.str("when"), scope)) continue
    val label = ScreenValues.render(meter.str("label").orEmpty(), scope)
    val format = meter.str("format") ?: "number"
    val usedValue = ScreenValues.resolve(meter.str("used") ?: "0", scope)
    val limitValue = ScreenValues.resolve(meter.str("limit").orEmpty(), scope)
    val used = ScreenValues.number(usedValue) ?: 0.0
    val limit = ScreenValues.number(limitValue)
    val usedText = ScreenValues.formatted(usedValue, format, scope)
    val unlimited = limit == null || limit < 0
    val limitText = if (unlimited) "Unlimited" else ScreenValues.formatted(limitValue, format, scope)
    val fraction = if (unlimited || limit!! <= 0) 0f else (used / limit).coerceIn(0.0, 1.0).toFloat()
    val spoken = if (unlimited) usedText else "$usedText of $limitText"
    Column(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)).semantics(mergeDescendants = true) { contentDescription = "$label, $spoken" }) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(label, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
        Text(spoken, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      if (!unlimited) {
        LinearProgressIndicator(
          progress = { fraction },
          modifier = Modifier.fillMaxWidth().padding(top = space(0.75f)),
          color = when {
            fraction >= 1f -> MaterialTheme.colorScheme.error
            fraction >= 0.8f -> com.aglyn.ui.LocalAglynPalette.current.warning.main
            else -> MaterialTheme.colorScheme.primary
          },
        )
      }
      meter.str("note")?.let { Text(ScreenValues.render(it, scope), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ListBlock(
  block: BlockSpec,
  title: String?,
  footer: String?,
  model: ScreenModel,
  context: JsonElement,
  selection: Selection?,
  open: (String, NativeParams) -> Unit,
  trigger: (ActionSpec, JsonElement) -> Unit,
) {
  val scope = rememberCoroutineScope()
  val rows = ScreenValues.rows(ScreenValues.lookup(block.string("items").orEmpty(), context))
    .filter { ScreenValues.condition(block.string("filter"), ScreenContext.withItem(context, it)) }
  val loadKey = block.string("load")
  SectionCard(title?.let { if (rows.isNotEmpty() && block["count"] != JsonPrimitive(false)) "$it · ${rows.size}" else it }) {
    Column(Modifier.fillMaxWidth()) {
      if (rows.isEmpty()) {
        Text(
          ScreenValues.render(block.string("empty") ?: "Nothing here yet.", context),
          Modifier.padding(space(2f)),
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      rows.forEachIndexed { index, row ->
        if (index > 0) HorizontalDivider()
        ListRow(block, ScreenContext.withItem(context, row), selection, open, trigger)
      }
      if (loadKey != null && model.cursors[loadKey] != null) {
        HorizontalDivider()
        TextButton(onClick = { scope.launch { model.loadMore(loadKey) } }, modifier = Modifier.fillMaxWidth().testTag("load-more-$loadKey")) {
          if (model.loadingMore[loadKey] == true) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp) else Text("Load more")
        }
      }
      footer?.let { Text(it, Modifier.padding(horizontal = space(2f), vertical = space(1f)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
  }
}

@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ListRow(
  block: BlockSpec,
  scope: JsonElement,
  selection: Selection?,
  open: (String, NativeParams) -> Unit,
  trigger: (ActionSpec, JsonElement) -> Unit,
) {
  val actions = block.raw.arr("actions").mapNotNull { ActionSpec.parse(it) }.filter { ScreenValues.condition(it.whenCondition, scope) }
  val target = block["open"]?.takeIf { ScreenValues.condition(it.str("when"), scope) }?.let { openSpec ->
    openSpec.str("screen")?.let { Selection(it, renderParams(openSpec.obj("params"), scope)) }
  }
  val primary = ScreenValues.render(block.string("primary") ?: "{item.name|item.\$id}", scope).ifEmpty { "—" }
  val secondary = block.string("secondary")?.let { ScreenValues.render(it, scope) }?.takeIf { it.isNotEmpty() }
  val tertiary = block.string("tertiary")?.let { ScreenValues.render(it, scope) }?.takeIf { it.isNotEmpty() }
  val trailingText = block.string("trailing")?.let { ScreenValues.render(it, scope) }?.takeIf { it.isNotEmpty() }
  val badges = block.raw.arr("badges").mapNotNull { badge ->
    if (!ScreenValues.condition(badge.str("when"), scope)) return@mapNotNull null
    val text = ScreenValues.render(badge.str("text").orEmpty(), scope)
    if (text.isEmpty()) null else text to toneFor(badge, text, scope)
  }
  // `toggle: { value, disabled, on, off }`: a switch at the row's end whose
  // flip runs the `on` or `off` action (with its confirmation) against the
  // row; the screen's reload then shows what was stored.
  val toggle = block["toggle"]?.takeIf { ScreenValues.condition(it.str("when"), scope) }
  val toggleOn = toggle?.let { ScreenValues.truthy(ScreenValues.resolve(it.str("value") ?: "{item.on}", scope)) } ?: false
  val toggleOnAction = toggle?.obj("on")?.let { ActionSpec.parse(it) }
  val toggleOffAction = toggle?.obj("off")?.let { ActionSpec.parse(it) }
  val toggleEnabled = toggle != null && !(toggle.str("disabled")?.let { ScreenValues.condition(it, scope) } ?: false) &&
    (if (toggleOn) toggleOffAction != null else toggleOnAction != null)
  val toggleLabel = toggle?.let { ScreenValues.render(it.str("label") ?: "Turn $primary on or off", scope) }
  var menu by remember { mutableStateOf(false) }
  val supporting = listOfNotNull(secondary, tertiary).joinToString("\n").ifEmpty { null }
  Column {
    AglynListItem(
      title = primary,
      supporting = supporting,
      icon = block.string("icon")?.let { AglynIcons.named(materialIcon(ScreenValues.render(it, scope))) },
      selected = target != null && target == selection,
      onClick = target?.let { { open(it.screen, it.params) } },
      trailing = if (trailingText == null && actions.isEmpty() && target == null && toggle == null) null else ({
        Row(verticalAlignment = Alignment.CenterVertically) {
          trailingText?.let { Text(it, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant) }
          if (toggle != null) {
            Switch(
              checked = toggleOn,
              onCheckedChange = { next -> (if (next) toggleOnAction else toggleOffAction)?.let { trigger(it, scope) } },
              enabled = toggleEnabled,
              modifier = Modifier.testTag("row-toggle").semantics { contentDescription = toggleLabel.orEmpty() },
            )
          }
          if (actions.isNotEmpty()) {
            Box {
              IconButton(onClick = { menu = true }, modifier = Modifier.testTag("row-menu")) {
                Icon(AglynIcons.named("more_vert"), contentDescription = "Actions for $primary")
              }
              DropdownMenu(expanded = menu, onDismissRequest = { menu = false }) {
                for (action in actions) {
                  DropdownMenuItem(
                    text = {
                      Text(
                        ScreenValues.render(action.label, scope),
                        color = if (action.destructive) MaterialTheme.colorScheme.error else MaterialTheme.colorScheme.onSurface,
                      )
                    },
                    leadingIcon = { Icon(AglynIcons.named(action.icon ?: "chevron_right"), null) },
                    onClick = { menu = false; trigger(action, scope) },
                    modifier = Modifier.testTag("row-action-${action.id}"),
                  )
                }
              }
            }
          }
          if (target != null) Icon(AglynIcons.named("chevron_right"), contentDescription = null)
        }
      }),
    )
    if (badges.isNotEmpty()) {
      FlowRow(
        Modifier.padding(start = space(9f), end = space(2f), bottom = space(1f)),
        horizontalArrangement = Arrangement.spacedBy(space(0.75f)),
      ) { for ((text, tone) in badges) StatusChip(text, tone) }
    }
  }
}

internal sealed interface FieldValue {
  data class Text(val value: String) : FieldValue
  data class Flag(val value: Boolean) : FieldValue
}

internal fun fieldJson(field: FieldSpec, value: FieldValue?): JsonElement = when {
  field.kind == "toggle" && value is FieldValue.Flag -> JsonPrimitive(value.value)
  field.kind == "number" && value is FieldValue.Text -> value.value.trim().let { t -> if (t.isEmpty()) JsonNull else t.toDoubleOrNull()?.let { JsonPrimitive(it) } ?: JsonPrimitive(t) }
  value is FieldValue.Text -> JsonPrimitive(if (field.kind == "multiline" || field.kind == "password") value.value else value.value.trim())
  value is FieldValue.Flag -> JsonPrimitive(value.value)
  else -> if (field.kind == "toggle") JsonPrimitive(false) else JsonNull
}

internal fun initialValue(field: FieldSpec, context: JsonElement): FieldValue {
  val resolved = field.initial?.let { ScreenValues.resolve(it, context) } ?: JsonNull
  if (field.kind == "toggle") return FieldValue.Flag(ScreenValues.truthy(resolved))
  if (field.kind == "date") ScreenValues.epochMillis(resolved)?.let { millis ->
    val (y, m, d) = localParts(millis, "UTC")
    return FieldValue.Text("$y-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}")
  }
  return FieldValue.Text(ScreenValues.text(resolved))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FieldInput(field: FieldSpec, context: JsonElement, value: FieldValue, onChange: (FieldValue) -> Unit) {
  val text = (value as? FieldValue.Text)?.value.orEmpty()
  val help = field.help?.let { ScreenValues.render(it, context) }
  Column(Modifier.fillMaxWidth().testTag("field-${field.key}")) {
    when (field.kind) {
      "toggle" -> SwitchRow(field.label, (value as? FieldValue.Flag)?.value == true, { onChange(FieldValue.Flag(it)) }, supporting = help)
      "select" -> {
        val choices = field.choices(context)
        var expanded by remember { mutableStateOf(false) }
        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
          OutlinedTextField(
            value = choices.firstOrNull { it.first == text }?.second ?: text,
            onValueChange = {},
            readOnly = true,
            label = { Text(field.label) },
            trailingIcon = { ExposedDropdownMenuDefaults.TrailingIcon(expanded) },
            modifier = Modifier.fillMaxWidth().menuAnchor(ExposedDropdownMenuAnchorType.PrimaryNotEditable),
          )
          ExposedDropdownMenu(expanded = expanded, onDismissRequest = { expanded = false }) {
            for ((choice, label) in choices) {
              DropdownMenuItem(text = { Text(label) }, onClick = { onChange(FieldValue.Text(choice)); expanded = false })
            }
          }
        }
      }
      else -> OutlinedTextField(
        value = text,
        onValueChange = { onChange(FieldValue.Text(it)) },
        label = { Text(field.label + if (field.required) " *" else "") },
        placeholder = field.placeholder?.let { { Text(it) } },
        singleLine = field.kind != "multiline",
        minLines = if (field.kind == "multiline") 3 else 1,
        visualTransformation = if (field.kind == "password") PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(
          keyboardType = when (field.kind) {
            "email" -> KeyboardType.Email
            "url" -> KeyboardType.Uri
            "number" -> KeyboardType.Decimal
            "password" -> KeyboardType.Password
            else -> KeyboardType.Text
          },
        ),
        modifier = Modifier.fillMaxWidth(),
      )
    }
    if (help != null && field.kind != "toggle") {
      Text(help, Modifier.padding(top = space(0.5f)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun FormBlock(block: BlockSpec, context: JsonElement, busy: Boolean, submit: (ActionSpec, JsonElement) -> Unit) {
  val fields = block.raw.arr("fields").mapNotNull { FieldSpec.parse(it) }
  val base = block.string("object")?.let { ScreenValues.lookup(it, context) }
  val scope = base?.let { ScreenContext.withItem(context, it) } ?: context
  // Re-seeded whenever the loaded data changes, as after a save.
  val values = remember(scope) { mutableStateMapOf<String, FieldValue>().apply { fields.forEach { put(it.key, initialValue(it, scope)) } } }
  val filled = ScreenContext.with(scope, "form", JsonObject(fields.associate { it.key to fieldJson(it, values[it.key]) }))
  val missing = fields.any { ScreenValues.condition(it.whenCondition, filled) && it.unmet(fieldJson(it, values[it.key]), scope) }
  Column(Modifier.fillMaxWidth().padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    for (field in fields.filter { ScreenValues.condition(it.whenCondition, filled) }) {
      FieldInput(field, scope, values[field.key] ?: initialValue(field, scope)) { values[field.key] = it }
    }
    ActionSpec.parse(block["submit"])?.takeIf { ScreenValues.condition(it.whenCondition, scope) }?.let { action ->
      FilledTonalButton(
        onClick = { submit(action, filled) },
        enabled = !busy && !missing,
        modifier = Modifier.align(Alignment.End).testTag("submit-${block.id}"),
      ) {
        if (busy) CircularProgressIndicator(Modifier.size(16.dp).padding(end = space(1f)), strokeWidth = 2.dp)
        Text(ScreenValues.render(action.label, scope), maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    }
  }
}
