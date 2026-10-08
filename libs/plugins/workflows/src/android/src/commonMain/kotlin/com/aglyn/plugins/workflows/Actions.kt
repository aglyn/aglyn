package com.aglyn.plugins.workflows

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.ACTION_MAX_STEPS
import com.aglyn.contracts.ELEMENT_SCOPED_SITE_EVENTS
import com.aglyn.contracts.HOST_ACTION_STEP_LABELS
import com.aglyn.contracts.SITE_EVENT_TYPES
import com.aglyn.contracts.describeInteractionPlaceholder
import com.aglyn.contracts.hostEventLabel
import com.aglyn.contracts.hostEventPayloadHint
import com.aglyn.contracts.hostEventTypes
import com.aglyn.contracts.hostEventsInOrder
import com.aglyn.contracts.interactionPlaceholders
import com.aglyn.contracts.isSiteEventType
import com.aglyn.contracts.str
import com.aglyn.contracts.stepRunsAfterWait
import com.aglyn.contracts.triggerFilterProblem
import com.aglyn.contracts.validateHostAction
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.EmptyState
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/*
 * A site's actions, as the console's Actions card keeps them: switch each on
 * or off (confirming one that still holds placeholders), edit, test an
 * in-page one, its runs, delete; the element interactions counted rather
 * than listed; and the organization's automations that run on this site,
 * each pausable here.
 */

private val ACTION_STEP_KINDS: List<SelectOption> = HOST_ACTION_STEP_LABELS.map { (type, label) -> SelectOption(type, label) }

@Composable
fun ActionsSection(context: NativePluginContext, hostId: String, entitlements: Entitlements?, open: (AutomationTarget) -> Unit, selectedId: String?) {
  val api = remember(context.api, context.writer) { AutomationApi(context.api, context.writer) }
  val scope = rememberCoroutineScope()
  val live = liveQuery(context, remember(hostId) { ceilingQuery(actionsPath(hostId), ACTION_CEILING) })
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var deleting by remember { mutableStateOf<ActionRow?>(null) }
  var switchingOn by remember { mutableStateOf<ActionRow?>(null) }
  var busy by remember { mutableStateOf(false) }

  fun run(done: String?, action: suspend () -> Unit) {
    busy = true
    scope.launch {
      try {
        action()
        done?.let { notice = it to StatusTone.SUCCESS }
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        notice = failureMessage(error) to StatusTone.ERROR
      } finally {
        busy = false
      }
    }
  }

  SectionList(
    testTag = "actions-section",
    live = live,
    rows = { docs -> actionListOf(windowOf(docs, ACTION_CEILING).rows).actions },
    key = { it.id },
    emptyText = null,
    header = {
      RunQuotaLine(context, RunCounter.ACTION_RUNS, context.orgId, hostId, entitlements)
      Intro("When a site event fires, run automations in order — trigger a workflow, show the visitor an alert, chain a custom event, or write to a dataset. Pro plans and up.")
      AutomationNoticeBanner()
      notice?.let { (message, tone) -> NoticeBanner(message, tone, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
    },
    footer = { docs, _ ->
      val window = windowOf(docs, ACTION_CEILING)
      if (window.truncated) {
        NoticeBanner(
          "Showing the first $ACTION_CEILING rows of this site’s automations, ordered by id. There are more — both the list above and the interaction count below describe only what was read.",
          StatusTone.INFO,
        )
      }
      AddButton("Add action", "add-action") {
        if (entitlements != null && !entitlements.has("actions")) {
          notice = "The actions builder requires a Pro plan — see Billing to upgrade" to StatusTone.WARNING
        } else {
          open(AutomationTarget.Action(null))
        }
      }
      elementInteractionLine(actionListOf(window.rows).elementInteractions)?.let { Caption(it, Modifier.testTag("element-interactions")) }
      context.orgId?.let { orgId -> SiteOrgAutomationsPanel(context, orgId, hostId, open) }
    },
  ) { row ->
    AutomationRow(
      title = row.name,
      caption = row.caption,
      warning = placeholderLine(row.placeholders),
      selected = row.id == selectedId,
      testTag = "action-${row.id}",
      onClick = { open(AutomationTarget.Action(row.id)) },
      leading = {
        Switch(
          checked = row.enabled,
          enabled = !busy,
          onCheckedChange = { on ->
            if (on && interactionPlaceholders(row.raw).isNotEmpty()) {
              switchingOn = row
            } else {
              run(null) { api.setActionEnabled(hostId, row.id, on) }
            }
          },
          modifier = Modifier.testTag("action-${row.id}-switch").semantics { contentDescription = "Switch ${row.name} on or off" },
        )
      },
      actions = buildList {
        add(MenuAction("Edit", "edit") { open(AutomationTarget.Action(row.id)) })
        if (isSiteEventType(row.event)) {
          add(MenuAction("Test", "play_arrow") { run(null) { notice = api.testRun(hostId, row.id) to StatusTone.SUCCESS } })
        }
        add(MenuAction("Runs", "history") { open(AutomationTarget.Runs(row.id, row.name, siteScope = false)) })
        add(MenuAction("Delete", "delete", destructive = true) { deleting = row })
      },
    )
  }

  switchingOn?.let { row ->
    val missing = interactionPlaceholders(row.raw)
    val one = missing.size == 1
    ActionDialog(
      title = "Switch on with placeholders?",
      body = "\"${row.name}\" still has ${if (one) "a placeholder" else "${missing.size} placeholders"} to fill in: " +
        missing.take(3).joinToString("; ") { describeInteractionPlaceholder(it) } + (if (missing.size > 3) "; …" else "") +
        ". Open it with Edit to fill ${if (one) "it" else "them"} in first.",
      confirmLabel = "Switch on anyway",
      dismissLabel = "Cancel",
      icon = "warning",
      onDismiss = { switchingOn = null },
      onConfirm = {
        switchingOn = null
        run(null) { api.setActionEnabled(hostId, row.id, true) }
      },
    )
  }
  deleting?.let { row ->
    ActionDialog(
      title = "Delete this action?",
      body = "\"${row.name}\" stops running on its trigger.",
      confirmLabel = "Delete",
      destructive = true,
      icon = "delete",
      dismissLabel = "Cancel",
      onDismiss = { deleting = null },
      onConfirm = {
        deleting = null
        run(null) { api.deleteAction(hostId, row.id) }
      },
    )
  }
}

/** "Org automations on this site": what the organization runs here, each pausable for this site alone. */
@Composable
fun SiteOrgAutomationsPanel(context: NativePluginContext, orgId: String, hostId: String, open: (AutomationTarget) -> Unit) {
  val api = remember(context.api, context.writer) { AutomationApi(context.api, context.writer) }
  val scope = rememberCoroutineScope()
  val live = liveQuery(context, remember(orgId, hostId) { siteOrgAutomationsQuery(orgId, hostId) })
  val rows = sortedOrgAutomations((live as? Live.Ready)?.value ?: emptyList(), Int.MAX_VALUE)
  var busy by remember { mutableStateOf<String?>(null) }
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  if (rows.isEmpty()) return
  SectionCard("Org automations on this site", Modifier.fillMaxWidth().padding(top = space(1f)).testTag("site-org-automations")) {
    Intro(
      "Your organization runs these on this site beside the site’s own actions. Each run sends from this site and counts on its action runs. Pausing one stops it here — and anyone waiting inside it here — and leaves every other site alone.",
    )
    notice?.let { (message, tone) -> NoticeBanner(message, tone, action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } }) }
    for (row in rows) {
      val placement = sitePlacement(row, hostId)
      val paused = placement == SitePlacement.PAUSED
      AutomationRow(
        title = row.name,
        caption = row.caption,
        testTag = "site-org-${row.id}",
        badge = {
          StatusChip(
            placement.label,
            when (placement) {
              SitePlacement.OFF -> StatusTone.NEUTRAL
              SitePlacement.PAUSED -> StatusTone.WARNING
              SitePlacement.RUNS -> StatusTone.SUCCESS
            },
          )
        },
        actions = listOf(
          MenuAction(if (paused) "Resume here" else "Pause here", if (paused) "play_arrow" else "pause", enabled = busy != row.id) {
            busy = row.id
            scope.launch {
              notice = try {
                api.pause(hostId, row.id, !paused)
                (if (!paused) "“${row.name}” is paused on this site" else "“${row.name}” runs on this site again") to StatusTone.SUCCESS
              } catch (error: CancellationException) {
                throw error
              } catch (error: Throwable) {
                (error.message ?: "The request could not be completed") to StatusTone.WARNING
              }
              busy = null
            }
          },
          MenuAction("Runs", "history") { open(AutomationTarget.Runs(row.id, row.name, siteScope = true)) },
        ),
      )
    }
  }
}

/** The action editor ("Add action" / "Edit action"). */
@Composable
fun ActionEditor(context: NativePluginContext, hostId: String, id: String?, onDone: (String?) -> Unit) {
  val api = remember(context.api, context.writer) { AutomationApi(context.api, context.writer) }
  val scope = rememberCoroutineScope()
  val stored = liveDoc(context, id?.let { "${actionsPath(hostId)}/$it" })
  val pickers = rememberSitePickers(context, hostId)

  if (id != null && stored is Live.Loading) return SkeletonList(rows = 4)
  if (id != null && stored is Live.Failed) return EmptyState("Could not load this action", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
  val seed = (stored as? Live.Ready)?.value
  if (id != null && seed == null) return EmptyState("This action is gone", icon = AglynIcons.named("bolt"))

  var draft by remember(id, seed != null) { mutableStateOf(seed?.let { actionDraftOf(it.data, it.id) } ?: ActionDraft(id = null, recipe = null, hasRecipe = true)) }
  var busy by remember { mutableStateOf(false) }
  var error by remember { mutableStateOf<String?>(null) }
  val formsLive = liveQuery(
    context,
    remember(hostId, draft.event) {
      if (hostEventsInOrder.firstOrNull { it.type == draft.event }?.payloadKeys?.contains("formId") == true) ceilingQuery(formsPath(hostId), EDITOR_OPTION_CEILING) else null
    },
  )
  val eventCarriesFormId = hostEventsInOrder.firstOrNull { it.type == draft.event }?.payloadKeys?.contains("formId") == true

  EditorFrame(
    title = if (draft.id != null) "Edit action" else "Add action",
    saveLabel = "Save action",
    saveEnabled = draft.name.isNotBlank(),
    busy = busy,
    error = error,
    onCancel = { onDone(null) },
    onSave = {
      val candidate = actionCandidate(draft)
      val problem = validateHostAction(candidate)
      if (problem != null) {
        error = problem
        return@EditorFrame
      }
      if (draft.id != null && (stored as? Live.Ready)?.fromCache == true) {
        error = staleSeedMessage("action")
        return@EditorFrame
      }
      busy = true
      error = null
      scope.launch {
        try {
          api.saveAction(hostId, draft.id, candidate)
          onDone("Action saved")
        } catch (caught: CancellationException) {
          throw caught
        } catch (caught: Throwable) {
          error = failureMessage(caught)
        } finally {
          busy = false
        }
      }
    },
    modifier = Modifier.testTag("action-editor"),
  ) {
    if (pickers.truncated.isNotEmpty()) {
      NoticeBanner(
        "Offering the first $EDITOR_OPTION_CEILING rows, ordered by id, for: ${pickers.truncated.joinToString(", ")}. This site has more, so a step target may not be listed below.",
        StatusTone.INFO,
      )
    }
    Field("Name", draft.name, { draft = draft.copy(name = it) }, modifier = Modifier.testTag("action-name"))
    SelectField(
      "Trigger event",
      hostEventTypes.map { SelectOption(it, hostEventLabel(it)) } +
        SITE_EVENT_TYPES.map { SelectOption(it, "$it (on page)") } +
        SelectOption(CUSTOM_EVENT_VALUE, "Custom event…"),
      draft.event,
      { draft = draft.copy(event = it) },
      Modifier.fillMaxWidth().testTag("action-trigger"),
    )
    if (draft.event == CUSTOM_EVENT_VALUE) {
      Field("Custom event name", draft.customEvent, { draft = draft.copy(customEvent = it) })
    } else {
      val problem = triggerFilterProblem(draft.filter)
      Field(
        "Filter (optional)",
        draft.filter,
        { draft = draft.copy(filter = it) },
        placeholder = "subscribe",
        helper = problem ?: hostEventPayloadHint(draft.event),
        error = problem != null,
      )
    }
    ConditionRowsEditor(
      draft.conditionRows,
      draft.combinator,
      { draft = draft.copy(conditionRows = it) },
      { draft = draft.copy(combinator = it) },
      formOptions = if (eventCarriesFormId) formOptions(windowOf(formsLive.docsOrEmpty(), EDITOR_OPTION_CEILING).rows) else null,
    )
    if (isSiteEventType(draft.event)) {
      if (draft.event in ELEMENT_SCOPED_SITE_EVENTS) {
        Field("CSS selector", draft.selector, { draft = draft.copy(selector = it) }, placeholder = "#pricing-table")
      }
      if (draft.event == "scrollDepth" || draft.event == "timeOnPage") {
        Field(if (draft.event == "scrollDepth") "Scroll %" else "Seconds", draft.threshold, { draft = draft.copy(threshold = it.filter { c -> c.isDigit() || c == '.' }) }, number = true)
      }
      Field("Only on pages (optional)", draft.pathPattern, { draft = draft.copy(pathPattern = it) }, placeholder = "/pricing or /blog/*")
      SelectField("Frequency", FREQUENCY_OPTIONS.map { SelectOption(it.first, it.second) }, draft.frequency, { draft = draft.withFrequency(it) }, Modifier.fillMaxWidth())
      if ((draft.cooldownMinutes ?: 0.0) >= 1 && !draft.oncePerVisitor && !draft.oncePerSession) {
        Field(
          "Cooldown (minutes)",
          draft.cooldownMinutes?.let { com.aglyn.contracts.jsNumberString(it) } ?: "60",
          { draft = draft.copy(cooldownMinutes = it.filter(Char::isDigit).toDoubleOrNull() ?: 0.0) },
          number = true,
        )
      }
    }
    Overline("Steps (run in order)")
    draft.steps.forEachIndexed { index, step ->
      StepCard(
        step = step,
        index = index,
        kind = step.str("type") ?: "",
        kinds = ACTION_STEP_KINDS,
        stepForKind = ::defaultStep,
        pickers = pickers.pickers,
        onChange = { next -> draft = draft.copy(steps = draft.steps.mapIndexed { i, it -> if (i == index) next else it }) },
        onRemove = { draft = draft.copy(steps = draft.steps.filterIndexed { i, _ -> i != index }) },
        replyContext = ReplyContext(draft.event, stepRunsAfterWait(draft.steps, index)),
      )
    }
    OutlinedButton(
      onClick = { draft = draft.copy(steps = draft.steps + defaultStep("siteAlert")) },
      enabled = draft.steps.size < ACTION_MAX_STEPS,
      modifier = Modifier.testTag("add-step"),
    ) {
      Icon(AglynIcons.named("add"), contentDescription = null, Modifier.size(18.dp))
      Text("Add step", Modifier.padding(start = space(0.5f)))
    }
  }
}
