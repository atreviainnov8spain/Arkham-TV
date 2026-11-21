"use strict";

window.createLinuxAIPlaybackHealth = () => {
  let previous = null, baseline = 0, stalled = 0, dropped = 0, good = 0, guarded = false;
  return sample => {
    if (!sample) {
      previous = null;
      stalled = dropped = good = 0;
      return null;
    }
    const before = previous;
    previous = sample;
    if (!before) return null;
    const wall = (sample.wall - before.wall) / 1000, progress = sample.time - before.time;
    if (wall < .5 || wall > 5 || progress < 0) {
      stalled = dropped = 0;
      return null;
    }
    const total = sample.total - before.total, lost = sample.dropped - before.dropped;
    const validFrames = total > 0 && lost >= 0 && lost <= total;
    const ratio = validFrames ? lost / total : 0;
    const clockStalled = progress < wall * .35 && sample.readyState < 3 || progress < wall * .12;
    // WebKitGTK's dropped-frame counters vary with the compositor and screen
    // resolution. Establish the player's normal rate before attributing it to AI.
    if (!sample.active && !clockStalled && validFrames) baseline = ratio;
    const frameRegression = sample.active && validFrames && ratio > Math.max(.18, baseline + .12);
    stalled = clockStalled ? stalled + 1 : 0;
    dropped = frameRegression ? dropped + 1 : 0;
    if (!sample.active) { guarded = false; good = 0; return null; }
    if (guarded) {
      // If playback advances while inference is suspended, its compositor's
      // normal drop rate must not keep the assistant suspended forever.
      good = clockStalled ? 0 : good + 1;
      if (good >= 3) {
        if (validFrames) baseline = ratio;
        guarded = false;
        stalled = dropped = good = 0;
        return true;
      }
      return null;
    }
    if (stalled >= 2 || dropped >= 3) {
      guarded = true;
      good = 0;
      return false;
    }
    return null;
  };
};

window.groupTranscriptParagraphs = rows => {
  const groups = [];
  let current = null, previous = null, length = 0;
  for (const row of rows) {
    if (row.gap) {
      groups.push({ gap: row });
      current = previous = null;
      length = 0;
      continue;
    }
    const separate = !current || row.start - previous.end > 3 || row.speaker !== previous.speaker ||
      /^[-–—]\s+\S/.test(row.text) || length >= 650 ||
      (length >= 320 && /[.!?…][»"'’)]?$/.test(previous.text.trim()));
    if (separate) {
      current = { rows: [] };
      groups.push(current);
      length = 0;
    }
    current.rows.push(row);
    length += row.text.length + 1;
    previous = row;
  }
  return groups;
};

window.createLocalAI = ({ video, navigate }) => {
  const get = id => document.getElementById(id);
  const dock = get("ai-dock"), body = get("ai-dock-body"), trigger = get("ai-open");
  const content = get("ai-content"), sourcePicker = get("ai-source"), library = get("ai-library");
  const sourceOptions = get("ai-source-options"), formatPicker = get("ai-export-format");
  const question = get("ai-question"), modal = get("ai-export"), models = get("ai-model-list");
  const deleteDialog = get("ai-delete");
  const voiceDialog = get("ai-voice-rename");
  const speakerModels = ["speaker-segmentation", "speaker-embedding"];
  const app = document.body;
  const readableTranscripts = Boolean(window.arkhamLinux || window.arkhamNative);
  const t = (es, en) => arkhamLanguage.locale.startsWith("en") ? en : es;
  const lang = () => t("es", "en");
  const jobs = new Map(), drafts = new Map(), open = { "#directo": false, "#transcripciones": false };
  const labels = { summary: ["Resumen", "Summary"], analysis: ["Análisis", "Analysis"],
    report: ["Informe", "Report"], question: ["Arkham IA", "Arkham AI"] };
  const modelFamilies = {
    speech: ["Whisper / Parakeet / Qwen3-ASR", "Voz a texto multilingüe", "Multilingual speech to text"],
    text: ["Qwen3 / Bonsai 2", "Chat, resúmenes, análisis e informes", "Chat, summaries, analysis and reports"],
  };
  const modelViews = new Map();
  const prompts = { summary: ["Resume los puntos principales.", "Summarize the main points."],
    analysis: ["Analiza lo que se ha dicho.", "Analyze what was said."],
    report: ["Prepara un informe estructurado.", "Write a structured report."] };
  const statusLabels = {
    running: ["Transcribiendo", "Transcribing"], paused: ["En pausa", "Paused"],
    protected: ["IA en espera · emisión prioritaria", "AI waiting · playback has priority"],
    queued: ["En cola", "Queued"],
    processing: ["Transcribiendo la grabación", "Transcribing recording"],
    separating: ["Separando voces de la grabación", "Separating recording speakers"],
    finishing: ["Procesando el audio pendiente", "Transcribing buffered audio"],
    saved: ["Transcripción guardada", "Saved transcript"],
  };
  const gaps = {
    paused: ["Transcripción en pausa", "Transcription paused"],
    priority: ["La emisión tuvo prioridad", "Playback had priority"],
    skipped: ["Fragmento omitido mientras la IA estaba ocupada", "Section skipped while AI was busy"],
    audio: ["No se pudo transcribir este fragmento", "Could not transcribe this section"],
    "source-audio": ["No se recibió audio en este tramo", "No audio was received in this section"],
  };
  const errors = new Map([
    ["Primero sintoniza una emisión.", "Tune a broadcast first."],
    ["La emisión aún se está preparando.", "The broadcast is still starting."],
    ["Descarga un modelo de voz en Configuración.", "Download a speech model in Settings."],
    ["No hay espacio suficiente para descargar el modelo.", "There is not enough space to download the model."],
    ["Descarga este modelo antes de activarlo.", "Download this model before activating it."],
    ["Espera a que termine la tarea de IA antes de quitar el modelo.", "Wait for the AI task to finish before removing the model."],
    ["Todavía no hay texto transcrito en esta sesión.", "This session has no transcribed text yet."],
    ["No se encuentra la transcripción.", "The transcript could not be found."],
    ["Finaliza la transcripción antes de eliminarla.", "Finish the transcript before deleting it."],
    ["Espera a que termine la respuesta antes de eliminar la transcripción.", "Wait for the reply to finish before deleting the transcript."],
    ["Descarga el modelo de texto en Configuración.", "Download the text model in Settings."],
    ["El asistente está preparando otra respuesta.", "The assistant is preparing another reply."],
    ["Este modelo requiere el motor de voz de la nueva versión.", "This model requires the speech engine from the new version."],
    ["No se encuentra el archivo de la grabación.", "The recording file could not be found."],
    ["Ya hay una grabación en transcripción. Puedes verla en Transcripciones IA.", "A recording is already being transcribed. You can view it in AI transcripts."],
    ["Descarga los modelos de voces en Configuración.", "Download the speaker models in Settings."],
    ["Elige una voz y un nombre de hasta 60 caracteres.", "Choose a voice and a name of up to 60 characters."],
  ]);
  let route, mini = false, source = "live", selected = "", liveId = "", active = null;
  let clearedLiveId = "";
  let renameVoice = null;
  let meta = { sessions: [], models: {}, work: null }, tab = "transcript", marked = null;
  let pollCount = 0, pending = false, dockVisible = false;
  let previewId, fileExportId, deleteId, previewVersion = 0, mediaSample = null, unhealthy = false, protectionSample = 0;
  let exportFormat = "md";
  let startupUntil = 0, degradedSamples = 0;
  let transcriptTimes = false;
  if (readableTranscripts) {
    try { transcriptTimes = localStorage.getItem("arkham.ai.transcript.times") === "true"; } catch {}
  }
  const linuxPlaybackHealth = window.arkhamLinux ? window.createLinuxAIPlaybackHealth() : null;
  const keys = new Map();

  function node(tag, text = "", className = "") {
    const value = document.createElement(tag);
    value.className = className;
    value.textContent = text;
    return value;
  }

  function button(text, action, value, primary = false) {
    const el = node("button", text, "button " + (primary ? "primary" : "secondary"));
    el.type = "button";
    el.dataset.aiAction = action;
    if (value !== undefined) el.dataset.value = value;
    return el;
  }

  function icon(symbol) {
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    const use = document.createElementNS(ns, "use");
    svg.setAttribute("aria-hidden", "true");
    use.setAttribute("href", "#" + symbol);
    svg.append(use);
    return svg;
  }

  function paint(el, key, build) {
    if (keys.get(el) === key) return false;
    keys.set(el, key);
    const focused = el.contains(document.activeElement) && document.activeElement.dataset;
    const focus = focused && { action: focused.aiAction, value: focused.value };
    el.replaceChildren(...build());
    if (focus?.action) {
      const replacement = [...el.querySelectorAll("[data-ai-action]")].find(item =>
        item.dataset.aiAction === focus.action && item.dataset.value === focus.value);
      replacement?.focus({ preventScroll: true });
    }
    return true;
  }

  async function request(action, data) {
    const params = data === undefined ? undefined : {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...data, language: lang() }),
    };
    const reply = await fetch("/api/ai" + action, params);
    const info = await reply.json();
    if (!reply.ok) throw Error(t(info.error, errors.get(info.error) || "The local AI operation could not be completed."));
    return info;
  }

  function stamp(time) {
    const total = Math.floor(time || 0);
    const hh = Math.floor(total / 3600);
    const min = String(Math.floor(total / 60) % 60).padStart(2, "0");
    const sec = String(total % 60).padStart(2, "0");
    return hh ? [String(hh).padStart(2, "0"), min, sec].join(":") : min + ":" + sec;
  }

  const docId = () => route === "#transcripciones" ? selected : source === "live" ? (liveId === clearedLiveId ? "" : liveId) : source;
  const activeModel = family => meta.activeModels?.[family] || family;
  const installed = family => meta.models[activeModel(family)]?.status === "installed";
  const archivedSessions = () => meta.sessions.filter(row => row.archived || row.status === "saved");
  const recordingLabel = () => t("Grabación", "Recording");
  function originBadge(doc) {
    const badge = node("span", "", "ai-origin-badge");
    badge.dataset.origin = doc.recording ? "recording" : "live";
    badge.title = doc.recording ? t("Transcripción de una grabación", "Transcript of a recording")
      : t("Transcripción de un directo", "Transcript of a live broadcast");
    badge.append(icon(doc.recording ? "i-record" : "i-live"), node("span",
      doc.recording ? t("GRABACIÓN", "RECORDING") : t("DIRECTO", "LIVE")));
    return badge;
  }
  function protectedLabel() {
    if (!window.arkhamLinux) return t(...statusLabels.protected);
    const reason = {
      recording: ["IA en espera · grabación en curso", "AI waiting · recording in progress"],
      tuning: ["IA en espera · sintonización en curso", "AI waiting · tuning in progress"],
      cpu: ["IA en espera · CPU ocupada", "AI waiting · CPU busy"],
    }[meta.priorityReason];
    return reason ? t(...reason) : t(...statusLabels.protected);
  }
  function recordingStatus(doc) {
    if (doc.reason === "speaker-error") return t("No se pudieron separar las voces. Puedes volver a transcribir sin esta opción.", "Speaker separation failed. You can transcribe again without this option.");
    if (doc.reason === "recording-error") return t("No se pudo transcribir todo el archivo.", "Could not transcribe the entire file.");
    if (doc.reason === "no-speech") return t("No se detectó voz en la grabación.", "No speech was detected in the recording.");
    if (doc.reason === "cancelled" || doc.reason === "closed") return t("Transcripción interrumpida", "Transcription interrupted");
    return doc.status === "protected" ? protectedLabel() : t(...(statusLabels[doc.status] || statusLabels.saved));
  }

  function voiceLabel(doc, speaker) {
    if (Number.isInteger(speaker)) return doc.speaker_names?.[speaker] || t("Voz ", "Voice ") + speaker;
    return speaker === "overlap" ? t("Voces superpuestas", "Overlapping voices") : t("Voz sin identificar", "Unassigned voice");
  }

  function voiceBadge(doc, speaker) {
    const label = voiceLabel(doc, speaker);
    const badge = Number.isInteger(speaker) ? button(label, "rename-speaker", doc.id) : node("span", label);
    badge.className = "ai-voice-tag";
    badge.prepend(icon("i-ai-voices"));
    if (Number.isInteger(speaker)) {
      badge.dataset.speaker = speaker;
      badge.title = t("Cambiar nombre de ", "Rename ") + label;
      badge.setAttribute("aria-haspopup", "dialog");
    }
    return badge;
  }

  function error(message = "") {
    const status = route === "#configuracion" ? get("ai-model-note")
      : route === "#transcripciones" ? get("ai-library-status") : get("ai-error");
    status.textContent = message;
  }

  function layout() {
    dockVisible = !mini && Object.hasOwn(open, route);
    const expanded = dockVisible && open[route];
    dock.hidden = !dockVisible;
    body.hidden = !expanded;
    if (!expanded) sourcePicker.open = false;
    get("ai-dock-indicator").hidden = expanded;
    get("ai-dock-indicator").querySelector(".status-dot").hidden = !active;
    app.classList.toggle("ai-docked", dockVisible);
    app.classList.toggle("ai-open", expanded);
    trigger.setAttribute("aria-expanded", String(expanded && route === "#directo"));
    trigger.querySelector("span").textContent = t("Asistente IA", "AI assistant");
    trigger.title = t("Asistente de emisión", "Broadcast assistant");
    get("ai-dock-toggle").setAttribute("aria-expanded", String(expanded));
    get("ai-dock-toggle").setAttribute("aria-label", expanded
      ? t("Plegar asistente", "Collapse assistant") : t("Desplegar asistente", "Expand assistant"));
  }

  function transcript(doc, highlight, recent = false) {
    const segments = (doc?.segments || []).map(row => ({ ...row, gap: false }));
    const omitted = (doc?.gaps || []).map(row => ({ ...row, gap: true }));
    let rows = segments.concat(omitted).sort((a, b) => a.start - b.start);
    if (!rows.length) return [];
    if (recent && rows.length > 100 && !readableTranscripts) {
      const match = rows.findIndex(row => row.id === highlight);
      const offset = match < 0 ? rows.length - 100 : Math.max(0, match - 30);
      rows = rows.slice(offset, offset + 100);
    }
    if (readableTranscripts) {
      const reading = node("div", "", "ai-reading");
      const tools = node("div", "", "ai-reading-tools");
      const times = button(t("Marcas de tiempo", "Timestamps"), "transcript-times");
      times.setAttribute("aria-pressed", String(transcriptTimes));
      times.prepend(icon("i-ai-time"));
      tools.append(node("span", transcriptTimes ? t("Guion con tiempos", "Timestamped script") : t("Texto continuo", "Continuous text")), times);
      reading.classList.toggle("with-times", transcriptTimes);
      reading.append(tools);
      if (transcriptTimes) {
        for (const row of rows) {
          const line = node("article", "", "ai-segment ai-script-row");
          if (row.gap) line.dataset.gap = "";
          else line.dataset.segment = row.id;
          if (!row.gap && highlight === row.id) line.classList.add("ai-highlight");
          const copy = node("div");
          if (!row.gap && doc.voices) copy.append(voiceBadge(doc, row.speaker));
          copy.append(node("p", row.gap ? t(...(gaps[row.reason] || gaps.audio)) + " · " + stamp(row.end) : row.text));
          line.append(node("time", stamp(row.start)), copy);
          reading.append(line);
        }
        return [reading];
      }
      for (const group of window.groupTranscriptParagraphs(rows)) {
        if (group.gap) {
          const line = node("p", "", "ai-reading-gap");
          line.append(node("time", stamp(group.gap.start) + "–" + stamp(group.gap.end)), document.createTextNode(" " +
            t(...(gaps[group.gap.reason] || gaps.audio))));
          reading.append(line);
          continue;
        }
        const paragraph = node("p", "", "ai-reading-paragraph");
        const turn = node("div", "", "ai-voice-turn");
        if (doc.voices) turn.append(voiceBadge(doc, group.rows[0].speaker));
        for (const row of group.rows) {
          const fragment = node("span", "", "ai-segment ai-reading-fragment");
          fragment.dataset.segment = row.id;
          fragment.title = stamp(row.start);
          if (highlight === row.id) fragment.classList.add("ai-highlight");
          const time = node("time", stamp(row.start));
          time.setAttribute("aria-hidden", "true");
          fragment.append(time, node("span", row.text));
          if (paragraph.childNodes.length) paragraph.append(document.createTextNode(" "));
          paragraph.append(fragment);
        }
        turn.append(paragraph);
        reading.append(turn);
      }
      return [reading];
    }
    return rows.map(row => {
      const line = node("article", "", "ai-segment");
      if (row.gap) line.dataset.gap = "";
      else line.dataset.segment = row.id;
      if (!row.gap && highlight === row.id) line.classList.add("ai-highlight");
      line.append(node("time", stamp(row.start)), node("p", row.gap
        ? t(...(gaps[row.reason] || gaps.audio)) + " · " + stamp(row.end)
        : row.text));
      return line;
    });
  }

  function citation(doc, id) {
    const fragment = doc.segments.find(row => row.id === Number(id));
    if (!fragment) return null;
    const link = button(stamp(fragment.start), "cite", fragment.id);
    link.className = "ai-cite-inline";
    link.setAttribute("aria-label", t("Ver fragmento en ", "Show excerpt at ") + stamp(fragment.start));
    return link;
  }

  function answerInline(element, value, doc) {
    for (const part of value.split(/(\[\d+\]|\*\*[^*]+\*\*)/g)) {
      const ref = part.match(/^\[(\d+)\]$/);
      const link = ref && citation(doc, ref[1]);
      if (link) element.append(link);
      else if (part.startsWith("**") && part.endsWith("**") && part.length > 4) element.append(node("b", part.slice(2, -2)));
      else element.append(document.createTextNode(part));
    }
  }

  function answerTable(headers, rows, doc) {
    const wrap = node("div", "", "ai-table"), table = node("table"), header = table.createTHead().insertRow();
    for (const label of headers) {
      const th = node("th");
      th.scope = "col";
      answerInline(th, label, doc);
      header.append(th);
    }
    const tbody = table.createTBody();
    for (const row of rows) {
      const tr = tbody.insertRow();
      for (const value of row) answerInline(tr.insertCell(), value, doc);
    }
    wrap.append(table);
    return wrap;
  }

  function structuredAnswer(value, doc) {
    const result = node("div", "", "ai-answer");
    const lines = value.split(/\r?\n/).map(line => line.trim());
    const cells = line => line.replace(/^\||\|$/g, "").split("|").map(cell => cell.trim());
    const bullet = /^([-*]|\d+\.)\s+/;
    for (let i = 0; i < lines.length;) {
      const line = lines[i], next = lines[i + 1];
      if (!line) { i++; continue; }
      if (line.includes("|") && next?.includes("|") && cells(next).every(cell => /^:?-{2,}:?$/.test(cell))) {
        const headers = cells(line), rows = [];
        i += 2;
        while (lines[i]?.includes("|") && cells(lines[i]).length === headers.length) {
          rows.push(cells(lines[i++]));
        }
        if (rows.length) result.append(answerTable(headers, rows, doc));
        continue;
      }
      if (bullet.test(line)) {
        const ordered = /^\d/.test(line), list = node(ordered ? "ol" : "ul");
        while (bullet.test(lines[i] ?? "") && /^\d/.test(lines[i]) === ordered) {
          const item = node("li");
          answerInline(item, lines[i++].replace(bullet, ""), doc);
          list.append(item);
        }
        result.append(list);
        continue;
      }
      const heading = line.match(/^#{1,4}\s+(.+)$/);
      const paragraph = node(heading ? "h4" : "p");
      answerInline(paragraph, heading?.[1] ?? line, doc);
      result.append(paragraph);
      i++;
    }
    return result;
  }

  let d3Loading;
  function loadD3() {
    return window.d3 ? Promise.resolve(window.d3) : d3Loading ??= new Promise((resolve, reject) => {
      const script = node("script");
      script.src = "/vendor/d3.min.js";
      script.onload = () => window.d3 ? resolve(window.d3) : reject();
      script.onerror = reject;
      document.head.append(script);
    });
  }

  function answerChart(chart, doc) {
    const chartCard = node("figure", "", "ai-chart");
    const label = node("figcaption", chart.title, "ai-chart-title");
    if (chart.unit) label.append(node("small", chart.unit, "ai-chart-unit"));
    const plot = node("div", "", "ai-chart-plot");
    const breakdown = node("details", "", "ai-chart-breakdown");
    const formatter = new Intl.NumberFormat(arkhamLanguage.locale, { maximumFractionDigits: 6 });
    const amount = value => [formatter.format(value), chart.unit].filter(Boolean).join(" ");
    breakdown.append(node("summary", t("Ver cifras y fuentes", "View values and sources")),
      answerTable([t("Concepto", "Label"), t("Valor", "Value"), t("Fuente", "Source")],
        chart.points.map(({ label, value, ref }) => [label, amount(value), "[" + ref + "]"]), doc));
    chartCard.append(label, plot, breakdown);
    void loadD3().then(d3 => {
      const data = chart.points;
      const height = 32 * data.length + 27;
      const min = Math.min(0, d3.min(data, row => row.value));
      const max = Math.max(0, d3.max(data, row => row.value));
      const x = d3.scaleLinear().domain([min, max || (min === 0 ? 1 : 0)]).nice().range([105, 275]);
      const y = d3.scaleBand().domain(data.map(row => row.label)).range([4, height - 25]).padding(.24);
      const svg = d3.create("svg").attr("viewBox", "0 0 345 " + height).attr("role", "img").attr("aria-label", chart.title);
      svg.append("g").attr("class", "ai-chart-axis").attr("transform", "translate(0," + (height - 24) + ")")
        .call(d3.axisBottom(x).ticks(3).tickSize(3).tickFormat(value => formatter.format(value)));
      const bars = svg.append("g").selectAll("g").data(data).join("g");
      bars.append("rect").attr("class", "ai-chart-bar").attr("x", d => Math.min(x(0), x(d.value)))
        .attr("y", d => y(d.label)).attr("width", d => Math.max(1, Math.abs(x(d.value) - x(0))))
        .attr("height", y.bandwidth()).attr("rx", 3);
      bars.append("text").attr("x", 2).attr("y", d => y(d.label) + y.bandwidth() / 2)
        .attr("dy", ".35em").text(d => d.label.length > 17 ? d.label.slice(0, 16) + "…" : d.label);
      bars.append("text").attr("x", 343).attr("text-anchor", "end").attr("y", d => y(d.label) + y.bandwidth() / 2)
        .attr("dy", ".35em").text(d => formatter.format(d.value));
      bars.append("title").text(d => d.label + ": " + amount(d.value));
      plot.replaceChildren(svg.node());
    }).catch(() => { breakdown.open = true; });
    return chartCard;
  }

  function chat(doc) {
    return doc.messages.map(message => {
      const item = node("article", "", "ai-message");
      item.dataset.role = message.role;
      if (message.role === "user") {
        item.textContent = message.text;
        return item;
      }
      item.append(node("strong", t(...(labels[message.kind] || labels.question))));
      if (message.kind === "error") item.append(node("p", t("No se pudo completar la respuesta. Puedes volver a intentarlo.", "The reply could not be completed. Try again.")));
      else if (window.arkhamNative) {
        item.append(structuredAnswer(message.text, doc));
        if (message.chart) item.append(answerChart(message.chart, doc));
      } else item.append(node("p", message.text.replace(/\s*\[\d+\]/g, "").trim()));
      if (!window.arkhamNative && message.refs?.length) {
        const refs = node("div", "", "ai-citations");
        for (const id of message.refs) {
          const fragment = doc.segments.find(row => row.id === id);
          if (!fragment) continue;
          const link = button(stamp(fragment.start), "cite", id);
          link.setAttribute("aria-label", t("Ver fragmento en ", "Show excerpt at ") + stamp(fragment.start));
          refs.append(link);
        }
        item.append(refs);
      }
      if (message.through !== undefined) item.append(node("small", message.sampled
        ? t("Selección de fragmentos hasta ", "Selected excerpts through ") + stamp(message.through)
        : t("Transcripción hasta ", "Transcript through ") + stamp(message.through)));
      return item;
    });
  }

  function empty(title, text, action) {
    const wrapper = node("div", "", "ai-empty");
    wrapper.append(node("strong", title), node("p", text));
    if (action) wrapper.append(action);
    return wrapper;
  }

  function renderDock() {
    if (body.hidden) return;
    const archive = route === "#transcripciones";
    const doc = jobs.get(docId()), working = meta.work?.id === doc?.id && meta.work?.status;
    const background = !doc && active && clearedLiveId === active ? meta.sessions.find(row => row.id === active) : null;
    get("ai-heading").textContent = archive ? t("Asistente de transcripciones", "Transcript assistant")
      : t("Asistente de emisión", "Broadcast assistant");
    const choices = archivedSessions().filter(row => archive || row.id !== active);
    const entries = choices.map(row => [row.id, (row.recording ? recordingLabel() + " · " : t("Guardada · ", "Saved · ")) + row.title]);
    if (!archive) {
      const live = meta.sessions.find(row => row.id === liveId);
      entries.unshift(["live", (active ? t("En directo", "Live") : t("Emisión", "Broadcast")) + (live ? " · " + live.channel : "")]);
    }
    const currentSource = archive ? selected : source;
    paint(sourceOptions, JSON.stringify([entries, currentSource, lang()]), () => entries.map(([value, label]) => {
      const option = node("button", "", "choice-option");
      option.type = "button";
      option.dataset.sourceId = value;
      if (value === currentSource) option.setAttribute("aria-current", "true");
      option.innerHTML = '<svg aria-hidden="true"><use href="#i-check"/></svg>';
      option.prepend(node("span", label));
      return option;
    }));
    const sourceLabel = entries.find(([value]) => value === currentSource)?.[1] || t("Elige una fuente", "Choose a source");
    get("ai-source-value").textContent = sourceLabel;
    const isLive = !!active && doc?.id === active;
    const latestLive = isLive ? meta.sessions.find(row => row.id === doc.id) : null;
    const backlog = (latestLive?.captured || 0) - (doc?.elapsed || 0);
    const sessionStatus = background ? t("Procesando el audio pendiente", "Transcribing buffered audio")
      : pending === "start" ? t("Preparando transcripción…", "Preparing transcription…")
      : doc?.reason === "recognition-error" ? t("Pulsa Reanudar para reintentar el audio guardado", "Select Resume to retry the buffered audio")
      : doc?.reason === "buffer-error" ? t("Se interrumpió la captura de audio", "Audio capture was interrupted")
      : doc?.recording ? recordingStatus(doc) : doc?.status === "protected" ? protectedLabel()
      : doc ? t(...(statusLabels[doc.status] || statusLabels.saved)) : t("Sin iniciar", "Not started");
    if (get("ai-session-status").textContent !== sessionStatus) get("ai-session-status").textContent = sessionStatus;
    get("ai-elapsed").textContent = background ? stamp(Math.max(0, (background.captured || 0) - background.elapsed)) + " " + t("en cola", "queued")
      : backlog >= 7 ? stamp(backlog) + " " + t("en cola", "queued") : doc ? "00:00–" + stamp(doc.elapsed) : "";
    body.querySelector(".ai-wave").hidden = !(isLive && doc?.status === "running");
    const start = get("ai-start");
    start.hidden = archive || source !== "live" || !!active || !installed("speech");
    start.disabled = !!pending;
    for (const item of body.querySelectorAll("[data-ai-tab]")) item.setAttribute("aria-pressed", String(item.dataset.aiTab === tab));

    const showComposer = !!doc?.segments.length && installed("text") && tab === "chat";
    get("ai-compose").hidden = !showComposer;
    for (const control of get("ai-compose").querySelectorAll("button")) control.disabled = !!meta.work || pending;
    if (question.dataset.source !== docId()) {
      question.dataset.source = docId();
      question.value = drafts.get(docId()) || "";
    }
    const revision = tab === "chat" ? doc?.messages.length : doc?.revision;
    const key = [lang(), archive, currentSource, active, doc?.id, revision, tab, marked, working, isLive,
      window.arkhamLinux ? doc?.status : "", readableTranscripts ? transcriptTimes : "", !!background,
      installed("text"), installed("speech"), pending].join(":");
    const lastScroll = content.scrollHeight - content.scrollTop - content.clientHeight < 30;
    const full = paint(content, key, () => {
      if (!doc) {
        if (background) return [empty(t("Área de transcripción limpia", "Transcript area cleared"),
          t("El audio pendiente continúa en segundo plano. Puedes consultar el resultado en Transcripciones IA.",
            "Pending audio is still being transcribed in the background. Find the result in AI transcripts."))];
        if (archive || source !== "live" || active) return [];
        if (installed("speech")) return [empty(t("Todo listo para transcribir", "Ready to transcribe"),
          t("Pulsa Iniciar transcripción para pasar a texto lo que se diga en la emisión.",
            "Select Start transcription to turn the broadcast audio into text."))];
        return [empty(t("Instala el modelo de voz", "Install the speech model"),
          t("Elige y descarga un modelo de voz en Configuración para transcribir la emisión.", "Choose and download a speech model in Settings to transcribe the broadcast."),
          button(t("Ir a Modelos IA", "Go to AI models"), "models", undefined, true))];
      }
      if (tab === "transcript") {
        const rows = transcript(doc, marked, isLive);
        if (!rows.length && doc.recording && doc.status === "separating") {
          return [empty(t("Separando voces de la grabación", "Separating recording speakers"),
            t("Después se transcribirá cada intervención.", "Each speaker turn will be transcribed next."))];
        }
        if (!rows.length && window.arkhamLinux && meta.bufferedLive && doc.status === "protected" && !doc.recording) {
          return [empty(t("Audio conservado en cola", "Audio kept in queue"),
            t("La transcripción continuará cuando la emisión o la grabación liberen recursos.",
              "Transcription will continue when playback or recording frees resources."))];
        }
        return rows.length ? rows : [empty(doc.recording ? t("Transcribiendo la grabación", "Transcribing the recording") : t("Escuchando la emisión", "Listening to the broadcast"),
          t("El texto aparecerá por fragmentos a medida que se reconozca la voz.", "Text appears in sections as speech is recognized."))];
      }
      if (!installed("text")) return [empty(t("Instala el modelo de texto", "Install the text model"),
        t("La transcripción funciona por separado. Descarga Qwen para usar el chat y los documentos.", "Transcription works separately. Download Qwen for chat and documents."),
        button(t("Ir a Modelos IA", "Go to AI models"), "models", undefined, true))];
      const items = chat(doc);
      if (working) {
        items.push(empty(working === "protected" ? t("La emisión tiene prioridad", "Playback has priority")
          : t("Consultando la transcripción…", "Reading the transcript…"), "",
          button(t("Cancelar", "Cancel"), "cancel-answer")));
      }
      if (!items.length) items.push(empty(t("Pregunta por esta transcripción", "Ask about this transcript"),
        t("Las respuestas incluyen marcas de tiempo para revisar la fuente.", "Replies include timestamps so you can check the source.")));
      return items;
    });
    if (full && marked !== null && tab === "transcript") {
      const selected = content.querySelector(".ai-highlight");
      if (selected) content.scrollTop += selected.getBoundingClientRect().top - content.getBoundingClientRect().top;
    } else if (full && lastScroll && isLive && tab === "transcript") content.scrollTop = content.scrollHeight;
    const actions = get("ai-session-actions");
    paint(actions, [lang(), doc?.id, doc?.status, doc?.archived, isLive, latestLive?.closing, pending].join(":"), () => {
      const items = [];
      if (isLive && doc && !latestLive?.closing) items.push(button(doc.status === "paused" ? t("Reanudar", "Resume") : t("Pausar", "Pause"),
        doc.status === "paused" ? "resume" : "pause"), button(t("Finalizar", "Finish"), "finish"));
      if (isLive && !doc.archived) {
        const save = button(t("Guardar", "Save"), "archive", doc.id);
        save.setAttribute("aria-label", t("Guardar en Transcripciones IA", "Save in AI transcripts"));
        save.disabled = pending;
        items.push(save);
      }
      const canClear = readableTranscripts && !archive && source === "live" && doc &&
        (doc.status === "saved" || latestLive?.closing);
      if (canClear) {
        if (!isLive && !doc.archived) items.push(button(t("Guardar", "Save"), "archive", doc.id));
        const clear = button("", "clear-transcript", doc.id);
        clear.classList.add("ai-clear-transcript");
        clear.title = t("Limpiar área de transcripción", "Clear transcript area");
        clear.setAttribute("aria-label", clear.title);
        clear.disabled = !!pending;
        clear.append(icon("i-ai-clear"));
        items.push(clear);
      }
      if (doc && (!doc.recording || doc.segments.length)) items.push(button(t("Exportar", "Export"), "export", doc.id));
      return items;
    });
  }

  function renderLibrary() {
    const stored = archivedSessions();
    const doc = jobs.get(selected);
    const answering = meta.work?.id;
    paint(library, JSON.stringify([lang(), stored, selected, doc?.revision, answering, readableTranscripts ? transcriptTimes : ""]), () => {
      if (!stored.length) return [empty(t("Todavía no hay transcripciones", "No transcripts yet"),
        t("Guarda o finaliza una transcripción para verla aquí.", "Save or finish a transcript to see it here."),
        button(t("Volver a En directo", "Back to Live"), "back", undefined, true))];
      const list = node("div", "", "ai-library-list");
      const date = new Intl.DateTimeFormat(arkhamLanguage.locale, { dateStyle: "medium", timeStyle: "short" });
      for (const row of stored) {
        const item = node("div", "", "ai-library-item");
        item.classList.toggle("is-selected", row.id === selected);
        const card = button("", "select", row.id);
        card.classList.add("ai-library-entry");
        card.setAttribute("aria-pressed", String(row.id === selected));
        const details = [row.channel, stamp(row.elapsed)];
        if (row.recording && !readableTranscripts) details.unshift(recordingLabel());
        if (row.recording && row.status !== "saved") details.push(recordingStatus(row));
        else if (row.status !== "saved") details.push(t("En curso", "In progress"));
        if (row.voices) details.push(t("Con voces", "With speakers"));
        const badge = node("span", "", "ai-library-icon");
        badge.append(icon(row.recording ? "i-record" : readableTranscripts ? "i-live" : "i-ai-transcript"));
        const copy = node("span", "", "ai-library-entry-copy");
        if (readableTranscripts) copy.append(originBadge(row));
        copy.append(node("strong", row.title), node("small", details.join(" · ")), node("small",
          date.format(row.recording ? new Date(row.recording.date * 1000) : new Date(row.created))));
        card.append(badge, copy);
        item.append(card);
        if (row.status === "saved") {
          const remove = button("", "delete", row.id);
          remove.classList.add("ai-library-remove");
          remove.setAttribute("aria-label", t("Eliminar transcripción: ", "Delete transcript: ") + row.title);
          remove.title = t("Eliminar transcripción", "Delete transcript");
          remove.disabled = answering === row.id;
          remove.append(icon("i-ai-trash"));
          item.append(remove);
        }
        list.append(item);
      }
      const detail = node("article", "", "panel ai-library-detail");
      if (doc) {
        const actions = node("div", "", "ai-session-actions");
        if (doc.recording && doc.status !== "saved") {
          const cancel = button(t("Detener transcripción", "Stop transcription"), "cancel-recording", doc.id);
          actions.append(cancel);
        }
        if (!doc.recording || doc.segments.length) actions.append(button(t("Preguntar", "Ask"), "ask-doc", doc.id, true),
          button(t("Exportar", "Export"), "export", doc.id));
        if (doc.recording && doc.status === "saved" && !doc.voices && meta.speakerSeparation?.ready) {
          actions.append(button(t("Separar voces", "Separate speakers"), "diarize", doc.id));
        }
        if (readableTranscripts) detail.append(originBadge(doc));
        else if (doc.recording) detail.append(node("p", recordingLabel(), "eyebrow"));
        detail.append(node("h2", doc.title), node("small", [doc.channel, doc.language?.toUpperCase(), stamp(doc.elapsed)].filter(Boolean).join(" · ")));
        if (doc.model && meta.models[doc.model]) detail.append(node("p",
          t("Modelo: ", "Model: ") + meta.models[doc.model].name, "ai-model-origin"));
        if (doc.recording) detail.append(node("p", recordingStatus(doc), "ai-recording-status"));
        detail.append(
          actions, ...transcript(doc, null));
      }
      return [list, detail];
    });
  }

  function modelView(family, name) {
    const row = node("div", "", "ai-model-row"), copy = node("div", "", "ai-model-family");
    const title = node("strong", name), description = node("small"), activeLabel = node("small", "", "ai-model-active");
    const picker = node("details", "", "language-control ai-model-picker");
    const summary = node("summary", "", "button secondary"), value = node("span"), size = node("small");
    const chevron = icon("i-chevron");
    chevron.classList.add("language-chevron");
    const caption = node("p");
    const choices = node("div", "", "choice-panel language-panel");
    const options = node("div", "", "ai-model-options"), actions = node("div", "", "ai-model-actions");
    const status = node("div", "", "ai-model-status");
    title.id = "ai-model-family-" + family;
    value.id = title.id + "-value";
    caption.id = title.id + "-caption";
    choices.id = title.id + "-options";
    summary.setAttribute("aria-labelledby", title.id + " " + value.id);
    summary.setAttribute("aria-controls", choices.id);
    choices.setAttribute("role", "group");
    choices.setAttribute("aria-labelledby", caption.id);
    summary.append(value, size, chevron);
    choices.append(caption, options);
    picker.append(summary, choices);
    copy.append(title, description, activeLabel);
    row.append(copy, picker, actions, status);
    models.append(row);
    const view = { selected: "", description, activeLabel, value, size, caption, options, actions, status };
    wireChoiceMenu(picker, option => { view.selected = option.dataset.model; renderModels(); });
    modelViews.set(family, view);
    return view;
  }

  function renderModels() {
    for (const [family, [name, es, en]] of Object.entries(modelFamilies)) {
      const variants = Object.entries(meta.models).filter(([, model]) => model.family === family);
      if (!variants.length) continue;
      const view = modelViews.get(family) || modelView(family, name);
      const activeKey = activeModel(family);
      const key = view.selected || activeKey, model = meta.models[key];
      const active = installed(family) ? meta.models[activeKey] : null;
      const formatSize = bytes => {
        const unit = bytes >= 1000000000 ? "GB" : "MB";
        return new Intl.NumberFormat(arkhamLanguage.locale, { maximumFractionDigits: unit === "GB" ? 1 : 0 })
          .format(bytes / (unit === "GB" ? 1000000000 : 1000000)) + " " + unit;
      };
      view.description.textContent = t(es, en);
      view.activeLabel.hidden = !active;
      view.activeLabel.textContent = active ? t("En uso: ", "In use: ") + active.name : "";
      view.caption.textContent = t("Versiones disponibles", "Available versions");
      view.value.textContent = model.name;
      view.size.textContent = formatSize(model.size);
      paint(view.options, JSON.stringify([lang(), key, variants.map(([id, row]) => [id, row.name, row.size])]), () =>
        variants.map(([id, row]) => {
          const option = node("button", "", "choice-option");
          option.type = "button";
          option.dataset.model = id;
          if (id === key) option.setAttribute("aria-current", "true");
          option.append(node("span", row.name), node("small", formatSize(row.size)), icon("i-check"));
          return option;
        }));
      paint(view.actions, JSON.stringify([lang(), key, model.status, activeKey]), () => {
        if (model.status === "installed") return [
          ...(key === activeKey ? [] : [button(t("Usar modelo", "Use model"), "activate", key, true)]),
          button(t("Quitar modelo", "Remove model"), "remove", key),
        ];
        return model.status === "downloading" ? [button(t("Cancelar descarga", "Cancel download"), "cancel", key)] :
          [button(t("Descargar modelo", "Download model"), "download", key, true)];
      });
      paint(view.status, JSON.stringify([lang(), key, model.status, model.bytes]), () => {
        if (model.status === "downloading") {
          const progress = node("progress");
          progress.value = model.bytes;
          progress.max = model.size;
          progress.setAttribute("aria-label", t("Descargando ", "Downloading ") + model.name);
          return [progress, node("small", Math.round(100 * model.bytes / model.size) + " %")];
        }
        if (model.status === "installed") return [node("small", t("Instalado", "Installed"))];
        if (model.status === "error") return [node("small", t("No se pudo verificar la descarga. Puedes reintentar.", "Could not verify the download. Try again."))];
        return [];
      });
    }
    const panel = get("ai-speakers-models"), info = meta.speakerSeparation;
    panel.hidden = !info;
    if (info) {
      const parts = speakerModels.map(id => meta.models[id]).filter(Boolean);
      const downloading = parts.some(model => model.status === "downloading");
      const anyInstalled = parts.some(model => model.status === "installed");
      const total = parts.reduce((sum, model) => sum + model.size, 0);
      const bytes = parts.reduce((sum, model) => sum + (model.status === "installed" ? model.size : model.bytes || 0), 0);
      get("ai-speakers-enabled").checked = info.enabled;
      get("ai-speakers-enabled").disabled = !info.ready || pending;
      get("ai-speakers-state").textContent = info.ready ? t("Modelos instalados", "Models installed")
        : downloading ? Math.round(100 * bytes / total) + " %" : Math.round(total / 1000000) + " MB";
      for (const control of panel.querySelectorAll("[data-ai-action]")) {
        const action = control.dataset.aiAction;
        control.hidden = action === "download-speakers" ? info.ready || downloading
          : action === "cancel-speakers" ? !downloading : !anyInstalled || downloading;
        control.disabled = !!pending || action === "remove-speakers" && info.busy;
      }
      const progress = get("ai-speakers-progress");
      progress.hidden = !downloading;
      progress.max = total; progress.value = bytes;
    }
  }

  function render() {
    layout();
    renderDock();
    if (route === "#transcripciones") renderLibrary();
    if (route === "#configuracion") renderModels();
  }

  async function update() {
    const count = ++pollCount;
    const id = docId();
    const cached = jobs.get(id);
    const query = new URLSearchParams({ id, revision: cached?.revision ?? "" });
    const data = await request("?" + query);
    if (count !== pollCount) return;
    const previous = active;
    active = data.active;
    if (active) liveId = active;
    meta = data;
    if (data.selected) jobs.set(data.selected.id, data.selected);
    const stored = archivedSessions();
    if (!stored.some(row => row.id === selected)) selected = stored[0]?.id || "";
    if (previous && !active && route === "#directo" && open[route]) error(t("Sesión guardada en Transcripciones IA.", "Session saved in AI transcripts."));
    if (docId() && docId() !== id) return update();
    render();
  }

  async function mutate(action, args = {}) {
    if (pending) return;
    pending = action;
    error();
    if (action === "start") renderDock();
    try {
      const result = await request("/" + action, args);
      if (action === "start" && result.id) {
        liveId = result.id;
        source = "live";
        tab = "transcript";
        marked = null;
      }
      if (action === "finish" && result.id) selected = result.id;
      if (action === "delete") {
        jobs.delete(args.id);
        drafts.delete(args.id);
        if (liveId === args.id && active !== args.id) liveId = "";
        if (source === args.id) source = "live";
        marked = null;
      }
      return result;
    } catch (failure) {
      error(failure.message);
    } finally {
      pending = false;
      await update().catch(() => {});
    }
  }

  async function send(kind, value) {
    const id = docId();
    if (!id || !value.trim()) return;
    tab = "chat";
    marked = null;
    if (await mutate("ask", { id, kind, question: value })) {
      if (kind === "question") {
        drafts.delete(id);
        if (docId() === id) question.value = "";
      }
      content.scrollTop = content.scrollHeight;
    }
  }

  async function preview() {
    const version = ++previewVersion;
    const save = get("ai-export-save"), out = get("ai-export-preview");
    save.disabled = true;
    get("ai-export-error").textContent = "";
    try {
      const data = await request("/export", { id: previewId,
        format: exportFormat, include: get("ai-export-include").checked,
        timestamps: readableTranscripts ? get("ai-export-times").checked : true });
      if (version !== previewVersion) return;
      out.value = data.text;
      save.disabled = false;
    } catch (failure) {
      if (version === previewVersion) get("ai-export-error").textContent = failure.message;
    }
  }

  function showExport(id) {
    previewId = id;
    formatPicker.open = false;
    get("ai-export-preview").value = "";
    modal.showModal();
    void preview();
  }

  async function saveInLibrary(id, exported = false) {
    try {
      await request("/archive", { id });
    } catch (failure) {
      error(exported
        ? t("El archivo se exportó, pero no se pudo añadir a Transcripciones IA.", "The file was exported, but could not be added to AI transcripts.")
        : failure.message);
      return;
    }
    selected = id;
    error(t("Transcripción guardada en Transcripciones IA.", "Transcript saved in AI transcripts."));
    await update().catch(() => {});
  }

  async function click(event) {
    const control = event.target.closest("[data-ai-action], [data-ai-tab]");
    if (!control) return;
    if (control.dataset.aiTab) {
      tab = control.dataset.aiTab;
      marked = null;
      renderDock();
      return;
    }
    const { aiAction: action, value } = control.dataset;
    if (["download-speakers", "remove-speakers", "cancel-speakers"].includes(action)) {
      const operation = action.split("-")[0];
      for (const model of speakerModels) await mutate(operation === "remove" ? "remove" : operation === "cancel" ? "cancel" : "download", { model });
      return;
    }
    if (action === "diarize") {
      const result = await mutate("diarize", { id: value });
      if (result?.id) { selected = result.id; await update(); }
      return;
    }
    if (action === "rename-speaker") {
      const doc = jobs.get(value), speaker = Number(control.dataset.speaker);
      if (!doc || !Number.isInteger(speaker)) return;
      renameVoice = { id: value, speaker };
      get("ai-voice-name").value = doc.speaker_names?.[speaker] || "";
      get("ai-voice-name").placeholder = voiceLabel(doc, speaker);
      voiceDialog.returnValue = "";
      voiceDialog.showModal();
      return;
    }
    if (action === "clear-transcript" && readableTranscripts) {
      const doc = jobs.get(value);
      const row = meta.sessions.find(item => item.id === value);
      if (!doc || (row?.status !== "saved" && !row?.closing) || pending) return;
      if (!doc.archived && !await mutate("archive", { id: value })) return;
      clearedLiveId = value;
      source = "live";
      marked = null;
      renderDock();
      error();
      return;
    }
    if (action === "transcript-times" && readableTranscripts) {
      transcriptTimes = !transcriptTimes;
      try { localStorage.setItem("arkham.ai.transcript.times", String(transcriptTimes)); } catch {}
      renderDock();
      if (route === "#transcripciones") renderLibrary();
      return;
    }
    if (action in prompts) return send(action, t(...prompts[action]));
    if (action === "models") return navigate("#configuracion");
    if (action === "back") return navigate("#directo");
    if (action === "ask-doc") {
      selected = value;
      open["#transcripciones"] = true;
      tab = "chat";
      marked = null;
      render();
      return;
    }
    if (action === "select") {
      selected = value;
      marked = null;
      return update();
    }
    if (action === "cite") {
      tab = "transcript";
      marked = Number(value);
      return renderDock();
    }
    if (action === "export") return showExport(value);
    if (action === "delete") {
      const doc = meta.sessions.find(row => row.id === value);
      if (doc?.status !== "saved" || deleteDialog.open) return;
      deleteId = doc.id;
      deleteDialog.returnValue = "";
      get("ai-delete-copy").textContent = t("¿Eliminar «", "Delete “") + doc.title +
        t("» del archivo de transcripciones? Se eliminarán su texto y sus respuestas de IA.",
          "” from the transcript archive? Its text and AI replies will be deleted.");
      deleteDialog.showModal();
      return;
    }
    if (action === "archive") return saveInLibrary(value);
    if (action === "cancel-recording") return mutate(action, { id: value });
    if (action === "remove" && !window.confirm(t("¿Quitar este modelo del equipo?", "Remove this model from this device?"))) return;
    return mutate(action, value === undefined ? {} : { model: value });
  }

  function toggle() {
    open[route] = !open[route];
    layout();
    renderDock();
    if (open[route]) void update().catch(() => {});
  }

  function wireChoiceMenu(picker, onChoose) {
    const trigger = picker.querySelector("summary");
    const choices = picker.querySelector(".choice-panel");
    const focusChoice = () => (choices.querySelector('[aria-current="true"]') || choices.querySelector("button"))?.focus();
    function close(refocus = false) {
      picker.open = false;
      if (refocus) trigger.focus();
    }
    choices.addEventListener("click", event => {
      const option = event.target.closest(".choice-option");
      if (!option) return;
      close(true);
      onChoose(option);
    });
    picker.addEventListener("keydown", event => {
      if (event.key === "Escape" && picker.open) {
        event.preventDefault();
        event.stopPropagation();
        close(true);
        return;
      }
      if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
      if (!picker.open) {
        if (event.key === "Home" || event.key === "End") return;
        event.preventDefault();
        picker.open = true;
        focusChoice();
        return;
      }
      event.preventDefault();
      const items = [...choices.querySelectorAll("button")];
      const index = items.indexOf(document.activeElement);
      const next = event.key === "Home" ? 0 : event.key === "End" ? items.length - 1 :
        Math.max(0, Math.min(items.length - 1, index + (event.key === "ArrowDown" ? 1 : -1)));
      items[next]?.focus();
    });
    picker.addEventListener("toggle", () => {
      if (picker.open) focusChoice();
    });
    picker.addEventListener("focusout", event => {
      if (event.relatedTarget && !picker.contains(event.relatedTarget)) close();
    });
    document.addEventListener("click", event => {
      if (picker.open && !picker.contains(event.target)) close();
    });
  }

  wireChoiceMenu(sourcePicker, option => {
    if (route === "#transcripciones") selected = option.dataset.sourceId;
    else source = option.dataset.sourceId;
    tab = "chat";
    marked = null;
    void update().catch(() => {});
  });
  wireChoiceMenu(formatPicker, option => {
    exportFormat = option.dataset.exportFormat;
    for (const item of formatPicker.querySelectorAll(".choice-option")) {
      if (item === option) item.setAttribute("aria-current", "true");
      else item.removeAttribute("aria-current");
    }
    get("ai-export-format-label").textContent = option.querySelector("span").textContent;
    void preview();
  });

  function health() {
    if (linuxPlaybackHealth) {
      const watched = route === "#directo" && !mini && !video.paused && !video.seeking && !document.hidden &&
        video.videoWidth && performance.now() >= startupUntil;
      const frames = watched ? video.getVideoPlaybackQuality?.() : null;
      const healthy = linuxPlaybackHealth(watched ? {
        wall: performance.now(), time: video.currentTime, readyState: video.readyState,
        total: frames?.totalVideoFrames || 0, dropped: frames?.droppedVideoFrames || 0,
        active: !!active || !!meta.work || meta.sessions.some(row => row.recording && row.status !== "saved"),
      } : null);
      if (healthy !== null) void request("/health", { healthy }).catch(() => {});
      return;
    }
    if (!(active || meta.work || (window.arkhamNative && meta.sessions.some(row => row.recording && row.status !== "saved"))) ||
        route !== "#directo" || mini || video.paused || video.seeking ||
        document.hidden || !video.videoWidth || performance.now() < startupUntil) {
      mediaSample = null;
      degradedSamples = 0;
      return;
    }
    const frames = video.getVideoPlaybackQuality?.();
    const now = { time: video.currentTime, total: frames?.totalVideoFrames || 0,
      dropped: frames?.droppedVideoFrames || 0 };
    if (mediaSample && now.time >= mediaSample.time) {
      const total = now.total - mediaSample.total;
      const dropped = now.dropped - mediaSample.dropped;
      const degraded = video.readyState < 3 || now.time - mediaSample.time < .55 ||
        (total > 0 && dropped >= 3 && dropped / total > .08);
      degradedSamples = degraded ? degradedSamples + 1 : 0;
      if (window.arkhamNative && degraded && degradedSamples < 2 && !unhealthy) {
        mediaSample = now;
        return;
      }
      if (degraded || unhealthy) {
        protectionSample = degraded ? 0 : protectionSample + 1;
        unhealthy = degraded || protectionSample < 3;
        void request("/health", { healthy: !degraded }).catch(() => {});
      }
    }
    mediaSample = now;
  }

  app.classList.add("ai-available");
  for (const id of ["ai-nav", "ai-models", "ai-open"]) get(id).hidden = false;
  get("ai-dock-toggle").addEventListener("click", toggle);
  trigger.addEventListener("click", toggle);
  for (const region of [body, library, models, get("ai-speakers-models")]) region.addEventListener("click", event => {
    void click(event).catch(failure => error(failure.message));
  });
  question.addEventListener("input", () => drafts.set(docId(), question.value));
  get("ai-form").addEventListener("submit", event => {
    event.preventDefault();
    void send("question", question.value);
  });
  get("ai-export-include").addEventListener("change", preview);
  get("ai-export-times-field").hidden = !readableTranscripts;
  get("ai-export-times").addEventListener("change", preview);
  get("ai-speakers-enabled").addEventListener("change", event => void mutate("speaker-enable", { enabled: event.target.checked }));
  voiceDialog.addEventListener("close", () => {
    const request = renameVoice;
    renameVoice = null;
    if (request && voiceDialog.returnValue === "save") void mutate("rename-speaker", { ...request, name: get("ai-voice-name").value });
  });
  deleteDialog.addEventListener("close", async () => {
    const id = deleteId;
    deleteId = null;
    if (deleteDialog.returnValue !== "delete" || !id) return;
    if (await mutate("delete", { id })) {
      error(t("Transcripción eliminada.", "Transcript deleted."));
      get("ai-library-title").focus({ preventScroll: true });
    }
  });
  get("ai-export-save").addEventListener("click", () => {
    fileExportId = previewId;
    window.webkit?.messageHandlers?.arkhamAIExport?.postMessage({ format: exportFormat, text: get("ai-export-preview").value });
  });
  window.addEventListener("arkham-ai-export", event => {
    const id = fileExportId;
    fileExportId = null;
    if (event.detail === "saved") {
      modal.close();
      if (id) void saveInLibrary(id, true);
    }
    else if (event.detail === "error") get("ai-export-error").textContent = t("No se pudo guardar el archivo.", "The file could not be saved.");
  });
  video.addEventListener("loadstart", () => { startupUntil = performance.now() + 4000; mediaSample = null; });
  setInterval(() => {
    health();
    if (!document.hidden && (active || meta.work || !body.hidden || route === "#configuracion" || route === "#transcripciones")) {
      void update().catch(() => {});
    }
  }, 1600);
  return {
    async transcribeRecording(id) {
      const result = await request("/start-recording", { id });
      selected = result.id;
      navigate("#transcripciones");
      await update();
    },
    navigate(next, miniMode) {
      if (route === next && mini === miniMode) return;
      route = next;
      mini = miniMode;
      sourcePicker.open = false;
      error();
      render();
      if (Object.hasOwn(open, next) || next === "#configuracion") void update().catch(() => {});
    },
  };
};
