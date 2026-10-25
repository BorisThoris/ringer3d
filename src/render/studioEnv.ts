/**
 * A dark "studio" reflection environment for marble close-ups: a sky
 * gradient, a soft disc for the key light, rounded softbox strips and a ring
 * of small bokeh lights. Glass is mostly what it reflects; a white room
 * (RoomEnvironment) washes it milky, this keeps it clear with round
 * highlights. Ported from the ringer-parallel build.
 */
import * as THREE from 'three';

export interface EnvSpec {
  top: string;
  horizon: string;
  ground: string;
  /** Direction toward the key light (sun or lamp). */
  key: [number, number, number];
  keyColor: string;
  keyStrength: number;
}

export const STUDIO: EnvSpec = {
  top: '#1a2340',
  horizon: '#8394c0',
  ground: '#26324d',
  key: [0.5, 0.8, 0.35],
  keyColor: '#ffffff',
  keyStrength: 6,
};

function softDisc(color: THREE.Color, strength: number): THREE.MeshBasicMaterial {
  const c = document.createElement('canvas');
  c.width = c.height = 128;
  const g = c.getContext('2d')!;
  const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.55, 'rgba(255,255,255,0.9)');
  grad.addColorStop(1, 'rgba(255,255,255,0)');
  g.fillStyle = grad;
  g.fillRect(0, 0, 128, 128);
  const tex = new THREE.CanvasTexture(c);
  return new THREE.MeshBasicMaterial({ map: tex, color: color.clone().multiplyScalar(strength), transparent: true, side: THREE.DoubleSide, depthWrite: false });
}

/** Build the scene that gets baked into the reflection map. */
function envScene(spec: EnvSpec): THREE.Scene {
  const scene = new THREE.Scene();
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(50, 48, 24),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      uniforms: {
        top: { value: new THREE.Color(spec.top) },
        horizon: { value: new THREE.Color(spec.horizon) },
        ground: { value: new THREE.Color(spec.ground) },
      },
      vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
      fragmentShader: `uniform vec3 top; uniform vec3 horizon; uniform vec3 ground; varying vec3 vP;
        void main(){
          float h = vP.y;
          vec3 c = h > 0.0 ? mix(horizon, top, pow(h, 0.6)) : mix(horizon * 0.6, ground, pow(-h, 0.4));
          gl_FragColor = vec4(c, 1.0);
        }`,
    }),
  );
  scene.add(dome);

  const key = new THREE.Vector3(...spec.key).normalize();
  const keyColor = new THREE.Color(spec.keyColor);
  // The key: a big soft disc, so highlights on the glass are round, not boxes.
  const sun = new THREE.Mesh(new THREE.PlaneGeometry(14, 14), softDisc(keyColor, spec.keyStrength));
  sun.position.copy(key).multiplyScalar(40);
  sun.lookAt(0, 0, 0);
  scene.add(sun);

  // Two long softbox strips and a faint rim from behind: the "studio" sparkle.
  const strip = (pos: THREE.Vector3, w: number, h: number, s: number, color = '#ffffff') => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), softDisc(new THREE.Color(color), s));
    m.position.copy(pos);
    m.lookAt(0, 0, 0);
    scene.add(m);
  };
  const side = new THREE.Vector3(-key.z, 0.35, key.x).normalize();
  strip(side.clone().multiplyScalar(38), 4, 22, 2.2);
  strip(side.clone().multiplyScalar(-38).setY(14), 3, 16, 1.2);
  strip(key.clone().multiplyScalar(-36).setY(6), 26, 3, 0.8, spec.horizon);
  // A ring of small lights around the horizon: the bokeh that makes glass
  // and chrome sparkle from any angle.
  for (let i = 0; i < 7; i++) {
    const a = (i / 7) * Math.PI * 2 + 0.4;
    const pos = new THREE.Vector3(Math.cos(a) * 34, 6 + (i % 3) * 7, Math.sin(a) * 34);
    strip(pos, 2.4, 2.4, 2.6, i % 2 ? '#ffe2b8' : '#d8ecff');
  }
  return scene;
}

export function buildEnvironment(renderer: THREE.WebGLRenderer, spec: EnvSpec): THREE.Texture {
  const pmrem = new THREE.PMREMGenerator(renderer);
  const scene = envScene(spec);
  const tex = pmrem.fromScene(scene, 0.0).texture;
  pmrem.dispose();
  scene.traverse((o) => {
    const m = o as THREE.Mesh;
    m.geometry?.dispose();
    const mat = m.material as THREE.Material & { map?: THREE.Texture };
    mat?.map?.dispose();
    mat?.dispose?.();
  });
  return tex;
}
