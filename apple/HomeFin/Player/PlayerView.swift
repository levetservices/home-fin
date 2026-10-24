import AVKit
import HomeFinKit
import MediaPlayer
import SwiftUI
#if os(iOS)
import UIKit
#endif

extension View {
    /// Shows the player when `model.nowPlaying` is set: full screen (landscape) on iPhone and iPad,
    /// a big sheet on the Mac. Attached at the root and on the title sheet; whichever was on top
    /// when Play was pressed presents it.
    func playerPresentation(overDetail: Bool) -> some View {
        modifier(PlayerPresentation(overDetail: overDetail))
    }
}

private struct PlayerPresentation: ViewModifier {
    var overDetail: Bool
    @Environment(AppModel.self) private var model

    func body(content: Content) -> some View {
        let binding = Binding<Item?>(
            get: { model.playerOverDetail == overDetail ? model.nowPlaying : nil },
            set: { if $0 == nil { model.nowPlaying = nil } }
        )
        #if os(iOS)
        content.fullScreenCover(item: binding) { item in
            PlayerView(item: item).environment(model)
        }
        #else
        content.sheet(item: binding) { item in
            PlayerView(item: item)
                .environment(model)
                .frame(minWidth: 960, idealWidth: 1280, minHeight: 540, idealHeight: 720)
        }
        #endif
    }
}

/// Netflix's player: the video edge to edge, controls on top that fade away, and panels for
/// speed, episodes and audio & subtitles.
struct PlayerView: View {
    var item: Item
    @Environment(AppModel.self) private var model
    @Environment(\.dismiss) private var dismiss
    @State private var engine = PlaybackEngine()
    @State private var controlsVisible = true
    @State private var locked = false
    @State private var fill = false
    @State private var panel: Panel?
    @State private var scrubbing: Double?
    @State private var hideTask: Task<Void, Never>?
    @State private var skipFlash: (forward: Bool, id: Int)?
    #if os(iOS)
    @State private var brightness = Double(UIScreen.main.brightness)
    #endif

    enum Panel { case speed, tracks, episodes }

    var body: some View {
        ZStack {
            Color.black.ignoresSafeArea()
            if let player = engine.player {
                VideoSurface(player: player, fill: fill) { engine.pip = $0 }
                    .ignoresSafeArea()
                    .transition(.opacity)
            }
            tapLayer
            if engine.buffering && engine.error == nil {
                ProgressView().controlSize(.large).tint(.white).allowsHitTesting(false)
            }
            if let flash = skipFlash {
                SkipFlash(forward: flash.forward)
                    .id(flash.id)
                    .frame(maxWidth: .infinity, alignment: flash.forward ? .trailing : .leading)
                    .padding(.horizontal, 90)
                    .allowsHitTesting(false)
            }
            if let error = engine.error {
                errorView(error)
            } else if locked {
                lockedOverlay
            } else if controlsVisible && panel == nil {
                controls.transition(.opacity)
            }
            if let panel {
                panelView(panel)
                    .transition(.move(edge: .bottom).combined(with: .opacity))
            }
        }
        .foregroundStyle(.white)
        .animation(.easeInOut(duration: 0.25), value: controlsVisible)
        .animation(Theme.spring, value: panel)
        .animation(Theme.spring, value: locked)
        #if os(iOS)
        .statusBarHidden()
        .persistentSystemOverlays(.hidden)
        #endif
        .onContinuousHover { phase in
            if case .active = phase { showControls() }
        }
        .task {
            #if os(iOS)
            Orientation.lock(.landscape)
            #endif
            await engine.start(item, model: model)
            scheduleHide()
        }
        .onDisappear {
            #if os(iOS)
            Orientation.lock(.portrait)
            UIScreen.main.brightness = CGFloat(brightness)
            #endif
            Task {
                await engine.stop()
                model.homeRevision += 1
            }
        }
        .background { keyboardShortcuts }
    }

    // MARK: layers

    /// Tap to show / hide; double-tap either side to skip 10 seconds.
    private var tapLayer: some View {
        HStack(spacing: 0) {
            tapZone(forward: false)
            tapZone(forward: true)
        }
        .ignoresSafeArea()
        // Pinch out to fill the screen (crops the edges), pinch in to fit.
        .simultaneousGesture(MagnifyGesture().onEnded { value in
            withAnimation(.easeInOut(duration: 0.25)) { fill = value.magnification > 1 }
        })
    }

    private func tapZone(forward: Bool) -> some View {
        Color.clear
            .contentShape(Rectangle())
            .gesture(
                TapGesture(count: 2).onEnded {
                    guard !locked else { return }
                    skip(forward ? 10 : -10)
                }
                .exclusively(before: TapGesture().onEnded {
                    if locked { showControls() } else if panel != nil { panel = nil } else { toggleControls() }
                })
            )
    }

    private var controls: some View {
        ZStack {
            // Darken the top and bottom so the controls read over bright video.
            VStack {
                LinearGradient(colors: [.black.opacity(0.7), .clear], startPoint: .top, endPoint: .bottom).frame(height: 140)
                Spacer()
                LinearGradient(colors: [.clear, .black.opacity(0.75)], startPoint: .top, endPoint: .bottom).frame(height: 170)
            }
            .ignoresSafeArea()
            .allowsHitTesting(false)

            VStack(spacing: 0) {
                topBar
                Spacer()
                centreButtons
                Spacer()
                bottomBar
            }
            .padding(.horizontal, 28)
            .padding(.vertical, 18)

            #if os(iOS)
            if UIDevice.current.userInterfaceIdiom == .phone {
                BrightnessSlider(value: $brightness)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.leading, 34)
                    .onChange(of: brightness) { _, value in UIScreen.main.brightness = CGFloat(value) }
            }
            #endif
        }
    }

    private var topBar: some View {
        ZStack {
            HStack(spacing: 16) {
                Button { close() } label: {
                    Image(systemName: "xmark").font(.system(size: 22, weight: .semibold)).frame(width: 40, height: 40)
                }
                .buttonStyle(PressScaleStyle())
                .accessibilityLabel("Close")
                Text(engine.title)
                    .font(.system(size: 16, weight: .semibold))
                    .lineLimit(1)
                Spacer()
                RoutePickerButton().frame(width: 40, height: 40)
                if engine.pip != nil {
                    iconButton("pip.enter", label: "Picture in Picture") { engine.togglePictureInPicture() }
                }
                #if os(iOS)
                iconButton("lock.open", label: "Lock screen") {
                    locked = true
                    controlsVisible = false
                }
                #endif
            }
            GlassGroup(spacing: 8) {
                HStack(spacing: 8) {
                    rateButton("hand.thumbsdown", value: false)
                    rateButton("hand.thumbsup", value: true)
                }
            }
        }
    }

    private var centreButtons: some View {
        HStack(spacing: 90) {
            Button { skip(-10) } label: {
                Image(systemName: "gobackward.10").font(.system(size: 38, weight: .regular))
            }
            .accessibilityLabel("Back 10 seconds")
            Button { engine.togglePlay(); scheduleHide() } label: {
                Image(systemName: engine.isPlaying ? "pause.fill" : "play.fill")
                    .font(.system(size: 52))
                    .contentTransition(.symbolEffect(.replace))
                    .frame(width: 70, height: 70)
            }
            .accessibilityLabel(engine.isPlaying ? "Pause" : "Play")
            Button { skip(10) } label: {
                Image(systemName: "goforward.10").font(.system(size: 38, weight: .regular))
            }
            .accessibilityLabel("Forward 10 seconds")
        }
        .buttonStyle(PressScaleStyle())
        .shadow(color: .black.opacity(0.4), radius: 8)
    }

    private var bottomBar: some View {
        VStack(spacing: 14) {
            HStack(spacing: 14) {
                Scrubber(position: scrubbing ?? engine.position, duration: engine.duration, buffered: engine.buffered) { value in
                    scrubbing = value
                    hideTask?.cancel()
                } onEnd: { value in
                    Task {
                        await engine.seek(to: value)
                        scrubbing = nil
                        scheduleHide()
                    }
                }
                Text((engine.duration - (scrubbing ?? engine.position)).clockText)
                    .font(.system(size: 14, weight: .medium).monospacedDigit())
                    .frame(minWidth: 52, alignment: .trailing)
            }
            HStack(spacing: 30) {
                barButton("speedometer", "Speed (\(engine.rateLabel))") { panel = .speed }
                if !engine.episodes.isEmpty {
                    barButton("rectangle.stack", "Episodes") { panel = .episodes }
                }
                barButton("text.bubble", "Audio & Subtitles") { panel = .tracks }
                if engine.nextEpisode != nil {
                    barButton("forward.end", "Next Episode") { Task { await engine.playNext() } }
                }
            }
            .font(.system(size: 14, weight: .semibold))
        }
    }

    private var lockedOverlay: some View {
        VStack(spacing: 10) {
            Spacer()
            if controlsVisible {
                Button {
                    locked = false
                    showControls()
                } label: {
                    Image(systemName: "lock.fill").font(.system(size: 20)).frame(width: 52, height: 52)
                        .glass(in: Circle(), interactive: true)
                }
                .buttonStyle(PressScaleStyle())
                Text("Screen Locked").font(.system(size: 14, weight: .semibold))
                Text("Tap to unlock").font(.system(size: 12)).foregroundStyle(Theme.secondary)
            }
        }
        .padding(.bottom, 36)
        .transition(.opacity)
    }

    private func errorView(_ error: String) -> some View {
        VStack(spacing: 14) {
            Image(systemName: "exclamationmark.triangle").font(.largeTitle)
            Text("Can't play this").font(.title3.bold())
            Text(error).foregroundStyle(Theme.secondary).multilineTextAlignment(.center).frame(maxWidth: 420)
            Button("Close") { close() }.buttonStyle(PrimaryButtonStyle())
        }
        .padding(40)
    }

    // MARK: panels

    @ViewBuilder private func panelView(_ panel: Panel) -> some View {
        ZStack(alignment: .bottom) {
            Color.black.opacity(0.45).ignoresSafeArea().onTapGesture { self.panel = nil }
            VStack(alignment: .leading, spacing: 18) {
                HStack {
                    Text(panelTitle(panel)).font(.system(size: 20, weight: .bold))
                    Spacer()
                    GlassCircleButton(systemImage: "xmark", size: 38, label: "Close") { self.panel = nil }
                }
                switch panel {
                case .speed: speedPanel
                case .tracks: tracksPanel
                case .episodes: episodesPanel
                }
            }
            .padding(22)
            .frame(maxWidth: 760)
            .glass(in: RoundedRectangle(cornerRadius: 28, style: .continuous))
            .padding(.horizontal, 24)
            .padding(.bottom, 16)
        }
    }

    private func panelTitle(_ panel: Panel) -> String {
        switch panel {
        case .speed: return "Playback Speed"
        case .tracks: return "Audio & Subtitles"
        case .episodes: return engine.seasonName ?? "Episodes"
        }
    }

    private var speedPanel: some View {
        HStack(spacing: 0) {
            ForEach(PlaybackEngine.rates, id: \.self) { rate in
                Button {
                    engine.setRate(rate)
                } label: {
                    VStack(spacing: 10) {
                        Circle()
                            .fill(engine.rate == rate ? Color.white : .clear)
                            .overlay(Circle().stroke(.white, lineWidth: 2))
                            .frame(width: engine.rate == rate ? 26 : 16, height: engine.rate == rate ? 26 : 16)
                            .frame(height: 28)
                        Text(PlaybackEngine.label(for: rate) + (rate == 1 ? " (Normal)" : ""))
                            .font(.system(size: 14, weight: engine.rate == rate ? .bold : .regular))
                    }
                    .frame(maxWidth: .infinity)
                }
                .buttonStyle(.plain)
            }
        }
        .background(alignment: .top) {
            Rectangle().fill(.white.opacity(0.4)).frame(height: 2).padding(.top, 13).padding(.horizontal, 40)
        }
        .animation(Theme.spring, value: engine.rate)
    }

    private var tracksPanel: some View {
        HStack(alignment: .top, spacing: 30) {
            VStack(alignment: .leading, spacing: 12) {
                Text("Audio").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.secondary)
                if engine.audioStreams.isEmpty {
                    Text("Original").font(.system(size: 16))
                }
                ForEach(engine.audioStreams, id: \.index) { stream in
                    trackRow(stream.displayTitle ?? stream.language ?? "Track \(stream.index ?? 0)", selected: engine.audioIndex == stream.index) {
                        Task { await engine.changeTracks(audio: stream.index, subtitle: engine.subtitleIndex) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            VStack(alignment: .leading, spacing: 12) {
                Text("Subtitles").font(.system(size: 15, weight: .bold)).foregroundStyle(Theme.secondary)
                trackRow("Off", selected: (engine.subtitleIndex ?? -1) < 0) {
                    Task { await engine.changeTracks(audio: engine.audioIndex, subtitle: -1) }
                }
                ForEach(engine.subtitleStreams, id: \.index) { stream in
                    trackRow(stream.displayTitle ?? stream.language ?? "Subtitles", selected: engine.subtitleIndex == stream.index) {
                        Task { await engine.changeTracks(audio: engine.audioIndex, subtitle: stream.index) }
                    }
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .frame(maxHeight: 260)
    }

    private func trackRow(_ title: String, selected: Bool, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 10) {
                Image(systemName: "checkmark").opacity(selected ? 1 : 0).font(.system(size: 14, weight: .bold))
                Text(title).font(.system(size: 16, weight: selected ? .bold : .regular)).lineLimit(1)
            }
        }
        .buttonStyle(.plain)
        .disabled(engine.plan?.isOffline == true)
    }

    private var episodesPanel: some View {
        ScrollViewReader { reader in
            ScrollView(.horizontal) {
                LazyHStack(spacing: 12) {
                    ForEach(engine.episodes) { episode in
                        Button {
                            panel = nil
                            Task { await engine.jump(to: episode) }
                        } label: {
                            VStack(alignment: .leading, spacing: 6) {
                                Artwork(url: model.jellyfin?.landscapeURL(episode, maxWidth: 400, preferEpisodeStill: true))
                                    .frame(width: 190, height: 107)
                                    .overlay(alignment: .bottom) {
                                        if let progress = episode.progress { ProgressBar(value: progress).padding(6) }
                                    }
                                    .overlay {
                                        if episode.id == engine.current?.id {
                                            RoundedRectangle(cornerRadius: 6).stroke(.white, lineWidth: 3)
                                        }
                                    }
                                    .clipShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
                                Text("\(episode.indexNumber.map { "\($0). " } ?? "")\(episode.name ?? "")")
                                    .font(.system(size: 14, weight: .semibold))
                                    .lineLimit(1)
                                    .frame(width: 190, alignment: .leading)
                            }
                        }
                        .buttonStyle(CardButtonStyle())
                        .id(episode.id)
                    }
                }
            }
            .scrollIndicators(.hidden)
            .onAppear {
                if let id = engine.current?.id { reader.scrollTo(id, anchor: .center) }
            }
        }
    }

    // MARK: little parts

    private func iconButton(_ symbol: String, label: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Image(systemName: symbol).font(.system(size: 20, weight: .medium)).frame(width: 40, height: 40)
        }
        .buttonStyle(PressScaleStyle())
        .accessibilityLabel(label)
    }

    private func rateButton(_ symbol: String, value: Bool) -> some View {
        let selected = engine.current?.userData?.likes == value
        return Button {
            Task { await engine.rate(selected ? nil : value) }
        } label: {
            Image(systemName: selected ? symbol + ".fill" : symbol)
                .font(.system(size: 16))
                .frame(width: 38, height: 38)
                .glass(in: Circle(), interactive: true)
        }
        .buttonStyle(PressScaleStyle())
    }

    private func barButton(_ symbol: String, _ title: String, action: @escaping () -> Void) -> some View {
        Button {
            action()
            hideTask?.cancel()
        } label: {
            Label(title, systemImage: symbol).labelStyle(TightLabelStyle())
        }
        .buttonStyle(PressScaleStyle())
    }

    /// Space, arrows and Escape on a keyboard (Mac, iPad).
    private var keyboardShortcuts: some View {
        ZStack {
            Button("") { engine.togglePlay() }.keyboardShortcut(.space, modifiers: [])
            Button("") { skip(-10) }.keyboardShortcut(.leftArrow, modifiers: [])
            Button("") { skip(10) }.keyboardShortcut(.rightArrow, modifiers: [])
            Button("") { close() }.keyboardShortcut(.cancelAction)
        }
        .opacity(0)
        .accessibilityHidden(true)
    }

    // MARK: behaviour

    private func close() {
        Task { await engine.stop() }
        dismiss()
    }

    private func skip(_ seconds: Double) {
        skipFlash = (forward: seconds > 0, id: (skipFlash?.id ?? 0) + 1)
        Task { await engine.seek(to: engine.position + seconds) }
        scheduleHide()
    }

    private func toggleControls() {
        controlsVisible.toggle()
        if controlsVisible { scheduleHide() }
    }

    private func showControls() {
        controlsVisible = true
        scheduleHide()
    }

    /// Controls fade after a few seconds of playing.
    private func scheduleHide() {
        hideTask?.cancel()
        #if DEBUG
        // Keep the controls up for screenshots.
        if DemoMode.isOn { return }
        #endif
        hideTask = Task {
            try? await Task.sleep(for: .seconds(4))
            guard !Task.isCancelled, engine.isPlaying, panel == nil, scrubbing == nil else { return }
            controlsVisible = false
        }
    }
}

// MARK: - Engine

/// The AVPlayer and the Jellyfin side of playback: the plan, progress, tracks, next episode, and
/// downloads played (and their position kept) offline.
@MainActor
@Observable
final class PlaybackEngine {
    static let rates: [Float] = [0.5, 0.75, 1, 1.25, 1.5]

    var player: AVPlayer?
    var error: String?
    private(set) var current: Item?
    private(set) var plan: PlaybackPlan?
    var isPlaying = false
    var buffering = true
    /// Seconds into the title.
    var position: Double = 0
    var duration: Double = 0
    var buffered: Double = 0
    var rate: Float = 1
    var episodes: [Item] = []
    var seasonName: String?
    var nextEpisode: Item?
    var pip: AVPictureInPictureController?

    @ObservationIgnored private weak var model: AppModel?
    @ObservationIgnored private var timeObserver: Any?
    @ObservationIgnored private var endObserver: NSObjectProtocol?
    @ObservationIgnored private var lastSave = Date.distantPast
    @ObservationIgnored private var stopped = false
    private let nowPlaying = NowPlayingInfo()

    var title: String {
        guard let current else { return "" }
        if current.isEpisode { return "\(current.episodeCode ?? "") “\(current.name ?? "")”" }
        return current.name ?? ""
    }

    var rateLabel: String { Self.label(for: rate) }
    static func label(for rate: Float) -> String { rate == 1 ? "1x" : String(format: "%gx", rate) }

    var audioStreams: [MediaStream] { plan?.audioStreams ?? [] }
    var subtitleStreams: [MediaStream] { plan?.subtitleStreams ?? [] }
    var audioIndex: Int? { plan?.audioStreamIndex }
    var subtitleIndex: Int? { plan?.subtitleStreamIndex }

    // MARK: starting

    func start(_ item: Item, model: AppModel) async {
        self.model = model
        nowPlaying.attach(self)
        do {
            var target = item
            if item.isSeries {
                guard let jellyfin = model.jellyfin, let episode = try await jellyfin.episodeToPlay(seriesId: item.id) else {
                    throw HomeFinError(message: "This series has no episodes yet.")
                }
                target = episode
            }
            try await open(target, at: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    /// Plays `item` from `seconds` (nil = its resume point): the downloaded file when there is
    /// one, otherwise a stream.
    private func open(_ item: Item, at seconds: Double?, audio: Int? = nil, subtitle: Int? = nil) async throws {
        guard let model else { return }
        stopped = false
        var item = item
        var plan: PlaybackPlan
        #if DEBUG
        if DemoMode.isOn, let clip = DemoMode.clip, let jellyfin = model.jellyfin {
            // The demo plays its bundled clip, partway in, with the title's real tracks listed.
            item = (try? await jellyfin.item(item.id)) ?? item
            let source = item.mediaSources?.first
            plan = PlaybackPlan(url: clip, itemId: item.id, mediaSourceId: item.id, playMethod: "DirectPlay", startSeconds: 6)
            plan.audioStreams = source?.audioStreams ?? []
            plan.subtitleStreams = source?.subtitleStreams ?? []
            plan.audioStreamIndex = source?.defaultAudioStreamIndex
            plan.subtitleStreamIndex = -1
        } else if let file = model.downloads.localFile(for: item.id), audio == nil, subtitle == nil {
            let record = model.downloads.record(item.id)
            if let record, record.needsSync || model.isOffline { item = record.playableItem }
            plan = PlaybackPlan(url: file, itemId: item.id, mediaSourceId: item.id, playMethod: "DirectPlay",
                                startSeconds: seconds ?? item.resumeSeconds)
        } else {
            guard let jellyfin = model.jellyfin, !model.isOffline else {
                throw HomeFinError(message: "You're offline, and this isn't downloaded.")
            }
            // Fresh details: the exact resume point and the media's tracks.
            item = (try? await jellyfin.item(item.id)) ?? item
            plan = try await jellyfin.playbackPlan(for: item, maxBitrate: model.maxBitrate, startSeconds: seconds,
                                                   audioStreamIndex: audio, subtitleStreamIndex: subtitle)
        }
        current = item
        self.plan = plan
        duration = item.runtimeSeconds

        let playerItem = AVPlayerItem(url: plan.url)
        playerItem.preferredForwardBufferDuration = 30
        let player = self.player ?? AVPlayer()
        player.replaceCurrentItem(with: playerItem)
        player.allowsExternalPlayback = true
        player.defaultRate = rate
        // Streams and files both run from 0:00 of the title, so resuming is a seek.
        if plan.startSeconds > 1 {
            _ = await player.seek(to: CMTime(seconds: plan.startSeconds, preferredTimescale: 600))
        }
        position = plan.startSeconds
        observe(player, item: playerItem)
        self.player = player
        player.play()
        if let jellyfin = model.jellyfin, !plan.isOffline { await jellyfin.reportStart(plan, seconds: plan.startSeconds) }
        nowPlaying.update(title: title, subtitle: item.seriesName, duration: duration, position: position, rate: 1)
        await loadEpisodes(for: item)
    }

    /// The episodes of this one's season, for the Episodes panel and Next Episode.
    private func loadEpisodes(for item: Item) async {
        guard item.isEpisode, let model else {
            episodes = []
            nextEpisode = nil
            return
        }
        if model.isOffline || model.jellyfin == nil {
            let downloaded = model.downloads.records(for: model.userId).map(\.item)
                .filter { $0.seriesId == item.seriesId && $0.parentIndexNumber == item.parentIndexNumber }
                .sorted { ($0.indexNumber ?? 0) < ($1.indexNumber ?? 0) }
            episodes = downloaded
        } else if let jellyfin = model.jellyfin, let seriesId = item.seriesId, let seasonId = item.seasonId {
            episodes = (try? await jellyfin.episodes(seriesId: seriesId, seasonId: seasonId)) ?? []
        }
        seasonName = item.parentIndexNumber.map { "Season \($0)" }
        if let index = episodes.firstIndex(where: { $0.id == item.id }), index + 1 < episodes.count {
            nextEpisode = episodes[index + 1]
        } else if let jellyfin = model.jellyfin, !model.isOffline, let seriesId = item.seriesId,
                  let next = try? await jellyfin.items(["ParentId": seriesId, "IncludeItemTypes": "Episode",
                                                        "SortBy": "ParentIndexNumber,IndexNumber", "Limit": "200"]),
                  let index = next.firstIndex(where: { $0.id == item.id }), index + 1 < next.count {
            // The first episode of the next season.
            nextEpisode = next[index + 1]
        } else {
            nextEpisode = nil
        }
    }

    // MARK: controls

    func togglePlay() {
        guard let player else { return }
        if player.timeControlStatus == .paused { player.play() } else { player.pause() }
        tick()
        Task { await saveProgress(force: true) }
    }

    func seek(to seconds: Double) async {
        guard let player else { return }
        let target = max(0, min(seconds, max(0, duration - 2)))
        position = target
        _ = await player.seek(to: CMTime(seconds: target, preferredTimescale: 600), toleranceBefore: .zero, toleranceAfter: CMTime(seconds: 1, preferredTimescale: 600))
        nowPlaying.update(title: title, subtitle: current?.seriesName, duration: duration, position: target, rate: Double(player.rate))
    }

    func setRate(_ rate: Float) {
        self.rate = rate
        player?.defaultRate = rate
        if player?.timeControlStatus != .paused { player?.rate = rate }
    }

    /// New audio / subtitle choice: the server makes a stream with those tracks, from here.
    func changeTracks(audio: Int?, subtitle: Int?) async {
        guard let current else { return }
        let resumeAt = position
        await saveProgress(force: true)
        if let plan, let jellyfin = model?.jellyfin, !plan.isOffline { await jellyfin.reportStopped(plan, seconds: resumeAt) }
        do {
            try await open(current, at: resumeAt, audio: audio, subtitle: subtitle)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func playNext() async {
        guard let next = nextEpisode else { return }
        await jump(to: next)
    }

    func jump(to episode: Item) async {
        await finishCurrent()
        do {
            try await open(episode, at: nil)
        } catch {
            self.error = error.localizedDescription
        }
    }

    func rate(_ likes: Bool?) async {
        guard var item = current, let jellyfin = model?.jellyfin else { return }
        let target = item.isEpisode ? (item.seriesId ?? item.id) : item.id
        try? await jellyfin.setRating(target, likes: likes)
        if item.userData == nil { item.userData = UserItemData() }
        item.userData?.likes = likes
        current = item
    }

    func togglePictureInPicture() {
        guard let pip else { return }
        if pip.isPictureInPictureActive { pip.stopPictureInPicture() } else { pip.startPictureInPicture() }
    }

    // MARK: progress

    private func observe(_ player: AVPlayer, item: AVPlayerItem) {
        if let timeObserver { player.removeTimeObserver(timeObserver) }
        timeObserver = player.addPeriodicTimeObserver(forInterval: CMTime(seconds: 0.5, preferredTimescale: 600), queue: .main) { [weak self] _ in
            MainActor.assumeIsolated { self?.tick() }
        }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        endObserver = NotificationCenter.default.addObserver(forName: AVPlayerItem.didPlayToEndTimeNotification, object: item, queue: .main) { [weak self] _ in
            MainActor.assumeIsolated {
                guard let self else { return }
                Task { await self.ended() }
            }
        }
    }

    private func tick() {
        guard let player else { return }
        let seconds = player.currentTime().seconds
        if seconds.isFinite { position = seconds }
        if let range = player.currentItem?.loadedTimeRanges.last?.timeRangeValue {
            buffered = (range.start + range.duration).seconds
        }
        isPlaying = player.timeControlStatus == .playing
        buffering = player.timeControlStatus == .waitingToPlayAtSpecifiedRate
        if Date().timeIntervalSince(lastSave) > 10 {
            Task { await saveProgress(force: false) }
        }
    }

    /// Every ~10 seconds: to the server when streaming, to the device for a download.
    private func saveProgress(force: Bool) async {
        guard let plan, let model else { return }
        guard force || Date().timeIntervalSince(lastSave) > 10 else { return }
        lastSave = Date()
        if plan.isOffline {
            model.downloads.savePosition(plan.itemId, seconds: position, played: isFinished)
        } else if let jellyfin = model.jellyfin {
            await jellyfin.reportProgress(plan, seconds: position, paused: !isPlaying)
        }
        nowPlaying.update(title: title, subtitle: current?.seriesName, duration: duration, position: position, rate: isPlaying ? Double(rate) : 0)
    }

    private var isFinished: Bool { duration > 0 && position / duration > 0.92 }

    /// Reports the title as stopped (online), or keeps its position (download).
    private func finishCurrent() async {
        guard let plan, let model else { return }
        if plan.isOffline {
            model.downloads.savePosition(plan.itemId, seconds: position, played: isFinished)
            if let jellyfin = model.jellyfin, !model.isOffline { await model.downloads.sync(with: jellyfin) }
        } else if let jellyfin = model.jellyfin {
            await jellyfin.reportStopped(plan, seconds: position)
        }
    }

    private func ended() async {
        if nextEpisode != nil {
            await playNext()
        } else {
            isPlaying = false
            await finishCurrent()
        }
    }

    func stop() async {
        guard !stopped else { return }
        stopped = true
        player?.pause()
        await finishCurrent()
        if let timeObserver { player?.removeTimeObserver(timeObserver) }
        if let endObserver { NotificationCenter.default.removeObserver(endObserver) }
        timeObserver = nil
        endObserver = nil
        nowPlaying.clear()
    }
}

// MARK: - Pieces

/// The red scrubber: drag to seek, with the time under your finger.
struct Scrubber: View {
    var position: Double
    var duration: Double
    var buffered: Double
    var onChange: (Double) -> Void
    var onEnd: (Double) -> Void
    @State private var dragging = false

    var body: some View {
        GeometryReader { proxy in
            let width = proxy.size.width
            let fraction = duration > 0 ? min(1, max(0, position / duration)) : 0
            let loaded = duration > 0 ? min(1, max(0, buffered / duration)) : 0
            ZStack(alignment: .leading) {
                Capsule().fill(.white.opacity(0.3)).frame(height: dragging ? 6 : 4)
                Capsule().fill(.white.opacity(0.45)).frame(width: width * loaded, height: dragging ? 6 : 4)
                Capsule().fill(Theme.brand).frame(width: width * fraction, height: dragging ? 6 : 4)
                Circle().fill(Theme.brand)
                    .frame(width: dragging ? 26 : 18, height: dragging ? 26 : 18)
                    .offset(x: width * fraction - (dragging ? 13 : 9))
                if dragging {
                    Text(position.clockText)
                        .font(.system(size: 13, weight: .semibold).monospacedDigit())
                        .padding(.horizontal, 8).padding(.vertical, 4)
                        .glass(in: Capsule())
                        .offset(x: min(max(0, width * fraction - 28), width - 56), y: -34)
                }
            }
            .frame(height: 30)
            .contentShape(Rectangle())
            .gesture(
                DragGesture(minimumDistance: 0)
                    .onChanged { value in
                        dragging = true
                        onChange(duration * min(1, max(0, value.location.x / width)))
                    }
                    .onEnded { value in
                        dragging = false
                        onEnd(duration * min(1, max(0, value.location.x / width)))
                    }
            )
            .animation(Theme.spring, value: dragging)
        }
        .frame(height: 30)
        .accessibilityElement()
        .accessibilityLabel("Playback position")
        .accessibilityValue(position.clockText)
    }
}

/// "‹‹ 10" flashing on the side you double-tapped.
struct SkipFlash: View {
    var forward: Bool
    @State private var shown = true

    var body: some View {
        Image(systemName: forward ? "goforward.10" : "gobackward.10")
            .font(.system(size: 34))
            .frame(width: 90, height: 90)
            .glass(in: Circle())
            .opacity(shown ? 1 : 0)
            .scaleEffect(shown ? 1 : 1.25)
            .onAppear {
                withAnimation(.easeOut(duration: 0.6).delay(0.25)) { shown = false }
            }
    }
}

#if os(iOS)
/// The sun slider down the left edge (iPhone).
struct BrightnessSlider: View {
    @Binding var value: Double

    var body: some View {
        VStack(spacing: 10) {
            Image(systemName: "sun.max").font(.system(size: 16))
            GeometryReader { proxy in
                ZStack(alignment: .bottom) {
                    Capsule().fill(.white.opacity(0.3))
                    Capsule().fill(.white).frame(height: proxy.size.height * value)
                }
                .contentShape(Rectangle())
                .gesture(DragGesture(minimumDistance: 0).onChanged { drag in
                    value = min(1, max(0, 1 - drag.location.y / proxy.size.height))
                })
            }
            .frame(width: 4, height: 110)
        }
        .frame(width: 44)
        .accessibilityElement()
        .accessibilityLabel("Brightness")
        .accessibilityValue("\(Int(value * 100)) percent")
        .accessibilityAdjustableAction { direction in
            value = min(1, max(0, value + (direction == .increment ? 0.1 : -0.1)))
        }
    }
}

final class PlayerLayerView: UIView {
    override class var layerClass: AnyClass { AVPlayerLayer.self }
    var playerLayer: AVPlayerLayer { layer as! AVPlayerLayer }
}

/// The video itself, on an AVPlayerLayer (so the controls can be ours), with Picture in Picture.
struct VideoSurface: UIViewRepresentable {
    var player: AVPlayer
    var fill: Bool
    var onPictureInPicture: (AVPictureInPictureController?) -> Void

    func makeUIView(context: Context) -> PlayerLayerView {
        let view = PlayerLayerView()
        view.backgroundColor = .black
        view.playerLayer.player = player
        view.playerLayer.videoGravity = fill ? .resizeAspectFill : .resizeAspect
        if AVPictureInPictureController.isPictureInPictureSupported() {
            let pip = AVPictureInPictureController(playerLayer: view.playerLayer)
            pip?.canStartPictureInPictureAutomaticallyFromInline = true
            DispatchQueue.main.async { onPictureInPicture(pip) }
        }
        return view
    }

    func updateUIView(_ view: PlayerLayerView, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
        view.playerLayer.videoGravity = fill ? .resizeAspectFill : .resizeAspect
    }
}

/// AirPlay.
struct RoutePickerButton: UIViewRepresentable {
    func makeUIView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.tintColor = .white
        view.activeTintColor = UIColor(Theme.brand)
        view.prioritizesVideoDevices = true
        return view
    }

    func updateUIView(_ view: AVRoutePickerView, context: Context) {}
}
#else
final class PlayerLayerView: NSView {
    let playerLayer = AVPlayerLayer()

    init() {
        super.init(frame: .zero)
        layer = playerLayer
        wantsLayer = true
        playerLayer.backgroundColor = NSColor.black.cgColor
    }

    required init?(coder: NSCoder) { nil }
}

struct VideoSurface: NSViewRepresentable {
    var player: AVPlayer
    var fill: Bool
    var onPictureInPicture: (AVPictureInPictureController?) -> Void

    func makeNSView(context: Context) -> PlayerLayerView {
        let view = PlayerLayerView()
        view.playerLayer.player = player
        view.playerLayer.videoGravity = fill ? .resizeAspectFill : .resizeAspect
        if AVPictureInPictureController.isPictureInPictureSupported() {
            let pip = AVPictureInPictureController(playerLayer: view.playerLayer)
            DispatchQueue.main.async { onPictureInPicture(pip) }
        }
        return view
    }

    func updateNSView(_ view: PlayerLayerView, context: Context) {
        if view.playerLayer.player !== player { view.playerLayer.player = player }
        view.playerLayer.videoGravity = fill ? .resizeAspectFill : .resizeAspect
    }
}

/// AirPlay.
struct RoutePickerButton: NSViewRepresentable {
    func makeNSView(context: Context) -> AVRoutePickerView {
        let view = AVRoutePickerView()
        view.isRoutePickerButtonBordered = false
        return view
    }

    func updateNSView(_ view: AVRoutePickerView, context: Context) {}
}
#endif

/// Lock screen / Control Centre: what's playing, play/pause and skip buttons.
@MainActor
final class NowPlayingInfo {
    private var attached = false

    func attach(_ engine: PlaybackEngine) {
        guard !attached else { return }
        attached = true
        let center = MPRemoteCommandCenter.shared()
        center.togglePlayPauseCommand.addTarget { [weak engine] _ in
            Task { @MainActor in engine?.togglePlay() }
            return .success
        }
        center.playCommand.addTarget { [weak engine] _ in
            Task { @MainActor in engine?.player?.play() }
            return .success
        }
        center.pauseCommand.addTarget { [weak engine] _ in
            Task { @MainActor in engine?.player?.pause() }
            return .success
        }
        center.skipForwardCommand.preferredIntervals = [10]
        center.skipForwardCommand.addTarget { [weak engine] _ in
            Task { @MainActor in
                guard let engine else { return }
                await engine.seek(to: engine.position + 10)
            }
            return .success
        }
        center.skipBackwardCommand.preferredIntervals = [10]
        center.skipBackwardCommand.addTarget { [weak engine] _ in
            Task { @MainActor in
                guard let engine else { return }
                await engine.seek(to: engine.position - 10)
            }
            return .success
        }
    }

    func update(title: String, subtitle: String?, duration: Double, position: Double, rate: Double) {
        var info: [String: Any] = [
            MPMediaItemPropertyTitle: title,
            MPMediaItemPropertyPlaybackDuration: duration,
            MPNowPlayingInfoPropertyElapsedPlaybackTime: position,
            MPNowPlayingInfoPropertyPlaybackRate: rate,
            MPNowPlayingInfoPropertyMediaType: MPNowPlayingInfoMediaType.video.rawValue
        ]
        if let subtitle { info[MPMediaItemPropertyArtist] = subtitle }
        MPNowPlayingInfoCenter.default().nowPlayingInfo = info
    }

    func clear() {
        MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
        let center = MPRemoteCommandCenter.shared()
        [center.togglePlayPauseCommand, center.playCommand, center.pauseCommand, center.skipForwardCommand, center.skipBackwardCommand]
            .forEach { $0.removeTarget(nil) }
        attached = false
    }
}
