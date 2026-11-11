"use strict";

const programFieldNames = {
  "Título original": ["titulo original", "titol original", "original title"],
  "Dirección": ["direccion", "direccio", "dir.", "directed by", "director"],
  "Guion": ["guion", "guio", "guionista", "screenplay", "written by"],
  "Producción": ["produccion", "produccio", "production", "producer", "productora"],
  "Fotografía": ["fotografia", "cinematography"],
  "Año": ["ano", "any", "year", "ano de produccion", "any de produccio"],
  "País": ["pais", "country", "nacionalidad", "nacionalitat"],
  "Duración": ["duracion aprox.", "duracio aproximada", "duracion", "duracio", "durada", "runtime", "duration"],
  "Género": ["genero", "genere", "genre"],
  "Clasificación": ["clasificacion", "edat", "qualificacio", "edad", "rating"],
  "Temporada": ["temporada", "season"],
  "Episodio": ["episodio", "episodi", "capitulo", "capitol", "episode"],
  "Presentación": ["presenta", "presentacion", "presentador", "presentadora", "presentacio", "presented by", "host"],
  "Reparto": ["reparto", "interpretes", "interprets", "int.", "cast", "actors", "actores", "actors i actrius"],
  "Sinopsis": ["sinopsis", "sinopsi", "argumento", "argument", "synopsis", "plot", "resumen", "resum"],
};

const programKey = text => text.normalize("NFD").toLowerCase().replace(/\p{M}/gu, "")
  .replace(/[^\p{L}\p{N}]+/gu, " ").trim();

const programAliases = new Map(Object.entries(programFieldNames)
  .flatMap(([label, names]) => names.map(name => [programKey(name), label])));
const programLetters = { a: "[aáàâäã]", e: "[eéèêë]", i: "[iíìîï]", o: "[oóòôöõ]", u: "[uúùûü]", n: "[nñ]", c: "[cç]" };
const programTags = Object.values(programFieldNames).flat()
  .sort((a, b) => b.length - a.length)
  .map(name => [...name].map(letter => programLetters[letter] || { " ": "\\s+", ".": "\\.?" }[letter] || letter).join(""))
  .join("|");
const programMetadata = new RegExp("(?:^|[\\s|•;])(" + programTags + ")\\s*:\\s*", "giu");
const programFlag = /(?:^|\s)((?:(?:SUB\.|AUD\.|LS\.|HBBTV|SUBTITULADO|SUBTITULAT|AUDIODESCRITO|AUDIODESCRIT|SIGNADO|SIGNAT)\s*)+)$/iu;
const plotStart = /\s+(?=(?:(?:El|La|Els|Les|Los|Las|Un|Una|Uns|Unes|Dos|Dues|Amb|En|Al|The|Two)\s+\p{Ll}|(?:Cuando|Quan|Tras|Després|When|After)\s+\p{L}|(?:EL|LA|ELS|LES|LOS|LAS|UN|UNA|DOS|DUES|CUANDO|QUAN|TRAS)\s+\p{Lu}).{15,}$)/u;

function describeProgram(event) {
  const description = (event?.description || "").normalize("NFC");
  const values = new Map();
  const paragraphs = [];
  const seen = new Set();
  const accessibility = new Set();
  const title = programKey(event?.title || "");
  const markers = [...description.matchAll(programMetadata)];
  const isHeading = text => {
    const candidate = programKey(text);
    return !candidate || (candidate.length <= 110 &&
      (title.endsWith(candidate) || candidate === title ||
       candidate.split(" ").every(word => title.split(" ").includes(word))));
  };

  function addPlot(text) {
    for (const part of text.split(/[|•\n]+/u)) {
      const paragraph = part.trim().replace(/^[;]+|[;]+$/gu, "").trim();
      const key = programKey(paragraph);
      if (!key || isHeading(paragraph) || seen.has(key)) continue;
      if (/^(?:subtitulado|subtitulat|audiodescrito|audiodescrit|signado|signat|hbbtv)(?:\s+(?:subtitulado|subtitulat|audiodescrito|audiodescrit|signado|signat|hbbtv))*$/u.test(key)) {
        addFlags(key);
        continue;
      }
      if (/^(?:todos los publicos|tots els publics|all audiences)$/u.test(key)) {
        values.set("Clasificación", "Todos los públicos");
        continue;
      }
      seen.add(key);
      // Break up long descriptions only at sentence boundaries.
      const sentences = paragraph.split(/(?<=[.!?])\s+(?=[¿¡“"']?\p{Lu}\p{Ll})/u);
      let block = "";
      for (const sentence of sentences) {
        block += (block ? " " : "") + sentence;
        if (block.length >= 280) {
          paragraphs.push(block);
          block = "";
        }
      }
      if (block) paragraphs.push(block);
    }
  }

  function addFlags(flags) {
    const flag = programKey(flags);
    if (/\bsub(?:titula\w*)?\b/u.test(flag)) accessibility.add("Subtítulos");
    if (/\baud(?:iodescri\w*)?\b/u.test(flag)) accessibility.add("Audiodescripción");
    if (/\b(?:ls|signa\w*)\b/u.test(flag)) accessibility.add("Lengua de signos");
  }

  if (!markers.length) addPlot(description);
  else addPlot(description.slice(0, markers[0].index));

  markers.forEach((marker, index) => {
    const label = programAliases.get(programKey(marker[1]));
    const body = description.slice(marker.index + marker[0].length, markers[index + 1]?.index);
    if (label === "Sinopsis") {
      addPlot(body);
      return;
    }
    const [first, ...remaining] = body.split(/[|•\n]+/u);
    let value = first.trim();
    let tail = "";
    const flags = programFlag.exec(value);
    if (flags) {
      addFlags(flags[1]);
      value = value.slice(0, flags.index).trimEnd();
    }
    const typed = label === "Año" ? /^(?:18|19|20)\d{2}\b/u
      : label === "Duración" ? /^\d{1,3}(?:\s*(?:minutos?|minutes?|mins?\.?)(?!\p{L}))?/iu
      : label === "Clasificación" ? /^(?:\+?\d{1,2}\+?|(?:no\s+(?:recomanat|recomendad[oa])\s+(?:per\s+a|para)\s+(?:menors|menores)\s+de\s+\d+\s+(?:anys|años))|(?:tots els públics|todos los públicos|all audiences|TP))(?=\s|[.,;]|$)/iu : null;
    const matched = typed?.exec(value);
    if (matched) {
      tail = value.slice(matched[0].length).replace(/^[\s.,;]+/u, "");
      value = matched[0];
    } else if (["Reparto", "País", "Dirección", "Guion", "Producción", "Fotografía", "Presentación"].includes(label)) {
      const split = value.search(plotStart);
      if (split !== -1) {
        tail = value.slice(split).trim();
        value = value.slice(0, split).trimEnd();
      }
    }
    if (label === "Duración" && /^\d{1,3}$/u.test(value)) value += marker[1].toLowerCase().includes("aprox") ? " min aprox." : " min";
    if (label === "Clasificación") {
      const age = value.match(/\d+/u)?.[0];
      if (age) value = age + "+";
      else if (/^(?:tp|tots els publicos?|todos los publicos|all audiences)$/u.test(programKey(value))) value = "Todos los públicos";
    }
    if (value && !values.has(label)) values.set(label, value);
    if (tail) addPlot(tail);
    for (const part of remaining) {
      const plot = values.has("Título original") && values.has("Duración") ? part.trimStart().replace(/^Pa(?:\s+|$)/u, "") : part;
      addPlot(plot);
    }
  });
  if (!values.has("Clasificación") && event?.age) values.set("Clasificación", event.age + "+");
  if (accessibility.size) values.set("Accesibilidad", [...accessibility].join(" · "));
  const inlineFilm = markers.some(marker => programAliases.get(programKey(marker[1])) === "Sinopsis") &&
    values.has("Título original") && values.has("Duración") && !values.has("Episodio") && !values.has("Temporada");
  return { paragraphs, values, inlineFilm };
}

function renderProgramFacts(list, facts) {
  list.replaceChildren(...facts.filter(([, value]) => value).map(([label, value]) => {
    const fact = document.createElement("div");
    if (label === "Reparto") fact.className = "program-cast";
    const term = document.createElement("dt");
    const description = document.createElement("dd");
    term.textContent = arkhamLanguage.t(label);
    description.textContent = label === "Accesibilidad"
      ? value.split(" · ").map(arkhamLanguage.t).join(" · ")
      : arkhamLanguage.t(value);
    fact.append(term, description);
    return fact;
  }));
  list.hidden = !list.childElementCount;
}

function renderProgramSynopsis(container, paragraphs, fallback) {
  container.replaceChildren(...(paragraphs.length ? paragraphs : [fallback]).map((text) => {
    const paragraph = document.createElement("p");
    paragraph.textContent = paragraphs.length ? text : arkhamLanguage.t(text);
    return paragraph;
  }));
}

function createProgramInfo({ api }) {
  const el = (id) => document.getElementById(id);
  const clock = new Intl.DateTimeFormat(arkhamLanguage.locale, { hour: "2-digit", minute: "2-digit" });
  const genres = ["", "Cine y ficción", "Información", "Entretenimiento", "Deportes",
    "Infantil y juvenil", "Música", "Cultura", "Sociedad", "Educación y ciencia",
    "Estilo de vida", "Especial"];
  const filmPrefix = /^(?:(?:multi)?cine(?:\s+[^:–—-]{1,35})?|pel[ií]cula)\s*[:–—-]\s*/iu;
  const panel = el("program");
  const search = el("program-movie-search");
  const titleInput = search.elements.namedItem("title");
  const yearInput = search.elements.namedItem("year");
  const imdb = el("program-imdb");
  const matches = el("program-matches");
  const result = el("program-film-result");
  const message = el("program-movie-message");
  const keyForm = el("movie-key-form");
  const keyInput = el("movie-key");
  const removeKey = el("movie-key-remove");
  const keyStatus = el("movie-key-status");
  let displayedProgram;
  let configured;
  let lookup = 0;
  let saving = false;
  let film = null;
  let lookupStarted = false;

  if (!window.arkhamNative && !window.arkhamLinux) {
    imdb.target = el("movie-key-link").target = "_blank";
  }

  function node(tag, label) {
    const element = document.createElement(tag);
    element.textContent = label;
    return element;
  }

  function setText(id, label) {
    const element = el(id);
    if (element.textContent !== label) element.textContent = label;
  }

  function setMessage(label = "") {
    message.textContent = label;
    message.hidden = !label;
  }

  function clearLookup() {
    lookup += 1;
    matches.replaceChildren();
    result.replaceChildren();
    matches.hidden = result.hidden = true;
    setMessage();
  }

  function configure(available) {
    if (available === configured) return;
    configured = available;
    search.hidden = !available;
    el("program-movie-setup").hidden = available;
    removeKey.hidden = !available;
    keyStatus.textContent = available ? arkhamLanguage.t("Clave guardada en este equipo.") : "";
    if (!available) {
      lookupStarted = false;
      clearLookup();
    }
  }

  function setImdb(title, identifier) {
    imdb.href = identifier ? "https://www.imdb.com/title/" + identifier + "/"
      : "https://www.imdb.com/find/?" + new URLSearchParams({ q: title, s: "tt", tt: "ft" });
    imdb.querySelector("span").textContent = identifier ? arkhamLanguage.t("Ver en IMDb") : arkhamLanguage.t("Buscar en IMDb");
  }

  function renderProgram(event, channel) {
    setText("program-kicker", event ? arkhamLanguage.t("AHORA EN EMISIÓN") : arkhamLanguage.t("GUÍA DE LA TDT"));
    setText("program-title", event?.title || arkhamLanguage.t("Información de la emisión"));
    const duration = event ? Math.ceil((event.end - event.start) / 60) : 0;
    const { paragraphs, values, inlineFilm } = describeProgram(event);
    renderProgramSynopsis(el("program-synopsis"), paragraphs, event ? arkhamLanguage.t("La emisora no ha publicado una sinopsis.")
      : channel ? arkhamLanguage.t("La programación de este canal aún no está disponible.")
        : arkhamLanguage.t("Sintoniza un canal para ver su programación."));
    renderProgramFacts(el("program-facts"), [
      [arkhamLanguage.t("Canal"), channel?.name],
      [arkhamLanguage.t("Duración"), values.get("Duración") || (duration > 0 ? duration + " min" : "")],
      [arkhamLanguage.t("Género"), values.get("Género") || arkhamLanguage.t(genres[event?.content])],
      [arkhamLanguage.t("Clasificación"), values.get("Clasificación")],
    ]);
    const credits = el("program-credits");
    const originalTitle = values.get("Título original");
    renderProgramFacts(credits, ["Título original", "Año", "País", "Temporada", "Episodio", "Dirección",
      "Guion", "Producción", "Fotografía", "Presentación", "Accesibilidad", "Reparto"]
      .map((label) => [label, values.get(label)]));
    el("program-technical").hidden = credits.hidden;
    const hasTime = duration > 0;
    el("program-clock").hidden = el("program-timing").hidden = !hasTime;
    if (hasTime) setText("program-clock", clock.format(event.start * 1000) + " – " + clock.format(event.end * 1000));

    const isFilm = Boolean(event && (inlineFilm || filmPrefix.test(event.title)
      || (event.content === 1 && !/\b(?:serie|episodio|temporada|cap[ií]tulo)\b/iu.test(paragraphs.join(" ")))));
    el("program-movie").hidden = !isFilm;
    let nextFilm = null;
    if (isFilm) {
      const yearSuffix = /\s*\(((?:18|19|20)\d{2})\)$/u;
      const broadcastTitle = event.title.replace(filmPrefix, "").trim();
      const rawTitle = originalTitle || broadcastTitle;
      const title = rawTitle.replace(yearSuffix, "").trim() || event.title;
      const year = values.get("Año") || (rawTitle.match(yearSuffix) || broadcastTitle.match(yearSuffix))?.[1] || "";
      nextFilm = { id: JSON.stringify([channel?.id, event.id, title, year]), title, year };
    }
    if (film?.id !== nextFilm?.id) {
      film = nextFilm;
      lookupStarted = false;
      clearLookup();
      if (film) {
        titleInput.value = film.title;
        yearInput.value = film.year;
        setImdb(film.title);
      }
    }
  }

  function render(state) {
    if (!saving) configure(Boolean(state.moviesConfigured));
    const channelId = state.stream?.channel;
    const event = state.program;
    const key = JSON.stringify([channelId, event]);
    if (displayedProgram !== key) {
      displayedProgram = key;
      renderProgram(event, state.channels.find((channel) => channel.id === channelId));
    }
    if (event && event.end > event.start) {
      const now = Date.now() / 1000;
      el("program-progress").value = Math.min(100, Math.max(0, (now - event.start) * 100 / (event.end - event.start)));
      const remaining = Math.max(0, Math.ceil((event.end - now) / 60));
      setText("program-remaining", remaining
        ? arkhamLanguage.f("{remaining} min restantes", "{remaining} min left", { remaining }) : arkhamLanguage.t("Finalizando"));
    }
    lookupWhenOpen();
  }

  function lookupWhenOpen() {
    if (!configured || !film || lookupStarted || !panel.open || panel.closest("[hidden]")) return;
    findMovies(film.title, film.year);
  }

  panel.addEventListener("toggle", lookupWhenOpen);
  search.addEventListener("submit", (event) => {
    event.preventDefault();
    findMovies(titleInput.value.trim(), yearInput.value.trim());
  });

  async function findMovies(title, year) {
    if (!title) return;
    lookupStarted = true;
    clearLookup();
    setImdb(title);
    const request = lookup;
    setMessage(arkhamLanguage.t("Buscando películas en OMDb…"));
    try {
      const response = await api("movie-search", { title, year });
      if (request !== lookup) return;
      const normalize = (value) => value.normalize("NFD").toLocaleLowerCase("es")
        .replace(/\p{M}/gu, "").replace(/[^\p{L}\p{N}]+/gu, " ").trim();
      const exact = response.matches.filter((match) => normalize(match.title) === normalize(title)
        && (!year || match.year === year));
      if (exact.length === 1) {
        await selectMovie(exact[0], title);
        return;
      }
      setMessage(response.matches.length ? arkhamLanguage.t("Selecciona la película que coincide con la emisión.")
        : arkhamLanguage.t("OMDb no encuentra el título. Prueba con el título original o deja el año vacío."));
      for (const match of response.matches) {
        const item = document.createElement("li");
        const button = node("button", [match.title, match.year].filter(Boolean).join(" · "));
        button.type = "button";
        button.className = "button secondary";
        button.addEventListener("click", () => selectMovie(match, title));
        item.append(button);
        matches.append(item);
      }
      matches.hidden = !matches.childElementCount;
    } catch (error) {
      if (request === lookup) setMessage(error.message);
    }
  }

  async function selectMovie(match, searchTitle) {
    const request = ++lookup;
    result.replaceChildren();
    result.hidden = true;
    setImdb(searchTitle);
    setMessage(arkhamLanguage.t("Cargando ficha de la película…"));
    try {
      const { movie } = await api("movie-details", { id: match.id });
      if (request !== lookup) return;
      const heading = node("h2", [movie.title || match.title, movie.year].filter(Boolean).join(" · "));
      if (movie.rating) {
        const rating = node("span", "IMDb " + movie.rating + "/10");
        rating.className = "film-rating";
        heading.append(rating);
      }
      result.append(heading);
      for (const line of [[movie.genre, movie.runtime].filter(Boolean).join(" · "),
        movie.director && arkhamLanguage.t("Dirección") + " · " + movie.director,
        movie.cast && arkhamLanguage.t("Reparto") + " · " + movie.cast, arkhamLanguage.t("Datos de OMDb")]) {
        if (line) result.append(node("p", line));
      }
      setImdb("", movie.id);
      result.hidden = false;
      setMessage(arkhamLanguage.t("Ficha disponible. Puedes abrir la película en IMDb."));
    } catch (error) {
      if (request === lookup) setMessage(error.message);
    }
  }

  async function updateKey(key) {
    saving = true;
    const submit = keyForm.querySelector("[type=submit]");
    submit.disabled = removeKey.disabled = true;
    if (key) keyStatus.textContent = arkhamLanguage.t("Verificando la clave en OMDb…");
    try {
      await api("movie-key", { key });
      configure(Boolean(key));
      lookupStarted = false;
      clearLookup();
      keyInput.value = "";
      keyStatus.textContent = key ? arkhamLanguage.t("Clave verificada y guardada en este equipo.") : arkhamLanguage.t("Clave eliminada.");
    } catch (error) {
      keyStatus.textContent = error.message;
    } finally {
      submit.disabled = removeKey.disabled = false;
      saving = false;
    }
  }

  keyForm.addEventListener("submit", (event) => {
    event.preventDefault();
    const key = keyInput.value.trim();
    if (key && !saving) updateKey(key);
  });
  removeKey.addEventListener("click", () => {
    if (!saving) updateKey("");
  });
  return { render };
}
