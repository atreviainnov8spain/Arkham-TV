import * as T from "./vendor/three.module.min.js";

export function createSignalScene(sky, host) {
  const canvas = document.createElement("canvas");
  const context = canvas.getContext("webgl2", {alpha:true,antialias:true});
  if (!context) return;
  const renderer = new T.WebGLRenderer({canvas, context, alpha:true, antialias:true});
  renderer.setPixelRatio(Math.min(devicePixelRatio,1.65));
  const scene = new T.Scene(), camera = new T.OrthographicCamera(-1,1,1,-1,.1,65);
  camera.position.z = 18;
  scene.add(new T.HemisphereLight(0xc0eefa, 0x39366e, 1.3));
  const key = new T.DirectionalLight(0xb1f9ff, 2.6);
  key.position.set(-3,4,5); scene.add(key);
  const edge = new T.DirectionalLight(0xf7a1df, 1.05);
  edge.position.set(2,1,-4); scene.add(edge);
  const antenna = new T.Group();
  scene.add(antenna);
  const steel = new T.MeshPhongMaterial({color:0xacc9d2, shininess:58, specular:0xc7f8ff,transparent:true});
  const shadow = new T.MeshPhongMaterial({color:0x587a89, shininess:30,transparent:true});
  const emissive = new T.MeshBasicMaterial({color:0xc3f7ab,transparent:true});
  const v = a => new T.Vector3(...a);
  function rod(parent, a, b, radius, material = steel) {
    const start = v(a), end = v(b), direction = end.clone().sub(start);
    const tube = new T.Mesh(new T.CylinderGeometry(radius,radius,direction.length(),10),material);
    tube.position.copy(start).lerp(end,.5);
    tube.quaternion.setFromUnitVectors(new T.Vector3(0,1,0), direction.normalize());
    parent.add(tube);
  }
  rod(antenna,[0,-1.45,0],[0,.29,0],.046,shadow);
  const aerial = new T.Group();
  aerial.rotation.set(.30,-.34,.20);
  aerial.position.y = .22;
  antenna.add(aerial);
  rod(aerial,[-1.14,0,0],[1.63,0,0],.041,shadow);
  for (let i=0;i<7;i++) {
    const x=-.69+i*.35, h=.8-i*.064;
    rod(aerial,[x,0,-h],[x,0,h],i === 0 ? .027 : .022);
    rod(aerial,[x,-.052,-.05],[x,.052,.05],.046,shadow);
  }
  for (const y of [-.53,.53]) rod(aerial,[-1.09,y,-.87],[-1.09,y,.87],.026);
  for (const z of [-.87,-.58,-.29,0,.29,.58,.87]) rod(aerial,[-1.09,-.53,z],[-1.09,.53,z],.017);
  rod(aerial,[-.92,-.35,0],[-1.09,-.48,0],.02,shadow);
  rod(aerial,[-.92,.35,0],[-1.09,.48,0],.02,shadow);
  const pilot = new T.Mesh(new T.SphereGeometry(.038,12,8), emissive);
  pilot.position.set(-.66,.055,.035);
  aerial.add(pilot);
  const foot = new T.Mesh(new T.CylinderGeometry(.11,.17,.075,24),shadow);
  foot.position.y=-1.44; antenna.add(foot);
  const sphere = new T.SphereGeometry(1,44,28);
  const ringGeometry = new T.RingGeometry(1.32,1.55,72);
  const outline = new T.RingGeometry(1.67,1.678,72);
  const bodies = [];
  function makePlanet() {
    const body = new T.Group();
    const material = new T.ShaderMaterial({
      uniforms:{hue:{value:new T.Color()}, phase:{value:0}},
      vertexShader:`
        varying vec3 p; varying vec3 n;
        void main(){p=position; n=normalize(normalMatrix*normal); gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}
      `,
      fragmentShader:`
        varying vec3 p; varying vec3 n; uniform vec3 hue; uniform float phase;
        void main(){
          vec3 nn=normalize(n);
          float daylight=max(0.,dot(nn,normalize(vec3(-.55,.64,.58))));
          float angle=atan(p.z,p.x);
          float folds=sin(p.y*15.+cos(angle*3.+phase)*.9 + sin(p.z*17.)*.36);
          float clouds=sin(p.y*42.+cos(angle*5. + phase)*2.)*.5+.5;
          float rim=pow(1.-max(nn.z,0.),4.);
          float film = sin(p.y*4. + angle*2.)*.5 + .5;
          vec3 spectral=mix(vec3(.7,.22,.67),vec3(.23,.79,.88),film);
          vec3 col=vec3(.026,.045,.083)+hue*(.075 + daylight*(.17 + folds*.042 + clouds*.038))+
            hue*rim*(.22+daylight*.25) + spectral*rim*.12;
          gl_FragColor=vec4(col,1.);
          #include <colorspace_fragment>
        }
      `,
    });
    const planet = new T.Mesh(sphere,material); body.add(planet);
    const ringMaterial = new T.MeshBasicMaterial({transparent:true,opacity:.29,side:T.DoubleSide,depthWrite:false});
    const ring = new T.Mesh(ringGeometry,ringMaterial); body.add(ring);
    const hair = new T.Mesh(outline,new T.MeshBasicMaterial({
      color:0x82c0ed,opacity:.23,transparent:true,side:T.DoubleSide,depthWrite:false
    })); body.add(hair);
    scene.add(body);
    return {body,planet,material,ring,ringMaterial,hair};
  }
  const noise = seed => {
    const value = Math.sin(seed * 127.1 + .4) * 43758.5453;
    return value - Math.floor(value);
  };
  const dustPlanes = [
    { count: 360, depth: -8, diameter: 1.9, softness: .44, opacity: .56, parallax: .20, color: 0x9abbe9 },
    { count: 150, depth: -1.9, diameter: 2.7, softness: .28, opacity: .66, parallax: .55, color: 0xb6e5ef },
    { count: 72, depth: 2, diameter: 7, softness: .79, opacity: .26, parallax: 1.32, color: 0x92e7db },
  ].map((plane, index) => {
    const positions = [];
    const variation = [];
    for (let i = 0; i < plane.count; i++) {
      const seed = (i + index * 500) * 4;
      positions.push((noise(seed) - .5) * 17, (noise(seed + 1) - .5) * 9, plane.depth);
      variation.push(noise(seed + 2), noise(seed + 3));
    }
    const geometry = new T.BufferGeometry();
    geometry.setAttribute("position", new T.Float32BufferAttribute(positions, 3));
    geometry.setAttribute("variation", new T.Float32BufferAttribute(variation, 2));
    const material = new T.ShaderMaterial({
      depthWrite: false,
      transparent: true,
      uniforms: {
        tint: { value: new T.Color(plane.color) },
        diameter: { value: plane.diameter * renderer.getPixelRatio() },
        softness: { value: plane.softness },
        opacity: { value: plane.opacity },
        magnification: { value: 1 },
      },
      vertexShader: `
        attribute vec2 variation;
        uniform float diameter, magnification;
        varying float brightness;
        void main() {
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.);
          gl_PointSize = diameter * magnification * mix(.72, 1.22, variation.x);
          brightness = mix(.24, 1., variation.y * variation.y);
        }
      `,
      fragmentShader: `
        uniform vec3 tint;
        uniform float softness, opacity;
        varying float brightness;
        void main() {
          float radius = length(gl_PointCoord - vec2(.5)) * 2.;
          float alpha = 1. - smoothstep(1. - softness, 1., radius);
          gl_FragColor = vec4(tint, alpha * brightness * opacity);
          #include <colorspace_fragment>
        }
      `,
    });
    const points = new T.Points(geometry, material);
    scene.add(points);
    return { points, material, parallax: plane.parallax, drift: index + 1 };
  });
  host.replaceChildren(canvas);
  let needsValidation = true;
  canvas.addEventListener("webglcontextlost", event => {
    event.preventDefault();
    sky.classList.remove("iv-3d");
  });
  canvas.addEventListener("webglcontextrestored", () => { needsValidation = true; });
  let lastWidth=0,lastHeight=0;
  return function draw({ width, height, hubs, camera: [cx, cy, zoom], phase, accent }) {
    if (context.isContextLost()) return;
    while (bodies.length < hubs.length) bodies.push(makePlanet());
    const extent = 3.15, halfWidth = extent*width/height;
    if (width !== lastWidth || height !== lastHeight) {
      lastWidth=width; lastHeight=height;
      renderer.setSize(width,height);
      needsValidation = true;
    }
    camera.left=-halfWidth; camera.right=halfWidth; camera.top=extent; camera.bottom=-extent;
    camera.position.x=(cx/50-1)*halfWidth; camera.position.y=(1-cy/50)*extent;
    camera.zoom=zoom; camera.updateProjectionMatrix();
    for (const surface of [steel,shadow,emissive]) surface.opacity = Math.max(0,1 - (zoom-1)*1.18);
    antenna.visible = steel.opacity > .01;
    antenna.rotation.y = -.38 + Math.sin(phase*.4)*.24;
    antenna.rotation.z = -.10;
    antenna.scale.setScalar(Math.min(1,width/550)*.9);
    antenna.position.y=.063;
    for (const { points, material, parallax, drift } of dustPlanes) {
      // The labels and planets stay on the same orthographic projection.
      // Move each particle plane relative to the camera to give the zoom depth.
      const planeZoom = 1 + (zoom - 1) * parallax;
      const scale = planeZoom / zoom;
      points.scale.set(scale, scale, 1);
      points.position.set(
        camera.position.x * (1 - parallax * scale) + .07 * drift * Math.sin(phase * .17),
        camera.position.y * (1 - parallax * scale) + .05 * drift * Math.sin(phase * .13),
        0,
      );
      material.uniforms.magnification.value = 1 + (planeZoom - 1) * .28;
    }
    bodies.forEach(({body,planet,material,ring,ringMaterial,hair}, i) => {
      const hub = hubs[i];
      body.visible = Boolean(hub?.visible);
      if (!body.visible) return;
      const { x, y, size, active, color } = hub;
      body.position.set((x/50-1)*halfWidth,(1-y/50)*extent,.4);
      body.scale.setScalar(size*extent/height);
      material.uniforms.hue.value.set(active ? accent : color);
      material.uniforms.phase.value = phase*.29;
      planet.rotation.set(.08,.24+phase*.15,-.23+i*.13);
      ringMaterial.color.set(active ? accent : color);
      ring.rotation.set(1.15,-.15,phase*.13+i*.7);
      hair.rotation.copy(ring.rotation);
    });
    try {
      renderer.render(scene,camera);
      if (needsValidation) {
        needsValidation = false;
        // Some virtual GPUs report a complete framebuffer before failing on readback.
        context.readPixels(0, 0, 1, 1, context.RGBA, context.UNSIGNED_BYTE, new Uint8Array(4));
        if (context.getError() !== context.NO_ERROR) {
          throw new Error("WebGL framebuffer could not render the channel universe");
        }
        sky.classList.add("iv-3d");
      }
    } catch (error) {
      sky.classList.remove("iv-3d");
      canvas.remove();
      throw error;
    }
  };
}
