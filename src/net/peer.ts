/**
 * A link to one other player: a WebRTC data channel when the networks allow
 * it (true peer-to-peer), or the lobby's relay when they do not. Messages go
 * out over whichever is up; incoming relay messages are always accepted, so
 * a link that upgrades to P2P mid-match loses nothing.
 */
import type { LobbyClient } from './lobby';
import type { GameMsg } from './protocol';

export type LinkMode = 'connecting' | 'p2p' | 'relay';

const ICE: RTCIceServer[] = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];
/** Give WebRTC this long before falling back to the relay. */
const P2P_TIMEOUT = 7000;

export class PeerLink {
  mode: LinkMode = 'connecting';
  private pc: RTCPeerConnection | null = null;
  private dc: RTCDataChannel | null = null;
  private fallback = 0;
  private closed = false;

  constructor(
    private lobby: LobbyClient,
    readonly peer: string,
    initiator: boolean,
    private onMessage: (m: GameMsg) => void,
    private onMode: (mode: LinkMode) => void,
  ) {
    if (typeof RTCPeerConnection === 'undefined') {
      this.setMode('relay');
      return;
    }
    this.pc = new RTCPeerConnection({ iceServers: ICE });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.lobby.send({ t: 'signal', to: peer, data: { candidate: e.candidate.toJSON() } });
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc?.connectionState;
      if ((s === 'failed' || s === 'disconnected') && this.mode !== 'relay') this.setMode('relay');
    };
    if (initiator) {
      this.wire(this.pc.createDataChannel('game', { ordered: true }));
      void this.offer();
    } else {
      this.pc.ondatachannel = (e) => this.wire(e.channel);
    }
    this.fallback = window.setTimeout(() => {
      if (this.mode === 'connecting') this.setMode('relay');
    }, P2P_TIMEOUT);
  }

  private setMode(m: LinkMode): void {
    if (this.mode === m) return;
    this.mode = m;
    this.onMode(m);
  }

  private wire(dc: RTCDataChannel): void {
    this.dc = dc;
    dc.onopen = () => {
      clearTimeout(this.fallback);
      this.setMode('p2p');
    };
    dc.onclose = () => {
      if (!this.closed) this.setMode('relay');
    };
    dc.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(String(e.data)));
      } catch {
        /* ignore garbage */
      }
    };
  }

  private async offer(): Promise<void> {
    const pc = this.pc!;
    await pc.setLocalDescription(await pc.createOffer());
    this.lobby.send({ t: 'signal', to: this.peer, data: { sdp: pc.localDescription!.toJSON() } });
  }

  private chain: Promise<void> = Promise.resolve();

  /** Signalling from the lobby (SDP offer/answer or an ICE candidate), applied strictly in order. */
  signal(data: unknown): Promise<void> {
    this.chain = this.chain.then(() => this.applySignal(data));
    return this.chain;
  }

  private async applySignal(data: unknown): Promise<void> {
    const pc = this.pc;
    if (!pc || this.closed) return;
    const d = data as { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };
    try {
      if (d.sdp) {
        await pc.setRemoteDescription(d.sdp);
        if (d.sdp.type === 'offer') {
          await pc.setLocalDescription(await pc.createAnswer());
          this.lobby.send({ t: 'signal', to: this.peer, data: { sdp: pc.localDescription!.toJSON() } });
        }
      } else if (d.candidate) {
        await pc.addIceCandidate(d.candidate);
      }
    } catch {
      // A broken negotiation just means relay.
      this.setMode('relay');
    }
  }

  /** A relayed message for this link. */
  relayed(m: GameMsg): void {
    this.onMessage(m);
  }

  send(m: GameMsg): void {
    if (this.closed) return;
    if (this.dc?.readyState === 'open') this.dc.send(JSON.stringify(m));
    else this.lobby.send({ t: 'relay', to: this.peer, data: m });
  }

  close(): void {
    this.closed = true;
    clearTimeout(this.fallback);
    this.dc?.close();
    this.pc?.close();
  }
}
