// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import AglynCore
import Observation
import SwiftUI
import WebKit

/// A bridge method the page may call; it returns the reply's result.
public typealias BridgeHandler = @MainActor ([String: JSONValue]) async throws -> JSONValue

/// The console page's state, for the shell's toolbar: its title and native back.
@MainActor
@Observable
public final class ConsoleWebViewModel {
  public private(set) var title: String = ""
  public private(set) var canGoBack = false
  public private(set) var loading = true
  @ObservationIgnored weak var webView: WKWebView?

  public init() {}

  public func goBack() { webView?.goBack() }
  public func reload() { webView?.reload() }

  func sync(_ webView: WKWebView) {
    title = webView.title ?? ""
    canGoBack = webView.canGoBack
    loading = webView.isLoading
  }
}

/// The authenticated console in a `WKWebView`.
///
/// The console session cookie the app minted (`ConsoleSession.mint`) is put
/// into the WebView's cookie store before the first load, so the page is
/// signed in as the app's user without a second sign-in. Pages on the
/// console origin may call the allowlisted bridge methods; a link that
/// leaves the console opens in the system browser.
public struct ConsoleWebView {
  let url: URL
  let trustedOrigins: [String]
  let cookies: [HTTPCookie]
  let bridgeName: String
  let handlers: [String: BridgeHandler]
  let info: [String: JSONValue]
  let model: ConsoleWebViewModel

  public init(
    url: URL, trustedOrigins: [String], cookies: [HTTPCookie], model: ConsoleWebViewModel,
    bridgeName: String = "AglynApp", handlers: [String: BridgeHandler] = [:], info: [String: JSONValue] = [:]
  ) {
    self.url = url
    self.trustedOrigins = trustedOrigins
    self.cookies = cookies
    self.model = model
    self.bridgeName = bridgeName
    self.handlers = handlers
    self.info = info
  }

  static let handlerName = "aglynBridge"

  /// The console URL for a path; anything that would leave the origin opens the console's home.
  public static func url(origin: String, path: String) -> URL? {
    let safe = path.hasPrefix("/") && !path.hasPrefix("//") ? path : "/"
    return URL(string: origin + safe)
  }

  @MainActor
  public final class Coordinator: NSObject, WKNavigationDelegate, WKScriptMessageHandler, WKUIDelegate {
    var parent: ConsoleWebView
    let nonce = BridgeProtocol.makeNonce()
    private var observations: [NSKeyValueObservation] = []

    init(_ parent: ConsoleWebView) { self.parent = parent }

    func make() -> WKWebView {
      let configuration = WKWebViewConfiguration()
      let controller = WKUserContentController()
      let methods = parent.handlers.keys.sorted()
      if !methods.isEmpty {
        controller.add(self, name: ConsoleWebView.handlerName)
        controller.addUserScript(
          WKUserScript(
            source: BridgeProtocol.injectionScript(
              globalName: parent.bridgeName, handlerName: ConsoleWebView.handlerName, nonce: nonce,
              methods: methods, trustedOrigins: parent.trustedOrigins, info: parent.info),
            injectionTime: .atDocumentEnd, forMainFrameOnly: true))
      }
      configuration.userContentController = controller
      configuration.websiteDataStore = .default()
      let webView = WKWebView(frame: .zero, configuration: configuration)
      webView.navigationDelegate = self
      webView.uiDelegate = self
      webView.allowsBackForwardNavigationGestures = true
      parent.model.webView = webView
      observations = [
        webView.observe(\.title) { [weak self] view, _ in MainActor.assumeIsolated { self?.parent.model.sync(view) } },
        webView.observe(\.canGoBack) { [weak self] view, _ in MainActor.assumeIsolated { self?.parent.model.sync(view) } },
        webView.observe(\.isLoading) { [weak self] view, _ in MainActor.assumeIsolated { self?.parent.model.sync(view) } },
      ]
      let store = configuration.websiteDataStore.httpCookieStore
      let cookies = parent.cookies
      let url = parent.url
      Task { @MainActor in
        for cookie in cookies { await store.setCookie(cookie) }
        webView.load(URLRequest(url: url))
      }
      return webView
    }

    public func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
      decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
      guard let url = action.request.url else { return decisionHandler(.cancel) }
      if url.scheme == "about" || BridgeProtocol.isTrusted(url.absoluteString, trustedOrigins: parent.trustedOrigins) {
        return decisionHandler(.allow)
      }
      // Off the console: the system browser, never inside the signed-in WebView.
      if action.targetFrame?.isMainFrame ?? true, ["http", "https", "mailto", "tel"].contains(url.scheme ?? "") {
        #if os(iOS)
          UIApplication.shared.open(url)
        #elseif os(macOS)
          NSWorkspace.shared.open(url)
        #endif
        return decisionHandler(.cancel)
      }
      decisionHandler(.allow)
    }

    /// `target=_blank` on the console stays in this WebView.
    public func webView(
      _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration,
      for action: WKNavigationAction, windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      if action.targetFrame == nil { webView.load(action.request) }
      return nil
    }

    public func userContentController(_ controller: WKUserContentController, didReceive message: WKScriptMessage) {
      guard message.frameInfo.isMainFrame, let data = message.body as? String else { return }
      let parsed = BridgeProtocol.parse(
        data: data, sourceURL: message.frameInfo.request.url?.absoluteString,
        trustedOrigins: parent.trustedOrigins, nonce: nonce, methods: parent.handlers.keys.sorted())
      let webView = message.webView
      let name = parent.bridgeName
      switch parsed {
      case .rejected(let reason, let id?):
        webView?.evaluateJavaScript(
          BridgeProtocol.replyScript(
            globalName: name, id: id,
            result: .failure(BridgeRefusal("The app refused the call (\(reason.rawValue))."))))
      case .rejected:
        return
      case .request(let request):
        guard let handler = parent.handlers[request.method] else { return }
        Task { @MainActor in
          let result: Result<JSONValue, Error>
          do { result = .success(try await handler(request.params)) } catch { result = .failure(error) }
          _ = try? await webView?.evaluateJavaScript(
            BridgeProtocol.replyScript(globalName: name, id: request.id, result: result))
        }
      }
    }
  }
}

struct BridgeRefusal: LocalizedError {
  let message: String
  init(_ message: String) { self.message = message }
  var errorDescription: String? { message }
}

#if os(iOS)
  extension ConsoleWebView: UIViewRepresentable {
    public func makeCoordinator() -> Coordinator { Coordinator(self) }
    public func makeUIView(context: Context) -> WKWebView { context.coordinator.make() }
    public func updateUIView(_ view: WKWebView, context: Context) { context.coordinator.parent = self }
  }
#elseif os(macOS)
  extension ConsoleWebView: NSViewRepresentable {
    public func makeCoordinator() -> Coordinator { Coordinator(self) }
    public func makeNSView(context: Context) -> WKWebView { context.coordinator.make() }
    public func updateNSView(_ view: WKWebView, context: Context) { context.coordinator.parent = self }
  }
#endif
