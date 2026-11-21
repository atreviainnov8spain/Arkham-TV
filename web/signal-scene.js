import * as T from "./vendor/three.module.min.js";

// Projected DOM controls and the WebGL camera use the same orbital coordinates.
export function createSignalScene(world, host) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", { antialias: true, powerPreference: "low-power" });
  if (!context) return;
  const renderer = new T.WebGLRenderer({canvas, context, antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio, window.arkhamParallels ? 1 : 1.5));
  const scene = new T.Scene();
  const camera = new T.OrthographicCamera(-8,8,4,-4,.1,80);
  camera.position.z = 16;
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
const glowMap=glowTex();
function glow(parent,point,tint,scale,opacity){const m=new T.SpriteMaterial({map:glowMap,color:tint,opacity,transparent:true,depthWrite:false,blending:T.AdditiveBlending});const item=new T.Sprite(m);item.position.copy(point);item.scale.set(scale,scale,1);parent.add(item);return item}
function chroma(mat){return new T.MeshStandardMaterial({color:mat,metalness:.48,roughness:.35})}
function cylinder(parent,a,b,r,material,rb=r){const dir=b.clone().sub(a);const mesh=new T.Mesh(new T.CylinderGeometry(rb,r,dir.length(),12),material);mesh.position.copy(a).add(b).multiplyScalar(.5);mesh.quaternion.setFromUnitVectors(v(0,1),dir.normalize());parent.add(mesh);return mesh}
function box(parent,x,y,z,w,h,d,material){const m=new T.Mesh(new T.BoxGeometry(w,h,d),material);m.position.set(x,y,z);parent.add(m);return m}
function buildAntenna(){
 const group=new T.Group();scene.add(group);group.position.set(0,-.12,.7);
 const metal=chroma('#acc1c4'),dark=chroma('#485e66'),gold=chroma('#c69c67'),light=chroma('#e3e7d7');
 const model=new T.Group();group.add(model);model.rotation.set(.53,-.46,.085);
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
 const antennaTip=new T.Object3D();antennaTip.position.set(-.60,.07,.1);head.add(antennaTip);
 group.scale.setScalar(1.08);group.updateMatrixWorld(true);
 return group;
}
let paintBackground;
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
 // The nebula never changes. Shade it once at map resolution, rather than
 // evaluating layered noise for every display pixel on every animation frame.
 const backdrop = new T.Scene();
 backdrop.add(new T.Mesh(geo,mat));
 const bakeCamera = new T.OrthographicCamera(-30,30,18,-18,.1,5);
 bakeCamera.position.z=2;
 const texture = new T.WebGLRenderTarget(1024,616,{type:renderer.extensions.has("EXT_color_buffer_float") ? T.HalfFloatType : T.UnsignedByteType,depthBuffer:false,stencilBuffer:false});
 paintBackground = () => {
   renderer.setRenderTarget(texture);
   renderer.render(backdrop,bakeCamera);
   renderer.setRenderTarget(null);
 };
 paintBackground();
 const sky=new T.Mesh(geo,new T.MeshBasicMaterial({map:texture.texture,depthWrite:false}));
 sky.position.z=-8;scene.add(sky);
 const ps=[],cs=[],sizes=[];
 for(let i=0;i<920;i++){let x=(rand()-.5)*31,y=(rand()-.5)*19;ps.push(x,y,-6+rand()*2);const intensity=.20+rand()*.72;const tint=color(i%8===0?'#d7c49b':i%3===0?'#9bb8cf':'#d7eaed');cs.push(tint.r*intensity,tint.g*intensity,tint.b*intensity);sizes.push(.6+Math.pow(rand(),5)*2.4)}
 const g=new T.BufferGeometry();g.setAttribute('position',new T.Float32BufferAttribute(ps,3));g.setAttribute('color',new T.Float32BufferAttribute(cs,3));g.setAttribute('size',new T.Float32BufferAttribute(sizes,1));
 const m=new T.ShaderMaterial({uniforms:{pr:{value:renderer.getPixelRatio()}},transparent:true,depthWrite:false,vertexColors:true,vertexShader:'attribute float size; varying vec3 c;uniform float pr;void main(){c=color;gl_PointSize=size*pr;gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}',fragmentShader:'varying vec3 c;void main(){float d=length(gl_PointCoord-.5);gl_FragColor=vec4(c,(1.-smoothstep(.08,.5,d))*.82);}'});
 scene.add(new T.Points(g,m));
}

  makeSky();
  scene.add(new T.HemisphereLight(0xcfede6,0x49627a,2.1));
  const key = new T.DirectionalLight(0xffedcc,3);
  key.position.set(-4,7,5);
  scene.add(key);
  const rim = new T.DirectionalLight(0x8ed5ed,2);
  rim.position.set(3,0,-2);
  scene.add(rim);
  for (const [rx,ry] of [[2.25,1.05],[4.15,1.92],[6,2.79],[6.8,3.11]]) {
    drawLine(arc(rx,ry,0,2*Math.PI,-2.5),0x769da8,.24);
  }
  const ticks = [];
  for (let i=0;i<176;i++) {
    const a=i*Math.PI/88, length=i%11 === 0 ? .13 : .052;
    ticks.push(v(6.86*Math.cos(a),3.15*Math.sin(a),-2.5),
               v((6.86+length)*Math.cos(a),(3.15+length*.67)*Math.sin(a),-2.5));
  }
  scene.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(ticks),
    new T.LineBasicMaterial({color:0x72919b,transparent:true,opacity:.28})));
  for (let i=0;i<4;i++) {
    const r=.32+i*.24;
    drawLine(arc(r,r*.33,0,Math.PI*2,-.4,80,v(0,-1.18)),0x71bbaa,.23-i*.026);
  }
  glow(scene,v(0,-.75,-.6),'#73bcaf',2.3,.19);
  buildAntenna();

  const sphereGeometry = new T.SphereGeometry(1,40,28);
  const bodies = [];
  const focusRing = new T.Group();
  scene.add(focusRing);
  drawLine(arc(1,1,0,2*Math.PI,0,88),0xf5d59a,.64,focusRing);
  const marks = [];
  for (let i=0;i<64;i++) {
    const a=i*Math.PI/32, r=i%8 === 0 ? 1.12 : 1.06;
    marks.push(v(Math.cos(a)*1.02,Math.sin(a)*1.02), v(Math.cos(a)*r,Math.sin(a)*r));
  }
  focusRing.add(new T.LineSegments(new T.BufferGeometry().setFromPoints(marks),
    new T.LineBasicMaterial({color:0xf4d090,transparent:true,opacity:.7})));

  function createBody(i) {
    const group = new T.Group();
    const uniforms = {tint:{value:new T.Color()},deep:{value:new T.Color()},seed:{value:i*1.19+1.2},kind:{value:[1,2,0,0,1,2,0][i%7]}};
    const planet = new T.Mesh(sphereGeometry,new T.ShaderMaterial({vertexShader:vertex,fragmentShader:planetFrag,uniforms}));
    group.add(planet);
    const atmosphere = glow(group,v(0,0,-.75),0xffffff,3.85,.32);
    if (i%7 === 3) {
      const rings = new T.Group(); rings.rotation.x=1.19;
      group.add(rings);
      for (const [inner,outer,opacity] of [[1.26,1.36,.36],[1.39,1.67,.69],[1.72,1.79,.32],[1.82,1.86,.48]]) {
        rings.add(new T.Mesh(new T.RingGeometry(inner,outer,96),
          new T.MeshBasicMaterial({color:0xc9ac91,side:T.DoubleSide,transparent:true,opacity,depthWrite:false})));
      }
    }
    scene.add(group);
    return {group,planet,uniforms,atmosphere};
  }

  let width=0,height=0,validate=true;
  canvas.addEventListener("webglcontextlost",event=>{event.preventDefault();world.classList.remove("iv-3d");});
  canvas.addEventListener("webglcontextrestored",()=>{paintBackground();validate=true;world.dispatchEvent(new Event("atlas-redraw"));});
  host.replaceChildren(canvas);
  return function renderAtlas(view) {
    if (context.isContextLost()) return;
    if (width !== view.width || height !== view.height) {
      width=view.width; height=view.height;
      const budget = window.arkhamParallels ? 520000 : 1350000;
      renderer.setPixelRatio(Math.min(devicePixelRatio,1.5,Math.sqrt(budget/(width*height))));
      renderer.setSize(width,height,false); validate=true;
    }
    camera.right=width/(2*view.scale); camera.left=-camera.right;
    camera.top=height/(2*view.scale); camera.bottom=-camera.top;
    camera.position.set(view.panX,view.panY,16); camera.updateProjectionMatrix();
    focusRing.visible=false;
    while (bodies.length<view.hubs.length) bodies.push(createBody(bodies.length));
    bodies.forEach(({group,planet,uniforms,atmosphere},i)=>{
      const g=view.hubs[i]; group.visible=!!g;
      if (!g) return;
      group.position.set(g.x,g.y,0);group.scale.setScalar(g.r);
      group.rotation.z=[.18,-.24,.36,-.23,-.25,.35,.20][i%7];
      uniforms.tint.value.set(g.color);uniforms.deep.value.copy(uniforms.tint.value).multiplyScalar(.22);
      atmosphere.material.color.copy(uniforms.tint.value);
      planet.rotation.y=.3+i*.6+view.phase*.027;
      if(g.selected) {
        focusRing.visible=true;focusRing.position.set(g.x,g.y,g.r+.07);
        focusRing.scale.setScalar(g.r*1.22);focusRing.rotation.z=view.phase*.024;
      }
    });
    try {
      renderer.render(scene,camera);
      if (validate) {
        const pixel = new Uint8Array(4);
        context.readPixels(0,0,1,1,context.RGBA,context.UNSIGNED_BYTE,pixel);
        if(context.getError()!==context.NO_ERROR || !(pixel[0] || pixel[1] || pixel[2])) throw Error("Framebuffer unavailable");
        validate=false; world.classList.add("iv-3d");
      }
    } catch(error) {
      world.classList.remove("iv-3d");canvas.remove();renderer.dispose();throw error;
    }
  };
}
