# @kriscard/kstack

Interactive Pi with Kriscard Mode, backed by Pi Durable for approved delegated execution.

```bash
kstack
kstack run "Fix the failing checkout test"
kstack --continue
kstack durable run --session /private/path/task.sqlite "<bounded task packet>"
```

Kriscard Mode selects a playbook and applicable installed skills in Pi's normal interface.
The orchestration skill invokes the explicit Durable backend when needed. Native Pi owns the main
conversation; Durable owns delegated execution and its separate SQLite recovery. `kstack pi` is
an alias for the native frontend.

See the [repository README](../../README.md) for building from source, setup, controls, verification
and the trusted-local-runtime boundary. The package is not yet assumed to be published.
