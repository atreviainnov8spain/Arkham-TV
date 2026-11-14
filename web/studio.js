function createAudioStudio({ api, action, video, playingStream, playbackDate }) {
  const bands = [31, 63, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];
  const presets = [
    ["Flat", arkhamLanguage.t("Mantiene el balance original de la emisión."), [0, 0, 0, 0, 0, 0, 0, 0, 0, 0]],
    [arkhamLanguage.t("Diálogos"), arkhamLanguage.t("Realza la voz y reduce el grave que la enmascara."), [-6, -5, -3, -2, 0, 2, 5, 4, 1, -1]],
    [arkhamLanguage.t("Cine"), arkhamLanguage.t("Da cuerpo a la banda sonora y presencia a las voces."), [2, 4, 3, 0, -2, 0, 2, 3, 2, 1]],
    [arkhamLanguage.t("Deportes"), arkhamLanguage.t("Acerca la narración y los detalles del ambiente."), [-4, -2, -1, 0, 1, 3, 4, 3, 1, 0]],
    [arkhamLanguage.t("Noche"), arkhamLanguage.t("Reduce los graves y suaviza los agudos para escuchar a bajo volumen."), [-9, -7, -4, -2, 0, 2, 3, 2, -2, -4]],
    ["Rock", arkhamLanguage.t("Refuerza el grave y da brillo a guitarras y percusión."), [4, 5, 3, 0, -2, -1, 2, 4, 4, 2]],
    ["Pop", arkhamLanguage.t("Da presencia a las voces y un grave redondo."), [2, 3, 2, 0, 1, 3, 4, 2, 1, 0]],
  ];
  const el = id => document.getElementById(id);
  const controls = el("eq-controls");
  const form = el("eq-form");
  const apply = el("eq-apply");
  const profile = gains => presets.find(([, , values]) => same(values, gains));
  const same = (a, b) => a.every((value, index) => value === b[index]);
  const signed = number => number > 0 ? "+" + number : String(number).replace("-", "−");
  let saved = presets[0][2];
  let draft = [...saved];
  let edit = false;
  let busy = false;
  let ready = false;

  function drawPreview() {
    const activePreset = profile(saved)?.[0] || arkhamLanguage.t("Personalizado");
    const flat = activePreset === "Flat";
    el("eq-preview-profile").textContent = activePreset;
    el("eq-preview-state").textContent = flat ? arkhamLanguage.t("Sin ecualización") : arkhamLanguage.t("Curva aplicada a la emisión");
    const svgNS = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(svgNS, "svg");
    svg.setAttribute("viewBox", "0 0 210 66");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", flat ? arkhamLanguage.t("Todas las bandas en 0 decibelios") :
      bands.map((hz, index) => hz + (arkhamLanguage.language === "en" ? " hertz: " : " hercios: ") + signed(saved[index]) + " dB").join(", "));
    const path = (className, points) => {
      const line = document.createElementNS(svgNS, "path");
      line.setAttribute("class", className);
      line.setAttribute("d", points);
      svg.append(line);
    };
    path("eq-preview-grid", "M0 8H210 M0 58H210");
    path("eq-preview-zero", "M0 33H210");
    const points = saved.map((gain, index) => [10 + index * 21, 33 - gain * 2.05]);
    points.forEach(([x, y]) => path("eq-preview-band", "M" + x + " 33V" + y));
    path(flat ? "eq-preview-flat" : "eq-preview-line", "M" + points.map(pair => pair.join(" ")).join("L"));
    for (const [x, y] of points) {
      const point = document.createElementNS(svgNS, "circle");
      point.setAttribute("cx", x);
      point.setAttribute("cy", y);
      point.setAttribute("r", flat ? "1.5" : "2.3");
      point.setAttribute("class", flat ? "eq-preview-flat-point" : "eq-preview-point");
      svg.append(point);
    }
    el("eq-preview-chart").replaceChildren(svg);
  }

  const presetButtons = presets.map(([name, , values]) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = name;
    button.addEventListener("click", () => change([...values]));
    el("eq-presets").append(button);
    return button;
  });
  const sliders = bands.map((hz, index) => {
    const band = document.createElement("label");
    band.className = "eq-band";
    const output = document.createElement("output");
    output.setAttribute("aria-hidden", "true");
    const input = document.createElement("input");
    Object.assign(input, { type: "range", min: -12, max: 12, step: 1, value: 0 });
    input.setAttribute("aria-label", hz + (arkhamLanguage.language === "en" ? " hertz" : " hercios"));
    const track = document.createElement("span");
    track.className = "eq-track";
    const label = document.createElement("span");
    label.className = "eq-frequency";
    label.textContent = hz < 1000 ? String(hz) : hz / 1000 + "k";
    input.addEventListener("input", () => {
      draft[index] = input.valueAsNumber;
      change(draft, false);
    });
    track.append(input);
    band.append(output, track, label);
    controls.append(band);
    return { input, output };
  });

  function updateEq(syncInputs = true) {
    const chosen = profile(draft);
    presetButtons.forEach((button, index) => button.setAttribute("aria-pressed", String(presets[index] === chosen)));
    el("eq-description").textContent = chosen?.[1] || arkhamLanguage.t("Ajuste personalizado por frecuencia.");
    el("eq-active").textContent = (arkhamLanguage.language === "en" ? "Active · " : "Activo · ") + (profile(saved)?.[0] || arkhamLanguage.t("Personalizado"));
    sliders.forEach(({ input, output }, index) => {
      if (syncInputs) input.value = draft[index];
      const gain = signed(draft[index]) + " dB";
      output.textContent = signed(draft[index]);
      input.setAttribute("aria-valuetext", gain);
    });
    apply.disabled = !ready || busy || !edit;
  }

  function change(gains, syncInputs = true) {
    draft = gains;
    edit = !same(draft, saved);
    el("eq-feedback").textContent = arkhamLanguage.t("Al aplicar un cambio se vuelve a conectar la emisión.");
    updateEq(syncInputs);
  }
  form.addEventListener("submit", async event => {
    event.preventDefault();
    if (apply.disabled) return;
    busy = true;
    apply.disabled = true;
    controls.disabled = true;
    presetButtons.forEach(button => { button.disabled = true; });
    const gains = [...draft];
    const success = await action("equalizer", { gains });
    if (success) {
      saved = gains;
      edit = false;
      drawPreview();
    }
    controls.disabled = false;
    presetButtons.forEach(button => { button.disabled = false; });
    busy = false;
    updateEq();
    el("eq-feedback").textContent = success ? arkhamLanguage.t("Ajuste guardado.") : arkhamLanguage.t("No se ha podido aplicar el ajuste.");
  });
  updateEq();
  drawPreview();

  const meter = el("meter-display");
  const meterState = el("meter-state");
  const meterButtons = [...el("meter-modes").querySelectorAll("button")];
  const spectrumChart = el("spectrum-chart");
  const spectrumState = el("spectrum-state");
  const miniSpectrum = el("mini-spectrum");
  const miniBars = bands.map(() => miniSpectrum.appendChild(document.createElement("span")));
  const spectrumBars = bands.map(hz => {
    const column = document.createElement("div");
    column.className = "spectrum-column";
    const track = document.createElement("div");
    track.className = "spectrum-track";
    track.setAttribute("role", "meter");
    track.setAttribute("aria-label", hz + (arkhamLanguage.language === "en" ? " hertz" : " hercios"));
    track.setAttribute("aria-valuemin", "-72");
    track.setAttribute("aria-valuemax", "0");
    const label = document.createElement("span");
    label.setAttribute("aria-hidden", "true");
    label.textContent = hz < 1000 ? String(hz) : hz / 1000 + "k";
    column.append(track, label);
    spectrumChart.append(column);
    return track;
  });
  let mode = "digital";
  try {
    if (localStorage.getItem("arkhamtv.meter") === "analog") mode = "analog";
  } catch {}
  let gauges;
  let samples = [];
  let sampleStream;
  let paintedSample;
  let active = false;
  let timer = 0;
  let nextSampleRequest = 0;
  let lastAudioSample = -Infinity;
  let heldSample;
  let paintedLevels;
  let lastPaint = 0;

  function updateMeterCaptions(sample, now) {
    const stream = playingStream();
    const muted = video.muted || video.volume === 0;
    if (!stream || video.paused || muted) lastAudioSample = -Infinity;
    else if (sample) lastAudioSample = now;
    const recent = Boolean(stream) && !video.paused && !muted && now - lastAudioSample < 1600;
    const inactive = !stream ? "En espera" : video.paused ? "En pausa" : muted ? "Silenciado" : "Sin señal de audio";
    const meterLabel = arkhamLanguage.t(recent ? "Nivel / pico" : inactive);
    const spectrumLabel = arkhamLanguage.t(recent ? "En directo" : inactive);
    if (meterState.textContent !== meterLabel) meterState.textContent = meterLabel;
    if (spectrumState.textContent !== spectrumLabel) spectrumState.textContent = spectrumLabel;
  }

  function buildMeter() {
    meter.classList.toggle("meter-analog", mode === "analog");
    meterButtons.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.meter === mode)));
    gauges = [arkhamLanguage.t("Izquierdo"), arkhamLanguage.t("Derecho")].map((channel, index) => {
      const gauge = document.createElement("div");
      gauge.className = "meter-gauge";
      const instrument = document.createElement("div");
      instrument.className = "meter-instrument";
      instrument.setAttribute("role", "meter");
      instrument.setAttribute("aria-label", arkhamLanguage.f("Canal {side}", "{side} channel", { side: channel }));
      instrument.setAttribute("aria-valuemin", "-60");
      instrument.setAttribute("aria-valuemax", "0");
      instrument.innerHTML = mode === "analog"
        ? '<svg viewBox="0 0 120 74" aria-hidden="true"><path class="meter-arc" d="M14 57a46 46 0 0 1 92 0"/><path class="meter-hot" d="M96 29a46 46 0 0 1 10 28"/><path class="meter-ticks" d="M17 47l6 1m2-18 5 4m11-16 3 7m16-11v7m19-3-3 7m19 5-5 4m13 13-6 1"/><path class="meter-needle" d="M60 56V18"/><circle class="meter-pin" cx="60" cy="56" r="4"/><text x="16" y="70">−60</text><text x="102" y="70">0</text></svg>'
        : '<span class="meter-fill"></span><span class="meter-peak"></span>';
      const label = document.createElement("span");
      label.className = "meter-channel";
      label.textContent = index ? "R" : "L";
      const number = document.createElement("span");
      number.className = "meter-number";
      gauge.append(instrument, label, number);
      return { gauge, instrument, number, needle: instrument.querySelector(".meter-needle") };
    });
    meter.replaceChildren(...gauges.map(item => item.gauge));
    paintCurrentSample();
  }

  function paintMeter(sample) {
    const muted = video.muted || video.volume === 0;
    const trim = muted ? -60 : 20 * Math.log10(video.volume);
    const shown = Boolean(sample) && !muted;
    const [, levels, peaks, bands] = sample || [];
    const now = performance.now();
    const elapsed = Math.min(now - lastPaint, 100);
    lastPaint = now;
    if (!shown) paintedLevels = null;
    const next = (value, previous, attack, release, floor = -60) => {
      const target = Math.max(floor, value + trim);
      if (previous === undefined) return target;
      const smoothing = target > previous ? attack : release;
      return previous + (target - previous) * (1 - Math.exp(-elapsed / smoothing));
    };
    if (shown) {
      paintedLevels = {
        rms: levels.map((value, i) => next(value, paintedLevels?.rms[i], 34, 180)),
        peak: peaks.map((value, i) => next(value, paintedLevels?.peak[i], 18, 300)),
        bands: bands.map((value, i) => next(value, paintedLevels?.bands[i], 36, 210, -72)),
      };
    }
    gauges.forEach(({ instrument, number, needle }, index) => {
      const rms = shown ? Math.round(paintedLevels.rms[index]) : -60;
      const peak = shown ? Math.round(paintedLevels.peak[index]) : -60;
      instrument.style.setProperty("--level", (rms + 60) / 60 * 100 + "%");
      instrument.style.setProperty("--peak", (peak + 60) / 60 * 100 + "%");
      if (needle) needle.setAttribute("transform", "rotate(" + (-78 + (rms + 60) * 2.6) + " 60 56)");
      instrument.setAttribute("aria-valuenow", rms);
      instrument.setAttribute("aria-valuetext", rms <= -60 ? arkhamLanguage.t("Por debajo de −60 dBFS") : signed(rms) + " dBFS");
      number.textContent = shown ? (peak <= -60 ? "−∞" : signed(peak)) : "—";
    });
    const spectrum = paintedLevels?.bands;
    spectrumBars.forEach((track, index) => {
      const level = spectrum ? Math.round(spectrum[index]) : -72;
      // Reserve most of the display for the quieter levels found in individual bands.
      const steps = Math.floor(level <= -30 ? (level + 72) * 12 / 42 : 12 + (level + 30) * 4 / 30);
      const masked = (100 - steps * 6.25) + "%";
      track.style.setProperty("--spectrum-hidden", masked);
      miniBars[index].style.setProperty("--spectrum-hidden", masked);
      track.setAttribute("aria-valuenow", level);
      track.setAttribute("aria-valuetext", level <= -72 ? arkhamLanguage.t("Por debajo de −72 dBFS") : signed(level) + " dBFS");
    });
  }

  function audiblePosition() {
    if (playingStream() && !video.paused && !video.muted && video.volume > 0 && !video.seeking && video.readyState >= 3) {
      return playbackDate();
    }
    return NaN;
  }

  function sampleAt(position) {
    if (!Number.isFinite(position)) {
      heldSample = null;
      return null;
    }
    for (let index = samples.length - 1; index >= 0; index--) {
      const sample = samples[index];
      if (sample[0] > position + 0.004) continue;
      if (sample[0] > position - 0.125) heldSample = sample;
      break;
    }
    return heldSample && heldSample[0] <= position + 0.004 && heldSample[0] > position - 0.22 ? heldSample : null;
  }

  function paintCurrentSample() {
    const sample = sampleStream === playingStream() ? sampleAt(audiblePosition()) : null;
    paintedSample = sample;
    updateMeterCaptions(sample, performance.now());
    paintMeter(sample);
  }

  function updateMeters(now) {
    const stream = playingStream();
    if (sampleStream !== stream) {
      sampleStream = stream;
      samples = [];
      heldSample = null;
      paintedLevels = null;
      nextSampleRequest = 0;
      lastAudioSample = -Infinity;
      paintCurrentSample();
    }
    const position = audiblePosition();
    if (Number.isFinite(position) && now >= nextSampleRequest) {
      nextSampleRequest = now + 500;
      const request = nextSampleRequest;
      api("levels?" + new URLSearchParams({ stream, at: position })).then(result => {
        if (sampleStream === stream && nextSampleRequest === request) samples = result.sort((a, b) => a[0] - b[0]);
      }).catch(() => {});
    }
    const sample = sampleAt(position);
    updateMeterCaptions(sample, now);
    if (sample !== paintedSample || (sample && now - lastPaint >= 32)) {
      paintedSample = sample;
      paintMeter(sample);
    }
    timer = requestAnimationFrame(updateMeters);
  }

  for (const button of meterButtons) {
    button.addEventListener("click", () => {
      mode = button.dataset.meter;
      try { localStorage.setItem("arkhamtv.meter", mode); } catch {}
      buildMeter();
    });
  }
  for (const event of ["volumechange", "pause", "playing", "seeking", "waiting", "emptied"]) {
    video.addEventListener(event, () => {
      if (event === "seeking" || event === "emptied") {
        heldSample = null;
        samples = [];
        nextSampleRequest = 0;
      }
      if (active) paintCurrentSample();
    });
  }
  buildMeter();

  return {
    navigate(hash) {
      const live = hash === "#directo";
      if (live === active) return;
      active = live;
      cancelAnimationFrame(timer);
      if (active) {
        nextSampleRequest = 0;
        timer = requestAnimationFrame(updateMeters);
      }
    },
    render(state, pending) {
      ready = Array.isArray(state.equalizer) && !pending && state.scan.state !== "running";
      if (Array.isArray(state.equalizer) && !same(saved, state.equalizer)) {
        saved = state.equalizer;
        if (!edit) draft = [...saved];
        edit = !same(draft, saved);
        updateEq();
        drawPreview();
      } else {
        apply.disabled = !ready || busy || !edit;
      }
      if (active && !playingStream()) paintCurrentSample();
    },
  };
}

function createGuide({ api, action, tune, chooseCapture }) {
  const el = id => document.getElementById(id);
  const grid = el("guide-grid");
  const scroller = el("guide-scroll");
  const detail = el("guide-detail");
  const refresh = el("guide-refresh");
  const watch = el("guide-watch");
  const record = el("guide-record");
  const recordFeedback = el("guide-record-feedback");
  const note = el("guide-note");
  const slot = 1800;
  const duration = 8 * slot;
  const now = () => Math.floor(Date.now() / 1000);
  const currentStart = () => Math.floor(now() / slot) * slot;
  const hour = new Intl.DateTimeFormat(arkhamLanguage.locale, { hour: "2-digit", minute: "2-digit" });
  const day = new Intl.DateTimeFormat(arkhamLanguage.locale, { weekday: "long", day: "numeric", month: "long" });
  const format = (formatter, seconds) => formatter.format(seconds * 1000);
  let start = currentStart();
  let active = false;
  let state = null;
  let pending = false;
  let schedule = {};
  let version = 0;
  let timer = 0;
  let key = "";
  let selected;
  let selectedEvent;
  let selectedButton;
  let loading = false;
  let error = false;

  const element = (tag, className, value) => {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (value) node.textContent = value;
    return node;
  };
  function selectProgram(channel, event, button) {
    selected = channel.id;
    selectedEvent = event;
    selectedButton = button;
    el("guide-program-channel").textContent = channel.name;
    el("guide-program-title").textContent = event.title;
    el("guide-program-time").textContent = format(day, event.start) + " · " + times(event);
    const { paragraphs, values } = describeProgram(event);
    renderProgramSynopsis(el("guide-program-description"), paragraphs, arkhamLanguage.t("La emisora no ha enviado una sinopsis."));
    renderProgramFacts(el("guide-program-facts"), [...values]);
    const future = event.start > now();
    el("guide-watch-label").textContent = future ? arkhamLanguage.t("Ver lo que se emite ahora") : arkhamLanguage.t("Ver canal en directo");
    watch.disabled = pending || !state.hardware.ready || state.scan.state === "running";
    recordFeedback.textContent = "";
    updateRecord();
    detail.showModal();
  }
  detail.addEventListener("close", () => {
    if (active && selectedButton?.isConnected) selectedButton.focus({ preventScroll: true });
  });
  watch.addEventListener("click", () => {
    detail.close();
    tune(selected);
  });
  record.addEventListener("click", async () => {
    const channel = state.channels.find(item => item.id === selected);
    const event = selectedEvent;
    const scheduled = event.start > now();
    const options = await chooseCapture({ channel, title: event.title, scheduled,
      audioPid: state.stream?.channel === selected ? state.stream.audioPid : null });
    if (!options) return;
    const payload = { id: channel.id, start: event.start, ...options };
    recordFeedback.textContent = "";
    if (await action("recording-schedule", payload, (message) => { recordFeedback.textContent = message; })) {
      recordFeedback.textContent = arkhamLanguage.t(scheduled ? "Grabación programada. Puedes gestionarla en Grabaciones."
        : "Grabación solicitada. Consulta su estado en Grabaciones.");
    }
  });
  function updateRecord() {
    const programmed = state.recordings?.some((job) => job.channel.id === selected
      && job.programme_start === selectedEvent.start && ["scheduled", "recording", "finishing"].includes(job.state));
    const current = now();
    record.disabled = pending || programmed || selectedEvent.end <= current
      || (selectedEvent.start <= current && !state.hardware.ready);
    el("guide-record-label").textContent = programmed ? arkhamLanguage.t("Grabación programada")
      : selectedEvent.start > current ? arkhamLanguage.t("Programar grabación") : arkhamLanguage.t("Grabar programa");
  }
  const times = event => format(hour, event.start) + " – " + format(hour, event.end);

  function draw() {
    if (!state || !active) return;
    const current = now();
    const currentMinute = Math.floor(current / 60);
    const end = start + duration;
    const blocked = pending || state.scan.state === "running" || !state.hardware.ready;
    refresh.disabled = blocked || !state.channels.length || state.recordingUhf != null;
    if (detail.open) {
      watch.disabled = blocked;
      updateRecord();
    }
    el("guide-back").disabled = start <= currentStart();
    el("guide-next").disabled = start >= currentStart() + 7 * 86400 - duration;
    el("guide-day").textContent = format(day, start);
    const scan = state.scan;
    const hasEvents = Object.values(schedule).some(events => events.length);
    const message = scan.kind === "guide" && scan.state === "running" ? arkhamLanguage.f("Recibiendo programación · UHF {current}.", "Receiving listings · UHF {current}.", scan)
      + (scan.resume ? " " + arkhamLanguage.t("La emisión se reanudará al terminar.") : "")
      : error ? arkhamLanguage.t("No se ha podido cargar la programación.")
      : !state.channels.length ? arkhamLanguage.t("Sintoniza tus canales para recibir la programación.")
      : loading && !hasEvents ? arkhamLanguage.t("Cargando la programación…")
      : !hasEvents ? (scan.kind === "guide" && scan.message && scan.state === "error" ? arkhamLanguage.message(scan.message) : arkhamLanguage.t("Sin horarios para este tramo. Puedes actualizar la guía o ver el canal en directo."))
      : scan.kind === "guide" && scan.state === "error" ? arkhamLanguage.message(scan.message)
      : arkhamLanguage.t("Actualizar la guía pausa la emisión mientras se consultan las frecuencias sintonizadas.");
    if (note.textContent !== message) note.textContent = message;
    const drawKey = JSON.stringify([start, state.channels, schedule, state.stream?.channel, blocked]);
    if (key !== drawKey) {
      key = drawKey;
      const focused = document.activeElement?.dataset.guideKey;
      const channelHeader = element("span", "guide-station guide-station-head", arkhamLanguage.t("Canal"));
      const hours = element("div", "guide-hours");
      for (let tick = start; tick < end; tick += slot) hours.append(element("span", "", format(hour, tick)));
      const header = element("div", "guide-row guide-head");
      header.append(channelHeader, hours);
      const rows = state.channels.map(channel => {
        const row = element("div", "guide-row");
        const station = element("button", "guide-station", channel.name);
        station.type = "button";
        station.disabled = blocked;
        station.dataset.guideKey = channel.id;
        station.setAttribute("aria-label", arkhamLanguage.f("Ver {name} en directo", "Watch {name} live", { name: channel.name }));
        if (state.stream?.channel === channel.id) station.setAttribute("aria-current", "true");
        station.addEventListener("click", () => tune(channel.id));
        const logo = window.channelLogoPath?.(channel.name);
        if (logo) {
          const image = element("img");
          image.src = logo;
          image.alt = "";
          image.addEventListener("error", () => image.remove(), { once: true });
          station.prepend(image);
        }
        const track = element("div", "guide-track");
        const events = schedule[channel.id] || [];
        if (!events.length) track.append(element("span", "guide-unavailable", arkhamLanguage.t("Sin programación disponible")));
        for (const event of events) {
          const block = element("button", "guide-event");
          block.type = "button";
          block.dataset.guideKey = channel.id + ":" + event.id;
          block.dataset.channel = channel.id;
          block.dataset.start = event.start;
          block.dataset.end = event.end;
          block.style.insetInlineStart = (Math.max(event.start, start) - start) / duration * 100 + "%";
          block.style.width = (Math.min(event.end, end) - Math.max(event.start, start)) / duration * 100 + "%";
          block.title = event.title + " · " + times(event);
          block.setAttribute("aria-label", channel.name + ", " + block.title);
          block.append(element("strong", "", event.title), element("small", "", times(event)));
          block.addEventListener("click", () => selectProgram(channel, event, block));
          track.append(block);
        }
        row.append(station, track);
        return row;
      });
      const marker = element("div", "guide-marker");
      marker.setAttribute("aria-hidden", "true");
      grid.replaceChildren(header, ...rows, marker);
      if (focused) [...grid.querySelectorAll("[data-guide-key]")].find(node => node.dataset.guideKey === focused)?.focus({ preventScroll: true });
    }
    const marker = grid.querySelector(".guide-marker");
    marker.hidden = current < start || current >= end;
    marker.style.setProperty("--now", (currentMinute * 60 - start) / duration * 100 + "%");
    const recordingSlots = new Set((state.recordings || [])
      .filter((job) => ["scheduled", "recording", "finishing"].includes(job.state))
      .map((job) => job.channel.id + ":" + job.programme_start));
    for (const block of grid.querySelectorAll(".guide-event")) {
      const onAir = +block.dataset.start <= current && +block.dataset.end > current;
      const scheduled = recordingSlots.has(block.dataset.channel + ":" + block.dataset.start);
      block.classList.toggle("guide-on-air", onAir);
      block.classList.toggle("guide-past", +block.dataset.end <= current);
      const timeLabel = onAir ? arkhamLanguage.t("En directo") + " · " + Math.ceil((+block.dataset.end - current) / 60) + " min"
        : times({ start: +block.dataset.start, end: +block.dataset.end });
      const label = scheduled ? "● " + arkhamLanguage.t("Grabación") + " · " + timeLabel : timeLabel;
      const subtitle = block.querySelector("small");
      if (subtitle.textContent !== label) subtitle.textContent = label;
    }
  }

  async function load() {
    const request = ++version;
    loading = true;
    error = false;
    draw();
    try {
      const data = await api("guide?from=" + start + "&to=" + (start + duration));
      if (request === version) schedule = data;
    } catch {
      if (request === version) error = true;
    } finally {
      if (request === version) {
        loading = false;
        draw();
      }
    }
  }
  function goTo(timestamp) {
    start = Math.max(currentStart(), Math.min(timestamp, currentStart() + 7 * 86400 - duration));
    schedule = {};
    key = "";
    scroller.scrollLeft = 0;
    load();
  }
  el("guide-back").addEventListener("click", () => goTo(start - duration));
  el("guide-next").addEventListener("click", () => goTo(start + duration));
  el("guide-now").addEventListener("click", () => goTo(currentStart()));
  refresh.addEventListener("click", () => action("guide-refresh", {}));

  return {
    navigate(hash) {
      const visible = hash === "#guia";
      if (active === visible) return;
      active = visible;
      clearInterval(timer);
      if (active) {
        if (start < currentStart() && start + duration <= now()) start = currentStart();
        load();
        timer = setInterval(load, 12000);
      } else if (detail.open) {
        detail.close();
      }
    },
    render(next, working) {
      const updated = state?.scan.state === "running" && next.scan.state !== "running";
      const channelsChanged = !state || state.channels.length !== next.channels.length;
      state = next;
      pending = working;
      if (active && (updated || channelsChanged)) load();
      else draw();
    },
  };
}
