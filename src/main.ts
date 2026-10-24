import './ui/styles.css';
import { initPhysics } from './sim/physics';
import { App } from './ui/app';

async function boot(): Promise<void> {
  await initPhysics();
  const app = new App(document.getElementById('view') as HTMLCanvasElement, document.getElementById('ui')!);
  // Handle for automated smoke tests; harmless in production.
  (window as unknown as { __ringer: App }).__ringer = app;
}

void boot();
