## 1. Project Overview

- **Project:** Rental Listings Scraper (open source, The Unlicense)
- **Purpose:** Watches rental portals configured by the user, remembers the listings already seen and notifies only the new ones (ntfy/Telegram).
- **Tech Stack:** Node.js ≥18 (CommonJS), Playwright + playwright-extra stealth, dotenv; tests with `node --test` and jsdom. Storage is plain JSON files in `data/`.
- **Architecture:** A generic engine (`src/`) driven by user data in `user/` (not versioned): `user/config.json` (searches + overrides of `config/default.js`) and `user/sites/*.json` (declarative site definitions: `css`, `json` or `script` extraction). `src/sites/definitions.js` validates definitions, `src/sites/extract.js` is the in-page extractor, `src/sites/Site.js` runs the browsing flow, `src/core/Scraper.js` orchestrates runs, store and notifications. The repository must never contain definitions, saved pages or searches for real portals: only the generic examples in `examples/` and `tests/fixtures/`.

Before making changes, inspect the repository structure and review the existing documentation.

## 2. Core Principles

- Prefer simple, readable, and maintainable solutions.
- Follow the existing conventions and patterns used throughout the project.
- Avoid unnecessary duplication and overengineering.
- Do not introduce new dependencies without a clear justification.
- Do not modify code unrelated to the requested task.
- Never assume that APIs, functions, configurations, or behaviors exist without verifying them first.
- If an important decision is ambiguous, ask for clarification before proceeding.

## 3. Workflow

For every task:

1. Understand the requirements and acceptance criteria.
2. Inspect the relevant files and identify dependencies.
3. Create a brief implementation plan for non-trivial changes.
4. Implement the simplest solution that satisfies the requirements.
5. Run the relevant tests and validation checks.
6. Review the changes for regressions, edge cases, and security issues.
7. Summarize what changed and which checks were performed.

For small, well-defined tasks, proceed directly without unnecessary planning overhead.

## 4. Code Standards

- Use descriptive names for variables, functions, classes, and files.
- Keep functions focused on a single responsibility whenever practical.
- Handle errors and edge cases explicitly.
- Avoid `any`, unsafe type assertions, and disabled static checks whenever applicable.
- Do not ignore errors, warnings, or failing tests without explaining why.
- Add comments only when they clarify non-obvious decisions or reasoning.
- Update tests whenever application behavior changes.
- Prefer existing language and framework features over custom implementations.

## 5. Architecture and Design

- Respect the project's existing architectural boundaries.
- Reuse existing components, services, and utilities when appropriate.
- Avoid circular dependencies and unnecessary coupling.
- Do not introduce new architectural patterns without a concrete benefit.
- Preserve existing interfaces and backward compatibility unless a change is explicitly required.
- Keep business logic separate from presentation, infrastructure, and transport layers where appropriate.
- Avoid creating abstractions for one-time operations unless they provide a clear benefit.

## 6. Testing and Validation

Before considering a task complete:

- Run the relevant tests.
- Run linting and type checking when available.
- Run the build when appropriate.
- Verify edge cases affected by the changes.
- Review the final diff for unintended modifications.
- If a check cannot be executed, explicitly state why.

Use the scripts already defined in the project. Never claim that a check passed unless it was actually executed successfully.

## 7. Security

- Never hardcode secrets, API keys, tokens, or credentials.
- Do not expose sensitive information in logs, error messages, or source code.
- Do not weaken authentication, authorization, or input validation to work around a problem.
- Validate inputs according to their context and trust boundaries.
- Do not execute destructive commands without explicit authorization.
- Do not modify `.env` files, production configurations, or infrastructure unless necessary and authorized.
- Follow the principle of least privilege when handling permissions and access.

## 8. Dependencies and Changes

- Prefer existing dependencies and built-in platform capabilities.
- Before adding a package, verify whether an existing solution is sufficient.
- Do not upgrade dependencies or change global configuration unless required.
- Never overwrite existing user changes.
- Inspect the current Git diff before modifying files when relevant.
- Do not create commits, push changes, deploy, or perform irreversible operations unless explicitly requested.
- Keep changes minimal, focused, and easy to review.

## 9. Definition of Done

A task is complete when:

- The requested requirements are satisfied.
- The implementation follows the existing architecture and conventions.
- Relevant validation checks have been executed, or their limitations are documented.
- No unrelated changes have been introduced.
- Important edge cases and failure scenarios have been considered.
- The final response summarizes the implementation, verification results, and any remaining issues.

## 10. Communication

- Communicate in Italian unless another language is requested.
- Keep explanations concise, clear, and technically accurate.
- Distinguish verified facts from assumptions.
- Explain trade-offs when making significant technical decisions.
- Ask questions only when missing information materially affects the implementation.
- Do not claim to have performed actions, tests, or inspections that were not actually completed.

## 11. Problem-Solving Guidelines

- Investigate the root cause before applying a fix.
- Prefer fixing underlying problems over masking symptoms.
- Avoid speculative changes that are not supported by evidence.
- When multiple solutions are viable, prefer the simplest solution that meets the requirements.
- If an approach fails, reassess the assumptions instead of repeatedly applying similar fixes.
- When appropriate, explain alternative approaches and their trade-offs.

## 12. Scope Control

- Stay focused on the requested task.
- Do not refactor unrelated code while implementing a feature or fixing a bug.
- Do not remove existing functionality without explicit justification.
- Preserve established coding conventions unless there is a clear reason to change them.
- If you discover an unrelated issue, report it separately instead of silently expanding the scope.

## 13. Final Response Format

At the end of each task, provide a concise summary containing:

1. **Changes:** What was implemented or modified.
2. **Validation:** Which tests, lint checks, type checks, or builds were executed and their results.
3. **Notes:** Any limitations, unresolved issues, assumptions, or recommended follow-up work.

Keep the final response proportional to the complexity of the task.