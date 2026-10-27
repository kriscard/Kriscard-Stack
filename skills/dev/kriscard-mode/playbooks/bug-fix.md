# Bug-fix playbook

Correct one observed defect.

1. Keep diagnosis in `debug`: reproduce the failure and identify its cause before changing code. Load a matching installed library specialist only when diagnosis depends on version-specific APIs or failure modes.
2. Use `test` to add the smallest credible regression check when the behavior can be exercised reliably.
3. Apply the narrowest fix with the relevant language, framework, or domain skills.
4. Run the regression check and the smallest broader suite that can expose collateral damage.
5. Return the cause, fix, evidence, and remaining risk. Do not broaden the change into adjacent cleanup.
