import { MusicPlayer } from "./MusicPlayer";

function silencePlayRejections() {
    // jsdom's HTMLMediaElement.play() always rejects ("not implemented"); MusicPlayer already
    // catches and logs this, matching what real browsers do for an autoplay-policy rejection.
    jest.spyOn(console, "error").mockImplementation(() => {});
}

beforeEach(() => {
    silencePlayRejections();
});

afterEach(() => {
    jest.restoreAllMocks();
});

test("defaults to half volume and enabled", () => {
    const player = new MusicPlayer();
    expect(player.volume).toBeCloseTo(0.5);
    expect(player.isEnabled).toBe(true);
});

test("clamps volume to the 0..1 range", () => {
    const player = new MusicPlayer();
    player.setVolume(1.5);
    expect(player.volume).toBe(1);
    player.setVolume(-1);
    expect(player.volume).toBe(0);
});

test("does not touch the audio element before unlock", () => {
    const player = new MusicPlayer();
    const playSpy = jest.spyOn(HTMLMediaElement.prototype, "play");
    player.setTrack("audio/harmony.opus");
    expect(playSpy).not.toHaveBeenCalled();
});

test("plays once unlocked after a track is set", () => {
    const player = new MusicPlayer();
    const playSpy = jest
        .spyOn(HTMLMediaElement.prototype, "play")
        .mockImplementation(() => Promise.resolve());
    player.setTrack("audio/harmony.opus");
    player.unlock();
    expect(playSpy).toHaveBeenCalledTimes(1);
});

test("plays immediately when the track changes after unlock", () => {
    const player = new MusicPlayer();
    const playSpy = jest
        .spyOn(HTMLMediaElement.prototype, "play")
        .mockImplementation(() => Promise.resolve());
    player.unlock();
    expect(playSpy).not.toHaveBeenCalled();
    player.setTrack("audio/harmony.opus");
    expect(playSpy).toHaveBeenCalledTimes(1);
});

test("setting the same track again is a no-op", () => {
    const player = new MusicPlayer();
    const playSpy = jest
        .spyOn(HTMLMediaElement.prototype, "play")
        .mockImplementation(() => Promise.resolve());
    player.unlock();
    player.setTrack("audio/harmony.opus");
    player.setTrack("audio/harmony.opus");
    expect(playSpy).toHaveBeenCalledTimes(1);
});

test("disabling pauses and re-enabling resumes", () => {
    const player = new MusicPlayer();
    const playSpy = jest
        .spyOn(HTMLMediaElement.prototype, "play")
        .mockImplementation(() => Promise.resolve());
    const pauseSpy = jest.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    player.setTrack("audio/harmony.opus");
    player.unlock();

    player.setEnabled(false);
    expect(pauseSpy).toHaveBeenCalledTimes(1);
    expect(player.isEnabled).toBe(false);

    player.setEnabled(true);
    expect(playSpy).toHaveBeenCalledTimes(2);
});

test("never plays while disabled even if unlocked", () => {
    const player = new MusicPlayer();
    const playSpy = jest
        .spyOn(HTMLMediaElement.prototype, "play")
        .mockImplementation(() => Promise.resolve());
    player.setEnabled(false);
    player.setTrack("audio/harmony.opus");
    player.unlock();
    expect(playSpy).not.toHaveBeenCalled();
});
