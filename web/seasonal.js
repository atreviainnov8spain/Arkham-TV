/* Solsticio en Arkham: static artwork outside all playback surfaces. */
(() => {
  "use strict";
  const root = document.documentElement;
  const rail = document.querySelector(".rail");
  const brand = document.querySelector(".brand");
  const secondary = document.querySelector(".nav-secondary");
  const topbar = document.querySelector(".topbar");
  if (!rail || !brand || !secondary || !topbar) return;

  const garland = `<svg viewBox="0 0 190 24" xmlns="http://www.w3.org/2000/svg" focusable="false">
    <g class="season-vine"><path d="M-4 7C23-2 28 18 53 10S82 0 108 9s47 3 86-6M3 9l8 6m0-8 5-4m10 9-2 6m9-6 5 5m7-6 4-6m12 2 3 6m11-9 4 5m11-6 3 6m15 0 1 6m12-4 6 5m10-5 4 4m12-6 5 4m12-7 3 5"/>
    <path d="M20 8c5-10 18-5 12 1-4 4-9-2-5-4M67 6c6 10 17 6 13 0-3-3-7 1-4 3M119 11c-1-10 13-13 13-5 0 5-7 5-6 1M156 10c4 9 16 6 12 0-2-3-6 0-4 2"/></g>
    <g class="season-lights"><circle cx="11" cy="8" r="1.8"/><circle cx="48" cy="11" r="1.8"/><circle cx="88" cy="5" r="1.8"/><circle cx="119" cy="11" r="1.8"/><circle cx="160" cy="10" r="1.8"/></g>
    <path class="season-star" d="m178 9 1.4 4.2 4.2 1.4-4.2 1.4-1.4 4.2-1.4-4.2-4.2-1.4 4.2-1.4z"/>
  </svg>`;
  const emblem = `<svg viewBox="0 0 55 68" xmlns="http://www.w3.org/2000/svg" focusable="false">
    <circle class="season-wreath" cx="27.5" cy="40" r="25"/>
    <path class="season-hat" d="M13 17C19 4 35 2 40 7l7 12-7 2-8-10c0 5 5 9 5 9z"/>
    <path class="season-trim" d="M12 16c7-2 18-2 26 3l-2 6c-7-4-17-5-25-2z"/>
    <circle class="season-trim" cx="47" cy="21" r="4"/>
  </svg>`;
  const tree = `<svg viewBox="0 0 108 120" xmlns="http://www.w3.org/2000/svg" focusable="false">
    <path class="season-star" d="m54 3 2.2 7.2 7.3 2.3-7.3 2.2-2.2 7.3-2.3-7.3-7.2-2.2 7.2-2.3z"/>
    <g class="season-tree-vines"><path d="M54 23c-3 12-22 11-18 23 3 8 16 2 10-4-3-3-7 0-4 2M54 24c3 12 20 12 16 23-3 8-14 3-10-3 2-3 6 0 4 2M51 42C42 57 20 50 20 68c0 13 21 10 17-1-2-6-12-3-8 1M57 46c12 8 29 10 29 24 0 13-21 12-20 1 1-7 12-6 10 0M49 63c-9 20-38 14-39 34-1 18 27 15 26 0 0-8-14-9-13 0M58 65c10 16 39 16 40 34 1 17-25 17-26 3-1-9 13-13 14-4M53 80c-3 12-13 17-10 27 3 11 17 9 17-1 0-6-8-7-9-2M56 83c6 8 13 11 10 22"/></g>
    <g class="season-lights"><circle cx="43" cy="34" r="2"/><circle cx="69" cy="57" r="2"/><circle cx="26" cy="81" r="2"/><circle cx="87" cy="89" r="2"/><circle cx="45" cy="94" r="2"/></g>
  </svg>`;
  let artwork = [], observer = null, timer = null;

  function add(parent, kind, svg) {
    const node = document.createElement("span");
    node.className = "season-art season-" + kind;
    node.setAttribute("aria-hidden", "true");
    node.setAttribute("inert", "");
    node.innerHTML = svg;
    parent.append(node);
    artwork.push(node);
  }
  function fitTree() {
    const previous = secondary.previousElementSibling;
    const space = previous ? secondary.getBoundingClientRect().top - previous.getBoundingClientRect().bottom : 0;
    // Absolute artwork never consumes space or pushes the existing navigation.
    root.classList.toggle("season-tree-room", space >= 144);
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
      root.classList.remove("season-tree-room");
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
