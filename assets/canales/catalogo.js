// El primer nombre es el de la marca; los demás son variantes de la señal TDT.
(() => {
  const nacionales = {
    la1: ["La 1", "TVE 1"],
    la2: ["La 2", "TVE 2"],
    canal24h: ["24h", "Canal 24h", "24 Horas", "Canal 24 Horas"],
    clan: ["Clan", "Clan TVE"],
    teledeporte: ["Teledeporte", "TDP"],
    antena3: ["Antena 3", "A3"],
    lasexta: ["La Sexta"],
    neox: ["Neox"],
    nova: ["Nova"],
    mega: ["Mega"],
    a3series: ["Atreseries", "A3Series"],
    telecinco: ["Telecinco", "Tele 5", "T5"],
    cuatro: ["Cuatro"],
    fdf: ["FDF", "Factoría de Ficción"],
    boing: ["Boing"],
    divinity: ["Divinity"],
    energy: ["Energy"],
    bemad: ["Be Mad", "Be Mad TV"],
    squirrel: ["Squirrel", "Squirrel TV"],
    squirrel2: ["Squirrel Dos", "Squirrel 2", "Squirrel Two"],
    dmax: ["DMAX"],
    veo7: ["Veo 7"],
    trece: ["TRECE TV", "TRECE", "13 TV"],
    dkiss: ["DKISS", "DKISS TV"],
    ten: ["TEN", "TEN TV"],
    "real-madrid-tv": ["Real Madrid TV", "Real Madrid Televisión", "RMTV"],
    laseptima: ["La Séptima", "La Séptima TV", "La Sép7ima", "La Sép7ima TV", "Sép7ima", "Séptima"],
  };

  const regionales = {
    tv3: ["TV3"],
    "3catinfo": ["3CatInfo"],
    esport3: ["Esport3"],
    sx3: ["SX3"],
    canal33: ["33", "Canal 33"],
    "sx3-33": ["SX3/33"],
    ib3: ["IB3", "IB3 Global"],
    la2cat: ["La 2Cat"],
  };

  const key = (name) => name.normalize("NFD").toLowerCase().replace(/[^a-z0-9]/g, "");
  const logos = new Map(Object.entries({ ...nacionales, ...regionales }).flatMap(([file, names]) =>
    names.map(name => [key(name), `/assets/canales/${file}.png`])));
  const formats = ["uhd", "fhd", "hd", "sd", "4k", "2160p", "1080p", "1080i", "720p"];

  window.channelLogoPath = (name) => {
    const station = key(name);
    if (logos.has(station)) return logos.get(station);
    for (const format of formats) {
      if (!station.endsWith(format)) continue;
      const path = logos.get(station.slice(0, -format.length));
      if (path) return path;
    }
  };
})();
