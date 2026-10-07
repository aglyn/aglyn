// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Foundation

/// The page-to-app bridge's wire protocol, the same one the console's pages
/// already speak: a message is trusted only from a trusted origin, with the
/// session's nonce, naming an allowlisted method; anything else is dropped.
public enum BridgeProtocol {
  public struct Request: Equatable, Sendable {
    public let id: String
    public let method: String
    public let params: [String: JSONValue]
  }

  public enum Rejection: String, Equatable, Sendable {
    case untrustedOrigin = "untrusted-origin"
    case malformed
    case badNonce = "bad-nonce"
    case unknownMethod = "unknown-method"
  }

  public enum Parsed: Equatable, Sendable {
    case request(Request)
    case rejected(Rejection, id: String?)
  }

  /// The console WebView's methods: open a path natively, and close the WebView.
  public static let consoleMethods = ["openNative", "close"]
  public static let maxMessageBytes = 16 * 1024

  /// `scheme://host[:port]` (default ports dropped), or nil; credentials in the authority are refused.
  public static func originOf(_ url: String?) -> String? {
    guard let url, !url.isEmpty else { return nil }
    let trimmed = url.trimmingCharacters(in: .whitespacesAndNewlines)
    guard let match = trimmed.range(of: "^(https?)://([^/?#]+)", options: [.regularExpression, .caseInsensitive])
    else { return nil }
    let head = trimmed[match]
    let schemeEnd = head.range(of: "://")!
    let scheme = head[..<schemeEnd.lowerBound].lowercased()
    let authority = head[schemeEnd.upperBound...].lowercased()
    if authority.contains("@") { return nil }
    let parts = authority.split(separator: ":", omittingEmptySubsequences: false)
    guard let host = parts.first, !host.isEmpty else { return nil }
    let port = parts.count > 1 ? String(parts[1]) : nil
    let defaultPort = scheme == "https" ? "443" : "80"
    if let port, !port.isEmpty, port != defaultPort { return "\(scheme)://\(host):\(port)" }
    return "\(scheme)://\(host)"
  }

  public static func isTrusted(_ url: String?, trustedOrigins: [String]) -> Bool {
    guard let origin = originOf(url) else { return false }
    return trustedOrigins.contains { originOf($0) == origin }
  }

  private static func matches(_ value: String, _ pattern: String) -> Bool {
    value.range(of: pattern, options: .regularExpression) != nil
  }

  public static func parse(
    data: String, sourceURL: String?, trustedOrigins: [String], nonce: String, methods: [String]
  ) -> Parsed {
    guard isTrusted(sourceURL, trustedOrigins: trustedOrigins) else { return .rejected(.untrustedOrigin, id: nil) }
    guard data.utf16.count <= maxMessageBytes, let raw = data.data(using: .utf8),
      case .object(let object)? = JSONValue.decode(raw), object["aglynBridge"] == .number(1)
    else { return .rejected(.malformed, id: nil) }
    guard case .string(let id)? = object["id"], matches(id, "^[A-Za-z0-9_-]{1,64}$") else {
      return .rejected(.malformed, id: nil)
    }
    guard case .string(let sent)? = object["nonce"], !nonce.isEmpty, sent == nonce else {
      return .rejected(.badNonce, id: nil)
    }
    guard case .string(let method)? = object["method"], matches(method, "^[A-Za-z][A-Za-z0-9]{0,63}$") else {
      return .rejected(.malformed, id: id)
    }
    guard methods.contains(method) else { return .rejected(.unknownMethod, id: id) }
    let params: [String: JSONValue]
    switch object["params"] {
    case nil, .null?: params = [:]
    case .object(let value)?: params = value
    default: return .rejected(.malformed, id: id)
    }
    return .request(Request(id: id, method: method, params: params))
  }

  public static func makeNonce() -> String {
    let alphabet = Array("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789")
    var generator = SystemRandomNumberGenerator()
    return String((0..<32).map { _ in alphabet[Int.random(in: 0..<alphabet.count, using: &generator)] })
  }

  private static func json(_ value: JSONValue) -> String {
    let text = (try? value.encoded()).flatMap { String(data: $0, encoding: .utf8) } ?? "null"
    return text.replacingOccurrences(of: "\u{2028}", with: "\\u2028")
      .replacingOccurrences(of: "\u{2029}", with: "\\u2029")
  }

  public static func replyScript(globalName: String, id: String, result: Result<JSONValue, Error>) -> String {
    let reply: JSONValue
    switch result {
    case .success(let value): reply = ["id": .string(id), "ok": true, "result": value]
    case .failure(let error): reply = ["id": .string(id), "ok": false, "error": .string(error.localizedDescription)]
    }
    return
      "(function(){var b=window[\(json(.string(globalName)))];if(b&&b.__reply){b.__reply(\(json(reply)));}})();true;"
  }

  /// The script that defines `window[globalName]` on a trusted page only.
  public static func injectionScript(
    globalName: String, handlerName: String, nonce: String, methods: [String], trustedOrigins: [String],
    info: [String: JSONValue] = [:]
  ) -> String {
    let name = json(.string(globalName))
    let trusted = json(.array(trustedOrigins.compactMap(originOf).map(JSONValue.string)))
    return """
      (function(){
      var post = window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers[\(json(.string(handlerName)))];
      if (window[\(name)] || !post) return;
      if (\(trusted).indexOf(window.location.origin) < 0) return;
      var pending = {};
      var counter = 0;
      function call(method, params) {
        return new Promise(function (resolve, reject) {
          counter += 1;
          var id = 'c' + counter + '_' + Date.now().toString(36);
          pending[id] = { resolve: resolve, reject: reject };
          post.postMessage(JSON.stringify({
            aglynBridge: 1, nonce: \(json(.string(nonce))), id: id, method: method,
            params: params && typeof params === 'object' ? params : {}
          }));
        });
      }
      var bridge = { info: Object.freeze(\(json(.object(info)))) };
      \(json(.array(methods.map(JSONValue.string)))).forEach(function (method) {
        bridge[method] = function (params) { return call(method, params); };
      });
      Object.defineProperty(bridge, '__reply', {
        value: function (reply) {
          var entry = reply && pending[reply.id];
          if (!entry) return;
          delete pending[reply.id];
          if (reply.ok) entry.resolve(reply.result);
          else entry.reject(new Error(String(reply.error || 'The app could not do that.')));
        }
      });
      Object.defineProperty(window, \(name), { value: Object.freeze(bridge), writable: false, configurable: false });
      try { window.dispatchEvent(new Event(\(json(.string("\(globalName):ready"))))); } catch (e) {}
      })();true;
      """
  }
}
