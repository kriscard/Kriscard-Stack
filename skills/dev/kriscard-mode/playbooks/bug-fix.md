# Bug-fix playbook

Correct one observed defect.

1. Use `debug` to reproduce the failure and identify its cause before changing code.
2. Use `test` to add the smallest credible regression check when the behavior can be exercised reliably.
3. Apply the narrowest fix with the relevant framework or domain skills.
4. Run the regression check and the smallest broader suite that can expose collateral damage.
5. Return the cause, fix, evidence, and remaining risk. Do not broaden the change into adjacent cleanup.
