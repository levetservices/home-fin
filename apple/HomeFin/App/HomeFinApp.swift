import AVFoundation
import HomeFinKit
import SwiftUI

@main
struct HomeFinApp: App {
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
                .frame(minWidth: 960, minHeight: 640)
                #endif
        }
        #if os(macOS)
        .windowStyle(.hiddenTitleBar)
        .commands {
            CommandGroup(replacing: .newItem) {}
        }
        #endif
    }
}

/// Picks the screen for where the app is: connecting, signing in, Who's watching?, or the app itself.
struct RootView: View {
    @Environment(AppModel.self) private var model

    var body: some View {
        ZStack {
            Theme.background.ignoresSafeArea()
            switch model.phase {
            case .launching:
                LaunchView()
            case .server:
                ServerView().transition(.opacity)
            case .signIn:
                SignInView().transition(.opacity)
            case .profiles:
                ProfilesView().transition(.opacity.combined(with: .scale(scale: 1.04)))
            case .main:
                MainView().transition(.opacity)
            }
        }
        .task { await model.start() }
        .playerPresentation()
    }
}

/// The wordmark, pulsing gently while the app checks who's signed in.
struct LaunchView: View {
    @State private var pulse = false

    var body: some View {
        Wordmark(size: 44)
            .opacity(pulse ? 1 : 0.55)
            .scaleEffect(pulse ? 1 : 0.96)
            .onAppear {
                withAnimation(.easeInOut(duration: 0.9).repeatForever(autoreverses: true)) { pulse = true }
            }
    }
}
