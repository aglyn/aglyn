package com.aglyn.screens

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
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
import com.aglyn.contracts.WeeklyHoursInterval
import com.aglyn.pluginhost.NativeParams
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChoiceRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.EmptyTone
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OpeningHoursPicker
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.RemoteImage
import com.aglyn.ui.SearchField
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectionPlaceholder
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.TextButton
import com.aglyn.ui.WithTooltip
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

/**
 * A list row's badge as chips: one, or with `each` (a path to a list) one per row of that list, the row read as `row` (a
 * resource's units left on each of the next nights). `when` is read once, against the list row.
 */
internal fun rowBadges(badge: JsonElement, scope: JsonElement): List<Pair<String, StatusTone>> {
  if (!ScreenValues.condition(badge.str("when"), scope)) return emptyList()
  val scopes = badge.str("each")?.let { path -> ScreenValues.rows(ScreenValues.lookup(path, scope)).map { ScreenContext.with(scope, "row", it) } }
    ?: listOf(scope)
  return scopes.mapNotNull { here ->
    val text = ScreenValues.render(badge.str("text").orEmpty(), here)
    if (text.isEmpty()) null else text to toneFor(badge, text, here)
  }
}

internal fun toneFor(spec: JsonElement, value: String, context: JsonElement): StatusTone {
  val map = spec.obj("tones") as? JsonObject
  if (map != null) return tone((map[value] as? JsonPrimitive)?.content ?: (map["*"] as? JsonPrimitive)?.content)
  return tone(spec.str("tone")?.let { ScreenValues.render(it, context) })
}

/**
 * A list row's line: a template, or a list of parts (a template, or `{ text, when }` shown while its condition holds) joined
 * with ` · `, a part that holds nothing left out, so a row never ends on a dangling `set by `.
 */
internal fun rowLine(spec: JsonElement?, scope: JsonElement): String? = when (spec) {
  is JsonArray -> spec.mapNotNull { part ->
    val template = when {
      part is JsonPrimitive && part.isString -> part.content
      ScreenValues.condition(part.str("when"), scope) -> part.str("text")
      else -> null
    }
    template?.let { ScreenValues.render(it, scope).trim() }?.takeIf { it.isNotEmpty() }
  }.joinToString(" \u00b7 ")
  is JsonPrimitive -> if (spec.isString) ScreenValues.render(spec.content, scope) else null
  else -> null
}?.takeIf { it.isNotEmpty() }

internal fun renderParams(params: JsonElement?, context: JsonElement): NativeParams =
  ((params as? JsonObject) ?: JsonObject(emptyMap())).mapValues { (_, value) ->
    ScreenValues.render((value as? JsonPrimitive)?.takeIf { it.isString }?.content ?: ScreenValues.text(value), context)
  }

private data class Selection(val screen: String, val params: NativeParams)

private class Pending(val action: ActionSpec, val scope: JsonElement, val reauthMessage: String? = null)

/** An action whose route refused for something another screen settles: that screen, drawn over this one. */
private class Gated(val action: ActionSpec, val scope: JsonElement, val spec: ScreenSpec)

/**
 * Draws a console screen from its spec: sections in cards, list and detail
 * side by side on a wide window when the spec asks, pull to refresh,
 * skeleton, empty and error states, and every action with its confirmation,
 * inputs, re-auth and result. Twin of the Apple `SpecScreenView`.
 */
/** Whether a notice in [tone] stays until dismissed: a refusal or a warning has to be read, a success need not be. */
internal fun noticeStays(tone: StatusTone): Boolean = tone == StatusTone.ERROR || tone == StatusTone.WARNING

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
  val passkeys = LocalPasskeyCreator.current
  val model = remember(key) { ScreenModel(spec, base, plugin.api, plugin.firestore, plugin.writer, session.account) }
  model.createPasskey = if (session.passkeyRelyingParty != null) passkeys else null
  LaunchedEffect(key) { if (seed != null) model.seed(seed) else model.load() }
  LaunchedEffect(session.claims) { model.rebase(base) }
  // A title drawn from the data (`{data.jobs.jobs[id=params.jobId].brief|'AI job'}`) replaces the registered one in the top
  // bar once the data is in.
  val screenTitle = com.aglyn.ui.LocalScreenTitle.current
  if (!embedded && screenTitle != null && '{' in spec.title) {
    val rendered = if (model.phase == ScreenModel.Phase.Ready) ScreenValues.render(spec.title, model.context).trim().ifEmpty { null } else null
    LaunchedEffect(rendered) { screenTitle.value = rendered }
  }
  var selection by remember(key) { mutableStateOf<Selection?>(null) }
  val split = !embedded && spec.blocks.any { it.type == "list" && it.flag("split") && it["open"] != null }
  // A screen the plan does not include is one offer across the window, not a list beside an empty detail.
  val refused = (model.phase as? ScreenModel.Phase.Failed)?.upsell == true
  // The list and its detail side by side only when the pane holds both (TwoPaneMinWidth).
  BoxWithConstraints(Modifier.fillMaxSize()) {
    if (split && maxWidth >= com.aglyn.ui.TwoPaneMinWidth && !refused) {
      Row(Modifier.fillMaxSize()) {
        Box(Modifier.weight(0.42f).fillMaxHeight()) {
          SpecBody(model, plugin, selection, onSelect = { selection = it }, splitting = true)
        }
        VerticalDivider()
        Box(Modifier.weight(0.58f).fillMaxHeight()) {
          val picked = selection
          val detail = picked?.let { ScreenCatalog.spec(it.screen) }
          if (picked != null && detail != null) {
            // An action that ends the detail (a remove with "back") closes the pane and re-reads the list beside it, rather
            // than leaving the list showing what is gone.
            val reload = androidx.compose.runtime.rememberCoroutineScope()
            val paneSession = LocalScreenSession.current.let { outer -> outer.copy(back = { selection = null; reload.launch { model.load() } }) }
            androidx.compose.runtime.CompositionLocalProvider(LocalScreenSession provides paneSession) {
              SpecScreen(detail, plugin, picked.params, embedded = true)
            }
          } else {
            SelectionPlaceholder("Pick a row to see it here", icon = AglynIcons.named("list"))
          }
        }
      }
    } else {
      SpecBody(model, plugin, selection, onSelect = { selection = it }, splitting = false)
    }
  }
}

@Composable
private fun SpecBody(
  model: ScreenModel,
  plugin: NativePluginContext,
  selection: Selection?,
  onSelect: (Selection) -> Unit,
  splitting: Boolean,
) {
  androidx.compose.runtime.CompositionLocalProvider(LocalSpecPlugin provides plugin) { SpecBodyContent(model, plugin, selection, onSelect, splitting) }
}

@OptIn(ExperimentalMaterial3Api::class, ExperimentalLayoutApi::class)
@Composable
private fun SpecBodyContent(
  model: ScreenModel,
  plugin: NativePluginContext,
  selection: Selection?,
  onSelect: (Selection) -> Unit,
  splitting: Boolean,
) {
  val session = LocalScreenSession.current
  val exporter = com.aglyn.ui.LocalFileExporter.current
  val scope = rememberCoroutineScope()
  @Suppress("DEPRECATION") val clipboard = LocalClipboardManager.current
  var confirming by remember { mutableStateOf<Pending?>(null) }
  var prompting by remember { mutableStateOf<Pending?>(null) }
  var reauthing by remember { mutableStateOf<Pending?>(null) }
  var gating by remember { mutableStateOf<Gated?>(null) }
  val gate = LocalScreenGate.current
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var revealed by remember { mutableStateOf<Pair<String, String>?>(null) }
  var running by remember { mutableStateOf<String?>(null) }
  var exportDialog by remember { mutableStateOf<ExportRequest?>(null) }
  var refreshing by remember { mutableStateOf(false) }
  val context = model.context

  // A success reads and goes; a refusal or a warning stays until it is dismissed or the next action replaces it.
  fun show(text: String, tone: StatusTone) {
    val shown = text to tone
    notice = shown
    if (!noticeStays(tone)) {
      scope.launch {
        delay(4000)
        if (notice === shown) notice = null
      }
    }
  }

  fun open(screen: String, params: NativeParams) {
    if (splitting && ScreenCatalog.spec(screen) != null) onSelect(Selection(screen, params)) else plugin.navigate(screen, params)
  }

  suspend fun execute(action: ActionSpec, actionScope: JsonElement, afterGate: Boolean = false) {
    notice = null
    action.exportRequest(actionScope)?.let {
      exportDialog = it
      return
    }
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
    action.route?.let {
      val path = ScreenValues.render(it, actionScope)
      if (path.isEmpty() || !plugin.openLink(path)) show("That page does not open in the app.", StatusTone.WARNING)
      return
    }
    action.link?.let {
      val rendered = ScreenValues.render(it, actionScope)
      session.openHostedPage(if (rendered.startsWith("/")) session.origin + rendered else rendered)
      return
    }
    // A route is asked first what the action would do; its answer is `preview` in the confirmation.
    action.check?.let { check ->
      if (ScreenValues.lookup("preview", actionScope) == null) {
        running = action.id
        val checked = model.run(check, actionScope)
        running = null
        when (checked) {
          is ActionOutcome.Done -> confirming = Pending(action, ScreenContext.with(actionScope, "preview", checked.response ?: JsonObject(emptyMap())))
          is ActionOutcome.NeedsReauth -> reauthing = Pending(action, actionScope, checked.message)
          is ActionOutcome.Failed -> show(checked.message, StatusTone.ERROR)
          is ActionOutcome.Gated -> show(checked.message, StatusTone.ERROR)
          is ActionOutcome.File -> Unit // a check asks a question; it never answers with a file
        }
        return
      }
    }
    running = action.id
    val outcome = model.run(action, actionScope)
    running = null
    when (outcome) {
      is ActionOutcome.NeedsReauth -> reauthing = Pending(action, actionScope, outcome.message)
      is ActionOutcome.Failed -> show(outcome.message, StatusTone.ERROR)
      is ActionOutcome.Gated -> {
        // Asked about once: a second refusal after the gate's screen is answered as it stands.
        val gated = ScreenCatalog.spec(outcome.screen)
        if (!afterGate && gated != null) gating = Gated(action, actionScope, gated) else show(outcome.message, StatusTone.ERROR)
      }
      is ActionOutcome.File -> {
        val exporter = exporter
        when {
          exporter == null -> show("Saving a file is not available here.", StatusTone.WARNING)
          exporter.export(outcome.name, outcome.mimeType, outcome.bytes) -> show(outcome.message ?: "Saved ${outcome.name}", StatusTone.SUCCESS)
          else -> Unit
        }
      }
      is ActionOutcome.Done -> {
        val after = ScreenContext.with(actionScope, "response", outcome.response)
        val instead = action.insteadEntry(after)
        if (instead != null) {
          revealed = (instead.str("title")?.let { ScreenValues.render(it, after) } ?: ScreenValues.render(action.label, after)) to ScreenValues.render(instead.str("text") ?: "", after)
          // The entry may also open a page the route named (an invoice the bank has to confirm).
          instead.str("open")?.let { key -> (ScreenValues.lookup(key, outcome.response ?: JsonNull) as? JsonPrimitive)?.content?.let(session.openHostedPage) }
        } else {
          outcome.message?.takeIf { it.isNotEmpty() }?.let { show(it, StatusTone.SUCCESS) }
        }
        // A path the route's answer does not hold is read from the screen (`item.body`): an action that only shows a value.
        action.reveal?.let { path -> (ScreenValues.lookup(path, outcome.response ?: JsonNull) ?: ScreenValues.lookup(path, after))?.let { revealed = ScreenValues.render(action.label, after) to ScreenValues.text(it) } }
        action.file?.let { file ->
          file.contents(after)?.let { (name, text) ->
            if (exporter == null) show("Saving a file is not available here.", StatusTone.WARNING)
            else if (exporter.export(name, file.type, text.encodeToByteArray())) show("Saved", StatusTone.SUCCESS)
          }
        }
        action.openUrl?.let { path -> (ScreenValues.lookup(path, outcome.response ?: JsonNull) as? JsonPrimitive)?.content?.let(session.openHostedPage) }
        action.impersonate?.let { impersonate ->
          // The route minted a custom token for the customer; the app signs in with it. The token goes to the session and is
          // shown, logged and kept nowhere else.
          val resolved = impersonate.resolve(outcome.response)
          if (resolved == null) {
            show("The support session could not be opened.", StatusTone.ERROR)
          } else {
            try {
              session.impersonate(resolved.first, resolved.second)
            } catch (error: kotlinx.coroutines.CancellationException) {
              throw error
            } catch (error: Throwable) {
              show((error as? com.aglyn.core.AuthError)?.message ?: "The support session could not be opened. Try again.", StatusTone.ERROR)
            }
          }
          return
        }
        action.navigate?.let { nav -> plugin.navigate(nav.screen, nav.params.mapValues { ScreenValues.render(it.value, after) }) }
        model.followUp?.let { follow -> model.followUp = null; prompting = Pending(follow.action, follow.scope) }
        if (action.resume) gate?.resolve?.let { resolve -> resolve() }
        if (action.back) { if (gate != null) gate.close() else session.back() } else if (action.reload) model.load()
      }
    }
  }

  fun trigger(action: ActionSpec, actionScope: JsonElement) {
    when {
      action.asksInputs(actionScope) -> prompting = Pending(action, actionScope)
      action.asksConfirmation && ScreenValues.condition(action.confirmWhen, actionScope) -> confirming = Pending(action, actionScope)
      else -> scope.launch { execute(action, actionScope) }
    }
  }

  // A screen that names a `start` action runs it once, as soon as its data is in: the action's own `when` decides whether
  // there is anything to do (a link's `?notice=` that names a notice that cannot be reviewed does nothing).
  var started by remember(model) { mutableStateOf(false) }
  val ready = model.phase == ScreenModel.Phase.Ready
  LaunchedEffect(model, ready) {
    if (!ready || started) return@LaunchedEffect
    started = true
    val id = model.spec.startAction ?: return@LaunchedEffect
    model.spec.actions.firstOrNull { it.id == id && ScreenValues.condition(it.whenCondition, model.context) }?.let { trigger(it, model.context) }
  }

  when (val phase = model.phase) {
    ScreenModel.Phase.Loading -> SkeletonList(rows = 6)
    is ScreenModel.Phase.Failed -> if (phase.upsell) {
      EmptyState(
        "Add this to your plan",
        body = "${model.spec.title.takeIf { '{' !in it } ?: "This"} is not part of this workspace's plan yet. Add it to start using it.",
        icon = AglynIcons.named("workspace_premium"),
        tone = EmptyTone.UPSELL,
        action = {
          FilledTonalButton(
            onClick = { plugin.navigate(BILLING_ADDONS_SCREEN, emptyMap()) },
            modifier = Modifier.testTag("upsell-addons"),
            colors = com.aglyn.ui.aglynTonalButtonColors(),
          ) { Text("See add-ons") }
        },
        modifier = Modifier.testTag("spec-upsell"),
      )
    } else {
      EmptyState(
        "This did not load",
        body = phase.message,
        icon = AglynIcons.named("error"),
        tone = EmptyTone.ERROR,
        action = { OutlinedButton(onClick = { scope.launch { model.load() } }) { Text("Try again") } },
      )
    }
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
          verticalArrangement = Arrangement.spacedBy(space(1.5f)),
          // The whole content area, on the content edge E (Zach 10/19: no capped column).
          contentPadding = androidx.compose.foundation.layout.PaddingValues(horizontal = com.aglyn.ui.paneInset(), vertical = space(2f)),
        ) {
          notice?.let { (text, tone) ->
            item("notice") {
              NoticeBanner(
                text,
                tone,
                Modifier.fillMaxWidth().testTag("spec-notice"),
                action = { TextButton(onClick = { notice = null }, Modifier.testTag("spec-notice-dismiss")) { Text("Dismiss") } },
              )
            }
          }
          if (actions.isNotEmpty()) {
            item("actions") {
              FlowRow(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
                actions.forEachIndexed { index, action ->
                  val content: @Composable () -> Unit = {
                    Icon(AglynIcons.named(action.icon ?: "add"), null, Modifier.size(18.dp))
                    Text(ScreenValues.render(action.label, context), Modifier.padding(start = space(1f)))
                  }
                  if (index == 0 && !action.quietOn(model.spec.id)) {
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
                modifier = Modifier.fillMaxWidth(),
                onSearch = { model.search[searchLoad] = query; scope.launch { model.load() } },
              )
            }
          }
          items(blocks, key = { it.id }) { block ->
            Box(Modifier.fillMaxWidth()) {
              Block(
                block, plugin, model, context, selection, running,
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

  exportDialog?.let { request ->
    com.aglyn.pluginhost.TransferExportDialog(
      plugin, resource = request.resource, title = request.title, hostId = request.hostId,
      scope = request.scope, fileStem = request.fileStem, filter = request.filter,
    ) { message ->
      exportDialog = null
      if (message != null) show(message, StatusTone.SUCCESS)
    }
  }
  confirming?.let { pending ->
    ActionDialog(
      title = pending.action.confirmText(pending.scope) ?: ScreenValues.render(pending.action.label, pending.scope),
      confirmLabel = ScreenValues.render(pending.action.label, pending.scope),
      destructive = pending.action.destructive,
      dismissLabel = "Cancel",
      onConfirm = { confirming = null; scope.launch { execute(pending.action, pending.scope) } },
      onDismiss = { confirming = null },
    )
  }
  prompting?.let { pending ->
    PromptDialog(pending, search = { group, words -> model.lookup(group, words) }, onRun = { filled -> prompting = null; scope.launch { execute(pending.action, filled) } }) { prompting = null }
  }
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
  gating?.let { gated ->
    // The screen the route's refusal named, over this one; when it reports `resume`, the same action goes again.
    val resolved = remember(gated) { booleanArrayOf(false) }
    androidx.compose.ui.window.Dialog(
      onDismissRequest = { gating = null },
      properties = androidx.compose.ui.window.DialogProperties(usePlatformDefaultWidth = false),
    ) {
      androidx.compose.material3.Surface(
        Modifier.fillMaxWidth(0.94f).fillMaxHeight(0.9f).testTag("gate-${gated.spec.id}"),
        shape = MaterialTheme.shapes.large,
      ) {
        androidx.compose.runtime.CompositionLocalProvider(
          LocalScreenGate provides ScreenGate(
            resolve = { resolved[0] = true },
            close = {
              gating = null
              if (resolved[0]) scope.launch { execute(gated.action, gated.scope, afterGate = true) }
            },
          ),
        ) { SpecScreen(gated.spec, plugin, emptyMap(), embedded = true) }
      }
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
private fun PromptDialog(pending: Pending, search: suspend (LookupGroup, String) -> List<JsonElement>, onRun: (JsonElement) -> Unit, onDismiss: () -> Unit) {
  val values = remember(pending) { mutableStateMapOf<String, FieldValue>() }
  // What each `lookup` field last picked, as the person reads it.
  val picked = remember(pending) { mutableStateMapOf<String, String>() }
  val inputs = pending.action.inputs(pending.scope)
  fun filled(): JsonElement = ScreenContext.with(
    pending.scope, "form",
    formObject(inputs) { values[it.key] ?: initialValue(it, pending.scope) },
  )
  // A field the person cannot see (its `when` fails) never holds up the action.
  val visible = filled()
  val missing = inputs.any { ScreenValues.condition(it.whenCondition, visible) && it.unmet(fieldJson(it, values[it.key] ?: initialValue(it, pending.scope)), pending.scope) }
  ActionDialog(
    title = ScreenValues.render(pending.action.promptTitle ?: pending.action.label, pending.scope),
    body = pending.action.confirmText(pending.scope),
    confirmLabel = ScreenValues.render(pending.action.submitLabel ?: pending.action.label, pending.scope),
    destructive = pending.action.destructive,
    confirmEnabled = !missing,
    dismissLabel = "Cancel",
    onConfirm = { onRun(visibleOnly(filled(), inputs)) },
    onDismiss = onDismiss,
  ) {
    Column(verticalArrangement = Arrangement.spacedBy(space(1f))) {
      val now = filled()
      for (field in inputs.filter { ScreenValues.condition(it.whenCondition, now) }) {
        if (field.kind == "lookup") {
          LookupInput(field, pending.scope, picked[field.key], search) { group, row ->
            picked[field.key] = group.heading(row, pending.scope)
            // Only the fields this form has are filled, and what the person typed elsewhere is left alone.
            for ((key, value) in group.fills(row, pending.scope, inputs.map { it.key }.toSet())) values[key] = FieldValue.Text(value)
          }
        } else {
          FieldInput(field, pending.scope, values[field.key] ?: initialValue(field, pending.scope)) { values[field.key] = it }
        }
      }
    }
  }
}

@Composable
private fun Block(
  block: BlockSpec,
  plugin: NativePluginContext,
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
    "image" -> {
      // `{ "type": "image", "src": "{item.url}", "caption": "…" }`: a picture the route hands over (a staff media preview).
      val source = ScreenValues.render(block.string("src").orEmpty(), context)
      if (source.isNotEmpty()) {
        SectionCard(title) {
          RemoteImage(
            source,
            block.string("caption")?.let { ScreenValues.render(it, context) },
            Modifier.fillMaxWidth().heightIn(min = 160.dp, max = 320.dp),
            contentScale = androidx.compose.ui.layout.ContentScale.Fit,
          )
          footer?.let { Text(it, Modifier.padding(horizontal = space(2f), vertical = space(1f)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
        }
      }
    }
    "html" -> {
      // `{ "type": "html", "source": "{data.message.html}", "empty": "…" }`: a message's HTML, drawn as styled text. Scripts, styles,
      // frames, forms and images never reach the platform's reader, and a link opens in the system handler.
      val source = ScreenValues.render(block.string("source").orEmpty(), context)
      SectionCard(title) {
        if (source.isEmpty()) {
          Text(
            block.string("empty")?.let { ScreenValues.render(it, context) } ?: "Nothing to show.",
            Modifier.padding(horizontal = space(2f), vertical = space(1f)),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
        } else {
          val shown = remember(source) { EmailHtml.annotated(source) }
          androidx.compose.foundation.text.selection.SelectionContainer {
            Text(shown, Modifier.padding(horizontal = space(2f), vertical = space(1f)).testTag("spec-html"), style = MaterialTheme.typography.bodyMedium)
          }
        }
        footer?.let { Text(it, Modifier.padding(horizontal = space(2f), vertical = space(1f)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      }
    }
    "zone" -> {
      // A core screen's zone: whatever plugin screens contribute to it, never named here.
      val name = block.string("name").orEmpty()
      val contributions = ScreenCatalog.zone(name).filter { ScreenValues.condition(it.requires, context) }
      // Native widgets other plugins put in the same slot sit beside the spec screens.
      val widgets = plugin.slotWidgets(name)
      // `empty`: what to say when no plugin has put anything in the zone.
      if (contributions.isEmpty() && widgets.isEmpty()) block.string("empty")?.let { NoticeBanner(ScreenValues.render(it, context), StatusTone.INFO) }
      if (contributions.isNotEmpty() || widgets.isNotEmpty()) {
        Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
          if (contributions.isNotEmpty()) {
            SectionCard(title) {
              Column(Modifier.fillMaxWidth()) {
                contributions.forEachIndexed { index, spec ->
                  ZoneRow(spec, plugin, renderParams(block["params"], context), divider = index > 0) { open(spec.id, it) }
                }
              }
            }
          }
          val slotParams = renderParams(block["params"], context)
          widgets.forEach { widget ->
            Box(Modifier.fillMaxWidth().testTag("zone-widget-${widget.id}")) {
              androidx.compose.runtime.CompositionLocalProvider(com.aglyn.pluginhost.LocalSlotParams provides slotParams) { widget.content(plugin) }
            }
          }
        }
      }
    }
    // An actions block whose every item is hidden by its `when` draws no card at all, never an empty one.
    else -> if (block.type != "actions" || footer != null || block.raw.arr("items").mapNotNull { ActionSpec.parse(it) }.any { ScreenValues.condition(it.whenCondition, context) }) SectionCard(title) {
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
          // One word (an email, an id, a link) stays on one line and gives up its middle, never breaking at a dot;
          // a tap still copies all of it. A sentence wraps as before.
          val oneLine = singleToken(shown)
          Text(
            shown,
            style = MaterialTheme.typography.bodyMedium,
            color = if (row.obj("tone") != null) toneColor(toneFor(row, value, scope)) else MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.End,
            maxLines = if (oneLine) 1 else Int.MAX_VALUE,
            overflow = if (oneLine) TextOverflow.MiddleEllipsis else TextOverflow.Clip,
          )
        }
      }
    }
  }
}

/** A value with no space in it: an email, an id or a link, which reads wrong broken across lines. */
internal fun singleToken(value: String): Boolean = value.isNotEmpty() && value.none { it.isWhitespace() }

@Composable
private fun toneColor(tone: StatusTone) = when (tone) {
  StatusTone.SUCCESS -> com.aglyn.ui.LocalAglynPalette.current.success.text
  StatusTone.WARNING -> com.aglyn.ui.LocalAglynPalette.current.warning.text
  StatusTone.ERROR -> MaterialTheme.colorScheme.error
  StatusTone.INFO -> com.aglyn.ui.aglynAccentText
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
  val key = ListColumns.key(block)
  val columns = ListColumns.columns(block)
  val asked = model.order[key]
  val column = asked?.let { order -> columns.firstOrNull { it.id == order.column } }
  // `chips: { field, from, label }`: a filter over the values in `from`, narrowing the rows to those whose
  // `field` equals the choice (the forum's category filter).
  var chosen by remember { mutableStateOf("") }
  val chips = block["chips"]
  val chipField = chips?.str("field")
  val chipValues = chips?.let { (ScreenValues.lookup(it.str("from").orEmpty(), context) as? JsonArray)?.map { v -> ScreenValues.text(v) } }.orEmpty()
  val rows = listScopes(block, context, chipField, chosen, column, asked)
  val picked = model.shownColumns(key, columns)
  val loadKey = block.string("load")
  // `page: N`: the first N rows, then Show more for N more (a list the screen holds whole, such as a diff).
  var revealed by remember { mutableStateOf(0) }
  val page = (block["page"] as? JsonPrimitive)?.content?.toIntOrNull() ?: 0
  val shown = if (page > 0) rows.take(page * (1 + revealed)) else rows
  val sortable = columns.filter { it.sortable }
  val pickable = columns.filter { !it.always }
  val heading = title?.let { if (rows.isNotEmpty() && block["count"] != JsonPrimitive(false)) "$it · ${rows.size}" else it }
  SectionCard(
    heading ?: if (sortable.isNotEmpty() || pickable.isNotEmpty()) "" else null,
    action = if (sortable.isEmpty() && pickable.isEmpty()) null else ({
      Row {
        if (sortable.isNotEmpty()) SortMenu(key, sortable, asked, column) { next, routed -> scope.launch { model.ask(next, key, routed) } }
        if (pickable.isNotEmpty()) ColumnsMenu(key, pickable, picked) { model.shown[key] = it }
      }
    }),
  ) {
    Column(Modifier.fillMaxWidth()) {
      if (chipValues.isNotEmpty()) {
        @OptIn(ExperimentalLayoutApi::class)
        FlowRow(Modifier.padding(horizontal = space(2f), vertical = space(1f)), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          for (value in chipValues) {
            androidx.compose.material3.FilterChip(
              selected = chosen == value,
              onClick = { chosen = if (chosen == value) "" else value },
              colors = com.aglyn.ui.aglynFilterChipColors(),
              label = { Text(value) },
              modifier = Modifier.testTag("list-chip-$value"),
            )
          }
        }
      }
      if (rows.isEmpty()) {
        Text(
          ScreenValues.render(block.string("empty") ?: "Nothing here yet.", context),
          Modifier.padding(space(2f)),
          style = MaterialTheme.typography.bodyMedium,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
      }
      shown.forEachIndexed { index, row ->
        if (index > 0) HorizontalDivider()
        ListRow(block, row, selection, open, trigger, columnsLine = ListColumns.line(columns, picked, row))
      }
      if (page > 0 && rows.size > shown.size) {
        HorizontalDivider()
        TextButton(onClick = { revealed += 1 }, modifier = Modifier.fillMaxWidth().testTag("show-more")) { Text("Show more") }
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

/**
 * Each row of a list as the scope it is drawn in (`item`, its `index`, and with `within` the outer row as `parent`): `flatten` walks
 * rows a level or more down, `filter` and the chosen chip keep some, `sort` orders them, and then a `page` column the person asked
 * for (a `route` column already came back from the route in its order).
 */
private fun listScopes(block: BlockSpec, context: JsonElement, chipField: String?, chosen: String, column: ListColumn?, asked: ListOrder?): List<JsonElement> {
  val items = block.string("items").orEmpty()
  var found: List<Pair<JsonElement, JsonElement>> = block.string("flatten")?.let { through ->
    ScreenValues.flatten(ScreenValues.rows(ScreenValues.lookup(items, context)), through).mapIndexed { index, row ->
      ScreenContext.with(ScreenContext.withItem(context, row), "index", JsonPrimitive(index)) to row
    }.filter { ScreenValues.condition(block.string("filter"), it.first) }
  } ?: ScreenValues.scopes(items, block.string("within"), block.string("filter"), context).map { it to ((it as? JsonObject)?.get("item") ?: JsonNull) }
  if (chipField != null && chosen.isNotEmpty()) found = found.filter { ScreenValues.text(ScreenValues.lookup("item.$chipField", it.first)) == chosen }
  block.string("sort")?.let { sort -> found = ScreenValues.order(found.map { it.second }, sort).map { found[it] } }
  if (column?.page != null && asked != null) found = ListColumns.order(found.map { it.second }, column, asked.descending, context).map { found[it] }
  return found.map { it.first }
}

/** The header sort: a tap on a column asks for its first order, a second for the other, a third for the default again. */
@Composable
private fun SortMenu(key: String, columns: List<ListColumn>, asked: ListOrder?, chosen: ListColumn?, ask: (ListOrder?, Boolean) -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box {
    WithTooltip("Sort") { IconButton(onClick = { open = true }, modifier = Modifier.testTag("sort-$key")) {
      Icon(
        AglynIcons.named("filter_list"),
        contentDescription = "Sort",
        tint = if (asked == null) MaterialTheme.colorScheme.onSurfaceVariant else MaterialTheme.colorScheme.primary,
      )
    } }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      DropdownMenuItem(
        text = { Text(if (asked == null) "\u2713 Default order" else "Default order") },
        onClick = { open = false; ask(null, chosen?.route != null) },
        modifier = Modifier.testTag("sort-default"),
      )
      for (column in columns) {
        val active = asked?.takeIf { it.column == column.id }
        DropdownMenuItem(
          text = { Text(if (active != null) "\u2713 ${column.label} ${if (active.descending) "\u2193" else "\u2191"}" else column.label) },
          onClick = { open = false; ask(ListColumns.next(asked, column), column.route != null || chosen?.route != null) },
          modifier = Modifier.testTag("sort-${column.id}"),
        )
      }
    }
  }
}

/** The column picker: which facts each row shows. */
@Composable
private fun ColumnsMenu(key: String, columns: List<ListColumn>, shown: Set<String>, pick: (Set<String>) -> Unit) {
  var open by remember { mutableStateOf(false) }
  Box {
    WithTooltip("Columns") { IconButton(onClick = { open = true }, modifier = Modifier.testTag("columns-$key")) {
      Icon(AglynIcons.named("tune"), contentDescription = "Columns", tint = MaterialTheme.colorScheme.onSurfaceVariant)
    } }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      for (column in columns) {
        val on = column.id in shown
        DropdownMenuItem(
          text = { Text(if (on) "\u2713 ${column.label}" else column.label) },
          onClick = { pick(if (on) shown - column.id else shown + column.id) },
          modifier = Modifier.testTag("column-${column.id}"),
        )
      }
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
  /** The row's picked columns as one line (`columns`), empty for a list without them. */
  columnsLine: String = "",
) {
  val actions = block.raw.arr("actions").mapNotNull { ActionSpec.parse(it) }.filter { ScreenValues.condition(it.whenCondition, scope) }
  val target = block["open"]?.takeIf { ScreenValues.condition(it.str("when"), scope) }?.let { openSpec ->
    openSpec.str("screen")?.let { Selection(it, renderParams(openSpec.obj("params"), scope)) }
  }
  // A template, or a list of parts joined with ` · ` as `secondary` takes them (a part shown only while its `when` holds).
  val primary = (block["primary"] as? JsonArray)?.let { rowLine(it, scope).orEmpty() }?.ifEmpty { "—" }
    ?: ScreenValues.render(block.string("primary") ?: "{item.name|item.\$id}", scope).ifEmpty { "—" }
  val secondary = rowLine(block["secondary"], scope)
  val tertiary = rowLine(block["tertiary"], scope)
  val trailingText = block.string("trailing")?.let { ScreenValues.render(it, scope) }?.takeIf { it.isNotEmpty() }
  val badges = block.raw.arr("badges").flatMap { rowBadges(it, scope) }
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
  val supporting = listOfNotNull(secondary, columnsLine.ifEmpty { null }, tertiary).joinToString("\n").ifEmpty { null }
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
              WithTooltip("Actions for $primary") { IconButton(onClick = { menu = true }, modifier = Modifier.testTag("row-menu")) {
                Icon(AglynIcons.named("more_vert"), contentDescription = "Actions for $primary")
              } }
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
  /** A chosen file: its name, and its text. */
  data class File(val name: String, val text: String) : FieldValue
}

/** The `form` a block hands its action: every field's value, and for a chosen file also `<key>Name`. */
internal fun formObject(fields: List<FieldSpec>, value: (FieldSpec) -> FieldValue?): JsonObject = JsonObject(
  buildMap {
    for (field in fields) {
      val held = value(field)
      put(field.key, fieldJson(field, held))
      if (held is FieldValue.File) put(field.key + "Name", JsonPrimitive(held.name))
    }
  },
)

internal fun fieldJson(field: FieldSpec, value: FieldValue?): JsonElement = when {
  field.kind == "toggle" && value is FieldValue.Flag -> JsonPrimitive(value.value)
  // The chosen ids, one per line while edited; nothing chosen is null (no restriction).
  field.kind == "multiselect" && value is FieldValue.Text ->
    value.value.split('\n').filter { it.isNotEmpty() }.let { chosen -> if (chosen.isEmpty()) JsonNull else JsonArray(chosen.map { JsonPrimitive(it) }) }
  // What the upload step reads out of the chosen file or pasted rows, kept as JSON text while it is edited.
  field.kind == "upload" && value is FieldValue.Text ->
    runCatching { kotlinx.serialization.json.Json.parseToJsonElement(value.value) }.getOrDefault(JsonNull)
  field.kind == "file" && (value is FieldValue.Text || value is FieldValue.File) -> {
    val text = if (value is FieldValue.File) value.text else (value as FieldValue.Text).value
    if (text.isEmpty()) JsonNull else if (field.parse == "json") runCatching { kotlinx.serialization.json.Json.parseToJsonElement(text) }.getOrDefault(JsonNull) else JsonPrimitive(text)
  }
  // One entry per line while edited; the list is what is sent (nothing typed is an empty list).
  field.kind == "lines" && value is FieldValue.Text ->
    JsonArray(value.value.split('\n').map { it.trim() }.filter { it.isNotEmpty() }.map { JsonPrimitive(it) })
  field.kind == "number" && value is FieldValue.Text -> value.value.trim().let { t -> if (t.isEmpty()) JsonNull else t.toDoubleOrNull()?.let { JsonPrimitive(if (field.integer) kotlin.math.round(it) else it) } ?: JsonPrimitive(t) }
  value is FieldValue.Text -> JsonPrimitive(if (field.kind == "multiline" || field.kind == "password") value.value else value.value.trim())
  value is FieldValue.Flag -> JsonPrimitive(value.value)
  value is FieldValue.File -> JsonPrimitive(value.text)
  else -> if (field.kind == "toggle") JsonPrimitive(false) else JsonNull
}

/**
 * The scope a form or prompt runs its action with: `form` holds only the fields the person could see (their `when`
 * holds), so a field the screen hid is never sent, as a console form that never drew it would not send it.
 */
internal fun visibleOnly(filled: JsonElement, fields: List<FieldSpec>): JsonElement {
  val all = (filled as? JsonObject)?.get("form") as? JsonObject ?: return filled
  val keep = fields.filter { ScreenValues.condition(it.whenCondition, filled) }.map { it.key }.toSet()
  return ScreenContext.with(filled, "form", JsonObject(all.filterKeys { it in keep }))
}

internal fun initialValue(field: FieldSpec, context: JsonElement): FieldValue {
  val resolved = field.initial?.let { ScreenValues.resolve(it, context) } ?: JsonNull
  if (field.kind == "toggle") return FieldValue.Flag(ScreenValues.truthy(resolved))
  if (field.kind == "multiselect") return FieldValue.Text(((resolved as? JsonArray) ?: JsonArray(emptyList())).joinToString("\n") { ScreenValues.text(it) })
  if (field.kind == "lines") return FieldValue.Text(((resolved as? JsonArray) ?: JsonArray(emptyList())).joinToString("\n") { ScreenValues.text(it) })
  if (field.kind == "date") ScreenValues.epochMillis(resolved)?.let { millis ->
    val (y, m, d) = localParts(millis, "UTC")
    return FieldValue.Text("$y-${m.toString().padStart(2, '0')}-${d.toString().padStart(2, '0')}")
  }
  return FieldValue.Text(ScreenValues.text(resolved))
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
internal fun FieldInput(field: FieldSpec, context: JsonElement, value: FieldValue, onChange: (FieldValue) -> Unit) {
  val text = when (value) {
    is FieldValue.Text -> value.value
    is FieldValue.File -> value.text
    else -> ""
  }
  val help = field.help?.let { ScreenValues.render(it, context) }
  // A label can name what the loaded data does (a registration number's name for the jurisdiction in force).
  val label = ScreenValues.render(field.label, context)
  Column(Modifier.fillMaxWidth().testTag("field-${field.key}")) {
    when (field.kind) {
      "toggle" -> SwitchRow(label, (value as? FieldValue.Flag)?.value == true, { onChange(FieldValue.Flag(it)) }, supporting = help)
      "hours" -> HoursInput(field, text) { onChange(FieldValue.Text(it)) }
      "file" -> {
        // The chosen file is read whole as text (a package, a CSV); its name sits beside the button.
        val picker = com.aglyn.ui.LocalMediaPicker.current
        val chooser = rememberCoroutineScope()
        Text(field.label, style = MaterialTheme.typography.titleSmall)
        androidx.compose.foundation.layout.Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
          OutlinedButton(
            enabled = picker != null,
            onClick = {
              chooser.launch {
                picker?.pick(com.aglyn.ui.PickSource.FILES, multiple = false)?.firstOrNull()?.let { file ->
                  // `base64` keeps the file's bytes as they are (a plugin bundle sent whole); otherwise it is read as text.
                  onChange(FieldValue.File(file.name, if (field.parse == "base64") ScreenValues.base64(file.bytes) else ScreenValues.decodeFileText(file.bytes)))
                }
              }
            },
          ) { Text(if (text.isEmpty()) "Choose a file" else "Choose a different file") }
          if (text.isNotEmpty()) Text((value as? FieldValue.File)?.name ?: "File chosen", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
        }
        help?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      }
      "upload" -> UploadFieldInput(field, context, text) { onChange(FieldValue.Text(it)) }
      "media" -> MediaFieldInput(field, text) { onChange(FieldValue.Text(it)) }
      "multiselect" -> {
        // Each choice a switch; the chosen ids are kept one per line. An id the list no longer offers is kept, not dropped.
        val choices = field.choices(context)
        val chosen = text.split('\n').filter { it.isNotEmpty() }
        Text(field.label, style = MaterialTheme.typography.titleSmall)
        for ((id, label) in choices) {
          // A choice may say what agreeing to it means (a publisher's attestation), under its label.
          SwitchRow(label, id in chosen, { on ->
            val offered = choices.map { it.first }
            val next = offered.filter { if (it == id) on else it in chosen } + chosen.filter { it !in offered }
            onChange(FieldValue.Text(next.joinToString("\n")))
          }, supporting = field.detail(id, context))
        }
        help?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
      }
      "choice" -> {
        // One of a few rows, each with a line under it and a mark (the console's tier menu: price, credits, Current); a row
        // that cannot be picked stays, dimmed, with its reason.
        Text(label, style = MaterialTheme.typography.titleSmall)
        for (choice in field.choiceRows(context)) {
          ChoiceRow(
            choice.label, text == choice.value, { onChange(FieldValue.Text(choice.value)) },
            Modifier.testTag("choice-${field.key}-${choice.value}"),
            supporting = choice.detail, enabled = choice.enabled,
            badge = choice.badge?.let { mark -> { StatusChip(mark.text, tone(mark.tone)) } },
          )
        }
      }
      "select", "country" -> {
        val choices = field.choices(context)
        var expanded by remember { mutableStateOf(false) }
        ExposedDropdownMenuBox(expanded = expanded, onExpandedChange = { expanded = it }) {
          OutlinedTextField(
            value = choices.firstOrNull { it.first == text }?.second ?: text,
            onValueChange = {},
            readOnly = true,
            label = { Text(label) },
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
        label = { Text(label + if (field.required) " *" else "") },
        placeholder = field.placeholder?.let { { Text(it) } },
        singleLine = field.kind != "multiline" && field.kind != "lines",
        minLines = if (field.kind == "multiline" || field.kind == "lines") 3 else 1,
        visualTransformation = if (field.kind == "password") PasswordVisualTransformation() else androidx.compose.ui.text.input.VisualTransformation.None,
        keyboardOptions = KeyboardOptions(
          keyboardType = when (field.kind) {
            "email" -> KeyboardType.Email
            "url" -> KeyboardType.Uri
            "number" -> if (field.integer) KeyboardType.Number else KeyboardType.Decimal
            "password" -> KeyboardType.Password
            else -> KeyboardType.Text
          },
        ),
        modifier = Modifier.fillMaxWidth(),
      )
    }
    if (field.generate != null) {
      TextButton(
        onClick = { onChange(FieldValue.Text(field.generatedValue(context).orEmpty())) },
        modifier = Modifier.testTag("generate-${field.key}"),
      ) { Text("Generate") }
    }
    val mismatch = field.mismatch?.takeIf { text.isNotEmpty() && field.refuses(JsonPrimitive(text), context) }?.let { ScreenValues.render(it, context) }
    if (mismatch != null) {
      Text(mismatch, Modifier.padding(top = space(0.5f)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.error)
    } else if (help != null && field.kind != "toggle") {
      Text(help, Modifier.padding(top = space(0.5f)), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
}

@Composable
private fun FormBlock(block: BlockSpec, context: JsonElement, busy: Boolean, submit: (ActionSpec, JsonElement) -> Unit) {
  val fields = FieldSpec.parseAll(block.raw.arr("fields"), context)
  val base = block.string("object")?.let { ScreenValues.lookup(it, context) }
  val scope = base?.let { ScreenContext.withItem(context, it) } ?: context
  // Re-seeded whenever the loaded data changes, as after a save.
  val values = remember(scope) { mutableStateMapOf<String, FieldValue>().apply { fields.forEach { put(it.key, initialValue(it, scope)) } } }
  val filled = ScreenContext.with(scope, "form", formObject(fields) { values[it.key] })
  val missing = fields.any { ScreenValues.condition(it.whenCondition, filled) && it.unmet(fieldJson(it, values[it.key]), scope) }
  Column(Modifier.fillMaxWidth().padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    for (field in fields.filter { ScreenValues.condition(it.whenCondition, filled) }) {
      FieldInput(field, scope, values[field.key] ?: initialValue(field, scope)) { values[field.key] = it }
    }
    // A settings form's Save (or Save profile, Save image) shows once something in it changed: a screen of small forms (error pages, one select each)
    // is not a column of Save buttons. Any other submit (Send, Generate, Invite) always shows.
    val changed = fields.any { (values[it.key] ?: initialValue(it, scope)) != initialValue(it, scope) }
    ActionSpec.parse(block["submit"])
      ?.takeIf { ScreenValues.condition(it.whenCondition, scope) }
      ?.takeIf { changed || fields.isEmpty() || !ScreenValues.render(it.label, scope).startsWith("Save") }
      ?.let { action ->
      FilledTonalButton(
        colors = com.aglyn.ui.aglynTonalButtonColors(),
        onClick = { submit(action, visibleOnly(filled, fields)) },
        enabled = !busy && !missing,
        modifier = Modifier.align(Alignment.End).testTag("submit-${block.id}"),
      ) {
        if (busy) CircularProgressIndicator(Modifier.size(16.dp).padding(end = space(1f)), strokeWidth = 2.dp)
        Text(ScreenValues.render(action.label, scope), maxLines = 1, overflow = TextOverflow.Ellipsis)
      }
    }
  }
}

/**
 * A week of hours chosen by touch: the UI kit's opening hours picker (the console's weekly hours picker) over the stored text
 * lines (`Mo-Fr 09:00-17:00`), so nobody types them. The field's `hours` object sets the noun, the opening and closing time of
 * a day switched on, and `sameDay`.
 */
@Composable
private fun HoursInput(field: FieldSpec, text: String, onChange: (String) -> Unit) {
  OpeningHoursPicker(
    value = text,
    onChange = onChange,
    modifier = Modifier.testTag("hours-${field.key}"),
    label = field.label,
    defaultInterval = WeeklyHoursInterval(
      ScreenValues.number(field.hours.obj("start"))?.toInt() ?: (9 * 60),
      ScreenValues.number(field.hours.obj("end"))?.toInt() ?: (17 * 60),
    ),
    intervalNoun = field.hours.str("noun") ?: "hours",
    sameDay = field.hours.isTrue("sameDay"),
  )
}

/**
 * One screen's row in a zone. A screen with a `showWhen` reads its own loads first and is listed only while the condition holds,
 * so a widget with nothing to say to this store leaves no row; one without is listed at once.
 */
@Composable
private fun ZoneRow(spec: ScreenSpec, plugin: NativePluginContext, params: NativeParams, divider: Boolean, open: (NativeParams) -> Unit) {
  val session = LocalScreenSession.current
  val shown = if (spec.showWhen == null) {
    true
  } else {
    val model = remember(spec.id, params) { ScreenModel(spec, session.context(plugin, params), plugin.api, plugin.firestore, null, session.account) }
    LaunchedEffect(model) { model.load() }
    model.phase == ScreenModel.Phase.Ready && ScreenValues.condition(spec.showWhen, model.context)
  }
  if (!shown) return
  if (divider) HorizontalDivider()
  AglynListItem(
    title = spec.label,
    supporting = spec.subtitle,
    icon = AglynIcons.named(spec.icon),
    trailing = { Icon(AglynIcons.named("chevron_right"), contentDescription = null) },
    onClick = { open(params) },
    modifier = Modifier.testTag("zone-${spec.id}"),
  )
}

/** Where a plan refusal sends a person to add what the screen needs. */
internal const val BILLING_ADDONS_SCREEN = "core.billing.addons"
