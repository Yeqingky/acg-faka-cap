# acg-faka-cap

## Repository role

This repository contains a Capcaptcha CAPTCHA plugin for ACG Faka. The plugin must remain self-contained under `Capcaptcha/` and must not modify the host application core.

`Turnstile/` is a local reference implementation only. It is intentionally ignored by Git and must not be included in releases.

## Code navigation

- `Capcaptcha/Config/Info.php`: plugin metadata.
- `Capcaptcha/Config/Config.php`: default plugin configuration.
- `Capcaptcha/Config/Submit.js`: administrator configuration form.
- `Capcaptcha/Core/Keys.php`: Cap instance, Site Key, Secret Key parsing, and endpoint construction.
- `Capcaptcha/Core/Verifier.php`: token extraction, Cap `/siteverify` requests, and bounded outage circuit breaker.
- `Capcaptcha/Hook/Main.php`: lifecycle checks, request guards, front-end injection for dynamic purchase modals, slots, and CSP.
- `Capcaptcha/Controller/Api.php`: plugin verification endpoint used by the full-page gate.
- `Capcaptcha/View/challenge.html`: full-page verification view.
- `Capcaptcha/View/guard.js`: browser-side token acquisition and protected-request integration.
- `Capcaptcha/Image/icon.png`: user-provided plugin icon. Do not copy the `Turnstile` reference icon.

## Cap integration contract

The client uses a Cap widget endpoint in the form `https://<instance>/<site-key>/`. The server verifies a submitted token with `POST <instance>/<site-key>/siteverify` and a JSON body containing `secret` and `response`. The dashboard `ADMIN_KEY` is never a site secret and must not be accepted as one.

The plugin stores one Cap instance URL, one Site Key, and one Secret Key. Cap's own dashboard is responsible for allowing the Site Key on multiple domains. The plugin must not duplicate a domain-to-key mapping or silently disable protection when a request Host is not listed by the Cap service.

## Host CAPTCHA compatibility

- Never modify the ACG Faka host application. Configurable scenario guards follow their matching plugin `gate_*` switches, not host CAPTCHA switches.
- When a plugin guard is enabled, replace the host image CAPTCHA only after successful Cap verification. The compatibility bridge uses the host's current `cap_<action>` session key and, for request-backed actions, updates the existing request POST snapshot. The host CAPTCHA continues to work normally when the matching plugin guard is disabled.
- Inject the browser guard on front-end HTML when any scenario is active; purchase widgets may appear in AJAX-loaded product modals. Keep native trade CAPTCHA selection scoped to the form containing the visible purchase quantity input. In inline mode, reconcile promptly and require the widget to be in the visible form before solving. Reuse an unexpired token once, retain the verified UI after forwarding it, and track that consumed token so another request obtains a fresh token instead of resending it.
- Place the official login and registration slots immediately before their respective submit buttons. Mark email/phone code-send routes in the guard table and render their native prompt as a separate Cap modal with a one-shot token scoped to that route; never reuse the registration form widget.
- Host registration and password-reset modes select which email/phone code routes exist; they do not activate Cap guards. Email and phone binding routes remain always guarded.
- Skip the full-page gate on pages already protected by an active action-level Cap guard.
- Host changes may invalidate the internal session/request bridge. Recheck login, registration, code-sending, ordering, and admin-login flows after host upgrades.

## Development and validation

The repository has no package manager project. Before reporting a change as complete:

1. Run `php -l` on every PHP file under `Capcaptcha/`.
2. Check that `Turnstile/` is ignored with `git check-ignore -v Turnstile/Config/Info.php`.
3. Validate JavaScript syntax with an available JavaScript runtime, or document the unavailable runtime.
4. Inspect `git diff --check` and `git status --short`.

Changes to Hook annotations require disabling and re-enabling the plugin in a real ACG Faka installation so the compiled hook registry is rebuilt. Template changes may require clearing only `runtime/view/compile`.

## Implementation rules

- Keep all plugin PHP classes namespaced under `App\\Plugin\\Capcaptcha`; metadata and default configuration return files intentionally have no namespace.
- Keep secret keys server-side. Never put the saved Secret Key into public HTML or browser runtime configuration. The admin Secret Key editor must not prefill it, submits only a newly typed value, and preserves the existing server-side value when left empty.
- Escape every administrator-provided value before inserting it into HTML or JavaScript.
- Use JSON requests for Cap `/siteverify`; do not use URL-encoded `form_params`.
- Reject missing and oversized tokens. Verification fails closed until the bounded circuit breaker opens; during its fixed open window, non-empty tokens up to 16 KiB skip remote verification, and the first request after expiry probes Cap again.
- Do not claim action or hostname validation that Cap's documented `/siteverify` response does not provide. Tokens are single-use and the plugin must not reuse them.
- Keep route matching and configuration feature flags in one auditable place.
- Do not add a second domain-to-key configuration layer; one Cap Site Key is the source of truth for all supported shop domains.

## Version control and release

- The default branch is `main`, matching the configured remote repository.
- Do not commit `Turnstile/`, runtime files, credentials, or generated caches.
- A release package contains `Capcaptcha/` and its required static assets only.
- Exact `vX.Y.Z` tags trigger `.github/workflows/release.yml`, which checks the tag against the plugin metadata and publishes `Capcaptcha-vX.Y.Z.zip` containing only `Capcaptcha/`.
- Update this file whenever the plugin layout, supported configuration, business rules, or validation workflow changes.
