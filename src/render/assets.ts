import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { HDRLoader } from 'three/examples/jsm/loaders/HDRLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';

/**
 * Loaders for the CC0 field assets in public/assets (sources in public/assets/CREDITS.md).
 * Everything is cached by path and shared between fields; a failed load resolves to null
 * so a field always renders, falling back to its procedural look (offline, slow network).
 */

const BASE = './assets/';
/** World units per metre (1 unit ≈ 4 cm, see core/constants). */
export const UNITS_PER_METRE = 25;

const cache = new Map<string, Promise<unknown>>();
function once<T>(key: string, make: () => Promise<T>): Promise<T> {
  let p = cache.get(key) as Promise<T> | undefined;
  if (!p) {
    p = make();
    cache.set(key, p);
  }
  return p;
}

const texLoader = new THREE.TextureLoader();
const hdrLoader = new HDRLoader();
const gltf = new GLTFLoader();
gltf.setMeshoptDecoder(MeshoptDecoder);

function texture(path: string, srgb: boolean): Promise<THREE.Texture | null> {
  return once(`tex:${path}`, () =>
    texLoader
      .loadAsync(BASE + path)
      .then((t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
        t.anisotropy = 8;
        return t;
      })
      .catch(() => null),
  );
}

export interface PBRSet {
  map: THREE.Texture;
  normalMap: THREE.Texture | null;
  roughnessMap: THREE.Texture | null;
}

/** A scanned material: `<folder>/<id>_diff.jpg`, `_nor.jpg` (OpenGL normals), `_rough.jpg`. */
export async function pbr(folder: string, id: string): Promise<PBRSet | null> {
  const [map, normalMap, roughnessMap] = await Promise.all([
    texture(`${folder}/${id}_diff.jpg`, true),
    texture(`${folder}/${id}_nor.jpg`, false),
    texture(`${folder}/${id}_rough.jpg`, false),
  ]);
  return map ? { map, normalMap, roughnessMap } : null;
}

/**
 * Apply a scanned material to a standard material, tiled so one tile covers
 * `tileMetres` of real ground across a surface `sizeUnits` wide (x) and deep (y).
 * Clones the textures so each surface can tile independently.
 */
export function applyPBR(mat: THREE.MeshStandardMaterial, set: PBRSet, sizeUnits: [number, number], tileMetres: number, normalScale = 1) {
  const rx = sizeUnits[0] / (tileMetres * UNITS_PER_METRE);
  const ry = sizeUnits[1] / (tileMetres * UNITS_PER_METRE);
  const tile = (t: THREE.Texture | null) => {
    if (!t) return null;
    const c = t.clone();
    c.repeat.set(rx, ry);
    c.needsUpdate = true;
    return c;
  };
  mat.map = tile(set.map);
  mat.normalMap = tile(set.normalMap);
  mat.roughnessMap = tile(set.roughnessMap);
  mat.normalScale.set(normalScale, normalScale);
  mat.color.set('#ffffff');
  mat.roughness = 1;
  mat.needsUpdate = true;
}

/** Linear HDR panorama for lighting and reflections. */
export function hdri(folder: string): Promise<THREE.DataTexture | null> {
  return once(`hdr:${folder}`, () =>
    hdrLoader
      .loadAsync(`${BASE}${folder}/sky.hdr`)
      .then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        return t;
      })
      .catch(() => null),
  );
}

/** Sharper tonemapped panorama for the visible backdrop. */
export function backdrop(folder: string): Promise<THREE.Texture | null> {
  return once(`bg:${folder}`, () =>
    texLoader
      .loadAsync(`${BASE}${folder}/backdrop.jpg`)
      .then((t) => {
        t.mapping = THREE.EquirectangularReflectionMapping;
        t.colorSpace = THREE.SRGBColorSpace;
        return t;
      })
      .catch(() => null),
  );
}

/** A scanned prop (real-world metres, Y up). Returns a fresh clone sharing geometry/materials. */
export async function model(folder: string, id: string): Promise<THREE.Group | null> {
  const scene = await once(`glb:${folder}/${id}`, () =>
    gltf
      .loadAsync(`${BASE}${folder}/models/${id}.glb`)
      .then((g) => {
        g.scene.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
            // Shared with the cache: field teardown must not dispose these.
            m.userData.shared = true;
          }
        });
        return g.scene;
      })
      .catch(() => null),
  );
  return scene ? (scene.clone(true) as THREE.Group) : null;
}

/** Decoded audio for a sound file, or null. */
export function sample(ctx: BaseAudioContext, name: string): Promise<AudioBuffer | null> {
  return once(`sfx:${name}`, () =>
    fetch(`${BASE}sfx/${name}.ogg`)
      .then((r) => (r.ok ? r.arrayBuffer() : null))
      .then((b) => (b ? ctx.decodeAudioData(b) : null))
      .catch(() => null),
  );
}
