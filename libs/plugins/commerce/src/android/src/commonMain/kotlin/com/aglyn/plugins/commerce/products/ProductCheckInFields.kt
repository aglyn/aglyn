package com.aglyn.plugins.commerce.products

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.contracts.ProductCheckIn
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.ChipOption
import com.aglyn.ui.ChoiceChipRow
import com.aglyn.ui.UpgradeKind
import com.aglyn.ui.UpgradeNotice
import com.aglyn.ui.space

/**
 * The product editor's Check-in (AGL-4063), as the console's `ProductCheckInFields` has it behind the point of sale:
 * whether each one sold is somebody to check in on the day it is for, how many people one admits, whether an online
 * buyer picks the day, and each variant's own choice. A plan without the point of sale reads the console's upsell.
 */
@Composable
internal fun ProductCheckInFields(context: NativePluginContext, draft: ProductDraft, change: (ProductDraft) -> Unit) {
  val hostId = context.hostId ?: return
  var carried by remember(hostId) { mutableStateOf<Boolean?>(null) }
  LaunchedEffect(hostId) { carried = productCheckInCarried(context.api, hostId) }
  when (carried) {
    false -> UpgradeNotice(productCheckInUpsell(), UpgradeKind.PLAN, Modifier.testTag("product-check-in-upsell")) {
      context.navigate("core.billing.plans")
    }
    true -> CheckInFields(draft, change)
    null -> Unit
  }
}

@Composable
private fun CheckInFields(draft: ProductDraft, change: (ProductDraft) -> Unit) {
  val checkIn = draft.checkIn
  val needs = productNeedsCheckIn(checkIn)
  fun set(next: ProductCheckIn) = change(draft.copy(checkIn = next))
  fun setVariant(index: Int, next: ProductCheckIn?) =
    change(draft.copy(variants = draft.variants.toMutableList().also { it[index] = it[index].copy(checkIn = next) }))
  Text("Check-in", style = MaterialTheme.typography.titleSmall, modifier = Modifier.semantics { heading() })
  LabeledSwitch("Needs check-in", PRODUCT_CHECK_IN_HELP, needs, "product-needs-check-in") { set(productCheckInSwitched(checkIn, it)) }
  if (needs) {
    HeadcountField(productCheckInHeadcount(checkIn), productCheckInHeadcountHelp(checkIn), "product-check-in-headcount") {
      set(productCheckInHeadcountTyped(checkIn, it))
    }
    LabeledSwitch("Ask the buyer which day", productCheckInUseDayHelp(checkIn), checkIn?.askUseDate == true, "product-check-in-ask-day") {
      set(productCheckInAskUseDateSwitched(checkIn, it))
    }
  }
  if (draft.variants.size > 1) {
    draft.variants.forEachIndexed { index, variant ->
      val own = variant.checkIn
      val choice = variantCheckInChoice(own)
      Column(verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
        Text(variant.label, style = MaterialTheme.typography.labelMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
        ChoiceChipRow(
          options = VariantCheckInChoice.entries.map { ChipOption(it.name.lowercase(), variantCheckInChoiceLabel(it, needs)) },
          selected = choice.name.lowercase(),
          onSelect = { key -> setVariant(index, variantCheckInPicked(VariantCheckInChoice.valueOf(key.uppercase()), own, checkIn)) },
          modifier = Modifier.testTag("variant-check-in-$index"),
          wrap = true,
        )
        if (choice == VariantCheckInChoice.ON) {
          Column(Modifier.padding(start = space(2f)), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
            HeadcountField(variantCheckInHeadcount(own), null, "variant-check-in-headcount-$index") { setVariant(index, variantCheckInHeadcountTyped(own, it)) }
            LabeledSwitch("Ask which day", null, own?.askUseDate == true, "variant-check-in-ask-day-$index") {
              setVariant(index, variantCheckInAskUseDateSwitched(own, it))
            }
          }
        }
      }
    }
  }
}

/** A switch with its title and the words under it, as the editor's other switches are drawn. */
@Composable
private fun LabeledSwitch(title: String, help: String?, checked: Boolean, tag: String, onChange: (Boolean) -> Unit) {
  Row(verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) {
      Text(title)
      help?.let { Text(it, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }
    }
    Switch(checked, onChange, Modifier.testTag(tag))
  }
}

/**
 * People per item: what was typed stays in the field while it is being typed (an emptied field reads as 1 in the draft,
 * as the console reads it); the draft always holds a whole number from 1 to the ceiling.
 */
@Composable
private fun HeadcountField(value: Int, help: String?, tag: String, onChange: (String) -> Unit) {
  var text by remember(tag) { mutableStateOf(value.toString()) }
  if (text.isNotEmpty() && text != value.toString()) text = value.toString()
  OutlinedTextField(
    text,
    { typed -> text = typed.filter(Char::isDigit); onChange(text) },
    label = { Text("People per item") },
    supportingText = help?.let { { Text(it) } },
    singleLine = true,
    keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Number),
    modifier = Modifier.fillMaxWidth().testTag(tag),
  )
}
