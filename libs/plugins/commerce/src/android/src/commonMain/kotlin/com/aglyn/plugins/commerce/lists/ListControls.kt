// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

package com.aglyn.plugins.commerce.lists

import androidx.compose.foundation.layout.Box
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.aglyn.contracts.Contracts
import com.aglyn.contracts.ListFilterOption
import com.aglyn.contracts.ListFilterRequest
import com.aglyn.contracts.ListQueryPlan
import com.aglyn.contracts.ListQuerySort
import com.aglyn.contracts.ListQuerySortDirection
import com.aglyn.pluginhost.FilterRefusal
import com.aglyn.ui.AglynIcons
import com.aglyn.ui.InputChoice
import com.aglyn.ui.OutlinedButton
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.buildJsonObject

/*
 * THE CONSOLE'S LIST FILTERS AND COLUMN SORTS on Orders and Products
 * (AGL-3841): any clause the list's declaration allows, through the shared
 * ClauseFilterBar, and every order its header sorts offer
 * (`ORDER_LIST_COLUMN_SORTS`, `PRODUCT_LIST_COLUMN_SORTS`). The plan is the
 * planner the console runs, so a combination it cannot serve is said, not
 * silently dropped (the Swift ListControls.swift).
 */

/** A select field's values as the filter bar offers them. */
fun filterChoices(options: Map<String, List<ListFilterOption>>): Map<String, List<InputChoice>> =
  options.mapValues { (_, values) -> values.map { InputChoice(it.value, it.label) } }

/** The orders list's select fields and their values (`ORDER_LIST_SELECT_FIELDS`). */
fun orderFilterChoices(): Map<String, List<InputChoice>> = filterChoices(
  mapOf(
    "statusKey" to Contracts.orderStatusOptions,
    "channelKey" to Contracts.orderChannelOptions,
    "disputeKey" to Contracts.orderDisputeOptions,
  ),
)

/** The planner's refusals, each matched back to the clause the person added. */
fun filterRefusals(plan: ListQueryPlan, clauses: List<ListFilterRequest>): List<FilterRefusal> = plan.refused.map { entry ->
  val clause = clauses.firstOrNull { clause ->
    buildJsonObject {
      put("field", JsonPrimitive(clause.field))
      put("op", JsonPrimitive(clause.op))
      put("value", JsonPrimitive(clause.value))
    } == entry.clause
  }
  FilterRefusal(clause, entry.reason)
}

/** A sort's words: "Date, descending". */
fun sortLabel(sort: ListQuerySort): String =
  "${sort.label ?: sort.path}, ${if (sort.direction == ListQuerySortDirection.DESC) "descending" else "ascending"}"

/** The header sorts as a menu; the first is the list's own order, picked as null. */
@Composable
fun ListSortMenu(sorts: List<ListQuerySort>, selected: ListQuerySort?, pick: (ListQuerySort?) -> Unit, modifier: Modifier = Modifier) {
  var open by remember { mutableStateOf(false) }
  Box(modifier) {
    OutlinedButton(onClick = { open = true }, modifier = Modifier.testTag("list-sort")) {
      Icon(AglynIcons.named("filter_list"), contentDescription = null)
      Text("Sort")
    }
    DropdownMenu(expanded = open, onDismissRequest = { open = false }) {
      sorts.forEachIndexed { index, sort ->
        val on = (selected ?: sorts.firstOrNull()) == sort
        DropdownMenuItem(
          text = { Text(sortLabel(sort)) },
          onClick = { open = false; pick(if (index == 0) null else sort) },
          trailingIcon = if (on) ({ Icon(AglynIcons.named("check"), contentDescription = "Selected") }) else null,
        )
      }
    }
  }
}
