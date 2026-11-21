"use strict";

const recordingQualities = { 480: "480p", 720: "720p", 1080: "1080p", 2160: "4K" };

function recordingIcon(name) {
  const namespace = "http://www.w3.org/2000/svg";
  const icon = document.createElementNS(namespace, "svg");
  const use = document.createElementNS(namespace, "use");
  use.setAttribute("href", "#i-" + name);
  icon.setAttribute("aria-hidden", "true");
  icon.append(use);
  return icon;
}

function trackName(track, index) {
  const { t, f, locale } = arkhamLanguage;
  const code = track.language;
  const aliases = { fre: "fr", ger: "de", baq: "eu", rum: "ro", dut: "nl", chi: "zh" };
  if (["qaa", "org", "vo"].includes(code)) return t("Versión original");
  if (!code || code === "und" || /^q[a-t][a-z]$/.test(code)) return f("Pista {n}", "Track {n}", { n: index + 1 });
  try {
    const label = new Intl.DisplayNames(locale, { type: "language", fallback: "none" }).of(aliases[code] || code);
    if (label) return label.charAt(0).toLocaleUpperCase(locale) + label.slice(1);
  } catch { /* The stream can carry a broadcaster-specific language code. */ }
  return code.toUpperCase();
}

function trackRole(track) {
  const roles = { effects: "Solo efectos", clean: "Audio limpio", description: "Audiodescripción", spoken: "Subtítulos hablados" };
  return roles[track.role] ? arkhamLanguage.t(roles[track.role]) : "";
}

function trackLabel(track, index) {
  return [trackName(track, index), trackRole(track)].filter(Boolean).join(" · ");
}

function createCaptureOptions({ action, current }) {
  const el = (id) => document.getElementById(id);
  const dialog = el("capture-options");
  const form = el("capture-form");
  const choices = el("capture-tracks");
  const trigger = el("live-audio");
  const qualityField = el("capture-quality");
  const note = el("capture-audio-note");
  const { t } = arkhamLanguage;
  const qualityKey = "arkhamtv.recording-quality";
  let resolve;
  let result;

  function choose({ channel, title, live = false, scheduled = false, audioPid = null }) {
    if (resolve || dialog.open || !channel) return Promise.resolve(null);
    result = null;
    el("capture-title").textContent = t(live ? "Audio de la emisión" : scheduled ? "Programar grabación" : "Grabar programa");
    el("capture-kicker").textContent = t(live ? "REPRODUCTOR" : "GRABACIÓN");
    el("capture-icon").setAttribute("href", live ? "#i-volume" : "#i-record");
    el("capture-submit-icon").setAttribute("href", live ? "#i-check" : "#i-record");
    el("capture-submit-label").textContent = t(live ? "Aplicar" : scheduled ? "Programar" : "Grabar");
    el("capture-context").textContent = title ? channel.name + " · " + title : channel.name;
    qualityField.hidden = qualityField.disabled = live;
    if (!live) {
      let saved;
      try { saved = localStorage.getItem(qualityKey); } catch { /* Optional preference. */ }
      const hdmi = Boolean(channel.hdmi);
      const fourK = form.querySelector('input[name="quality"][value="2160"]');
      fourK.disabled = fourK.closest("label").hidden = hdmi;
      form.elements.quality.value = Object.hasOwn(recordingQualities, saved) && !(hdmi && saved === "2160") ? saved : "1080";
    }
    const tracks = channel.audioTracks || [];
    const main = tracks.find(track => !track.role) || tracks[0];
    const selected = tracks.find(track => track.pid === audioPid) || main;
    const labels = tracks.map(trackLabel);
    const options = tracks.length ? tracks : [null];
    choices.replaceChildren(...options.map((track, index) => {
      const label = document.createElement("label");
      label.className = "capture-choice capture-track";
      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = "audioPid";
      radio.value = track ? String(track.pid) : "";
      radio.checked = track === selected || !track;
      const content = document.createElement("span");
      const name = document.createElement("strong");
      name.textContent = track ? trackName(track, index) : t("Audio principal");
      const descriptions = track ? [trackRole(track), track.pid === audioPid ? t("En reproducción") : track === main ? t("Principal") : ""] : [];
      if (track && labels.filter(item => item === labels[index]).length > 1) {
        descriptions.push(arkhamLanguage.f("Pista {n}", "Track {n}", { n: index + 1 }));
      }
      content.append(name);
      if (descriptions.some(Boolean)) {
        const detail = document.createElement("span");
        detail.textContent = descriptions.filter(Boolean).join(" · ");
        content.append(detail);
      }
      label.append(radio, content);
      return label;
    }));
    note.hidden = tracks.length > 0 || live;
    note.textContent = t(channel.hdmi ? "Se graba el audio que envía el receptor por HDMI."
      : "Las pistas aún no se han detectado. Puedes sintonizar el canal para ver qué idiomas ofrece.");
    el("capture-submit").disabled = live && !tracks.length;
    return new Promise((done) => {
      resolve = done;
      dialog.showModal();
      choices.querySelector(":checked")?.focus({ preventScroll: true });
    });
  }

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const fields = new FormData(form);
    const quality = Number(fields.get("quality"));
    const audio = fields.get("audioPid");
    result = { audioPid: audio ? Number(audio) : null };
    if (!qualityField.disabled && Object.hasOwn(recordingQualities, quality)) {
      result.quality = quality;
      try { localStorage.setItem(qualityKey, String(quality)); } catch { /* Optional preference. */ }
    }
    dialog.close();
  });
  for (const id of ["capture-close", "capture-cancel"]) el(id).addEventListener("click", () => dialog.close());
  dialog.addEventListener("close", () => {
    const done = resolve;
    resolve = undefined;
    done?.(result);
  });
  trigger.addEventListener("click", async () => {
    const state = current();
    const stream = state?.stream;
    const channel = state?.channels.find(item => item.id === stream?.channel);
    if (!channel?.audioTracks?.length) return;
    const selection = await choose({ channel, live: true, audioPid: stream.audioPid });
    if (selection?.audioPid != null && selection.audioPid !== stream.audioPid) {
      await action("live-audio", { id: channel.id, audioPid: selection.audioPid });
    }
  });
  function render(state, pending) {
    const stream = state.stream;
    const tracks = state.channels.find(channel => channel.id === stream?.channel)?.audioTracks || [];
    const index = tracks.findIndex(track => track.pid === stream?.audioPid);
    const label = index < 0 ? t("Audio") : trackLabel(tracks[index], index);
    if (el("live-audio-label").textContent !== label) el("live-audio-label").textContent = label;
    trigger.hidden = !stream;
    trigger.disabled = pending || !stream?.ready || !tracks.length;
    trigger.title = t(tracks.length ? "Elegir pista de audio" : "Pistas de audio no disponibles");
  }
  return { choose, render };
}

function createRecordings({ action, openRecording, chooseCapture, transcribeRecording }) {
  const el = (id) => document.getElementById(id);
  const folder = el("recording-folder");
  const feedback = el("recording-feedback");
  const liveStatus = el("recording-live-status");
  const liveStrip = el("recording-live-strip");
  const clock = el("recording-clock");
  const elapsed = el("recording-elapsed");
  const live = el("record-live");
  const list = el("recording-list");
  const dialog = el("recording-delete-dialog");
  const recordedScreen = el("recorded-screen");
  const recordedVideo = el("recorded-video");
  const fullscreen = el("recorded-fullscreen");
  const playerControls = el("recorded-controls");
  const playControl = el("recorded-play");
  const progress = el("recorded-progress");
  const playbackTime = el("recorded-time");
  const volume = el("recorded-volume");
  const sound = el("recorded-sound");
  const recordedError = el("recorded-error");
  const recordedFolderFeedback = el("recorded-folder-feedback");
  const openLibraryFolder = el("recordings-open-folder");
  const openVideoFolder = el("recorded-open-folder");
  const recordingStartup = createPlaybackStartup(recordedVideo);
  const date = new Intl.DateTimeFormat(arkhamLanguage.locale, { dateStyle: "medium", timeStyle: "short" });
  const labels = {
    scheduled: arkhamLanguage.t("Programada"), recording: arkhamLanguage.t("Grabando"), finishing: arkhamLanguage.t("Guardando archivo"),
    done: arkhamLanguage.t("Guardada"), cancelled: arkhamLanguage.t("Cancelada"), error: arkhamLanguage.t("Interrumpida"),
  };
  const showThumbnails = Boolean(window.arkhamNative || window.arkhamLinux);
  list.classList.toggle("recording-gallery", showThumbnails);
  let currentState;
  let folderValue;
  let key;
  let active;
  let recordingOrigin = null;
  let clockSnapshot;
  let clockTick;
  let shownSeconds = 0;
  let jobs = null;
  let selectedId;
  let playbackId;
  let deleteId;
  let audibleVolume = 1;

  function controlLabel(button, label, icon) {
    const translated = arkhamLanguage.t(label);
    button.setAttribute("aria-label", translated);
    button.title = translated;
    button.querySelector("use").setAttribute("href", "#i-" + icon);
  }

  function timecode(seconds) {
    const parts = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, Math.floor(seconds) % 60];
    if (!parts[0]) parts.shift();
    return parts.map((part, index) => String(part).padStart(index ? 2 : 1, "0")).join(":");
  }

  function syncProgress() {
    const duration = Number.isFinite(recordedVideo.duration) ? recordedVideo.duration : 0;
    const position = recordedVideo.currentTime;
    progress.disabled = duration <= 0;
    progress.max = duration;
    progress.value = position;
    const label = timecode(position) + " / " + timecode(duration);
    playbackTime.textContent = label;
    progress.setAttribute("aria-valuetext", label);
  }

  function syncVolume() {
    if (recordedVideo.volume > 0) audibleVolume = recordedVideo.volume;
    const silent = recordedVideo.muted || recordedVideo.volume === 0;
    const value = silent ? 0 : Math.round(recordedVideo.volume * 100);
    volume.value = value;
    volume.style.setProperty("--recorded-level", value + "%");
    volume.setAttribute("aria-valuetext", value + " %");
    controlLabel(sound, silent ? "Activar sonido" : "Silenciar", silent ? "muted" : "volume");
  }

  function syncPlayControl() {
    const paused = recordedVideo.paused || recordedVideo.ended;
    controlLabel(playControl, paused ? "Reproducir" : "Pausar", paused ? "play" : "pause");
  }

  for (const name of ["timeupdate", "durationchange", "loadedmetadata", "emptied"]) recordedVideo.addEventListener(name, syncProgress);
  for (const name of ["play", "pause", "ended"]) recordedVideo.addEventListener(name, syncPlayControl);
  recordedVideo.addEventListener("volumechange", syncVolume);
  playControl.addEventListener("click", () => {
    recordingStartup.cancel();
    if (recordedVideo.paused || recordedVideo.ended) void recordedVideo.play().catch(() => {});
    else recordedVideo.pause();
  });
  progress.addEventListener("input", () => {
    recordingStartup.cancel();
    if (Number.isFinite(recordedVideo.duration)) recordedVideo.currentTime = progress.valueAsNumber;
  });
  volume.addEventListener("input", () => {
    recordedVideo.volume = volume.valueAsNumber / 100;
    if (recordedVideo.muted) recordedVideo.muted = false;
    syncVolume();
  });
  sound.addEventListener("click", () => {
    if (recordedVideo.volume === 0) {
      recordedVideo.volume = audibleVolume;
      recordedVideo.muted = false;
    } else recordedVideo.muted = !recordedVideo.muted;
  });

  function syncFullscreen() {
    const expanded = document.fullscreenElement === recordedScreen || recordedScreen.classList.contains("monitor-expanded");
    controlLabel(fullscreen, expanded ? "Salir de pantalla completa" : "Pantalla completa", expanded ? "contract" : "expand");
    recordedVideo.controls = !expanded;
    playerControls.hidden = !expanded;
    if (expanded) {
      syncProgress();
      syncPlayControl();
      syncVolume();
    }
  }

  function expandRecording(expanded) {
    recordedScreen.classList.toggle("monitor-expanded", expanded);
    document.body.classList.toggle("recording-expanded", expanded);
    syncFullscreen();
  }

  async function exitFullscreen() {
    if (recordedScreen.classList.contains("monitor-expanded")) expandRecording(false);
    else if (document.fullscreenElement === recordedScreen) {
      await document.exitFullscreen().catch(() => {});
    }
  }

  fullscreen.addEventListener("click", async () => {
    if (document.fullscreenElement === recordedScreen || recordedScreen.classList.contains("monitor-expanded")) {
      await exitFullscreen();
      return;
    }
    if (recordedScreen.requestFullscreen) {
      try {
        await recordedScreen.requestFullscreen();
        if (!playbackId || el("grabacion").hidden) await exitFullscreen();
        return;
      } catch { /* Use the entire app window when system fullscreen is unavailable. */ }
    }
    if (playbackId && !el("grabacion").hidden) expandRecording(true);
  });
  document.addEventListener("fullscreenchange", syncFullscreen);
  document.addEventListener("keydown", (event) => {
    if (event.key !== "Escape" || !recordedScreen.classList.contains("monitor-expanded")) return;
    event.preventDefault();
    expandRecording(false);
  }, true);
  syncFullscreen();

  function showPlaybackError(message) {
    recordedError.textContent = message;
    recordedError.hidden = !message;
    fullscreen.hidden = Boolean(message) || !playbackId;
  }

  function syncPlayer() {
    if (!selectedId || !jobs) return;
    const job = jobs.find((item) => item.id === selectedId && item.file && ["done", "error"].includes(item.state));
    if (!job) {
      showPlaybackError(arkhamLanguage.t("Esta grabación ya no está disponible."));
      return;
    }
    if (job.id === playbackId) return;
    playbackId = job.id;
    el("recorded-name").textContent = job.title;
    el("recorded-meta").textContent = job.channel.name + " · " + date.format(job.start * 1000) + (job.quality ? " · " + recordingQualities[job.quality] : "");
    showPlaybackError("");
    recordedVideo.src = "/grabacion/" + job.id + ".mp4";
    recordingStartup.start();
  }

  function navigate(identifier) {
    if (identifier === selectedId) return;
    selectedId = identifier;
    if (playbackId) {
      void exitFullscreen();
      playbackId = undefined;
      recordingStartup.cancel();
      recordedVideo.pause();
      recordedVideo.removeAttribute("src");
      recordedVideo.load();
    }
    el("recorded-name").textContent = "";
    el("recorded-meta").textContent = "";
    recordedFolderFeedback.textContent = "";
    showPlaybackError("");
    syncPlayer();
    openVideoFolder.disabled = !playbackId;
  }

  // Native controls own playback as soon as the viewer interacts with them.
  recordedVideo.addEventListener("pointerdown", recordingStartup.cancel, true);
  recordedVideo.addEventListener("keydown", recordingStartup.cancel, true);
  recordedVideo.addEventListener("error", () => {
    if (playbackId && recordedVideo.error) {
      recordingStartup.cancel();
      showPlaybackError(arkhamLanguage.t("No se pudo reproducir el archivo. Comprueba si sigue en la carpeta de grabaciones."));
    }
  });
  dialog.addEventListener("close", () => {
    if (dialog.returnValue === "delete") change("recording-delete", { id: deleteId }, arkhamLanguage.t("Grabación eliminada."));
  });

  function updateClock() {
    const milliseconds = Math.max(0, performance.now() - recordingOrigin);
    const seconds = Math.max(shownSeconds, Math.floor(milliseconds / 1000));
    shownSeconds = seconds;
    const timestamp = [Math.floor(seconds / 3600), Math.floor(seconds / 60) % 60, seconds % 60]
      .map((unit) => String(unit).padStart(2, "0")).join(":");
    if (elapsed.textContent !== timestamp) elapsed.textContent = timestamp;
    clockTick = setTimeout(updateClock, Math.max(50, (seconds + 1) * 1000 - milliseconds));
  }

  el("recording-folder-picker").hidden = !window.arkhamNative && !window.arkhamLinux;
  window.addEventListener("arkham-recording-folder", (event) => { folder.value = event.detail; });

  async function change(name, data, success, output = feedback) {
    output.textContent = "";
    const ok = await action(name, data, (message) => { output.textContent = message; });
    if (ok && success) output.textContent = success;
    return ok;
  }

  openLibraryFolder.addEventListener("click", () => change("recording-open-folder", {}));
  openVideoFolder.addEventListener("click", () => {
    if (playbackId) change("recording-open-folder", { id: playbackId }, "", recordedFolderFeedback);
  });

  el("recording-folder-form").addEventListener("submit", (event) => {
    event.preventDefault();
    change("recording-folder", { folder: folder.value.trim() }, arkhamLanguage.t("Carpeta guardada."), el("recording-folder-feedback"));
  });

  live.addEventListener("click", async () => {
    if (active) await change("recording-stop", { id: active.id }, "", liveStatus);
    else {
      const stream = currentState?.stream;
      const channel = stream?.hdmi ? { id: stream.channel, name: stream.hdmi.name, hdmi: true }
        : currentState?.channels.find(item => item.id === stream?.channel);
      if (!channel) return;
      const options = await chooseCapture({ channel, title: currentState.program?.title, audioPid: stream.audioPid });
      if (!options) return;
      if (await change("recording-now", { id: channel.id, ...options }, "", liveStatus) && !active) {
        liveStatus.textContent = arkhamLanguage.t("Grabación solicitada. Consulta su estado en Grabaciones.");
      }
    }
    liveStrip.hidden = !liveStatus.textContent;
  });

  function item(job) {
    const row = document.createElement("li");
    const details = document.createElement("div");
    const title = document.createElement("strong");
    const metadata = document.createElement("small");
    const playable = Boolean(job.file && ["done", "error"].includes(job.state));
    const illustrated = showThumbnails && playable;
    const quality = recordingQualities[job.quality];
    title.textContent = job.title;
    const when = date.format(job.start * 1000);
    const audio = job.audio ? trackLabel(job.audio, 0) : null;
    metadata.textContent = (illustrated ? [job.channel.name, when, audio] : [labels[job.state], job.channel.name, when, quality, audio])
      .filter(Boolean).join(" · ");
    if (illustrated) {
      row.className = "recording-card";
      details.className = "recording-details";
      const cover = document.createElement("button");
      cover.type = "button";
      cover.className = "recording-cover";
      cover.setAttribute("aria-label", arkhamLanguage.t("Reproducir") + " " + job.title);
      cover.title = arkhamLanguage.t("Reproducir");
      cover.addEventListener("click", () => openRecording(job.id));
      const image = document.createElement("img");
      image.alt = "";
      image.loading = "lazy";
      image.decoding = "async";
      image.addEventListener("load", () => cover.classList.add("has-frame"), { once: true });
      image.addEventListener("error", () => image.remove(), { once: true });
      image.src = "/grabacion/" + job.id + ".jpg";
      const play = document.createElement("span");
      play.className = "recording-cover-play";
      play.append(recordingIcon("play"));
      cover.append(image, play);
      if (quality) {
        const format = document.createElement("span");
        format.className = "recording-cover-format";
        format.textContent = quality;
        cover.append(format);
      }
      row.append(cover);
      const badge = document.createElement("span");
      badge.className = "recording-state";
      badge.dataset.state = job.state;
      badge.textContent = labels[job.state];
      details.append(badge);
    }
    details.append(title, metadata);
    if (playable) {
      const file = document.createElement("p");
      file.className = "feedback recording-file";
      file.textContent = illustrated ? job.file.split("/").pop() : job.file;
      if (illustrated) file.title = job.file;
      details.append(file);
    }
    if (job.message) {
      const message = document.createElement("p");
      message.className = "feedback";
      message.textContent = arkhamLanguage.message(job.message);
      details.append(message);
    }
    row.append(details);
    if (["scheduled", "recording"].includes(job.state)) {
      const stop = document.createElement("button");
      stop.type = "button";
      stop.className = "button secondary";
      stop.textContent = job.state === "scheduled" ? arkhamLanguage.t("Cancelar") : arkhamLanguage.t("Detener");
      stop.setAttribute("aria-label", stop.textContent + " " + job.title);
      stop.addEventListener("click", () => change("recording-stop", { id: job.id },
        job.state === "scheduled" ? arkhamLanguage.t("Programación cancelada.") : arkhamLanguage.t("Guardando la grabación…")));
      row.append(stop);
    } else if (["done", "error", "cancelled"].includes(job.state)) {
      const buttons = document.createElement("div");
      buttons.className = "recording-buttons";
      if (playable && !illustrated) {
        const play = document.createElement("button");
        play.type = "button";
        play.className = "button primary";
        play.textContent = arkhamLanguage.t("Reproducir");
        play.setAttribute("aria-label", arkhamLanguage.t("Reproducir") + " " + job.title);
        play.addEventListener("click", () => openRecording(job.id));
        buttons.append(play);
      }
      if (playable && transcribeRecording) {
        const transcribe = document.createElement("button");
        transcribe.type = "button";
        transcribe.className = "button secondary recording-transcribe";
        const label = arkhamLanguage.locale.startsWith("en") ? "Transcribe" : "Transcribir";
        transcribe.append(recordingIcon("signal-captions"), document.createTextNode(label));
        transcribe.setAttribute("aria-label", label + " · " + job.title);
        transcribe.addEventListener("click", async () => {
          if (transcribe.dataset.busy) return;
          transcribe.dataset.busy = "true";
          transcribe.disabled = true;
          feedback.textContent = "";
          try {
            await transcribeRecording(job.id);
          } catch (error) {
            feedback.textContent = error.message;
          } finally {
            delete transcribe.dataset.busy;
            transcribe.disabled = false;
          }
        });
        buttons.append(transcribe);
      }
      const remove = document.createElement("button");
      remove.type = "button";
      remove.className = "button secondary recording-delete";
      remove.textContent = job.file ? arkhamLanguage.t("Eliminar") : arkhamLanguage.t("Quitar");
      remove.setAttribute("aria-label", remove.textContent + " " + job.title);
      remove.addEventListener("click", () => {
        deleteId = job.id;
        dialog.returnValue = "";
        el("recording-delete-copy").textContent = job.file
          ? arkhamLanguage.f("Se eliminará de este equipo el archivo de «{title}».", "Delete the file for “{title}” from this computer?", job)
          : arkhamLanguage.f("Se quitará «{title}» del historial de grabaciones.", "Remove “{title}” from the recording history?", job);
        dialog.showModal();
      });
      buttons.append(remove);
      row.append(buttons);
    }
    return row;
  }

  function render(state, pending) {
    currentState = state;
    jobs = state.recordings || [];
    syncPlayer();
    const liveLabel = active?.id;
    active = jobs.find((job) => job.state === "recording" || job.state === "finishing");
    const counting = active?.state === "recording" && Number.isFinite(state.recordingElapsed);
    clock.hidden = !counting;
    if (!counting) {
      clearTimeout(clockTick);
      clockSnapshot = undefined;
    } else if (clockSnapshot !== state) {
      clearTimeout(clockTick);
      if (liveLabel !== active.id || clockSnapshot === undefined) shownSeconds = 0;
      clockSnapshot = state;
      recordingOrigin = performance.now() - state.recordingElapsed * 1000;
      updateClock();
    }
    if (state.recordingFolder !== folderValue) {
      folderValue = state.recordingFolder;
      folder.value = folderValue || "";
    }
    folder.disabled = el("recording-folder-save").disabled = pending || !folderValue;
    openLibraryFolder.disabled = pending || !folderValue;
    openVideoFolder.disabled = pending || !playbackId;
    const status = active ? active.state === "finishing" ? arkhamLanguage.t("Guardando la grabación…")
      : `Grabando «${active.title}» · ${active.channel.id === "hdmi" ? arkhamLanguage.t("Entrada HDMI") : active.manual ? arkhamLanguage.t("Se detiene al cambiar de canal.") :
        arkhamLanguage.f("Puedes ver otros canales de UHF {uhf}.", "You can watch other channels on UHF {uhf}.", active.channel)}` : "";
    if (liveLabel !== active?.id || active) {
      if (liveStatus.textContent !== status) liveStatus.textContent = status;
      liveStrip.hidden = !status;
    }
    live.toggleAttribute("data-recording", Boolean(active));
    el("record-live-label").textContent = active ? active.manual ? arkhamLanguage.t("Detener grabación") : arkhamLanguage.t("Grabando") : arkhamLanguage.t("Grabar");
    live.disabled = pending || Boolean(active && (!active.manual || active.state === "finishing"))
      || (!active && ((!state.hardware.ready && !state.stream?.hdmi) || !state.stream?.ready || state.scan.state === "running"));
    const nextKey = JSON.stringify(jobs);
    if (key !== nextKey) {
      key = nextKey;
      list.replaceChildren(...[...jobs].sort((a, b) => b.start - a.start).map(item));
      list.hidden = !jobs.length;
      el("recording-empty").hidden = Boolean(jobs.length);
    }
    for (const button of list.querySelectorAll("button")) button.disabled = pending || Boolean(button.dataset.busy);
  }

  return { render, navigate };
}
