// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Foundation
import SwiftUI
import WebKit

/*
 * ANOTHER PLUGIN'S SCREEN ON THE CUSTOMER DISPLAY (AGL-4042), as the console's display page opens it: the plugin's
 * public console page, full screen. The display's credential goes where core's seam keeps it for that page
 * (`localStorage`, `aglyn.customerDisplay.credential`), before the page's own scripts run, and nothing else does. When
 * the page sends the display back to its own address (`/kiosk/commerce/pos-display`), the native display takes over
 * again. The Kotlin kit's CustomerDisplayWebView (native-webview).
 */

private let credentialPattern = #/^[A-Za-z0-9_.~-]{16,512}$/#

struct PosDisplayPluginScreen {
  let url: URL
  /// The display's own credential; only a value in the seam's shape is handed to the page.
  let credential: String
  let returnPath: String
  let onReturn: @MainActor () -> Void

  func makeCoordinator() -> Coordinator { Coordinator(returnPath: returnPath, onReturn: onReturn) }

  @MainActor
  func makeWebView(_ coordinator: Coordinator) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    if credential.wholeMatch(of: credentialPattern) != nil {
      let script = "try { window.localStorage.setItem('\(customerDisplayCredentialKey)', '\(credential)') } catch (e) {}"
      configuration.userContentController.addUserScript(
        WKUserScript(source: script, injectionTime: .atDocumentStart, forMainFrameOnly: true))
    }
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = coordinator
    view.load(URLRequest(url: url))
    return view
  }

  final class Coordinator: NSObject, WKNavigationDelegate {
    let returnPath: String
    let onReturn: @MainActor () -> Void

    init(returnPath: String, onReturn: @escaping @MainActor () -> Void) {
      self.returnPath = returnPath
      self.onReturn = onReturn
    }

    func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
      decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
      // The page is done: back to the native display, never to the console's own display page.
      if action.targetFrame?.isMainFrame != false, action.request.url?.path == returnPath {
        decisionHandler(.cancel)
        let done = onReturn
        Task { @MainActor in done() }
        return
      }
      decisionHandler(.allow)
    }
  }
}

#if os(iOS)
  extension PosDisplayPluginScreen: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateUIView(_ view: WKWebView, context: Context) {}
  }
#elseif os(macOS)
  extension PosDisplayPluginScreen: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateNSView(_ view: WKWebView, context: Context) {}
  }
#endif
