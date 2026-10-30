import * as THREE from 'three';
import type { MarbleLook } from '../look';
import type { Quality } from './marble';

/**
 * Phenomena: living effects inside the glass. Each is ray-marched through the marble's interior
 * in its own shader (a fire, an aurora, a thundercloud...), so it has real depth as the marble
 * turns, and moves with a shared clock.
 *
 * The glowing volume is a shell just outside the glass that marches the sphere inside it, drawn
 * additively after the glass: light inside the marble reads clearly even through dark tinted
 * glass (which would swallow anything three.js refracts), and other marbles in front still hide
 * it. The black hole's core and the geode's crystals are ordinary meshes inside the glass.
 */

/**
 * Shared time (seconds) for every phenomenon. Call advanceMarbles() each frame; any number of
 * views may call it, it follows the wall clock. Pass a time to render a chosen frame (exports).
 */
export const forgeClock = { value: 0 };
export function advanceMarbles(time = performance.now() / 1000) {
  forgeClock.value = time;
}

const NOISE = /* glsl */ `
  float hash(vec3 p) {
    p = fract(p * 0.3183099 + 0.1);
    p *= 17.0;
    return fract(p.x * p.y * p.z * (p.x + p.y + p.z));
  }
  float noise(vec3 x) {
    vec3 i = floor(x);
    vec3 f = fract(x);
    f = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(mix(hash(i), hash(i + vec3(1, 0, 0)), f.x), mix(hash(i + vec3(0, 1, 0)), hash(i + vec3(1, 1, 0)), f.x), f.y),
      mix(mix(hash(i + vec3(0, 0, 1)), hash(i + vec3(1, 0, 1)), f.x), mix(hash(i + vec3(0, 1, 1)), hash(i + vec3(1, 1, 1)), f.x), f.y),
      f.z);
  }
  float fbm(vec3 p) {
    float a = 0.5, s = 0.0;
    for (int i = 0; i < 4; i++) {
      s += a * noise(p);
      p = p * 2.03 + vec3(1.7, 9.2, 3.1);
      a *= 0.5;
    }
    return s;
  }
`;

/** Density and colour at q (unit-sphere coordinates) for each phenomenon. */
const SAMPLERS: Record<string, string> = {
  inferno: /* glsl */ `
    vec4 fx(vec3 q, float rr) {
      vec3 w = vec3(fbm(q * 1.6 + uTime * 0.25), 0.0, fbm(q * 1.6 - uTime * 0.2));
      float n = fbm(q * 2.6 + w * 1.4 + vec3(0.0, -uTime * 1.3, 0.0));
      float rise = smoothstep(-1.0, 0.6, q.y * 0.6 + n * 0.9 - rr * 0.5);
      float d = smoothstep(0.42, 0.78, n) * smoothstep(0.95, 0.15, rr) * (0.4 + rise);
      vec3 col = mix(uColor * 0.8, vec3(1.0, 0.82, 0.38), smoothstep(0.55, 0.85, n));
      col = mix(col, vec3(1.0, 0.97, 0.85), smoothstep(0.78, 0.95, n) * smoothstep(0.6, 0.0, rr));
      return vec4(col * (2.2 + 3.0 * d), d * 1.8);
    }`,
  aurora: /* glsl */ `
    vec4 fx(vec3 q, float rr) {
      float warp = fbm(q * 2.0 + vec3(uTime * 0.12, 0.0, uTime * 0.08));
      float w = sin((q.x + 0.35 * sin(q.z * 3.0 + uTime * 0.6) + warp * 0.8) * 8.0);
      float band = smoothstep(0.72, 1.0, w) * (0.5 + noise(vec3(q.x * 6.0, q.y * 30.0 - uTime, q.z * 6.0)) * 0.8);
      float vert = smoothstep(-0.75, -0.1, q.y) * smoothstep(0.85, 0.15, q.y);
      float d = band * vert * smoothstep(1.0, 0.55, rr);
      vec3 col = mix(uColor, uColor2, smoothstep(-0.4, 0.6, q.y));
      return vec4(col * 3.2, d * 1.3);
    }`,
  void: /* glsl */ `
    vec4 fx(vec3 q, float rr) {
      vec3 p = q;
      float rad = length(p.xz);
      float ang = atan(p.z, p.x);
      float ring = exp(-pow((rad - 0.58) / 0.17, 2.0)) * exp(-pow(p.y / (0.035 + rad * 0.05), 2.0));
      float s = fbm(vec3(ang * 2.5 - uTime * 2.2 + rad * 9.0, rad * 5.0, 0.0));
      float halo = exp(-pow((rr - 0.31) / 0.03, 2.0)) * 0.6;
      float d = ring * (0.35 + s * 1.2) + halo;
      vec3 col = mix(vec3(1.0, 0.94, 0.82), uColor, smoothstep(0.42, 0.8, rad));
      return vec4(col * 4.0, d * 1.6);
    }`,
  storm: /* glsl */ `
    vec4 fx(vec3 q, float rr) {
      float beat = floor(uTime * 2.7);
      float flash = step(0.55, fract(sin(beat * 43.7) * 917.3)) * (1.0 - fract(uTime * 2.7));
      float n = fbm(q * 2.8 + vec3(uTime * 0.18, 0.0, uTime * 0.07));
      float cloud = smoothstep(0.44, 0.8, n) * smoothstep(1.0, 0.35, rr);
      // The bolts themselves are meshes (stormBolts); the cloud lights up when one strikes.
      vec3 col = uColor * (0.35 + flash * 2.2) * cloud;
      return vec4(col * 3.0, cloud * 0.8);
    }`,
  geode: /* glsl */ `
    vec4 fx(vec3 q, float rr) {
      float pulse = 0.75 + 0.25 * sin(uTime * 1.6);
      float d = smoothstep(0.55, 0.0, rr) * 0.5 * pulse;
      return vec4(uColor * 3.0, d);
    }`,
  starfall: /* glsl */ `
    vec4 fx(vec3 q, float rr) {
      float n = fbm(q * 2.2 + vec3(0.0, uTime * 0.06, uTime * 0.04));
      float d = smoothstep(0.5, 0.85, n) * smoothstep(0.95, 0.2, rr) * 0.45;
      vec3 col = mix(uColor, uColor2, n);
      return vec4(col * 2.4, d);
    }`,
  // Not phenomena: the deep interiors of the galaxy and onyx patterns, in the marble's own colours.
  nebula: /* glsl */ `
    vec4 fx(vec3 q, float rr) {
      float n = fbm(q * 2.4 + vec3(uTime * 0.03, 0.0, -uTime * 0.02));
      float n2 = fbm(q * 4.5 - vec3(0.0, uTime * 0.02, 0.0));
      float d = smoothstep(0.42, 0.85, n) * smoothstep(1.0, 0.15, rr) * 0.55;
      vec3 col = mix(uColor, uColor2, smoothstep(0.3, 0.8, n2));
      float star = step(0.992, hash(floor(q * 26.0))) * smoothstep(1.0, 0.6, rr);
      return vec4(col * 2.2 + vec3(star) * 9.0, d + star * 0.9);
    }`,
  magma: /* glsl */ `
    vec4 fx(vec3 q, float rr) {
      float n = fbm(q * 2.6 + vec3(0.0, uTime * 0.04, 0.0));
      float vein = pow(1.0 - abs(n * 2.0 - 1.0), 40.0);
      float pulse = 0.8 + 0.2 * sin(uTime * 1.3 + n * 9.0);
      float d = vein * smoothstep(1.0, 0.35, rr) * pulse;
      vec3 col = mix(uColor, uColor2, smoothstep(0.3, 0.9, vein));
      return vec4(col * 2.4, d * 0.9);
    }`,
};

function volumeMaterial(kind: string, look: MarbleLook, R: number, steps: number): THREE.ShaderMaterial {
  const own = kind === 'nebula' || kind === 'magma';
  const c = new THREE.Color(own ? look.accent : look.effectColor ?? look.accent);
  const hsl = { h: 0, s: 0, l: 0 };
  c.getHSL(hsl);
  const c2 = own ? new THREE.Color(look.accent2) : new THREE.Color().setHSL(hsl.h + (kind === 'aurora' ? 0.28 : 0.12), 1, 0.62);
  return new THREE.ShaderMaterial({
    uniforms: { uTime: forgeClock, uR: { value: R }, uColor: { value: c }, uColor2: { value: c2 } },
    defines: kind === 'void' ? { STEPS: steps, VOID_CORE: 0.27 } : { STEPS: steps },
    transparent: true,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: /* glsl */ `
      varying vec3 vPos;
      varying vec3 vCam;
      void main() {
        vPos = position;
        vCam = (inverse(modelMatrix) * vec4(cameraPosition, 1.0)).xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }`,
    fragmentShader: /* glsl */ `
      uniform float uTime;
      uniform float uR;
      uniform vec3 uColor;
      uniform vec3 uColor2;
      varying vec3 vPos;
      varying vec3 vCam;
      ${NOISE}
      ${SAMPLERS[kind]}
      void main() {
        vec3 rd = normalize(vPos - vCam);
        // This shell sits just outside the glass; march the inner sphere (radius uR) the ray crosses.
        float b = dot(vPos, rd);
        float h = b * b - (dot(vPos, vPos) - uR * uR);
        if (h <= 0.0) discard;
        float t0 = max(0.0, -b - sqrt(h));
        float t1 = -b + sqrt(h);
        float dt = (t1 - t0) / float(STEPS);
        vec3 acc = vec3(0.0);
        float a = 0.0;
        for (int i = 0; i < STEPS; i++) {
          vec3 q = (vPos + rd * (t0 + dt * (float(i) + 0.5))) / uR;
          #ifdef VOID_CORE
          if (length(q) < VOID_CORE / 0.9) break;
          #endif
          vec4 s = fx(q, length(q));
          float k = clamp(s.a * dt / uR * 1.2, 0.0, 1.0);
          acc += (1.0 - a) * s.rgb * k;
          a += (1.0 - a) * k;
        }
        gl_FragColor = vec4(acc * 0.55, 1.0);
        #include <colorspace_fragment>
      }`,
  });
}

/** Stars on tilted orbits round the centre, moved in the vertex shader. */
function starfield(look: MarbleLook, r: number, count: number): THREE.Points {
  const orbit = new Float32Array(count * 3);
  const axis = new Float32Array(count * 3);
  let s = 1234567;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  for (let i = 0; i < count; i++) {
    // Out past the opaque cores some patterns have (opal, galaxy), just under the glass.
    orbit.set([r * (0.72 + rand() * 0.16), 0.4 + rand() * 1.4, rand() * Math.PI * 2], i * 3);
    const a = new THREE.Vector3(rand() - 0.5, 1.6, rand() - 0.5).normalize();
    axis.set([a.x, a.y, a.z], i * 3);
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(new Float32Array(count * 3), 3));
  g.setAttribute('orbit', new THREE.Float32BufferAttribute(orbit, 3));
  g.setAttribute('axis', new THREE.Float32BufferAttribute(axis, 3));
  g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), r);
  const m = new THREE.ShaderMaterial({
    uniforms: { uTime: forgeClock, uSize: { value: r * 420 }, uColor: { value: new THREE.Color(look.effectColor ?? '#ffffff').lerp(new THREE.Color('#ffffff'), 0.55) } },
    blending: THREE.AdditiveBlending,
    depthWrite: false,
    vertexShader: /* glsl */ `
      uniform float uTime;
      uniform float uSize;
      attribute vec3 orbit;
      attribute vec3 axis;
      varying float vTw;
      void main() {
        vec3 u = normalize(cross(axis, vec3(0.0, 0.0, 1.0)));
        vec3 v = cross(axis, u);
        float a = orbit.z + uTime * orbit.y;
        vec3 p = (u * cos(a) + v * sin(a)) * orbit.x;
        vec4 mv = modelViewMatrix * vec4(p, 1.0);
        vTw = 0.6 + 0.4 * sin(uTime * 5.0 + orbit.z * 13.0);
        gl_PointSize = uSize * vTw / -mv.z;
        gl_Position = projectionMatrix * mv;
      }`,
    fragmentShader: /* glsl */ `
      uniform vec3 uColor;
      varying float vTw;
      void main() {
        vec2 d = gl_PointCoord - 0.5;
        float l = length(d);
        float core = smoothstep(0.5, 0.0, l);
        float rays = max(smoothstep(0.08, 0.0, abs(d.x)), smoothstep(0.08, 0.0, abs(d.y))) * smoothstep(0.5, 0.1, l);
        gl_FragColor = vec4(uColor * (core * core * 3.0 + rays * 1.5) * vTw, 1.0);
        #include <colorspace_fragment>
      }`,
  });
  return new THREE.Points(g, m);
}

/** How bright the storm's lightning is at time t (0 between strikes); the shader uses the same. */
export function stormFlash(t: number): number {
  const beat = Math.floor(t * 2.7);
  const x = Math.sin(beat * 43.7) * 917.3;
  return x - Math.floor(x) > 0.55 ? 1 - (t * 2.7 - Math.floor(t * 2.7)) : 0;
}

/** Jagged lightning bolts through the cloud; a different one lights on every strike. */
function stormBolts(look: MarbleLook, r: number): THREE.Group {
  const g = new THREE.Group();
  let s = 424243;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const color = new THREE.Color(look.effectColor ?? '#9fe6ff').lerp(new THREE.Color('#ffffff'), 0.7);
  const bolts: THREE.Mesh[] = [];
  for (let b = 0; b < 5; b++) {
    // A main channel from the top of the cloud down, with a fork.
    const pts: THREE.Vector3[] = [];
    let p = new THREE.Vector3((rand() - 0.5) * r * 0.5, r * 0.62, (rand() - 0.5) * r * 0.5);
    for (let i = 0; i < 9; i++) {
      pts.push(p.clone());
      p = p.clone().add(new THREE.Vector3((rand() - 0.5) * r * 0.32, -r * 0.14, (rand() - 0.5) * r * 0.32));
      if (p.length() > r * 0.8) p.setLength(r * 0.78);
    }
    const geo = new THREE.TubeGeometry(new THREE.CatmullRomCurve3(pts, false, 'catmullrom', 0.05), 40, r * 0.022, 5, false);
    // Opaque-pass additive, so the glass refracts it; three forces alpha to 1 in that pass, so
    // the flash scales the colour itself.
    const mat = new THREE.ShaderMaterial({
      uniforms: { uColor: { value: color.clone().multiplyScalar(4) }, uFlash: { value: 0 } },
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      vertexShader: 'void main() { gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }',
      fragmentShader: 'uniform vec3 uColor; uniform float uFlash; void main() { gl_FragColor = vec4(uColor * uFlash, 1.0); }',
    });
    const bolt = new THREE.Mesh(geo, mat);
    bolts.push(bolt);
    g.add(bolt);
  }
  // Each bolt lights only on its own strikes; the rest of the time it is dark.
  bolts.forEach((b, i) => {
    b.onBeforeRender = () => {
      const t = forgeClock.value;
      (b.material as THREE.ShaderMaterial).uniforms.uFlash.value = Math.floor(t * 2.7) % bolts.length === i ? Math.min(1, stormFlash(t) * 1.6) : 0;
    };
  });
  return g;
}

/** Crystals growing inward from the shell. */
function crystals(look: MarbleLook, r: number, count: number): THREE.InstancedMesh {
  const cone = new THREE.ConeGeometry(r * 0.07, r * 0.38, 6, 1);
  cone.translate(0, -r * 0.19, 0);
  const color = new THREE.Color(look.effectColor ?? look.accent);
  const mesh = new THREE.InstancedMesh(
    cone,
    new THREE.MeshPhysicalMaterial({ color, emissive: color, emissiveIntensity: 0.55, roughness: 0.08, metalness: 0.15, flatShading: true, clearcoat: 1 }),
    count,
  );
  let s = 7654321;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const m = new THREE.Matrix4();
  const up = new THREE.Vector3(0, 1, 0);
  for (let i = 0; i < count; i++) {
    // A cluster on one side, like a split geode, thinning out round the rest.
    const p = new THREE.Vector3(rand() * 2 - 1, rand() * 2 - 1, rand() * 2 - 1).normalize();
    if (p.y > 0.55 && rand() < 0.7) p.y = -p.y;
    const q = new THREE.Quaternion().setFromUnitVectors(up, p);
    m.compose(p.clone().multiplyScalar(r * 0.84), q, new THREE.Vector3(1, 1, 1).multiplyScalar(0.55 + rand() * 0.9));
    mesh.setMatrixAt(i, m);
  }
  return mesh;
}

/** The phenomenon inside a marble, or null when it has none. */
/** A deep interior for the top patterns: a drifting nebula with stars (galaxy), magma veins (onyx). */
export function buildCoreVolume(kind: 'nebula' | 'magma', look: MarbleLook, r: number, quality: Quality): THREE.Mesh {
  const steps = quality === 'low' ? 8 : quality === 'medium' ? 12 : 18;
  const m = new THREE.Mesh(new THREE.SphereGeometry(r * 1.03, 64, 44), volumeMaterial(kind, look, r * 0.9, steps));
  m.renderOrder = 2.5;
  m.userData.noInk = true;
  m.name = `core-${kind}`;
  return m;
}

export function buildEffect(look: MarbleLook, r: number, quality: Quality): THREE.Object3D | null {
  const kind = look.effect;
  if (!kind || kind === 'none') return null;
  const group = new THREE.Group();
  group.name = `effect-${kind}`;
  const R = r * 0.9;
  const steps = quality === 'low' ? 8 : quality === 'medium' ? 14 : 22;
  const volume = new THREE.Mesh(new THREE.SphereGeometry(r * 1.03, 64, 44), volumeMaterial(kind, look, R, steps));
  group.add(volume);
  if (kind === 'void') {
    const core = new THREE.Mesh(new THREE.SphereGeometry(r * 0.27, 32, 22), new THREE.MeshBasicMaterial({ color: '#000000' }));
    group.add(core);
    group.rotation.set(0.35, 0, 0.2);
  }
  if (kind === 'geode') group.add(crystals(look, r, quality === 'low' ? 40 : 90));
  if (kind === 'starfall') group.add(starfield(look, r, quality === 'low' ? 30 : 70));
  if (kind === 'storm') group.add(stormBolts(look, r));
  // Solid parts with the interior, seen through the glass (renderOrder 2); the glow over the glass.
  group.traverse((o) => {
    o.renderOrder = o === volume ? 2.5 : 1.4;
    o.userData.noInk = true;
  });
  return group;
}
