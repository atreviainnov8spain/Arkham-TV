"use strict";

function createTeletext({ api, tune }) {
  const el = id => document.getElementById("tt-" + id);
  const root = document.getElementById("teletexto");
  const text = (id, value) => {
    const target = el(id);
    if (target.textContent !== value) target.textContent = value;
  };
  const t = (spanish, english) => arkhamLanguage.language === "en" ? english : spanish;
  const palettes = ["#101012", "#ff525c", "#82f887", "#ffe976", "#7c9cff", "#ff84e8", "#79ecff", "#fbfbf9"];
  // EN 300 706, Level 1 Latin national options in their page-header order.
  const nationalCodes = "#$@[\\]^_`{|}~";
  const nationalSets = [
    "£$@←½→↑#—¼‖¾÷", "#$§ÄÖÜ^_°äöüß", "#¤ÉÄÖÅÜ_éäöåü", "£$é°ç→↑#ùàòèì",
    "éïàëêùî#èâôûç", "ç$¡áéíóú¿üñèà", "#ůčťžýířéáěúš",
  ];
  const themes = [
    { match: /deport|esport|sport|resultad|resultat/i, tone: "lime", icon: "i-record" },
    { match: /tiempo|temps|weather|meteorol/i, tone: "aqua", icon: "i-antenna" },
    { match: /cultur|agenda|ocio|lleure/i, tone: "pink", icon: "i-guide" },
    { match: /programaci|horari|schedule|guía|guia/i, tone: "amber", icon: "i-live" },
  ];
  const colors = ["aqua", "lime", "pink", "amber"];
  const diacritics = ["", "\u0300", "\u0301", "\u0302", "\u0303", "\u0304", "\u0306", "\u0307",
    "\u0308", "\u0323", "\u030A", "\u0327", "\u0332", "\u030B", "\u0328", "\u030C"];
  // Latin G2 (EN 300 706, table 41), indexed by the high and low nibbles.
  const latinG2 = [
    " ¡¢£$¥#§¤‘“«←↑→↓", "°±²³×µ¶·÷’”»¼½¾¿", " ˋˊˆ˜ˉ˘˙¨.˚ˏˍ˝˛ˇ",
    "—¹®©™♪€‰ɑ   ⅛⅜⅝⅞", "ΩÆÐªĦ ĲĿŁØŒºÞŦŊŉ", "ĸæđðħıĳŀłøœßþŧŋ■",
  ];
  let active = false, visibleState, busy = false, connected = true, channelKey = "";
  let number = 100, subpage = null, mode = "reading";
  let stream, available = [], revision = -1, documentPage, entryIndex, highlight, backendState = "idle";
  let request = 0, pollTimer, message = "", renderKey = "";
  const channelPicker = createBroadcastChannelPicker(el("picker"), selectChannel);

  function selectChannel(id) {
    if (id === visibleState?.stream?.channel) return;
    openPage(100);
    return tune(id, error => {
      message = error;
      show();
    });
  }

  function node(tag, label, className) {
    const item = document.createElement(tag);
    if (label !== undefined) item.textContent = label;
    if (className) item.className = className;
    if (tag === "button") item.type = "button";
    return item;
  }
  function icon(id) {
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    const use = document.createElementNS(svg.namespaceURI, "use");
    svg.setAttribute("aria-hidden", "true");
    use.setAttribute("href", "#" + id);
    svg.append(use);
    return svg;
  }

  function glyph(code, national) {
    const character = String.fromCharCode(code);
    const index = nationalCodes.indexOf(character);
    if (index >= 0 && nationalSets[national]) return nationalSets[national][index];
    return code === 127 ? "█" : character;
  }

  function decodeRow(row, national) {
    let fg = 7, bg = 0, graphics = false, separated = false, hold = false, tall = false, hide = false, lastMosaic = 0;
    return [...row].map(character => {
      const code = character.charCodeAt(0);
      if (code === 0x0C) tall = false;
      else if (code === 0x18) hide = true;
      else if (code === 0x19) separated = false;
      else if (code === 0x1A) separated = true;
      else if (code === 0x1C) bg = 0;
      else if (code === 0x1D) bg = fg;
      else if (code === 0x1E) hold = true;

      const mosaic = code >= 32 && graphics && Boolean(code & 32);
      if (mosaic) lastMosaic = (code & 31) | ((code & 64) >> 1);
      const cell = { fg, bg, separated, tall, bits: hide ? 0 : mosaic || (code < 32 && hold && graphics) ? lastMosaic : 0,
        hidden: hide, char: code < 32 || mosaic || hide ? " " : glyph(code, national) };

      if (code < 8 || (code >= 0x10 && code < 0x18)) {
        const nextGraphics = code >= 0x10;
        if (graphics !== nextGraphics) lastMosaic = 0;
        fg = code & 7;
        graphics = nextGraphics;
        hide = false;
      } else if (code === 0x0D) tall = true;
      else if (code === 0x1F) hold = false;
      return cell;
    });
  }

  function decoded(page) {
    const rows = page.rows.map(row => decodeRow(row, page.national));
    for (const [row, col, mode, value] of page.enhancements || []) {
      const cell = rows[row][col];
      if (cell.hidden) continue;
      const character = mode === 15 ? latinG2[(value >> 4) - 2]?.[value & 15]
        : mode === 16 && value === 0x2A ? "@" : glyph(value, -1);
      if (!character) continue;
      cell.char = (character + (diacritics[mode - 16] || "")).normalize("NFC");
      cell.bits = 0;
    }
    return rows;
  }

  function readingLines(rows) {
    let covered = [];
    return rows.slice(1).map((row, index) => {
      const line = row.map((cell, col) => covered[col] ? " " : cell.char).join("");
      covered = row.map((cell, col) => !covered[col] && cell.tall);
      const visible = line.trim().replace(/^█+\s*|\s*█+$/g, "").trim();
      const clean = index < 4 ? visible.replace(/^tve\s{2,}/i, "") : visible;
      // Identifiers in a mosaic header and the coloured Fastext key strip have their own place in Original view.
      const masthead = index < 4 && row.some(cell => cell.bits) && (clean.length < 4 || /^tve$/i.test(clean));
      const keyStrip = index === 23 && new Set(row.filter(cell => cell.char !== " ").map(cell => cell.fg)).size > 2;
      return { line: masthead || keyStrip ? "" : line, text: masthead || keyStrip ? "" : clean,
        graphics: row.some(cell => cell.bits),
        bullet: line.trimStart().startsWith("█") && Boolean(clean) };
    });
  }

  function titleLine(lines) {
    return lines.find(({ text }) => /\p{L}{3}/u.test(text));
  }

  function indexLinks(line, directory = false) {
    const entries = [];
    let offset = 0;
    const references = /(?<!\d)[1-8]\d{2}(?=$|[^\p{L}\d])/gu;
    for (const match of line.matchAll(references)) {
      const before = line.slice(offset, match.index);
      const target = Number(match[0]);
      const item = entries.at(-1);
      if (item && /^(?:\s*[-–]\s*|[.…·]{2,})$/.test(before)) {
        item.targets.push({ number: target, separator: before.includes("-") || before.includes("–") ? "–" : " · " });
        item.end = offset = match.index + 3;
        continue;
      }
      const separator = before.match(/[.…·:]+\s*$|[-─]{2,}\s*$|\s+$/);
      const atColumnEnd = directory && !separator && /\p{L}$/u.test(before) && line.slice(match.index + 3).trim() === "";
      const title = (separator ? before.slice(0, separator.index) : before).replace(/^[\s█]+/, "").trim();
      if ((!separator && !atColumnEnd) || !/\p{L}/u.test(title) || /^\s*\d+\s*$/.test(before)) continue;
      // Dotted or dashed leaders are explicit references. Allow a space for a number at the end of a directory column.
      if (!directory && !/[.…·:\-─]/.test(separator?.[0] || "")) continue;
      entries.push({ title, target, targets: [{ number: target, separator: "" }], end: match.index + 3 });
      offset = match.index + 3;
    }
    const leading = !entries.length && line.match(/^\s*([1-8]\d{2})[ .:·-]+(\p{L}[^\n]+)$/u);
    if (leading) {
      const target = Number(leading[1]);
      entries.push({ title: leading[2].trim(), target, targets: [{ number: target, separator: "" }], end: line.length });
    }
    return entries;
  }

  function indexColumns(lines) {
    const isEntry = item => indexLinks(item.line).length > 0;
    if (lines.filter(isEntry).length < 3) return null;
    let split = 0, best = 1;
    for (let column = 18; column <= 24; column++) {
      // A genuine gutter has blank cells and complete entries on both sides across several rows.
      const score = lines.filter(({ line }) => {
        if (!/\s/.test(line[column] || "") && !/\s/.test(line[column - 1] || "")) return false;
        const left = indexLinks(line.slice(0, column)).at(-1);
        const right = indexLinks(line.slice(column)).at(-1);
        return left && right && !line.slice(left.end, column).trim() && !line.slice(column + right.end).trim();
      }).length;
      if (score > best || (score === best && split && Math.abs(column - 20) < Math.abs(split - 20))) {
        best = score;
        split = column;
      }
    }
    return split;
  }

  function homeLinks(lines) {
    const entries = new Map();
    const split = indexColumns(lines);
    const columns = split ? [lines.map(({ line }) => line.slice(0, split)), lines.map(({ line }) => line.slice(split))]
      : [lines.map(({ text }) => text)];
    for (const column of columns) {
      let group = "";
      for (const line of column) {
        const links = indexLinks(line, true);
        const heading = line.trim();
        if (!links.length && /^\p{Lu}[\p{Lu}\s]{3,}$/u.test(heading)) group = heading;
        for (const entry of links) {
          if (entry.target !== 100 && !entries.has(entry.target)) entries.set(entry.target, { ...entry, group });
        }
      }
    }
    return [...entries.values()];
  }

  function setStatus(title, detail = "", scan = false) {
    const status = el("status");
    status.hidden = !title;
    text("status-title", title);
    text("status-detail", detail);
    el("status-detail").hidden = !detail;
    el("scan-link").hidden = !scan;
  }

  function drawHome() {
    const lines = entryIndex ? readingLines(decoded(entryIndex)) : [];
    const entries = homeLinks(lines);
    const featuredTopic = /notici|especial|actualitat|titular|informaci|news|headlines/i;
    const headline = entries.find(item => featuredTopic.test(item.title))
      || entries.find(item => featuredTopic.test(item.group));
    const featured = headline || { target: 100, title: titleLine(lines)?.text || t("Índice del canal", "Channel index") };
    el("feature").dataset.ttPage = featured.target;
    text("feature-number", String(featured.target));
    text("feature-category", headline ? t("Noticias", "News") : t("Teletexto", "Teletext"));
    const preview = highlight?.target === featured.target ? highlight : null;
    text("feature-title", preview?.title || featured.title);
    text("feature-copy", preview?.summary || (headline ? "" : t("Consulta las páginas que emite este canal.", "Browse this channel’s broadcast pages.")));
    el("feature-copy").hidden = !el("feature-copy").textContent;
    if (headline && available.includes(featured.target) && !preview) loadHighlight(featured.target);
    const tiles = entries.filter(item => item !== headline).slice(0, 8).map(({ target, title }, index) => {
      const theme = themes.find(item => item.match.test(title));
      const tile = node("button");
      tile.dataset.ttPage = target;
      tile.dataset.tone = theme?.tone || colors[index % colors.length];
      const category = node("span", undefined, "tt-category");
      category.append(icon(theme?.icon || "i-teletext"), node("b", String(target)));
      const arrow = icon("i-chevron");
      arrow.classList.add("tt-card-arrow");
      tile.append(category, node("strong", title), arrow);
      return tile;
    });
    if (!tiles.length) {
      for (const [index, target] of available.filter(value => value !== 100).slice(0, 8).entries()) {
        const tile = node("button");
        tile.dataset.ttPage = target;
        tile.dataset.tone = colors[index % colors.length];
        const category = node("span", undefined, "tt-category");
        category.append(icon("i-teletext"), node("b", String(target)));
        tile.append(category, node("strong", t("Abrir página", "Open page")));
        tiles.push(tile);
      }
    }
    el("pages").replaceChildren(...tiles);
    el("directory").hidden = available.length === 0;
    const buttons = available.map(target => {
      const button = node("button", String(target), "button secondary");
      button.dataset.ttPage = target;
      button.setAttribute("aria-label", `${t("Página", "Page")} ${target}`);
      return button;
    });
    el("directory-pages").replaceChildren(...buttons);
  }

  async function loadHighlight(target) {
    const source = stream, index = entryIndex?.revision;
    highlight = { target };
    try {
      const result = await api("teletext?" + new URLSearchParams({ page: target }));
      if (!active || stream !== source || result.stream !== source || entryIndex?.revision !== index || highlight?.target !== target) {
        if (stream === source && highlight?.target === target && !highlight.title) highlight = null;
        return;
      }
      if (!result.page) return;
      const heading = readHeading(readingLines(decoded(result.page)));
      highlight = { target, title: heading.title, summary: heading.lines
        .find(({ text }) => text && !indexLinks(text).length)?.text };
      renderKey = "";
      show();
    } catch {
      // The index label is already available if the preview could not be loaded.
    }
  }

  function pageLink(number, label) {
    const button = node("button", String(number), "tt-inline-link");
    button.dataset.ttPage = number;
    button.setAttribute("aria-label", label ? `${label} · ${t("Página", "Page")} ${number}` : `${t("Página", "Page")} ${number}`);
    return button;
  }

  function readHeading(lines) {
    const first = titleLine(lines);
    const firstBody = lines.slice(0, 8).findIndex(item => item.bullet);
    if (firstBody > 0 && /^\d+\/\d+\s+\p{L}/u.test(first?.text || "")) {
      const remaining = lines.slice(firstBody);
      const end = remaining.findIndex(item => !item.text);
      const headline = end >= 0 ? remaining.slice(0, end) : remaining;
      const meta = lines.slice(0, firstBody).map(item => item.text.replace(/^\d+\/\d+\s*/, "").replace(/\s{2,}/g, " ")).filter(Boolean);
      return { title: headline.map(item => item.text).join(" "), lines: remaining.slice(headline.length), meta };
    }
    if (first) {
      const remaining = lines.slice(lines.indexOf(first) + 1);
      if (first.graphics && /^\p{Lu}[\p{Lu}\s]{2,20}$/u.test(first.text)) {
        const headline = [];
        for (const item of remaining.slice(0, 3)) {
          if (!/\p{Lu}{3}/u.test(item.text) || /\p{Ll}/u.test(item.text) || indexLinks(item.text).length) break;
          headline.push(item.text);
        }
        if (headline.join(" ").length > 20) {
          return { title: headline.join(" ").replace(/\s{2,}/g, " "),
            lines: remaining.slice(headline.length), meta: [first.text] };
        }
      }
      const line = first.text.replace(/\s{2,}/g, " ");
      const stamp = line.match(/\s+(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?\s+\d{1,2}:\d{2})$/);
      return { title: stamp ? line.slice(0, stamp.index) : line,
        lines: lines.filter(item => item !== first), meta: stamp ? [stamp[1]] : [] };
    }
    return { title: "", lines, meta: [] };
  }

  function drawIndex(content, lines, split) {
    const layout = node("div", undefined, "tt-reading-columns");
    const columns = Array.from({ length: split ? 2 : 1 }, () => node("div", undefined, "tt-reading-column"));
    let layoutAttached = false;
    let teaser = [];
    for (const [rowIndex, { line, text }] of lines.entries()) {
      if (!text) {
        teaser = [];
        continue;
      }
      const continuation = text.match(/^[-─.·]{3,}\s*([1-8]\d{2})$/);
      if (!split && continuation && teaser.length) {
        const label = teaser.join(" ");
        const last = columns[0].lastElementChild;
        if (last?.classList.contains("tt-teaser")) last.remove();
        const item = node("div", undefined, "tt-reading-index");
        item.append(node("span", label), pageLink(Number(continuation[1]), label));
        columns[0].append(item);
        teaser = [];
        continue;
      }
      const isWide = split && line[split - 1]?.trim() && line[split]?.trim()
        || split && !indexLinks(line).length && text.length > 24 && line.slice(split).trim() && line.slice(0, split).trim();
      if (isWide) {
        if (layoutAttached) {
          const note = node("p", text, "tt-reading-note");
          layout.append(note);
        } else {
          content.append(node("p", text, "tt-reading-note"));
        }
        continue;
      }
      if (!layoutAttached) {
        layout.append(...columns);
        content.append(layout);
        layoutAttached = true;
      }
      const parts = split ? [line.slice(0, split).trim(), line.slice(split).trim()] : [text];
      parts.forEach((part, index) => {
        if (!part) return;
        const entries = indexLinks(part, true);
        const column = columns[index];
        if (!entries.length) {
          const heading = /^\p{Lu}[\p{Lu}\p{N}.\s]{3,}$/u.test(part);
          if (!split && !heading && lines.slice(rowIndex + 1, rowIndex + 4).some(item => /^[-─.·]{3,}\s*[1-8]\d{2}$/.test(item.text))) {
            if (!teaser.length) column.append(node("p", "", "tt-teaser"));
            teaser.push(part);
            column.lastElementChild.textContent = teaser.join(" ");
            return;
          }
          teaser = [];
          column.append(node(heading ? "h3" : "p", part, "tt-reading-note"));
          return;
        }
        for (const entry of entries) {
          const row = node("div", undefined, "tt-reading-index");
          const links = node("span", undefined, "tt-reading-refs");
          for (const { number, separator } of entry.targets) {
            links.append(separator, pageLink(number, entry.title));
          }
          row.append(node("span", entry.title), links);
          column.append(row);
        }
      });
    }
  }

  function drawOriginal(rows, title) {
    const grid = node("div", undefined, "tt-grid");
    grid.setAttribute("role", "img");
    grid.setAttribute("aria-label", `${t("Vista original", "Original view")} · ${title}. ${readingLines(rows).map(item => item.text).filter(Boolean).join(". ")}`);
    let tallAbove = [];
    for (const row of rows) {
      const nextAbove = [];
      for (const [col, cell] of row.entries()) {
        const continuation = tallAbove[col];
        const current = continuation || cell;
        if (!continuation && cell.tall) nextAbove[col] = cell;
        const mark = node("span", undefined, "tt-cell");
        mark.style.color = palettes[current.fg];
        mark.style.backgroundColor = palettes[current.bg];
        if (current.tall) mark.classList.add(continuation ? "tt-tail" : "tt-tall");
        if (current.bits) {
          const mosaic = node("span", undefined, "tt-mosaic" + (current.separated ? " tt-separated" : ""));
          for (let bit = 0; bit < 6; bit++) {
            const square = node("i");
            if (current.bits & (1 << bit)) square.style.backgroundColor = palettes[current.fg];
            mosaic.append(square);
          }
          mark.append(mosaic);
        } else mark.append(node("span", current.char));
        grid.append(mark);
      }
      tallAbove = nextAbove;
    }
    el("crt").replaceChildren(grid);
  }

  function drawReader() {
    const rows = decoded(documentPage);
    const lines = readingLines(rows);
    const split = indexColumns(lines);
    const isIndex = split !== null;
    const entry = entryIndex && homeLinks(readingLines(decoded(entryIndex))).find(item => item.targets.some(link => link.number === number));
    const heading = readHeading(lines);
    const category = entry?.group && /^(?:índex|índice|index|contents|portada|p\.\s*página)/i.test(entry.title);
    const title = (isIndex && entry ? (category ? entry.group : entry.title) : heading.title)
      || entry?.title || `${t("Página", "Page")} ${number}`;
    text("number", String(number));
    text("section", visibleState.channels.find(channel => channel.id === visibleState.stream?.channel)?.name || "");
    text("title", title);
    const content = el("reading");
    content.replaceChildren();
    if (heading.meta.length) content.append(node("p", heading.meta.join(" · "), "tt-reading-note"));
    const body = !isIndex || heading.title === title ? heading.lines : lines;
    if (isIndex) drawIndex(content, body, split);
    else {
      let paragraph = null, table = null;
      const tableRow = /(?:\s+\d+){3,}\s*$|\s{2,}\d+\s+\d+\s{2,}/;
      const isTable = body.filter(({ line }) => tableRow.test(line)).length >= 3;
      for (const item of body) {
        if (!item.text) {
          paragraph = table = null;
          continue;
        }
        if (isTable && tableRow.test(item.line)) {
          if (!table) {
            table = node("pre", "", "tt-reading-table");
            content.append(table);
          }
          table.textContent += (table.textContent ? "\n" : "") + item.line.trimEnd();
          paragraph = null;
          continue;
        }
        table = null;
        if (indexLinks(item.text).length) {
          drawIndex(content, [item], 0);
          paragraph = null;
          continue;
        }
        if (!paragraph) {
          paragraph = node("p", item.text);
          content.append(paragraph);
        } else if (/\p{L}-$/.test(paragraph.textContent) && /^\p{Ll}/u.test(item.text)) {
          paragraph.textContent = paragraph.textContent.slice(0, -1) + item.text;
        } else {
          paragraph.append(" ", item.text);
        }
      }
    }
    if (!content.children.length) content.append(node("p", t("Consulta esta página en la vista original.", "Read this page in the original view.")));
    if (mode === "original") drawOriginal(rows, title);
    el("reading").hidden = mode !== "reading";
    el("original").hidden = mode !== "original";
  }

  function show() {
    if (!active) return;
    const home = number === 100 && mode === "reading";
    if (home) el("index").setAttribute("aria-current", "page");
    else el("index").removeAttribute("aria-current");
    for (const button of root.querySelectorAll("[data-tt-mode]")) button.setAttribute("aria-pressed", String(button.dataset.ttMode === mode));
    const channelDisabled = !connected || busy || !visibleState?.hardware.ready || visibleState.scan.state === "running"
      || visibleState.recordingUhf != null;
    channelPicker.update(visibleState?.stream?.channel, channelDisabled, t("Elige un canal", "Choose a channel"));
    const ready = backendState === "ready";
    const canRead = connected && visibleState?.stream && !busy && !message && !visibleState.streamError && ready;
    const showHome = Boolean(canRead && home && (entryIndex || available.length));
    const showReader = Boolean(canRead && !home && documentPage);
    el("home").hidden = !showHome;
    el("reader").hidden = !showReader;
    if (!connected) setStatus(t("Servidor desconectado", "Server disconnected"));
    else if (!visibleState) setStatus(t("Conectando con el sintonizador…", "Connecting to the tuner…"));
    else if (busy) setStatus(t("Preparando el canal…", "Preparing the channel…"));
    else if (visibleState.stream?.hdmi) setStatus(t("Entrada HDMI activa", "HDMI input active"),
      t("Abre el teletexto con el mando del receptor o elige un canal del sintonizador USB.", "Open teletext with the receiver’s remote or choose a channel from the USB tuner."));
    else if (message || visibleState.streamError) setStatus(message || arkhamLanguage.message(visibleState.streamError));
    else if (!visibleState.channels.length) {
      setStatus(t("Sintoniza tus canales", "Scan for channels"), t("El teletexto está disponible en los canales que lo emiten.", "Teletext is available on channels that broadcast it."), true);
    } else if (!visibleState.hardware.ready) setStatus(arkhamLanguage.message(visibleState.hardware.message) || t("Sintonizador en espera", "Tuner unavailable"));
    else if (visibleState.scan.state === "running") setStatus(t("Buscando canales…", "Scanning for channels…"));
    else if (backendState === "no-signal") setStatus(t("Sin señal de antena", "No antenna signal"));
    else if (!visibleState.stream) setStatus(t("Elige un canal", "Choose a channel"), t("Selecciona una emisora para recibir su teletexto.", "Choose a station to receive its teletext."));
    else if (backendState === "unavailable") setStatus(t("Este canal no emite páginas de teletexto", "This channel does not broadcast teletext pages"), t("Prueba con otro canal.", "Try another channel."));
    else if (backendState === "error") setStatus(t("No se pudo consultar el teletexto.", "Teletext could not be loaded."));
    else if (showHome) {
      setStatus("");
      el("feature").hidden = !entryIndex;
      const key = JSON.stringify([stream, "index", entryIndex?.revision, available]);
      if (key !== renderKey) { drawHome(); renderKey = key; }
    } else if (showReader) {
      setStatus("");
      const key = JSON.stringify([stream, revision, entryIndex?.revision, mode]);
      if (key !== renderKey) { drawReader(); renderKey = key; }
    } else {
      const label = ready ? `${t("Esperando la página", "Waiting for page")} ${number}` : t("Buscando teletexto…", "Looking for teletext…");
      setStatus(label, ready ? t("Las páginas llegan por turnos desde la emisora.", "Pages arrive in a cycle from the broadcaster.") : "");
    }
    if (!showReader) return;
    el("previous").disabled = !available.some(page => page < number) && number === 100;
    el("next").disabled = !available.some(page => page > number);
  }

  function clearReading() {
    available = [];
    highlight = entryIndex = documentPage = null;
    revision = -1;
    subpage = null;
    backendState = "idle";
    el("subpages").hidden = true;
  }

  function showSubpages(subpages) {
    const choose = el("subpage");
    const key = subpages.join(",");
    if (choose.dataset.key !== key) {
      choose.dataset.key = key;
      choose.replaceChildren(...subpages.map((value, index) => new Option(`${index + 1} / ${subpages.length}`, String(value))));
    }
    choose.value = String(subpage);
    el("subpages").hidden = subpages.length < 2;
  }

  async function poll() {
    clearTimeout(pollTimer);
    if (!active || !connected || !visibleState?.stream || visibleState.stream.hdmi || document.hidden) return;
    const token = ++request;
    const query = new URLSearchParams({ page: number, revision });
    if (subpage !== null) query.set("subpage", subpage);
    try {
      const result = await api("teletext?" + query);
      if (!active || request !== token) return;
      if (result.stream && result.stream !== stream) return;
      backendState = result.state;
      if (result.state === "ready") {
        const samePage = revision === result.revision;
        revision = result.revision ?? -1;
        documentPage = result.page || (samePage ? documentPage : null);
        if (result.index && result.index.revision !== entryIndex?.revision) {
          entryIndex = result.index;
          highlight = null;
        }
        available = result.pages;
        subpage = result.subpage;
        showSubpages(result.subpages);
      } else {
        clearReading();
        backendState = result.state;
      }
      show();
    } catch {
      if (request === token && active) {
        clearReading();
        backendState = "error";
        show();
      }
    } finally {
      if (active && request === token) {
        const awaitingPages = backendState === "detecting" || (backendState === "ready" && !available.length);
        pollTimer = setTimeout(poll, awaitingPages ? 350 : 1100);
      }
    }
  }

  function openPage(page, nextMode = "reading") {
    if (!Number.isInteger(page) || page < 100 || page > 899) return;
    message = "";
    if (number !== page) {
      documentPage = null;
      revision = -1;
      subpage = null;
    }
    number = page;
    mode = nextMode;
    el("page-input").value = page === 100 && mode === "reading" ? "" : String(page);
    show();
    poll();
  }

  function render(state, pending) {
    const previousStream = stream;
    const previousChannel = visibleState?.stream?.channel;
    const reconnected = !connected;
    connected = true;
    visibleState = state;
    busy = pending;
    stream = state.stream?.id;
    if (previousStream !== stream) {
      request++;
      clearReading();
      if (state.stream && state.stream.channel !== previousChannel) {
        number = 100;
        mode = "reading";
        el("page-input").value = "";
      }
      if (stream) message = "";
    }
    if (!active) return;
    const key = JSON.stringify(state.channels.map(channel => [channel.id, channel.name, channel.frequency]));
    if (key !== channelKey) {
      channelKey = key;
      channelPicker.setGroups(groupBroadcastChannels(state.channels));
    }
    show();
    if (previousStream !== stream || reconnected) poll();
  }

  el("index").addEventListener("click", () => openPage(100));
  el("jump").addEventListener("submit", event => {
    event.preventDefault();
    openPage(Number(el("page-input").value), el("page-input").value === "100" && mode === "original" ? "original" : "reading");
  });
  el("subpage").addEventListener("change", () => {
    subpage = Number(el("subpage").value);
    revision = -1;
    poll();
  });
  for (const [id, direction] of [["previous", -1], ["next", 1]]) {
    el(id).addEventListener("click", () => {
      const pages = direction === -1 ? available.slice().reverse() : available;
      const next = pages.find(page => direction * (page - number) > 0);
      if (next !== undefined) openPage(next, next === 100 ? "reading" : mode);
      else if (direction === -1 && number !== 100) openPage(100);
    });
  }
  root.addEventListener("click", event => {
    const control = event.target.closest("button");
    if (!control) return;
    if (control.dataset.ttPage) {
      const target = Number(control.dataset.ttPage);
      openPage(target, target === 100 ? "original" : "reading");
      if (el("reader").hidden) el("page-input").focus();
      else el("title").focus();
    } else if (control.dataset.ttMode) {
      mode = control.dataset.ttMode;
      show();
    }
  });
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) poll();
  });

  return {
    render,
    navigate(open) {
      if (active === open) return;
      active = open;
      if (!open) {
        channelPicker.close();
        clearTimeout(pollTimer);
        request++;
        return;
      }
      if (visibleState) render(visibleState, busy);
      else show();
      poll();
    },
    disconnect() {
      connected = false;
      request++;
      clearTimeout(pollTimer);
      clearReading();
      show();
    },
  };
}
