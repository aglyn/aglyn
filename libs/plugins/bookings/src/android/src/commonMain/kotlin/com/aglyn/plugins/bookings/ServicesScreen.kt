package com.aglyn.plugins.bookings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.BookingFieldAsk
import com.aglyn.contracts.BookingPriceDisplay
import com.aglyn.contracts.BookingServiceDraft
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.bookingServiceDraftFrom
import com.aglyn.contracts.bookingServiceDraftProblem
import com.aglyn.contracts.deviceTimeZone
import com.aglyn.contracts.formatBookingWindows
import com.aglyn.contracts.knownTimeZones
import com.aglyn.contracts.newBookingServiceDraft
import com.aglyn.contracts.parseBookingWindows
import com.aglyn.contracts.BookingWindow
import com.aglyn.core.Live
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.AglynListDetail
import com.aglyn.ui.AglynListItem
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.HoursWindow
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.WeeklyHoursEditor
import com.aglyn.ui.space
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch

/*
 * A site's bookable services, as the console's Services card keeps them:
 * add one (through the quota-checked resources route), edit it in the
 * service dialog, offer a draft or withdraw a live one, and delete it.
 */

private const val NEW = "new"

/** How each way of stating the price reads in the dialog's picker. */
private fun priceDisplayLabel(display: BookingPriceDisplay): String =
  if (display == BookingPriceDisplay.FIXED) "The price" else Contracts.bookingPriceLabels[display.raw] ?: display.raw

private fun askLabel(ask: BookingFieldAsk): String = when (ask) {
  BookingFieldAsk.OPTIONAL -> "Optional"
  BookingFieldAsk.REQUIRED -> "Required"
  else -> "Don't ask"
}

private fun hoursOf(draft: BookingServiceDraft): List<List<HoursWindow>> =
  draft.windowText.map { text -> parseBookingWindows(text).map { HoursWindow(it.start.toInt(), it.end.toInt()) } }

private fun withHours(draft: BookingServiceDraft, days: List<List<HoursWindow>>): BookingServiceDraft =
  draft.copy(windowText = days.map { list -> formatBookingWindows(list.map { BookingWindow(end = it.end.toLong(), start = it.start.toLong()) }) })

@Composable
fun BookingServicesScreen(context: NativePluginContext) {
  val hostId = context.hostId ?: return
  val live = liveServices(context)
  val api = remember(hostId, context.api, context.writer) { BookingsApi(context.api, context.writer, hostId) }
  val scope = rememberCoroutineScope()
  var notice by remember { mutableStateOf<Pair<String, StatusTone>?>(null) }
  var deleting by remember { mutableStateOf<ServiceRow?>(null) }
  var busy by remember { mutableStateOf(false) }

  fun run(done: String, action: suspend () -> Unit) {
    busy = true
    notice = null
    scope.launch {
      try {
        action()
        notice = done to StatusTone.SUCCESS
      } catch (error: CancellationException) {
        throw error
      } catch (error: Throwable) {
        notice = (error.message ?: "That did not save. Try again.") to StatusTone.ERROR
      } finally {
        busy = false
      }
    }
  }

  AglynListDetail(
    modifier = Modifier.testTag("booking-services"),
    list = { selected, onSelect ->
      Column(Modifier.fillMaxSize()) {
        Row(Modifier.fillMaxWidth().padding(horizontal = space(2f), vertical = space(1f)), verticalAlignment = Alignment.CenterVertically) {
          Text("Services", Modifier.weight(1f), style = MaterialTheme.typography.titleSmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
          Button(onClick = { onSelect(NEW) }, modifier = Modifier.testTag("add-service")) {
            Icon(AglynIcons.named("add"), contentDescription = null)
            Text("Add service", Modifier.padding(start = space(1f)))
          }
        }
        notice?.let { (message, tone) ->
          NoticeBanner(message, tone, Modifier.padding(horizontal = space(2f)), action = { TextButton(onClick = { notice = null }) { Text("Dismiss") } })
        }
        when (live) {
          Live.Loading -> SkeletonList(rows = 3)
          is Live.Failed -> EmptyState("Could not load this site's services", body = "Check the connection and try again.", icon = AglynIcons.named("error"))
          is Live.Ready -> LazyColumn(Modifier.fillMaxSize().testTag("services-list")) {
            if (live.value.isEmpty()) {
              item { EmptyState("No services yet", body = "Add a service visitors can book, with the hours it is open.", icon = AglynIcons.named("design_services")) }
            }
            items(live.value, key = { it.id }) { service ->
              AglynListItem(
                title = service.name,
                supporting = "${service.durationMinutes} min · ${service.priceText} · ${service.timeZone}",
                icon = AglynIcons.named("event_available"),
                selected = service.id == selected,
                trailing = { if (service.draft) StatusChip("Draft", StatusTone.WARNING) },
                onClick = { onSelect(service.id) },
                modifier = Modifier.testTag("service-${service.id}"),
              )
            }
          }
        }
      }
    },
    detail = { selected ->
      val services = (live as? Live.Ready)?.value.orEmpty()
      when {
        selected == null -> EmptyState("Pick a service to see it here", icon = AglynIcons.named("design_services"))
        selected == NEW -> ServiceEditor(
          initial = remember { newBookingServiceDraft(deviceTimeZone()) },
          isNew = true,
          busy = busy,
          onSave = { draft -> run("Service saved.") { api.createService(draft) } },
        )
        else -> {
          val service = services.firstOrNull { it.id == selected }
          if (service == null) {
            EmptyState("This service is gone", icon = AglynIcons.named("design_services"))
          } else {
            ServiceEditor(
              initial = remember(service.raw) { bookingServiceDraftFrom(service.raw) },
              isNew = false,
              busy = busy,
              draft = service.draft,
              onSave = { draft -> run("Service saved.") { api.saveService(service.id, draft) } },
              onToggleActive = { run(if (service.draft) "${service.name} now takes bookings." else "${service.name} is a draft again; it takes no new bookings.") { api.setServiceActive(service.id, service.draft) } },
              onDelete = { deleting = service },
            )
          }
        }
      }
    },
  )
  deleting?.let { service ->
    ActionDialog(
      title = "Delete this service?",
      body = "${service.name} stops taking bookings. Bookings it already has stay.",
      confirmLabel = "Delete",
      destructive = true,
      icon = "delete",
      busy = busy,
      onDismiss = { deleting = null },
      onConfirm = {
        deleting = null
        run("${service.name} was deleted.") { api.deleteService(service.id) }
      },
    )
  }
}

/** The service dialog: every field the console's has, with hours as an editor rather than text. */
@OptIn(ExperimentalLayoutApi::class)
@Composable
private fun ServiceEditor(
  initial: BookingServiceDraft,
  isNew: Boolean,
  busy: Boolean,
  onSave: (BookingServiceDraft) -> Unit,
  draft: Boolean = false,
  onToggleActive: (() -> Unit)? = null,
  onDelete: (() -> Unit)? = null,
) {
  var form by remember(initial) { mutableStateOf(initial) }
  val problem = bookingServiceDraftProblem(form.name)
  Box(Modifier.fillMaxSize(), contentAlignment = Alignment.TopCenter) {
    Column(
      Modifier.widthIn(max = 760.dp).fillMaxWidth().verticalScroll(rememberScrollState()).padding(space(2f)).testTag("service-editor"),
      verticalArrangement = Arrangement.spacedBy(space(2f)),
    ) {
      Row(verticalAlignment = Alignment.CenterVertically) {
        Text(if (isNew) "New service" else form.name.ifBlank { "Service" }, Modifier.weight(1f).semantics { heading() }, style = MaterialTheme.typography.titleLarge)
        if (!isNew) StatusChip(if (draft) "Draft" else "Taking bookings", if (draft) StatusTone.WARNING else StatusTone.SUCCESS)
      }
      if (draft) {
        NoticeBanner("A draft is offered nowhere until it is turned on.", StatusTone.WARNING)
      }
      SectionCard("Service", Modifier.fillMaxWidth()) {
        OutlinedTextField(
          form.name,
          { form = form.copy(name = it.take(Contracts.bookingServiceNameMax.toInt())) },
          label = { Text("Name") },
          singleLine = true,
          isError = problem != null && form.name.isNotEmpty(),
          modifier = Modifier.fillMaxWidth().testTag("service-name"),
        )
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          OutlinedTextField(
            form.durationMinutes,
            { form = form.copy(durationMinutes = it.filter(Char::isDigit).take(3)) },
            label = { Text("Minutes") },
            supportingText = { Text("5 to 480") },
            singleLine = true,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
            modifier = Modifier.weight(1f).testTag("service-duration"),
          )
          OutlinedTextField(
            form.priceUsd,
            { form = form.copy(priceUsd = it.filter { c -> c.isDigit() || c == '.' }.take(7)) },
            label = { Text("Price (USD)") },
            supportingText = { Text("Whole dollars") },
            singleLine = true,
            enabled = form.priceDisplay == BookingPriceDisplay.FIXED,
            keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Decimal),
            modifier = Modifier.weight(1f).testTag("service-price"),
          )
        }
        Text("Show the price as", style = MaterialTheme.typography.labelLarge)
        ChoiceChipRow(
          options = Contracts.bookingPriceDisplays.filter { it != BookingPriceDisplay.UNKNOWN }.map { ChipOption(it.raw, priceDisplayLabel(it)) },
          selected = form.priceDisplay.raw,
          onSelect = { raw -> form = form.copy(priceDisplay = BookingPriceDisplay.entries.first { it.raw == raw }) },
          wrap = true,
          modifier = Modifier.testTag("service-price-display"),
        )
        TimeZoneField(form.timezone) { form = form.copy(timezone = it) }
        OutlinedTextField(
          form.description,
          { form = form.copy(description = it.take(Contracts.bookingServiceDescriptionMax.toInt())) },
          label = { Text("Description (optional)") },
          minLines = 2,
          modifier = Modifier.fillMaxWidth().testTag("service-description"),
        )
      }
      SectionCard("Hours", Modifier.fillMaxWidth()) {
        Text(
          "When it can be booked each week, on the service's clock (${form.timezone}).",
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        WeeklyHoursEditor(Contracts.bookingWeekdays, hoursOf(form), { form = withHours(form, it) })
      }
      SectionCard("What the booker is asked", Modifier.fillMaxWidth()) {
        for ((label, ask, set) in listOf(
          Triple("Phone", form.askPhone) { value: BookingFieldAsk -> form = form.copy(askPhone = value) },
          Triple("Address", form.askAddress) { value: BookingFieldAsk -> form = form.copy(askAddress = value) },
        )) {
          Text(label, style = MaterialTheme.typography.labelLarge)
          ChoiceChipRow(
            options = Contracts.bookingFieldAsks.filter { it != BookingFieldAsk.UNKNOWN }.map { ChipOption(it.raw, askLabel(it)) },
            selected = ask.raw,
            onSelect = { raw -> set(BookingFieldAsk.entries.first { it.raw == raw }) },
            modifier = Modifier.testTag("service-ask-${label.lowercase()}"),
          )
        }
      }
      SectionCard("CRM", Modifier.fillMaxWidth()) {
        SwitchRow(
          "Log a meeting on the contact",
          form.crmMeetingActivity,
          { form = form.copy(crmMeetingActivity = it) },
          supporting = "Each booking shows on the booker's record as a meeting.",
          modifier = Modifier.testTag("service-crm-meeting"),
        )
        HorizontalDivider()
        SwitchRow(
          "Add a follow-up task",
          form.crmFollowUpTask,
          { form = form.copy(crmFollowUpTask = it) },
          supporting = "A task to follow up after the appointment.",
          modifier = Modifier.testTag("service-crm-task"),
        )
      }
      FlowRow(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalArrangement = Arrangement.spacedBy(space(1f))) {
        Button(onClick = { onSave(form) }, enabled = problem == null && !busy, modifier = Modifier.heightIn(min = 44.dp).testTag("service-save")) {
          Text(if (isNew) "Add service" else "Save service")
        }
        onToggleActive?.let {
          OutlinedButton(onClick = it, enabled = !busy, modifier = Modifier.testTag("service-toggle")) { Text(if (draft) "Turn on" else "Turn off") }
        }
        onDelete?.let {
          TextButton(onClick = it, enabled = !busy, modifier = Modifier.testTag("service-delete")) { Text("Delete", color = MaterialTheme.colorScheme.error) }
        }
      }
    }
  }
}

/** A zone picked from the platform's list, filtered as it is typed. */
@Composable
private fun TimeZoneField(value: String, onChange: (String) -> Unit) {
  var open by remember { mutableStateOf(false) }
  var query by remember(value) { mutableStateOf(value) }
  val zones = remember { knownTimeZones() }
  Box {
    OutlinedTextField(
      query,
      { query = it; open = true },
      label = { Text("Time zone") },
      singleLine = true,
      trailingIcon = { Icon(AglynIcons.named("schedule"), contentDescription = null) },
      modifier = Modifier.fillMaxWidth().testTag("service-timezone"),
    )
    DropdownMenu(expanded = open, onDismissRequest = { open = false; query = value }) {
      zones.filter { it.contains(query.trim(), ignoreCase = true) }.take(30).forEach { zone ->
        DropdownMenuItem(text = { Text(zone) }, onClick = { onChange(zone); query = zone; open = false })
      }
    }
  }
}
