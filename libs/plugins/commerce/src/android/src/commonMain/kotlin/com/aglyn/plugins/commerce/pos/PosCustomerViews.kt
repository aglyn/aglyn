package com.aglyn.plugins.commerce.pos

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import com.aglyn.ui.ActionDialog
import com.aglyn.ui.OutlinedButton
import com.aglyn.ui.TextButton
import com.aglyn.ui.space

/*
 * THE CUSTOMER ROW (AGL-3609): beside the basket, search the workspace's
 * people, attach one to the sale and see what they have bought here, or add
 * a new one. The Apple app's `PosCustomerViews.swift`.
 */

@Composable
fun BasketCustomer(model: RegisterModel) {
  val customers = model.customers
  val attached = model.cart.customer
  Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(space(0.5f))) {
    if (attached != null) AttachedCustomer(model, attached) else CustomerSearch(model)
  }
  if (customers.adding) NewCustomerDialog(model)
}

@Composable
private fun AttachedCustomer(model: RegisterModel, customer: PosCustomer) {
  val customers = model.customers
  LaunchedEffect(customer.email) { customers.loadStats(customer.email) }
  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) {
      Text(customer.title, style = MaterialTheme.typography.titleSmall, modifier = Modifier.testTag("pos-customer-name"))
      if (customer.name.isNotEmpty() && customer.email != null) {
        Text(customer.email, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
      }
      customers.stats?.let { stats ->
        Text(
          if (stats.orderCount > 0) {
            "${stats.orderCount} past ${if (stats.orderCount == 1) "order" else "orders"} · ${money(stats.lifetimeSpendCents, model.currency)} spent"
          } else {
            "First order here"
          },
          style = MaterialTheme.typography.bodySmall,
          color = MaterialTheme.colorScheme.onSurfaceVariant,
          modifier = Modifier.testTag("pos-customer-stats"),
        )
      }
    }
    TextButton(onClick = { model.attachCustomer(null) }, modifier = Modifier.testTag("pos-customer-remove")) { Text("Remove") }
  }
  AttachedCustomerCheckIn(model, customer)
}

@Composable
private fun CustomerSearch(model: RegisterModel) {
  val customers = model.customers
  fun attach(customer: PosCustomer) {
    model.attachCustomer(customer)
    customers.clearSearch()
  }
  Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(space(1f))) {
    OutlinedTextField(
      value = customers.text,
      onValueChange = customers::type,
      label = { Text(if (customers.available) "Customer: name, email or phone" else "Customer: email for the receipt") },
      singleLine = true,
      keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
      keyboardActions = KeyboardActions(onDone = { if (!customers.available) customers.typedEmail?.let { attach(PosCustomer.typed(it)) } }),
      modifier = Modifier.weight(1f).testTag("pos-customer-search"),
    )
    OutlinedButton(onClick = customers::startAdding, modifier = Modifier.testTag("pos-customer-new")) { Text("New") }
  }
  customers.results.forEach { found ->
    Column(Modifier.fillMaxWidth().clickable { attach(found) }) {
      Text(found.title, style = MaterialTheme.typography.bodyLarge)
      val detail = listOfNotNull(found.email, found.phone).joinToString(" · ")
      if (detail.isNotEmpty()) Text(detail, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
  }
  if (!customers.available) {
    customers.typedEmail?.let { email ->
      TextButton(onClick = { attach(PosCustomer.typed(email)) }, modifier = Modifier.testTag("pos-customer-use-email")) { Text("Use $email") }
    }
  }
}

@Composable
private fun NewCustomerDialog(model: RegisterModel) {
  val customers = model.customers
  ActionDialog(
    title = "New customer",
    body = "Adding a customer does not sign them up for marketing email.",
    icon = "person_add",
    confirmLabel = "Add customer",
    busy = customers.busy,
    error = customers.error,
    onDismiss = customers::cancelAdding,
    onConfirm = {
      customers.create { added ->
        model.attachCustomer(added)
        customers.clearSearch()
      }
    },
  ) {
    OutlinedTextField(customers.draftName, { customers.draftName = it }, label = { Text("Name") }, singleLine = true, modifier = Modifier.fillMaxWidth().testTag("customer-name"))
    OutlinedTextField(
      customers.draftEmail, { customers.draftEmail = it }, label = { Text("Email") }, singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Email), modifier = Modifier.fillMaxWidth().testTag("customer-email"),
    )
    OutlinedTextField(
      customers.draftPhone, { customers.draftPhone = it }, label = { Text("Phone (optional)") }, singleLine = true,
      keyboardOptions = KeyboardOptions(keyboardType = KeyboardType.Phone), modifier = Modifier.fillMaxWidth().testTag("customer-phone"),
    )
  }
}
