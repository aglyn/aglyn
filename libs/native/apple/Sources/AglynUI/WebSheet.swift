// Copyright 2026 Aglyn LLC
// SPDX-License-Identifier: Apache-2.0

import Observation
import SwiftUI
import WebKit

#if os(iOS)
  import UIKit
#elseif os(macOS)
  import AppKit
#endif

/// A plain web page the app shows (a site's live address, a preview, a docs
/// link), in the in-app web sheet.
public struct AglynWebPage: Identifiable, Hashable, Sendable {
  public let url: URL
  public var id: URL { url }

  public init(_ url: URL) { self.url = url }

  /// Whether the app shows this address in its web sheet: an http or https
  /// page. Mail, phone and app links keep going to the system.
  public static func opensInSheet(_ url: URL) -> Bool {
    ["http", "https"].contains(url.scheme?.lowercased() ?? "")
  }
}

/// The page a web sheet shows: what WebKit says about it, for the nav bar.
@MainActor
@Observable
public final class AglynWebSheetState {
  public var title = ""
  public var url: URL?
  public var canGoBack = false
  public var canGoForward = false
  public var loading = false
  weak var webView: WKWebView?
  private var observations: [NSKeyValueObservation] = []

  public init() {}

  func attach(_ webView: WKWebView) {
    self.webView = webView
    observations = [
      webView.observe(\.title) { [weak self] view, _ in MainActor.assumeIsolated { self?.title = view.title ?? "" } },
      webView.observe(\.url) { [weak self] view, _ in MainActor.assumeIsolated { self?.url = view.url } },
      webView.observe(\.canGoBack) { [weak self] view, _ in MainActor.assumeIsolated { self?.canGoBack = view.canGoBack } },
      webView.observe(\.canGoForward) { [weak self] view, _ in
        MainActor.assumeIsolated { self?.canGoForward = view.canGoForward }
      },
      webView.observe(\.isLoading) { [weak self] view, _ in MainActor.assumeIsolated { self?.loading = view.isLoading } },
    ]
  }

  public func back() { webView?.goBack() }
  public func forward() { webView?.goForward() }
  public func reload() { if loading { webView?.stopLoading() } else { webView?.reload() } }
}

/// Opens an address in the system browser, for the sheet's "Open in browser"
/// (never the environment's `openURL`, which the sheet itself answers).
@MainActor
public enum AglynSystemBrowser {
  public static func open(_ url: URL) {
    #if os(iOS)
      UIApplication.shared.open(url)
    #elseif os(macOS)
      NSWorkspace.shared.open(url)
    #endif
  }
}

/// The one in-app web sheet (AGL-3893): a page in a WKWebView under a nav bar
/// with its title, Done, back, forward and reload, and a menu with Open in
/// browser, Copy link and Share. A published page needs no sign-in, so it is
/// never shown through the sign-in session; only OAuth uses that.
public struct AglynWebSheet: View {
  let page: AglynWebPage
  @State private var state = AglynWebSheetState()
  @Environment(\.dismiss) private var dismiss

  public init(_ page: AglynWebPage) { self.page = page }

  private var current: URL { state.url ?? page.url }

  private var title: String {
    let trimmed = state.title.trimmingCharacters(in: .whitespacesAndNewlines)
    return trimmed.isEmpty ? (current.host() ?? current.absoluteString) : trimmed
  }

  public var body: some View {
    NavigationStack {
      AglynWebView(url: page.url, state: state)
        .ignoresSafeArea(edges: .bottom)
        .overlay(alignment: .top) {
          if state.loading { ProgressView().progressViewStyle(.linear).accessibilityLabel("Loading") }
        }
        .navigationTitle(title)
        #if os(iOS)
          .navigationBarTitleDisplayMode(.inline)
        #endif
        .toolbar {
          ToolbarItem(placement: .confirmationAction) {
            Button("Done") { dismiss() }
              .keyboardShortcut(.cancelAction)
              .accessibilityIdentifier("web-sheet-done")
          }
          #if os(iOS)
            ToolbarItemGroup(placement: .bottomBar) { navigation }
          #else
            ToolbarItemGroup(placement: .navigation) { navigation }
          #endif
          ToolbarItem(placement: .primaryAction) { menu }
        }
    }
    #if os(macOS)
      .frame(minWidth: 720, idealWidth: 1024, minHeight: 540, idealHeight: 760)
    #endif
    .accessibilityIdentifier("web-sheet")
  }

  @ViewBuilder
  private var navigation: some View {
    Button { state.back() } label: { Label("Back", systemImage: "chevron.backward") }
      .disabled(!state.canGoBack)
      .help("Back")
      .accessibilityIdentifier("web-sheet-back")
    Button { state.forward() } label: { Label("Forward", systemImage: "chevron.forward") }
      .disabled(!state.canGoForward)
      .help("Forward")
      .accessibilityIdentifier("web-sheet-forward")
    #if os(iOS)
      Spacer()
    #endif
    Button { state.reload() } label: {
      Label(state.loading ? "Stop" : "Reload", systemImage: state.loading ? "xmark" : "arrow.clockwise")
    }
    .help(state.loading ? "Stop loading" : "Reload")
    .accessibilityIdentifier("web-sheet-reload")
  }

  private var menu: some View {
    Menu {
      Button {
        AglynSystemBrowser.open(current)
      } label: {
        Label("Open in browser", systemImage: "safari")
      }
      .accessibilityIdentifier("web-sheet-open-browser")
      Button {
        AglynClipboard.copy(current.absoluteString)
      } label: {
        Label("Copy link", systemImage: "link")
      }
      .accessibilityIdentifier("web-sheet-copy")
      ShareLink(item: current) {
        Label("Share…", systemImage: "square.and.arrow.up")
      }
      .accessibilityIdentifier("web-sheet-share")
    } label: {
      Label("More", systemImage: "ellipsis.circle")
    }
    .help("Open in browser, copy or share this page")
    .accessibilityIdentifier("web-sheet-menu")
  }
}

/// The WKWebView behind the sheet: a non-persistent store, so nothing the
/// page sets outlives the sheet, and every non-web link handed to the system.
struct AglynWebView {
  let url: URL
  let state: AglynWebSheetState

  @MainActor
  func makeWebView(_ coordinator: Coordinator) -> WKWebView {
    let configuration = WKWebViewConfiguration()
    configuration.websiteDataStore = .nonPersistent()
    let view = WKWebView(frame: .zero, configuration: configuration)
    view.navigationDelegate = coordinator
    view.uiDelegate = coordinator
    view.allowsBackForwardNavigationGestures = true
    state.attach(view)
    view.load(URLRequest(url: url))
    return view
  }

  func makeCoordinator() -> Coordinator { Coordinator() }

  final class Coordinator: NSObject, WKNavigationDelegate, WKUIDelegate {
    @MainActor
    func webView(
      _ webView: WKWebView, decidePolicyFor action: WKNavigationAction,
      decisionHandler: @escaping @MainActor (WKNavigationActionPolicy) -> Void
    ) {
      guard let url = action.request.url else { return decisionHandler(.allow) }
      if AglynWebPage.opensInSheet(url) || url.scheme == "about" || url.scheme == "blob" || url.scheme == "data" {
        return decisionHandler(.allow)
      }
      // mailto:, tel:, an App Store link: the system's.
      AglynSystemBrowser.open(url)
      decisionHandler(.cancel)
    }

    /// A link that asks for a new window opens in this one.
    @MainActor
    func webView(
      _ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction,
      windowFeatures: WKWindowFeatures
    ) -> WKWebView? {
      if action.targetFrame == nil, let url = action.request.url { webView.load(URLRequest(url: url)) }
      return nil
    }
  }
}

#if os(iOS)
  extension AglynWebView: UIViewRepresentable {
    func makeUIView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateUIView(_ view: WKWebView, context: Context) {}
  }
#elseif os(macOS)
  extension AglynWebView: NSViewRepresentable {
    func makeNSView(context: Context) -> WKWebView { makeWebView(context.coordinator) }
    func updateNSView(_ view: WKWebView, context: Context) {}
  }
#endif

/// Shows every plain web address opened under this view (`openURL`, `Link`,
/// a Markdown link) in the in-app web sheet; mail, phone and app links still
/// go to the system. Install it at each window's root and inside each sheet
/// (a sheet presents its own).
struct AglynWebSheetHost: ViewModifier {
  @State private var page: AglynWebPage?

  func body(content: Content) -> some View {
    content
      .environment(
        \.openURL,
        OpenURLAction { url in
          guard AglynWebPage.opensInSheet(url) else { return .systemAction }
          page = AglynWebPage(url)
          return .handled
        }
      )
      .sheet(item: $page) { page in AglynWebSheet(page) }
  }
}

extension View {
  /// Plain web links opened under this view show in the in-app web sheet (see `AglynWebSheetHost`).
  public func aglynWebSheetHost() -> some View { modifier(AglynWebSheetHost()) }
}
