/**
 * A close-up of one marble on its own small canvas: the taw picker and the
 * versus screen. Always full-quality glass (it is one marble), slowly turning
 * under a key light with a soft reflection beneath it.
 */
import * as THREE from 'three';
import { buildEnvironment, STUDIO } from './environment';
import { createMarble, type MarbleLook, type MarbleMesh } from './marble';

export class MarblePreview {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
  private marble: MarbleMesh | null = null;
  private raf = 0;
  private t = Math.random() * 10;
  private last = performance.now();
  private spin = 0.5;
  private dragging = false;
  private lastX = 0;

  constructor(private canvas: HTMLCanvasElement, look: MarbleLook, accent = '#5ad1ff') {
    // Opaque, with a real backdrop: transmission refracts what is behind the
    // marble, and a transparent canvas would refract as flat milky grey.
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.scene.background = new THREE.Color('#0c1120');
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene.environment = buildEnvironment(this.renderer, { ...STUDIO, keyColor: '#ffffff', horizon: accent === '#ff5a7a' ? '#4a2234' : STUDIO.horizon });

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
    const pool = new THREE.Mesh(new THREE.PlaneGeometry(3.4, 3.4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false }));
    pool.rotation.x = -Math.PI / 2;
    pool.position.y = -1.02;
    this.scene.add(pool);

    this.camera.position.set(0, 0.9, 4.6);
    this.camera.lookAt(0, -0.1, 0);
    this.setLook(look);

    // Drag to spin it in your fingers.
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      canvas.setPointerCapture(e.pointerId);
    });
    canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.spin = (e.clientX - this.lastX) * 0.4;
      this.lastX = e.clientX;
    });
    canvas.addEventListener('pointerup', () => (this.dragging = false));
    this.loop();
  }

  setLook(look: MarbleLook): void {
    if (this.marble) {
      this.scene.remove(this.marble.group);
      if (this.marble.caustic) this.scene.remove(this.marble.caustic);
      this.marble.dispose();
    }
    this.marble = createMarble(look, 1, 'high', 'preview');
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
    this.marble?.dispose();
    this.renderer.dispose();
    this.renderer.forceContextLoss();
  }
}
