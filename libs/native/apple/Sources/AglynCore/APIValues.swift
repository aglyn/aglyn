// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

// A route body from plain Swift values, and plain values out of a route's
// answer, so a screen's API calls read like the console's `JSON.stringify`
// and `response.json()` (the Kotlin kit's ApiJson.kt).

extension JSONValue {
  /// `value` as JSON: nil, booleans, numbers, strings, arrays and dictionaries,
  /// and JSON as it is. A nil dictionary value is written as `null`.
  public static func from(_ value: Any?) -> JSONValue {
    switch value {
    case nil: return .null
    case let json as JSONValue: return json
    case is NSNull: return .null
    case let flag as Bool: return .bool(flag)
    case let number as Int: return .number(Double(number))
    case let number as Int64: return .number(Double(number))
    case let number as Double: return .number(number)
    case let number as NSNumber:
      return CFGetTypeID(number) == CFBooleanGetTypeID() ? .bool(number.boolValue) : .number(number.doubleValue)
    case let text as String: return .string(text)
    case let array as [Any?]: return .array(array.map(from))
    case let array as [Any]: return .array(array.map { from($0) })
    case let object as [String: Any?]: return .object(object.mapValues(from))
    case let object as [String: Any]: return .object(object.mapValues { from($0) })
    default: return .string(String(describing: value!))
    }
  }

  public var boolValue: Bool? {
    if case .bool(let value) = self { return value }
    return nil
  }

  public var numberValue: Double? {
    if case .number(let value) = self { return value }
    return nil
  }

  public var arrayValue: [JSONValue]? {
    if case .array(let value) = self { return value }
    return nil
  }
}

extension Optional where Wrapped == JSONValue {
  /// A string field of a route's answer.
  public func field(_ key: String) -> String? { self?[key]?.stringValue }
  /// A boolean field of a route's answer.
  public func boolField(_ key: String) -> Bool? { self?[key]?.boolValue }
  /// A number field of a route's answer.
  public func numberField(_ key: String) -> Double? { self?[key]?.numberValue }
}

private let documentIDAlphabet = Array("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789")

/// A new document id as the SDKs mint them: 20 random letters and digits.
public func newDocumentID() -> String {
  String((0..<20).map { _ in documentIDAlphabet.randomElement()! })
}

extension ConsoleAPIClient {
  /// Sends `data` to a signed upload URL a route handed out (the media
  /// library's large-file path): a plain `PUT` with the minted content type
  /// and no bearer, since the signature is the authority. Throws on a refusal.
  public func putSigned(
    _ url: String, contentType: String, data: Data, transport: HTTPTransport = URLSession.shared
  ) async throws {
    guard url.hasPrefix("https://") || url.hasPrefix("http://"), let target = URL(string: url) else {
      throw ConsoleAPIError(status: 0, message: "The upload could not start.")
    }
    var request = URLRequest(url: target)
    request.httpMethod = "PUT"
    request.setValue(contentType, forHTTPHeaderField: "Content-Type")
    request.httpBody = data
    let response: HTTPURLResponse
    do {
      (_, response) = try await transport.send(request)
    } catch {
      throw ConsoleAPIError(status: 0, message: "The upload did not reach storage. Check the connection and try again.")
    }
    guard (200..<300).contains(response.statusCode) else {
      throw ConsoleAPIError(status: response.statusCode, message: "Storage refused the upload (\(response.statusCode)).")
    }
  }
}
