"use strict";

const byId = (id) => document.getElementById(id);
const video = byId("video");
const playButton = byId("play");
const soundButton = byId("sound");
const screen = byId("screen");
const fullscreen = byId("fullscreen");
const filter = byId("filter");
const errorBox = byId("error");
const monitorControls = byId("monitor-controls");
const monitorPlay = byId("monitor-play");
const monitorSound = byId("monitor-sound");
const liveStartup = createPlaybackStartup(video, () => {
  if (window.arkhamLinux && player && liveSource && !liveSource.reloaded && !playerError) {
    attachStream(liveSource.stream, true);
  } else {
    playButton.hidden = false;
  }
}, { trackDecodedFrames: Boolean(window.arkhamLinux) });
const playerVolume = byId("player-volume");
const volumeValue = byId("player-volume-value");
const volumeSliders = [playerVolume, byId("monitor-volume")];
const audioDelayFields = byId("audio-delay-fields");
const audioDelayPicker = byId("audio-delay-picker");
const audioDelayChannel = byId("audio-delay-channel");
const audioDelayOptions = byId("audio-delay-options");
const audioDelayInput = byId("audio-delay-ms");
const favoritesPanel = byId("favorites");
const favoritesList = byId("favorite-channels");
const favoritesDrop = byId("favorites-drop");
const catalogList = byId("channels");
const tuningDeleteDialog = byId("tuning-delete-dialog");
const favoritesKey = "arkhamtv.favorites";

let player = null;
let streamId = null;
let liveSource = null;
let tuningTo = null;
let playerError = null;
let channelListKey = null;
let tuningListKey = null;
let tuningToDelete = null;
let favoritesListKey = null;
let favoriteIds = readFavorites();
let channelDrag = null;
let volumeDrag = null;
let lastAudibleVolume = video.volume || 1;
let pending = false;
let autoplayRequested = false;
let refreshVersion = 0;
let latest = null;
let audioOptionsKey = null;
let audioChannelId = null;
let audioSelectionKey = null;
const muteKey = "arkhamtv.muted";
try {
  video.muted = localStorage.getItem(muteKey) === "true";
} catch {
  // The audio switch is still available for this session.
}

function text(id, value) {
  const element = byId(id);
  if (element.textContent !== value) element.textContent = value;
}

function showError(message) {
  errorBox.textContent = message || "";
  errorBox.hidden = !message;
}

async function api(path, payload) {
  const options = payload === undefined ? {} : {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  };
  const response = await fetch("/api/" + path, options);
  const data = await response.json();
  if (!response.ok) throw new Error(arkhamLanguage.message(data.error) || arkhamLanguage.t("No se pudo completar la operación."));
  return data;
}

function syncSound() {
  const unavailable = !streamId || Boolean(playerError);
  soundButton.disabled = monitorSound.disabled = unavailable;
  const silent = video.muted || video.volume === 0;
  const label = silent ? arkhamLanguage.t("Activar sonido") : arkhamLanguage.t("Silenciar");
  const icon = silent ? "#i-muted" : "#i-volume";
  soundButton.toggleAttribute("data-silent", silent);
  soundButton.setAttribute("aria-label", label);
  soundButton.title = label;
  soundButton.querySelector("use").setAttribute("href", icon);
  monitorSound.querySelector("use").setAttribute("href", icon);
  monitorSound.setAttribute("aria-label", label);
  const level = Math.round(video.volume * 100);
  const displayLevel = level + " %";
  if (volumeValue.textContent !== displayLevel) {
    volumeValue.textContent = displayLevel;
    playerVolume.style.setProperty("--volume-level", level + "%");
  }
  for (const slider of volumeSliders) {
    if (slider.disabled !== unavailable) slider.disabled = unavailable;
    // Updating the input's value can interrupt WebKit's native drag.
    if (slider !== volumeDrag?.slider && slider.valueAsNumber !== level) slider.value = level;
    slider.setAttribute("aria-valuetext", slider.value + " %");
  }
}

function syncMonitorPlay() {
  monitorPlay.disabled = !streamId || Boolean(playerError);
  monitorPlay.setAttribute("aria-label", video.paused ? arkhamLanguage.t("Reproducir") : arkhamLanguage.t("Pausar"));
  monitorPlay.querySelector("use").setAttribute("href", video.paused ? "#i-play" : "#i-pause");
}

function unloadVideo() {
  liveStartup.cancel();
  liveSource = null;
  streamId = null;
  playerError = null;
  playButton.hidden = true;
  monitorControls.hidden = true;
  video.pause();
  if (player) player.destroy();
  player = null;
  video.removeAttribute("src");
  video.load();
  syncSound();
  syncMonitorPlay();
}

function requestLivePlayback() {
  if (liveSource && !playerError) liveStartup.start();
}

playButton.addEventListener("click", requestLivePlayback);
function setMute(muted) {
  if (video.muted === muted) return;
  video.muted = muted;
  try {
    localStorage.setItem(muteKey, String(video.muted));
  } catch {
    // The video retains its current audio state.
  }
}

function toggleSound() {
  const wasSilent = video.muted || video.volume === 0;
  if (video.volume === 0) video.volume = lastAudibleVolume;
  setMute(!wasSilent);
}

soundButton.addEventListener("click", toggleSound);
monitorSound.addEventListener("click", toggleSound);
for (const slider of volumeSliders) {
  slider.addEventListener("pointerdown", (event) => {
    if (event.button === 0 && !slider.disabled) volumeDrag = { slider, pointer: event.pointerId };
  });
  slider.addEventListener("input", () => {
    const level = slider.valueAsNumber / 100;
    if (level > 0) lastAudibleVolume = level;
    video.volume = level;
  });
}
function endVolumeDrag(event) {
  if (!volumeDrag || (event.type !== "blur" && event.pointerId !== volumeDrag.pointer)) return;
  volumeDrag = null;
  requestAnimationFrame(syncSound);
}
document.addEventListener("pointerup", endVolumeDrag, true);
document.addEventListener("pointercancel", endVolumeDrag, true);
window.addEventListener("blur", endVolumeDrag);
monitorPlay.addEventListener("click", () => {
  if (video.paused) requestLivePlayback();
  else {
    liveStartup.cancel();
    video.pause();
  }
});
video.addEventListener("volumechange", syncSound);
video.addEventListener("play", syncMonitorPlay);
video.addEventListener("pause", syncMonitorPlay);
video.addEventListener("playing", () => { playButton.hidden = true; });

function attachStream(stream, reloaded = false) {
  if (liveSource) unloadVideo();
  const source = liveSource = { stream, reloaded };
  streamId = stream.id;
  video.hidden = false;
  liveStartup.start(true);
  const nativeHLS = video.canPlayType("application/vnd.apple.mpegurl");
  if (window.arkhamNative && nativeHLS) {
    video.src = stream.url;
  } else if (window.Hls && Hls.isSupported()) {
    player = new Hls({ enableWorker: false, liveSyncDurationCount: 3, backBufferLength: 12 });
    player.on(Hls.Events.ERROR, (_, event) => {
      if (event.fatal && liveSource === source) {
        console.warn("HLS", event.type, event.details, event.error?.message);
        playbackError(arkhamLanguage.t("El navegador no pudo reproducir esta emisión."));
      }
    });
    player.once(Hls.Events.MEDIA_ATTACHED, () => {
      if (liveSource === source) player.loadSource(stream.url);
    });
    player.attachMedia(video);
  } else if (nativeHLS) {
    video.src = stream.url;
  } else {
    playbackError(window.arkhamLinux
      ? arkhamLanguage.t("Instala los códecs de Ubuntu ejecutando Arkham TV con --preparar-ventana.")
      : arkhamLanguage.t("Abre Arkham TV en un navegador que reproduzca vídeo H.264, como Safari."));
  }
  syncSound();
  syncMonitorPlay();
}

function syncLivePlayback(stream) {
  const inArchive = activeView === "#grabaciones" || activeView === "#grabacion";
  if (inArchive || !stream?.ready || (tuningTo && tuningTo !== stream.channel)) {
    if (liveSource) unloadVideo();
    return;
  }
  if (stream.id !== streamId) attachStream(stream);
}

function playbackError(message) {
  liveStartup.cancel();
  playerError = message;
  playButton.hidden = true;
  if (latest) renderPlayer(latest);
}

video.addEventListener("error", () => {
  if (streamId && video.error) playbackError(arkhamLanguage.t("El navegador no pudo reproducir esta emisión."));
});

function channelFormat(channel) {
  const { name, width, height } = channel;
  const announced = /(?:^|[^a-z])(?:UHD|[48]K)\b/i.test(name) ? "uhd"
    : name.match(/\b(?:F?HD|SD)\b/i)?.[0].toLowerCase().slice(-2);
  if (width > 0 && height > 0) {
    const format = height >= 2160 || (width >= 3840 && height >= 2000)
      ? "uhd" : height >= 720 ? "hd" : "sd";
    return { format, announced, resolution: `${width} × ${height}` };
  }
  return { format: announced, announced };
}

function channelCard(channel) {
  const item = document.createElement("li");
  item.className = "channel-tile";
  item.dataset.dragChannel = channel.id;
  item.draggable = true;
  const { format, announced, resolution } = channelFormat(channel);
  item.dataset.format = format || "unknown";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "channel-card";
  button.dataset.channel = channel.id;
  const quality = document.createElement("span");
  quality.className = "channel-format";
  quality.textContent = format ? format.toUpperCase() : arkhamLanguage.t("Sin medir");
  const received = resolution ? arkhamLanguage.f("{format} recibido · {resolution}",
    "Received {format} · {resolution}", { format: quality.textContent, resolution }) : arkhamLanguage.t("Resolución sin medir");
  const note = announced && (!resolution || announced !== format)
    ? arkhamLanguage.f("{received} · {announced} anunciado por el canal",
      "{received} · {announced} advertised by the channel", { received, announced: announced.toUpperCase() }) : received;
  quality.title = note;
  quality.setAttribute("aria-label", note);

  const brand = document.createElement("span");
  brand.className = "channel-brand";
  const sign = document.createElement("span");
  sign.className = "call-sign";
  sign.setAttribute("aria-hidden", "true");
  const words = channel.name.match(/[\p{L}\p{N}]+/gu) || [];
  sign.textContent = (words.length > 1 ? words[0][0] + words[1][0] : (words[0] || "TV").slice(0, 2)).toUpperCase();
  const logo = window.channelLogoPath?.(channel.name);

  const details = document.createElement("span");
  details.className = "channel-details";
  const name = document.createElement("span");
  name.className = "channel-name";
  name.textContent = channel.name;
  const band = document.createElement("small");
  band.textContent = "UHF " + channel.uhf;
  details.append(name, band);
  brand.append(sign);
  button.append(quality, brand, details);
  if (logo) {
    const image = document.createElement("img");
    image.className = "channel-logo";
    image.alt = "";
    image.draggable = false;
    sign.hidden = true;
    image.addEventListener("error", () => {
      image.remove();
      sign.hidden = false;
    }, { once: true });
    image.src = logo;
    brand.append(image);
  }
  const bookmark = document.createElement("button");
  bookmark.type = "button";
  bookmark.className = "favorite-toggle";
  bookmark.dataset.favoriteId = channel.id;
  bookmark.dataset.channelName = channel.name;
  bookmark.innerHTML = '<svg aria-hidden="true"><use href="#i-bookmark-plus"/></svg>';
  item.append(button, bookmark);
  return item;
}

function readFavorites() {
  try {
    const ids = JSON.parse(localStorage.getItem(favoritesKey) || "[]");
    if (Array.isArray(ids)) return [...new Set(ids.filter(id => typeof id === "string"))];
  } catch {
    // Favorites are still available for this session.
  }
  return [];
}

function saveFavorites(ids) {
  favoriteIds = ids;
  try {
    localStorage.setItem(favoritesKey, JSON.stringify(ids));
  } catch {
    // Favorites remain available while this window is open.
  }
  if (latest) renderChannels(latest);
}

function renderFavorites(channels) {
  const byChannel = new Map(channels.map(channel => [channel.id, channel]));
  const entries = favoriteIds.map(id => byChannel.get(id)).filter(Boolean);
  const key = JSON.stringify(entries);
  if (favoritesListKey !== key) {
    favoritesListKey = key;
    favoritesList.replaceChildren(...entries.map(channelCard), favoritesDrop);
  }
  favoritesDrop.classList.toggle("favorite-drop-empty", entries.length === 0);
  text("favorites-count", arkhamLanguage.number(entries.length));
  for (const button of document.querySelectorAll(".favorite-toggle")) {
    const saved = favoriteIds.includes(button.dataset.favoriteId);
    const fields = { name: button.dataset.channelName };
    const label = saved ? arkhamLanguage.f("Quitar {name} de favoritos", "Remove {name} from favourites", fields)
      : arkhamLanguage.f("Añadir {name} a favoritos", "Add {name} to favourites", fields);
    button.setAttribute("aria-label", label);
    button.title = label;
    button.setAttribute("aria-pressed", String(saved));
    button.querySelector("use").setAttribute("href", saved ? "#i-bookmark-check" : "#i-bookmark-plus");
  }
}

function renderChannels(state) {
  const query = filter.value.trim().toLocaleLowerCase("es");
  const listKey = JSON.stringify([query, state.channels]);
  if (channelListKey !== listKey) {
    channelListKey = listKey;
    const matching = state.channels.filter(channel =>
      (channel.name + " UHF " + channel.uhf).toLocaleLowerCase("es").includes(query));
    const items = matching.map(channelCard);
    catalogList.replaceChildren(...items);
    byId("empty").hidden = items.length > 0;
    text("empty", query ? arkhamLanguage.t("Ningún canal coincide con la búsqueda.") : arkhamLanguage.t("Los canales sintonizados aparecerán aquí."));
    text("count", arkhamLanguage.number(matching.length));
  }
  renderFavorites(state.channels);
  for (const button of document.querySelectorAll(".channel-card")) {
    button.disabled = pending || state.scan.state === "running" || !state.hardware.ready;
    button.setAttribute("aria-pressed", String(button.dataset.channel === state.stream?.channel));
  }
}

function renderPlayer(state) {
  const { hardware, scan, stream } = state;
  const selected = state.channels.find((channel) => channel.id === stream?.channel);
  text("channel-name", selected?.name || arkhamLanguage.t("Televisión en directo"));
  text("mini-channel", selected?.name || arkhamLanguage.t("Televisión en directo"));
  text("mini-program", state.program?.title || arkhamLanguage.t("Sin información del programa"));
  text("channel-frequency", selected
    ? "UHF " + selected.uhf + " · " + (selected.frequency / 1e6).toLocaleString(arkhamLanguage.locale) + " MHz"
    : arkhamLanguage.t("Señal de antena · TDT"));
  const ready = Boolean(stream?.ready && stream.id === streamId && !playerError);
  const scanning = scan.state === "running";
  const refreshingGuide = scanning && scan.kind === "guide";
  const connecting = Boolean(stream || state.autoplayPending || (hardware.ready && !autoplayRequested));
  video.hidden = !ready;
  const showPlayControl = ready && monitorControls.hidden;
  monitorControls.hidden = !ready;
  if (showPlayControl) revealPlayControl();
  byId("screen-message").hidden = ready;
  byId("on-air").classList.toggle("live", ready);
  text("player-state", miniMode ? ready ? arkhamLanguage.t("MINI · EN DIRECTO") : arkhamLanguage.t("MINIRREPRODUCTOR")
    : ready ? arkhamLanguage.t("EN DIRECTO") : refreshingGuide ? arkhamLanguage.t("ACTUALIZANDO GUÍA") : scanning ? arkhamLanguage.t("BUSCANDO CANALES") :
    connecting && !playerError ? arkhamLanguage.t("CONECTANDO") : arkhamLanguage.t("EN ESPERA"));
  if (!ready) {
    let title = arkhamLanguage.t("Televisión en directo");
    let detail = arkhamLanguage.t("Elige un canal para verlo.");
    if (scanning) {
      title = refreshingGuide ? arkhamLanguage.t("Actualizando la guía") : arkhamLanguage.t("Buscando tus canales");
      detail = refreshingGuide ? arkhamLanguage.t("Estamos recibiendo la programación por antena.") : arkhamLanguage.t("Estamos recorriendo las frecuencias de tu antena.");
    } else if (playerError || (!connecting && state.streamError)) {
      title = arkhamLanguage.t("Emisión interrumpida");
      detail = playerError || arkhamLanguage.message(state.streamError);
    } else if (connecting) {
      title = arkhamLanguage.t("Preparando la emisión");
      detail = selected ? arkhamLanguage.f("Sintonizando {name}…", "Tuning to {name}…", { name: selected.name })
        : arkhamLanguage.t("Estamos conectando con tu antena.");
    } else if (!hardware.ready || !state.channels.length) {
      detail = arkhamLanguage.message(!hardware.ready ? hardware.message : scan.message) || arkhamLanguage.t("Busca canales para empezar.");
    }
    text("screen-title", title);
    text("screen-detail", detail);
  }
  syncSound();
  syncMonitorPlay();
}

function renderAudioSettings(state, preferLive = false) {
  const { channels, stream } = state;
  if (preferLive || !channels.some(({ id }) => id === audioChannelId)) {
    audioChannelId = channels.find(({ id }) => id === stream?.channel)?.id
      ?? channels.find(({ id }) => id === audioChannelId)?.id
      ?? channels[0]?.id ?? null;
  }
  const optionsKey = JSON.stringify(channels.map(({ id, name }) => [id, name]));
  if (audioOptionsKey !== optionsKey) {
    audioOptionsKey = optionsKey;
    setAudioDelayPickerOpen(false, audioDelayOptions.contains(document.activeElement));
    audioDelayOptions.replaceChildren(...channels.map(({ id, name }) => {
      const option = document.createElement("button");
      const label = document.createElement("span");
      option.type = "button";
      option.className = "choice-option";
      option.dataset.channel = id;
      label.textContent = name;
      option.innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>';
      option.prepend(label);
      return option;
    }));
  }
  const channel = channels.find(({ id }) => id === audioChannelId);
  text("audio-delay-channel-name", channel?.name ?? arkhamLanguage.t("Sin canales sintonizados"));
  for (const option of audioDelayOptions.children) {
    if (option.dataset.channel === audioChannelId) option.setAttribute("aria-current", "true");
    else option.removeAttribute("aria-current");
  }
  const delay = state.audioDelays?.[audioChannelId] ?? 0;
  const selection = audioChannelId + "/" + delay;
  if (audioSelectionKey !== selection || preferLive) {
    audioSelectionKey = selection;
    audioDelayInput.value = delay;
  }
  audioDelayFields.disabled = pending || !channel;
}

function renderTuningProfiles(state, blocked) {
  const profiles = state.profiles || [];
  const list = byId("tuning-list");
  const key = JSON.stringify(profiles);
  if (key !== tuningListKey) {
    tuningListKey = key;
    list.replaceChildren(...[...profiles].sort((a, b) => a.name.localeCompare(b.name, arkhamLanguage.locale)).map((profile) => {
      const row = document.createElement("li");
      const heading = document.createElement("div");
      const name = document.createElement("strong");
      const count = document.createElement("small");
      const actions = document.createElement("div");
      const load = document.createElement("button");
      const remove = document.createElement("button");
      name.textContent = profile.name;
      count.textContent = arkhamLanguage.number(profile.count);
      heading.append(name, count);
      load.className = "button secondary";
      load.type = "button";
      load.textContent = arkhamLanguage.t("Cargar");
      load.setAttribute("aria-label", arkhamLanguage.f("Cargar {name}", "Load {name}", { name: profile.name }));
      load.addEventListener("click", () => changeTuningProfile("tuning-load", { id: profile.id },
        arkhamLanguage.f("«{name}» cargada.", "Loaded “{name}”.", { name: profile.name })));
      remove.className = "button secondary tuning-delete";
      remove.type = "button";
      remove.textContent = arkhamLanguage.t("Eliminar");
      remove.setAttribute("aria-label", arkhamLanguage.f("Eliminar {name}", "Delete {name}", { name: profile.name }));
      remove.addEventListener("click", () => {
        tuningToDelete = profile;
        tuningDeleteDialog.returnValue = "";
        text("tuning-delete-copy", arkhamLanguage.f(
          "Se borrará la lista guardada «{name}». Los canales sintonizados seguirán disponibles.",
          "The saved list “{name}” will be deleted. Your tuned channels will remain available.", { name: profile.name }));
        tuningDeleteDialog.showModal();
      });
      actions.className = "tuning-actions";
      actions.append(load, remove);
      row.append(heading, actions);
      return row;
    }));
    byId("tuning-empty").hidden = profiles.length > 0;
    list.hidden = !profiles.length;
  }
  byId("tuning-name").disabled = byId("tuning-save-button").disabled = blocked || !state.channels.length;
  for (const button of list.querySelectorAll("button")) {
    button.disabled = blocked || Boolean(state.recordingUhf && !button.classList.contains("tuning-delete"));
  }
}

function renderScanLabel(state) {
  const label = state.scan.state === "running" ? arkhamLanguage.t("Buscando canales…")
    : byId("scan-fresh").checked ? arkhamLanguage.t("Buscar desde cero")
    : state.channels.length ? arkhamLanguage.t("Volver a sintonizar") : arkhamLanguage.t("Buscar canales");
  text("scan-label", label);
}

function render(state) {
  latest = state;
  if (activeView === "#configuracion") renderAudioSettings(state);
  const { hardware, scan, stream } = state;
  const scanning = scan.state === "running";
  const reception = !hardware.usb ? "usb" : hardware.signal === true ? "ready" : hardware.signal === false ? "rf" : "waiting";
  const labels = { usb: arkhamLanguage.t("USB desconectado"), ready: arkhamLanguage.t("Antena conectada"), rf: arkhamLanguage.t("Sin señal de antena"), waiting: arkhamLanguage.t("Sintonizador listo") };
  const tips = { usb: arkhamLanguage.t("Conecta el sintonizador por USB."), ready: arkhamLanguage.t("La antena recibe señal de TV."),
    rf: arkhamLanguage.t("Revisa el cable de antena."), waiting: arkhamLanguage.t("Sintoniza un canal para comprobar la señal.") };
  const antenna = byId("connection-icon").parentElement;
  antenna.dataset.reception = reception;
  antenna.title = hardware.usb && !hardware.ready ? arkhamLanguage.message(hardware.message) : tips[reception];
  text("connection-text", hardware.usb && !hardware.ready ? arkhamLanguage.t("Sintonizador en espera") : labels[reception]);
  text("device-message", arkhamLanguage.message(hardware.message));
  text("footer-tuner", hardware.model ? `AVerMedia ${hardware.model} - DVB-T` : arkhamLanguage.t("Sintonizador DVB-T"));
  byId("scan").disabled = pending || scanning || !hardware.ready || Boolean(state.recordingUhf);
  byId("scan-fresh").disabled = byId("scan").disabled;
  renderTuningProfiles(state, pending || scanning);
  recordingsView.render(state, pending);
  captureOptions.render(state, pending);
  byId("stop").disabled = pending || scanning || (!stream && !state.autoplayPending);
  renderScanLabel(state);
  const progress = byId("progress");
  progress.hidden = !scanning;
  progress.value = scan.progress || 0;
  const feedback = scanning ? arkhamLanguage.f("Comprobando UHF {current} de {last}",
    "Checking UHF {current} of {last}", scan) : arkhamLanguage.message(scan.message);
  byId("scan-message").hidden = !feedback;
  text("scan-message", feedback || "");
  const showScanCount = scanning && scan.kind === "channels";
  byId("scan-count").hidden = !showScanCount;
  if (showScanCount) {
    const count = (scan.count ?? 0).toLocaleString(arkhamLanguage.locale);
    text("scan-count", scan.count === 1
      ? arkhamLanguage.f("{count} canal detectado", "{count} channel found", { count })
      : arkhamLanguage.f("{count} canales detectados", "{count} channels found", { count }));
  }
  renderChannels(state);
  syncLivePlayback(stream);
  renderPlayer(state);
  audioStudio.render(state, pending);
  guide.render(state, pending);
  programInfo.render(state);
}

async function refresh() {
  const version = ++refreshVersion;
  try {
    const state = await api("status");
    if (version !== refreshVersion) return;
    render(state);
    if (!state.hardware.ready) autoplayRequested = false;
    if (!autoplayRequested && state.hardware.ready) {
      autoplayRequested = true;
      try {
        await api("autoplay", {});
      } catch (error) {
        showError(error.message);
      }
    }
  } catch {
    if (version !== refreshVersion) return;
    autoplayRequested = false;
    text("connection-text", arkhamLanguage.t("Servidor desconectado"));
    const antenna = byId("connection-icon").parentElement;
    delete antenna.dataset.reception;
    antenna.title = "";
    text("device-message", arkhamLanguage.t("Abre iniciar.command para conectar con Arkham TV."));
    for (const button of document.querySelectorAll("#scan, #stop, .channel-card")) button.disabled = true;
    byId("scan-fresh").disabled = true;
    if (latest) {
      renderTuningProfiles(latest, true);
      recordingsView.render({ ...latest, recordingElapsed: null }, true);
    }
    audioDelayFields.disabled = true;
    setAudioDelayPickerOpen(false);
  }
}

async function action(name, data, reportError = showError) {
  if (pending) return;
  pending = true;
  if (latest) {
    audioStudio.render(latest, pending);
    guide.render(latest, pending);
    renderTuningProfiles(latest, true);
    recordingsView.render(latest, true);
    captureOptions.render(latest, true);
  }
  for (const button of document.querySelectorAll("#scan, #stop, .channel-card")) button.disabled = true;
  byId("scan-fresh").disabled = true;
  audioDelayFields.disabled = true;
  setAudioDelayPickerOpen(false);
  showError("");
  try {
    await api(name, data);
    return true;
  } catch (error) {
    reportError(error.message);
    return false;
  } finally {
    pending = false;
    await refresh();
  }
}

function setAudioDelayPickerOpen(open, focus = false) {
  audioDelayOptions.hidden = !open;
  audioDelayChannel.setAttribute("aria-expanded", String(open));
  if (focus) {
    const target = open ? audioDelayOptions.querySelector('[aria-current="true"]') : audioDelayChannel;
    target?.focus();
  }
}

audioDelayChannel.addEventListener("click", () => {
  setAudioDelayPickerOpen(audioDelayOptions.hidden, audioDelayOptions.hidden);
});
audioDelayOptions.addEventListener("click", (event) => {
  const option = event.target.closest("button[data-channel]");
  if (!option) return;
  audioChannelId = option.dataset.channel;
  text("audio-delay-feedback", "");
  renderAudioSettings(latest);
  setAudioDelayPickerOpen(false, true);
});
audioDelayPicker.addEventListener("keydown", (event) => {
  if (audioDelayOptions.hidden) return;
  if (event.key === "Escape") {
    event.preventDefault();
    setAudioDelayPickerOpen(false, true);
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const options = [...audioDelayOptions.children];
    const current = options.indexOf(document.activeElement);
    const next = current + (event.key === "ArrowDown" ? 1 : -1);
    options[Math.min(options.length - 1, Math.max(0, next))]?.focus();
  }
});
audioDelayPicker.addEventListener("focusout", (event) => {
  if (event.relatedTarget && !audioDelayPicker.contains(event.relatedTarget)) setAudioDelayPickerOpen(false);
});
document.addEventListener("click", (event) => {
  if (!audioDelayPicker.contains(event.target)) setAudioDelayPickerOpen(false);
});
byId("audio-delay-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (audioDelayFields.disabled || !audioChannelId) return;
  text("audio-delay-feedback", "");
  const id = audioChannelId;
  const ms = audioDelayInput.valueAsNumber;
  if (await action("audio-delay", { id, ms })) {
    const adjustment = ms === 0 ? "0 ms" : `${ms > 0 ? "+" : "−"}${Math.abs(ms)} ms`;
    text("audio-delay-feedback", arkhamLanguage.f("Ajuste guardado · {adjustment}", "Adjustment saved · {adjustment}", { adjustment }));
  }
});

byId("scan-fresh").addEventListener("change", () => {
  if (latest) renderScanLabel(latest);
});

byId("scan-form").addEventListener("submit", (event) => {
  event.preventDefault();
  const first = byId("first").valueAsNumber;
  const last = byId("last").valueAsNumber;
  if (first > last) {
    showError(arkhamLanguage.t("El canal UHF inicial debe ser menor o igual al final."));
    return;
  }
  text("tuning-feedback", "");
  action("scan", { first, last, fresh: byId("scan-fresh").checked });
});

async function changeTuningProfile(actionName, data, success) {
  const report = (message) => text("tuning-feedback", message);
  report("");
  if (await action(actionName, data, report)) {
    report(success);
    return true;
  }
  return false;
}

byId("tuning-save").addEventListener("submit", async (event) => {
  event.preventDefault();
  const input = byId("tuning-name");
  const name = input.value.trim().replace(/\s+/g, " ");
  if (await changeTuningProfile("tuning-save", { name },
    arkhamLanguage.f("«{name}» guardada.", "Saved “{name}”.", { name }))) input.value = "";
});
tuningDeleteDialog.addEventListener("close", async () => {
  const profile = tuningToDelete;
  tuningToDelete = null;
  if (tuningDeleteDialog.returnValue !== "delete" || !profile) return;
  const { id, name } = profile;
  if (await changeTuningProfile("tuning-delete", { id },
    arkhamLanguage.f("«{name}» eliminada.", "Deleted “{name}”.", { name }))) {
    if (activeView === "#sintonizador") byId("tuning-profiles-title").focus();
  }
});
for (const list of document.querySelectorAll(".channel-picker")) {
  list.addEventListener("click", (event) => {
    const bookmark = event.target.closest("button[data-favorite-id]");
    if (bookmark) {
      const id = bookmark.dataset.favoriteId;
      const saved = favoriteIds.includes(id);
      const restoreFocus = list === favoritesList && document.activeElement === bookmark;
      saveFavorites(saved ? favoriteIds.filter(value => value !== id) : [...favoriteIds, id]);
      if (restoreFocus) {
        catalogList.querySelector(`[data-favorite-id="${CSS.escape(id)}"]`)?.focus();
      }
      const fields = { name: bookmark.dataset.channelName };
      text("favorites-status", saved ? arkhamLanguage.f("{name} se ha quitado de Favoritos.", "{name} removed from Favourites.", fields)
        : arkhamLanguage.f("{name} se ha añadido a Favoritos.", "{name} added to Favourites.", fields));
      return;
    }
    const button = event.target.closest("button[data-channel]");
    if (button && !button.disabled) {
      tuneChannel(button.dataset.channel);
    }
  });
  list.addEventListener("dragstart", (event) => {
    const tile = event.target.closest("[data-drag-channel]");
    if (!tile || !event.dataTransfer) return;
    event.dataTransfer.effectAllowed = list === favoritesList ? "move" : "copy";
    event.dataTransfer.setData("text/plain", tile.dataset.dragChannel);
    channelDrag = { tile, fromFavorites: list === favoritesList };
    favoritesPanel.classList.add("accepting-drop");
    requestAnimationFrame(() => {
      if (channelDrag?.tile === tile) tile.classList.add("dragging");
    });
  });
}

function clearDrag() {
  channelDrag?.tile.classList.remove("dragging");
  channelDrag = null;
  favoritesPanel.classList.remove("accepting-drop", "drag-over");
  text("favorites-drop-text", arkhamLanguage.t("Arrastra aquí un canal"));
}

favoritesPanel.addEventListener("dragover", (event) => {
  if (!channelDrag || !event.dataTransfer) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = channelDrag.fromFavorites ? "move" : "copy";
  favoritesPanel.classList.add("drag-over");
  text("favorites-drop-text", arkhamLanguage.t("Suelta el canal aquí"));
});
favoritesPanel.addEventListener("dragleave", (event) => {
  if (favoritesPanel.contains(event.relatedTarget)) return;
  favoritesPanel.classList.remove("drag-over");
  text("favorites-drop-text", arkhamLanguage.t("Arrastra aquí un canal"));
});
favoritesPanel.addEventListener("drop", (event) => {
  if (!channelDrag || event.dataTransfer?.getData("text/plain") !== channelDrag.tile.dataset.dragChannel) return;
  event.preventDefault();
  const id = channelDrag.tile.dataset.dragChannel;
  const channelName = channelDrag.tile.querySelector(".channel-name").textContent;
  const targetTile = event.target.closest("[data-drag-channel]");
  const target = targetTile?.dataset.dragChannel;
  clearDrag();
  if (target === id) return;
  const alreadySaved = favoriteIds.includes(id);
  const ids = favoriteIds.filter(value => value !== id);
  const index = ids.indexOf(target);
  const bounds = targetTile?.getBoundingClientRect();
  const after = bounds && event.clientX > bounds.left + bounds.width / 2;
  ids.splice(index < 0 ? ids.length : index + Number(after), 0, id);
  saveFavorites(ids);
  const fields = { name: channelName };
  text("favorites-status", alreadySaved ? arkhamLanguage.f("{name} se ha movido en Favoritos.", "{name} moved in Favourites.", fields)
    : arkhamLanguage.f("{name} se ha añadido a Favoritos.", "{name} added to Favourites.", fields));
});
document.addEventListener("dragend", clearDrag);
window.addEventListener("blur", clearDrag);
window.addEventListener("storage", (event) => {
  if (event.key !== favoritesKey) return;
  favoriteIds = readFavorites();
  if (latest) renderChannels(latest);
});
byId("stop").addEventListener("click", () => action("stop", {}));
filter.addEventListener("input", () => { if (latest) renderChannels(latest); });
filter.addEventListener("keydown", (event) => {
  if (event.key === "Enter") navigateTo("#canales");
});

let fullscreenActive = false;
let volumeTimer;
let playControlTimer;

function revealPlayControl() {
  if (monitorControls.hidden) return;
  clearTimeout(playControlTimer);
  monitorPlay.classList.remove("play-idle");
  playControlTimer = setTimeout(() => monitorPlay.classList.add("play-idle"), 3000);
}

function revealVolume() {
  if (!fullscreenActive) return;
  clearTimeout(volumeTimer);
  screen.classList.remove("volume-idle");
  volumeTimer = setTimeout(() => {
    if (volumeDrag?.slider === byId("monitor-volume")) revealVolume();
    else screen.classList.add("volume-idle");
  }, 5000);
}

function syncFullscreen() {
  revealPlayControl();
  const expanded = document.fullscreenElement === screen || screen.classList.contains("monitor-expanded");
  fullscreenActive = expanded;
  const label = expanded ? arkhamLanguage.t("Salir de pantalla completa") : arkhamLanguage.t("Pantalla completa");
  fullscreen.setAttribute("aria-label", label);
  fullscreen.title = label + " (F)";
  if (expanded) revealVolume();
  else {
    clearTimeout(volumeTimer);
    screen.classList.remove("volume-idle");
  }
}

function expandMonitor(expanded) {
  screen.classList.toggle("monitor-expanded", expanded);
  document.body.classList.toggle("monitor-expanded", expanded);
  syncFullscreen();
}

async function toggleFullscreen() {
  if (screen.classList.contains("monitor-expanded")) {
    expandMonitor(false);
    return;
  }
  if (document.fullscreenElement) {
    await document.exitFullscreen();
    return;
  }
  if (screen.requestFullscreen) {
    try {
      await screen.requestFullscreen();
      return;
    } catch {
      // Embedded windows may restrict the Fullscreen API.
    }
  }
  expandMonitor(true);
}

fullscreen.addEventListener("click", toggleFullscreen);
function revealMonitorControls() {
  revealPlayControl();
  revealVolume();
}
screen.addEventListener("pointermove", revealMonitorControls, { passive: true });
screen.addEventListener("pointerdown", revealMonitorControls, { passive: true });
screen.addEventListener("focusin", revealMonitorControls);
document.addEventListener("fullscreenchange", syncFullscreen);
document.addEventListener("keydown", (event) => {
  revealVolume();
  if (event.key === "Escape" && screen.classList.contains("monitor-expanded")) {
    expandMonitor(false);
  } else if (!miniMode && activeView === "#directo" && event.key.toLowerCase() === "f" && !event.repeat && !event.metaKey && !event.ctrlKey && !event.altKey &&
             !event.target.closest("input, textarea, dialog, [contenteditable]")) {
    event.preventDefault();
    toggleFullscreen();
  }
});

const routes = new Set(["#directo", "#canales", "#sintonizador", "#configuracion", "#guia", "#ecualizador", "#grabaciones", "#changelog"]);
const links = document.querySelectorAll(".nav-link, .footer-changelog a");
let activeView = null;
let miniMode = false;
const audioStudio = createAudioStudio({
  api, action, video, playingStream: () => streamId,
  playbackDate: () => {
    if (player) return Number(player.playingDate || NaN) / 1000;
    const start = video.getStartDate?.();
    return Number(start ?? NaN) / 1000 + video.currentTime;
  },
});
const captureOptions = createCaptureOptions({ action, current: () => latest });
const guide = createGuide({ api, action, tune: tuneChannel, chooseCapture: captureOptions.choose });
const programInfo = createProgramInfo({ api });
const recordingsView = createRecordings({ action, chooseCapture: captureOptions.choose, openRecording: (id) => navigateTo("#grabacion-" + id) });

function tuneChannel(id) {
  if (!pending && (latest?.stream?.channel !== id || !latest?.stream?.ready || playerError)) {
    tuningTo = id;
    if (liveSource) unloadVideo();
    action("tune", { id }).finally(() => {
      tuningTo = null;
      syncLivePlayback(latest?.stream);
      if (latest) renderPlayer(latest);
    });
  }
  navigateTo("#directo");
}

function syncNav() {
  const hash = miniMode ? "#directo" : location.hash;
  const recording = /^#grabacion-([a-f0-9]{16})$/.exec(hash);
  const current = recording ? "#grabacion" : routes.has(hash) ? hash : "#directo";
  const previous = activeView;
  const live = current === "#directo";
  const listing = current === "#canales";
  const settings = current === "#configuracion";
  const catalog = byId("canales");
  const catalogLayout = byId("catalog-layout");
  byId("directo").hidden = !live;
  catalog.hidden = !live && !listing;
  catalog.classList.toggle("catalog-page", listing);
  if (live && favoritesPanel.parentElement !== byId("directo")) byId("directo").append(favoritesPanel);
  if (listing && favoritesPanel.parentElement !== catalogLayout) catalogLayout.prepend(favoritesPanel);
  favoritesPanel.hidden = !live && !listing;
  byId("favorites-catalog-link").hidden = !live;
  byId("sintonizador").hidden = current !== "#sintonizador";
  if (current !== "#sintonizador" && tuningDeleteDialog.open) tuningDeleteDialog.close();
  byId("configuracion").hidden = !settings;
  if (!settings) setAudioDelayPickerOpen(false);
  byId("guia").hidden = current !== "#guia";
  byId("ecualizador").hidden = current !== "#ecualizador";
  byId("grabaciones").hidden = current !== "#grabaciones";
  byId("grabacion").hidden = !recording;
  byId("changelog").hidden = current !== "#changelog";
  guide.navigate(current);
  audioStudio.navigate(current);
  if (settings && latest && activeView !== current) {
    text("audio-delay-feedback", "");
    renderAudioSettings(latest, true);
  }
  activeView = current;
  if (recording && previous !== current) {
    const recordingVideo = byId("recorded-video");
    recordingVideo.muted = video.muted;
    recordingVideo.volume = video.volume;
    byId("recorded-title").focus({ preventScroll: true });
  }
  if (recording) {
    syncLivePlayback(latest?.stream);
    recordingsView.navigate(recording[1]);
  } else {
    recordingsView.navigate();
    syncLivePlayback(latest?.stream);
  }
  if (latest) renderPlayer(latest);
  if (live && previous !== current) revealPlayControl();
  if (current === "#changelog" && previous !== current) byId("changelog-title").focus({ preventScroll: true });
  for (const link of links) {
    if (link.hash === (recording ? "#grabaciones" : current)) link.setAttribute("aria-current", "location");
    else link.removeAttribute("aria-current");
  }
}

window.arkhamSetMiniMode = (enabled) => {
  if (miniMode === enabled) return;
  miniMode = enabled;
  document.body.classList.toggle("mini-mode", miniMode);
  if (miniMode && screen.classList.contains("monitor-expanded")) expandMonitor(false);
  syncNav();
  if (latest) renderPlayer(latest);
  if (!miniMode) revealPlayControl();
};

function navigateTo(hash) {
  if (location.hash !== hash) history.pushState(null, "", hash);
  syncNav();
  window.scrollTo(0, 0);
}

for (const link of document.querySelectorAll('a[href^="#"]')) {
  link.addEventListener("click", (event) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    if (!routes.has(link.hash)) return;
    event.preventDefault();
    navigateTo(link.hash);
  });
}
window.addEventListener("popstate", syncNav);
window.addEventListener("hashchange", syncNav);

let clockTimer;
function updateLocalClock() {
  clearTimeout(clockTimer);
  const now = new Date();
  const value = [now.getHours(), now.getMinutes()].map(part => String(part).padStart(2, "0")).join(":");
  byId("local-clock").dateTime = value;
  text("local-clock", value);
  clockTimer = setTimeout(updateLocalClock, 60000 - now.getTime() % 60000);
}
document.addEventListener("visibilitychange", () => { if (!document.hidden) updateLocalClock(); });
updateLocalClock();
syncNav();
refresh();
setInterval(refresh, 1500);
