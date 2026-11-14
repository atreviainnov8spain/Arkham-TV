"use strict";

function createPictureControls(video) {
  if (!window.arkhamPicture) return;

  const panel = document.getElementById("live-picture");
  const modes = [...panel.querySelectorAll("[data-picture-mode]")];
  const sliders = panel.querySelector(".picture-sliders");
  const controls = [...sliders.querySelectorAll("input")];
  const save = panel.querySelector(".picture-save");
  const feedback = panel.querySelector(".picture-feedback");
  const description = document.getElementById("picture-description");
  const renderPicture = createPictureRenderer(video, document.getElementById("picture-output"));
  const key = "arkhamtv.picture";
  const presets = {
    standard: { values: [50, 50, 0, 50], description: "Reproduce la imagen capturada sin ajustes de imagen." },
    movie: { values: [46, 54, 0, 48], description: "Tonos cálidos y una curva de luz pensada para ver cine con poca luz." },
    filmmaker: { values: [50, 50, 0, 50], description: "Imagen y cadencia de la emisión, sin realce añadido ni interpolación de movimiento." },
    vivid: { values: [70, 63, 25, 78], description: "Más brillo y saturación para una imagen más intensa." },
    personal: { description: "Ajusta la imagen a tu gusto y guarda tus valores." },
  };

  let mode = "standard";
  let saved = null;
  try {
    const settings = JSON.parse(localStorage.getItem(key));
    if (settings && Object.hasOwn(presets, settings.mode)) mode = settings.mode;
    if (Array.isArray(settings?.personal) && settings.personal.length === controls.length &&
        settings.personal.every(value => Number.isInteger(value) && value >= 0 && value <= 100)) {
      saved = settings.personal;
    }
  } catch {
    // The controls are still available if storage is disabled.
  }
  function remember() {
    localStorage.setItem(key, JSON.stringify({ mode, personal: saved }));
  }

  function apply() {
    const [brightness, contrast, sharpness, color] = controls.map(input => input.valueAsNumber);
    renderPicture({
      brightness: 1 + (brightness - 50) / 75,
      contrast: 1 + (contrast - 50) / 75,
      saturation: color / 50,
      sharpness: sharpness / 130,
      movie: mode === "movie",
    });
    for (const input of controls) input.previousElementSibling.value = input.value;
  }

  function select(nextMode) {
    mode = nextMode;
    const editing = mode === "personal";
    sliders.disabled = !editing;
    save.hidden = !editing;
    feedback.textContent = "";
    description.textContent = arkhamLanguage.t(presets[mode].description);
    modes.forEach(button => button.setAttribute("aria-pressed", String(button.dataset.pictureMode === mode)));
    const values = editing ? saved || presets.standard.values : presets[mode].values;
    controls.forEach((input, index) => { input.value = values[index]; });
    apply();
  }

  for (const button of modes) {
    button.addEventListener("click", () => {
      select(button.dataset.pictureMode);
      try { remember(); }
      catch { /* The current mode still applies in this window. */ }
    });
  }
  for (const input of controls) {
    input.addEventListener("input", () => {
      if (mode !== "personal") return;
      feedback.textContent = "";
      apply();
    });
  }
  save.addEventListener("click", () => {
    if (mode !== "personal") return;
    const previous = saved;
    saved = controls.map(input => input.valueAsNumber);
    try {
      remember();
      feedback.textContent = arkhamLanguage.t(previous ? "Ajuste personal reemplazado." : "Ajuste personal guardado.");
    } catch {
      saved = previous;
      feedback.textContent = arkhamLanguage.t("No se pudo guardar el ajuste personal.");
    }
  });
  select(mode);
  panel.closest("#live-layout").classList.add("has-picture-controls");
  panel.hidden = false;
}

function createPictureRenderer(video, canvas) {
  if (window.arkhamLinux) return createLinuxPictureRenderer(video, canvas);

  let settings;
  let renderer;
  let frame = null;
  let processed = false;
  let lastPaintTime = -Infinity;
  let lastMediaTime = -1;
  let frameInterval = 1000 / 30;
  const useVideoFrames = typeof video.requestVideoFrameCallback === "function";

  function cancelFrame() {
    if (frame === null) return;
    if (useVideoFrames) video.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
    frame = null;
  }

  function fallback() {
    canvas.hidden = true;
    const { brightness, contrast, saturation, movie } = settings;
    video.style.filter = `brightness(${brightness}) contrast(${contrast}) saturate(${saturation})${movie ? " sepia(.12)" : ""}`;
  }

  function repaint() {
    if (!processed || !renderer || video.hidden || video.readyState < 2 || !video.videoWidth) return;
    try {
      const started = performance.now();
      renderer(video, settings);
      lastPaintTime = performance.now();
      lastMediaTime = video.currentTime;
      frameInterval = Math.max(1000 / 30, 2 * (lastPaintTime - started));
      canvas.hidden = false;
    } catch (error) {
      console.warn("Picture processing:", error);
      renderer = null;
      fallback();
    }
  }

  function schedule() {
    if (!processed || !renderer || frame !== null || video.paused || video.ended) return;
    const next = now => {
      frame = null;
      if (useVideoFrames || (now - lastPaintTime >= frameInterval && video.currentTime !== lastMediaTime)) repaint();
      schedule();
    };
    frame = useVideoFrames ? video.requestVideoFrameCallback(next) : requestAnimationFrame(next);
  }

  for (const event of ["loadeddata", "seeked", "playing", "resize"]) {
    video.addEventListener(event, () => {
      repaint();
      schedule();
    });
  }
  for (const event of ["pause", "ended"]) video.addEventListener(event, cancelFrame);
  video.addEventListener("emptied", () => {
    cancelFrame();
    lastMediaTime = -1;
    canvas.hidden = true;
  });
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    cancelFrame();
    renderer = null;
    if (processed) fallback();
  });
  canvas.addEventListener("webglcontextrestored", () => update(settings));

  function update(next) {
    settings = next;
    processed = next.movie || next.sharpness > 0 ||
      next.brightness !== 1 || next.contrast !== 1 || next.saturation !== 1;
    video.style.filter = "";
    if (!processed) {
      cancelFrame();
      canvas.hidden = true;
      return;
    }
    if (renderer === undefined) renderer = pictureShader(canvas);
    if (!renderer) {
      fallback();
      return;
    }
    repaint();
    schedule();
  }
  return update;
}

function createLinuxPictureRenderer(video, canvas) {
  const namespace = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(namespace, "svg");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "0");
  svg.setAttribute("height", "0");
  const filter = document.createElementNS(namespace, "filter");
  filter.id = "linux-picture-filter";
  filter.setAttribute("color-interpolation-filters", "sRGB");
  const sharpen = document.createElementNS(namespace, "feConvolveMatrix");
  sharpen.setAttribute("order", "3");
  sharpen.setAttribute("divisor", "1");
  sharpen.setAttribute("preserveAlpha", "true");
  const tones = document.createElementNS(namespace, "feComponentTransfer");
  for (const [channel, exponent] of [["R", 1.12], ["G", 1.13], ["B", 1.16]]) {
    const curve = document.createElementNS(namespace, "feFunc" + channel);
    curve.setAttribute("type", "gamma");
    curve.setAttribute("amplitude", "1");
    curve.setAttribute("exponent", String(exponent));
    tones.append(curve);
  }
  svg.append(filter);
  document.body.append(svg);

  const surface = document.createElement("div");
  surface.className = "linux-picture-surface";
  video.before(surface);
  surface.append(video);
  const fullscreen = window.arkhamParallels && createFullscreenPictureRenderer(video, canvas, surface);

  // Filter the layer around the video so the compositor includes the video surface.
  return ({ brightness, contrast, saturation, sharpness, movie }) => {
    const effects = [];
    if (sharpness > 0) {
      const edge = -sharpness / 4;
      sharpen.setAttribute("kernelMatrix", `0 ${edge} 0 ${edge} ${1 + sharpness} ${edge} 0 ${edge} 0`);
      filter.replaceChildren(sharpen);
      effects.push("url(#linux-picture-filter)");
    } else {
      filter.replaceChildren();
    }
    if (contrast !== 1) effects.push(`contrast(${contrast})`);
    if (brightness !== 1) effects.push(`brightness(${brightness})`);
    if (saturation !== 1) effects.push(`saturate(${saturation})`);
    if (movie) {
      filter.replaceChildren(tones);
      effects.push("url(#linux-picture-filter)");
    }
    if (fullscreen) {
      fullscreen({ brightness, contrast, saturation, sharpness, movie }, effects.join(" "));
    } else {
      surface.classList.toggle("has-picture-filter", effects.length > 0);
      surface.style.filter = effects.join(" ");
    }
  };
}

function createFullscreenPictureRenderer(video, canvas, surface) {
  const paint = pictureCanvas(canvas, 960, 540);
  if (!paint) return null;
  const screen = surface.parentElement;
  let settings, filter = "", frame = null;
  let lastFrame = -1;
  let lastTime = -1;

  function draw() {
    if (video.hidden || video.readyState < 2 || !video.videoWidth) return;
    const frames = video.getVideoPlaybackQuality?.().totalVideoFrames ?? 0;
    if (!canvas.hidden && frames === lastFrame && video.currentTime - lastTime <= .06) return;
    paint(video, settings);
    lastFrame = frames;
    lastTime = video.currentTime;
    canvas.hidden = false;
    video.style.opacity = "0";
  }

  function stop() {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function schedule() {
    if (frame !== null || video.paused || video.ended) return;
    frame = requestAnimationFrame(() => {
      frame = null;
      draw();
      schedule();
    });
  }

  function sync() {
    const expanded = document.fullscreenElement === screen || screen.classList.contains("monitor-expanded");
    const processing = expanded && Boolean(filter);
    surface.classList.toggle("has-picture-filter", !processing && Boolean(filter));
    surface.style.filter = processing ? "" : filter;
    if (processing && !video.hidden) {
      draw();
      schedule();
    } else {
      stop();
      canvas.hidden = true;
      video.style.opacity = "";
    }
  }

  document.addEventListener("fullscreenchange", sync);
  const observe = new MutationObserver(sync);
  observe.observe(screen, { attributes: true, attributeFilter: ["class"] });
  observe.observe(video, { attributes: true, attributeFilter: ["hidden"] });
  for (const event of ["loadeddata", "playing", "seeked"]) video.addEventListener(event, sync);
  for (const event of ["pause", "ended"]) video.addEventListener(event, stop);
  video.addEventListener("emptied", () => {
    stop();
    canvas.hidden = true;
    video.style.opacity = "";
    lastFrame = -1;
    lastTime = -1;
  });

  return (picture, effects) => {
    settings = picture;
    filter = effects;
    lastFrame = -1;
    sync();
  };
}

function pictureCanvas(canvas, maxWidth, maxHeight) {
  // Read the decoded frame through Canvas 2D. Some WebKitGTK video sinks
  // cannot share their texture with WebGL.
  const context = canvas.getContext("2d", { alpha: false, willReadFrequently: true });
  if (!context) return null;
  let source;
  const movieCurve = [
    Uint8ClampedArray.from({ length: 256 }, (_, value) => 255 * (value / 255) ** 1.12),
    Uint8ClampedArray.from({ length: 256 }, (_, value) => 255 * (value / 255) ** 1.13),
    Uint8ClampedArray.from({ length: 256 }, (_, value) => 255 * (value / 255) ** 1.16),
  ];
  const rgb = new Uint8ClampedArray(3);
  return (video, { brightness, contrast, saturation, sharpness, movie }) => {
    const scale = Math.min(1, maxWidth / video.videoWidth, maxHeight / video.videoHeight);
    const width = Math.max(1, Math.round(video.videoWidth * scale));
    const height = Math.max(1, Math.round(video.videoHeight * scale));
    const row = width * 4;
    if (canvas.width !== width || canvas.height !== height) {
      canvas.width = width;
      canvas.height = height;
    }
    context.drawImage(video, 0, 0, width, height);
    const frame = context.getImageData(0, 0, width, height);
    const pixels = frame.data;
    if (sharpness) {
      if (source?.length !== pixels.length) source = new Uint8ClampedArray(pixels.length);
      source.set(pixels);
    }
    const gain = contrast * brightness;
    const offset = 127.5 * (1 - contrast) * brightness;
    for (let y = 0; y < height; y++) {
      const above = y ? -row : 0;
      const below = y + 1 < height ? row : 0;
      for (let x = 0; x < width; x++) {
        const pixel = y * row + x * 4;
        const left = x ? -4 : 0;
        const right = x + 1 < width ? 4 : 0;
        let r = pixels[pixel], g = pixels[pixel + 1], b = pixels[pixel + 2];
        if (sharpness) {
          for (let channel = 0; channel < 3; channel++) {
            const index = pixel + channel;
            const neighbors = source[index + above] + source[index + below] +
              source[index + left] + source[index + right];
            pixels[index] = source[index] + sharpness * (source[index] - neighbors / 4);
          }
          r = pixels[pixel];
          g = pixels[pixel + 1];
          b = pixels[pixel + 2];
        }
        const gray = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        rgb[0] = (gray + saturation * (r - gray)) * gain + offset;
        rgb[1] = (gray + saturation * (g - gray)) * gain + offset;
        rgb[2] = (gray + saturation * (b - gray)) * gain + offset;
        for (let channel = 0; channel < 3; channel++) {
          pixels[pixel + channel] = movie ? movieCurve[channel][rgb[channel]] : rgb[channel];
        }
      }
    }
    context.putImageData(frame, 0, 0);
  };
}

function pictureShader(canvas) {
  const gl = canvas.getContext("webgl", { alpha: false, antialias: false, depth: false });
  if (!gl) return null;
  const program = gl.createProgram();

  const shaders = [
    [gl.VERTEX_SHADER, `
      attribute vec2 position;
      varying vec2 uv;
      void main() {
        gl_Position = vec4(position, 0.0, 1.0);
        uv = vec2(position.x * 0.5 + 0.5, 0.5 - position.y * 0.5);
      }
    `],
    [gl.FRAGMENT_SHADER, `
      precision mediump float;
      varying vec2 uv;
      uniform sampler2D source;
      uniform vec2 texel;
      uniform vec4 adjustment;
      uniform bool movie;
      void main() {
        vec3 rgb = texture2D(source, uv).rgb;
        if (adjustment.w > 0.0) {
          vec3 neighbors = texture2D(source, uv + vec2(texel.x, 0.0)).rgb +
            texture2D(source, uv - vec2(texel.x, 0.0)).rgb +
            texture2D(source, uv + vec2(0.0, texel.y)).rgb +
            texture2D(source, uv - vec2(0.0, texel.y)).rgb;
          rgb += adjustment.w * (rgb - 0.25 * neighbors);
        }
        rgb = (rgb - 0.5) * adjustment.y + 0.5;
        rgb *= adjustment.x;
        float gray = dot(rgb, vec3(0.2126, 0.7152, 0.0722));
        rgb = mix(vec3(gray), rgb, adjustment.z);
        if (movie) rgb = pow(clamp(rgb, 0.0, 1.0), vec3(1.12, 1.13, 1.16));
        gl_FragColor = vec4(clamp(rgb, 0.0, 1.0), 1.0);
      }
    `],
  ].map(([type, source]) => {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    gl.attachShader(program, shader);
    return shader;
  });
  gl.linkProgram(program);
  shaders.forEach(shader => gl.deleteShader(shader));
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    console.warn(gl.getProgramInfoLog(program));
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, "position");
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  const maxTexture = gl.getParameter(gl.MAX_TEXTURE_SIZE);
  const texel = gl.getUniformLocation(program, "texel");
  const adjustment = gl.getUniformLocation(program, "adjustment");
  const movie = gl.getUniformLocation(program, "movie");

  return (video, picture) => {
    const width = video.videoWidth, height = video.videoHeight;
    const scale = Math.min(1, 1920 / width, 1080 / height);
    const surfaceWidth = Math.round(width * scale), surfaceHeight = Math.round(height * scale);
    if (canvas.width !== surfaceWidth || canvas.height !== surfaceHeight) {
      canvas.width = surfaceWidth;
      canvas.height = surfaceHeight;
      gl.viewport(0, 0, surfaceWidth, surfaceHeight);
    }
    if (Math.max(width, height) > maxTexture) throw Error("Video exceeds the maximum texture size");
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, video);
    gl.uniform2f(texel, 1 / width, 1 / height);
    gl.uniform4f(adjustment, picture.brightness, picture.contrast, picture.saturation, picture.sharpness);
    gl.uniform1i(movie, picture.movie);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  };
}
