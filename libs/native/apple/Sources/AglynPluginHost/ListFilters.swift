// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import AglynUI
import SwiftUI

/*
 * A list's filters the calm way (Calm rule 3; Figma Orders 13:483 and Filter on 122:7056, AGL-3966): ONE Filter control
 * beside the search holds the status, the sort and "Add a filter…" (the console grid's other filters); the chips show
 * under the toolbar only once a filter is on. On the Mac and iPad the Filter control sits in the list's toolbar
 * (`aglynSearchable`'s filter); on a phone, whose search is the system's, it leads the chips row.
 */

/// What a list's filters are and where they stand.
public struct ListFilterState {
  public var statuses: [FilterChoice]
  public var status: String?
  public var sorts: [ListQuerySort]
  public var sort: ListQuerySort?
  public var fields: [ListFilterField]
  public var headers: [String: String]
  public var choices: [String: [FilterChoice]]
  public var clauses: [ListFilterRequest]
  public var refused: [FilterRefusal]
  public var notices: [String]
  /// The status's own name on its chip ("Status").
  public var statusName: String

  public init(
    statuses: [FilterChoice], status: String?, sorts: [ListQuerySort], sort: ListQuerySort?, fields: [ListFilterField],
    headers: [String: String], choices: [String: [FilterChoice]], clauses: [ListFilterRequest],
    refused: [FilterRefusal] = [], notices: [String] = [], statusName: String = "Status"
  ) {
    self.statuses = statuses
    self.status = status
    self.sorts = sorts
    self.sort = sort
    self.fields = fields
    self.headers = headers
    self.choices = choices
    self.clauses = clauses
    self.refused = refused
    self.notices = notices
    self.statusName = statusName
  }

  /// Whether a filter is on: a status, or a clause.
  public var filtering: Bool { status != nil || !clauses.isEmpty }
}

/// The list's one Filter control: its statuses, its sorts, and Add a filter.
public struct ListFilterMenu: View {
  let state: ListFilterState
  let setStatus: (String?) -> Void
  let setSort: (ListQuerySort?) -> Void
  let add: () -> Void

  public init(
    _ state: ListFilterState, setStatus: @escaping (String?) -> Void, setSort: @escaping (ListQuerySort?) -> Void,
    add: @escaping () -> Void
  ) {
    self.state = state
    self.setStatus = setStatus
    self.setSort = setSort
    self.add = add
  }

  public var body: some View {
    AglynFilterMenu(active: state.filtering ? "Filter" : nil) {
      if !state.statuses.isEmpty {
        Section(state.statusName) {
          ForEach(state.statuses, id: \.value) { choice in
            let on = (state.status ?? "") == choice.value
            Button {
              setStatus(choice.value.isEmpty ? nil : choice.value)
            } label: {
              if on { Label(choice.label, systemImage: "checkmark") } else { Text(choice.label) }
            }
            .accessibilityIdentifier("list-status-\(choice.value.isEmpty ? "all" : choice.value)")
          }
        }
      }
      if state.sorts.count > 1 {
        Section("Sort") {
          ForEach(Array(state.sorts.enumerated()), id: \.offset) { index, sort in
            Button {
              setSort(index == 0 ? nil : sort)
            } label: {
              let name = "\(sort.label ?? sort.path), \(sort.direction == .desc ? "descending" : "ascending")"
              if (state.sort ?? state.sorts.first) == sort { Label(name, systemImage: "checkmark") } else { Text(name) }
            }
          }
        }
      }
      if !state.fields.isEmpty {
        Button("Add a filter…", systemImage: "plus", action: add)
          .accessibilityIdentifier("list-add-filter")
      }
    }
  }
}

/// The filters that are on, as chips under the list's toolbar, and what the query did not apply; on a phone the Filter
/// control leads the row. Nothing shows at rest on the Mac and iPad.
public struct ListActiveFilters: View {
  @Environment(\.aglynWideChrome) private var wide
  let state: ListFilterState
  let setStatus: (String?) -> Void
  let setSort: (ListQuerySort?) -> Void
  let setClauses: ([ListFilterRequest]) -> Void
  @Binding var adding: Bool

  public init(
    _ state: ListFilterState, adding: Binding<Bool>, setStatus: @escaping (String?) -> Void,
    setSort: @escaping (ListQuerySort?) -> Void, setClauses: @escaping ([ListFilterRequest]) -> Void
  ) {
    self.state = state
    _adding = adding
    self.setStatus = setStatus
    self.setSort = setSort
    self.setClauses = setClauses
  }

  private var inset: CGFloat { wide ? AglynContentInsets.horizontal : AglynSpace.two }

  public var body: some View {
    let showing = state.filtering || !wide || !state.refused.isEmpty
    VStack(alignment: .leading, spacing: 0) {
      if showing {
        ScrollView(.horizontal, showsIndicators: false) {
          HStack(spacing: AglynSpace.one) {
            if !wide { ListFilterMenu(state, setStatus: setStatus, setSort: setSort) { adding = true } }
            if let status = state.status {
              let label = state.statuses.first { $0.value == status }?.label ?? status
              AglynFilterChip("\(state.statusName): \(label)") { setStatus(nil) }
                .accessibilityIdentifier("list-status-chip")
            }
          }
          .padding(.horizontal, inset)
          .padding(.vertical, AglynSpace.one)
        }
        .accessibilityIdentifier("list-active-filters")
      }
      // The clause chips and the planner's refusals; it also holds Add a filter's sheet while no chip shows.
      ClauseFilterBar(
        fields: state.fields, headers: state.headers, choices: state.choices, clauses: state.clauses,
        refused: state.refused, notices: state.filtering ? state.notices : [], showsAdd: false, adding: $adding,
        onChange: setClauses
      )
      .padding(.horizontal, inset)
      .padding(.bottom, state.clauses.isEmpty && state.refused.isEmpty ? 0 : AglynSpace.one)
    }
  }
}
