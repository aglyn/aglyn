package com.aglyn.plugins.marketplace

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.heading
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import com.aglyn.contracts.orgPermissionLabel
import com.aglyn.pluginhost.NativePluginContext
import com.aglyn.ui.NoticeBanner
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.StatusTone
import com.aglyn.ui.TextButton
import com.aglyn.ui.space
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.launch

/**
 * Paying for a listing, in place under the Buy button (`MarketplacePayPanel`): the total before Pay, a card or an address
 * when one is missing, who can add it when this person cannot, and the bank's step. Nothing here is a dialog, as the
 * console's panel is none. Figma: NrDk4KvvasUKUcramPMwU5, "Buying a paid listing".
 */
@Composable
fun MarketplacePayPanel(context: NativePluginContext, pay: MarketplacePay) {
  val step = pay.step ?: return
  val scope = rememberCoroutineScope()
  val name = pay.listing?.second ?: "this listing"
  val billing = orgPermissionLabel("billing.manage")
  // A secure browser tab does not say when it closes: the window coming back into focus does.
  val window = LocalWindowInfo.current
  LaunchedEffect(pay, window) {
    snapshotFlow { window.isWindowFocused }.drop(1).filter { it && pay.away }.collect { pay.backFromStripe() }
  }
  Column(Modifier.fillMaxWidth().testTag("marketplace-pay"), verticalArrangement = Arrangement.spacedBy(space(1.5f))) {
    when (step) {
      is PayStep.Confirm -> {
        val quote = step.quote
        PayTitle("Buy ${quote.listingName}")
        Column(Modifier.testTag("marketplace-pay-summary"), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
          SummaryLine("Price", formatPayCents(quote.amountCents))
          SummaryLine("Sales tax", formatPayCents(quote.taxCents))
          HorizontalDivider()
          SummaryLine("Total", formatPayCents(quote.totalCents), strong = true)
        }
        if (quote.canPay) {
          PayHint("Charged to ${payCardLabel(quote.card)}. The receipt lands in Billing.")
          // A card that will not pay is changed in Billing: the way there is beside the reason.
          pay.error?.let {
            NoticeBanner(it, StatusTone.WARNING, Modifier.testTag("marketplace-pay-error"), action = {
              TextButton(onClick = { context.navigate("core.billing.settings") }) { Text("Open Billing") }
            })
          }
          Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            Button(onClick = { scope.launch { pay.pay() } }, enabled = !pay.busy, modifier = Modifier.testTag("marketplace-pay-confirm")) {
              Text(if (pay.busy) "Paying…" else "Pay ${formatPayCents(quote.totalCents)}")
            }
            PayCancel(pay)
          }
        } else {
          NoticeBanner(
            "Buying this charges your workspace's card, which takes the \"$billing\" permission. Ask someone who manages billing to buy it.",
            StatusTone.WARNING,
          )
          PayCancel(pay, "Close")
        }
      }
      PayStep.Card -> {
        PayTitle("Add a card to buy $name")
        PayHint("It stays on file for this workspace, in Billing, where you can change or remove it.")
        PayFailure(pay)
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
          Button(onClick = { scope.launch { pay.addCard() } }, enabled = !pay.busy, modifier = Modifier.testTag("marketplace-pay-add-card")) {
            Text(if (pay.busy) "Opening…" else "Add a card on Stripe")
          }
          if (pay.away) {
            OutlinedButton(onClick = { scope.launch { pay.backFromStripe() } }, enabled = !pay.busy) { Text("Check again") }
          }
          PayCancel(pay)
        }
      }
      PayStep.Address -> {
        PayTitle("Add a billing address")
        PayHint("Sales tax is calculated from it. It stays on file for this workspace, in Billing.")
        PayFailure(pay)
        var address by remember { mutableStateOf(PayBillingAddress()) }
        Column(Modifier.testTag("marketplace-pay-address"), verticalArrangement = Arrangement.spacedBy(space(1f))) {
          AddressField("Name on invoices", address.name) { address = address.copy(name = it) }
          AddressField("Address", address.line1) { address = address.copy(line1 = it) }
          AddressField("Address line 2", address.line2) { address = address.copy(line2 = it) }
          AddressField("City", address.city) { address = address.copy(city = it) }
          AddressField("State or region", address.state) { address = address.copy(state = it) }
          AddressField("Postal code", address.postalCode) { address = address.copy(postalCode = it) }
          AddressField("Country (2 letters)", address.country, placeholder = "US", capitals = true) { address = address.copy(country = it.take(2)) }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
          Button(
            onClick = { scope.launch { pay.saveAddress(address) } },
            enabled = !pay.busy && address.complete,
            modifier = Modifier.testTag("marketplace-pay-save-address"),
          ) { Text(if (pay.busy) "Saving…" else "Save address") }
          PayCancel(pay)
        }
      }
      is PayStep.AskBilling -> {
        step.amountCents?.let { SummaryLine("Price", formatPayCents(it)) }
        NoticeBanner(
          (if (step.need == PayPrerequisite.CARD_REQUIRED) "This workspace needs a card on file to buy this."
          else "This workspace needs a billing address to buy this: sales tax is calculated from it.") +
            " Someone with the \"$billing\" permission can add it in Billing.",
          StatusTone.WARNING,
        )
        PayCancel(pay, "Close")
      }
      PayStep.Bank -> {
        PayTitle("Your bank needs to confirm")
        Row(Modifier.testTag("marketplace-pay-bank"), horizontalArrangement = Arrangement.spacedBy(space(1f)), verticalAlignment = Alignment.CenterVertically) {
          if (pay.busy) CircularProgressIndicator(Modifier.size(16.dp), strokeWidth = 2.dp)
          PayHint("Finish it on the invoice page we just opened; it is yours once it is paid.")
        }
        PayFailure(pay)
        if (pay.away) {
          Row(horizontalArrangement = Arrangement.spacedBy(space(1f))) {
            Button(onClick = { scope.launch { pay.backFromStripe() } }, enabled = !pay.busy) { Text("Check the payment") }
            PayCancel(pay)
          }
        }
      }
    }
  }
}

@Composable
private fun SummaryLine(label: String, value: String, strong: Boolean = false) {
  val style = if (strong) MaterialTheme.typography.titleSmall else MaterialTheme.typography.bodyMedium
  Row(Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) {
    Text(label, style = style)
    Text(value, style = style)
  }
}

@Composable
private fun AddressField(label: String, value: String, placeholder: String? = null, capitals: Boolean = false, onChange: (String) -> Unit) {
  OutlinedTextField(
    value, onChange, label = { Text(label) }, singleLine = true,
    placeholder = placeholder?.let { { Text(it) } },
    keyboardOptions = KeyboardOptions(capitalization = if (capitals) KeyboardCapitalization.Characters else KeyboardCapitalization.Words),
    modifier = Modifier.fillMaxWidth().testTag("marketplace-pay-address-$label"),
  )
}

@Composable
private fun PayTitle(text: String) = Text(text, Modifier.semantics { heading() }, style = MaterialTheme.typography.titleSmall)

@Composable
private fun PayHint(text: String) = Text(text, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)

@Composable
private fun PayFailure(pay: MarketplacePay) {
  pay.error?.let { NoticeBanner(it, StatusTone.WARNING, Modifier.testTag("marketplace-pay-error")) }
}

@Composable
private fun PayCancel(pay: MarketplacePay, label: String = "Cancel") = TextButton(onClick = pay::cancel, enabled = !pay.busy) { Text(label) }
