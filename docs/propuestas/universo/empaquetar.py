"""Genera una maqueta HTML autocontenida con el Three.js y los recursos de Arkham TV."""
import base64
import json
from pathlib import Path

here = Path(__file__).resolve().parent
root = here.parents[2]
def uri(data, mime):
    return "data:" + mime + ";base64," + base64.b64encode(data).decode("ascii")
def resource(path, mime):
    return uri((root / path).read_bytes(), mime)
vendor = root / "web/vendor"
core = resource("web/vendor/three.core.min.js", "text/javascript")
engine = (vendor / "three.module.min.js").read_text().replace('"./three.core.min.js"', '"arkham-core"')
imports = {"imports":{"arkham-three":uri(engine.encode(),"text/javascript"),"arkham-core":core}}
logos = {"VEO 7":"veo7","DMAX":"dmax","DKISS":"dkiss","La 7":"laseptima","La 1":"la1","La 2":"la2","24h":"canal24h","Teledeporte":"teledeporte","Clan":"clan","TV3":"tv3","3CatInfo":"3catinfo","SX3 / 33":"sx3-33","Esport3":"esport3","Antena 3":"antena3","laSexta":"lasexta","Neox":"neox","Nova":"nova","Mega":"mega","Telecinco":"telecinco","Cuatro":"cuatro","FDF":"fdf","Energy":"energy","Divinity":"divinity","Boing":"boing","Be Mad":"bemad","A3Series":"a3series","TRECE":"trece","TEN":"ten","Squirrel":"squirrel","Real Madrid TV":"real-madrid-tv"}
logos = {n:resource("assets/canales/"+f+".png","image/png") for n,f in logos.items() if (root/"assets/canales"/(f+".png")).exists()}
js = (here/"atlas.js").read_text().replace("__LOGOS__",json.dumps(logos))
html = (here/"atlas.template.html").read_text()
mark = (root/"assets/arkhamtv-mark.svg").read_text().replace("<path ", '<path fill="#9be5cd" ')
for key,val in {"__SCRIPT__":js,"__IMPORTS__":json.dumps(imports),"__MARK__":uri(mark.encode(),"image/svg+xml"),"__FONT__":resource("assets/fonts/InterVariable.woff2","font/woff2"),"__MONO__":resource("assets/fonts/GeistMono-Variable.ttf","font/ttf")}.items():
    html=html.replace(key,val)
licenses="\n\n".join((root/p).read_text() for p in ["web/vendor/THREE-LICENSE","assets/fonts/GeistMono-OFL.txt","assets/fonts/Inter-OFL.txt","assets/canales/FUENTES.md"])
html=html.replace("</body>",'<script type="text/plain" id="creditos">'+licenses.replace("</script", "&lt;/script")+'</script></body>')
(here/"Universo-de-canales.html").write_text(html)
