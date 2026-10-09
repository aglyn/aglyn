package com.aglyn.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.outlined.ArrowDropDown
import androidx.compose.material.icons.outlined.CalendarMonth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Checkbox
import androidx.compose.material3.DatePicker
import androidx.compose.material3.DatePickerDialog
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.rememberDatePickerState
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp

/*
 * Typed inputs for forms built from a schema (a dataset's record editor, a
 * filter's value): one choice from a list, several from a list, and a date
 * and time. Each reads and writes the same text a console input holds, so
 * the screen sends what the console would.
 */

/** One entry a choice input offers: the value it stores and the words it shows. */
data class InputChoice(val value: String, val label: String)

/**
 * One value from [choices], as a read-only field that opens a menu. An empty
 * [value] shows as [emptyLabel] (the console's "—"), and is offered first
 * when [allowEmpty].
 */
@Composable
fun ChoiceField(
  label: String,
  value: String,
  choices: List<InputChoice>,
  onChange: (String) -> Unit,
  modifier: Modifier = Modifier,
  supporting: String? = null,
  isError: Boolean = false,
  enabled: Boolean = true,
  allowEmpty: Boolean = true,
  emptyLabel: String = "—",
) {
  var open by remember { mutableStateOf(false) }
  val shown = choices.firstOrNull { it.value == value }?.label ?: value.ifEmpty { emptyLabel }
  Box(modifier.fillMaxWidth()) {
    OutlinedTextField(
      value = shown,
      onValueChange = {},
      readOnly = true,
      enabled = enabled,
      label = { Text(label) },
      isError = isError,
      supportingText = supporting?.let { { Text(it) } },
      trailingIcon = { Icon(Icons.Outlined.ArrowDropDown, contentDescription = null) },
      singleLine = true,
      modifier = Modifier.fillMaxWidth(),
    )
    // The whole field opens the menu; the text field itself takes no typing.
    Box(
      Modifier.matchParentSize().padding(top = 8.dp)
        .semantics { role = Role.DropdownList; contentDescription = "$label: $shown" }
        .clickable(enabled = enabled) { open = true },
    )
    DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.heightIn(max = 360.dp)) {
      if (allowEmpty) DropdownMenuItem(text = { Text(emptyLabel) }, onClick = { onChange(""); open = false })
      for (choice in choices) {
        DropdownMenuItem(
          text = { Text(choice.label) },
          onClick = { onChange(choice.value); open = false },
          modifier = Modifier.testTag("choice-${choice.value}"),
        )
      }
    }
  }
}

/** Several values from [choices] as a checked list in a menu; [values] in the order picked. */
@Composable
fun MultiChoiceField(
  label: String,
  values: List<String>,
  choices: List<InputChoice>,
  onChange: (List<String>) -> Unit,
  modifier: Modifier = Modifier,
  supporting: String? = null,
  isError: Boolean = false,
  enabled: Boolean = true,
) {
  var open by remember { mutableStateOf(false) }
  val shown = values.joinToString(", ") { value -> choices.firstOrNull { it.value == value }?.label ?: value }.ifEmpty { "—" }
  Box(modifier.fillMaxWidth()) {
    OutlinedTextField(
      value = shown,
      onValueChange = {},
      readOnly = true,
      enabled = enabled,
      label = { Text(label) },
      isError = isError,
      supportingText = supporting?.let { { Text(it) } },
      trailingIcon = { Icon(Icons.Outlined.ArrowDropDown, contentDescription = null) },
      modifier = Modifier.fillMaxWidth(),
    )
    Box(
      Modifier.matchParentSize().padding(top = 8.dp)
        .semantics { role = Role.DropdownList; contentDescription = "$label: $shown" }
        .clickable(enabled = enabled) { open = true },
    )
    DropdownMenu(expanded = open, onDismissRequest = { open = false }, modifier = Modifier.heightIn(max = 360.dp)) {
      for (choice in choices) {
        val checked = choice.value in values
        DropdownMenuItem(
          text = { Text(choice.label) },
          leadingIcon = { Checkbox(checked = checked, onCheckedChange = null) },
          onClick = { onChange(if (checked) values - choice.value else values + choice.value) },
        )
      }
    }
  }
}

/**
 * A date and time as `YYYY-MM-DDTHH:mm` in UTC, the text a console
 * `datetime-local` input holds for a stored instant: picked with the
 * platform's date picker, then its time picker. Typing it is allowed too.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateTimeField(
  label: String,
  value: String,
  onChange: (String) -> Unit,
  toMillis: (String) -> Long?,
  fromMillis: (Long) -> String,
  modifier: Modifier = Modifier,
  supporting: String? = null,
  isError: Boolean = false,
  enabled: Boolean = true,
) {
  var step by remember { mutableStateOf(0) }
  var pickedDay by remember { mutableStateOf<Long?>(null) }
  OutlinedTextField(
    value = value,
    onValueChange = onChange,
    enabled = enabled,
    label = { Text(label) },
    placeholder = { Text("YYYY-MM-DDTHH:mm") },
    isError = isError,
    supportingText = { Text(supporting ?: "UTC") },
    singleLine = true,
    trailingIcon = {
      androidx.compose.material3.IconButton(onClick = { step = 1 }, enabled = enabled) {
        Icon(Icons.Outlined.CalendarMonth, contentDescription = "Pick a date and time")
      }
    },
    modifier = modifier.fillMaxWidth(),
  )
  val current = toMillis(value)
  if (step == 1) {
    val state = rememberDatePickerState(initialSelectedDateMillis = current?.let { it - it.mod(86_400_000L) })
    DatePickerDialog(
      onDismissRequest = { step = 0 },
      confirmButton = {
        TextButton(onClick = { pickedDay = state.selectedDateMillis; step = if (state.selectedDateMillis != null) 2 else 0 }) { Text("Next") }
      },
      dismissButton = { TextButton(onClick = { step = 0 }) { Text("Cancel") } },
    ) { DatePicker(state) }
  }
  if (step == 2) {
    val ofDay = current?.mod(86_400_000L) ?: 0L
    val state = rememberTimePickerState(initialHour = (ofDay / 3_600_000L).toInt(), initialMinute = ((ofDay / 60_000L) % 60).toInt(), is24Hour = true)
    AlertDialog(
      onDismissRequest = { step = 0 },
      title = { Text("Time (UTC)") },
      text = { Column(horizontalAlignment = Alignment.CenterHorizontally, modifier = Modifier.verticalScroll(rememberScrollState())) { TimePicker(state) } },
      confirmButton = {
        TextButton(onClick = {
          val day = pickedDay
          if (day != null) onChange(fromMillis(day + state.hour * 3_600_000L + state.minute * 60_000L))
          step = 0
        }) { Text("Set") }
      },
      dismissButton = { TextButton(onClick = { step = 0 }) { Text("Cancel") } },
    )
  }
}

/**
 * A calendar day as `YYYY-MM-DD`, the text a console `date` input holds:
 * picked with the platform's date picker, or typed. [toMillis] and
 * [fromMillis] read and write the day as UTC midnight.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun DateField(
  label: String,
  value: String,
  onChange: (String) -> Unit,
  toMillis: (String) -> Long?,
  fromMillis: (Long) -> String,
  modifier: Modifier = Modifier,
  supporting: String? = null,
  enabled: Boolean = true,
) {
  var picking by remember { mutableStateOf(false) }
  OutlinedTextField(
    value = value,
    onValueChange = onChange,
    enabled = enabled,
    label = { Text(label) },
    placeholder = { Text("YYYY-MM-DD") },
    supportingText = supporting?.let { { Text(it) } },
    singleLine = true,
    trailingIcon = {
      androidx.compose.material3.IconButton(onClick = { picking = true }, enabled = enabled) {
        Icon(Icons.Outlined.CalendarMonth, contentDescription = "Pick a date")
      }
    },
    modifier = modifier.fillMaxWidth(),
  )
  if (picking) {
    val state = rememberDatePickerState(initialSelectedDateMillis = toMillis(value))
    DatePickerDialog(
      onDismissRequest = { picking = false },
      confirmButton = {
        TextButton(onClick = { state.selectedDateMillis?.let { onChange(fromMillis(it)) }; picking = false }) { Text("Set") }
      },
      dismissButton = { TextButton(onClick = { picking = false }) { Text("Cancel") } },
    ) { DatePicker(state) }
  }
}
