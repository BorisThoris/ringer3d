import * as THREE from 'three';
import type { MarbleLook } from '../game/marbles';
import { marbleTexture } from './textures';

export type Quality = 'low' | 'medium' | 'high';

const sphereGeo = new Map<string, THREE.SphereGeometry>();
function sphere(r: number, seg: number) {
  const k = `${r}:${seg}`;
  let g = sphereGeo.get(k);
  if (!g) {
    g = new THREE.SphereGeometry(r, seg, Math.round(seg * 0.75));
    sphereGeo.set(k, g);
  }
  return g;
}

function glassMaterial(look: MarbleLook, quality: Quality): THREE.Material {
  if (look.core === 'steelie') {
    return new THREE.MeshPhysicalMaterial({ color: look.base, metalness: 1, roughness: 0.12, clearcoat: 1, clearcoatRoughness: 0.05 });
  }
  if (look.clarity < 0.05) {
    return new THREE.MeshPhysicalMaterial({
      color: '#ffffff',
      map: marbleTexture('clay', look.base, look.accent2, 3),
      roughness: 0.75,
      clearcoat: 0.15,
    });
  }
  if (quality === 'low') {
    return new THREE.MeshPhysicalMaterial({
      color: look.base,
      transparent: true,
      opacity: 1 - look.clarity * 0.6,
      roughness: 0.05,
      clearcoat: 1,
      depthWrite: false,
    });
  }
  return new THREE.MeshPhysicalMaterial({
    color: look.base,
    transmission: look.clarity,
    thickness: 0.35,
    ior: 1.52,
    roughness: 0.03,
    clearcoat: 1,
    clearcoatRoughness: 0.02,
    iridescence: look.core === 'opal' ? 1 : 0,
    iridescenceIOR: 1.6,
    iridescenceThicknessRange: [200, 700],
    attenuationColor: new THREE.Color(look.base),
    attenuationDistance: 1.2,
    specularIntensity: 1,
  });
}

/**
 * Builds a marble: a glass shell plus an inner feature that sells "real marble" at a glance.
 * Returns a Group whose local origin is the marble centre.
 */
export function buildMarble(look: MarbleLook, radius: number, quality: Quality, seed = 1): THREE.Group {
  const group = new THREE.Group();
  const seg = quality === 'low' ? 20 : quality === 'medium' ? 32 : 48;
  const shell = new THREE.Mesh(sphere(radius, seg), glassMaterial(look, quality));
  shell.castShadow = true;
  shell.receiveShadow = false;
  shell.renderOrder = 2;
  group.add(shell);

  const inner = new THREE.Group();
  const emissive = (c: string) => new THREE.Color(c).multiplyScalar(look.glow);

  switch (look.core) {
    case 'catseye': {
      // Real cat's-eyes: 3–4 thin blades sharing one axis, like a propeller frozen in glass.
      const vaneGeo = new THREE.SphereGeometry(radius * 0.8, 24, 16);
      const blades = new THREE.Group();
      for (let i = 0; i < 4; i++) {
        const m = new THREE.Mesh(
          vaneGeo,
          new THREE.MeshStandardMaterial({
            color: i % 2 ? look.accent2 : look.accent,
            emissive: emissive(i % 2 ? look.accent2 : look.accent),
            roughness: 0.4,
          }),
        );
        m.scale.set(1, 0.07, 0.42);
        m.rotation.x = (i * Math.PI) / 4 + 0.15 * Math.sin(i * 2.3);
        blades.add(m);
      }
      blades.rotation.set(seed * 0.7, seed * 1.3, seed * 0.4);
      inner.add(blades);
      break;
    }
    case 'swirl':
    case 'neon':
    case 'galaxy':
    case 'onyx': {
      const kind = look.core === 'swirl' ? 'swirl' : look.core === 'neon' ? 'bands' : look.core === 'galaxy' ? 'galaxy' : 'cracks';
      const tex = marbleTexture(kind, look.accent, look.accent2, seed + 11);
      const m = new THREE.Mesh(
        sphere(radius * (look.core === 'onyx' ? 0.97 : 0.8), seg),
        new THREE.MeshStandardMaterial({
          map: tex,
          emissiveMap: tex,
          emissive: new THREE.Color('#ffffff').multiplyScalar(look.glow * (look.core === 'onyx' ? 1.6 : 0.9)),
          roughness: 0.5,
        }),
      );
      inner.add(m);
      break;
    }
    case 'opal': {
      const m = new THREE.Mesh(
        sphere(radius * 0.7, seg),
        new THREE.MeshPhysicalMaterial({ color: look.accent, iridescence: 1, roughness: 0.3, emissive: emissive(look.accent2) }),
      );
      inner.add(m);
      break;
    }
    case 'solid':
    case 'steelie':
      break;
  }
  if (inner.children.length) {
    inner.traverse((o) => {
      if ((o as THREE.Mesh).isMesh) (o as THREE.Mesh).renderOrder = 1;
    });
    group.add(inner);
  }
  return group;
}

export function disposeObject(o: THREE.Object3D) {
  o.traverse((c) => {
    const m = c as THREE.Mesh;
    if (m.isMesh) {
      const mats = Array.isArray(m.material) ? m.material : [m.material];
      for (const mat of mats) mat.dispose();
    }
  });
}
