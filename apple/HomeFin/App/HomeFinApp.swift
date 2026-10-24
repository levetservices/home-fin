import AVFoundation
import HomeFinKit
import SwiftUI

@main
struct HomeFinApp: App {
    #if os(iOS)
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    #endif
    @State private var model = AppModel()

    init() {
        // Artwork is fetched a lot; keep plenty of it (Jellyfin sends cacheable images).
        URLCache.shared = URLCache(memoryCapacity: 96 * 1024 * 1024, diskCapacity: 768 * 1024 * 1024)
        #if os(iOS)
        // Play with the silent switch on, in the background, over AirPlay and in Picture in Picture.
        try? AVAudioSession.sharedInstance().setCategory(.playback, mode: .moviePlayback)
        #endif
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(model)
                .preferredColorScheme(.dark)
                .tint(.white)
                #if os(macOS)
                .frame(minWidth: 980, minHeight: 680)
                #endif
        }
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        .windowToolbarStyle(.unified(showsTitle: false))
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
        #endif
    }
}

#if os(iOS)
import UIKit

final class AppDelegate: NSObject, UIApplicationDelegate {
    func application(_ application: UIApplication, supportedInterfaceOrientationsFor window: UIWindow?) -> UIInterfaceOrientationMask {
        Orientation.allowed
    }

    func application(_ application: UIApplication, handleEventsForBackgroundURLSession identifier: String,
                     completionHandler: @escaping () -> Void) {
        BackgroundDownloadEvents.completion = completionHandler
    }
}

/// The player turns iPhones to landscape (like Netflix) and hands them back afterwards.
@MainActor
enum Orientation {
    static var allowed: UIInterfaceOrientationMask = UIDevice.current.userInterfaceIdiom == .phone ? .portrait : .all

    static func lock(_ mask: UIInterfaceOrientationMask) {
        guard UIDevice.current.userInterfaceIdiom == .phone else { return }
        allowed = mask
        guard let scene = UIApplication.shared.connectedScenes.compactMap({ $0 as? UIWindowScene }).first else { return }
        scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
        scene.requestGeometryUpdate(.iOS(interfaceOrientations: mask)) { _ in }
    }
}
#endif

/// Picks the screen for where the app is: welcome, signing in, Who's watching?, or the app itself.
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        @Bindable var model = model
        ZStack {
            Theme.background.ignoresSafeArea()
            switch model.phase {
            case .launching:
                LaunchView()
            case .welcome:
                WelcomeView().transition(.opacity)
            case .server:
                ServerView().transition(.move(edge: .trailing).combined(with: .opacity))
            case .signIn:
                SignInView().transition(.move(edge: .trailing).combined(with: .opacity))
            case .profiles:
                ProfilesView().transition(.opacity.combined(with: .scale(scale: 1.04)))
            case .main:
                MainView().transition(.opacity)
            }
        }
        .task { await model.start() }
        .sheet(item: $model.detail) { item in
            DetailView(item: item)
                .environment(model)
                .playerPresentation(overDetail: true)
                .detailPresentationStyle()
        }
        .playerPresentation(overDetail: false)
        .alert("Streaming is set to Wi-Fi only", isPresented: $model.streamingBlocked) {
            Button("OK", role: .cancel) {}
        } message: {
            Text("Connect to Wi-Fi, or change Mobile Data Usage in App Settings.")
        }
    }
}

extension View {
    /// The title page: a tall sheet on iPhone and iPad, a big window-sized sheet on the Mac.
    @ViewBuilder func detailPresentationStyle() -> some View {
        #if os(iOS)
        presentationDetents([.large])
            .presentationDragIndicator(.hidden)
            .presentationBackground(.black)
            .presentationCornerRadius(28)
        #else
        frame(minWidth: 760, idealWidth: 860, minHeight: 640, idealHeight: 820)
            .presentationBackground(.black)
        #endif
    }
}

/// The brand mark, pulsing gently while the app checks who's signed in.
struct LaunchView: View {
    @State private var pulse = false

    var body: some View {
        BrandMark(size: 120)
            .opacity(pulse ? 1 : 0.55)
            .scaleEffect(pulse ? 1 : 0.94)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
            }
    }
}
