"use strict";

const recordingQualities = { 480: "480p", 720: "720p", 1080: "1080p", 2160: "4K" };

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

function createRecordings({ action, openRecording, chooseCapture }) {
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
  const recordedVideo = el("recorded-video");
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

  function showPlaybackError(message) {
    recordedError.textContent = message;
    recordedError.hidden = !message;
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
    title.textContent = job.title;
    metadata.textContent = [labels[job.state], job.channel.name, date.format(job.start * 1000),
      recordingQualities[job.quality], job.audio ? trackLabel(job.audio, 0) : null].filter(Boolean).join(" · ");
    details.append(title, metadata);
    if (job.file && ["done", "error"].includes(job.state)) {
      const file = document.createElement("p");
      file.className = "feedback recording-file";
      file.textContent = job.file;
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
      if (job.file) {
        const play = document.createElement("button");
        play.type = "button";
        play.className = "button primary";
        play.textContent = arkhamLanguage.t("Reproducir");
        play.setAttribute("aria-label", arkhamLanguage.t("Reproducir") + " " + job.title);
        play.addEventListener("click", () => openRecording(job.id));
        buttons.append(play);
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
    for (const button of list.querySelectorAll("button")) button.disabled = pending;
  }

  return { render, navigate };
}
