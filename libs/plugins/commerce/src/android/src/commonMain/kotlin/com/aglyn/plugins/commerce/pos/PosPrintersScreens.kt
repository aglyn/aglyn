package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.text.selection.SelectionContainer
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.SideEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableDoubleStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.PrinterBrand
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.AglynIconButton
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.Busy
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.EmptyState
import com.aglyn.ui.FormSheet
import com.aglyn.ui.MenuAction
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.OverflowMenu
import com.aglyn.ui.SectionCard
import com.aglyn.ui.SelectField
import com.aglyn.ui.SelectOption
import com.aglyn.ui.SkeletonList
import com.aglyn.ui.StatusChip
import com.aglyn.ui.StatusTone
import com.aglyn.ui.SwitchRow
import com.aglyn.ui.TextButton
import com.aglyn.ui.WidthClass
import com.aglyn.ui.WithTooltip
import com.aglyn.ui.currentWidthClass
import com.aglyn.ui.space
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

/*
 * The register's receipt printers on screen (AGL-3909): each printer's state
 * and last poll, Test print, Open drawer, its settings and URL, Remove, and
 * Add printer, which answers the URL to paste into the printer with the
 * brand's setup steps. A full-screen panel on a phone, a large panel on a
 * tablet, opened from the Register sheet.
 */

/** The register's printers in a panel of their own. */
@Composable
fun ReceiptPrintersDialog(model: PosPrintersModel, registerName: String?, onDismiss: () -> Unit) {
  val compact = currentWidthClass() == WidthClass.COMPACT
  var adding by remember { mutableStateOf(false) }
  var editing by remember { mutableStateOf<PosPrinterRow?>(null) }
  var removing by remember { mutableStateOf<PosPrinterRow?>(null) }
  // A printer's state ages into Offline while the panel is open.
  var now by remember { mutableDoubleStateOf(nowMs().toDouble()) }
  LaunchedEffect(Unit) {
    while (true) {
      delay(30_000)
      now = nowMs().toDouble()
    }
  }
  LaunchedEffect(model.notice) {
    if (model.notice != null) {
      delay(4_000)
      model.notice = null
    }
  }
  fun startAdding() {
    model.error = null
    adding = true
  }

  Dialog(onDismissRequest = onDismiss, properties = DialogProperties(usePlatformDefaultWidth = false)) {
    Surface(
      if (compact) Modifier.fillMaxSize() else Modifier.widthIn(max = 720.dp).fillMaxWidth(0.94f).heightIn(max = 900.dp).fillMaxHeight(0.92f),
      shape = if (compact) MaterialTheme.shapes.extraSmall else MaterialTheme.shapes.extraLarge,
      color = MaterialTheme.colorScheme.surface,
    ) {
      Column(Modifier.testTag("pos-printers")) {
        Row(
          Modifier.fillMaxWidth().padding(start = space(1f), end = space(2f), top = space(1f), bottom = space(1f)),
          verticalAlignment = Alignment.CenterVertically,
          horizontalArrangement = Arrangement.spacedBy(space(1f)),
        ) {
          AglynIconButton(AglynIcons.named("close"), "Close", onDismiss, Modifier.testTag("pos-printers-close"))
          Column(Modifier.weight(1f)) {
            Text("Receipt printers", Modifier.semantics { heading() }, style = MaterialTheme.typography.titleLarge)
            registerName?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
          }
          if (model.rows.isNotEmpty()) {
            Button(onClick = ::startAdding, enabled = model.registerId != null && !model.busy, modifier = Modifier.testTag("printer-add")) {
              Icon(AglynIcons.named("add"), null, Modifier.size(18.dp))
              Spacer(Modifier.size(space(1f)))
              Text("Add printer")
            }
          }
        }
        HorizontalDivider()
        Box(Modifier.fillMaxSize()) {
          when {
            !model.ready -> Box(Modifier.padding(space(2f))) { SkeletonList(rows = 2) }
            model.rows.isEmpty() -> Column(Modifier.fillMaxSize()) {
              // "Counter printer removed" is still said when it was the last one.
              model.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, Modifier.padding(space(2f)).testTag("printer-notice")) }
              model.error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.padding(space(2f))) }
              EmptyState(
                "No receipt printer yet",
                body = "Pair a Star CloudPRNT or Epson Server Direct Print printer to print receipts from this register on any device, with no driver, and to open its cash drawer on cash sales.",
                icon = AglynIcons.named("print"),
                action = {
                  Button(onClick = ::startAdding, enabled = model.registerId != null && !model.busy, modifier = Modifier.testTag("printer-add")) {
                    Text("Add printer")
                  }
                },
              )
            }
            else -> Column(
              Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(space(2f)),
              verticalArrangement = Arrangement.spacedBy(space(1.5f)),
            ) {
              model.notice?.let { NoticeBanner(it, StatusTone.SUCCESS, Modifier.testTag("printer-notice")) }
              if (!adding && editing == null) model.error?.let { NoticeBanner(it, StatusTone.ERROR, Modifier.testTag("printer-error")) }
              model.rows.forEach { row ->
                PrinterCard(
                  row,
                  now,
                  busy = model.busy,
                  onTest = { model.send("test", row) },
                  onDrawer = { model.send("drawer", row) },
                  onSettings = {
                    model.error = null
                    editing = row
                  },
                  onRemove = { removing = row },
                )
              }
            }
          }
        }
      }
    }
  }

  if (adding) PrinterFormSheet(model, editing = null) { adding = false }
  editing?.let { row -> PrinterFormSheet(model, editing = row) { editing = null } }
  removing?.let { row ->
    ActionDialog(
      title = "Remove ${row.name}?",
      body = "Its URL stops working and anything it has not printed is canceled.",
      confirmLabel = "Remove",
      destructive = true,
      busy = model.busy,
      onDismiss = { removing = null },
      onConfirm = {
        removing = null
        model.remove(row)
      },
    )
  }
}

/** One printer: its name, what it does, its state, when it last polled, and its actions. */
@Composable
private fun PrinterCard(
  row: PosPrinterRow,
  nowMs: Double,
  busy: Boolean,
  onTest: () -> Unit,
  onDrawer: () -> Unit,
  onSettings: () -> Unit,
  onRemove: () -> Unit,
) {
  val (label, tone) = printerStateChip(printerDisplayState(row.statusState, row.statusAtMs, nowMs))
  SectionCard(null, Modifier.fillMaxWidth().testTag("printer-${row.id}")) {
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1.5f))) {
      Box(
        Modifier.size(40.dp).clip(CircleShape).background(MaterialTheme.colorScheme.primaryContainer),
        contentAlignment = Alignment.Center,
      ) { Icon(AglynIcons.named("print"), null, Modifier.size(22.dp), tint = MaterialTheme.colorScheme.onPrimaryContainer) }
      Column(Modifier.weight(1f)) {
        Text(row.name, style = MaterialTheme.typography.titleMedium, maxLines = 2)
        Text(printerSummary(row), style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      StatusChip(label, tone, Modifier.testTag("printer-state-${row.id}"))
    }
    Text(printerSeenLine(row, nowMs), style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      FlowRow(Modifier.weight(1f), horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        OutlinedButton(onClick = onTest, enabled = !busy, modifier = Modifier.testTag("printer-test-${row.id}")) { Text("Test print") }
        if (row.kickDrawer) {
          OutlinedButton(onClick = onDrawer, enabled = !busy, modifier = Modifier.testTag("printer-drawer-${row.id}")) { Text("Open drawer") }
        }
      }
      OverflowMenu(
        listOf(
          MenuAction("printer-settings", "Settings and URL", icon = "settings", enabled = !busy, onClick = onSettings),
          MenuAction("printer-remove", "Remove", icon = "delete", destructive = true, enabled = !busy, onClick = onRemove),
        ),
        contentDescription = "More for ${row.name}",
      )
    }
  }
}

/** Add printer (then its URL and setup steps), or a printer's settings and URL. */
@Composable
private fun PrinterFormSheet(model: PosPrintersModel, editing: PosPrinterRow?, onDismiss: () -> Unit) {
  val scope = rememberCoroutineScope()
  val adding = editing == null
  var draft by remember(editing?.id) { mutableStateOf(editing?.let(PrinterDraft::of) ?: PrinterDraft()) }
  var credentials by remember(editing?.id) { mutableStateOf<PrinterCredentials?>(null) }
  var regenerating by remember { mutableStateOf(false) }
  val busy = remember { Busy() }
  LaunchedEffect(editing?.id) {
    if (editing != null) credentials = model.credentials(editing)
  }
  // The sheet's own refusal shows in the sheet, not behind it. Read here, in composition, so a refusal recomposes the sheet.
  val busyNow = model.busy
  val errorNow = model.error
  SideEffect {
    busy.busy = busyNow
    busy.error = errorNow
  }
  val connecting = adding && credentials != null

  FormSheet(
    title = when {
      connecting -> "Connect the printer"
      adding -> "Add printer"
      else -> "Printer settings"
    },
    busy = busy,
    onDismiss = {
      model.error = null
      onDismiss()
    },
    onConfirm = {
      when {
        connecting -> onDismiss()
        editing != null -> scope.launch { if (model.save(editing, draft)) onDismiss() }
        else -> scope.launch { model.add(draft)?.let { credentials = it } }
      }
    },
    confirmLabel = when {
      connecting -> "Done"
      adding -> "Add printer"
      else -> "Save"
    },
    confirmEnabled = connecting || draft.complete,
    modifier = Modifier.testTag("printer-form"),
  ) {
    if (!connecting) PrinterFields(draft, adding) { draft = it }
    credentials?.let { ConnectSection(it, canRegenerate = !adding, onCopied = { model.notice = "URL copied" }) { regenerating = true } }
  }

  if (regenerating && editing != null) {
    ActionDialog(
      title = "Regenerate the URL?",
      body = "The printer stops printing until the new URL is pasted into it.",
      confirmLabel = "Regenerate",
      destructive = true,
      busy = model.busy,
      onDismiss = { regenerating = false },
      onConfirm = {
        scope.launch {
          model.regenerate(editing)?.let { credentials = it }
          regenerating = false
        }
      },
    )
  }
}

@Composable
private fun PrinterFields(draft: PrinterDraft, adding: Boolean, onChange: (PrinterDraft) -> Unit) {
  val star = draft.brand == PrinterBrand.STAR.raw
  if (adding) {
    SelectField(
      "Brand",
      Contracts.printerBrands.filter { it != PrinterBrand.UNKNOWN }.map { SelectOption(it.raw, Contracts.printerBrandLabels[it.raw] ?: it.raw) },
      draft.brand,
      onSelect = { brand -> brand?.let { onChange(draft.copy(brand = it)) } },
      modifier = Modifier.fillMaxWidth().testTag("printer-brand"),
    )
  }
  OutlinedTextField(
    draft.name, { onChange(draft.copy(name = it)) }, label = { Text("Name") }, placeholder = { Text("Counter printer") },
    singleLine = true, modifier = Modifier.fillMaxWidth().testTag("printer-name"),
  )
  ModelField(draft, onChange)
  OutlinedTextField(
    draft.deviceId, { onChange(draft.copy(deviceId = it)) },
    label = { Text(if (star) "MAC address" else "Server Direct Print ID") },
    supportingText = {
      Text(if (star) "The Ethernet MAC on the self-test print, even if the printer uses Wi-Fi." else "Any ID you choose (letters, digits, - _ .), entered again in WebConfig.")
    },
    singleLine = true, modifier = Modifier.fillMaxWidth().testTag("printer-device"),
  )
  Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    Text("Paper", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
    ChoiceChipRow(
      listOf(ChipOption("80", "80 mm"), ChipOption("58", "58 mm")),
      draft.paperWidthMm.toString(),
      onSelect = { onChange(draft.copy(paperWidthMm = it.toInt())) },
      modifier = Modifier.testTag("printer-paper"),
    )
  }
  OutlinedTextField(
    draft.logoKey, { onChange(draft.copy(logoKey = it)) }, label = { Text("Stored logo (optional)") },
    supportingText = {
      Text(if (star) "The logo number saved in the printer with Star Quick Setup Utility." else "The key saved in the printer with Epson TM Utility, as two numbers.")
    },
    singleLine = true, modifier = Modifier.fillMaxWidth().testTag("printer-logo"),
  )
  SwitchRow("Print a receipt for every sale on this register", draft.autoPrintReceipts, { onChange(draft.copy(autoPrintReceipts = it)) }, Modifier.testTag("printer-auto"))
  SwitchRow("A cash drawer is plugged into this printer", draft.kickDrawer, { onChange(draft.copy(kickDrawer = it)) }, Modifier.testTag("printer-kick"))
  SwitchRow(
    "Print a kitchen ticket for every sale",
    draft.kitchenTickets,
    { onChange(draft.copy(kitchenTickets = it)) },
    Modifier.testTag("printer-kitchen"),
    supporting = "Items and quantities, no prices.",
  )
}

/** The model: typed, or one of the models we document and test against. */
@Composable
private fun ModelField(draft: PrinterDraft, onChange: (PrinterDraft) -> Unit) {
  val suggestions = Contracts.printerModelSuggestions[draft.brand].orEmpty()
  var open by remember { mutableStateOf(false) }
  OutlinedTextField(
    draft.model, { onChange(draft.copy(model = it)) }, label = { Text("Model") }, singleLine = true,
    modifier = Modifier.fillMaxWidth().testTag("printer-model"),
    trailingIcon = if (suggestions.isEmpty()) null else ({
      Box {
        AglynIconButton(AglynIcons.named("expand_more"), "Pick a model we document", { open = true }, Modifier.testTag("printer-models"))
        DropdownMenu(open, onDismissRequest = { open = false }) {
          suggestions.forEach { name ->
            DropdownMenuItem(text = { Text(name) }, onClick = { open = false; onChange(draft.copy(model = name)) })
          }
        }
      }
    }),
  )
}

/** The brand's setup steps, the URL to paste (and the Epson ID), Copy URL and Regenerate. */
@Composable
private fun ConnectSection(credentials: PrinterCredentials, canRegenerate: Boolean, onCopied: () -> Unit, onRegenerate: () -> Unit) {
  val clipboard = LocalClipboardManager.current
  val star = credentials.brand == PrinterBrand.STAR.raw
  SectionCard("Steps", Modifier.fillMaxWidth().testTag("printer-connect")) {
    printerSetupSteps(credentials.brand).forEachIndexed { index, step ->
      Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
        Text("${index + 1}.", style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(step, style = MaterialTheme.typography.bodyMedium)
      }
    }
  }
  SectionCard(if (star) "CloudPRNT Server URL" else "Server Direct Print URL", Modifier.fillMaxWidth()) {
    SelectionContainer {
      Text(credentials.pollUrl, style = MaterialTheme.typography.bodySmall.copy(fontFamily = FontFamily.Monospace), modifier = Modifier.testTag("printer-url"))
    }
    if (!star) credentials.deviceId?.let { id ->
      Text("ID", style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
      SelectionContainer { Text(id, style = MaterialTheme.typography.bodyLarge) }
    }
    Row(verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
      OutlinedButton(
        onClick = {
          clipboard.setText(AnnotatedString(credentials.pollUrl))
          onCopied()
        },
        modifier = Modifier.testTag("printer-copy-url"),
      ) {
        Icon(AglynIcons.named("content_copy"), null, Modifier.size(18.dp))
        Spacer(Modifier.size(space(1f)))
        Text("Copy URL")
      }
      if (canRegenerate) {
        Spacer(Modifier.weight(1f))
        WithTooltip("Make a new URL; the old one stops working") {
          TextButton(
            onClick = onRegenerate,
            colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
            modifier = Modifier.testTag("printer-regenerate"),
          ) { Text("Regenerate URL") }
        }
      }
    }
    Text(
      "This URL is the printer’s password: anyone with it can collect this register’s receipts. Regenerate it if it is ever shared.",
      style = MaterialTheme.typography.bodySmall,
      color = MaterialTheme.colorScheme.onSurfaceVariant,
    )
  }
}
