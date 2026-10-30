import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/**
 * The cel-shaded kit: banded toon materials and ink outlines.
 *
 * Shading: light falls on surfaces in a few hard bands (deep shadow, shadow, lit, highlight)
 * from a tiny gradient ramp, instead of a smooth gradient.
 * Outlines: each solid object gets an inked hull, its own geometry pushed out along smoothed
 * normals by a constant world width and drawn back-faces only in near-black, so it peeks out
 * round the silhouette like a pen line. Thin flat things (decals, paper, cracks) get none.
 */

let ramp: THREE.DataTexture | null = null;
/** Four bands: deep shadow, shadow, lit, highlight. */
export function toonRamp(): THREE.DataTexture {
  if (ramp) return ramp;
  const levels = [70, 140, 215, 255];
  const data = new Uint8Array(levels.length * 4);
  levels.forEach((v, i) => data.set([v, v, v, 255], i * 4));
  ramp = new THREE.DataTexture(data, levels.length, 1, THREE.RGBAFormat);
  ramp.minFilter = ramp.magFilter = THREE.NearestFilter;
  ramp.generateMipmaps = false;
  ramp.needsUpdate = true;
  return ramp;
}

export interface ToonOpts {
  map?: THREE.Texture | null;
  normalMap?: THREE.Texture | null;
  normalScale?: number;
  opacity?: number;
  emissive?: string;
  side?: THREE.Side;
}

/** A banded material in a flat colour (or over a painted map). */
export function toon(color: string | THREE.Color, o: ToonOpts = {}): THREE.MeshToonMaterial {
  const m = new THREE.MeshToonMaterial({
    color,
    gradientMap: toonRamp(),
    map: o.map ?? null,
    normalMap: o.normalMap ?? null,
    emissive: o.emissive ?? '#000000',
    transparent: o.opacity !== undefined && o.opacity < 1,
    opacity: o.opacity ?? 1,
    side: o.side ?? THREE.FrontSide,
  });
  if (o.normalMap) m.normalScale.set(o.normalScale ?? 1, o.normalScale ?? 1);
  if (m.transparent) m.depthWrite = false;
  return m;
}

import { inkMaterial } from '../../packages/marble-forge/src/three/ink';
export { INK, inkMaterial } from '../../packages/marble-forge/src/three/ink';

const hullCache = new WeakMap<THREE.BufferGeometry, THREE.BufferGeometry>();
/** The geometry with welded vertices and smooth normals, so the hull has no cracks at corners. */
function hullGeometry(g: THREE.BufferGeometry): THREE.BufferGeometry {
  let h = hullCache.get(g);
  if (h) return h;
  const base = g.clone();
  base.deleteAttribute('uv');
  base.deleteAttribute('uv1');
  base.deleteAttribute('normal');
  h = mergeVertices(base, 1e-3);
  h.computeVertexNormals();
  hullCache.set(g, h);
  return h;
}

/**
 * Ink every mesh under `root` (skipping transparent ones and anything marked `noInk`).
 * Returns the hull geometries it made, so the caller can dispose of them.
 */
export function ink(root: THREE.Object3D, width = 0.03): THREE.BufferGeometry[] {
  const made: THREE.BufferGeometry[] = [];
  const targets: THREE.Mesh[] = [];
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || mesh.userData.noInk || mesh.userData.isInk) return;
    const mat = mesh.material as THREE.Material;
    if (Array.isArray(mesh.material) || mat.transparent) return;
    targets.push(mesh);
  });
  for (const mesh of targets) {
    const hg = hullGeometry(mesh.geometry);
    made.push(hg);
    const hull = (mesh as THREE.InstancedMesh).isInstancedMesh
      ? new THREE.InstancedMesh(hg, inkMaterial(width), (mesh as THREE.InstancedMesh).count)
      : new THREE.Mesh(hg, inkMaterial(width));
    if ((hull as THREE.InstancedMesh).isInstancedMesh) {
      (hull as THREE.InstancedMesh).instanceMatrix = (mesh as THREE.InstancedMesh).instanceMatrix;
    }
    hull.userData.isInk = true;
    hull.castShadow = false;
    hull.receiveShadow = false;
    hull.frustumCulled = mesh.frustumCulled;
    mesh.add(hull);
  }
  return made;
}
