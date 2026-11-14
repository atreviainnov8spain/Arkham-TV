function createSignalAnalysis({ api, tune }) {
  const el = id => document.getElementById("signal-" + id);
  const section = document.getElementById("analisis");
  const sky = section.querySelector(".signal-world");
  const links = section.querySelector(".signal-links");
  const planets = section.querySelector(".signal-planets");
  const satellites = section.querySelector(".signal-satellites");
  const channelPicker = createBroadcastChannelPicker(el("picker"), selectChannel);
  const overview = el("overview");
  const electric = el("electric");
  const percent = new Intl.NumberFormat(arkhamLanguage.locale, { style: "percent", maximumFractionDigits: 1 });
  const trackIcons = { video: "i-live", audio: "i-volume", subtitles: "i-signal-captions", teletext: "i-guide", other: "i-signal-layers" };
  const motion = matchMedia("(prefers-reduced-motion: reduce)");
  const f = (es, en, fields) => arkhamLanguage.f(es, en, fields);
  const language = new Intl.DisplayNames(arkhamLanguage.locale, { type: "language", fallback: "none" });
  const number = new Intl.NumberFormat(arkhamLanguage.locale, { maximumFractionDigits: 2 });
  const clock = new Intl.DateTimeFormat(arkhamLanguage.locale, { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  const kinds = {
    video: ["Vídeo", "Video"],
    audio: ["Audio", "Audio"],
    subtitles: ["Subtítulos", "Subtitles"],
    teletext: ["Teletexto", "Teletext"],
    other: ["Otros datos y relleno", "Other data and padding"],
  };
  const colors = ["#89b5ff", "#80d5c4", "#bfaeff", "#e6b985", "#e6a2c5"];
  const tau = Math.PI * 2;
  const svgName = "http://www.w3.org/2000/svg";
  let state, reading = {}, groups = [], channelKey, frequency = null, view = "universe";
  let blocked = true, connected = true, opened = false, visible = false, feedback = "";
  let scene, loadingScene, loadingD3, request, lastPoll = 0;
  let position, flight, frame, previousTime, phase = 0, revolution = 0;
  let accent = "#b5ec70";

  function setText(id, value) {
    const node = el(id);
    if (node.textContent !== value) node.textContent = value;
  }
  function node(name, label, className) {
    const item = document.createElement(name);
    if (label !== undefined) item.textContent = label;
    if (className) item.className = className;
    if (name === "button") item.type = "button";
    return item;
  }
  function svg(name, className, parent = links) {
    const item = document.createElementNS(svgName, name);
    if (className) item.setAttribute("class", className);
    parent.append(item);
    return item;
  }
  const railToggle = document.getElementById("rail-toggle");
  const desktop = matchMedia("(min-width: 821px)");
  const preference = "arkhamtv.rail-collapsed";
  let collapsed = false;
  try { collapsed = localStorage.getItem(preference) === "true"; } catch { /* Session only. */ }
  function renderRail() {
    const folded = desktop.matches && collapsed;
    document.body.classList.toggle("signal-rail-collapsed", folded);
    railToggle.hidden = !desktop.matches;
    const label = folded ? f("Desplegar menú", "Expand menu") : f("Plegar menú", "Collapse menu");
    railToggle.setAttribute("aria-label", label);
    railToggle.title = label;
    railToggle.setAttribute("aria-expanded", String(!folded));
    for (const link of document.querySelectorAll("#main-nav .nav-link")) {
      link.title = folded ? link.textContent.trim() : "";
    }
  }
  document.body.classList.add("signal-rail-available");
  railToggle.addEventListener("click", () => {
    collapsed = !collapsed;
    try { localStorage.setItem(preference, String(collapsed)); } catch { /* Session only. */ }
    renderRail();
  });
  desktop.addEventListener("change", renderRail);
  document.addEventListener("DOMContentLoaded", renderRail, { once: true });
  renderRail();

  const orbits = [];
  const transmission = ["signal-bank", "signal-edge signal-edge--red", "signal-edge signal-edge--blue", "signal-wire"]
    .map(className => svg("path", className));
  const pulses = Array.from({ length: 3 }, () => node("span", undefined, "signal-electric-pulse"));
  electric.append(...pulses);

  function icon(id) {
    const image = document.createElementNS(svgName, "svg");
    image.setAttribute("aria-hidden", "true");
    svg("use", "", image).setAttribute("href", "#" + id);
    return image;
  }
  function rfPath(element, [startX, startY], [endX, endY], bendY) {
    element.setAttribute("d", `M${startX} ${startY} Q${(startX + endX) / 2} ${bendY} ${endX} ${endY}`);
  }
  const currentChannel = () => state?.stream?.hdmi ? undefined : state?.stream?.channel;
  const activeGroup = () => groups.find(group => group.channels.some(channel => channel.id === currentChannel()));
  const ready = () => connected && state?.hardware.ready && !blocked && state.scan.state !== "running" && state.recordingUhf == null;

  function selectChannel(id) {
    if (!ready()) return;
    const group = groups.find(item => item.channels.some(channel => channel.id === id));
    if (!group) return;
    message("");
    if (frequency !== group.frequency) focus(group.frequency);
    if (id !== currentChannel()) tune(id, message);
  }
  function message(value) {
    feedback = value;
    showFeedback();
  }
  function showFeedback() {
    const detail = !connected ? f("Servidor desconectado", "Server disconnected")
      : state?.recordingUhf != null ? f("El cambio de canal está bloqueado durante la grabación.", "Channel switching is locked while recording.")
        : state?.scan.state === "running" ? f("Buscando canales…", "Scanning for channels…")
          : state?.stream?.hdmi ? f("El receptor HDMI gestiona la señal de antena. Elige un canal USB para analizarla.", "The HDMI receiver manages the antenna signal. Choose a USB tuner channel to analyse it.")
          : state?.hardware.ready === false ? arkhamLanguage.message(state.hardware.message)
            : feedback || (!state?.stream && arkhamLanguage.message(state?.streamError)) || "";
    setText("feedback", detail);
    el("feedback").hidden = !detail;
  }
  function rebuild() {
    for (const group of groups) for (const channel of group.channels) channel.path?.remove();
    groups = groupBroadcastChannels(state?.channels || []).map((group, index) => ({
      ...group, color: colors[index % colors.length],
    }));
    if (!groups.some(group => group.frequency === frequency)) {
      frequency = null;
      flight = null;
    }
    planets.replaceChildren();
    satellites.replaceChildren();
    channelPicker.setGroups(groups);
    for (const group of groups) {
      const label = `UHF ${group.uhf}`;
      const frequencyLabel = format(group.frequency / 1e6, "MHz");
      const planet = node("button", undefined, "signal-planet");
      planet.append(node("strong", label), node("small", frequencyLabel));
      planet.style.setProperty("--planet-color", group.color);
      planet.addEventListener("click", () => {
        if (frequency === group.frequency) resetUniverse();
        else {
          focus(group.frequency);
          overview.focus({ preventScroll: true });
        }
      });
      planet.setAttribute("aria-label", `${label} · ${frequencyLabel}`);
      planets.append(planet);
      group.planet = planet;
      for (const channel of group.channels) {
        channel.dot = node("button", undefined, "signal-satellite");
        channel.dot.append(node("i"), node("span", channel.name));
        channel.dot.style.setProperty("--planet-color", group.color);
        channel.dot.setAttribute("aria-label", `${channel.name} · ${label}`);
        channel.dot.title = channel.name;
        channel.dot.addEventListener("click", () => selectChannel(channel.id));
        channel.path = svg("path");
        // Keep the signal pulse above the lines that connect planets to their channels.
        links.insertBefore(channel.path, transmission[0]);
        satellites.append(channel.dot);
      }
    }
    const count = groups.reduce((sum, group) => sum + group.channels.length, 0);
    setText("map-count", f("{channels} canales · {groups} frecuencias", "{channels} channels · {groups} frequencies",
      { channels: count, groups: groups.length }));
    el("empty").hidden = Boolean(groups.length);
    buildChoices();
  }
  function buildChoices() {
    const group = groups.find(group => group.frequency === frequency);
    const toolbar = el("choices");
    toolbar.replaceChildren();
    toolbar.hidden = !group;
    if (group) {
      for (const channel of group.channels) {
        const button = node("button", channel.name, "button secondary");
        button.dataset.channel = channel.id;
        button.addEventListener("click", () => selectChannel(channel.id));
        toolbar.append(button);
      }
    }
    syncControls();
  }
  function syncControls() {
    showFeedback();
    channelPicker.update(currentChannel(), !ready(), f("Elige un canal", "Choose a channel"));
    overview.hidden = frequency === null;
    for (const group of groups) for (const channel of group.channels) {
      const active = currentChannel() === channel.id;
      channel.dot.disabled = !ready();
      channel.dot.setAttribute("aria-pressed", String(active));
      channel.path.classList.toggle("signal-active", active);
    }
    for (const button of el("choices").children) {
      button.disabled = !ready();
      button.setAttribute("aria-pressed", String(button.dataset.channel === currentChannel()));
    }
  }
  function focus(value) {
    if (frequency === value) return;
    flight = position ? { from: position, start: performance.now() } : null;
    frequency = value;
    buildChoices();
    draw(performance.now());
    schedule();
  }

  function resetUniverse() {
    if (frequency === null) return;
    const planet = groups.find(group => group.frequency === frequency)?.planet;
    focus(null);
    planet?.focus({ preventScroll: true });
  }

  function orbitFor(index, count, angle, compact) {
    const rings = count > 8 ? Math.ceil(count / 8) : 1;
    const ring = rings === 1 ? 0 : index % rings;
    const slots = Math.ceil((count - ring) / rings);
    const theta = angle + Math.floor(index / rings) * tau / slots + ring * .33;
    const factor = rings === 1 ? 1 : .44 + .56 * ring / (rings - 1);
    const radius = (compact ? 26 : 31) * factor;
    return [50 + Math.cos(theta) * radius, 49 + (29 * Math.sin(theta) - 5 * Math.cos(theta)) * factor];
  }
  function place(element, [x, y]) {
    element.style.left = `${x.toFixed(2)}%`;
    element.style.top = `${y.toFixed(2)}%`;
  }
  function draw(now) {
    const width = sky.clientWidth;
    const height = sky.clientHeight;
    if (!opened || view !== "universe" || !width || !height) return;
    const compact = width < 670;
    const count = groups.length;
    const active = activeGroup();
    const origins = groups.map((_, index) => orbitFor(index, count, revolution - 2.66, compact));
    const targetIndex = groups.findIndex(group => group.frequency === frequency);
    const focused = targetIndex >= 0;
    const target = focused ? [...origins[targetIndex], 1.9] : [50, 50, 1];
    const progress = flight && !motion.matches ? Math.max(0, Math.min(1, (now - flight.start) / 730)) : 1;
    const eased = progress < .5 ? 4 * progress ** 3 : 1 - (-2 * progress + 2) ** 3 / 2;
    position = target.map((value, i) => flight ? flight.from[i] * (1 - eased) + value * eased : value);
    if (progress === 1) flight = null;
    const [x, y, zoom] = position;
    const project = ([px, py]) => [50 + (px - x) * zoom, 50 + (py - y) * zoom];
    const dense = focused ? groups[targetIndex].channels.length > 6 : compact || count > 5;
    sky.toggleAttribute("data-dots", dense);
    sky.toggleAttribute("data-focus", focused);
    setText("map-caption", focused ? f("Explorando UHF {uhf}", "Exploring UHF {uhf}", groups[targetIndex]) : f("Vista general", "Overview"));
    const antenna = project([50, 49]);
    const fallback = sky.querySelector(".signal-fallback");
    fallback.setAttribute("viewBox", `0 0 ${width} ${height}`);
    fallback.style.opacity = String(Math.max(0, 1 - (zoom - 1) * 1.2));
    fallback.querySelector("use").setAttribute("transform",
      `translate(${antenna[0] * width / 100} ${antenna[1] * height / 100}) scale(${Math.min(width, height) * zoom / 520})`);

    const ringCount = count > 8 ? Math.ceil(count / 8) : count ? 3 : 0;
    while (orbits.length < ringCount) orbits.push(svg("path", "signal-orbit", links));
    orbits.forEach((ring, index) => {
      ring.style.display = index < ringCount ? "" : "none";
      if (index >= ringCount) return;
      const factor = count > 8 ? .44 + .56 * index / (ringCount - 1) : [.88, 1, 1.13][index];
      const [cx, cy] = project([50, 49]);
      const radius = (compact ? 26 : 31) * factor * zoom;
      const height = 29 * factor * zoom;
      const shear = 5 * factor * zoom;
      ring.setAttribute("d", `M ${cx + radius} ${cy - shear} a ${radius} ${height} 0 0 1 ${-2 * radius} ${2 * shear} a ${radius} ${height} 0 0 1 ${2 * radius} ${-2 * shear}`);
      ring.style.opacity = String(Math.max(.12, 1 - (zoom - 1) * .9));
    });

    const hubs = groups.map((group, index) => {
      const origin = origins[index];
      const center = project(origin);
      const size = count > 8 ? 47 : compact ? Math.min(59, width * .14) : 73;
      const visible = !focused || index === targetIndex || progress < 1;
      const planet = group.planet;
      place(planet, center);
      planet.style.setProperty("--planet-size", `${size * zoom}px`);
      planet.toggleAttribute("data-active", active === group);
      planet.setAttribute("aria-expanded", String(index === targetIndex));
      planet.hidden = !visible;
      const channels = group.channels;
      channels.forEach((channel, slot) => {
        const distributed = channels.length > 4;
        const angle = -2.32 + slot * tau / channels.length;
        const dx = compact ? 12 : 9;
        const offsets = [[-dx, -11], [dx, -11], [dx, 11], [-dx, 11]];
        const orbitOffset = distributed ? [dx * 1.33 * Math.cos(angle), 13 * Math.sin(angle)] : offsets[slot];
        const closeOffset = distributed ? [31 * Math.cos(angle), 33 * Math.sin(angle)] : [
          [compact ? -29 : -30, -22], [29, -22], [29, 22], [-29, 22],
        ][slot];
        const mix = focused && index === targetIndex ? eased : 0;
        const point = project(orbitOffset.map((value, axis) =>
          origin[axis] + value * (1 - mix) + closeOffset[axis] / zoom * mix));
        place(channel.dot, point);
        channel.dot.style.setProperty("--satellite-width", `${Math.max(66, width * .19)}px`);
        channel.dot.hidden = !visible;
        channel.path.style.display = visible ? "" : "none";
        if (visible) rfPath(channel.path, center, point, point[1]);
      });
      return { x: origin[0], y: origin[1], size, active: active === group, color: group.color, visible };
    });
    const hasSignal = reading.locked === true && active && (!focused || active.frequency === frequency);
    transmission.forEach(path => { path.style.display = hasSignal ? "" : "none"; });
    electric.hidden = !hasSignal;
    if (hasSignal) {
      const source = project(origins[groups.indexOf(active)]);
      const bend = (source[1] + antenna[1]) / 2 - 8 * zoom;
      const dy = (antenna[1] - source[1]) * height;
      const dx = (antenna[0] - source[0]) * width;
      const length = Math.hypot(dx, dy) || 1;
      const trace = (t, offset = 0) => {
        const rest = 1 - t;
        const envelope = Math.sin(Math.PI * t);
        const ripple = envelope * (Math.sin(t * 92 - phase * 8) * 1.25 + Math.sin(t * 183 + phase * 11) * .65);
        const shift = ripple + offset;
        return [
          rest * source[0] + t * antenna[0] - dy / length * shift * 100 / width,
          rest * rest * source[1] + 2 * rest * t * bend + t * t * antenna[1] + dx / length * shift * 100 / height,
        ];
      };
      transmission.forEach((path, index) => {
        const offset = [0, -1.35, 1.35, 0][index];
        const points = Array.from({ length: 65 }, (_, n) => trace(n / 64, offset).map(value => value.toFixed(2)).join(" "));
        path.setAttribute("d", "M" + points.join("L"));
      });
      pulses.forEach((pulse, index) => {
        const t = motion.matches ? .26 + index * .24 : (phase * .63 + index / pulses.length + .09) % 1;
        place(pulse, trace(t));
        pulse.style.opacity = String(.26 + .74 * Math.sin(Math.PI * t));
      });
    }
    scene?.({ width, height, hubs, camera: position, phase, accent });
  }
  function refreshAccent() {
    accent = getComputedStyle(sky).getPropertyValue("--sky-accent").trim() || "#b5ec70";
  }
  function schedule() {
    if (!frame && opened && view === "universe" && visible && !motion.matches && !document.hidden) {
      frame = requestAnimationFrame(animate);
    }
  }
  function animate(now) {
    frame = null;
    if (!opened || view !== "universe" || !visible || motion.matches || document.hidden) {
      previousTime = null;
      return;
    }
    if (!previousTime || now - previousTime >= 30) {
      const delta = previousTime ? Math.min(now - previousTime, 60) / 1000 : 0;
      previousTime = now;
      phase += delta;
      if (frequency === null && !flight && !sky.querySelector("button:hover, button:focus-visible")) {
        revolution = (revolution + delta * .066) % tau;
      }
      draw(now);
    }
    schedule();
  }
  function format(value, unit) {
    return Number.isFinite(value) ? `${number.format(value)}${unit ? " " + unit : ""}` : "—";
  }

  function renderReception() {
    const group = connected ? activeGroup() : null;
    const selected = group?.channels.find(channel => channel.id === currentChannel());
    const mux = group ? `UHF ${group.uhf}` : "—";
    setText("frequency", format(group?.frequency / 1e6, "MHz"));
    setText("multiplex", group ? `${mux} · DVB-T` : mux);
    setText("service-count", format(group?.channels.length));
    setText("rate", format(reading.rate, "Mb/s"));
    const status = selected ? reading.locked === false ? f("Sin señal", "No signal")
      : reading.locked ? f("Recepción en directo", "Live reception")
        : f("Sintonizando", "Tuning") : f("Elige un canal para analizar su señal", "Choose a channel to analyse its signal");
    setText("reception", selected ? `${status} · ${selected.name} · ${mux}` : status);
    setText("network", [reading.network, Number.isInteger(reading.tsid) ? `TSID ${reading.tsid}` : ""].filter(Boolean).join(" · ") || "—");
    setText("cnr", format(reading.cnr, "dB"));
    setText("errors-label", [f("Paquetes con error", "Flagged packet errors"), reading.errorSeconds ? `${reading.errorSeconds} s` : ""].filter(Boolean).join(" · "));
    setText("errors", format(reading.errors));
    setText("service", selected?.name || "—");
    setText("service-meta", selected ? `${mux} · ${f("Servicio {sid}", "Service {sid}", selected)}` : status);
    setText("service-rate", Number.isFinite(reading.serviceRate) ? format(reading.serviceRate, "Mb/s") : "");
    const share = reading.rate > 0 && Number.isFinite(reading.serviceRate) ? reading.serviceRate / reading.rate : null;
    el("share").hidden = share === null;
    if (share !== null) {
      el("share-fill").style.width = `${Math.min(100, share * 100)}%`;
      setText("service-share", f("{share} del caudal del múltiplex", "{share} of the multiplex bitrate", { share: percent.format(share) }));
    }
    renderTracks(selected);

    setText("flow-uhf", group ? `${mux} · Mb/s` : "");
    setText("timeline-uhf", group ? mux : "");
    if (view === "flows") chart();
    if (view === "timeline") timeline();
  }
  function renderTracks(selected) {
    const tracks = reading.tracks || [];
    setText("stream-count", tracks.length ? f(
      tracks.length === 1 ? "{count} pista" : "{count} pistas",
      tracks.length === 1 ? "{count} stream" : "{count} streams", { count: tracks.length }) : "");
    const list = el("tracks");
    list.replaceChildren();
    for (const [kind, [es, en]] of Object.entries(kinds)) {
      const entries = tracks.filter(track => track.kind === kind);
      if (!entries.length) continue;
      const group = node("section", undefined, "signal-track-group");
      group.dataset.kind = kind;
      const heading = node("h3");
      heading.append(icon(trackIcons[kind]), node("span", kind === "other" ? f("Datos", "Data") : f(es, en)),
        node("small", String(entries.length)));
      const rows = node("ul");
      for (const track of entries) {
        const locale = track.language === "qaa" ? f("Versión original", "Original version")
          : track.language && (language.of(track.language) || track.language);
        const pid = `PID 0x${track.pid.toString(16).toUpperCase().padStart(4, "0")}`;
        const row = node("li");
        const description = node("div");
        description.append(node("strong", locale || track.codec || pid));
        if (locale || track.codec) description.append(node("small", [locale && track.codec, pid].filter(Boolean).join(" · ")));
        row.append(description, node("span", format(track.rate, "Mb/s"), "signal-track-rate"));
        rows.append(row);
      }
      group.append(heading, rows);
      list.append(group);
    }
    if (!tracks.length) list.append(node("p", selected ? f("Esperando las pistas de la emisión.", "Waiting for broadcast streams.")
      : f("Selecciona un canal para ver sus pistas.", "Choose a channel to see its streams."), "signal-panel-empty"));
  }

  function chart() {
    const parent = el("chart");
    parent.replaceChildren();
    if (!reading.flows) {
      parent.append(node("p", f("El caudal se mostrará cuando lleguen datos de la emisión.", "Bitrate will appear when broadcast data arrives."), "signal-panel-empty"));
      return;
    }
    const total = Object.values(reading.flows).reduce((sum, rate) => sum + rate, 0);
    const scale = window.d3?.scaleLinear().domain([0, total || 1]).range([0, 1]) || (value => value / (total || 1));
    const summary = node("div", undefined, "signal-flow-summary");
    summary.append(node("strong", format(total, "Mb/s")), node("span", f("Caudal total del múltiplex", "Total multiplex bitrate")));
    const spectrum = node("div", undefined, "signal-spectrum");
    spectrum.setAttribute("aria-hidden", "true");
    const list = node("dl", undefined, "signal-flow-list");
    for (const [kind, [es, en]] of Object.entries(kinds)) {
      const amount = reading.flows[kind] || 0;
      const share = scale(amount);
      if (amount > 0) {
        const segment = node("span");
        segment.dataset.kind = kind;
        segment.style.flexGrow = share;
        spectrum.append(segment);
      }
      const row = node("div", undefined, "signal-flow-row");
      row.dataset.kind = kind;
      const name = node("dt");
      name.append(icon(trackIcons[kind]), node("span", f(es, en)));
      row.append(name, node("dd", format(amount, "Mb/s")), node("dd", percent.format(share)));
      list.append(row);
    }
    parent.append(summary, spectrum, list);
  }
  function timeline() {
    const events = el("events");
    const group = activeGroup();
    events.replaceChildren(...(reading.events || []).map(event => {
      const channel = group?.channels.find(item => item.sid === event.sid);
      const title = channel?.name || (group ? `UHF ${group.uhf}` : "");
      const summaries = {
        selected: f("Canal seleccionado", "Channel selected"),
        tracks: f("Pistas detectadas ({count})", "Streams detected ({count})", event),
        changed: f("Cambió la lista de pistas ({count})", "Stream list changed ({count})", event),
      };
      const item = node("li");
      const stamp = new Date(event.time * 1000);
      const time = node("time", clock.format(stamp));
      time.dateTime = stamp.toISOString();
      const eventDescription = node("div");
      eventDescription.append(node("strong", title), node("span", summaries[event.type]));
      item.append(time, icon(event.type === "selected" ? "i-orbit" : "i-signal-layers"), eventDescription);
      return item;
    }));
    if (!events.children.length) events.append(node("li", f("Sin cambios recientes en esta frecuencia.", "No recent changes on this frequency."), "signal-panel-empty"));
  }
  function loadD3() {
    if (loadingD3) return;
    loadingD3 = true;
    const script = document.createElement("script");
    script.src = "/vendor/d3.min.js";
    script.onload = () => { if (opened && view === "flows") chart(); };
    document.head.append(script);
  }
  async function poll() {
    if (!opened || document.hidden || !connected || request || !currentChannel() || performance.now() - lastPoll < 1000) return;
    const stream = state.stream.id;
    lastPoll = performance.now();
    request = api("signal-analysis");
    try {
      const result = await request;
      if (opened && connected && result.stream === stream && state?.stream?.id === stream) {
        reading = result;
        renderReception();
        if (motion.matches) draw(performance.now());
      }
    } catch {
      if (opened && state?.stream?.id === stream) {
        reading = {};
        renderReception();
      }
    } finally {
      request = null;
    }
  }
  function render(newState, pending) {
    if (newState.stream?.id !== state?.stream?.id || state?.hardware.signal !== newState.hardware.signal) {
      reading = {};
      lastPoll = -Infinity;
    }
    state = newState;
    blocked = pending;
    connected = true;
    if (!opened) return;
    const key = JSON.stringify(state.channels.map(channel => [channel.id, channel.name, channel.frequency, channel.uhf, channel.sid]));
    if (channelKey !== key) {
      channelKey = key;
      rebuild();
      draw(performance.now());
    }
    syncControls();
    renderReception();
    poll();
  }
  function disconnect() {
    if (!connected) return;
    connected = false;
    reading = {};
    if (opened) {
      syncControls();
      renderReception();
      draw(performance.now());
    }
  }
  function navigate(active) {
    if (opened === active) return;
    opened = active;
    previousTime = null;
    if (!active) {
      channelPicker.close();
      return;
    }
    refreshAccent();
    if (!loadingScene) {
      loadingScene = import("./signal-scene.js").then(module => {
        scene = module.createSignalScene(sky, sky.querySelector(".signal-space"));
        draw(performance.now());
      }).catch(error => console.warn("Signal analysis WebGL:", error));
    }
    if (state && connected) render(state, blocked);
    else {
      rebuild();
      renderReception();
    }
    draw(performance.now());
    schedule();
  }
  overview.addEventListener("click", resetUniverse);
  document.addEventListener("keydown", event => {
    if (!opened || view !== "universe" || event.key !== "Escape" || event.defaultPrevented) return;
    if (frequency !== null && !event.target.closest("dialog, input, textarea, [contenteditable]")) {
      event.preventDefault();
      resetUniverse();
    }
  });
  for (const button of section.querySelectorAll("[data-signal-view]")) {
    button.addEventListener("click", () => {
      view = button.dataset.signalView;
      for (const tab of section.querySelectorAll("[data-signal-view]")) tab.setAttribute("aria-pressed", String(tab === button));
      for (const panel of section.querySelectorAll("[data-signal-panel]")) panel.hidden = panel.dataset.signalPanel !== view;
      for (const guide of section.querySelectorAll("[data-signal-guide]")) guide.hidden = guide.dataset.signalGuide !== view;
      channelPicker.close();
      if (view === "flows") loadD3();
      renderReception();
      draw(performance.now());
      schedule();
    });
  }
  new ResizeObserver(() => draw(performance.now())).observe(sky);
  new IntersectionObserver(([entry]) => {
    visible = entry.isIntersecting;
    previousTime = null;
    schedule();
  }).observe(sky);
  new MutationObserver(() => {
    refreshAccent();
    draw(performance.now());
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette", "data-mode"] });
  document.addEventListener("visibilitychange", () => { previousTime = null; schedule(); poll(); });
  motion.addEventListener("change", () => { previousTime = null; draw(performance.now()); schedule(); });
  return { render, navigate, disconnect };
}
