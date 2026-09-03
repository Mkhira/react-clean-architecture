# INTAKE.md — endpoint intake (SKILL.md Step 2)

Read this when the mode is **backend only** or **full** and you reach checklist step 2.
Design-only runs never touch this file — they have no endpoints.

## Endpoint intake (repeat per endpoint)

**ONE QUESTION PER MESSAGE — this ordering is mandatory and unconditional** once Step 1b
routes here (backend-only and full modes; design-only skips this step). It does not
change based on Step 1's outcome (new feature, append, empty skeleton, dirty tree — none of
that alters the intake order; report Step 1 results in one short line, not an analysis dump).
Never bundle two questions into one message, and never invite combined answers like "paste
the curl along with your choice". Ask, stop, wait for the answer, then ask the next.
A curl or "mock" captured from the invocation arguments (SKILL.md Step 0z) counts as the
answer to sequence step 2 / the mock lane; the ordering of everything else is unchanged.

The fixed sequence:

1. Ask ONLY: **"Single or multiple endpoints?"** — nothing else in that message. Wait.
2. Ask ONLY for the curl paste (or "no curl" → guided intake). Wait.
3. **No response-body question** — capture the response by EXECUTING the curl (see
   "Response capture" below). Not asked, just done.
3b. GET endpoint → ask ONLY the **cache question**, with the two cache layers spelled out so
   "no" isn't misread as "no caching at all":
   > "How should this endpoint's responses be cached? 1. **no** — no device cache; react-query
   > still keeps responses in memory for ~5 min (app-wide default) · 2. **always-fresh** —
   > refetch on every visit, even the in-memory copy is bypassed (`staleTime: 0`; pick this
   > for lists whose server data changes between visits) · 3. a **persistent device cache**:
   > 6-hours / 8-hours / 12-hours / 24-hours / 2-days / 1-week (survives app restarts)"
   → the endpoint's `cache` field (`null` / `"always-fresh"` / the duration). Non-GET: skip,
   never ask.
4. Multiple mode: ask **"next curl, or done?"** — on "next", loop back to 2 for the next
   endpoint. Single mode: skip this.
5. When all curls are in ("done", or the single curl is captured): show the endpoint summary
   table (user can say "edit #N"), then ask the **user story** question — ONCE for the whole
   feature, with an explicit **"skip"** option. In multi mode you map the story's rules onto
   each endpoint's use case; endpoints the story doesn't cover get pass-through + `// TODO`.
6. After the story question (backend-only and full modes ONLY): ask ONLY the **login
   question** — "does this feature require login?" If yes, ask for an access token in the NEXT
   message. The token is used at runtime only (curl execution, simulator verification via
   `setAuthToken`/MMKV `authToken`) — it NEVER lands in any file; secret-hygiene enforces
   this. A login-required feature also gets `requiresAuth: true` in its SERVICES_DATA entry
   (design lane).

**MOCK BACKEND (spec.mock: true) — first-class lane, not improvisation.** When the user says
the backend doesn't exist yet ("use mock backend", "API not ready", "mock for now") — in the
initial request or at any intake point — set top-level `"mock": true` in the spec and confirm
it in one line. Consequences: (a) there is no live API, so **response capture cannot execute
the curl** — ask for a sample response, or (with the user's explicit OK, as in the
ApplicationStatus run) derive a realistic sample from the Figma screens/story and confirm it;
(b) generate.js emits `data/services/<Feature>MockService.ts` — sample DTOs flowing through
the REAL mappers — and register-di.js registers the MOCK for `TOKENS.<Feature>Service` with a
swap comment (the real service class is still generated, unreferenced, ready for the swap);
(c) YOU enrich the mock's sample catalog in Step 5.3 (filters, states, pagination — every
filter-sheet option should have matching items); (d) DESIGN.md §1's mock question is
pre-answered — never ask it again; (e) the final report states the one-line swap. The mock
seam is the SERVICE interface — never mock at the repository or query layer, that would
bypass the mappers.

**YES — curl path (target: ONE paste per endpoint — the curl itself):**
1. Paste → save to a scratch file → `node <skill>/scripts/parse-curl.js <file>`.
   Detection is loose: `--header`/`-H`/`--data`/`-d`/`--body` + a URL counts — no literal
   `curl` prefix required (Postman exports start with other text).
   Broken paste → the script reports what's found/missing; re-ask.
   `multipart: true` → reject: "not supported yet — add manually using IHttpClient.upload()".
2. **Host classification** — resolve the app's hosts from `.env.development` (fallback: the
   literal defaults in `src/core/config/ConfigService.ts`):
   - Matches `EXPO_PUBLIC_API_URL` (host + path prefix) → `hostType: "app"`. **Strip the
     base-URL path prefix from the endpoint path** (apiUrl `…/test/third-party/` + curl
     `…/test/third-party/v2/x` → path `/v2/x`), or URLs double the prefix.
   - Matches `EXPO_PUBLIC_INTERNAL_BASE_URL` / `EXPO_PUBLIC_BFF_BASE_URL` → `hostType:
     "external"` but **reuse the existing config fields** (`internalBaseUrl`/`baseUrl`) —
     no new env keys, omit `baseUrl.envKey`/`devValue`.
   - Anything else → `hostType: "external"` with a new `EXPO_PUBLIC_<FEATURE>_BASE_URL`.
3. Numeric/UUID path segments → propose them as path params, user confirms which are dynamic.
4. **Response capture — EXECUTE the curl, don't ask.** The live payload beats a hand-typed
   sample, so run the pasted curl and capture the real response:
   - **GET**: execute immediately, no question.
   - **POST/PUT/DELETE**: one-line confirmation first — the call hits the real API and may
     mutate state; get an explicit yes before running.
   - Model the `data` object when the response arrives in the app's `ApiResponse`
     `{header, data}` envelope. Any token in the paste is used for the call ONLY — it never
     lands in a file (secret-hygiene enforces this).
   - **Fallback (only if execution fails** — network/auth error, non-JSON, empty body, or the
     user declined a mutating call): then ask — paste a sample JSON response, or "none"
     (endpoint returns nothing useful → `Result<void, …>`).

**NO — guided manual path** (one question per message here too): URL → app or external host?
→ custom headers (paste or "none") → method (GET/POST/PUT/DELETE) → request body JSON or
"none" (POST/PUT) / query+path params (GET/DELETE) → response body (no curl to execute, so
ASK: paste a sample or "none") → back into the fixed sequence (next-curl loop / user story).

**Response shape rules (both paths):**
- `"none"` → use case returns `Result<void, FeatureError>`; no ResponseDTO, no `toDomain`.
- Top-level array `[...]` supported (array DTO + entity list).
- `null` values / empty `[]` → ask the user the type; unanswered → `unknown` + audit warning.
- Non-JSON / multipart / uploads → reject in v1 (message above).
- Endpoint path already present in ANY other feature (audit greps too) → warn, continue/cancel.

**User story:** asked ONCE per run, after all curls are captured (sequence step 5) — options:
write it, or **skip**. Drives use-case names, `execute()` validation, error codes; kept as a
doc comment on the use case(s). Skipped → pass-through + `// TODO`. NEVER invent a story
silently: made-up validation is worse than none. Arabic strings in the story flow into
`translations/ar.ts`.

**userStory/ directory:** story given → create `src/features/<feature-dir>/userStory/` and save
the FULL story text verbatim as one `.md` file per story, named by its story ID when it has
one (e.g. `ERD-PBM-001.md`); no ID → sequential fallback (`userStory-1.md`, `userStory-2.md`,
…). Story skipped → do NOT create the directory. In append mode a new story gets its OWN file
alongside the existing ones — never overwrite or delete a previous story file. (Create the
directory by hand — the scripts don't manage it; audit's structure check ignores extra dirs.)

**STORY IS THE CONTRACT:** once a story exists for the endpoint(s) — given this run or reused
from `userStory/` — ALL hand-written work (validation rules, error codes, status mappings,
screen behavior, translations) must follow it. Anything the story does NOT cover — extra
validation, renamed labels, added behavior, design deviations — ASK the user first; never
improvise beyond pass-through + `// TODO`.

**Multi mode:** after each curl is captured, ask **"next curl, or done?"**. On "done" show the
summary table of ALL endpoints (user can say "edit #N"), then the single user story question,
then the Step 3 confirmation tables.

**PUT/DELETE:** `IHttpClient` has them commented out. If the spec needs one, YOU edit
`src/core/http/IHttpClient.ts` + `HttpClientService.ts` by hand, mirroring the existing
`get`/`post` implementations (one-time, owner-approved core edit — mention it in the report).
