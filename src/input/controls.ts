/**
 * Touch-first controls.
 *
 * - Drag anywhere and release: slingshot. Pull back away from where you want
 *   to shoot; the longer the pull, the harder the flick. Drag back to the
 *   start to cancel.
 * - Drag the shooter itself at the start of a turn: slide it along the ring
 *   line to pick your spot (knuckling down anywhere around the ring).
 * - Two fingers: orbit and pinch-zoom the camera. Desktop: right-drag orbits,
 *   wheel zooms, arrows/A-D fine-aim, W-S power, Space shoots.
 */
import type { Match } from '../game/match';
import { tap } from '../platform/haptics';
import type { Scene3D } from '../render/scene';

type Drag =
  | { kind: 'aim'; id: number; x0: number; y0: number }
  | { kind: 'place'; id: number }
  | { kind: 'orbit'; id: number; x: number; y: number }
  | null;

export class Controls {
  private drag: Drag = null;
  private pointers = new Map<number, { x: number; y: number }>();
  private pinch0 = 0;
  private zoom0 = 1;
  private keyPower = 0;
  match: Match | null = null;
  /** Called while aiming so the HUD can show power/angle. */
  onAimChange?: () => void;

  constructor(private canvas: HTMLCanvasElement, private scene: Scene3D) {
    canvas.addEventListener('pointerdown', this.down);
    window.addEventListener('pointermove', this.move);
    window.addEventListener('pointerup', this.up);
    window.addEventListener('pointercancel', this.cancel);
    canvas.addEventListener('wheel', this.wheel, { passive: false });
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', this.key);
  }

  /** Pull length (px) that means full power: about a third of the short screen side. */
  private fullPull(): number {
    return Math.max(120, Math.min(window.innerWidth, window.innerHeight) * 0.34);
  }

  private down = (e: PointerEvent): void => {
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      // Second finger: switch to camera gestures and drop any aim in progress.
      if (this.match && this.drag?.kind === 'aim') this.match.setAim(this.match.aim.yaw, 0);
      const [a, b] = [...this.pointers.values()];
      this.pinch0 = Math.hypot(a.x - b.x, a.y - b.y);
      this.zoom0 = this.scene.userZoom;
      this.drag = { kind: 'orbit', id: e.pointerId, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      return;
    }
    if (e.button === 2) {
      this.drag = { kind: 'orbit', id: e.pointerId, x: e.clientX, y: e.clientY };
      return;
    }
    const m = this.match;
    if (!m || !m.awaitingLocal) return;
    this.canvas.setPointerCapture?.(e.pointerId);
    if (m.canPlace) {
      const s = this.scene.toScreen(m.aim.from.x, m.config.shooterRadius, m.aim.from.z);
      if (Math.hypot(s.x - e.clientX, s.y - e.clientY) < 56) {
        this.drag = { kind: 'place', id: e.pointerId };
        return;
      }
    }
    this.drag = { kind: 'aim', id: e.pointerId, x0: e.clientX, y0: e.clientY };
  };

  private move = (e: PointerEvent): void => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const d = this.drag;
    if (!d) return;
    const m = this.match;
    if (d.kind === 'orbit') {
      if (this.pointers.size >= 2) {
        const [a, b] = [...this.pointers.values()];
        const mx = (a.x + b.x) / 2;
        this.scene.userYaw += (mx - d.x) * 0.006;
        d.x = mx;
        const dist = Math.hypot(a.x - b.x, a.y - b.y);
        if (this.pinch0 > 0) this.scene.userZoom = clamp(this.zoom0 * (this.pinch0 / dist), 0.45, 2.2);
      } else {
        this.scene.userYaw += (e.clientX - d.x) * 0.006;
        d.x = e.clientX;
      }
      return;
    }
    if (!m || e.pointerId !== d.id) return;
    if (d.kind === 'place') {
      const g = this.scene.groundAt(e.clientX, e.clientY);
      if (g) m.placeOnEdge(g);
      return;
    }
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    const len = Math.hypot(dx, dy);
    const power = clamp(len / this.fullPull(), 0, 1);
    if (m.isLagging) {
      m.setAim(0, power);
    } else if (len > 6) {
      // Screen drag -> ground vector; shoot the opposite way (slingshot).
      const { right, forward } = this.scene.groundBasis();
      const wx = right.x * dx - forward.x * dy;
      const wz = right.z * dx - forward.z * dy;
      m.setAim(Math.atan2(-wz, -wx), power);
    } else {
      m.setAim(m.aim.yaw, 0);
    }
    this.onAimChange?.();
  };

  private up = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    const d = this.drag;
    if (!d) return;
    if (d.kind === 'orbit') {
      if (this.pointers.size === 0) this.drag = null;
      return;
    }
    if (e.pointerId !== d.id) return;
    this.drag = null;
    const m = this.match;
    if (!m) return;
    if (d.kind === 'place') {
      this.scene.frame('aim', m.aim.from, m.aim.yaw);
      return;
    }
    if (m.aim.power >= 0.03) {
      tap(m.aim.power > 0.7 ? 'heavy' : 'medium');
      m.fireLocal();
    } else m.setAim(m.aim.yaw, 0);
    this.onAimChange?.();
  };

  private cancel = (e: PointerEvent): void => {
    this.pointers.delete(e.pointerId);
    if (this.drag && 'id' in this.drag && this.drag.id === e.pointerId) {
      this.match?.setAim(this.match.aim.yaw, 0);
      this.drag = null;
    }
  };

  private wheel = (e: WheelEvent): void => {
    e.preventDefault();
    this.scene.userZoom = clamp(this.scene.userZoom * Math.exp(e.deltaY * 0.001), 0.45, 2.2);
  };

  private key = (e: KeyboardEvent): void => {
    const m = this.match;
    if (!m || !m.awaitingLocal || e.target instanceof HTMLInputElement) return;
    const fine = e.shiftKey ? 0.002 : 0.012;
    switch (e.key) {
      case 'ArrowLeft':
      case 'a':
        if (m.canPlace && e.altKey) m.placeOnEdge(rot(m.aim.from, -0.03));
        else if (!m.isLagging) m.setAim(m.aim.yaw - fine, m.aim.power);
        break;
      case 'ArrowRight':
      case 'd':
        if (m.canPlace && e.altKey) m.placeOnEdge(rot(m.aim.from, 0.03));
        else if (!m.isLagging) m.setAim(m.aim.yaw + fine, m.aim.power);
        break;
      case 'ArrowUp':
      case 'w':
        this.keyPower = clamp(this.keyPower + 0.02, 0, 1);
        m.setAim(m.aim.yaw, this.keyPower);
        break;
      case 'ArrowDown':
      case 's':
        this.keyPower = clamp(this.keyPower - 0.02, 0, 1);
        m.setAim(m.aim.yaw, this.keyPower);
        break;
      case ' ':
        e.preventDefault();
        if (m.aim.power >= 0.03) {
          m.fireLocal();
          this.keyPower = 0;
        }
        break;
      default:
        return;
    }
    this.onAimChange?.();
  };

  /** Turn the aim by a fixed step (HUD buttons). */
  nudge(delta: number): void {
    const m = this.match;
    if (!m || !m.awaitingLocal || m.isLagging) return;
    m.setAim(m.aim.yaw + delta, m.aim.power);
    this.onAimChange?.();
  }

  /** Slide the shooter around the ring (HUD buttons). */
  slide(delta: number): void {
    const m = this.match;
    if (!m || !m.canPlace) return;
    m.placeOnEdge(rot(m.aim.from, delta));
    m.setAim(Math.atan2(-m.aim.from.z, -m.aim.from.x), 0);
    this.scene.frame('aim', m.aim.from, m.aim.yaw);
    this.onAimChange?.();
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function rot(p: { x: number; z: number }, a: number): { x: number; z: number } {
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: p.x * c - p.z * s, z: p.x * s + p.z * c };
}
