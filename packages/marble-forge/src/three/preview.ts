import * as THREE from 'three';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { buildEnvironment, STUDIO } from './studio';
import type { MarbleLook } from '../look';
import { advanceMarbles } from './effects';
import { buildMarble, disposeObject, type BuiltMarble } from './marble';

/**
 * A close-up of one marble on its own small canvas (marble picker, fighter detail, versus).
 * Full-quality glass, slowly turning under a key light over a soft glow pool; drag to spin it
 * in your fingers. Ported from the parallel implementation's MarblePreview.
 */
export class MarblePreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private marble: BuiltMarble | null = null;
  private raf = 0;
  private t = Math.random() * 10;
  private last = performance.now();
  private spin = 0.5;
  private dragging = false;
  private lastX = 0;
  private canvas: HTMLCanvasElement;
  private studioEnv!: THREE.Texture;
  private room: THREE.Texture | null = null;

  private roomEnv(): THREE.Texture {
    if (!this.room) {
      const pmrem = new THREE.PMREMGenerator(this.renderer);
      this.room = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
      pmrem.dispose();
    }
    return this.room;
  }

  constructor(canvas: HTMLCanvasElement, look: MarbleLook, accent = '#5ad1ff', quality: 'low' | 'high' = 'high') {
    this.canvas = canvas;
    // Opaque with a real backdrop: transmission refracts what is behind the marble, and a
    // transparent canvas refracts as flat milky grey. The edge is feathered in CSS
    // (Marble3D) so the dark square melts into whatever panel it sits on.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.scene.background = new THREE.Color('#0c1120');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    // A dark studio with soft rounded lights, not the white RoomEnvironment that washes
    // glass out: the marble stays clear and its highlights round.
    this.studioEnv = buildEnvironment(this.renderer, STUDIO);
    this.scene.environment = this.studioEnv;

    const key = new THREE.DirectionalLight('#ffffff', 2.4);
    key.position.set(2, 4, 3);
    const rim = new THREE.PointLight(accent, 30, 0, 2);
    rim.position.set(-2.5, 1.2, -2);
    this.scene.add(key, rim, new THREE.HemisphereLight('#c8dcff', '#202030', 0.6));

    // Soft glow pool under the marble so the glass has something to refract.
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const g = c.getContext('2d')!;
    const grad = g.createRadialGradient(64, 64, 0, 64, 64, 64);
    grad.addColorStop(0, accent);
    grad.addColorStop(0.5, `${accent}55`);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 128, 128);
    const tex = new THREE.CanvasTexture(c);
    tex.colorSpace = THREE.SRGBColorSpace;
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.8, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -1.02;
    this.scene.add(pool);

    this.camera.position.set(0, 1.1, 5.4);
    this.camera.lookAt(0, -0.1, 0);
    this.quality = quality;
    this.setLook(look);

    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', this.down);
    canvas.addEventListener('pointermove', this.move);
    canvas.addEventListener('pointerup', this.up);
    this.loop();
  }

  private quality: 'low' | 'high';

  private down = (e: PointerEvent) => {
    this.dragging = true;
    this.lastX = e.clientX;
    this.canvas.setPointerCapture(e.pointerId);
  };
  private move = (e: PointerEvent) => {
    if (!this.dragging) return;
    this.spin = (e.clientX - this.lastX) * 0.4;
    this.lastX = e.clientX;
  };
  private up = () => {
    this.dragging = false;
  };

  setLook(look: MarbleLook): void {
    if (this.marble) {
      this.scene.remove(this.marble.group);
      disposeObject(this.marble.group);
      (this.marble.contact.material as THREE.Material).dispose();
      if (this.marble.caustic) {
        this.scene.remove(this.marble.caustic);
        (this.marble.caustic.material as THREE.Material).dispose();
      }
    }
    // Chrome is pure reflection: it needs the bright room to have anything to mirror.
    // Glass needs the dark studio to stay clear.
    this.scene.environment = look.core === 'steelie' ? this.roomEnv() : this.studioEnv;
    this.marble = buildMarble(look, 1, this.quality, 3.7);
    this.scene.add(this.marble.group);
    if (this.marble.caustic) {
      this.marble.caustic.position.set(0.35, -1.0, 0.35);
      this.scene.add(this.marble.caustic);
    }
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.last) / 1000);
    this.last = now;
    this.t += dt;
    advanceMarbles();
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w === 0 || h === 0) return;
    if (this.canvas.width !== Math.floor(w * this.renderer.getPixelRatio())) {
      this.renderer.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
    }
    if (!this.dragging) this.spin += (0.5 - this.spin) * Math.min(1, dt * 1.5);
    if (this.marble) {
      this.marble.group.rotation.y += this.spin * dt;
      this.marble.group.rotation.x = Math.sin(this.t * 0.5) * 0.25;
      this.marble.group.position.y = Math.sin(this.t * 1.3) * 0.04;
    }
    this.renderer.render(this.scene, this.camera);
  };

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.canvas.removeEventListener('pointerdown', this.down);
    this.canvas.removeEventListener('pointermove', this.move);
    this.canvas.removeEventListener('pointerup', this.up);
    if (this.marble) disposeObject(this.marble.group);
    this.studioEnv.dispose();
    this.room?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
