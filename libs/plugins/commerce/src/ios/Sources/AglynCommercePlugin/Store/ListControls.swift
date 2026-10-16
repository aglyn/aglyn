// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynPluginHost
import AglynUI
import SwiftUI

/*
 * THE CONSOLE'S LIST FILTERS AND COLUMN SORTS on Orders and Products
 * (AGL-3841): any clause the list's declaration allows ("Status is any of
 * Paid, Fulfilled", "Date is after …"), through the shared ClauseFilterBar,
 * and every order its header sorts offer (`ORDER_LIST_COLUMN_SORTS`,
 * `PRODUCT_LIST_COLUMN_SORTS`). The plan is the same planner the console
 * runs, so a combination it cannot serve is said, not silently dropped.
 */

/// A select field's values as the filter bar offers them.
func filterChoices(_ options: [String: [ListFilterOption]]) -> [String: [FilterChoice]] {
  options.mapValues { $0.map { FilterChoice($0.value, $0.label) } }
}

/// The orders list's select fields and their values (`ORDER_LIST_SELECT_FIELDS`).
func orderFilterChoices() -> [String: [FilterChoice]] {
  let values = ContractValues.shared
  return filterChoices([
    "statusKey": values.orderStatusOptions, "channelKey": values.orderChannelOptions, "disputeKey": values.orderDisputeOptions,
  ])
}

/// The planner's refusals, each matched back to the clause the person added.
func filterRefusals(_ plan: ListQueryPlan, clauses: [ListFilterRequest]) -> [FilterRefusal] {
  plan.refused.map { entry in
    let clause = clauses.first { clause in
      ContractJSON.object(["field": .string(clause.field), "op": .string(clause.op), "value": .string(clause.value)]) == entry.clause
    }
    return FilterRefusal(clause: clause, reason: entry.reason)
  }
}

/// A sort's words: "Date, descending".
func sortLabel(_ sort: ListQuerySort) -> String {
  let label = sort.label ?? sort.path
  return "\(label), \(sort.direction == .desc ? "descending" : "ascending")"
}

/// The header sorts as a menu; the first is the list's own order.
struct ListSortMenu: View {
  let sorts: [ListQuerySort]
  let selected: ListQuerySort?
  let pick: (ListQuerySort?) -> Void

  var body: some View {
    Menu {
      ForEach(Array(sorts.enumerated()), id: \.offset) { index, sort in
        Button {
          pick(index == 0 ? nil : sort)
        } label: {
          if (selected ?? sorts.first) == sort { Label(sortLabel(sort), systemImage: "checkmark") } else { Text(sortLabel(sort)) }
        }
      }
    } label: {
      Label("Sort", systemImage: "arrow.up.arrow.down")
    }
    .accessibilityIdentifier("list-sort")
  }
}
