import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './ui/App';
import { engine } from './ui/engine';
import { sound } from './render/audio';
import { initPlatform } from './platform';
import { initSteam } from './steamFeatures';
import { steamDrop, syncSteamItems } from './steamItems';
import { store } from './platformStore';
import { credit } from './game/wallet';
import './ui/styles.css';

// Tells the boot rescue in index.html that the app's script really loaded.
(window as unknown as { __ringerBooted: boolean }).__ringerBooted = true;

function Root() {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const stage = document.getElementById('stage')!;
    void initPlatform();
    void initSteam();
    // Marbles held in the Steam inventory, then any playtime drop that's due.
    void syncSteamItems().then(() => steamDrop());
    // Coin packs paid for while the app was closing: credited once (receipts are idempotent).
    void store.restore?.().then((rs) => rs.forEach((r) => credit(r.receipt, r.product)));
    engine
      .init(stage)
      .then(() => {
        engine.startDemo();
        setReady(true);
      })
      .catch((e: Error) => setError(e.message));
    // Browsers only allow audio after a user gesture.
    const unlock = () => sound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
  }, []);

  if (error) return <div className="loading">Couldn't start the game: {error}</div>;
  if (!ready) return <div className="loading">Rolling out the ring…</div>;
  return <App />;
}

const stage = document.createElement('div');
stage.id = 'stage';
stage.className = 'stage';
document.body.prepend(stage);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);

if ('serviceWorker' in navigator && import.meta.env.PROD && location.protocol === 'https:') {
  void navigator.serviceWorker.register('./sw.js');
}
