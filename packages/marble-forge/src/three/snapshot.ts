import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import type { MarbleLook } from '../look';
import { advanceMarbles } from './effects';
import { buildMarble, disposeObject, type Quality } from './marble';
import { buildEnvironment, STUDIO } from './studio';

/**
 * Still images and models of single marbles, off screen: the asset pack, thumbnails, shop art.
 *
 * Transparent PNGs come from difference matting: the marble is rendered once over black and
 * once over white, and the difference between the two is how much background shows through
 * each pixel. Glass keeps its tint and its refraction, which a plain transparent canvas
 * (refracting nothing) would turn milky grey.
 */

export interface SnapshotOptions {
  /** Square size in pixels. */
  size?: number;
  /** 'transparent' (matted PNG) or a CSS colour. */
  background?: 'transparent' | string;
  quality?: Quality;
  /** Phenomenon clock, seconds: pick the frame of an animated effect. */
  time?: number;
  /** Turn of the marble round its vertical axis, radians. */
  turn?: number;
  /** Camera elevation, radians. */
  tilt?: number;
}

let shared: { renderer: THREE.WebGLRenderer; studio: THREE.Texture; room: THREE.Texture } | null = null;

function stage() {
  if (shared) return shared;
  const renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true, alpha: false });
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  const studio = buildEnvironment(renderer, STUDIO);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const room = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  pmrem.dispose();
  shared = { renderer, studio, room };
  return shared;
}

function scene(look: MarbleLook, o: SnapshotOptions) {
  const { studio, room } = stage();
  const s = new THREE.Scene();
  s.environment = look.core === 'steelie' ? room : studio;
  const key = new THREE.DirectionalLight('#ffffff', 2.4);
  key.position.set(2, 4, 3);
  const rim = new THREE.PointLight(look.ui ?? look.accent, 24, 0, 2);
  rim.position.set(-2.5, 1.2, -2);
  s.add(key, rim, new THREE.HemisphereLight('#c8dcff', '#202030', 0.6));
  const m = buildMarble(look, 1, o.quality ?? 'high', 3.7);
  // The ink outline belongs to the cel-shaded game; a product shot is clean glass.
  m.group.traverse((c) => {
    if (c.userData.isInk) c.visible = false;
  });
  m.group.rotation.y = o.turn ?? 0.6;
  s.add(m.group);
  const cam = new THREE.PerspectiveCamera(26, 1, 0.1, 100);
  const tilt = o.tilt ?? 0.22;
  cam.position.set(0, Math.sin(tilt) * 5.2, Math.cos(tilt) * 5.2);
  cam.lookAt(0, 0, 0);
  return { s, cam, dispose: () => disposeObject(m.group) };
}

function renderOver(color: string, look: MarbleLook, o: SnapshotOptions, size: number): ImageData {
  const { renderer } = stage();
  renderer.setPixelRatio(1);
  renderer.setSize(size, size, false);
  const { s, cam, dispose } = scene(look, o);
  s.background = new THREE.Color(color);
  advanceMarbles(o.time ?? 1.5);
  renderer.render(s, cam);
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const g = c.getContext('2d')!;
  g.drawImage(renderer.domElement, 0, 0, size, size);
  dispose();
  return g.getImageData(0, 0, size, size);
}

/** One marble as a canvas. */
export function snapshot(look: MarbleLook, o: SnapshotOptions = {}): HTMLCanvasElement {
  const size = o.size ?? 512;
  const bg = o.background ?? 'transparent';
  const out = document.createElement('canvas');
  out.width = out.height = size;
  const g = out.getContext('2d')!;
  if (bg !== 'transparent') {
    g.putImageData(renderOver(bg, look, o, size), 0, 0);
    return out;
  }
  const black = renderOver('#000000', look, o, size).data;
  const white = renderOver('#ffffff', look, o, size).data;
  const img = g.createImageData(size, size);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    // How much of the background survives: white minus black, per channel (the average).
    const through = (white[i] - black[i] + white[i + 1] - black[i + 1] + white[i + 2] - black[i + 2]) / (3 * 255);
    const a = Math.min(1, Math.max(0, 1 - through));
    d[i + 3] = Math.round(a * 255);
    if (a > 0.004) {
      d[i] = Math.min(255, black[i] / a);
      d[i + 1] = Math.min(255, black[i + 1] / a);
      d[i + 2] = Math.min(255, black[i + 2] / a);
    }
  }
  g.putImageData(img, 0, 0);
  return out;
}

/**
 * The marble as a binary glTF (.glb), unit radius, with standard PBR materials (transmission,
 * iridescence, sheen and clearcoat travel as glTF extensions). Shader-only parts (the ink, the
 * animated phenomena) have no glTF form: a phenomenon becomes a glowing core in its colour.
 */
export async function exportGlb(look: MarbleLook): Promise<ArrayBuffer> {
  const m = buildMarble(look, 1, 'high', 3.7);
  const drop: THREE.Object3D[] = [];
  m.group.traverse((c) => {
    const mesh = c as THREE.Mesh;
    if ((mesh.isMesh || (c as THREE.Points).isPoints) && (mesh.material as THREE.Material).type === 'ShaderMaterial') drop.push(c);
  });
  for (const c of drop) c.parent?.remove(c);
  if (look.effect && look.effect !== 'none') {
    const col = new THREE.Color(look.effectColor ?? look.accent);
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 32, 22), new THREE.MeshStandardMaterial({ color: col, emissive: col, emissiveIntensity: 2.5, roughness: 0.4 }));
    core.name = `phenomenon-${look.effect}`;
    m.group.add(core);
  }
  m.group.name = look.name;
  const glb = (await new GLTFExporter().parseAsync(m.group, { binary: true })) as ArrayBuffer;
  disposeObject(m.group);
  return glb;
}
