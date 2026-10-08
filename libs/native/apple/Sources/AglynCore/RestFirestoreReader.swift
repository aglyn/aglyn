// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynContracts
import Foundation

/// `FirestoreReader` over Firestore REST v1, with the member's own ID token
/// as the bearer, so the same security rules apply as with the SDK.
///
/// The Mac app uses it when it signs in through `IdentityToolkitAuth` (an
/// unsigned build): the Firestore SDK takes its credentials from the
/// Firebase Auth SDK, which such a build cannot sign in. REST has no
/// listener, so a live query reads once and then again every
/// `refreshInterval` until it is removed; the shell's Refresh (⌘R) re-reads
/// at once by re-subscribing.
public final class RestFirestoreReader: FirestoreReader, @unchecked Sendable {
  public typealias TokenSource = @Sendable () async throws -> String?

  private let root: String
  private let databasePath: String
  private let transport: HTTPTransport
  private let idToken: TokenSource
  private let refreshInterval: Duration

  public init(
    projectID: String,
    emulatorHost: String?,
    transport: HTTPTransport = URLSession.shared,
    refreshInterval: Duration = .seconds(30),
    idToken: @escaping TokenSource
  ) {
    databasePath = "projects/\(projectID)/databases/(default)/documents"
    root = (emulatorHost.map { "http://\($0)" } ?? "https://firestore.googleapis.com") + "/v1/\(databasePath)"
    self.transport = transport
    self.idToken = idToken
    self.refreshInterval = refreshInterval
  }

  private final class Poll: FirestoreListening {
    let task: Task<Void, Never>
    init(_ task: Task<Void, Never>) { self.task = task }
    func remove() { task.cancel() }
  }

  @MainActor
  public func listen(
    _ query: FirestoreQuery,
    _ onChange: @escaping @MainActor (Result<[FirestoreDocument], Error>) -> Void
  ) -> FirestoreListening {
    let body = runQueryBody(query)
    let url = runQueryURL(query)
    return poll(onChange) { [self] in try await runQuery(url: url, body: body) }
  }

  @MainActor
  public func listenDocument(
    _ path: [String],
    _ onChange: @escaping @MainActor (Result<FirestoreDocument?, Error>) -> Void
  ) -> FirestoreListening {
    poll(onChange) { [self] in try await get(path) }
  }

  @MainActor
  private func poll<T: Sendable>(
    _ onChange: @escaping @MainActor (Result<T, Error>) -> Void,
    read: @escaping @Sendable () async throws -> T
  ) -> FirestoreListening {
    let interval = refreshInterval
    return Poll(
      Task { @MainActor in
        while !Task.isCancelled {
          let result: Result<T, Error>
          do { result = .success(try await read()) } catch { result = .failure(error) }
          if Task.isCancelled { return }
          onChange(result)
          try? await Task.sleep(for: interval)
        }
      })
  }

  /// One document, or nil when it does not exist.
  public func get(_ path: [String]) async throws -> FirestoreDocument? {
    let (status, body) = try await send(url: "\(root)/\(Self.encodePath(path))", method: "GET", body: nil)
    if status == 404 { return nil }
    guard (200..<300).contains(status), let document = body as? [String: Any] else {
      throw Self.failure(status: status, body: body)
    }
    return decodeDocument(document)
  }

  func runQueryURL(_ query: FirestoreQuery) -> String {
    let parent = query.collection.dropLast()
    return parent.isEmpty ? "\(root):runQuery" : "\(root)/\(Self.encodePath(Array(parent))):runQuery"
  }

  private func runQuery(url: String, body: [String: Any]) async throws -> [FirestoreDocument] {
    let (status, response) = try await send(url: url, method: "POST", body: body)
    guard (200..<300).contains(status), let rows = response as? [[String: Any]] else {
      throw Self.failure(status: status, body: response)
    }
    return rows.compactMap { ($0["document"] as? [String: Any]).map(decodeDocument) }
  }

  public func setDocument(_ path: [String], _ fields: [String: Any], merge: Bool) async throws {
    let name = "\(databasePath)/\(path.joined(separator: "/"))"
    var transforms: [[String: Any]] = []
    let encoded = Self.encodeFields(fields, prefix: [], transforms: &transforms)
    var write: [String: Any] = ["update": ["name": name, "fields": encoded]]
    if merge {
      write["updateMask"] = ["fieldPaths": Self.leafPaths(fields, prefix: [])]
    }
    if !transforms.isEmpty { write["updateTransforms"] = transforms }
    let (status, body) = try await send(url: "\(root):commit", method: "POST", body: ["writes": [write]])
    guard (200..<300).contains(status) else { throw Self.failure(status: status, body: body) }
  }

  public func deleteDocument(_ path: [String]) async throws {
    let (status, body) = try await send(url: "\(root)/\(Self.encodePath(path))", method: "DELETE", body: nil)
    guard (200..<300).contains(status) || status == 404 else { throw Self.failure(status: status, body: body) }
  }

  // MARK: - Wire format

  private func send(url: String, method: String, body: [String: Any]?) async throws -> (Int, Any?) {
    guard let token = try await idToken() else {
      throw ConsoleAPIError(status: 401, message: "Sign in to continue.")
    }
    guard let target = URL(string: url) else { throw URLError(.badURL) }
    var request = URLRequest(url: target)
    request.httpMethod = method
    request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    if let body {
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try JSONSerialization.data(withJSONObject: body)
    }
    let (data, response) = try await transport.send(request)
    return (response.statusCode, data.isEmpty ? nil : try? JSONSerialization.jsonObject(with: data))
  }

  static func failure(status: Int, body: Any?) -> ConsoleAPIError {
    let record = (body as? [[String: Any]])?.first ?? body as? [String: Any]
    let message = (record?["error"] as? [String: Any])?["message"] as? String
    return ConsoleAPIError(
      status: status,
      message: status == 403 || status == 401
        ? consoleErrorMessage(status: status, body: nil)
        : message ?? consoleErrorMessage(status: status, body: nil))
  }

  static func encodePath(_ path: [String]) -> String {
    path.map(ConsoleAPIClient.encodeComponent).joined(separator: "/")
  }

  private func decodeDocument(_ raw: [String: Any]) -> FirestoreDocument {
    let name = raw["name"] as? String ?? ""
    let fields = raw["fields"] as? [String: Any] ?? [:]
    return FirestoreDocument(
      id: name.components(separatedBy: "/").last ?? "",
      data: fields.compactMapValues { Self.decodeValue($0) })
  }

  func runQueryBody(_ query: FirestoreQuery) -> [String: Any] {
    var structured: [String: Any] = ["from": [["collectionId": query.collection.last ?? ""]]]
    let filters = query.allFilters.map { fieldFilter($0, collection: query.collection) }
    if filters.count == 1 {
      structured["where"] = filters[0]
    } else if filters.count > 1 {
      structured["where"] = ["compositeFilter": ["op": "AND", "filters": filters]]
    }
    if !query.order.isEmpty {
      structured["orderBy"] = query.order.map {
        ["field": ["fieldPath": Self.restFieldPath($0.field)], "direction": $0.descending ? "DESCENDING" : "ASCENDING"]
      }
    }
    if let limit = query.limit { structured["limit"] = limit }
    return ["structuredQuery": structured]
  }

  /// A dotted plan path as REST spells a field path.
  static func restFieldPath(_ path: String) -> String {
    path == "__name__" ? path : path.split(separator: ".").map { quote(String($0)) }.joined(separator: ".")
  }

  private static let restOps: [ListQueryOp: String] = [
    .equal: "EQUAL", .notEqual: "NOT_EQUAL", .lessThan: "LESS_THAN", .lessThanOrEqual: "LESS_THAN_OR_EQUAL",
    .greaterThan: "GREATER_THAN", .greaterThanOrEqual: "GREATER_THAN_OR_EQUAL", .arrayContains: "ARRAY_CONTAINS",
    .arrayContainsAny: "ARRAY_CONTAINS_ANY", .in: "IN",
  ]

  /// One filter as a REST `Filter`: a null equality is a unary filter, and a
  /// document-id filter compares references.
  func fieldFilter(_ constraint: ListQueryConstraint, collection: [String]) -> [String: Any] {
    let field = ["fieldPath": Self.restFieldPath(constraint.path)]
    if constraint.value is NSNull, constraint.op == .equal || constraint.op == .notEqual {
      return ["unaryFilter": ["op": constraint.op == .equal ? "IS_NULL" : "IS_NOT_NULL", "field": field]]
    }
    var value = Self.encodeValue(constraint.value)
    if constraint.isDocumentID {
      let reference = { (id: Any) -> [String: Any] in [
        "referenceValue": "\(self.databasePath)/\(collection.joined(separator: "/"))/\(id)"
      ] }
      value = (constraint.value as? [Any]).map { ["arrayValue": ["values": $0.map(reference)]] } ?? reference(constraint.value)
    }
    return ["fieldFilter": ["field": field, "op": Self.restOps[constraint.op] ?? "EQUAL", "value": value]]
  }

  private static let timestampFormatter: ISO8601DateFormatter = {
    let formatter = ISO8601DateFormatter()
    formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
    return formatter
  }()

  private static let plainTimestampFormatter = ISO8601DateFormatter()

  static func encodeValue(_ value: Any) -> [String: Any] {
    switch value {
    case is NSNull: return ["nullValue": NSNull()]
    case let text as String: return ["stringValue": text]
    case let date as Date: return ["timestampValue": timestampFormatter.string(from: date)]
    case let number as NSNumber:
      if CFGetTypeID(number) == CFBooleanGetTypeID() { return ["booleanValue": number.boolValue] }
      if CFNumberIsFloatType(number) { return ["doubleValue": number.doubleValue] }
      return ["integerValue": number.stringValue]
    case let array as [Any]: return ["arrayValue": ["values": array.map(encodeValue)]]
    case let map as [String: Any]: return ["mapValue": ["fields": map.mapValues(encodeValue)]]
    default: return ["stringValue": String(describing: value)]
    }
  }

  /// Plain values the way `FirebaseFirestoreReader` hands them out: a
  /// timestamp is a `Date`, a reference is its document path.
  static func decodeValue(_ value: Any) -> Any? {
    guard let record = value as? [String: Any], let (kind, inner) = record.first else { return nil }
    switch kind {
    case "nullValue": return NSNull()
    case "booleanValue": return (inner as? Bool).map { NSNumber(value: $0) }
    case "integerValue":
      if let text = inner as? String, let int = Int(text) { return NSNumber(value: int) }
      return inner as? NSNumber
    case "doubleValue": return (inner as? NSNumber).map { NSNumber(value: $0.doubleValue) }
    case "stringValue", "bytesValue": return inner as? String
    case "referenceValue":
      guard let text = inner as? String else { return nil }
      return text.range(of: "/documents/").map { String(text[$0.upperBound...]) } ?? text
    case "timestampValue":
      guard let text = inner as? String else { return nil }
      return timestampFormatter.date(from: text) ?? plainTimestampFormatter.date(from: text)
    case "arrayValue":
      let values = (inner as? [String: Any])?["values"] as? [Any] ?? []
      return values.map { decodeValue($0) ?? NSNull() }
    case "mapValue":
      let fields = (inner as? [String: Any])?["fields"] as? [String: Any] ?? [:]
      return fields.compactMapValues { decodeValue($0) }
    case "geoPointValue": return inner as? [String: Any]
    default: return nil
    }
  }

  /// A field path segment, back-quoted when it is not a plain identifier.
  static func quote(_ segment: String) -> String {
    if segment.range(of: "^[A-Za-z_][A-Za-z0-9_]*$", options: .regularExpression) != nil { return segment }
    return "`" + segment.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "`", with: "\\`") + "`"
  }

  /// The fields to write, with each server-value sentinel moved into a transform.
  static func encodeFields(
    _ fields: [String: Any], prefix: [String], transforms: inout [[String: Any]]
  ) -> [String: Any] {
    var encoded: [String: Any] = [:]
    for (key, value) in fields {
      let path = prefix + [key]
      switch value {
      case FirestoreSentinel.serverTimestamp:
        transforms.append(["fieldPath": path.map(quote).joined(separator: "."), "setToServerValue": "REQUEST_TIME"])
      case FirestoreSentinel.delete:
        // Named in the update mask with no value: the field is removed.
        continue
      case let map as [String: Any] where !map.isEmpty:
        encoded[key] = ["mapValue": ["fields": encodeFields(map, prefix: path, transforms: &transforms)]]
      default:
        encoded[key] = encodeValue(value)
      }
    }
    return encoded
  }

  /// A merge's update mask: every leaf the write names, as the SDK's
  /// `setData(_:merge: true)` merges nested maps field by field. A server
  /// value is left out, because its transform writes it.
  static func leafPaths(_ fields: [String: Any], prefix: [String]) -> [String] {
    fields.flatMap { key, value -> [String] in
      let path = prefix + [key]
      switch value {
      case FirestoreSentinel.serverTimestamp: return []
      case let map as [String: Any] where !map.isEmpty: return leafPaths(map, prefix: path)
      default: return [path.map(quote).joined(separator: ".")]
      }
    }.sorted()
  }
}
