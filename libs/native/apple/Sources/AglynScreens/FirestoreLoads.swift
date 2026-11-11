// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import AglynCore
import Foundation

/// The reads a spec makes straight from Firestore, under the same rules the
/// console's own reads run under (the console reads these documents with the
/// client SDK too): one document (`doc`) or one collection query (`query`).
enum FirestoreLoads {
  /// A Firestore value as JSON: a date becomes epoch milliseconds.
  static func json(_ value: Any?) -> JSONValue {
    switch value {
    // A stored null arrives as NSNull from both readers; it is no value, never the text "<null>".
    case nil, is NSNull: return .null
    case let text as String: return .string(text)
    // Not `as Bool` first: that also matches an NSNumber holding 0 or 1, so a stored integer 1 would read as true.
    case let number as NSNumber:
      if CFGetTypeID(number) == CFBooleanGetTypeID() { return .bool(number.boolValue) }
      return .number(number.doubleValue)
    case let number as Int: return .number(Double(number))
    case let number as Double: return .number(number)
    case let date as Date: return .number((date.timeIntervalSince1970 * 1000).rounded())
    case let items as [Any]: return .array(items.map { json($0) })
    case let record as [String: Any]: return .object(record.mapValues { json($0) })
    default: return .string(String(describing: value!))
    }
  }

  /// A stored document as the JSON a route that replaces it takes back: every field as stored, except the timestamps, which a
  /// client's JSON cannot carry (the route keeps the stored ones). `overlay` hands a spec this.
  static func stored(_ value: Any?) -> JSONValue? {
    switch value {
    case nil: return .null
    case is Date: return nil
    case let items as [Any]: return .array(items.compactMap { stored($0) })
    case let record as [String: Any]: return .object(record.compactMapValues { stored($0) })
    default: return json(value)
    }
  }

  /// JSON as the plain values a Firestore write takes.
  static func plain(_ value: JSONValue) -> Any {
    switch value {
    case .null: return NSNull()
    case .bool(let flag): return flag
    case .number(let number): return number == number.rounded() && abs(number) < 9e15 ? Int(number) as Any : number
    case .string(let text): return text
    case .array(let items): return items.map(plain)
    case .object(let record):
      // `{"$timestamp": true}` and `{"$serverTimestamp": true}` are the server's time; `{"$delete": true}` removes the field (the web SDK's sentinels).
      if record.count == 1, record["$timestamp"] != nil || record["$serverTimestamp"] != nil { return FirestoreSentinel.serverTimestamp }
      if record.count == 1, record["$delete"] != nil { return FirestoreSentinel.delete }
      return record.mapValues(plain)
    }
  }

  static func json(_ doc: FirestoreDocument) -> JSONValue {
    var record = doc.data.mapValues { json($0) }
    record["$id"] = .string(doc.id)
    return .object(record)
  }

  static func segments(_ path: String) -> [String] {
    path.split(separator: "/").map(String.init)
  }

  /// One document, read once.
  @MainActor
  static func document(_ reader: FirestoreReader, _ path: String) async throws -> JSONValue {
    try await rawDocument(reader, path).map(json) ?? .null
  }

  /// Whether the workspace carries a plan feature, as the console's `checkEntitlement` answers from the workspace's own
  /// document, with the name of the cheapest plan that includes it (what an upsell says): `{ carried, label }`.
  @MainActor
  static func entitlement(_ reader: FirestoreReader, feature: String, orgID: String) async throws -> JSONValue {
    let org = try await rawDocument(reader, "orgs/\(orgID)")
    return .object([
      "carried": .bool(planFeatureCarried(org?.data, feature)),
      "label": PlanFeatureDefaults.grantedFrom[feature].map(JSONValue.string) ?? .null,
    ])
  }

  /// The take rate on the workspace's marketplace sales, as the console's publish panel states it: `pct` from the
  /// workspace's own document (`resolveMarketplaceFeePct`), and `paid`, the rate on a paid plan.
  static func marketplaceTakeRate(_ reader: FirestoreReader, orgID: String) async throws -> JSONValue {
    let org = try await rawDocument(reader, "orgs/\(orgID)")
    return .object(["pct": .number(marketplaceFeePct(org?.data)), "paid": .number(MarketplaceFeeDefaults.paid)])
  }

  /// One order as an order widget is handed it (the console's `consoleOrderZoneOrder`): the stored order, and for each line
  /// its units, how many shipped and how many are left, whether it ships at all, whether the order has anything left to
  /// ship or anything shipped to bring back, and its number and test mode, all worked out by the ported figures.
  @MainActor
  static func orderZone(_ reader: FirestoreReader, hostID: String, orderID: String) async throws -> JSONValue {
    guard let doc = try await rawDocument(reader, "hosts/\(hostID)/orders/\(orderID)") else { return .null }
    let order = liftLegacyOrder((try? decodeJSONFields(HostOrder.self, doc.data)) ?? HostOrder())
    let states = orderLineFulfillmentStates(order)
    var record: [String: JSONValue] = [:]
    if case .object(let stored) = json(doc) { record = stored }
    if let data = try? JSONEncoder().encode(order), case .object(let lifted)? = JSONValue.decode(data) {
      record.merge(lifted) { _, new in new }
    }
    var lines: [JSONValue] = []
    if case .array(let items)? = record["lineItems"] {
      for (index, line) in items.enumerated() {
        var row: [String: JSONValue] = [:]
        if case .object(let fields) = line { row = fields }
        let state = states.indices.contains(index) ? states[index] : nil
        row["lineItemId"] = .number(Double(index))
        row["quantity"] = .number(Double(state?.quantity ?? 0))
        row["fulfilledQuantity"] = .number(Double(state?.fulfilledQuantity ?? 0))
        row["remainingQuantity"] = .number(Double(state?.remainingQuantity ?? 0))
        row["requiresShipping"] = .bool(state?.requiresShipping ?? true)
        lines.append(.object(row))
      }
    }
    record["id"] = .string(doc.id)
    record["number"] = .string(formatOrderNumber(order, docId: doc.id))
    record["currency"] = .string("USD")
    record["lines"] = .array(lines)
    record["shipLines"] = .array(lines.filter { $0["requiresShipping"] == .bool(true) })
    record["shippable"] = .bool(states.contains { $0.requiresShipping && $0.remainingQuantity > 0 })
    record["returnable"] = .bool(states.contains { $0.requiresShipping && $0.fulfilledQuantity > 0 })
    record["testMode"] = .bool(orderIsTestMode(order, docID: doc.id, livemode: doc.bool("livemode")))
    record["fulfillmentMethod"] = .string(record["fulfillmentMethod"]?.stringValue ?? "shipping")
    // Where a pickup or a local delivery stands; a status the order does not hold reads as where each starts.
    let pickedStatus = record["pickup"]?["status"]?.stringValue ?? ""
    record["pickupStatus"] = .string(["preparing", "ready", "picked_up"].contains(pickedStatus) ? pickedStatus : "preparing")
    let deliveryStatus = record["localDelivery"]?["status"]?.stringValue ?? ""
    record["deliveryStatus"] = .string(["scheduled", "out_for_delivery", "delivered", "failed"].contains(deliveryStatus) ? deliveryStatus : "scheduled")
    return .object(record)
  }

  @MainActor
  static func rawDocument(_ reader: FirestoreReader, _ path: String) async throws -> FirestoreDocument? {
    let doc: FirestoreDocument? = try await withCheckedThrowingContinuation { continuation in
      var listener: FirestoreListening?
      var finished = false
      listener = reader.listenDocument(segments(path)) { result in
        guard !finished else { return }
        finished = true
        listener?.remove()
        continuation.resume(with: result)
      }
      if finished { listener?.remove() }
    }
    return doc
  }

  /// The key a document load's answer carries (beside `$id`) while only the device's cache has given it (AGL-4047). The
  /// model takes it off, holds the forms seeded from that load (`checking`) and swaps in the server's copy when it answers.
  static let fromCacheKey = "$fromCache"

  /// A document load's first answer, marked with `fromCacheKey` when only the device's cache gave it. A document the
  /// cache reports missing is not missing yet: the server is waited for (`serverDocument`), so a form is never seeded
  /// blank over values the server holds.
  @MainActor
  static func documentLoad(_ reader: FirestoreReader, _ path: String) async throws -> JSONValue {
    let first: FirestoreAnswer<FirestoreDocument?> = try await withCheckedThrowingContinuation { continuation in
      var listener: FirestoreListening?
      var finished = false
      listener = reader.listenDocumentAnswer(segments(path)) { result in
        guard !finished else { return }
        finished = true
        listener?.remove()
        continuation.resume(with: result)
      }
      if finished { listener?.remove() }
    }
    guard first.fromCache else { return first.value.map(json) ?? .null }
    guard let doc = first.value else {
      let server = try await serverDocument(reader, path)
      let value = server.document.map(json) ?? .null
      return server.confirmed ? value : markedFromCache(value)
    }
    return markedFromCache(json(doc))
  }

  /// `value` with `fromCacheKey` set; a document that is not there has nothing to carry it.
  static func markedFromCache(_ value: JSONValue) -> JSONValue {
    guard case .object(var record) = value else { return value }
    record[fromCacheKey] = .bool(true)
    return .object(record)
  }

  /// `value` without `fromCacheKey`: a per-row read is shown, never saved back, so it is not held.
  static func unmarked(_ value: JSONValue) -> JSONValue {
    guard case .object(var record) = value, record[fromCacheKey] != nil else { return value }
    record[fromCacheKey] = nil
    return .object(record)
  }

  /// How long `serverDocument` waits for the server past the cache's answer: the console guard's 12 s (tests shorten it).
  @MainActor static var serverDeadline: Duration = .seconds(12)

  /// A document as the server answers it (AGL-4047): an answer the device's cache gives first is waited past, up to
  /// `deadline`. `confirmed` is false when only the cache answered by then; a read that failed throws.
  @MainActor
  static func serverDocument(
    _ reader: FirestoreReader, _ path: String, deadline: Duration? = nil
  ) async throws -> (document: FirestoreDocument?, confirmed: Bool) {
    let deadline = deadline ?? serverDeadline
    let wait = ServerAnswerWait()
    return try await withCheckedThrowingContinuation { continuation in
      wait.continuation = continuation
      wait.listener = reader.listenDocumentAnswer(segments(path)) { result in
        switch result {
        case .failure(let error): wait.finish(.failure(error))
        case .success(let answer):
          wait.latest = .some(answer.value)
          if !answer.fromCache { wait.finish(.success((answer.value, true))) }
        }
      }
      Task { @MainActor in
        try? await Task.sleep(for: deadline)
        if let latest = wait.latest { wait.finish(.success((latest, false))) } else { wait.finish(.failure(URLError(.timedOut))) }
      }
    }
  }

  /// How many rows a query load reads to start with: the spec's `limit`, or fifty.
  static func queryLimit(_ spec: JSONValue) -> Int { ScreenValues.number(spec["limit"]).map { Int($0) } ?? 50 }

  /// A where value as the readers take it: a number, bool or string, or a `{ "$date": ISO }` as a Date.
  static func plainValue(_ value: JSONValue) -> Any {
    switch value {
    case .bool(let flag): return flag
    case .number(let number): return number == number.rounded() && abs(number) < 9_007_199_254_740_992 ? Int64(number) : number
    case .object(let record):
      if let iso = record["$date"]?.stringValue {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = formatter.date(from: iso) { return date }
        formatter.formatOptions = [.withInternetDateTime]
        if let date = formatter.date(from: iso) { return date }
      }
      return ScreenValues.text(value)
    default: return ScreenValues.text(value)
    }
  }

  /// A collection query, read once: `{ "items": [...] }`.
  /// `spec` is `{ collection, where: [[field, "==", value]], orderBy: "field desc", limit }`. `limit` replaces the spec's
  /// own when a list has been asked for more rows (a growing window, as the console's lists page).
  @MainActor
  /// An answer only the device cache gave is marked (`fromCacheKey`), as a document load's is; `server` waits past the
  /// cache for the server's answer, up to `serverDeadline` (the model's confirm pass, AGL-4047).
  static func query(
    _ reader: FirestoreReader, _ spec: JSONValue, in context: JSONValue, limit: Int? = nil, server: Bool = false
  ) async throws -> JSONValue {
    let collection = ScreenValues.render(spec["collection"]?.stringValue ?? "", in: context)
    var equals: [(field: String, value: Any)] = []
    var filters: [ListQueryConstraint] = []
    func plainValue(_ raw: JSONValue) -> Any {
      // A number or flag written into the spec is compared as itself, not as its text.
      if case .null = raw { return NSNull() }
      if case .number(let number) = raw { return number }
      if case .bool(let flag) = raw { return flag }
      // `{ "$date": ISO }`: a timestamp.
      if case .object = raw { return Self.plainValue(raw) }
      // `@now.ms-7d`: a time or number computed from the context, the way a condition's right side is.
      if let text = raw.stringValue?.trimmingCharacters(in: .whitespaces), text.hasPrefix("@"),
        let computed = ScreenValues.operand(text, in: context)
      {
        return computed
      }
      switch ScreenValues.resolve(raw.stringValue ?? ScreenValues.text(raw), in: context) {
      case .bool(let flag): return flag
      case .number(let number): return number
      case let other: return ScreenValues.text(other)
      }
    }
    for clause in spec["where"].array {
      guard case .array(let parts) = clause, parts.count == 3 || parts.count == 4, let field = parts[0].stringValue,
        let name = parts[1].stringValue, let op = ListQueryOp(rawValue: name), op != .unknown
      else { continue }
      // A fourth entry is a condition: the clause counts only while it holds (a filter the person has not picked is left off).
      if parts.count == 4, !ScreenValues.condition(parts[3].stringValue, in: context) { continue }
      // `in` and `array-contains-any` take a list; the others one value.
      let listOp = op == .in || op == .arrayContainsAny
      let value: Any
      if listOp, case .array(let items) = parts[2] { value = items.map(plainValue) } else { value = plainValue(parts[2]) }
      if op == .equal { equals.append((field, value)) } else { filters.append(ListQueryConstraint(path: field, op: op, value: value)) }
    }
    var order: [FirestoreQuery.Order] = []
    if let raw = spec["orderBy"]?.stringValue {
      let parts = raw.split(separator: " ")
      order = [FirestoreQuery.Order(String(parts[0]), descending: parts.count > 1 && parts[1] == "desc")]
    }
    let rows = limit ?? queryLimit(spec)
    let query = FirestoreQuery(segments(collection), equals: equals, filters: filters, order: order, limit: rows)
    // `aggregate`: { count: true, sum: "balanceCents" } asks the server for the figures over every matching document
    // and reads no rows: `count` and `sum` are missing from the result where the reader cannot answer, so a screen
    // shows "Unavailable" instead of a zero.
    if let aggregate = spec["aggregate"] {
      var whole = query
      whole.limit = nil
      var result: [String: JSONValue] = ["items": .array([])]
      if aggregate["count"]?.boolValue == true {
        if let count = try await reader.count(whole) {
          result["count"] = .number(Double(count))
        } else if let ceiling = ScreenValues.number(aggregate["rows"]) {
          // `rows: <ceiling>`: where the reader cannot count, the rows are read up to the ceiling and counted (a usage meter).
          var capped = query
          capped.limit = Int(ceiling)
          result["count"] = .number(Double(try await documents(reader, capped).count))
        }
      }
      if let field = aggregate["sum"]?.stringValue, let total = try await reader.sum(whole, field: field) { result["sum"] = .number(total) }
      return .object(result)
    }
    let docs = server ? try await serverDocuments(reader, query) : try await documents(reader, query)
    let answer: JSONValue = ["items": .array(docs.map(json))]
    return docs.contains(where: \.fromCache) ? markedFromCache(answer) : answer
  }

  /// A query as the server answers it: the device cache's answer is waited past, up to `serverDeadline`; at the deadline
  /// the latest answer is given as it is (its documents still say `fromCache`).
  @MainActor
  static func serverDocuments(_ reader: FirestoreReader, _ query: FirestoreQuery) async throws -> [FirestoreDocument] {
    var confirming = query
    confirming.includeMetadataChanges = true
    let wait = QueryAnswerWait()
    return try await withCheckedThrowingContinuation { continuation in
      wait.continuation = continuation
      wait.listener = reader.listen(confirming) { result in
        switch result {
        case .failure(let error): wait.finish(.failure(error))
        case .success(let docs):
          wait.latest = docs
          if !docs.contains(where: \.fromCache) { wait.finish(.success(docs)) }
        }
      }
      Task { @MainActor in
        try? await Task.sleep(for: serverDeadline)
        wait.finish(wait.latest.map { .success($0) } ?? .failure(URLError(.timedOut)))
      }
    }
  }

  /// A query read once.
  @MainActor
  static func documents(_ reader: FirestoreReader, _ query: FirestoreQuery) async throws -> [FirestoreDocument] {
    try await withCheckedThrowingContinuation { continuation in
      var listener: FirestoreListening?
      var finished = false
      listener = reader.listen(query) { result in
        guard !finished else { return }
        finished = true
        listener?.remove()
        continuation.resume(with: result)
      }
      if finished { listener?.remove() }
    }
  }
}

/// One `serverDocuments` wait: the first of its listener's server answer, its failure or its deadline ends it.
@MainActor
private final class QueryAnswerWait {
  var continuation: CheckedContinuation<[FirestoreDocument], Error>?
  var listener: FirestoreListening?
  var latest: [FirestoreDocument]?

  func finish(_ result: Result<[FirestoreDocument], Error>) {
    guard let continuation else { return }
    self.continuation = nil
    listener?.remove()
    listener = nil
    continuation.resume(with: result)
  }
}

/// One `serverDocument` wait: the first of its listener's server answer, its failure or its deadline ends it.
@MainActor
private final class ServerAnswerWait {
  var continuation: CheckedContinuation<(document: FirestoreDocument?, confirmed: Bool), Error>?
  var listener: FirestoreListening?
  var latest: FirestoreDocument??

  func finish(_ result: Result<(document: FirestoreDocument?, confirmed: Bool), Error>) {
    guard let continuation else { return }
    self.continuation = nil
    listener?.remove()
    listener = nil
    continuation.resume(with: result)
  }
}
