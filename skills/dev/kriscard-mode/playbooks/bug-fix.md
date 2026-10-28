# Bug-fix playbook

Correct one observed defect.

1. Keep diagnosis in `debug`: reproduce the failure and identify its cause before changing code. Load a matching installed library specialist only when diagnosis depends on version-specific APIs or failure modes.
2. Use `test` to add the smallest credible regression check when the behavior can be exercised reliably.
3. Apply the narrowest fix with the relevant language, framework, or domain skills. When the fix raises a concrete contract, state, dependency, or ownership question, use the mode's triggered design principles to consider a bounded improvement in the affected responsibility. Before adding a recovery branch, check whether the condition can honestly be normal, idempotent, or prevented by an owning invariant; preserve meaningful failures and existing contracts unless a change is authorized. Keep unrelated cleanup outside scope.
4. Run the regression check and the smallest broader suite that can expose collateral damage.
5. Return the cause, fix, evidence, and remaining risk. Do not broaden the change into adjacent cleanup.
