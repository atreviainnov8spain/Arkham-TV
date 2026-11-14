"use strict";

(() => {
  const byId = id => document.getElementById(id);
  const english = document.documentElement.lang === "en";
  const t = (es, en) => english ? en : es;
  if (english) {
    for (const item of document.querySelectorAll("[data-en]")) item.textContent = item.dataset.en;
    for (const item of document.querySelectorAll("[data-en-label]")) item.setAttribute("aria-label", item.dataset.enLabel);
  }
  const orientation = matchMedia("(orientation: landscape)");
  const video = byId("video");
  const play = byId("mobile-play");
  const sound = byId("sound-toggle");
  const status = byId("player-status");
  const rotateStatus = byId("rotate-status");
  const rotateHint = rotateStatus.textContent;
  const guide = byId("guide");
  const guideToggle = byId("guide-toggle");
  const guideStatus = byId("guide-status");
  const list = byId("channel-list");
  const landscape = document.querySelector(".landscape-view");
  const fullscreen = byId("mobile-fullscreen");
  const appleMobile = /iPhone|iPad|iPod/.test(navigator.userAgent)
    || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  let snapshot = null;
  let source = null;
  let hls = null;
  let switching = false;
  let tuningVersion = 0;
  let ended = false;
  let playBlocked = false;
  let failed = false;
  let listKey = "";
  let muted = true;
  let nextPoll;
  let visible = true;
  let failures = 0;
  let expanded = true;
  let requestingFullscreen = false;

  function setExpanded(value) {
    expanded = value;
    landscape.classList.toggle("is-reduced", !value);
    fullscreen.querySelector(".expand-icon").toggleAttribute("hidden", value);
    fullscreen.querySelector(".collapse-icon").toggleAttribute("hidden", !value);
    fullscreen.setAttribute("aria-label", value
      ? t("Salir de pantalla completa", "Exit full screen")
      : t("Pantalla completa", "Full screen"));
  }

  function fullscreenElement() {
    return document.fullscreenElement || document.webkitFullscreenElement;
  }

  function exitNativeFullscreen() {
    if (fullscreenElement() === landscape) {
      const exit = document.exitFullscreen || document.webkitExitFullscreen;
      Promise.resolve(exit?.call(document)).catch(() => {});
    } else if (video.webkitDisplayingFullscreen) {
      video.webkitExitFullscreen?.();
    }
  }

  async function enterFullscreen(allowNativeVideo) {
    if (requestingFullscreen) return;
    requestingFullscreen = true;
    try {
      const request = landscape.requestFullscreen || landscape.webkitRequestFullscreen;
      if (request && (document.fullscreenEnabled || document.webkitFullscreenEnabled)) {
        await request.call(landscape, { navigationUI: "hide" });
        if (!expanded || !orientation.matches) exitNativeFullscreen();
      } else if (allowNativeVideo && appleMobile && video.webkitSupportsFullscreen) {
        video.webkitEnterFullscreen();
      }
    } catch {
      // Keep the player and guide in the available browser viewport.
    } finally {
      requestingFullscreen = false;
    }
  }

  function message(es, en) {
    const value = t(es, en);
    if (status.textContent !== value) status.textContent = value;
  }

  function setGuide(open, restoreFocus = false) {
    guide.hidden = !open;
    guideToggle.setAttribute("aria-expanded", String(open));
    if (restoreFocus) guideToggle.focus();
  }

  function guideMessage(value) {
    if (guideStatus.textContent !== value) guideStatus.textContent = value;
    guideStatus.hidden = !value;
  }

  function updateControls() {
    play.hidden = !source || (!playBlocked && !failed);
    sound.hidden = !source || failed;
    sound.firstElementChild.textContent = muted ? t("Activar sonido", "Turn on sound") : t("Silenciar", "Mute");
  }

  function unload() {
    source = null;
    playBlocked = failed = false;
    hls?.destroy();
    hls = null;
    video.pause();
    video.removeAttribute("src");
    video.load();
    updateControls();
  }

  function playbackFailed() {
    if (!source || !orientation.matches || ended) return;
    failed = true;
    message("No se pudo reproducir el directo.", "Could not play the live stream.");
    updateControls();
  }

  function playVideo() {
    const current = source;
    if (!current) return;
    video.play().catch(error => {
      if (source !== current || !orientation.matches || error.name === "AbortError") return;
      playBlocked = error.name === "NotAllowedError";
      if (playBlocked) updateControls();
      else playbackFailed();
    });
  }

  function attach(url) {
    if (!url || source?.url === url) return;
    if (source) unload();
    const current = source = { url };
    video.muted = muted;
    message("Cargando emisión…", "Loading live TV…");
    const nativeHLS = video.canPlayType("application/vnd.apple.mpegurl");
    if (nativeHLS && appleMobile) {
      video.src = url;
      playVideo();
    } else if (window.Hls && Hls.isSupported()) {
      hls = new Hls({ enableWorker: false, liveSyncDurationCount: 3, backBufferLength: 12 });
      hls.on(Hls.Events.ERROR, (_, error) => {
        if (source === current && error.fatal) playbackFailed();
      });
      hls.once(Hls.Events.MEDIA_ATTACHED, () => {
        if (source === current) {
          hls.loadSource(url);
          playVideo();
        }
      });
      hls.attachMedia(video);
    } else if (nativeHLS) {
      video.src = url;
      playVideo();
    } else {
      playbackFailed();
    }
    updateControls();
  }

  function syncPlayer() {
    if (!orientation.matches || ended) {
      if (source) unload();
      return;
    }
    if (snapshot?.url) attach(snapshot.url);
    else {
      if (source) unload();
      message("Esperando la emisión del ordenador…", "Waiting for live TV from the computer…");
    }
  }

  function render(data) {
    snapshot = data;
    const selected = data.channels.find(channel => channel.id === data.channel);
    byId("channel-name").textContent = selected?.name || "";
    byId("programme-name").textContent = selected?.program || "";
    const key = JSON.stringify([data.channels, data.channel, data.canTune, switching]);
    if (key !== listKey) {
      listKey = key;
      const focusedId = document.activeElement?.dataset.channel;
      list.replaceChildren(...data.channels.map(channel => {
        const item = document.createElement("li");
        const button = document.createElement("button");
        const label = document.createElement("span");
        const name = document.createElement("b");
        const programme = document.createElement("small");
        const active = channel.id === data.channel;
        button.type = "button";
        button.className = "channel-row";
        button.dataset.channel = channel.id;
        button.disabled = switching || (!active && !data.canTune);
        if (active) button.setAttribute("aria-current", "true");
        name.textContent = channel.name;
        programme.textContent = channel.program || t("Sin información del programa", "No programme information");
        label.append(name, programme);
        button.append(label);
        if (active) {
          const check = document.createElement("i");
          check.setAttribute("aria-hidden", "true");
          check.textContent = "✓";
          button.append(check);
        }
        item.append(button);
        return item;
      }));
      if (focusedId) [...list.querySelectorAll("button")].find(button => button.dataset.channel === focusedId)?.focus();
      guideMessage(data.hdmi ? t("Cambia de canal con el mando del receptor.", "Change channels with the receiver’s remote.")
        : !data.canTune ? t("El sintonizador está ocupado.", "The tuner is busy.")
        : !data.channels.length ? t("Busca canales en el ordenador.", "Scan for channels on the computer.") : "");
    }
    syncPlayer();
  }

  async function poll() {
    if (ended || !visible) return;
    const version = tuningVersion;
    try {
      const response = await fetch("status", { cache: "no-store", signal: window.AbortSignal?.timeout?.(6000) });
      if (response.status === 403) {
        ended = true;
        unload();
        setGuide(false);
        guideToggle.disabled = true;
        message("La sesión ha terminado. Escanea un nuevo QR en el ordenador.", "The session ended. Scan a new QR code on the computer.");
        rotateStatus.textContent = status.textContent;
        return;
      }
      if (!response.ok) throw new Error();
      const data = await response.json();
      failures = 0;
      if (rotateStatus.textContent !== rotateHint) rotateStatus.textContent = rotateHint;
      if (version === tuningVersion && !switching && visible) render(data);
    } catch {
      if (source) unload();
      if (++failures < 3) {
        message("Conexión interrumpida. Reconectando…", "Connection interrupted. Reconnecting…");
      } else {
        message("Comprueba la Wi-Fi y escanea un nuevo QR si se ha cerrado la sesión.",
          "Check Wi-Fi and scan a new QR code if the session has ended.");
      }
      if (rotateStatus.textContent !== status.textContent) rotateStatus.textContent = status.textContent;
    } finally {
      if (!ended && visible) nextPoll = setTimeout(poll, 2000);
    }
  }

  guideToggle.addEventListener("click", () => setGuide(guide.hidden));
  byId("guide-close").addEventListener("click", () => setGuide(false, true));
  guide.addEventListener("keydown", event => {
    if (event.key === "Escape") {
      event.preventDefault();
      setGuide(false, true);
    }
  });
  list.addEventListener("click", async event => {
    const channel = event.target.closest("button[data-channel]");
    if (!channel || switching) return;
    if (channel.dataset.channel === snapshot?.channel) {
      setGuide(false, true);
      return;
    }
    switching = true;
    tuningVersion++;
    render(snapshot);
    guideMessage(t("Cambiando de canal…", "Changing channel…"));
    let error = "";
    try {
      const response = await fetch("tune", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify(channel.dataset.channel),
      });
      if (!response.ok) throw new Error();
      snapshot = null;
      unload();
      setGuide(false, true);
      syncPlayer();
    } catch {
      error = t("No se pudo cambiar de canal. Comprueba el sintonizador en el ordenador.",
        "Could not change channel. Check the tuner on your computer.");
    } finally {
      switching = false;
      if (snapshot) render(snapshot);
      if (error) guideMessage(error);
    }
  });

  play.addEventListener("click", () => {
    if (failed) {
      const url = source.url;
      unload();
      attach(url);
    }
    playVideo();
  });
  sound.addEventListener("click", () => {
    muted = !muted;
    video.muted = muted;
    updateControls();
    if (video.paused) playVideo();
  });
  video.addEventListener("playing", () => {
    playBlocked = failed = false;
    message("", "");
    updateControls();
  });
  video.addEventListener("error", playbackFailed);
  fullscreen.addEventListener("click", () => {
    if (expanded) {
      setExpanded(false);
      exitNativeFullscreen();
    } else {
      setExpanded(true);
      enterFullscreen(true);
    }
  });
  video.addEventListener("webkitbeginfullscreen", () => {
    if (!expanded || !orientation.matches) exitNativeFullscreen();
  });
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && !event.defaultPrevented && orientation.matches && expanded
        && !fullscreenElement() && !video.webkitDisplayingFullscreen && guide.hidden) {
      setExpanded(false);
    }
  });
  function syncOrientation() {
    setGuide(false);
    setExpanded(true);
    if (!orientation.matches) exitNativeFullscreen();
    syncPlayer();
  }
  orientation.addEventListener("change", syncOrientation);
  // Keep Safari's landscape layout independent of its native video transition.
  screen.orientation?.addEventListener("change", () => {
    if (!appleMobile && expanded && screen.orientation.type.startsWith("landscape") && orientation.matches) {
      enterFullscreen(false);
    }
  });
  window.addEventListener("pagehide", () => {
    visible = false;
    clearTimeout(nextPoll);
  });
  window.addEventListener("pageshow", event => {
    visible = true;
    if (event.persisted) poll();
  });
  syncOrientation();
  poll();
})();
