"use strict";

const arkhamLanguage = (() => {
  const key = "arkhamtv.language";
  let language = "es";
  try {
    language = localStorage.getItem(key) === "en" ? "en" : "es";
  } catch { /* Spanish is the default when storage is unavailable. */ }
  const translations = Object.create(null);
  for (const entry of `
Arkham TV · TDT en directo|Arkham TV · Live terrestrial TV
Arkham TV, en directo|Arkham TV, live
Navegación|Navigation
En directo|Live
Guía TV|TV Guide
Canales|Channels
Ecualizador|Equalizer
Sintonizador|Tuner
Grabaciones|Recordings
Configuración|Settings
Televisión local|Local television
Antena DVB-T|DVB-T antenna
Buscar por nombre de canal|Search by channel name
Buscar un canal…|Search for a channel…
Conectando|Connecting
Apariencia|Appearance
Modo|Mode
Oscuro|Dark
Claro|Light
Sistema|System
Paleta de color|Colour palette
Lima|Lime
Océano|Ocean
Lavanda|Lavender
Terracota|Terracotta
Idioma|Language
Idioma:|Language:
Idioma de la interfaz|Interface language
TU TELEVISIÓN POR ANTENA|YOUR TERRESTRIAL TV
Hora local|Local time
Reproductor|Player
Televisión en directo|Live television
Preparando la emisión|Preparing the stream
Estamos conectando con tu antena.|Connecting to your antenna.
CONECTANDO|CONNECTING
Volver a la ventana principal|Return to the main window
Pantalla completa (F)|Full screen (F)
Pantalla completa|Full screen
Salir de pantalla completa|Exit full screen
Reproducir|Play
Pausar|Pause
Volumen|Volume
Silenciar|Mute
Sin información del programa|No programme information
Espectro de audio de diez bandas|Ten-band audio spectrum
Señal de antena · TDT|Antenna signal · DVB-T
Activar sonido|Unmute
Detener emisión|Stop playback
Graba desde ahora y se detiene al cambiar de canal|Record from now and stop when changing channel
Grabar|Record
Cerrar|Close
Audio de la emisión|Broadcast audio
Elegir pista de audio|Choose audio track
Pistas de audio no disponibles|Audio tracks unavailable
Pista de audio|Audio track
Audio principal|Main audio
Versión original|Original version
Solo efectos|Effects only
Audio limpio|Clean audio
Audiodescripción|Audio description
Subtítulos hablados|Spoken subtitles
Principal|Main
En reproducción|Playing
REPRODUCTOR|PLAYER
Aplicar|Apply
Programar|Schedule
Calidad de vídeo|Video quality
Máxima exigencia|Most demanding
Recomendada|Recommended
Menor carga|Lower processor load
La más ligera|Lightest
Una resolución superior a la de la emisión ocupa más espacio, sin añadir detalle.|A higher resolution than the broadcast uses more storage without adding detail.
Las pistas aún no se han detectado. Puedes sintonizar el canal para ver qué idiomas ofrece.|Audio tracks haven’t been detected yet. Tune to the channel to see which languages it offers.
La emisión ha cambiado. Vuelve a elegir el audio.|The broadcast has changed. Choose the audio again.
La emisión ha cambiado. Vuelve a elegir qué grabar.|The broadcast has changed. Choose what to record again.
Esa pista de audio ya no está disponible.|That audio track is no longer available.
La pista elegida no se emite en este momento.|The selected audio track is not being broadcast right now.
No se pudo comprobar la pista de audio. Revisa la señal de antena.|Could not verify the audio track. Check the antenna signal.
Selecciona un canal o un programa de la guía.|Select a channel or a programme from the guide.
Elige una calidad de grabación válida.|Choose a valid recording quality.
Tiempo de grabación|Recording time
GUÍA DE LA TDT|TERRESTRIAL TV GUIDE
Información de la emisión|Programme information
Progreso del programa|Programme progress
Sinopsis|Synopsis
Sintoniza un canal para ver su programación.|Tune to a channel to see its schedule.
Datos de la emisión|Broadcast details
Ficha técnica|Credits and details
FICHA DE CINE|FILM DETAILS
Más sobre la película|More about the film
Buscar en IMDb|Search IMDb
Puedes añadir una|Add an
clave de OMDb en Configuración|OMDb key in Settings
para ver aquí la ficha.|to see the film details here.
Título|Title
Año|Year
Opcional|Optional
Buscar película|Find film
Vúmetro|Level meter
ESTÉREO|STEREO
Tipo de vúmetro|Meter type
Analógico|Analogue
En espera|Standby
Ecualización|Equalization
Sin ecualización|No equalization
Abrir ecualizador|Open equalizer
Espectro de audio|Audio spectrum
10 BANDAS|10 BANDS
Nivel por frecuencia en dBFS|Level by frequency in dBFS
Favoritos|Favourites
0 canales|0 channels
Ver todos los canales|View all channels
Canales favoritos|Favourite channels
Arrastra aquí un canal|Drag a channel here
Todos los canales|All channels
Los canales sintonizados aparecerán aquí.|Tuned channels will appear here.
Calidad de emisión|Broadcast quality
Canales normales|Standard channels
Canales HD|HD channels
Canales UHD|UHD channels
PROGRAMACIÓN POR ANTENA|OVER-THE-AIR SCHEDULE
Actualizar guía|Refresh guide
Horarios de la TDT, en tu hora local.|Terrestrial TV schedule in your local time.
Navegar por los horarios|Browse the schedule
Cuatro horas antes|Four hours earlier
Ahora|Now
Cuatro horas después|Four hours later
Cargando la programación…|Loading the schedule…
Parrilla de canales y horarios|Channels and schedule grid
Cerrar detalles|Close details
Ver canal en directo|Watch channel live
Programar grabación|Schedule recording
ESTUDIO DE AUDIO|AUDIO STUDIO
10 bandas|10 bands
Activo · Flat|Active · Flat
Preajustes de ecualización|Equalizer presets
Ganancia por frecuencia|Gain by frequency
Al aplicar un cambio se vuelve a conectar la emisión.|Applying a change reconnects the stream.
Aplicar ajuste|Apply settings
CONFIGURACIÓN DE ANTENA|ANTENNA SETUP
Comprobando la conexión USB…|Checking the USB connection…
Nueva ubicación|New location
Busca canales desde cero.|Scan for channels from scratch.
Rango UHF|UHF range
Desde|From
Hasta|To
Buscar canales|Scan for channels
Progreso de búsqueda|Scan progress
Sintonizaciones guardadas|Saved channel lists
Guarda la lista de canales de cada lugar y recupérala cuando vuelvas. Marca «Nueva ubicación» para buscar desde cero.|Save a channel list for each location and load it when you return. Select “New location” to scan from scratch.
Nombre de la sintonización|Channel list name
Casa, hotel, antena móvil…|Home, hotel, portable antenna…
Guardar lista actual|Save current list
Todavía no hay sintonizaciones guardadas.|No channel lists saved yet.
Programadas y guardadas|Scheduled and saved
Mantén Arkham TV abierto y el equipo despierto para las grabaciones programadas.|Keep Arkham TV open and your computer awake for scheduled recordings.
Configurar carpeta|Set recording folder
Graba desde el reproductor o elige un programa en la Guía TV.|Record from the player or select a programme in the TV Guide.
Eliminar grabación|Delete recording
Eliminar lista guardada|Delete saved list
Cancelar|Cancel
Abrir carpeta|Open folder
Eliminar|Delete
ARCHIVO LOCAL|LOCAL LIBRARY
Grabación|Recording
Reproductor de grabaciones|Recording player
GRABACIÓN|RECORDING
Volver a Grabaciones|Back to Recordings
PREFERENCIAS DE REPRODUCCIÓN|PLAYBACK PREFERENCES
Sincronización de audio|Audio sync
Sin canales sintonizados|No tuned channels
Guarda un ajuste distinto para cada canal.|Save a separate adjustment for each channel.
Canal|Channel
Ajuste (ms)|Offset (ms)
Guardar ajuste|Save adjustment
Positivo (+)|Positive (+)
si la voz se oye antes.|if you hear the voice first.
Negativo (−)|Negative (−)
si se oye después.|if you hear it afterwards.
restaura la sincronización original.|restores the original timing.
Si ajustas el canal en directo, su emisión se reinicia.|Adjusting the current channel restarts the stream.
Volver a En directo|Back to Live
Carpeta de grabaciones|Recording folder
Elige una carpeta de este equipo. Si escribes una ruta nueva, Arkham TV creará la carpeta.|Choose a folder on this computer. Enter a new path to have Arkham TV create the folder.
Ruta de la carpeta|Folder path
Elegir carpeta|Choose folder
Guardar carpeta|Save folder
Fichas de cine|Film details
Añade una clave de OMDb para consultar los datos de la película al desplegar su ficha.|Add an OMDb key to look up film details when you open the programme card.
Clave de OMDb|OMDb key
Guardar clave|Save key
Quitar clave|Remove key
Obtener clave de OMDb|Get an OMDb key
EVOLUCIÓN DE ARKHAM TV|THE EVOLUTION OF ARKHAM TV
El Changelog de Arkham TV recoge las novedades, mejoras y correcciones de la aplicación desde la versión 1.0. Las versiones más recientes aparecen primero.|The Arkham TV changelog lists new features, improvements and fixes since version 1.0. The newest releases appear first.
EL EQUIPO DE ARKHAM TV|THE ARKHAM TV TEAM
El expediente de Innsmouth|The Innsmouth Case
Desarrollador|Developer
Beta Tester y contribuciones|Beta tester and contributor
Dos investigadores privados consultan una carta náutica a la luz de un farol en el puerto de Innsmouth. Una silueta tentacular asoma entre la niebla.|Two private investigators study a nautical chart by lantern light in Innsmouth harbor. A tentacled silhouette emerges from the fog.
Versión actual|Current version
Historial de versiones|Release history
© Creado por Óscar Peña, 2026|© Created by Óscar Peña, 2026
Sintonizador DVB-T|DVB-T tuner
No se pudo completar la operación.|Could not complete the operation.
El navegador no pudo reproducir esta emisión.|The browser could not play this stream.
Instala los códecs de Ubuntu ejecutando Arkham TV con --preparar-ventana.|Run Arkham TV with --preparar-ventana to install the Ubuntu codecs.
Abre Arkham TV en un navegador que reproduzca vídeo H.264, como Safari.|Open Arkham TV in a browser that supports H.264 video, such as Safari.
Sin medir|Unmeasured
Resolución sin medir|Resolution not measured
Ningún canal coincide con la búsqueda.|No channels match your search.
MINI · EN DIRECTO|MINI · LIVE
MINIRREPRODUCTOR|MINI PLAYER
EN DIRECTO|LIVE
ACTUALIZANDO GUÍA|REFRESHING GUIDE
BUSCANDO CANALES|SCANNING FOR CHANNELS
EN ESPERA|STANDBY
Elige un canal para verlo.|Select a channel to watch.
Actualizando la guía|Refreshing the guide
Buscando tus canales|Scanning for channels
Estamos recibiendo la programación por antena.|Receiving the schedule from your antenna.
Estamos recorriendo las frecuencias de tu antena.|Scanning your antenna frequencies.
Emisión interrumpida|Stream interrupted
Busca canales para empezar.|Scan for channels to get started.
Cargar|Load
Buscando canales…|Scanning for channels…
Buscar desde cero|Scan from scratch
Volver a sintonizar|Rescan
USB desconectado|USB disconnected
Antena conectada|Antenna connected
Sin señal de antena|No antenna signal
Sintonizador listo|Tuner ready
Conecta el sintonizador por USB.|Plug in the USB tuner.
La antena recibe señal de TV.|The antenna is receiving a TV signal.
Revisa el cable de antena.|Check the antenna cable.
Sintoniza un canal para comprobar la señal.|Tune to a channel to check the signal.
Sintonizador en espera|Tuner on standby
Servidor desconectado|Server disconnected
Abre iniciar.command para conectar con Arkham TV.|Open iniciar.command to connect to Arkham TV.
El canal UHF inicial debe ser menor o igual al final.|The first UHF channel must be less than or equal to the last.
Suelta el canal aquí|Drop the channel here
Diálogos|Dialogue
Cine|Cinema
Deportes|Sports
Noche|Night
Personalizado|Custom
Mantiene el balance original de la emisión.|Keeps the original broadcast balance.
Realza la voz y reduce el grave que la enmascara.|Boosts voices and reduces bass that can mask them.
Da cuerpo a la banda sonora y presencia a las voces.|Adds depth to the soundtrack and clarity to voices.
Acerca la narración y los detalles del ambiente.|Brings commentary and crowd detail forward.
Reduce los graves y suaviza los agudos para escuchar a bajo volumen.|Reduces bass and softens treble for low-volume listening.
Refuerza el grave y da brillo a guitarras y percusión.|Boosts bass and brightens guitars and percussion.
Da presencia a las voces y un grave redondo.|Brings vocals forward with rounded bass.
Curva aplicada a la emisión|Curve applied to the stream
Todas las bandas en 0 decibelios|All bands at 0 decibels
Ajuste personalizado por frecuencia.|Custom gain by frequency.
Ajuste guardado.|Settings saved.
No se ha podido aplicar el ajuste.|Could not apply settings.
Izquierdo|Left
Derecho|Right
En pausa|Paused
Silenciado|Muted
Sin señal de audio|No audio signal
Nivel / pico|Level / peak
Por debajo de −60 dBFS|Below −60 dBFS
La emisora no ha enviado una sinopsis.|The broadcaster did not provide a synopsis.
Ver lo que se emite ahora|Watch what's on now
Grabación programada. Puedes gestionarla en Grabaciones.|Recording scheduled. Manage it in Recordings.
Grabación programada|Recording scheduled
Grabar programa|Record programme
No se ha podido cargar la programación.|Could not load the schedule.
Sintoniza tus canales para recibir la programación.|Scan for channels to receive the schedule.
Sin horarios para este tramo. Puedes actualizar la guía o ver el canal en directo.|No listings for this time. Refresh the guide or watch the channel live.
Actualizar la guía pausa la emisión mientras se consultan las frecuencias sintonizadas.|Refreshing the guide pauses playback while the tuner checks each frequency.
Sin programación disponible|No schedule available
Título original|Original title
Dirección|Directed by
Guion|Screenplay
Producción|Production
Fotografía|Cinematography
Temporada|Season
Episodio|Episode
Presentación|Presented by
Reparto|Cast
País|Country
Duración|Duration
Clasificación|Rating
Subtítulos|Subtitles
Audiodescripción|Audio description
Lengua de signos|Sign language
Todos los públicos|All audiences
Accesibilidad|Accessibility
Cine y ficción|Film and fiction
Información|News
Entretenimiento|Entertainment
Infantil y juvenil|Children and teens
Música|Music
Cultura|Culture
Sociedad|Society
Educación y ciencia|Education and science
Estilo de vida|Lifestyle
Especial|Special
Clave guardada en este equipo.|Key saved on this computer.
Ver en IMDb|View on IMDb
AHORA EN EMISIÓN|ON NOW
La emisora no ha publicado una sinopsis.|The broadcaster has not published a synopsis.
La programación de este canal aún no está disponible.|The schedule for this channel is not available yet.
Género|Genre
Finalizando|Finishing
Buscando películas en OMDb…|Searching OMDb…
Selecciona la película que coincide con la emisión.|Select the film that matches the broadcast.
OMDb no encuentra el título. Prueba con el título original o deja el año vacío.|OMDb could not find this title. Try the original title or leave the year blank.
Cargando ficha de la película…|Loading film details…
Datos de OMDb|Data from OMDb
Ficha disponible. Puedes abrir la película en IMDb.|Film details are ready. You can open the film on IMDb.
Verificando la clave en OMDb…|Checking your OMDb key…
Clave verificada y guardada en este equipo.|Key verified and saved on this computer.
Clave eliminada.|Key removed.
Programada|Scheduled
Grabando|Recording
Guardando archivo|Saving file
Guardada|Saved
Cancelada|Cancelled
Interrumpida|Interrupted
Esta grabación ya no está disponible.|This recording is no longer available.
No se pudo reproducir el archivo. Comprueba si sigue en la carpeta de grabaciones.|Could not play the file. Check that it is still in the recording folder.
Grabación eliminada.|Recording deleted.
Carpeta guardada.|Folder saved.
Grabación solicitada. Consulta su estado en Grabaciones.|Recording requested. Check its status in Recordings.
Detener|Stop
Programación cancelada.|Schedule cancelled.
Guardando la grabación…|Saving recording…
Quitar|Remove
Se detiene al cambiar de canal.|Stops when you change channel.
Detener grabación|Stop recording
Diseño|Design
Sintonía|Tuning
Reproducción|Playback
Compatibilidad|Compatibility
Conecta el AVerMedia A835 a un puerto USB del Mac.|Plug the AVerMedia A835 into a USB port on your Mac.
Conecta un AVerMedia A835 o A835B al USB de Ubuntu.|Plug an AVerMedia A835 or A835B into Ubuntu.
A835 conectado por USB|A835 connected via USB
Activa el permiso de acceso DVB de Arkham TV en Ubuntu.|Enable DVB access for Arkham TV in Ubuntu.
A835 detectado. Ejecuta preparar.command para instalar el firmware.|A835 detected. Run preparar.command to install its firmware.
Faltan las herramientas de reproducción. Abre el ejecutable de Arkham TV para Ubuntu.|Playback tools are missing. Open the Arkham TV executable for Ubuntu.
Arkham TV requiere macOS o Linux.|Arkham TV requires macOS or Linux.
Escribe un nombre de entre 1 y 60 caracteres.|Enter a name between 1 and 60 characters.
Espera a que termine la búsqueda.|Wait for the scan to finish.
Sintoniza algún canal antes de guardar la lista.|Tune at least one channel before saving the list.
Ya tienes una sintonización con ese nombre. Elige otro.|A channel list already uses this name. Choose another.
Detén la grabación antes de cargar otra sintonización.|Stop recording before loading another channel list.
Esa sintonización ya no está disponible.|That channel list is no longer available.
Espera a que termine la grabación antes de buscar frecuencias.|Wait for the recording to finish before scanning frequencies.
Ya hay una búsqueda en curso.|A scan is already in progress.
Sintoniza tus canales antes de actualizar la guía.|Scan for channels before refreshing the guide.
La búsqueda superó el tiempo máximo.|The scan timed out.
Guía actualizada.|TV guide updated.
La antena no ha recibido nuevos horarios.|No new listings were received from the antenna.
Sin canales DVB-T. Revisa la antena o prueba otro rango UHF.|No DVB-T channels found. Check the antenna or try another UHF range.
Ese canal no está en la lista.|That channel is not in the list.
Elige un canal sintonizado.|Choose a tuned channel.
La guía ha cambiado. Vuelve a seleccionar el programa.|The guide has changed. Select the programme again.
Ya hay una grabación en curso.|A recording is already in progress.
Esa grabación ya no se puede detener.|That recording can no longer be stopped.
No se pudo iniciar la grabación.|Could not start the recording.
La emisión se interrumpió. Revisa la antena y la conexión USB.|The stream was interrupted. Check the antenna and USB connection.
Escribe un nombre para la sintonización.|Enter a name for the channel list.
Selecciona una sintonización guardada.|Select a saved channel list.
Escribe una carpeta local válida.|Enter a valid local folder.
Selecciona un programa de la guía.|Select a programme from the guide.
Selecciona una grabación.|Select a recording.
Introduce una clave de OMDb válida.|Enter a valid OMDb key.
Introduce el título de la película.|Enter the film title.
Introduce un año de cuatro cifras o deja el campo vacío.|Enter a four-digit year or leave it blank.
Selecciona una película de la lista.|Select a film from the list.
Escribe la ruta completa de una carpeta local.|Enter the full path to a local folder.
Este programa ya ha terminado.|This programme has already finished.
Ya hay una grabación que coincide con ese horario.|Another recording overlaps with this time.
La ruta de la grabación no es válida.|The recording path is invalid.
Esa grabación no se puede eliminar.|That recording cannot be deleted.
El archivo de la grabación no es válido.|The recording file is invalid.
La carpeta de grabaciones no está disponible.|The recording folder is unavailable.
No se pudo abrir la carpeta de grabaciones.|Could not open the recording folder.
La grabación no pudo seguir el ritmo de la emisión. Prueba con una resolución más baja.|Recording could not keep up with the broadcast. Try a lower resolution.
No hay un nombre de archivo disponible para esta grabación.|No file name is available for this recording.
Añade una clave de OMDb en Configuración.|Add an OMDb key in Settings.
OMDb no responde. Puedes consultar el título en IMDb.|OMDb is not responding. You can look up the title on IMDb.
OMDb devolvió una respuesta inesperada.|OMDb returned an unexpected response.
La ficha de esta película no está disponible.|Details for this film are not available.
La emisión se reanudará al terminar.|Playback will resume when it finishes.
`.trim().split("\n")) {
    const [source, target] = entry.split("|");
    translations[source] = target;
  }
  const t = (text) => language === "en" && typeof text === "string" ? translations[text] ?? text : text;
  const f = (es, en, fields) => (language === "en" ? en : es).replace(/\{(\w+)\}/g, (_, name) => fields[name]);
  const number = count => f(count === 1 ? "{count} canal" : "{count} canales",
    count === 1 ? "{count} channel" : "{count} channels", { count });
  const patterns = [
    [/^(A835B?) conectado al controlador DVB de Ubuntu$/, "$1 connected to the Ubuntu DVB driver"],
    [/^(\d+) canales de TV encontrados\.$/, "$1 TV channels found."],
    [/^No se obtuvo señal DVB-T en UHF (\d+)\.$/, "No DVB-T signal on UHF $1."],
    [/^Grabando en UHF (\d+)\. Elige un canal de esa frecuencia o detén la grabación\.$/,
      "Recording on UHF $1. Choose a channel on that frequency or stop recording."],
    [/^Grabación en UHF (\d+)\. Puedes ver otro canal de esa frecuencia\.$/,
      "Recording on UHF $1. You can watch another channel on that frequency."],
    [/^Ubuntu necesita el firmware del (A835B?)\. Actualiza linux-firmware y vuelve a conectar el sintonizador\.$/,
      "Ubuntu needs the $1 firmware. Update linux-firmware and reconnect the tuner."],
    [/^Ubuntu aún no ha creado el dispositivo DVB\. Reconecta el (A835B?) y comprueba el módulo dvb_usb_af9035\.$/,
      "Ubuntu has not created the DVB device yet. Reconnect the $1 and check the dvb_usb_af9035 module."],
    [/^Tu usuario no tiene acceso al (A835B?)\. Comprueba el grupo video y vuelve a iniciar sesión\.$/,
      "Your account cannot access the $1. Check the video group and sign in again."],
    [/^(A835B?) detectado por USB\. Esta variante se puede sintonizar en Ubuntu\.$/,
      "$1 detected via USB. This variant can be tuned on Ubuntu."],
    [/^Versión (\d+(?:\.\d+)+)$/, "Version $1"],
  ];
  function message(source) {
    if (!source || language !== "en") return source;
    const translated = t(source);
    if (translated !== source) return translated;
    for (const [pattern, replacement] of patterns) {
      if (pattern.test(source)) return source.replace(pattern, replacement);
    }
    return source;
  }

  function translate(root) {
    for (const element of root.querySelectorAll("[data-en]")) element.textContent = element.dataset.en;
    const attributes = ["aria-label", "aria-description", "title", "placeholder", "alt"];
    for (const element of root.querySelectorAll(attributes.map(name => "[" + name + "]").join(","))) {
      for (const name of attributes) {
        if (element.hasAttribute(name)) element.setAttribute(name, message(element.getAttribute(name)));
      }
    }
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
      acceptNode: node => node.parentElement?.closest("script, style, svg")
        ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
    });
    for (let node; (node = walker.nextNode());) {
      const source = node.data.trim();
      const target = t(source);
      if (source && target !== source) node.data = node.data.replace(source, target);
    }
  }
  function initialize() {
    document.documentElement.lang = language;
    if (language === "en") translate(document.documentElement);
    const picker = document.getElementById("language-picker");
    const button = document.getElementById("language-button");
    const label = document.getElementById("language-label");
    const appearance = document.getElementById("appearance");
    label.lang = language;
    label.textContent = language === "en" ? "English" : "Español";
    window.webkit?.messageHandlers?.arkhamLanguage?.postMessage(language);
    for (const option of picker.querySelectorAll("[data-language]")) {
      const selected = option.dataset.language;
      if (selected === language) option.setAttribute("aria-current", "true");
      else option.removeAttribute("aria-current");
      option.addEventListener("click", () => {
        picker.open = false;
        button.focus();
        if (selected === language) return;
        try { localStorage.setItem(key, selected); }
        catch { return; }
        location.reload();
      });
    }
    picker.addEventListener("toggle", () => {
      if (picker.open) appearance.open = false;
    });
    appearance.addEventListener("toggle", () => {
      if (appearance.open) picker.open = false;
    });
    document.addEventListener("click", (event) => {
      if (picker.open && !picker.contains(event.target)) picker.open = false;
    });
    picker.addEventListener("keydown", (event) => {
      if (event.key !== "Escape" || !picker.open) return;
      event.preventDefault();
      picker.open = false;
      button.focus();
    });
  }
  return { language, locale: language === "en" ? "en-GB" : "es-ES", t, f, number, message, initialize };
})();

arkhamLanguage.initialize();
