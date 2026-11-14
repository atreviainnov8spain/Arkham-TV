"use strict";

function groupBroadcastChannels(channels) {
  const frequencies = new Map();
  for (const channel of channels) {
    if (!Number.isFinite(channel.frequency)) continue;
    if (!frequencies.has(channel.frequency)) frequencies.set(channel.frequency, []);
    frequencies.get(channel.frequency).push(channel);
  }
  return [...frequencies].sort(([a], [b]) => a - b).map(([frequency, entries]) => ({
    frequency, uhf: entries[0].uhf, channels: entries,
  }));
}

function createBroadcastChannelPicker(element, selectChannel) {
  const trigger = element.querySelector(".broadcast-channel-trigger");
  const label = trigger.querySelector(".broadcast-channel-name");
  const panel = element.querySelector(".broadcast-channel-options");
  let buttons = [];

  function close(restoreFocus = false) {
    panel.hidden = true;
    trigger.setAttribute("aria-expanded", "false");
    if (restoreFocus) trigger.focus();
  }

  function open() {
    if (trigger.disabled) return;
    panel.hidden = false;
    trigger.setAttribute("aria-expanded", "true");
    const selected = panel.querySelector('[aria-current="true"]') || buttons[0];
    if (!selected) return;
    selected.focus({ preventScroll: true });
    const bounds = panel.getBoundingClientRect();
    const row = selected.getBoundingClientRect();
    if (row.top < bounds.top || row.bottom > bounds.bottom) {
      panel.scrollTop += (row.top + row.bottom - bounds.top - bounds.bottom) / 2;
    }
  }

  trigger.addEventListener("click", () => panel.hidden ? open() : close());
  element.addEventListener("keydown", event => {
    if (event.key === "Escape" && !panel.hidden) {
      event.preventDefault();
      close(true);
      return;
    }
    const arrows = ["ArrowDown", "ArrowUp"];
    if (!(panel.hidden ? arrows : [...arrows, "Home", "End"]).includes(event.key)) return;
    event.preventDefault();
    if (panel.hidden) {
      open();
      return;
    }
    const current = buttons.indexOf(document.activeElement);
    const index = { Home: 0, End: buttons.length - 1, ArrowUp: current - 1, ArrowDown: current + 1 }[event.key];
    buttons[Math.min(buttons.length - 1, Math.max(0, index))]?.focus();
  });
  element.addEventListener("focusout", event => {
    if (event.relatedTarget && !element.contains(event.relatedTarget)) close();
  });
  document.addEventListener("click", event => {
    if (!panel.hidden && !element.contains(event.target)) close();
  });

  return {
    close,
    setGroups(groups) {
      close(!panel.hidden && element.contains(document.activeElement));
      const format = new Intl.NumberFormat(arkhamLanguage.locale);
      panel.replaceChildren(...groups.map(({ frequency, uhf, channels }) => {
        const group = document.createElement("div");
        group.className = "broadcast-channel-group";
        const heading = document.createElement("p");
        heading.id = `${panel.id}-${frequency}`;
        heading.textContent = `UHF ${uhf} · ${format.format(frequency / 1e6)} MHz`;
        group.setAttribute("role", "group");
        group.setAttribute("aria-labelledby", heading.id);
        group.append(heading);
        for (const channel of channels) {
          const button = document.createElement("button");
          button.type = "button";
          button.className = "choice-option";
          button.dataset.channel = channel.id;
          const name = document.createElement("span");
          name.textContent = channel.name;
          const check = document.createElementNS("http://www.w3.org/2000/svg", "svg");
          check.setAttribute("aria-hidden", "true");
          const use = document.createElementNS(check.namespaceURI, "use");
          use.setAttribute("href", "#i-check");
          check.append(use);
          button.append(name, check);
          button.addEventListener("click", () => {
            close(true);
            selectChannel(channel.id);
          });
          group.append(button);
        }
        return group;
      }));
      buttons = [...panel.querySelectorAll("button")];
    },
    update(channel, disabled, placeholder) {
      const selected = buttons.find(button => button.dataset.channel === channel);
      const name = selected?.firstElementChild.textContent || placeholder;
      if (label.textContent !== name) label.textContent = name;
      trigger.disabled = disabled || !buttons.length;
      if (trigger.disabled && !panel.hidden) close();
      for (const button of buttons) {
        if (button === selected) button.setAttribute("aria-current", "true");
        else if (button.hasAttribute("aria-current")) button.removeAttribute("aria-current");
      }
    },
  };
}
