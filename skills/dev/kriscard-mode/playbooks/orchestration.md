# Orchestration playbook

Coordinate several independent outcomes without inventing a software factory.

1. Use `spec` when the goals, dependencies, or ownership are not already clear.
2. Split work by independent outcome and identify real dependencies or conflicts.
3. Use the host's available agent mechanism for independent work. The first Kriscard Pi Durable runner executes one durable agent; do not claim parallel durability or scheduling it does not provide.
4. Apply the feature, bug-fix, refactor, migration, or review skills needed inside each outcome without copying their instructions here.
5. Aggregate evidence, surface conflicts, and leave merge or release order to explicit user approval.

Add scheduling or parallel durable agents only after a real workload demonstrates the need.
