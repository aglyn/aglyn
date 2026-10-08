package com.aglyn.plugins.funnels

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.DropOffAction
import com.aglyn.contracts.FunnelInventory
import com.aglyn.contracts.FunnelPageMatch
import com.aglyn.contracts.FunnelResult
import com.aglyn.contracts.SiteJourneyStepType
import com.aglyn.contracts.FUNNEL_EMAIL_KEYS
import com.aglyn.contracts.FUNNEL_STEP_TYPES
import com.aglyn.contracts.formatDuration
import com.aglyn.contracts.formatShare
import com.aglyn.contracts.funnelInventoryList
import com.aglyn.contracts.funnelStepTitle
import com.aglyn.contracts.funnelStepTypeLabel
import com.aglyn.contracts.waitLabel
import com.aglyn.core.ConsoleApiError
import com.aglyn.core.Live
import com.aglyn.core.PlanFeatureDefaults
import com.aglyn.core.nowMillis
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatTile
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.space

private fun planGranting(feature: String): String? =
  PlanFeatureDefaults.byPlan.entries.firstOrNull { it.value[feature] == true }?.key?.replaceFirstChar { it.uppercase() }

private fun grouped(value: Long): String = value.toString().reversed().chunked(3).joinToString(",").reversed()

/**
 * The site's funnels (the console's Funnels card on the Analytics page): each
 * funnel's steps, the visits that reached them over a range, and where they
 * dropped off. New and edit with the card's own checks, Create with AI,
 * Activate for a draft, delete, and "Act on this drop-off", all through the
 * `/api/funnels/…` doors.
 */
@Composable
fun FunnelsScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val access = rememberFunnelsAccess(context)
  if (!access.ready) {
    SkeletonList(rows = 4)
    return
  }
  if (!access.entitled) {
    EmptyState(
      "Funnels come with analytics",
      body = "Funnels come with per-page analytics, included from ${planGranting(Contracts.funnelFeature) ?: "a paid plan"}. Change the plan under Billing to use them.",
      icon = AglynIcons.named("filter_alt"),
      modifier = Modifier.testTag("funnels-locked"),
    )
    return
  }
  val live = hostFunnels(context, enabled = true)
  val scope = rememberCoroutineScope()
  val api = remember(hostId, context.api) { ConsoleFunnelsApi(context.api, context.writer, hostId) }
  val editor = remember(api) { FunnelsEditor(api, scope) }
  AglynListDetail(
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Row(
          Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(space(1f)),
        ) {
          Text("Funnels", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          if (access.canManage) {
            val full = ((live as? Live.Ready)?.value?.size ?: 0) >= Contracts.funnelsMaxPerSite
            OutlinedButton(onClick = editor::askPropose, enabled = !full, modifier = Modifier.testTag("propose-funnel")) {
              Icon(AglynIcons.named("auto_awesome"), contentDescription = null)
              Text("Create with AI", Modifier.padding(start = space(1f)))
            }
            Button(onClick = editor::add, enabled = !full && !editor.busy, modifier = Modifier.testTag("add-funnel")) {
              Icon(AglynIcons.named("add"), contentDescription = null)
              Text("New funnel", Modifier.padding(start = space(1f)))
            }
          }
        }
        if (editor.draft == null && editor.deleting == null && !editor.proposing && editor.dropOff == null) {
          editor.error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.padding(horizontal = space(2f))) }
          editor.notice?.let { message ->
            NoticeBanner(message, StatusTone.SUCCESS, Modifier.padding(horizontal = space(2f)), action = { TextButton(onClick = { editor.notice = null }) { Text("Dismiss") } })
          }
        }
        when (live) {
          Live.Loading -> SkeletonList(rows = 4)
          is Live.Failed -> EmptyState("Could not load this site's funnels", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
          is Live.Ready -> LazyColumn(Modifier.fillMaxSize().testTag("funnels-list")) {
            if (live.value.isEmpty()) {
              item {
                EmptyState(
                  "No funnels yet",
                  body = "A funnel is the steps you expect a visitor to take, such as a page, then a form, then a booking. It shows how many visits reached each step and where they dropped off. Recording starts when you save the first one." +
                    if (access.canManage) "" else " A site admin or editor can create one.",
                  icon = AglynIcons.named("filter_alt"),
                )
              }
            }
            items(live.value, key = { it.id }) { row ->
              AglynListItem(
                title = row.name,
                supporting = "${row.steps.size} steps",
                icon = AglynIcons.named("filter_alt"),
                selected = row.id == selected,
                trailing = { if (row.draft) StatusChip("Draft", StatusTone.INFO) },
                onClick = { onSelect(row.id) },
                modifier = Modifier.testTag("funnel-${row.id}"),
              )
            }
          }
        }
      }
    },
    detail = { selected ->
      val row = (live as? Live.Ready)?.value?.firstOrNull { it.id == selected }
      if (row == null) {
        EmptyState("Pick a funnel to see its results", icon = AglynIcons.named("filter_alt"))
      } else {
        FunnelDetail(row, api, editor, access)
      }
    },
  )
  FunnelDialogs(editor, live)
}

@Composable
private fun FunnelDetail(row: FunnelRow, api: FunnelsApi, editor: FunnelsEditor, access: FunnelsAccess) {
  var days by rememberSaveable { mutableStateOf(30) }
  Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)), verticalArrangement = Arrangement.spacedBy(space(2f))) {
    SectionCard(null, Modifier.fillMaxWidth().testTag("funnel-detail")) {
      Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Text(row.name, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
        if (row.draft) StatusChip("Draft", StatusTone.INFO)
        if (!row.draft) {
          IconButton(onClick = editor::refresh, Modifier.testTag("refresh-funnel")) { Icon(AglynIcons.named("refresh"), contentDescription = "Refresh") }
        }
      }
      if (!row.draft) {
        ChoiceChipRow(
          options = FUNNEL_RANGES.map { ChipOption(it.toString(), "Last $it days") },
          selected = days.toString(),
          onSelect = { days = it.toInt() },
          wrap = true,
          modifier = Modifier.testTag("funnel-range"),
        )
      }
      if (access.canManage) {
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          Button(onClick = { editor.edit(row) }, enabled = !editor.busy, modifier = Modifier.testTag("edit-funnel")) { Text("Edit") }
          OutlinedButton(onClick = { editor.askDelete(row) }, modifier = Modifier.testTag("delete-funnel")) { Text("Delete") }
        }
      }
    }
    if (row.draft) {
      DraftReview(row, editor, access.canManage)
    } else {
      FunnelResultsPane(row, days, api, editor, access.canManage)
    }
    Text(
      "A visit is one browser tab, recorded only when the visitor’s consent allows analytics.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}

@Composable
private fun DraftReview(row: FunnelRow, editor: FunnelsEditor, canManage: Boolean) {
  SectionCard("Draft, set up for you to review", Modifier.fillMaxWidth().testTag("funnel-draft")) {
    Text(
      "It is not measured, and the site does not record visits for it, until " +
        (if (canManage) "you activate it." else "a site admin or editor activates it."),
      style = MaterialTheme.typography.bodyMedium,
    )
    row.steps.forEachIndexed { index, step ->
      Text("${index + 1}. ${funnelStepTitle(step)}", style = MaterialTheme.typography.bodyMedium)
    }
    if (canManage) {
      Button(onClick = { editor.activate(row) }, enabled = !editor.busy, modifier = Modifier.testTag("activate-funnel")) { Text("Activate") }
    }
  }
}

private sealed interface ResultState {
  data object Loading : ResultState
  data class Ready(val result: FunnelResult) : ResultState
  data class Failed(val message: String) : ResultState
}

@Composable
private fun FunnelResultsPane(row: FunnelRow, days: Int, api: FunnelsApi, editor: FunnelsEditor, canManage: Boolean) {
  val refreshKey = editor.refreshKey
  var state by remember(row.id, row.version, days, refreshKey) { mutableStateOf<ResultState>(ResultState.Loading) }
  LaunchedEffect(row.id, row.version, days, refreshKey) {
    val (from, to) = recentRange(days, nowMillis())
    state = try {
      ResultState.Ready(api.result(row.id, from, to, refreshKey > 0))
    } catch (failure: kotlinx.coroutines.CancellationException) {
      throw failure
    } catch (failure: Throwable) {
      ResultState.Failed(if (failure is ConsoleApiError && failure.status != 0) failure.message else "Could not load this funnel's results. Check the connection and try again.")
    }
  }
  when (val value = state) {
    ResultState.Loading -> LinearProgressIndicator(Modifier.fillMaxWidth())
    is ResultState.Failed -> NoticeBanner(value.message, StatusTone.ERROR, Modifier.testTag("funnel-result-error"))
    is ResultState.Ready -> FunnelResultView(
      value.result,
      row,
      onActOnDropOff = if (canManage) { reached ->
        editor.askDropOff(
          DropOffRequest(
            row.id,
            reached,
            row.steps.getOrNull(reached - 1)?.let(::funnelStepTitle).orEmpty(),
            row.steps.getOrNull(reached)?.let(::funnelStepTitle).orEmpty(),
          ),
        )
      } else null,
    )
  }
}

@Composable
fun FunnelResultView(result: FunnelResult, row: FunnelRow, onActOnDropOff: ((Int) -> Unit)? = null) {
  if (result.entered == 0L) {
    Text(
      if (result.journeysRead > 0) "No visit in this range reached the first step yet."
      else "No visits recorded in this range yet. Visits are recorded from when the first funnel was saved, for visitors whose consent allows analytics.",
      style = MaterialTheme.typography.bodyMedium,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
      modifier = Modifier.testTag("funnel-result-empty"),
    )
    return
  }
  val top = maxOf(1L, result.entered)
  SectionCard("Results", Modifier.fillMaxWidth().testTag("funnel-result")) {
    Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      StatTile("Entered", grouped(result.entered), Modifier.weight(1f))
      StatTile("Completed", grouped(result.completed), Modifier.weight(1f), caption = formatShare(result.overall))
    }
    Text(
      "${grouped(result.completed)} of ${grouped(result.entered)} visitors completed every step (${formatShare(result.overall)}).",
      style = MaterialTheme.typography.bodyMedium,
    )
    result.steps.forEach { step ->
      Column(Modifier.fillMaxWidth().testTag("funnel-step-${step.index}"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
          Text("${step.index + 1}. ${step.label}", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
          Text("${grouped(step.visitors)} · ${formatShare(step.fromStart)}", style = MaterialTheme.typography.bodyMedium)
        }
        LinearProgressIndicator(progress = { (step.visitors.toFloat() / top).coerceIn(0f, 1f) }, Modifier.fillMaxWidth().heightIn(min = 10.dp))
        if (step.index > 0) {
          Text(
            "${formatShare(step.fromPrevious)} of the previous step · ${grouped(step.dropOff)} dropped off · median ${formatDuration(step.medianMsFromPrevious)} from the previous step",
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
          )
          if (onActOnDropOff != null) {
            TextButton(onClick = { onActOnDropOff(step.index.toInt()) }, Modifier.testTag("act-${step.index}")) { Text("Act on this drop-off") }
          }
        }
      }
    }
    if (result.sources.isNotEmpty()) {
      HorizontalDivider()
      Text("By source", style = MaterialTheme.typography.titleSmall)
      result.sources.forEach { source ->
        Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          Text(source.source, Modifier.weight(1f), style = MaterialTheme.typography.bodyMedium)
          Text("${grouped(source.entered)} in", style = MaterialTheme.typography.bodySmall)
          Text("${grouped(source.completed)} done", style = MaterialTheme.typography.bodySmall)
          Text(formatShare(source.conversion), style = MaterialTheme.typography.bodyMedium)
        }
      }
    }
    if (result.capped) {
      Text(
        "Measured over the ${grouped(result.journeysRead)} most recent visits in this range.",
        style = MaterialTheme.typography.bodySmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
      )
    }
  }
}

@Composable
private fun FunnelDialogs(editor: FunnelsEditor, live: Live<List<FunnelRow>>) {
  editor.draft?.let { draft ->
    ActionDialog(
      title = if (draft.id == null) "New funnel" else "Edit funnel",
      icon = "filter_alt",
      confirmLabel = "Save",
      confirmEnabled = editor.inventory != null,
      busy = editor.busy,
      error = editor.error,
      onDismiss = editor::close,
      onConfirm = editor::save,
    ) {
      editor.notice?.let { NoticeBanner(it, StatusTone.INFO) }
      FunnelEditorForm(draft, editor.inventory, editor::change)
    }
  }
  if (editor.proposing) {
    var brief by remember { mutableStateOf("") }
    ActionDialog(
      title = "Create a funnel with AI",
      body = "Describe the journey you want to measure. The draft is checked against the pages and records your site has, and opens in the editor. Nothing is saved until you save it.",
      icon = "auto_awesome",
      confirmLabel = "Create draft",
      confirmEnabled = brief.isNotBlank(),
      busy = editor.busy,
      error = editor.error,
      onDismiss = editor::close,
      onConfirm = { editor.propose(brief) },
    ) {
      OutlinedTextField(
        brief,
        { brief = it.take(1_000) },
        label = { Text("Describe the funnel") },
        placeholder = { Text("Visitors who read the pricing page, then book a call") },
        minLines = 3,
        modifier = Modifier.fillMaxWidth().testTag("funnel-brief"),
      )
    }
  }
  editor.deleting?.let { row ->
    ActionDialog(
      title = "Delete this funnel?",
      body = "${row.name} and its results are removed. Recorded visits are kept until they expire.",
      icon = "delete",
      confirmLabel = "Delete",
      destructive = true,
      busy = editor.busy,
      error = editor.error,
      onDismiss = editor::close,
      onConfirm = editor::confirmDelete,
    )
  }
  editor.dropOff?.let { request -> DropOffDialog(request, editor) }
}

/** "Act on this drop-off": a follow-up on people who reached a step and did not go on, drafted switched off. */
@Composable
private fun DropOffDialog(request: DropOffRequest, editor: FunnelsEditor) {
  val waits = remember { dropOffWaits() }
  var hours by remember { mutableStateOf(waits.getOrElse(1) { waits.first() }) }
  var action by remember { mutableStateOf(DropOffAction.EMAIL) }
  ActionDialog(
    title = "Act on this drop-off",
    body = "For people who identified themselves with a form and reached \u201c${request.stepLabel}\u201d but not \u201c${request.nextStepLabel}\u201d. The automation is drafted switched off; nothing runs until you switch it on.",
    icon = "filter_alt",
    confirmLabel = "Draft automation",
    busy = editor.busy,
    error = editor.error,
    onDismiss = editor::close,
    onConfirm = { editor.draftDropOff(hours, action) },
  ) {
    ChoiceChipRow(
      options = waits.map { ChipOption(it.toString(), "After ${waitLabel(it)}") },
      selected = hours.toString(),
      onSelect = { hours = it.toInt() },
      wrap = true,
      modifier = Modifier.testTag("dropoff-wait"),
    )
    ChoiceChipRow(
      options = listOf(ChipOption(DropOffAction.EMAIL.raw, "Send an email"), ChipOption(DropOffAction.TASK.raw, "Create a task")),
      selected = action.raw,
      onSelect = { action = if (it == DropOffAction.TASK.raw) DropOffAction.TASK else DropOffAction.EMAIL },
      modifier = Modifier.testTag("dropoff-action"),
    )
  }
}

private fun emailKeyLabel(key: String) = if (key == "opened") "Opened an email from the site" else "Clicked a link in one"

/** The editor's fields: a name and 2 to 8 steps, each picked from what the site really has. */
@Composable
private fun FunnelEditorForm(draft: FunnelDraft, inventory: FunnelInventory?, onChange: (FunnelDraft) -> Unit) {
  fun update(index: Int, step: StepDraft) = onChange(draft.copy(steps = draft.steps.mapIndexed { at, one -> if (at == index) step else one }))
  fun move(index: Int, by: Int) {
    val next = draft.steps.toMutableList()
    next.add(index + by, next.removeAt(index))
    onChange(draft.copy(steps = next))
  }
  Column(
    Modifier.heightIn(max = 460.dp).verticalScroll(rememberScrollState()).testTag("funnel-editor"),
    verticalArrangement = Arrangement.spacedBy(space(1.5f)),
  ) {
    OutlinedTextField(
      draft.name,
      { onChange(draft.copy(name = it.take(Contracts.funnelNameMax.toInt()))) },
      label = { Text("Name") },
      singleLine = true,
      modifier = Modifier.fillMaxWidth().testTag("funnel-name"),
    )
    draft.steps.forEachIndexed { index, step ->
      SectionCard(null, Modifier.fillMaxWidth().testTag("step-$index")) {
        Row(verticalAlignment = Alignment.CenterVertically) {
          Text("Step ${index + 1}", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall)
          IconButton(onClick = { move(index, -1) }, enabled = index > 0) { Icon(AglynIcons.named("expand_less"), contentDescription = "Move step ${index + 1} up") }
          IconButton(onClick = { move(index, 1) }, enabled = index < draft.steps.size - 1) { Icon(AglynIcons.named("expand_more"), contentDescription = "Move step ${index + 1} down") }
          IconButton(
            onClick = { onChange(draft.copy(steps = draft.steps.filterIndexed { at, _ -> at != index })) },
            enabled = draft.steps.size > Contracts.funnelMinSteps,
            modifier = Modifier.testTag("remove-step-$index"),
          ) { Icon(AglynIcons.named("delete"), contentDescription = "Remove step ${index + 1}") }
        }
        SelectField(
          label = "Step",
          options = FUNNEL_STEP_TYPES.map { SelectOption(it.raw, funnelStepTypeLabel(it)) },
          selected = step.type.raw,
          onSelect = { picked -> FUNNEL_STEP_TYPES.firstOrNull { it.raw == picked }?.let { update(index, starterStep(it, inventory)) } },
          modifier = Modifier.fillMaxWidth().testTag("step-type-$index"),
        )
        StepKeyField(step, inventory, index) { update(index, it.copy(label = "")) }
        OutlinedTextField(
          step.label,
          { update(index, step.copy(label = it.take(Contracts.funnelLabelMax.toInt()))) },
          label = { Text("Label (optional)") },
          singleLine = true,
          modifier = Modifier.fillMaxWidth(),
        )
      }
    }
    OutlinedButton(
      onClick = { onChange(draft.copy(steps = draft.steps + starterStep(SiteJourneyStepType.PAGE, inventory))) },
      enabled = draft.steps.size < Contracts.funnelMaxSteps,
      modifier = Modifier.testTag("add-step"),
    ) {
      Icon(AglynIcons.named("add"), contentDescription = null)
      Text("Add a step", Modifier.padding(start = space(1f)))
    }
  }
}

@Composable
private fun StepKeyField(step: StepDraft, inventory: FunnelInventory?, index: Int, onChange: (StepDraft) -> Unit) {
  when (step.type) {
    SiteJourneyStepType.ORDER -> Unit
    SiteJourneyStepType.EMAIL -> SelectField(
      label = "What they did",
      options = FUNNEL_EMAIL_KEYS.map { SelectOption(it, emailKeyLabel(it)) },
      selected = step.key,
      onSelect = { picked -> onChange(step.copy(key = picked ?: "opened")) },
      supporting = "Counted only for people who submitted a form on this site",
      modifier = Modifier.fillMaxWidth(),
    )
    SiteJourneyStepType.EVENT -> OutlinedTextField(
      step.key,
      { onChange(step.copy(key = it)) },
      label = { Text("Event name") },
      supportingText = { Text("As the interaction\u2019s Send an analytics event step names it") },
      singleLine = true,
      modifier = Modifier.fillMaxWidth().testTag("step-key-$index"),
    )
    SiteJourneyStepType.PAGE -> {
      val pages = inventory?.pages.orEmpty()
      SelectField(
        label = "Page",
        options = pages.map { SelectOption(it, it) },
        selected = step.key.takeIf { it in pages },
        onSelect = { picked -> onChange(step.copy(key = picked ?: step.key)) },
        modifier = Modifier.fillMaxWidth().testTag("step-key-$index"),
      )
      SelectField(
        label = "Match",
        options = listOf(SelectOption("exact", "This page only"), SelectOption("prefix", "This page and everything under it")),
        selected = step.match.raw,
        onSelect = { picked -> onChange(step.copy(match = if (picked == "prefix") FunnelPageMatch.PREFIX else FunnelPageMatch.EXACT)) },
        modifier = Modifier.fillMaxWidth(),
      )
    }
    else -> {
      val list = inventory?.let { funnelInventoryList(it, step.type) }.orEmpty()
      SelectField(
        label = "Which",
        options = list.map { SelectOption(it.id, it.name) },
        selected = step.key.takeIf { key -> list.any { it.id == key } },
        onSelect = { picked -> onChange(step.copy(key = picked.orEmpty())) },
        noneLabel = "Any",
        modifier = Modifier.fillMaxWidth().testTag("step-key-$index"),
      )
    }
  }
}
