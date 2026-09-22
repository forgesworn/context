# V3 qualification delta review

Status: accepted by Sol/high for prospective lock and one-pair execution. V2 required answer creation but defaulted to read-only execution.
V3 selects workspace-write explicitly for the executor and read-only explicitly
for the reviewer. Root source integrity checking remains mandatory. All original
v1 failures and v2 outcomes are retained. This is a new prospective qualification,
not an amendment to a locked run. No v3 inference arm has started.

Preparation includes local CLI help inspection and one failed deterministic
sandbox CLI invocation (missing permission-profile argument), neither inference.
The current CLI sandbox command has a different profile interface from exec;
actual exec write capability must be checked before locking v3.

The minimal independent Luna/medium exec fixture has now created answer.json and
run the public checker successfully under workspace-write. Its terminal receipt
records input 15,560 (cached subset 12,800), output 359 (reasoning subset 56),
billing unknown. One command and one file-change event completed; v3 counts both
event types. The fixture contains no actual trial source or task answer.

Sol/high independently verified the completed file change, actual checker exit 0,
terminal model event and unchanged fixture sources. The v3 delta review accepted
the explicit sandbox modes, completed file-change accounting and the symmetric
normalisation question. Twelve runner tests and the complete two-arm verifier
passed. No v3 inference arm ran before this review and lock.
