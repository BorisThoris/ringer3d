import type { GameSession } from '../game/session';
import { settings } from '../game/settings';
import type { GameView } from './GameView';

/**
 * Touch-first input:
 *  - drag anywhere          → rotate aim (slow drags are automatically finer)
 *  - drag the shooter       → slide it around the ring line (first shot of a turn)
 *  - vertical drag          → tilt the camera
 *  - pinch / mouse wheel    → zoom
 * Keyboard: ←/→ aim (Shift = fine), A/D slide along the ring, hold Space to charge,
 * Q/E spin, T top view, F fast-forward, Esc cancel.
 */
export class Controls {
  private view: GameView;
  private getSession: () => GameSession | null;
  private pointers = new Map<number, { x: number; y: number }>();
  private mode: 'none' | 'aim' | 'place' | 'pinch' = 'none';
  private pinchDist = 0;
  private keysDown = new Set<string>();
  private raf = 0;
  private last = performance.now();

  constructor(view: GameView, getSession: () => GameSession | null) {
    this.view = view;
    this.getSession = getSession;
    const c = view.canvas;
    c.addEventListener('pointerdown', this.down);
    c.addEventListener('pointermove', this.move);
    c.addEventListener('pointerup', this.up);
    c.addEventListener('pointercancel', this.up);
    c.addEventListener('wheel', this.wheel, { passive: false });
    window.addEventListener('keydown', this.keydown);
    window.addEventListener('keyup', this.keyup);
    this.raf = requestAnimationFrame(this.keyLoop);
  }

  private down = (e: PointerEvent) => {
    const s = this.getSession();
    if (!s || s.isDemo) return;
    this.view.canvas.setPointerCapture(e.pointerId);
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.pinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.mode = 'pinch';
      return;
    }
    if (s.canPlace && this.view.hitsShooter(e.clientX, e.clientY)) this.mode = 'place';
    else this.mode = 'aim';
  };

  private move = (e: PointerEvent) => {
    const prev = this.pointers.get(e.pointerId);
    if (!prev) return;
    const s = this.getSession();
    const dx = e.clientX - prev.x;
    const dy = e.clientY - prev.y;
    this.pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (!s) return;

    if (this.mode === 'pinch' && this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.pinchDist > 0) this.zoomBy(this.pinchDist / d);
      this.pinchDist = d;
      return;
    }
    if (this.mode === 'place') {
      const p = this.view.groundPoint(e.clientX, e.clientY);
      if (p) s.setPlaceAngle(Math.atan2(p.z, p.x));
      return;
    }
    if (this.mode === 'aim') {
      const speed = Math.hypot(dx, dy);
      const fine = speed < 2.5 ? 0.22 : speed < 6 ? 0.55 : 1;
      const sens = settings.get().aimSensitivity;
      const w = this.view.canvas.clientWidth || 800;
      // A full-width drag ≈ 120° of aim.
      s.rotateAim((dx / w) * 2.1 * fine * sens);
      this.view.userPitch = Math.min(1.15, Math.max(0.3, this.view.userPitch + dy * 0.0035));
    }
  };

  private up = (e: PointerEvent) => {
    this.pointers.delete(e.pointerId);
    if (this.pointers.size === 0) this.mode = 'none';
    else if (this.pointers.size === 1) this.mode = 'aim';
  };

  private wheel = (e: WheelEvent) => {
    e.preventDefault();
    this.zoomBy(Math.exp(e.deltaY * 0.001));
  };

  private zoomBy(f: number) {
    this.view.userZoom = Math.min(2.2, Math.max(0.5, this.view.userZoom * f));
  }

  private keydown = (e: KeyboardEvent) => {
    if ((e.target as HTMLElement)?.tagName === 'INPUT') return;
    const s = this.getSession();
    if (!s || s.isDemo) return;
    if (this.keysDown.has(e.code)) return;
    this.keysDown.add(e.code);
    switch (e.code) {
      case 'Space':
        e.preventDefault();
        s.startCharge();
        break;
      case 'KeyT':
        s.toggleCam();
        break;
      case 'KeyF':
        s.toggleFast();
        break;
      case 'Escape':
        s.cancelShot();
        break;
      case 'KeyQ':
        s.setSpin(Math.round((s.spinValue - 0.25) * 4) / 4);
        break;
      case 'KeyE':
        s.setSpin(Math.round((s.spinValue + 0.25) * 4) / 4);
        break;
    }
  };

  private keyup = (e: KeyboardEvent) => {
    this.keysDown.delete(e.code);
    const s = this.getSession();
    if (e.code === 'Space' && s) {
      e.preventDefault();
      s.release();
    }
  };

  private keyLoop = (t: number) => {
    this.raf = requestAnimationFrame(this.keyLoop);
    const dt = Math.min(0.05, (t - this.last) / 1000);
    this.last = t;
    const s = this.getSession();
    if (!s || s.isDemo) return;
    const fine = this.keysDown.has('ShiftLeft') || this.keysDown.has('ShiftRight') ? 0.15 : 1;
    const rate = 0.9 * fine * dt;
    if (this.keysDown.has('ArrowLeft')) s.rotateAim(-rate);
    if (this.keysDown.has('ArrowRight')) s.rotateAim(rate);
    if (this.keysDown.has('KeyA')) s.nudgePlace(-rate * 0.6);
    if (this.keysDown.has('KeyD')) s.nudgePlace(rate * 0.6);
    if (this.keysDown.has('ArrowUp')) this.view.userPitch = Math.min(1.15, this.view.userPitch + dt * 0.8);
    if (this.keysDown.has('ArrowDown')) this.view.userPitch = Math.max(0.3, this.view.userPitch - dt * 0.8);
  };

  dispose() {
    const c = this.view.canvas;
    c.removeEventListener('pointerdown', this.down);
    c.removeEventListener('pointermove', this.move);
    c.removeEventListener('pointerup', this.up);
    c.removeEventListener('pointercancel', this.up);
    c.removeEventListener('wheel', this.wheel);
    window.removeEventListener('keydown', this.keydown);
    window.removeEventListener('keyup', this.keyup);
    cancelAnimationFrame(this.raf);
  }
}
