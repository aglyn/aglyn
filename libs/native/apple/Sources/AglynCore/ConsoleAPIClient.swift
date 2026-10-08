// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// A console API route's refusal: the HTTP status (0 when nothing answered)
/// and the message to show, which is the route's own `error` when it sent one.
public struct ConsoleAPIError: Error, LocalizedError, Equatable {
  public let status: Int
  public let message: String
  /// The decoded JSON body, when there was one.
  public let body: JSONValue?

  public init(status: Int, message: String, body: JSONValue? = nil) {
    self.status = status
    self.message = message
    self.body = body
  }

  public var errorDescription: String? { message }
}

/// The message a route sent, or a plain one for its status.
public func consoleErrorMessage(status: Int, body: JSONValue?) -> String {
  if case .object(let record) = body {
    for key in ["error", "message"] {
      if case .string(let text) = record[key], !text.isEmpty { return text }
    }
  }
  if status == 401 { return "Your session ended. Sign in again." }
  if status == 403 { return "You do not have permission to do that." }
  if status == 404 { return "That was not found." }
  if status >= 500 { return "\(AglynBrand.name) could not be reached. Try again in a moment." }
  return "That did not work. Try again."
}

public enum HTTPMethod: String, Sendable {
  case get = "GET", post = "POST", put = "PUT", patch = "PATCH", delete = "DELETE"
}

/// The transport the client sends through; `URLSession` in the app, a stub in tests.
public protocol HTTPTransport: Sendable {
  func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse)
}

extension URLSession: HTTPTransport {
  public func send(_ request: URLRequest) async throws -> (Data, HTTPURLResponse) {
    let (data, response) = try await data(for: request)
    guard let http = response as? HTTPURLResponse else { throw URLError(.badServerResponse) }
    return (data, http)
  }
}

/// The console API client.
///
/// An app calls the same console API routes the console itself calls, with
/// the same credential: a Firebase ID token as a bearer. There is no
/// app-only route and no privileged path; a route refuses the app exactly
/// when it would refuse the console.
///
/// Retries: a GET (and a write that carries an `Idempotency-Key`) is retried
/// on a network error or a 502/503/504, with 400·2ⁿ ms backoff. A 4xx is an
/// answer and is never retried, except one forced token refresh on a 401.
public final class ConsoleAPIClient: Sendable {
  public typealias TokenSource = @Sendable (_ forceRefresh: Bool) async throws -> String?
  public typealias Sleep = @Sendable (_ milliseconds: UInt64) async throws -> Void

  public let origin: String
  let getIDToken: TokenSource
  let transport: HTTPTransport
  private let sleep: Sleep
  private let maxAttempts: Int

  public init(
    origin: String,
    getIDToken: @escaping TokenSource,
    transport: HTTPTransport = URLSession.shared,
    sleep: Sleep? = nil,
    maxAttempts: Int = 3
  ) {
    var trimmed = origin
    while trimmed.hasSuffix("/") { trimmed.removeLast() }
    self.origin = trimmed
    self.getIDToken = getIDToken
    self.transport = transport
    self.sleep = sleep ?? { ms in try await Task.sleep(nanoseconds: ms * 1_000_000) }
    self.maxAttempts = max(1, maxAttempts)
  }

  /// The signed-in member's ID token claims (its payload, decoded; never verified here, since the
  /// routes and rules verify the token itself). A screen reads a claim the console reads the same
  /// way, such as `staff` for a staff preview.
  public func claims() async -> [String: Any] {
    guard let token = try? await getIDToken(false) else { return [:] }
    return Self.jwtPayload(token)
  }

  static func jwtPayload(_ token: String) -> [String: Any] {
    let parts = token.split(separator: ".")
    guard parts.count >= 2 else { return [:] }
    var base64 = String(parts[1]).replacingOccurrences(of: "-", with: "+").replacingOccurrences(of: "_", with: "/")
    while base64.count % 4 != 0 { base64 += "=" }
    guard let data = Data(base64Encoded: base64), let object = try? JSONSerialization.jsonObject(with: data) as? [String: Any] else { return [:] }
    return object
  }

  /// `encodeURIComponent`'s unreserved set.
  private static let componentAllowed: CharacterSet = {
    var set = CharacterSet.alphanumerics.intersection(CharacterSet(charactersIn: Unicode.Scalar(0)..<Unicode.Scalar(128)))
    set.insert(charactersIn: "-_.!~*'()")
    return set
  }()

  static func encodeComponent(_ value: String) -> String {
    value.addingPercentEncoding(withAllowedCharacters: componentAllowed) ?? value
  }

  /// The full URL for a route path, with the query's non-nil values in order.
  public func url(for path: String, query: [(String, String?)] = []) throws -> URL {
    guard path.hasPrefix("/"), !path.hasPrefix("//") else {
      throw ConsoleAPIError(status: 0, message: "A console API path starts with one \"/\": \(path)")
    }
    let params = query.compactMap { key, value in
      value.map { "\(Self.encodeComponent(key))=\(Self.encodeComponent($0))" }
    }
    let raw = "\(origin)\(path)\(params.isEmpty ? "" : "?\(params.joined(separator: "&"))")"
    guard let url = URL(string: raw) else {
      throw ConsoleAPIError(status: 0, message: "Not a console URL: \(raw)")
    }
    return url
  }

  /// Sends a request and returns the decoded JSON body (nil when the body is empty or not JSON).
  @discardableResult
  public func request(
    _ path: String,
    method: HTTPMethod = .get,
    query: [(String, String?)] = [],
    body: JSONValue? = nil,
    idempotencyKey: String? = nil,
    anonymous: Bool = false
  ) async throws -> JSONValue? {
    let retryable = method == .get || idempotencyKey != nil
    var forceRefresh = false
    var lastError: Error?
    let url = try url(for: path, query: query)
    var attempt = 1
    while attempt <= maxAttempts {
      var request = URLRequest(url: url)
      request.httpMethod = method.rawValue
      request.setValue("application/json", forHTTPHeaderField: "Accept")
      if !anonymous {
        guard let token = try await getIDToken(forceRefresh) else {
          throw ConsoleAPIError(status: 401, message: "Sign in to continue.")
        }
        request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      }
      if let body {
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try body.encoded()
      }
      if let idempotencyKey { request.setValue(idempotencyKey, forHTTPHeaderField: "Idempotency-Key") }

      let data: Data
      let response: HTTPURLResponse
      do {
        (data, response) = try await transport.send(request)
      } catch {
        if error is CancellationError || (error as? URLError)?.code == .cancelled || Task.isCancelled {
          throw error
        }
        lastError = error
        if !retryable || attempt == maxAttempts { break }
        try await sleep(400 << UInt64(attempt - 1))
        attempt += 1
        continue
      }
      let decoded = JSONValue.decode(data)
      if (200..<300).contains(response.statusCode) { return decoded }
      // One forced token refresh on a 401: an ID token can expire between
      // the read and the request, and a fresh one is the whole fix.
      if response.statusCode == 401 && !anonymous && !forceRefresh {
        forceRefresh = true
        continue
      }
      if retryable && [502, 503, 504].contains(response.statusCode) && attempt < maxAttempts {
        try await sleep(400 << UInt64(attempt - 1))
        attempt += 1
        continue
      }
      throw ConsoleAPIError(
        status: response.statusCode,
        message: consoleErrorMessage(status: response.statusCode, body: decoded),
        body: decoded
      )
    }
    throw ConsoleAPIError(
      status: 0,
      message: "\(AglynBrand.name) could not be reached. Check the connection and try again.",
      body: lastError.map { .string(String(describing: $0)) }
    )
  }

  /// Sends a request and decodes a 2xx body into `T`.
  public func request<T: Decodable>(
    _ type: T.Type,
    _ path: String,
    method: HTTPMethod = .get,
    query: [(String, String?)] = [],
    body: JSONValue? = nil,
    idempotencyKey: String? = nil,
    anonymous: Bool = false
  ) async throws -> T {
    let value = try await request(
      path, method: method, query: query, body: body, idempotencyKey: idempotencyKey,
      anonymous: anonymous)
    return try JSONDecoder().decode(T.self, from: try (value ?? .null).encoded())
  }
}
