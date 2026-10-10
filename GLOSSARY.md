# Kriscard Stack

Canonical language for the durable engineering workflow exposed by Kstack.

## Language

**Kstack project**:
The canonical working directory that scopes a set of Kstack sessions.
_Avoid_: Repository, workspace, project hash

**Kstack session**:
A named durable Pi conversation belonging to one Kstack project.
_Avoid_: Agent, task, thread

**Session lease**:
Exclusive live ownership required to open or remove a Kstack session. It ends when the owning process closes or exits.
_Avoid_: Lock file, PID lock
