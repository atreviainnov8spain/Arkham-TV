/* Solsticio en Arkham: static artwork outside all playback surfaces. */
(() => {
  "use strict";
  const root = document.documentElement;
  const rail = document.querySelector(".rail");
  const brand = document.querySelector(".brand");
  const secondary = document.querySelector(".nav-secondary");
  const topbar = document.querySelector(".topbar");
  if (!rail || !brand || !secondary || !topbar) return;

  const garland = "/seasonal/garland.png";
  const emblem = "/seasonal/emblem.png";
  const tree = "/seasonal/tree.png";
  let artwork = [], observer = null, timer = null;

  function add(parent, kind, source) {
    const node = document.createElement("span");
    node.className = "season-art season-" + kind;
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("inert", "");
    const image = document.createElement("img");
    image.alt = "";
    image.draggable = false;
    image.decoding = "async";
    if (kind === "emblem") {
      image.addEventListener("load", () => { if (artwork.includes(node)) root.classList.add("season-emblem-ready"); });
      image.addEventListener("error", () => root.classList.remove("season-emblem-ready"));
    }
    image.src = source;
    node.append(image);
    parent.append(node);
    artwork.push(node);
  }
  function fitTree() {
    const previous = secondary.previousElementSibling;
    const space = previous ? secondary.getBoundingClientRect().top - previous.getBoundingClientRect().bottom : 0;
    // Absolute artwork never consumes space or pushes the existing navigation.
    root.classList.toggle("season-tree-room", space >= 184);
  }
  function refresh() {
    clearTimeout(timer);
    const now = new Date(), month = now.getMonth(), day = now.getDate();
    const active = (month === 10 && day >= 20) || month === 11 || (month === 0 && day <= 8);
    if (active && !artwork.length) {
      add(rail, "rail-garland", garland);
      add(brand, "emblem", emblem);
      add(topbar, "corner", garland);
      add(secondary, "tree", tree);
      observer = new ResizeObserver(fitTree);
      [rail, secondary, secondary.parentElement].forEach(node => observer.observe(node));
    } else if (!active && artwork.length) {
      observer.disconnect(); observer = null;
      artwork.forEach(node => node.remove()); artwork = [];
      root.classList.remove("season-tree-room", "season-emblem-ready");
    }
    root.classList.toggle("season-solstice", active);
    if (active) fitTree();
    // Local calendar, including year boundaries and DST. No polling or animation.
    if (!document.hidden) {
      const midnight = new Date(now.getFullYear(), month, day + 1);
      timer = setTimeout(refresh, Math.max(1, midnight.getTime() - now.getTime() + 100));
    }
  }
  document.addEventListener("visibilitychange", refresh);
  window.addEventListener("pageshow", refresh);
  window.addEventListener("focus", refresh);
  refresh();
})();
