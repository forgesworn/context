# Continue work across hosts

Read this only when work will continue in another session or host, or the user
asks for a checkpoint.

When work will continue in another session or host, save a fresh packet and
concise progress under a new checkpoint name ending in `.json`. Prefer the fresh
packet's `packetId` when the installed tool supports it; avoid copying source
JSON back into a request. References are connection-local, bounded and invalid after refresh,
reconnect or checkout switching; retrieve a new packet when needed. Supply the
state fields and check outcomes advertised by the tool, never placeholder
packet data or an invented `complete` status. Retain decisions, actual checks, unresolved questions,
pending external effects and next action. Resume with the same `expectedRoot`
and name in another host. Global storage is separated by canonical checkout;
wrong-root and stale records must not be repaired by changing hashes.

Checks recorded as passed are assertions requiring evidence; a checkpoint is
not reviewer acceptance. Files contain source/state and stay in configured
private storage. Signed/encrypted `context_*` collections remain separate.

See the [handover guide](https://github.com/forgesworn/context/blob/main/docs/TASK-HANDOVERS.md)
for storage.
