"use strict";

const appearanceChoices = {
  mode: ["oscuro", "claro", "sistema"],
  palette: ["lima", "oceano", "lavanda", "terracota"],
};
const appearanceRoot = document.documentElement;
const appearanceKey = "arkhamtv.appearance";
const preferredLightMode = window.matchMedia("(prefers-color-scheme: light)");

function applyEffectiveMode() {
  const { mode } = appearanceRoot.dataset;
  appearanceRoot.dataset.effectiveMode = mode === "sistema"
    ? (preferredLightMode.matches ? "claro" : "oscuro") : mode;
}

try {
  const saved = JSON.parse(localStorage.getItem(appearanceKey) || "{}");
  for (const [key, choices] of Object.entries(appearanceChoices)) {
    if (choices.includes(saved?.[key])) appearanceRoot.dataset[key] = saved[key];
  }
} catch {
  // Private browser sessions may disable storage.
}

applyEffectiveMode();
preferredLightMode.addEventListener("change", applyEffectiveMode);

document.addEventListener("DOMContentLoaded", () => {
  const menu = document.getElementById("appearance");
  const form = document.getElementById("appearance-form");
  for (const key of Object.keys(appearanceChoices)) {
    form.elements[key].value = appearanceRoot.dataset[key];
  }
  form.addEventListener("change", (event) => {
    const { name, value } = event.target;
    if (!appearanceChoices[name]?.includes(value)) return;
    appearanceRoot.dataset[name] = value;
    applyEffectiveMode();
    try {
      const { mode, palette } = appearanceRoot.dataset;
      localStorage.setItem(appearanceKey, JSON.stringify({ mode, palette }));
    } catch {
      // The current theme still works for this session.
    }
  });
  document.addEventListener("click", (event) => {
    if (menu.open && !menu.contains(event.target)) menu.open = false;
  });
  menu.addEventListener("keydown", (event) => {
    if (event.key === "Escape" && menu.open) {
      menu.open = false;
      menu.querySelector("summary").focus();
    }
  });
});
