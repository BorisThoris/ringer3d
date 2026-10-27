import * as THREE from 'three';

/** Ink colour shared with the toon outlines. */
const INK = '#1b1530';

/**
 * A flat toon crosshair for the aim point: an ink-outlined band in the shooter's colour,
 * four outlined ticks and a centre dot. It lies on the ground (local XY tilted to XZ).
 * Free, it floats and turns slowly at the end of the aim line; locked onto a marble it
 * tightens around the contact point and pulses.
 */
export class Reticle {
  readonly group = new THREE.Group();
  private readonly colorMats: THREE.MeshBasicMaterial[] = [];
  private readonly spinner = new THREE.Group();
  private readonly ticks: THREE.Group[] = [];
  private lock = 0;

  constructor(radius: number) {
    const flat = (geo: THREE.BufferGeometry, color: string, opacity: number, z: number, tint: boolean) => {
      const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, side: THREE.DoubleSide, depthWrite: false });
      if (tint) this.colorMats.push(mat);
      const m = new THREE.Mesh(geo, mat);
      m.position.z = z;
      return m;
    };
    const r = radius;
    this.spinner.add(
      flat(new THREE.RingGeometry(r * 0.9, r * 1.4, 48), INK, 0.9, 0, false),
      flat(new THREE.RingGeometry(r * 0.99, r * 1.31, 48), '#ffffff', 1, 0.001, true),
    );
    for (let i = 0; i < 4; i++) {
      const t = new THREE.Group();
      t.rotation.z = (i * Math.PI) / 2 + Math.PI / 4;
      const ink = flat(new THREE.PlaneGeometry(r * 0.7, r * 0.36), INK, 0.9, 0, false);
      const fill = flat(new THREE.PlaneGeometry(r * 0.56, r * 0.2), '#ffffff', 1, 0.001, true);
      ink.position.x = fill.position.x = r * 1.72;
      t.add(ink, fill);
      this.ticks.push(t);
      this.spinner.add(t);
    }
    this.group.add(
      this.spinner,
      flat(new THREE.CircleGeometry(r * 0.2, 20), INK, 0.85, 0, false),
      flat(new THREE.CircleGeometry(r * 0.12, 20), '#ffffff', 1, 0.001, true),
    );
    this.group.rotation.x = -Math.PI / 2;
  }

  setColor(c: THREE.Color) {
    for (const m of this.colorMats) m.color.copy(c);
  }

  /** Place it; `locked` when the aim line meets a marble. `dt` in seconds. */
  update(x: number, y: number, z: number, locked: boolean, dt: number) {
    this.group.position.set(x, y, z);
    // Ease between free and locked so the snap reads as a pop rather than a jump.
    this.lock += ((locked ? 1 : 0) - this.lock) * Math.min(1, dt * 14);
    const t = performance.now() / 1000;
    this.spinner.rotation.z = locked ? this.spinner.rotation.z : this.spinner.rotation.z + dt * 0.9;
    const pulse = 1 + Math.sin(t * 7) * 0.06 * this.lock;
    const s = (1.15 - this.lock * 0.25) * pulse;
    this.group.scale.setScalar(s);
    // Ticks pull in towards the contact point when locked.
    for (const tick of this.ticks) tick.scale.setScalar(1 - this.lock * 0.18);
  }
}
