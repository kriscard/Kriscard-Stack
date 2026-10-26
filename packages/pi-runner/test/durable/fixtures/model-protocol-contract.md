# Early T8 native protocol fixture (not V8)

`model-protocol-server.ts` scripts only the remote service. It binds a real Node HTTP
server to an ephemeral **127.0.0.1** TCP port and implements the SDK 1.4.0 native
`pi-messages` POST `/messages` + SSE protocol. It does not implement a runner,
conversation store, model executor, recovery policy or alternate CLI mode.

## Frozen consumer API

- `startModelProtocolServer(steps: readonly ProtocolStep[]): Promise<ModelProtocolServer>`
- `modelProtocolConfig(baseUrl)` produces an ordinary custom-provider `models.json`
  object with `fixtureProvider`, `fixtureModel`, `api: "pi-messages"`, and the explicit
  nonsecret `fixtureApiKey`. Write this to an owned temporary directory and pass its
  path to normal `ModelRuntime.create`. Supply owned `authPath`/`modelsStorePath`,
  `allowModelNetwork: false`, and `refreshOnCreate: false`; do not read real credentials.
- `baseUrl` is the bound origin, without `/messages`.
- A `ProtocolStep` is either `{ kind: "stream", events, holdBeforeEvent?,
  holdTimeoutMs? }` or `{ kind: "http-error", status, message, code }`.
  Events are the published SDK `PiMessagesEvent` type, not a replacement SDK stream.
- `requests()` returns detached snapshots of request index, method, path, parsed
  body, `bodyComplete`, authentication **boolean**, state and `responseClosed`. Headers are never
  retained. Do not put secrets in synthetic prompts/bodies. `violations()` returns
  detached diagnostic strings without request or credential values.
- `waitForRequest(index, timeoutMs?)`, `waitForHeld(index, timeoutMs?)`, and
  `waitForResponseClosed(index, timeoutMs?)` are bounded event-driven barriers.
  Indices are zero-based HTTP header-arrival order, **not SDK conversation IDs**.
  `waitForRequest` becomes satisfiable at admission, when state is `receiving`,
  `body` is undefined, and `bodyComplete` is false; a later caller sees the current
  snapshot, not a replay of the admission state. Await
  `waitForHeld` before `release(index)` or aborting the client. The held barrier is
  server-side: it proves bytes were written, not that a client consumed them.
- `release(index)` resumes the remaining finite events exactly once. It throws for
  a non-held response. Closing/cancellation removes the release control.
- `close()` is idempotent and returns the same promise. It destroys only this
  server's responses/sockets and resolves only after the server-close callback and
  all owned socket/response `close` events. Its result is
  `{ closed: true, activeSockets: 0, activeResponses: 0, unusedSteps }`.
  Pending unsatisfied barriers reject on close. Cleanup itself has a 5-second bound;
  failure rejects instead of claiming clean shutdown. Always await close in finally.

## Limits and sequencing

The script is cloned at start: later caller mutation cannot change responses.
There are 1–128 steps, 1–1024 events per stream, a required terminal done/error,
1 MiB request-body limit and 5-second header/body limits. Node header checks run
every 50 ms (rather than its 30-second default); timing assertions allow explicit
event-loop scheduling tolerance. Header/request checking applies to incomplete
requests, not deliberate held responses after a complete body. Barrier/hold bounds must
be integers from 1 to 120000 ms (default 5000). An unreleased hold destroys its
response at the deadline and records a violation. Holds flush SSE headers and a
comment first, permitting actual transport cancellation even before event zero.
The fixture does not synthesize wall-clock sleeps or a client timeout policy.

Every request with complete headers reserves its log index immediately, even if
its body is delayed, rejected or malformed. Correct-route authenticated headers
also reserve/consume the next script step immediately, before body collection.
A later request can complete independently using its own reserved step while an
earlier body remains pending. No step is reassigned on malformed JSON, body
cancellation, limit failure or deadline; otherwise later dispatch could silently
reuse a response intended for an earlier admitted request.

Wrong-route/auth requests are rejected immediately with 404/401, are drained but
not parsed/retained as bodies, and consume no script step. Eligible malformed JSON
gets 400 with `bodyComplete: true` and undefined body. Eligible incomplete bodies
have `bodyComplete: false`; observed closure records cancellation (or timeout).
Valid parsed bodies set `bodyComplete: true`. Scripts never repeat: excess
eligible dispatch gets HTTP 409 at admission and a violation. At most 129
header-admitted requests are retained, with subsequent requests rejected.
`unusedSteps` reports unreserved steps, not successful model responses; consumers should assert the expected count and
`violations()` explicitly. Simultaneous requests may progress independently.
`responseClosed` distinguishes an observed close from merely calling `end()`.

The test wrapper establishes temporary-directory ownership before server startup.
Setup/callback failures still close an admitted server and remove the owned files
once cleanup is confirmed. Original and cleanup errors are retained together in
an AggregateError. A rejected/unconfirmed close does not imply quiescence: the
wrapper retains the directory, reports its path and propagates every failure.
No failed-cleanup condition is converted into a clean shutdown claim.

`model-protocol-events.ts` provides independently defined native wire text, tool
call, usage and stream-error event data. The tool-call ID is a remote protocol
identifier only. Consumers must obtain actual conversation/task IDs from the SDK.

## Proven and deferred

`model-protocol.test.ts` exercises real `ModelRuntime` construction/config/auth,
real direct pi-ai native transport, HTTP serialization, incremental text/tool
arguments, tool results, usage, HTTP 429/stream errors, finite exhaustion,
barrier release, caller abort, held deadlines and observed owned cleanup.
Two-connection delayed-body tests prove arrival reservations and independent
progress/cancellation. Actual incomplete TCP headers expire near five seconds;
a held SDK response survives that header deadline until caller cancellation.
Delta argument snapshots are captured before releasing toolcall_end; both barrier
and requests() nested snapshots are directly mutated to prove detachment.
Setup rejection/callback failure tests observe removal of owned directories.
The unconfirmed-close branch is preserved but not fault-injected with mocks.
No SDK/runner/store/module mocks, vendor network, real auth files or global state
changes are used. Normal SDK options and observers are passed unchanged; the
fixture does not claim that every adapter implements `timeoutMs`/retry options.
Caller `AbortSignal` and fixture deadlines bound these native-protocol tests.

OpenAI/Anthropic/Codex wire adapters, provider production admission/caps, actual
Durable conversation identities, subprocess SIGKILL/reopen and public runner
recovery/cancellation semantics are **not proven here**. Later T7/T8/T10 consumers
must exercise their actual composed public runtime after its gates. Early fixture
prep is not completed T8/V8, live proof, or a substitute runner.
