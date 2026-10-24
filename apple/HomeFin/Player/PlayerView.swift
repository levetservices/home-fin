import AVKit
import HomeFinKit
import SwiftUI

extension View {
    /// Shows the player over everything when `model.nowPlaying` is set: full screen on iPhone and
    /// iPad, a large sheet on the Mac.
    func playerPresentation() -> some View {
        modifier(PlayerPresentation())
    }
}

private struct PlayerPresentation: ViewModifier {
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        @Bindable var model = model
        #if os(iOS)
        content.fullScreenCover(item: $model.nowPlaying) { item in
            PlayerView(item: item).environment(model)
        }
        #else
        content.sheet(item: $model.nowPlaying) { item in
            PlayerView(item: item)
                .environment(model)
                .frame(minWidth: 960, idealWidth: 1280, minHeight: 540, idealHeight: 720)
        }
        #endif
    }
}

/// Plays a film or episode (a series plays its next episode), reports progress to Jellyfin and
/// rolls on to the next episode when one ends.
struct PlayerView: View {
    var item: Item
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var engine = PlaybackEngine()

    var body: some View {
        ZStack(alignment: .topLeading) {
            Color.black.ignoresSafeArea()
            if let player = engine.player {
                SystemPlayer(player: player)
                    .ignoresSafeArea()
                    .transition(.opacity)
            } else if let error = engine.error {
                VStack(spacing: 14) {
                    Image(systemName: "exclamationmark.triangle").font(.largeTitle)
                    Text("Can't play this").font(.title3.bold())
                    Text(error).foregroundStyle(Theme.secondary).multilineTextAlignment(.center)
                    Button("Close") { dismiss() }.buttonStyle(PrimaryButtonStyle())
                }
                .padding(40)
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            } else {
                VStack(spacing: 16) {
                    ProgressView().controlSize(.large).tint(.white)
                    Text(engine.title ?? item.name ?? "").foregroundStyle(Theme.secondary)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)
            }
            Button {
                Task { await engine.stop() }
                dismiss()
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 17, weight: .bold))
                    .padding(12)
                    .background(.ultraThinMaterial, in: Circle())
            }
            .buttonStyle(.plain)
            .padding(16)
            .keyboardShortcut(.cancelAction)
        }
        .foregroundStyle(.white)
        .animation(.easeOut(duration: 0.3), value: engine.player != nil)
        .task {
            guard let jellyfin = model.jellyfin else { return }
            await engine.start(item, jellyfin: jellyfin, maxBitrate: model.maxBitrate)
        }
        .onDisappear {
            Task {
                await engine.stop()
                model.homeRevision += 1
            }
        }
    }
}

/// The AVPlayer and the Jellyfin side of playback: the plan, progress reports, next episode.
@MainActor
@Observable
final class PlaybackEngine {
    var player: AVPlayer?
    var error: String?
    var title: String?

    private var plan: PlaybackPlan?
    private var current: Item?
    private var jellyfin: JellyfinClient?
    private var maxBitrate: Int?
    private var timeObserver: Any?
    private var endObserver: NSObjectProtocol?
    private var stopped = false

    func start(_ item: Item, jellyfin: JellyfinClient, maxBitrate: Int?) async {
        self.jellyfin = jellyfin
        self.maxBitrate = maxBitrate
        do {
            // A series plays its next episode; anything else is refreshed for an exact resume point.
            var target = item
            if item.isSeries {
                guard let episode = try await jellyfin.episodeToPlay(seriesId: item.id) else {
                    throw HomeFinError(message: "This series has no episodes yet.")
                }
                target = episode
            }
            target = (try? await jellyfin.item(target.id)) ?? target
            try await open(target)
        } catch {
            self.error = error.localizedDescription
        }
    }

    private func open(_ item: Item) async throws {
        guard let jellyfin else { return }
        current = item
        title = item.isEpisode ? "\(item.seriesName ?? "") \(item.episodeCode ?? "")" : item.name
        let plan = try await jellyfin.playbackPlan(for: item, maxBitrate: maxBitrate)
        self.plan = plan
        stopped = false

        let playerItem = AVPlayerItem(url: plan.url)
        playerItem.externalMetadata = metadata(for: item)
        let player = self.player ?? AVPlayer()
        player.replaceCurrentItem(with: playerItem)
        player.allowsExternalPlayback = true
        // Direct play starts at 0 and seeks; a transcode already starts at the resume point.
        if plan.playMethod == "DirectPlay", plan.startSeconds > 0 {
            _ = await player.seek(to: CMTime(seconds: plan.startSeconds, preferredTimescale: 600))
        }
        observe(player, item: playerItem)
        self.player = player
        player.play()
        await jellyfin.reportStart(plan, seconds: plan.startSeconds)
    }

    /// Seconds into the title (a transcode's clock starts at the resume point).
    private var position: Double {
        guard let player, let plan else { return 0 }
        let seconds = player.currentTime().seconds
        guard seconds.isFinite else { return plan.startSeconds }
        return plan.playMethod == "Transcode" ? plan.startSeconds + seconds : seconds
    }

    private func observe(_ player: AVPlayer, item: AVPlayerItem) {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 10, preferredTimescale: 1), queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self, let plan = self.plan, let jellyfin = self.jellyfin else { return }
                let seconds = self.position
                let paused = player.rate == 0
                Task { await jellyfin.reportProgress(plan, seconds: seconds, paused: paused) }
            }
        }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                Task { await self.playNext() }
            }
        }
    }

    /// An episode ended: report it, then on to the next one if there is one.
    private func playNext() async {
        guard let jellyfin, let plan, let finished = current else { return }
        await jellyfin.reportStopped(plan, seconds: position)
        guard finished.isEpisode, let seriesId = finished.seriesId,
              let next = try? await jellyfin.episodeToPlay(seriesId: seriesId), next.id != finished.id else { return }
        do {
            try await open(next)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func stop() async {
        guard !stopped else { return }
        stopped = true
        if let plan, let jellyfin { await jellyfin.reportStopped(plan, seconds: position) }
        player?.pause()
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        timeObserver = nil
        endObserver = nil
    }

    /// Title and description for the system player, Control Centre and the lock screen.
    private func metadata(for item: Item) -> [AVMetadataItem] {
        func entry(_ identifier: AVMetadataIdentifier, _ value: String?) -> AVMetadataItem? {
            guard let value else { return nil }
            let metadata = AVMutableMetadataItem()
            metadata.identifier = identifier
            metadata.value = value as NSString
            metadata.extendedLanguageTag = "und"
            return metadata
        }
        let title = item.isEpisode ? "\(item.episodeCode ?? "") \(item.name ?? "")" : item.name
        return [
            entry(.commonIdentifierTitle, title),
            entry(.iTunesMetadataTrackSubTitle, item.seriesName),
            entry(.commonIdentifierDescription, item.overview)
        ].compactMap { $0 }
    }
}

#if os(iOS)
/// Apple's player: controls, subtitles / audio menus, AirPlay and Picture in Picture.
struct SystemPlayer: UIViewControllerRepresentable {
    var player: AVPlayer

    func makeUIViewController(context: Context) -> AVPlayerViewController {
        let controller = AVPlayerViewController()
        controller.player = player
        controller.allowsPictureInPicturePlayback = true
        controller.canStartPictureInPictureAutomaticallyFromInline = true
        controller.entersFullScreenWhenPlaybackBegins = false
        controller.updatesNowPlayingInfoCenter = true
        return controller
    }

    func updateUIViewController(_ controller: AVPlayerViewController, context: Context) {
        if controller.player !== player { controller.player = player }
    }
}
#else
/// The Mac's player view, with full screen, Picture in Picture and AirPlay.
struct SystemPlayer: NSViewRepresentable {
    var player: AVPlayer

    func makeNSView(context: Context) -> AVPlayerView {
        let view = AVPlayerView()
        view.player = player
        view.controlsStyle = .floating
        view.allowsPictureInPicturePlayback = true
        view.showsFullScreenToggleButton = true
        view.updatesNowPlayingInfoCenter = true
        return view
    }

    func updateNSView(_ view: AVPlayerView, context: Context) {
        if view.player !== player { view.player = player }
    }
}
#endif
