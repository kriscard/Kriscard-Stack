# Investigation playbook

Answer one bounded question without changing the target.

1. Define the claim, system, or decision being investigated.
2. Inspect repository evidence first. Use `research` for version-sensitive external claims, `debug` for unexplained failures or regressions, and `architect` for consequential boundary or compatibility trade-offs. Load only skills whose evidence condition is present.
3. Separate observed facts from inference and identify missing evidence.
4. Return the explanation or recommendation with citations, limitations, and the smallest useful next step.

Remain read-only. Applying the result is a new request and should be routed again.
