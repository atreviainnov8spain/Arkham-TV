"use strict";

function createPlaybackStartup(video, onBlocked = () => {}, { trackDecodedFrames = false } = {}) {
  let startup;

  function cancel() {
    if (!startup) return;
    clearTimeout(startup.timer);
    if (startup.frame != null) video.cancelVideoFrameCallback(startup.frame);
    startup = undefined;
  }

  function blocked() {
    cancel();
    onBlocked();
  }

  function observe(attempt, time) {
    if (!attempt || video.paused || video.seeking) return;
    if (attempt.position == null || time < attempt.position) attempt.position = time;
    if (time - attempt.position >= 0.15) cancel();
  }

  function watchFrames(current) {
    current.frame = video.requestVideoFrameCallback((_, frame) => {
      if (startup !== current) return;
      current.frame = null;
      if (!document.hidden && video.getClientRects().length) observe(current.attempt, frame.mediaTime);
      if (startup === current) watchFrames(current);
    });
  }

  function play(current) {
    if (startup !== current || current.timer != null) return;
    const attempt = current.attempt = { position: null, clock: null };
    const restart = () => {
      current.timer = null;
      if (current.restarts >= 2) {
        blocked();
        return;
      }
      // A successful play() call can still leave WebKit on the first frame.
      current.restarts++;
      current.attempt = null;
      video.pause();
      current.timer = setTimeout(() => {
        current.timer = null;
        play(current);
      }, 120);
    };
    if (trackDecodedFrames) {
      watchDecodedFrames(current, restart);
    } else {
      current.timer = setTimeout(() => {
        current.timer = null;
        if (video.readyState < HTMLMediaElement.HAVE_METADATA) return;
        // Some WebKit video sinks can play without delivering frame callbacks.
        if (attempt.position == null && attempt.clock != null && !video.paused && !video.seeking &&
            video.currentTime - attempt.clock >= 0.15) {
          cancel();
          return;
        }
        restart();
      }, 1800);
    }
    video.play().catch((error) => {
      if (startup !== current || current.attempt !== attempt) return;
      if (error.name !== "AbortError" || current.aborts >= 3) {
        blocked();
        return;
      }
      current.aborts++;
      current.attempt = null;
      clearTimeout(current.timer);
      current.timer = setTimeout(() => {
        current.timer = null;
        playWhenReady();
      }, 180);
    });
  }

  function decodedFrames() {
    const quality = video.getVideoPlaybackQuality?.();
    return quality ? quality.totalVideoFrames - quality.droppedVideoFrames : null;
  }

  function watchDecodedFrames(current, restart) {
    let clock = video.currentTime;
    let frames = decodedFrames();
    let lastAdvance = performance.now();
    let stableSince = null;
    let buffering = false;

    function check() {
      const now = performance.now();
      const position = video.currentTime;
      const count = decodedFrames();
      const frameAdvanced = count === null || count > frames || document.hidden || !video.getClientRects().length;
      if (video.seeking || position < clock || count < frames) {
        clock = position;
        frames = count;
        stableSince = null;
      } else if (!video.paused && position - clock >= 0.1 && frameAdvanced) {
        clock = position;
        frames = count;
        lastAdvance = now;
        stableSince ??= now;
        buffering = false;
        if (now - stableSince >= 5000) {
          cancel();
          return;
        }
      }
      // Give a live stream more time when it is waiting for a new segment.
      buffering ||= !video.paused && video.readyState < HTMLMediaElement.HAVE_FUTURE_DATA;
      const stallLimit = buffering && !video.paused ? 4200 : 1800;
      if (now - lastAdvance >= stallLimit) restart();
      else current.timer = setTimeout(check, 250);
    }

    current.timer = setTimeout(check, 250);
  }

  function playWhenReady() {
    if (startup && video.readyState >= HTMLMediaElement.HAVE_FUTURE_DATA) play(startup);
  }

  function start(waitForData = false) {
    cancel();
    const current = startup = { aborts: 0, restarts: 0, attempt: null, timer: null, frame: null };
    if (!trackDecodedFrames && video.requestVideoFrameCallback) watchFrames(current);
    if (waitForData) playWhenReady();
    else play(current);
  }

  video.addEventListener("canplay", playWhenReady);
  video.addEventListener("seeking", () => {
    if (!startup?.attempt) return;
    startup.attempt.position = null;
    startup.attempt.clock = null;
  });
  video.addEventListener("timeupdate", () => {
    const attempt = startup?.attempt;
    if (trackDecodedFrames || !attempt || video.paused || video.seeking) return;
    if (!video.requestVideoFrameCallback || document.hidden || !video.getClientRects().length) {
      observe(attempt, video.currentTime);
    }
    attempt.clock ??= video.currentTime;
  });
  if (!trackDecodedFrames) video.addEventListener("ended", cancel);
  return { start, cancel };
}
