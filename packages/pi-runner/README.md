# @kriscard/kstack

Kriscard's skill-first workflow on Pi Durable, with standard coding tools, persistent workers and SQLite recovery.

```bash
kstack
kstack run "Fix the failing checkout test"
kstack --session /private/path/session.sqlite
```

Kriscard Mode selects a playbook and applicable installed skills. Pi Durable owns execution and
recovery. Reopen the same SQLite file to continue. `kstack pi` retains access to native Pi and its
separate JSONL histories.

See the [repository README](../../README.md) for building from source, setup, controls, verification
and the trusted-local-runtime boundary. The package is not yet assumed to be published.
