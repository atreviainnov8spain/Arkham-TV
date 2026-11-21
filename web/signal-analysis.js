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
  const colors = ["#92a7ef", "#91bdb0", "#bf96cf", "#d5a578", "#d08f9b", "#799ed0", "#82cabe"];
  const tau = Math.PI * 2;
  const svgName = "http://www.w3.org/2000/svg";
  let state, reading = {}, groups = [], channelKey, frequency = null, view = "universe";
  let blocked = true, connected = true, opened = false, visible = false, feedback = "";
  let scene, loadingScene, loadingD3, request, lastPoll = 0;
  let frame, previousTime, phase = 0, orbitPhase = 0, zoom = 1, panX = 0, panY = 0;
  let paused = false, drag = null, choicesGroup;
  let history = [];

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
  const transmission = ["signal-bank", "signal-wire"]
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
  const inspectedGroup = () => groups.find(g => g.frequency === frequency) || activeGroup() || groups[0];

  function rebuild() {
    for (const group of groups) group.orbit.remove();
    groups = groupBroadcastChannels(state?.channels || []).map((group, index) => ({
      ...group, color: colors[index % colors.length],
    }));
    if (!groups.some(g => g.frequency === frequency)) frequency = null;
    planets.replaceChildren();
    satellites.replaceChildren();
    el("atlas-bands").replaceChildren();
    channelPicker.setGroups(groups);
    for (const group of groups) {
      const label = "UHF " + group.uhf, mhz = format(group.frequency / 1e6, "MHz");
      const planet = node("button", undefined, "signal-planet");
      planet.append(node("strong", label), node("small", mhz));
      planet.style.setProperty("--planet-color", group.color);
      planet.setAttribute("aria-label", label + " · " + mhz);
      planet.onclick = () => focus(group.frequency);
      planets.append(planet);
      group.planet = planet;
      group.orbit = svg("path", "atlas-moon-orbit");
      links.insertBefore(group.orbit, transmission[0]);
      const band = node("button", undefined, "atlas-band");
      band.style.setProperty("--planet-color", group.color);
      band.append(node("i"), node("b", label), node("small", mhz));
      band.onclick = () => focus(group.frequency);
      el("atlas-bands").append(band);
      group.band = band;
      for (const channel of group.channels) {
        const dot = node("button", undefined, "signal-satellite");
        dot.append(node("i"), node("span", channel.name));
        dot.style.setProperty("--planet-color", group.color);
        dot.setAttribute("aria-label", channel.name + " · " + label);
        dot.title = channel.name;
        dot.onclick = () => selectChannel(channel.id);
        satellites.append(dot);
        channel.dot = dot;
      }
    }
    const count = groups.reduce((sum, group) => sum + group.channels.length, 0);
    setText("map-count", f("{channels} canales · {groups} frecuencias", "{channels} channels · {groups} frequencies",
      {channels:count, groups:groups.length}));
    el("empty").hidden = Boolean(groups.length);
    el("atlas-rail").hidden = !groups.length;
    choicesGroup = null;
    syncControls();
  }

  function buildChoices(group) {
    const toolbar = el("choices");
    toolbar.replaceChildren();
    for (const channel of group?.channels || []) {
      const button = node("button");
      button.dataset.channel = channel.id;
      const mark = node("span", undefined, "atlas-channel-mark");
      mark.setAttribute("aria-hidden", "true");
      const logo = window.channelLogoPath?.(channel.name);
      if (logo) {
        const image = node("img"); image.src = logo; image.alt = "";
        mark.append(image);
      } else mark.append(icon("i-live"));
      button.append(mark, node("span", channel.name), icon("i-chevron"));
      button.onclick = () => selectChannel(channel.id);
      toolbar.append(button);
    }
  }

  function syncControls() {
    showFeedback();
    channelPicker.update(currentChannel(), !ready(), f("Elige un canal", "Choose a channel"));
    const selected = inspectedGroup();
    if (choicesGroup !== selected) {
      buildChoices(selected);
      choicesGroup = selected;
    }
    for (const group of groups) {
      for (const item of [group.planet, group.band]) item.setAttribute("aria-pressed", String(group === selected));
      for (const channel of group.channels) {
        channel.dot.disabled = !ready();
        channel.dot.setAttribute("aria-pressed", String(channel.id === currentChannel()));
      }
    }
    for (const button of el("choices").children) {
      button.disabled = !ready();
      button.setAttribute("aria-pressed", String(button.dataset.channel === currentChannel()));
    }
    setText("atlas-uhf", selected ? "UHF " + selected.uhf : "—");
    setText("atlas-mhz", format(selected ? selected.frequency / 1e6 : null, "MHz"));
    const tuned = connected && selected && selected === activeGroup();
    const locked = tuned && reading.locked === true;
    setText("atlas-status", !selected ? "" : locked ? f("En recepción","Receiving")
      : tuned ? (reading.locked === false ? f("Sin señal","No signal") : f("Sintonizando","Tuning"))
      : f("En el mapa","On map"));
    el("atlas-status").toggleAttribute("data-locked", !!locked);
    setText("atlas-cnr", format(locked ? reading.cnr : null, "dB"));
    const samples = locked ? history.filter(point => point.time >= performance.now() - 30000) : [];
    let path = "";
    if (samples.length > 1 && Number.isFinite(reading.cnr)) {
      const latest = samples.at(-1).time;
      const values = samples.map(point => point.value);
      const low = Math.min(...values) - 1, high = Math.max(...values) + 1;
      path = samples.map(({time,value},i) => (i ? "L" : "M") +
        ((time - latest + 30000) / 30000 * 240).toFixed(1) + " " +
        (33 - (value - low) / (high - low) * 30).toFixed(1)).join(" ");
    }
    el("atlas-trace").setAttribute("d", path);
    el("less").disabled = zoom <= .8;
    el("more").disabled = zoom >= 1.6;
    const title = paused ? f("Reanudar movimiento","Resume motion") : f("Pausar movimiento","Pause motion");
    el("motion").setAttribute("aria-label",title); el("motion").title = title;
    el("motion").querySelector("use").setAttribute("href", paused ? "#i-play" : "#i-pause");
    el("motion").disabled = motion.matches;
  }

  function focus(value) {
    frequency = value;
    // The inspector can explore one multiplex while the tuner receives another.
    if (zoom > 1 && value !== null) {
      const hub = layoutHub(groups.findIndex(g => g.frequency === value), groups.length);
      panX = hub.x * .45;
      panY = hub.y * .45;
    }
    syncControls();
    draw();
  }
  function resetUniverse() {
    zoom = 1;
    panX = panY = 0;
    focus(null);
  }

  function layoutHub(index, count) {
    const rings = Math.max(1, Math.ceil(count / 8)), ring = index % rings;
    const slots = Math.ceil((count - ring) / rings);
    const theta = (count === 1 ? 2.40 : 1.40) - Math.floor(index / rings) * tau / slots + ring * .25;
    const spread = rings === 1 ? 1 : .46 + .54 * ring / (rings - 1);
    const radii = [.44,.57,.5,.64,.46,.51,.72];
    return { x: 5.76 * Math.cos(theta) * spread, y: 2.69 * Math.sin(theta) * spread,
      r: radii[index % radii.length] * Math.min(1, Math.sqrt(8 / count)) };
  }
  function place(element, x, y) {
    element.style.left = x.toFixed(2) + "px";
    element.style.top = y.toFixed(2) + "px";
  }
  function draw() {
    const width = sky.clientWidth, height = sky.clientHeight;
    if (!opened || view !== "universe" || !width || !height) return;
    const scale = Math.min(width / 15, height / 8.5) * zoom;
    const px = x => width / 2 + (x - panX) * scale;
    const py = y => height / 2 - (y - panY) * scale;
    links.setAttribute("viewBox", "0 0 " + width + " " + height);
    const fallback = sky.querySelector(".signal-fallback");
    fallback.setAttribute("viewBox", "0 0 " + width + " " + height);
    fallback.querySelector("use").setAttribute("transform", "translate(" + px(0) + " " + py(0) + ") scale(" + scale / 78 + ")");
    place(sky.querySelector(".signal-antenna-caption"),px(0),py(-1.46));
    while (orbits.length < 3) orbits.push(svg("path","signal-orbit"));
    const ellipse = (cx,cy,rx,ry) => 'M' + (cx+rx) + ' ' + cy + 'a' + rx + ' ' + ry + ' 0 1 0 ' + (-2*rx) + ' 0a' + rx + ' ' + ry + ' 0 1 0 ' + (2*rx) + ' 0';
    for (const [i,orbit] of orbits.entries()) orbit.setAttribute("d", ellipse(px(0),py(0),(2.25+i*1.86)*scale,(1.05+i*.87)*scale));
    const selected = inspectedGroup(), active = activeGroup();
    const hubs = groups.map((group,i) => {
      const hub = layoutHub(i,groups.length);
      const x=px(hub.x), y=py(hub.y), a=(hub.r+.47)*scale, b=a*.46;
      place(group.planet,x,y);
      group.planet.style.setProperty("--planet-size",2*hub.r*scale+"px");
      group.orbit.setAttribute("d",ellipse(x,y,a,b));
      group.channels.forEach((channel,index)=>{
        const angle=index*tau/group.channels.length+i*.88+.45+orbitPhase*.057;
        place(channel.dot,x+Math.cos(angle)*a,y-Math.sin(angle)*b);
      });
      return {...hub, color:group.color, selected:group === selected};
    });
    const signal = connected && reading.locked === true && active ? hubs[groups.indexOf(active)] : null;
    transmission.forEach(p => p.style.display = signal ? "" : "none");
    electric.hidden = !signal;
    if (signal) {
      const tx = px(-.51), ty = py(.32);
      const dx = -.51 - signal.x, dy = .32 - signal.y, distance = Math.hypot(dx,dy) || 1;
      const x = px(signal.x + dx/distance*signal.r), y = py(signal.y + dy/distance*signal.r);
      const mid = (y + ty)/2 + 12*zoom;
      transmission.forEach(path => rfPath(path,[x,y],[tx,ty],mid));
      pulses.forEach((pulse,i)=>{
        const t=(phase*.20+i/3+.13)%1, s=1-t;
        place(pulse, x+(tx-x)*t, s*s*y+2*s*t*mid+t*t*ty);
      });
    }
    setText("map-caption", f("Selecciona un planeta","Select a planet"));
    try { scene?.({width,height,scale,panX,panY,hubs,phase}); }
    catch(error) { scene=null;sky.classList.remove("iv-3d");console.warn("Signal atlas:",error); }
  }
  function schedule() {
    if (!frame && opened && view === "universe" && visible && !paused && !motion.matches && !document.hidden) {
      frame = requestAnimationFrame(animate);
    }
  }
  function animate(now) {
    frame = null;
    if (!opened || view !== "universe" || !visible || paused || motion.matches || document.hidden) {
      previousTime = null;
      return;
    }
    if (!previousTime || now - previousTime >= (window.arkhamParallels ? 83 : 40)) {
      const delta = previousTime ? Math.min(now - previousTime, 60) / 1000 : 0;
      previousTime = now;
      phase += delta;
      if (!sky.matches(":hover") && !sky.contains(document.activeElement)) orbitPhase += delta;
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
        const now = performance.now();
        if (reading.locked && Number.isFinite(reading.cnr)) {
          history = history.filter(point => point.time >= now - 30000);
          history.push({time:now, value:reading.cnr});
        } else history = [];
        syncControls();
        renderReception();
        if (motion.matches || paused) draw();
      }
    } catch {
      if (opened && state?.stream?.id === stream) {
        reading = {};
        history = [];
        syncControls();
        renderReception();
        draw();
      }
    } finally {
      request = null;
    }
  }
  function render(newState, pending) {
    if (newState.stream?.id !== state?.stream?.id || state?.hardware.signal !== newState.hardware.signal) {
      reading = {};
      history = [];
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
    if (paused || motion.matches) draw();
    poll();
  }
  function disconnect() {
    if (!connected) return;
    connected = false;
    reading = {};
    history = [];
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
  el("motion").onclick = () => { paused = !paused; previousTime=null; syncControls(); draw(); schedule(); };
  function changeZoom(delta) {
    zoom = Math.max(.8, Math.min(1.6, Math.round((zoom + delta) * 10) / 10));
    syncControls(); draw();
  }
  el("less").onclick = () => changeZoom(-.2);
  el("more").onclick = () => changeZoom(.2);
  const board = sky.closest(".atlas-board");
  el("full").hidden = !board.requestFullscreen || !document.fullscreenEnabled;
  el("full").onclick = () => {
    const action = document.fullscreenElement ? document.exitFullscreen() : board.requestFullscreen();
    action.catch(() => message(f("No se pudo abrir la pantalla completa.", "Could not open fullscreen.")));
  };
  sky.addEventListener("pointerdown", event => {
    if (event.button || event.target.closest("button, a") || !groups.length) return;
    drag = {x:event.clientX, y:event.clientY, panX, panY};
    sky.setPointerCapture(event.pointerId);
  });
  sky.addEventListener("pointermove", event => {
    if (!drag) return;
    const scale = Math.min(sky.clientWidth/15,sky.clientHeight/8.5)*zoom;
    panX = Math.max(-3,Math.min(3,drag.panX - (event.clientX-drag.x)/scale));
    panY = Math.max(-1.75,Math.min(1.75,drag.panY + (event.clientY-drag.y)/scale));
    draw();
  });
  sky.addEventListener("lostpointercapture", () => { drag=null; });
  sky.addEventListener("atlas-redraw", draw);
  document.addEventListener("keydown", event => {
    if (!opened || view !== "universe" || event.key !== "Escape" || event.defaultPrevented) return;
    if ((frequency !== null || zoom !== 1 || panX || panY) && !event.target.closest("dialog, input, textarea, [contenteditable]")) {
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
    draw(performance.now());
  }).observe(document.documentElement, { attributes: true, attributeFilter: ["data-palette", "data-mode"] });
  document.addEventListener("visibilitychange", () => { previousTime = null; schedule(); poll(); });
  motion.addEventListener("change", () => { previousTime = null; draw(performance.now()); schedule(); });
  return { render, navigate, disconnect };
}
