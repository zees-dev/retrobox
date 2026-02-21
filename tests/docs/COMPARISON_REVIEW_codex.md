# RetroBox E2E Docs Comparison Review (Codex)

Date of review: 2026-02-03

**Docs reviewed**
- `docs/testing/E2E_ARCHITECTURE_v1.md`
- `docs/testing/E2E_ARCHITECTURE_v2.md`
- `docs/testing/E2E_ARCHITECTURE_v3.md`
- `docs/testing/WRITING_TESTS_v1.md`
- `docs/testing/WRITING_TESTS_v2.md`
- `docs/testing/WRITING_TESTS_v3.md`

**Context note**
- v1 and v3 are dated 2026-02-03.
- v2 is dated 2025-02-03.

---

**1. Key Differences Between Versions**

**Architecture scope and ambition**
- v1: Minimal viable E2E setup. Focused on fixtures, page objects, and a small set of scenarios. Single-browser focus. Simpler runtime assumptions.
- v2: Full production-ready framework. Introduces an explicit orchestrator, richer infrastructure, and higher observability. Adds WebSocket inspection, console aggregation, and a larger test suite.
- v3: Strategic refinement. Adds multi-browser matrix strategy, determinism guidance, and test-only flags for stability. Scales the framework conceptually without specifying as many concrete tests as v2.

**Orchestration model**
- v1: Uses Playwright fixtures to build screen and controller contexts directly in test fixtures.
- v2: Central `RetroBoxOrchestrator` class that encapsulates screen, controllers, and logging. Provides a single test entry point.
- v3: Keeps orchestrator concept but treats it as a core abstraction with stronger observability and multi-browser goals.

**Observability and diagnostics**
- v1: Console log capture per context with a helper to assert no errors.
- v2: ConsoleCollector with structured errors and filtering. Adds WebSocketInspector via CDP. Includes explicit error hygiene specs.
- v3: Adds WebRTC inspection and log hygiene as a core design requirement. Mentions WebSocket observability via `page.on('websocket')`.

**Determinism and test-mode support**
- v1: Some visual testing, but no explicit test-mode or deterministic UI controls.
- v2: Light guidance via test data and stable selections. Some focus on reducing flake with waits and timeouts.
- v3: Explicit test-only query flag (`?e2e=1`), disabled animations, deterministic start signal, and dedicated ROMs for screenshot stability.

**Multi-browser strategy**
- v1: Single project, primarily Chromium.
- v2: Optional multi-browser projects mentioned, but mostly single-project default.
- v3: First-class strategy with separate screen/controller projects and a CI vs nightly matrix.

**Writing Tests guidance**
- v1: Short, quick-start style. Covers fixtures and common patterns.
- v2: Comprehensive developer guide with orchestrator patterns, debugging, best practices, and troubleshooting.
- v3: Concise and scenario-oriented. Emphasizes determinism, screenshot stability, and multi-browser guidance.

---

**2. Strengths and Weaknesses of Each**

**v1**
- Strengths:
  - Low complexity and easy to implement quickly.
  - Clear fixtures and page objects for beginners.
  - Concrete specs cover core flows.
- Weaknesses:
  - Limited observability and diagnostic depth.
  - Less structured orchestration makes scaling harder.
  - No explicit determinism controls or test-mode support.
  - Single-browser focus reduces confidence across environments.

**v2**
- Strengths:
  - Most complete and implementation-ready design.
  - Orchestrator pattern simplifies multi-controller scenarios.
  - Strong logging and inspection tooling.
  - Rich developer guide and debugging workflow.
  - CI workflow and artifact handling are defined.
- Weaknesses:
  - More boilerplate and cognitive load for small tests.
  - WebSocket inspector uses CDP and is Chromium-centric.
  - Test data placeholders require project-specific calibration.
  - Multi-browser coverage is still optional and not well enforced.

**v3**
- Strengths:
  - Strong focus on determinism and stability.
  - Multi-browser strategy is explicit and well-structured.
  - Test-mode flag and deterministic signals reduce flake.
  - Clear, minimal scenario coverage for core risks.
- Weaknesses:
  - Less concrete implementation detail than v2.
  - Fewer explicit specs and utilities spelled out.
  - WebRTC inspector mentioned but not fully defined.
  - Requires product changes to add test-mode flag.

---

**3. Most Practical Approach for This Project**

The most practical baseline is **v2**, because it contains a complete, production-ready framework with detailed fixtures, specs, and CI integration. It is the only version that looks ready to implement with minimal guesswork.

However, the project should **adopt the determinism and multi-browser guidance from v3**. That combination creates the highest confidence with the least long-term flake risk.

---

**4. Recommendation and Merge Plan**

**Recommended path: v2 as the base, integrate selected v3 enhancements.**

**Keep from v2**
- Orchestrator design and API.
- ConsoleCollector and logging/assertions approach.
- Test data utilities and naming conventions.
- Global setup/teardown and CI artifacts.
- WRITING_TESTS_v2 structure and troubleshooting section.

**Add from v3**
- Test-only flag (`?e2e=1`) and deterministic start signal in the app.
- Explicit screenshot stability guidance and reduced-motion settings.
- Role-based multi-browser matrix strategy with a small CI default and nightly expansion.
- WebRTC inspection hooks, or at least a placeholder design for them.

**Simplify from v1**
- Use v1’s concise patterns as examples in WRITING_TESTS to reduce onboarding friction.
- Keep v1’s minimal spec templates as “quick start” snippets inside the v2 guide.

**Suggested merged outcome**
- Create a single canonical `E2E_ARCHITECTURE.md` based on v2, with a determinism section and multi-browser matrix section from v3.
- Create a single canonical `WRITING_TESTS.md` based on v2, with the concise quick-start and examples from v1 and the determinism and screenshot sections from v3.

---

**Bottom Line**
- **Use v2 as the foundation.** It is the most complete and implementation-ready.
- **Merge in v3’s determinism and multi-browser practices** to reduce flake and increase confidence.
- **Borrow v1’s lightweight onboarding style** to keep the barrier low for new contributors.
