/** Bounded, connection-local source copies. References carry no execution authority. */
export class PacketReferences {
  private readonly packets = new Map<string, { generation: string; packet: Record<string, unknown>; expiresAt: number }>()
  constructor(private readonly root: string, private readonly now = Date.now) {}
  clear() { this.packets.clear() }
  private expire() {
    for (const [id, value] of this.packets) if (value.expiresAt <= this.now()) this.packets.delete(id)
  }
  put(id: string, generation: string, packet: unknown) {
    if (!packet || typeof packet !== 'object' || Array.isArray(packet)) throw new Error('task-handover: invalid source packet reference')
    const encoded = JSON.stringify(packet)
    if (Buffer.byteLength(encoded) > 65_536) throw new Error('task-handover: source packet exceeds reference budget')
    this.expire()
    if (this.packets.size >= 4) this.packets.delete(this.packets.keys().next().value!)
    this.packets.set(id, { generation, packet: JSON.parse(encoded), expiresAt: this.now() + 600_000 })
  }
  resolve(id: string, root: string, generation: string): Record<string, unknown> {
    this.expire()
    const item = this.packets.get(id)
    if (root !== this.root || !item || item.generation !== generation) {
      throw new Error('task-handover: packet reference unavailable or stale; request a fresh repository_packet in this connection')
    }
    return structuredClone(item.packet)
  }
}
