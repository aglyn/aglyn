// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation

/// A file a console route answered with: its name from `Content-Disposition`,
/// its type, its bytes, and the response headers (an export counts its rows in
/// `X-Aglyn-Export-Rows`).
public struct DownloadedFile: Sendable {
  public let name: String?
  public let contentType: String
  public let data: Data
  public let headers: [String: String]

  public init(name: String?, contentType: String, data: Data, headers: [String: String] = [:]) {
    self.name = name
    self.contentType = contentType
    self.data = data
    self.headers = headers
  }

  /// A response header, by name in any case.
  public func header(_ name: String) -> String? {
    headers.first { $0.key.caseInsensitiveCompare(name) == .orderedSame }?.value
  }

  /// The file name a `Content-Disposition` header carries (`filename="…"` or `filename*=…`).
  public static func fileName(fromDisposition disposition: String?) -> String? {
    guard let disposition,
      let pattern = try? NSRegularExpression(pattern: #"filename\*?="?([^";]+)"?"#),
      let match = pattern.firstMatch(in: disposition, range: NSRange(disposition.startIndex..., in: disposition)),
      let range = Range(match.range(at: 1), in: disposition)
    else { return nil }
    var value = String(disposition[range])
    // RFC 5987: `UTF-8''name%20here`.
    if let tick = value.range(of: "''") { value = String(value[tick.upperBound...]).removingPercentEncoding ?? value }
    return value.isEmpty ? nil : value
  }
}

extension ConsoleAPIClient {
  /// POSTs `body` to a route that answers with a file (the export route), as
  /// the signed-in person, and hands back the bytes. A refusal throws the
  /// route's own words, as `request` does; nothing is retried, since an
  /// export is a fresh read each time.
  public func download(_ path: String, body: JSONValue) async throws -> DownloadedFile {
    var forceRefresh = false
    while true {
      guard let token = try await getIDToken(forceRefresh) else {
        throw ConsoleAPIError(status: 401, message: "Sign in to continue.")
      }
      var request = URLRequest(url: try url(for: path))
      request.httpMethod = HTTPMethod.post.rawValue
      request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
      request.setValue("application/json", forHTTPHeaderField: "Content-Type")
      request.httpBody = try body.encoded()
      let data: Data
      let response: HTTPURLResponse
      do {
        (data, response) = try await transport.send(request)
      } catch {
        if error is CancellationError || (error as? URLError)?.code == .cancelled || Task.isCancelled { throw error }
        throw ConsoleAPIError(
          status: 0, message: "\(AglynBrand.name) could not be reached. Check the connection and try again.")
      }
      if response.statusCode == 401 && !forceRefresh {
        forceRefresh = true
        continue
      }
      guard (200..<300).contains(response.statusCode) else {
        let decoded = JSONValue.decode(data)
        throw ConsoleAPIError(
          status: response.statusCode, message: consoleErrorMessage(status: response.statusCode, body: decoded),
          body: decoded)
      }
      var headers: [String: String] = [:]
      for (key, value) in response.allHeaderFields {
        if let key = key as? String { headers[key] = "\(value)" }
      }
      let file = DownloadedFile(
        name: nil, contentType: response.value(forHTTPHeaderField: "Content-Type") ?? "application/octet-stream",
        data: data, headers: headers)
      return DownloadedFile(
        name: DownloadedFile.fileName(fromDisposition: file.header("Content-Disposition")),
        contentType: file.contentType, data: data, headers: headers)
    }
  }
}
