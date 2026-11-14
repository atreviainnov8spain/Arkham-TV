"use strict";

(() => {
  const dialog = byId("mobile-share");
  const trigger = byId("mobile-share-open");
  const qrCanvas = byId("mobile-qr");
  const url = byId("mobile-url");
  const networks = byId("mobile-network");
  const networkField = byId("mobile-network-field");
  const stop = byId("mobile-share-stop");
  const feedback = byId("mobile-share-feedback");
  let session = null;
  let busy = false;

  function render(message = "") {
    const visible = Boolean(session);
    qrCanvas.hidden = url.hidden = stop.hidden = !visible;
    networkField.hidden = !session || session.addresses.length < 2;
    stop.disabled = networks.disabled = busy;
    feedback.textContent = message;
    feedback.hidden = !message;
    if (!session) return;
    url.value = session.url;
    networks.replaceChildren(...session.addresses.map(address => new Option(address, address)));
    networks.value = session.address;
    const code = qrcode(0, "M");
    code.addData(session.url);
    code.make();
    const size = code.getModuleCount();
    const scale = 8;
    const margin = 4;
    qrCanvas.width = qrCanvas.height = (size + margin * 2) * scale;
    const context = qrCanvas.getContext("2d");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, qrCanvas.width, qrCanvas.height);
    context.fillStyle = "#101710";
    for (let row = 0; row < size; row++) {
      for (let col = 0; col < size; col++) {
        if (code.isDark(row, col)) context.fillRect((col + margin) * scale, (row + margin) * scale, scale, scale);
      }
    }
  }

  async function start(address) {
    if (busy) return;
    busy = true;
    render(arkhamLanguage.t("Preparando la conexión local…"));
    let message = "";
    try {
      session = await api("mobile-start", { address, language: arkhamLanguage.language });
      refresh();
    } catch (error) {
      message = error.message;
    } finally {
      busy = false;
      render(message);
    }
  }

  trigger.addEventListener("click", () => {
    dialog.showModal();
    start();
  });
  dialog.addEventListener("click", event => {
    if (event.target === dialog) {
      const bounds = dialog.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right
          || event.clientY < bounds.top || event.clientY > bounds.bottom) dialog.close();
    }
  });
  networks.addEventListener("change", () => start(networks.value));
  url.addEventListener("focus", () => url.select());
  stop.addEventListener("click", async () => {
    if (busy) return;
    busy = true;
    render();
    let message = "";
    try {
      await api("mobile-stop", {});
      session = null;
      dialog.close();
    } catch (error) {
      message = error.message;
    } finally {
      busy = false;
      render(message);
      refresh();
    }
  });
})();
