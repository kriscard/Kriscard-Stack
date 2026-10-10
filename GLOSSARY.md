# Kriscard Stack

Canonical language for the skill-first engineering workflow exposed by Kstack.

## Language

**Kstack launcher**:
The `kstack` command that opens native Pi with Kriscard mode enabled.
_Avoid_: Agent runtime, control plane, Pi replacement

**Kriscard mode**:
The routing skill that selects exactly one engineering playbook for the user's requested outcome.
_Avoid_: Agent, workflow engine, scheduler

**Pi session**:
A conversation created, persisted, named, resumed, branched, compacted, and deleted by Pi.
_Avoid_: Kstack session, Kstack database
