// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/// One column of a list block (`columns`): a fact each row can show, which the person can turn on and off, and which can order
/// the list. The console's grid has the same: a column picker, and a header that sorts.
///
/// `{ id, label, value, show, always, sort: { route | page, type, first } }`. `value` is the cell's template over the row. A
/// `route` sort is the staff route's own order over every row (`sort=<path>:<dir>` on the load); a `page` sort orders the rows
/// already on the screen by a path over the row, as the console does for the columns a query cannot order by. `type` is how a
/// `page` sort compares (`text`, `number` or `date`); `first` is the direction the first tap asks for.
struct ListColumn: Identifiable, Equatable, Sendable {
  let id: String
  let label: String
  let value: String
  let show: Bool
  /// Shown whether or not it is picked, and not offered in the picker: the row's own name.
  let always: Bool
  let route: String?
  let page: String?
  let type: String
  let first: String

  var sortable: Bool { route != nil || page != nil }

  init?(_ json: JSONValue) {
    guard let id = json["id"]?.stringValue else { return nil }
    self.id = id
    label = json["label"]?.stringValue ?? id
    value = json["value"]?.stringValue ?? ""
    show = json["show"] != .bool(false)
    always = json["always"] == .bool(true)
    route = json["sort"]?["route"]?.stringValue
    page = json["sort"]?["page"]?.stringValue
    type = json["sort"]?["type"]?.stringValue ?? "text"
    first = json["sort"]?["first"]?.stringValue == "desc" ? "desc" : "asc"
  }
}

/// The order a list was asked for: one column, ascending or descending. Nothing asked is the route's own default order.
public struct ListOrder: Equatable, Sendable {
  public let column: String
  public let descending: Bool
}

enum ListColumns {
  /// The columns a list block declares, then the ones plugins contribute to its `columnsZone`.
  @MainActor
  static func columns(of block: BlockSpec, in catalog: ScreenCatalog = .shared) -> [ListColumn] {
    var columns = block["columns"].array.compactMap(ListColumn.init)
    if let zone = block["columnsZone"]?.stringValue {
      columns += catalog.zone(zone).compactMap { $0.raw["column"].flatMap(ListColumn.init) }
    }
    return columns
  }

  /// The key a list's choices are kept under: its load, else its items.
  static func key(of block: BlockSpec) -> String {
    block["load"]?.stringValue ?? block["items"]?.stringValue ?? block.id
  }

  /// The next order a tap on `column` asks for, like a grid header: its first direction, then the other, then the default again.
  static func next(after current: ListOrder?, tapping column: ListColumn) -> ListOrder? {
    guard let current, current.column == column.id else { return ListOrder(column: column.id, descending: column.first == "desc") }
    return (current.descending == (column.first == "desc")) ? ListOrder(column: column.id, descending: !current.descending) : nil
  }

  /// The route's `sort` value (`path:dir`) for an order on a `route` column.
  static func routeValue(_ order: ListOrder?, columns: [ListColumn]) -> String? {
    guard let order, let column = columns.first(where: { $0.id == order.column }), let route = column.route else { return nil }
    return "\(route):\(order.descending ? "desc" : "asc")"
  }

  /// The rows by a `page` column, in the order asked: numbers as numbers, dates as moments, anything else as text; a row without
  /// the value goes last whichever way it is read, and equal rows keep the order they came in.
  static func sorted(_ rows: [JSONValue], by column: ListColumn, descending: Bool, in context: JSONValue) -> [JSONValue] {
    guard let path = column.page else { return rows }
    let keyed = rows.enumerated().map { offset, row in
      (offset, row, ScreenValues.lookup(path, in: ScreenContext.with(context, item: row)))
    }
    func missing(_ value: JSONValue?) -> Bool {
      switch value {
      case nil, .null?: true
      case .string(let text)?: text.isEmpty
      default: false
      }
    }
    func before(_ a: JSONValue?, _ b: JSONValue?) -> Bool {
      switch column.type {
      case "number":
        let x = ScreenValues.number(a) ?? 0
        let y = ScreenValues.number(b) ?? 0
        return descending ? x > y : x < y
      case "date":
        let x = ScreenValues.epochMillis(a) ?? 0
        let y = ScreenValues.epochMillis(b) ?? 0
        return descending ? x > y : x < y
      default:
        let result = ScreenValues.text(a).localizedStandardCompare(ScreenValues.text(b))
        return descending ? result == .orderedDescending : result == .orderedAscending
      }
    }
    return keyed.sorted { a, b in
      let left = missing(a.2)
      let right = missing(b.2)
      if left != right { return right }
      if !left, before(a.2, b.2) { return true }
      if !left, before(b.2, a.2) { return false }
      return a.0 < b.0
    }.map(\.1)
  }

  /// A row's visible columns as one line: `Label value`, joined, skipping what the row has nothing for.
  static func line(_ columns: [ListColumn], shown: Set<String>, in scope: JSONValue) -> String {
    columns.filter { !$0.always && shown.contains($0.id) }.compactMap { column in
      let text = ScreenValues.render(column.value, in: scope)
      return text.isEmpty || text == "\u{2014}" ? nil : "\(column.label) \(text)"
    }.joined(separator: " \u{00b7} ")
  }
}
