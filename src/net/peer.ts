import type { LobbyClient } from './lobby';
import type { PeerMsg } from './protocol';

type SignalData =
  | { kind: 'offer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'answer'; sdp: RTCSessionDescriptionInit }
  | { kind: 'ice'; candidate: RTCIceCandidateInit };

/**
 * A peer-to-peer link to one remote player over a WebRTC data channel.
 * If a direct connection can't be established (strict NATs), it transparently falls back to
 * relaying messages through the lobby server so the game still works.
 */
export class PeerLink {
  readonly remoteId: string;
  private pc: RTCPeerConnection;
  private dc: RTCDataChannel | null = null;
  private lobby: LobbyClient;
  private queue: PeerMsg[] = [];
  private offLobby: () => void;
  private fallbackTimer: ReturnType<typeof setTimeout>;
  private pendingIce: RTCIceCandidateInit[] = [];
  mode: 'connecting' | 'direct' | 'relay' | 'closed' = 'connecting';
  onMessage: (m: PeerMsg) => void = () => {};
  onState: (mode: PeerLink['mode']) => void = () => {};

  constructor(lobby: LobbyClient, remoteId: string, initiator: boolean) {
    this.lobby = lobby;
    this.remoteId = remoteId;
    this.pc = new RTCPeerConnection({ iceServers: lobby.iceServers });
    this.pc.onicecandidate = (e) => {
      if (e.candidate) this.signal({ kind: 'ice', candidate: e.candidate.toJSON() });
    };
    this.pc.onconnectionstatechange = () => {
      const s = this.pc.connectionState;
      if ((s === 'failed' || s === 'disconnected') && this.mode !== 'relay' && this.mode !== 'closed') this.useRelay();
    };
    if (initiator) {
      this.attach(this.pc.createDataChannel('game', { ordered: true }));
      void this.makeOffer();
    } else {
      this.pc.ondatachannel = (e) => this.attach(e.channel);
    }
    this.offLobby = lobby.on((m) => {
      if (m.t === 'signal' && m.from === remoteId) void this.handleSignal(m.data as SignalData);
      if (m.t === 'relay' && m.from === remoteId) {
        if (this.mode === 'connecting') this.useRelay();
        this.onMessage(m.data);
      }
    });
    this.fallbackTimer = setTimeout(() => {
      if (this.mode === 'connecting') this.useRelay();
    }, 7000);
  }

  private attach(dc: RTCDataChannel) {
    this.dc = dc;
    dc.onopen = () => {
      if (this.mode === 'closed') return;
      clearTimeout(this.fallbackTimer);
      this.mode = 'direct';
      this.onState(this.mode);
      this.flush();
    };
    dc.onmessage = (e) => {
      try {
        this.onMessage(JSON.parse(e.data as string));
      } catch {
        /* ignore malformed */
      }
    };
    dc.onclose = () => {
      if (this.mode === 'direct') this.useRelay();
    };
  }

  private useRelay() {
    if (this.mode === 'relay' || this.mode === 'closed') return;
    clearTimeout(this.fallbackTimer);
    this.mode = 'relay';
    this.onState(this.mode);
    this.flush();
  }

  private async makeOffer() {
    const offer = await this.pc.createOffer();
    await this.pc.setLocalDescription(offer);
    this.signal({ kind: 'offer', sdp: offer });
  }

  private async handleSignal(d: SignalData) {
    try {
      if (d.kind === 'offer') {
        await this.pc.setRemoteDescription(d.sdp);
        const answer = await this.pc.createAnswer();
        await this.pc.setLocalDescription(answer);
        this.signal({ kind: 'answer', sdp: answer });
        this.drainIce();
      } else if (d.kind === 'answer') {
        await this.pc.setRemoteDescription(d.sdp);
        this.drainIce();
      } else if (d.kind === 'ice') {
        if (this.pc.remoteDescription) await this.pc.addIceCandidate(d.candidate);
        else this.pendingIce.push(d.candidate);
      }
    } catch {
      this.useRelay();
    }
  }

  private drainIce() {
    for (const c of this.pendingIce) void this.pc.addIceCandidate(c).catch(() => {});
    this.pendingIce = [];
  }

  private signal(data: SignalData) {
    this.lobby.send({ t: 'signal', to: this.remoteId, data });
  }

  send(m: PeerMsg) {
    if (this.mode === 'direct' && this.dc?.readyState === 'open') this.dc.send(JSON.stringify(m));
    else if (this.mode === 'relay') this.lobby.send({ t: 'relay', to: this.remoteId, data: m });
    else if (this.mode === 'connecting') this.queue.push(m);
  }

  private flush() {
    const q = this.queue;
    this.queue = [];
    for (const m of q) this.send(m);
  }

  close() {
    this.mode = 'closed';
    clearTimeout(this.fallbackTimer);
    this.offLobby();
    try {
      this.dc?.close();
      this.pc.close();
    } catch {
      /* already closed */
    }
  }
}
