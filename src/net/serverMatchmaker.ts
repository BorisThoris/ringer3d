import { LobbyClient } from './lobby';
import { PeerLink } from './peer';
import { PROTOCOL_VERSION, type RoomInfo } from './protocol';
import type { CreateRoomOptions, Link, Matchmaker, MatchmakerEvent } from './transport';

/** Matchmaking through the optional Ringer lobby server (server/index.mjs). */
export class ServerMatchmaker implements Matchmaker {
  readonly kind = 'server' as const;
  readonly lobby: LobbyClient;

  constructor(url: string) {
    this.lobby = new LobbyClient(url);
  }

  get myId() {
    return this.lobby.peerId;
  }

  connect() {
    return this.lobby.connect();
  }

  listRooms(): Promise<RoomInfo[]> {
    return this.lobby.listRooms();
  }

  async host(o: CreateRoomOptions): Promise<RoomInfo> {
    await this.connect();
    const res = await this.lobby.request({ t: 'create', name: o.name, hostName: o.hostName, arena: o.arena, maxPlayers: o.maxPlayers, private: o.private, version: PROTOCOL_VERSION }, 'created');
    return res.room;
  }

  async join(o: { roomId?: string; code?: string; name: string }) {
    await this.connect();
    const res = await this.lobby.request({ t: 'join', roomId: o.roomId, code: o.code?.toUpperCase(), name: o.name, version: PROTOCOL_VERSION }, 'joined');
    return { room: res.room, hostId: res.hostId };
  }

  update(u: { players: number; started: boolean; arena: RoomInfo['arena'] }) {
    this.lobby.send({ t: 'update', ...u });
  }

  leave() {
    this.lobby.send({ t: 'leave' });
  }

  on(cb: (e: MatchmakerEvent) => void) {
    return this.lobby.on((m) => {
      if (m.t === 'peer-joined' || m.t === 'peer-left' || m.t === 'room-closed' || m.t === 'error') cb(m);
    });
  }

  link(peerId: string, initiator: boolean): Link {
    return new PeerLink(this.lobby, peerId, initiator);
  }

  close() {
    this.lobby.close();
  }
}
