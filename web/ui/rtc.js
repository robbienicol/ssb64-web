// Peer-to-peer links between everyone in a match: one unordered, unreliable
// data channel per pair (UDP-like, which is what rollback netcode wants).
// Signaling (offers, answers, ICE candidates) goes through our server.
export const ICE_SERVERS = [
  { urls: "stun:stun.l.google.com:19302" },
  { urls: "stun:stun1.l.google.com:19302" },
];

// self/count: this player's slot and the match size. signal(slot, data) sends
// to one peer through the server; feed what arrives back in via mesh.signal().
export function createMesh({ self, count, signal, onMessage, onLost }) {
  const peers = new Map(); // slot -> { pc, dc, pending }
  let settle;
  const ready = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  const allOpen = () => [...peers.values()].every((p) => p.dc.readyState === "open");

  for (let slot = 0; slot < count; slot++) {
    if (slot === self) continue;
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    // Negotiated on both sides with the same id: no "who opens it" handshake.
    const dc = pc.createDataChannel("game", { negotiated: true, id: 0, ordered: false, maxRetransmits: 0 });
    dc.binaryType = "arraybuffer";
    const peer = { pc, dc, pending: [] };
    peers.set(slot, peer);
    dc.onopen = () => { if (allOpen()) settle.resolve(); };
    dc.onmessage = (e) => onMessage(slot, e.data);
    dc.onclose = () => onLost?.(slot);
    pc.onicecandidate = (e) => { if (e.candidate) signal(slot, { candidate: e.candidate.toJSON() }); };
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === "failed") {
        settle.reject(new Error("Couldn't connect to every player (network blocked)."));
        onLost?.(slot);
      }
    };
    // The lower slot of each pair makes the offer.
    if (self < slot) {
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => signal(slot, { sdp: pc.localDescription.toJSON() }))
        .catch((err) => settle.reject(err));
    }
  }

  async function onSignal(from, data) {
    const peer = peers.get(from);
    if (!peer || !data) return;
    try {
      if (data.sdp) {
        await peer.pc.setRemoteDescription(data.sdp);
        if (data.sdp.type === "offer") {
          await peer.pc.setLocalDescription(await peer.pc.createAnswer());
          signal(from, { sdp: peer.pc.localDescription.toJSON() });
        }
        for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
      } else if (data.candidate) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pending.push(data.candidate);
      }
    } catch (err) {
      settle.reject(err);
    }
  }

  return {
    ready,
    signal: onSignal,
    isOpen: (slot) => peers.get(slot)?.dc.readyState === "open",
    send(slot, bytes) {
      const peer = peers.get(slot);
      if (peer?.dc.readyState === "open") peer.dc.send(bytes);
    },
    close() {
      for (const { pc } of peers.values()) pc.close();
      peers.clear();
    },
  };
}
