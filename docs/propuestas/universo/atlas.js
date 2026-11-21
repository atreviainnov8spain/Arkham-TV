import * as T from 'arkham-three';

const atlas=[
 {u:23,p:[1.0,2.75,-1.6],r:.43,c:'#92a7ef',deep:'#313a73',mode:1,tilt:.18,channels:['La 1','La 2','24h','Teledeporte','Clan']},
 {u:27,p:[5.03,1.59,-.7],r:.64,c:'#91bdb0',deep:'#213e44',mode:2,tilt:-.24,channels:['TV3','3CatInfo','SX3 / 33','Esport3']},
 {u:31,p:[5.58,-1.20,.7],r:.55,c:'#bf96cf',deep:'#4c375e',mode:0,tilt:.36,channels:['Antena 3','laSexta','Neox','Nova','Mega']},
 {u:33,p:[1.62,-2.43,1.35],r:.67,c:'#d5a578',deep:'#61413a',mode:0,tilt:-.23,ring:true,channels:['Telecinco','Cuatro','FDF','Energy']},
 {u:34,p:[-3.16,-2.30,1.3],r:.46,c:'#d08f9b',deep:'#643d50',mode:1,tilt:-.25,channels:['Divinity','Boing','Be Mad','A3Series']},
 {u:44,p:[-5.55,-.46,.1],r:.51,c:'#799ed0',deep:'#283b5b',mode:2,tilt:.35,channels:['TRECE','TEN','Squirrel','Real Madrid TV']},
 {u:47,p:[-3.24,2.00,-.3],r:.76,c:'#82cabe',deep:'#15454d',mode:0,tilt:.20,channels:['VEO 7','DMAX','DKISS','La 7']}
];
const logos=__LOGOS__;
const $=id=>document.getElementById(id);
const frequency=u=>306+8*u;
const symbol=id=>'<svg aria-hidden="true" class="ic"><use href="#'+id+'"/></svg>';
const make=(tag,cls,txt)=>{const e=document.createElement(tag);if(cls)e.className=cls;if(txt!==undefined)e.textContent=txt;return e};
let selected=6,tuned=6,channel=0,zoom=1,moving=!matchMedia('(prefers-reduced-motion: reduce)').matches,clock=0;
let renderer,scene,cam,sky,beam,halo,endpoint,ringHalo,ringTicks,beamGlow,antenna,labelA,antennaTip;
let spheres=[],dots=[],labels=[],beamDots=[],bands=[],waveSeed=1,width=0,height=0,visible=true,frame=0,last=0,drag=null,panX=0,panY=0;
const v=(x,y,z=0)=>new T.Vector3(x,y,z);
const color=n=>new T.Color(n);
let seed=17251;function rand(){seed=(1664525*seed+1013904223)>>>0;return seed/4294967296}
const vertex='varying vec3 P;varying vec3 N;void main(){P=position;N=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}';
const noise=`
float h(vec3 p){p=fract(p*.1031);p+=dot(p,p.yzx+33.33);return fract((p.x+p.y)*p.z);}
float n(vec3 p){vec3 i=floor(p),f=fract(p);f=f*f*(3.-2.*f);return mix(mix(mix(h(i),h(i+vec3(1,0,0)),f.x),mix(h(i+vec3(0,1,0)),h(i+vec3(1,1,0)),f.x),f.y),mix(mix(h(i+vec3(0,0,1)),h(i+vec3(1,0,1)),f.x),mix(h(i+vec3(0,1,1)),h(i+1.),f.x),f.y),f.z);}
float fb(vec3 p){return .52*n(p)+.27*n(p*2.08+7.1)+.14*n(p*4.17+2.7)+.07*n(p*8.63+1.9);}
`;
const planetFrag=noise+`
varying vec3 P;varying vec3 N;uniform vec3 tint;uniform vec3 deep;uniform float seed;uniform float kind;
void main(){vec3 p=normalize(P);vec3 s=p+vec3(seed,2.1,seed*.63);
 float cloud=fb(s*4.3),large=fb(2.4*s+2.*cloud), grain=n(s*82.);
 float f=0.;vec3 surf;
 if(kind<.5){float bend=p.y+cloud*.16+.04*sin(p.x*7.+p.y*2.);
 float belt=.5+.5*sin(bend*33.+2.1*sin(bend*9.)+3.*cloud);
 float fine=.5+.5*sin(bend*112.+5.*cloud+4.*n(s*13.));
 f=.12+.60*large+.34*smoothstep(.1,.95,belt)+.15*fine;
 surf=mix(deep,tint,clamp(f,0.,1.));surf=mix(surf,vec3(.80,.79,.65),.27*smoothstep(.60,.85,large+.22*belt));}
 else if(kind<1.5){float strata=fb(s*11.+large*3.);
 surf=mix(deep,tint,clamp(.12+.84*large+.31*strata-.12*grain,0.,1.));
 surf*=.85+.19*smoothstep(.2,.85,n(s*22.+cloud));}
 else{float land=smoothstep(.40,.54,large+.18*(cloud-.5));
 surf=mix(deep,tint*.76,land);float veil=smoothstep(.48,.7,fb(s*7.+vec3(3.7*large,cloud,1.)));
 surf=mix(surf,vec3(.78,.83,.78),.67*veil);}
 vec3 nn=normalize(N);float lit=dot(nn,normalize(vec3(-.65,.76,.38)));
 float rim=pow(1.-clamp(nn.z,0.,1.),3.4);
 vec3 base=surf*(.10+1.18*max(0.,lit)) + tint*.19*rim + vec3(.54,.79,.80)*rim*max(0.,lit)*.37;
 gl_FragColor=vec4(base,1.);
 #include <colorspace_fragment>
}`;
function drawLine(points,col,opacity,parent=scene){const geo=new T.BufferGeometry().setFromPoints(points);const obj=new T.Line(geo,new T.LineBasicMaterial({color:col,transparent:true,opacity,depthWrite:false}));parent.add(obj);return obj}
function arc(rx,ry,a,b,z=0,n=170,center=v(0,0)){return Array.from({length:n+1},(_,i)=>{let t=a+(b-a)*i/n;return v(center.x+rx*Math.cos(t),center.y+ry*Math.sin(t),z)})}
function glowTex(){const c=document.createElement('canvas');c.width=c.height=96;const x=c.getContext('2d'),g=x.createRadialGradient(48,48,0,48,48,48);[[0,'rgba(255,255,255,1)'],[.15,'rgba(255,255,255,.8)'],[.38,'rgba(255,255,255,.28)'],[.7,'rgba(255,255,255,.055)'],[1,'rgba(255,255,255,0)']].forEach(([p,s])=>g.addColorStop(p,s));x.fillStyle=g;x.fillRect(0,0,96,96);return new T.CanvasTexture(c)}
let glowMap;
function glow(parent,point,tint,scale,opacity){const m=new T.SpriteMaterial({map:glowMap,color:tint,opacity,transparent:true,depthWrite:false,blending:T.AdditiveBlending});const item=new T.Sprite(m);item.position.copy(point);item.scale.set(scale,scale,1);parent.add(item);return item}
function chroma(mat){return new T.MeshStandardMaterial({color:mat,metalness:.48,roughness:.35})}
function cylinder(parent,a,b,r,material,rb=r){const dir=b.clone().sub(a);const mesh=new T.Mesh(new T.CylinderGeometry(rb,r,dir.length(),12),material);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(v(0,1),dir.normalize());parent.add(mesh);return mesh}
function box(parent,x,y,z,w,h,d,material){const m=new T.Mesh(new T.BoxGeometry(w,h,d),material);m.position.set(x,y,z);parent.add(m);return m}
function buildAntenna(){
 const group=new T.Group();scene.add(group);group.position.set(.18,-.12,.7);
 const metal=chroma('#acc1c4'),dark=chroma('#485e66'),gold=chroma('#c69c67'),light=chroma('#e3e7d7');
 const model=new T.Group();group.add(model);model.rotation.set(.22,-.49,.085);
 cylinder(model,v(0,-.94,0),v(0,.49,0),.067,metal);
 cylinder(model,v(0,-.95,0),v(0,-.91,0),.32,dark,.27);
 cylinder(model,v(0,-.91,0),v(0,-.84,0),.19,gold,.11);
 cylinder(model,v(0,-.62,0),v(0,-.52,0),.079,dark);
 const head=new T.Group();model.add(head);head.position.set(-.03,.34,0);head.rotation.z=.15;
 box(head,.1,0,0,2.5,.07,.1,metal);
 for(let i=0;i<8;i++){let x=-.64+i*.27,l=.62-i*.036;
  cylinder(head,v(x,.045,-l),v(x,.045,l),.022,light);
  box(head,x,.015,0,.093,.099,.125,dark);
 }
 for(const z of [-.62,.62])cylinder(head,v(-1.14,-.56,z),v(-1.14,.61,z),.022,metal);
 for(let j=0;j<6;j++){const y=-.56+j*.234;cylinder(head,v(-1.14,y,-.62),v(-1.14,y,.62),.018,metal)}
 cylinder(head,v(-1.14,-.52,-.60),v(-1.14,.57,.60),.013,dark);
 cylinder(head,v(-1.14,.57,-.60),v(-1.14,-.52,.60),.013,dark);
 cylinder(head,v(-1.14,-.48,0),v(-.61,-.05,0),.026,dark);
 const cable=new T.CatmullRomCurve3([v(-.55,-.06,.09),v(-.55,-.31,.09),v(-.10,-.42,.1),v(.04,-.54,.03)]);
 head.add(new T.Mesh(new T.TubeGeometry(cable,20,.023,6,false),dark));
 box(head,-.60,-.03,.09,.24,.14,.17,gold);
 antennaTip=new T.Object3D();antennaTip.position.set(-.60,.07,.1);head.add(antennaTip);
 group.scale.setScalar(1.08);group.updateMatrixWorld(true);
 return group;
}
function makeSky(){
 const geo=new T.PlaneGeometry(60,36);
 const mat=new T.ShaderMaterial({depthWrite:false,uniforms:{},vertexShader:'varying vec3 pos; void main(){pos=position;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:noise+`
 varying vec3 pos;void main(){vec2 p=pos.xy;float a=fb(vec3(p*.38,6.3)), b=fb(vec3(p*.87+2.3*a,1.9));
 float lane=exp(-.34*pow(p.y-.26*p.x-.15+1.4*(a-.5),2.))*exp(-.009*dot(p,p));
 float thread=pow(clamp((.37*a+.63*b-.16)*1.72,0.,1.),2.7);
 vec3 c=vec3(.004,.008,.016)+lane*thread*mix(vec3(.034,.12,.13),vec3(.096,.055,.115),smoothstep(-4.,5.,p.x))
 +vec3(.008,.016,.022)*exp(-.035*dot(p,p));
 gl_FragColor=vec4(c,1.); #include <colorspace_fragment>
 }`.replace('; #include',';\n#include')});
 sky=new T.Mesh(geo,mat);sky.position.z=-8;scene.add(sky);
 const ps=[],cs=[],sizes=[];
 for(let i=0;i<920;i++){let x=(rand()-.5)*31,y=(rand()-.5)*19;ps.push(x,y,-6+rand()*2);const intensity=.20+rand()*.72;const tint=color(i%8===0?'#d7c49b':i%3===0?'#9bb8cf':'#d7eaed');cs.push(tint.r*intensity,tint.g*intensity,tint.b*intensity);sizes.push(.6+Math.pow(rand(),5)*2.4)}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(ps,3));g.setAttribute('color',new T.Float32BufferAttribute(cs,3));g.setAttribute('size',new T.Float32BufferAttribute(sizes,1));
 const m=new T.ShaderMaterial({uniforms:{pr:{value:renderer.getPixelRatio()}},transparent:true,depthWrite:false,vertexColors:true,vertexShader:'attribute float size; varying vec3 c;uniform float pr;void main(){c=color;gl_PointSize=size*pr;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 c;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(c,(1.-smoothstep(.08,.5,d))*.82);}'});
 scene.add(new T.Points(g,m));
}
function makeScene(){
 renderer=new T.WebGLRenderer({antialias:true,alpha:false,powerPreference:'low-power'});renderer.setPixelRatio(Math.min(devicePixelRatio,1.6));
 renderer.setClearColor('#091422');$('scene').append(renderer.domElement);scene=new T.Scene();cam=new T.OrthographicCamera(-8,8,4,-4,.1,80);cam.position.z=16;
 glowMap=glowTex();makeSky();
 const environment=new T.HemisphereLight(0xcfede6,0x49627a,2.1);scene.add(environment);
 const key=new T.DirectionalLight(0xffedcc,3);key.position.set(-4,7,5);scene.add(key);
 const rim=new T.DirectionalLight(0x8ed5ed,2);rim.position.set(3,0,-2);scene.add(rim);
 for(const [rx,ry] of [[2.25,1.05],[4.15,1.92],[6.0,2.79],[6.8,3.11]]){
  drawLine(arc(rx,ry,0,Math.PI*2,-2.5),0x769da8,.24);
 }
 for(let i=0;i<176;i++){const a=i*Math.PI/88;let outer=i%11===0?.13:.052;
  // Combined below into one draw call.
  if(!i)var ticks=[];ticks.push(v(6.86*Math.cos(a),3.15*Math.sin(a),-2.5),v((6.86+outer)*Math.cos(a),(3.15+outer*.67)*Math.sin(a),-2.5));
 }
 scene.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(ticks),new T.LineBasicMaterial({color:0x72919b,transparent:true,opacity:.28})));
 for(const i of [0,1,2,3]){let r=.32+i*.24;drawLine(arc(r,r*.33,0,Math.PI*2,-.4,80,v(.18,-1.18)),0x71bbaa,.23-i*.026)}
 glow(scene,v(.12,-.75,-.6),'#73bcaf',2.3,.19);antenna=buildAntenna();
 const sphere=new T.SphereGeometry(1,52,32),moonGeo=new T.SphereGeometry(1,12,8);
 atlas.forEach((g,i)=>{
   const pos=v(...g.p);let group=new T.Group();group.position.copy(pos);group.rotation.z=g.tilt;scene.add(group);
   const m=new T.ShaderMaterial({vertexShader:vertex,fragmentShader:planetFrag,uniforms:{tint:{value:color(g.c)},deep:{value:color(g.deep)},seed:{value:i*1.19+1.2},kind:{value:g.mode}}});
   const body=new T.Mesh(sphere,m);body.scale.setScalar(g.r);group.add(body);spheres.push(body);
   glow(scene,pos.clone().add(v(0,0,-.65)),g.c,g.r*3.85,.32);
   if(g.ring){const tilted=new T.Group();group.add(tilted);tilted.rotation.x=1.19;
     for(const [inner,outer,alpha] of [[1.26,1.36,.36],[1.39,1.67,.69],[1.72,1.79,.32],[1.82,1.86,.48]]){const ring=new T.Mesh(new T.RingGeometry(g.r*inner,g.r*outer,110),new T.MeshBasicMaterial({color:'#c9ac91',side:T.DoubleSide,transparent:true,opacity:alpha,depthWrite:false}));tilted.add(ring)}
   }
   const trail=new T.Group();trail.position.copy(pos);trail.rotation.z=(i%3-1)*.29;scene.add(trail);
   drawLine(arc(g.r+ .47,(g.r+.47)*.43,0,Math.PI*2,-.28,66),g.c,.27,trail);
   const moons=[];g.channels.forEach((name,j)=>{const dot=new T.Mesh(moonGeo,new T.MeshStandardMaterial({color:g.c,emissive:g.c,emissiveIntensity:.35,roughness:.6}));dot.scale.setScalar(.04+(j%2)*.012);trail.add(dot);dot.userData={i,j};moons.push(dot)});dots.push(moons);
   const tag=make('button','tag');tag.append(make('strong','', 'UHF '+g.u),make('small','',frequency(g.u)+' MHz'));tag.setAttribute('aria-label','Explorar UHF '+g.u);tag.onclick=()=>inspect(i);$('labels').append(tag);labels.push(tag);
 });
 labelA=make('span','tag antenna','Tu antena');$('labels').append(labelA);
 halo=new T.Group();scene.add(halo);
 ringHalo=drawLine(arc(1,1,0,2*Math.PI,0,96),0xf5d59a,.57,halo);
 const tickpts=[];for(let j=0;j<64;j++){let a=j*Math.PI/32;let r=j%8===0?1.12:1.06;tickpts.push(v(Math.cos(a)*1.02,Math.sin(a)*1.02),v(Math.cos(a)*r,Math.sin(a)*r))}
 ringTicks=new T.LineSegments(new T.BufferGeometry().setFromPoints(tickpts),new T.LineBasicMaterial({color:0xf4d090,transparent:true,opacity:.68}));halo.add(ringTicks);
 endpoint=glow(scene,v(0,0,0),'#ffd09b',.29,.85);
 for(let j=0;j<3;j++)beamDots.push(glow(scene,v(0,0,0),'#ffcf84',.17+(j===0?.08:0),.96));
 updateBeam();
 new ResizeObserver(resize).observe($('scene'));
 $('scene').addEventListener('pointerdown',ev=>{if(ev.button!==0)return;drag={x:ev.clientX,y:ev.clientY,px:panX,py:panY};renderer.domElement.setPointerCapture(ev.pointerId)});
 $('scene').addEventListener('pointermove',ev=>{if(!drag)return;const dx=ev.clientX-drag.x,dy=ev.clientY-drag.y;if(Math.hypot(dx,dy)>4){drag.moved=true;panX=T.MathUtils.clamp(drag.px-dx*cam.right*2/width,-2,2);panY=T.MathUtils.clamp(drag.py+dy*cam.top*2/height,-1.4,1.4);resize()}});
 $('scene').addEventListener('pointerup',ev=>{if(!drag)return;let moved=drag.moved;drag=null;if(moved)return;
 const rect=renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.setFromCamera({x:(ev.clientX-rect.left)/width*2-1,y:1-(ev.clientY-rect.top)/height*2},cam);
 const hit=ray.intersectObjects([...spheres,...dots.flat()],false)[0];if(hit){const s=spheres.indexOf(hit.object);if(s>=0)inspect(s);else tune(hit.object.userData.i,hit.object.userData.j)}
 });
 $('scene').addEventListener('pointercancel',()=>{drag=null});renderer.domElement.style.touchAction='none';
 resize();
}
let route;
function updateBeam(){
 if(!scene)return;
 const origin=antennaTip.getWorldPosition(v()),g=atlas[tuned],end=v(...g.p);const delta=origin.clone().sub(end).normalize();end.addScaledVector(delta,g.r*.96);end.z+=.21;
 route=new T.CatmullRomCurve3([end,end.clone().lerp(origin,.38).add(v(.04,-.17,.23)),origin.clone().lerp(end,.33).add(v(.06,.20,.19)),origin]);
 if(beam){scene.remove(beam,beamGlow);beam.geometry.dispose();beam.material.dispose();beamGlow.geometry.dispose();beamGlow.material.dispose()}
 beam=drawLine(route.getPoints(72),'#ffd79a',.96);beamGlow=new T.Mesh(new T.TubeGeometry(route,48,.016,6,false),new T.MeshBasicMaterial({color:'#efb96b',transparent:true,opacity:.27,depthWrite:false}));scene.add(beamGlow);endpoint.position.copy(origin);
}
function resize(){
 if(!renderer)return;width=$('scene').clientWidth;height=$('scene').clientHeight;if(!width||!height)return;
 renderer.setSize(width,height,false);const w=Math.max(7.45,4.12*width/height)/zoom;
 cam.left=-w;cam.right=w;cam.top=w*height/width;cam.bottom=-cam.top;cam.position.set(panX,panY,16);cam.updateProjectionMatrix();cam.updateMatrixWorld();
 const place=(el,point,dy=0)=>{const p=point.clone().project(cam);el.style.left=(p.x*.5+.5)*width+'px';el.style.top=(-p.y*.5+.5)*height+dy+'px'};
 atlas.forEach((g,i)=>{place(labels[i],v(...g.p),g.r*width/(2*w)+5)});place(labelA,v(.15,-1.34),9);render();
}
function render(){if(!scene||!width)return;atlas.forEach((g,i)=>{spheres[i].rotation.y=.3+i*.6+clock*.027;dots[i].forEach((d,j)=>{let t=(j/g.channels.length)*Math.PI*2+.43+i*.9+clock*.057;let a=g.r+.47;d.position.set(Math.cos(t)*a,Math.sin(t)*a*.43,Math.sin(t)*a*.85);const live=i===tuned&&j===channel;d.scale.setScalar(live?.075:.046);d.material.emissiveIntensity=live?1.4:.32;d.material.emissive.set(live?'#ffc781':g.c)})});
 const g=atlas[selected];halo.position.copy(v(...g.p));halo.position.z+=g.r+.07;halo.scale.setScalar(g.r*1.22);ringTicks.rotation.z=clock*.024;
 beamDots.forEach((dot,j)=>dot.position.copy(route.getPointAt((clock*.16+j/3+.11)%1)));renderer.render(scene,cam)}
function tick(now){frame=0;if(!visible||document.hidden||!moving||!renderer)return;if(now-last>=33){clock+=Math.min((now-last)/1000,.12);last=now;render()}frame=requestAnimationFrame(tick)}
function loop(){if(frame)cancelAnimationFrame(frame);frame=0;last=performance.now();if(moving&&visible&&!document.hidden&&renderer)frame=requestAnimationFrame(tick)}
function inspect(i){selected=i;updateUI();render()}
function tune(i,j){tuned=selected=i;channel=j;updateBeam();updateUI();render()}
function updateUI(){
 const g=atlas[selected];$('uhf').textContent=g.u;$('mhz').textContent=frequency(g.u)+' MHz';
 const active=selected===tuned;$('status').className='status'+(active?'':' idle');$('status').replaceChildren(make('i'),document.createTextNode(active?'En recepción':'En el mapa'));
 $('channels').replaceChildren(...g.channels.map((name,j)=>{const b=make('button','ch'),isTuned=active&&channel===j;b.dataset.tuned=isTuned;b.title=isTuned?'Canal en recepción':'Simular recepción de '+name;b.setAttribute('aria-pressed',String(isTuned));const tile=make('span','tile');if(logos[name]){const img=make('img');img.alt='';img.src=logos[name];tile.append(img)}else tile.textContent=name.slice(0,2).toUpperCase();const ind=make('span','indicator');ind.innerHTML=symbol(isTuned?'air':'arrow');b.append(tile,make('span','name',name),ind);b.onclick=()=>tune(selected,j);return b}));
 $('snr').textContent=active?(26.4+(tuned-6)*.65+channel*.15).toLocaleString('es',{maximumFractionDigits:1})+' dB':'—';
 const wave=$('wave');const pts=Array.from({length:87},(_,i)=>[i*260/86,24+Math.sin(i*.30+tuned)*3+Math.cos(i*.77+channel)*2.2+Math.sin(i*1.9)*1.6+(i%22===8?-6:0)]);
 const d='M'+pts.map(p=>p.join(',')).join(' L');wave.innerHTML='<path d="M0 11H260M0 26H260M0 40H260" stroke="#344652" stroke-width=".5"/>'+(active?'<path d="'+d+' L260 44 H0Z" fill="#72d7be" opacity=".08"/><path d="'+d+'" stroke="#82d9c4" fill="none" stroke-width="1.35"/>':'');
 $('liveinfo').textContent='Recepción simulada · '+atlas[tuned].channels[channel]+' · UHF '+atlas[tuned].u;
 labels.forEach((tag,i)=>{tag.classList.toggle('inspected',i===selected);tag.setAttribute('aria-pressed',String(i===selected))});
 bands.forEach((b,i)=>b.setAttribute('aria-pressed',String(i===selected)));
 $('motion').innerHTML=symbol(moving?'pause':'play');$('motion').setAttribute('aria-label',moving?'Pausar movimiento':'Reanudar movimiento');$('motion').title=$('motion').getAttribute('aria-label');
 $('less').disabled=zoom<=.8;$('more').disabled=zoom>=1.55;
}
atlas.forEach((g,i)=>{const b=make('button','band');b.style.setProperty('--hue',g.c);b.append(make('i'),make('strong','','UHF '+g.u),make('small','',frequency(g.u).toString()));b.onclick=()=>inspect(i);$('bands').append(b);bands.push(b)});
$('more').onclick=()=>{zoom=Math.min(1.55,zoom+.15);resize();updateUI()};$('less').onclick=()=>{zoom=Math.max(.8,zoom-.15);resize();updateUI()};$('reset').onclick=()=>{zoom=1;panX=panY=0;resize();updateUI()};$('motion').onclick=()=>{moving=!moving;updateUI();loop()};
$('fullscreen').onclick=async()=>{try{if(document.fullscreenElement)await document.exitFullscreen();else await document.documentElement.requestFullscreen()}catch{}};
try{makeScene();}catch(e){console.error(e);$('scene').replaceChildren(make('p','fallback','WebGL 2 no está disponible. Puedes explorar las frecuencias en la banda inferior.'))}
updateUI();document.addEventListener('visibilitychange',loop);new IntersectionObserver(entries=>{visible=entries[0].isIntersecting;loop()}).observe($('scene'));loop();
