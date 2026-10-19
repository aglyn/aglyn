// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

extension ConsoleAPIClient {
  /// Posts `body` to a route that answers with server-sent events (`data: {json}` lines, the AI panel's
  /// `/api/assist/chat`) and hands back each event's JSON as it arrives. A refusal before the stream starts throws a
  /// `ConsoleAPIError` with the route's own words, as `request` does.
  public func events(_ path: String, body: JSONValue) -> AsyncThrowingStream<JSONValue, Error> {
    AsyncThrowingStream { continuation in
      let task = Task {
        do {
          var request = URLRequest(url: try url(for: path))
          request.httpMethod = HTTPMethod.post.rawValue
          request.setValue("text/event-stream", forHTTPHeaderField: "Accept")
          request.setValue("application/json", forHTTPHeaderField: "Content-Type")
          guard let token = try await getIDToken(false) else {
            throw ConsoleAPIError(status: 401, message: "Sign in to continue.")
          }
          request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
          request.httpBody = try body.encoded()
          let (bytes, response) = try await URLSession.shared.bytes(for: request)
          let status = (response as? HTTPURLResponse)?.statusCode ?? 0
          guard (200..<300).contains(status) else {
            var data = Data()
            for try await byte in bytes { data.append(byte) }
            let decoded = JSONValue.decode(data)
            throw ConsoleAPIError(status: status, message: consoleErrorMessage(status: status, body: decoded), body: decoded)
          }
          for try await line in bytes.lines {
            guard line.hasPrefix("data:") else { continue }
            let payload = line.dropFirst(5).trimmingCharacters(in: .whitespaces)
            if let value = JSONValue.decode(Data(payload.utf8)) { continuation.yield(value) }
          }
          continuation.finish()
        } catch {
          continuation.finish(throwing: error)
        }
      }
      continuation.onTermination = { _ in task.cancel() }
    }
  }
}
