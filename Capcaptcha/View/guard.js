/* Cap Guard - 为受保护的 ACG Faka 请求附加一次性 Cap token. */
(function () {
    var cfg = window.__capGuardCfg__;
    if (!cfg || !cfg.endpoint || !cfg.widgetUrl || !cfg.paths || !cfg.paths.length) {
        return;
    }
    if (window.__capGuardLoaded__) {
        return;
    }
    window.__capGuardLoaded__ = true;

    var widget = null;
    var holder = null;
    var solving = false;
    var consumedToken = null;
    var pendingCodeChallenge = null;
    var waiters = [];
    var loadPromise = null;
    var reconcileTimer = null;
    var WAIT_MS = 60000;

    function setCapGlobals() {
        if (cfg.wasmUrl) {
            window.CAP_CUSTOM_WASM_URL = cfg.wasmUrl;
        }
        if (!cfg.nonce) {
            return;
        }
        window.CAP_CSS_NONCE = window.CAP_CSS_NONCE || cfg.nonce;
        window.CAP_SCRIPT_NONCE = window.CAP_SCRIPT_NONCE || cfg.nonce;
    }

    function loadWidget() {
        setCapGlobals();
        if (window.customElements && window.customElements.get("cap-widget")) {
            return Promise.resolve();
        }
        if (loadPromise) {
            return loadPromise;
        }

        loadPromise = new Promise(function (resolve, reject) {
            var script = document.createElement("script");
            script.src = cfg.widgetUrl;
            script.async = true;
            script.defer = true;
            if (cfg.nonce) {
                script.setAttribute("nonce", cfg.nonce);
            }
            script.onload = function () {
                if (window.customElements && window.customElements.get("cap-widget")) {
                    resolve();
                } else if (window.customElements && window.customElements.whenDefined) {
                    window.customElements.whenDefined("cap-widget").then(resolve, reject);
                } else {
                    reject(new Error("Cap widget custom element is unavailable"));
                }
            };
            script.onerror = function () {
                reject(new Error("Cap widget script failed to load"));
            };
            (document.head || document.documentElement).appendChild(script);
        });
        return loadPromise;
    }

    function featurePath(path) {
        var value = String(path || "");
        if (value.charAt(0) !== "/") {
            value = "/" + value;
        }
        return value.replace(/\/+$/, "").toLowerCase();
    }

    function pathOf(url) {
        try {
            var anchor = document.createElement("a");
            anchor.href = String(url || "");
            return featurePath(anchor.pathname || "");
        } catch (e) {
            return "";
        }
    }

    function protectedRequest(url, method) {
        if (String(method || "GET").toUpperCase() !== "POST") {
            return false;
        }
        return cfg.paths.indexOf(pathOf(url)) !== -1;
    }

    function visibleElement(element) {
        if (!element) {
            return false;
        }
        return element.offsetParent !== null || element.getClientRects().length > 0;
    }
    function isInlinePage() {
        var pages = Array.isArray(cfg.pages) ? cfg.pages : [];
        return pages.indexOf(featurePath(location.pathname)) !== -1;
    }

    function nativeActionEnabled(action) {
        var actions = Array.isArray(cfg.nativeActions) ? cfg.nativeActions : [];
        return actions.indexOf(String(action || "")) !== -1;
    }

    function codeRouteForAction(action) {
        var name = String(action || "").toLowerCase();
        var routes = Array.isArray(cfg.codeRoutes) ? cfg.codeRoutes : [];
        for (var i = 0; i < routes.length; i++) {
            var route = routes[i];
            if (!route || String(route.action || "").toLowerCase() !== name) {
                continue;
            }
            var routePath = featurePath(route.path);
            if (routePath !== "/" && cfg.paths.indexOf(routePath) !== -1) {
                return {path: routePath, action: String(route.action || "")};
            }
        }
        return null;
    }

    function codeRouteForPath(url) {
        var path = pathOf(url);
        var routes = Array.isArray(cfg.codeRoutes) ? cfg.codeRoutes : [];
        for (var i = 0; i < routes.length; i++) {
            var route = routes[i];
            if (route && featurePath(route.path) === path) {
                return {path: path, action: String(route.action || "")};
            }
        }
        return null;
    }


    function findAuthAnchor() {
        try {
            var slot = document.querySelector(".cap-guard-slot");
            if (slot && visibleElement(slot)) {
                var authPath = featurePath(location.pathname);
                if (authPath === "/user/authentication/login" || authPath === "/user/authentication/register") {
                    var authPassword = document.querySelector('form input[type="password"]');
                    var authForm = authPassword && authPassword.closest ? authPassword.closest("form") : null;
                    if (!authForm) {
                        authForm = document.querySelector("form");
                    }
                    var submitButton = authForm && authForm.querySelector('button[type="submit"],input[type="submit"]');
                    if (submitButton && submitButton.parentNode &&
                        (slot.parentNode !== submitButton.parentNode || slot.nextElementSibling !== submitButton)) {
                        submitButton.parentNode.insertBefore(slot, submitButton);
                    }
                }
                return slot;
            }
            if (!isInlinePage()) {
                return null;
            }

            var existing = document.querySelector(".cap-guard-anchor[data-cap-generated=\"1\"]");
            if (existing && document.contains(existing)) {
                return existing;
            }

            var password = document.querySelector('form input[type="password"]');
            var form = password && password.closest ? password.closest("form") : null;
            if (!form) {
                form = document.querySelector("form");
            }
            if (!form) {
                return null;
            }

            var created = document.createElement("div");
            created.className = "cap-guard-anchor";
            created.setAttribute("data-cap-generated", "1");
            created.style.cssText = "margin:12px 0;";
            var button = form.querySelector(".send-captcha,.send-email-captcha,.send-phone-captcha,.send-email-code,.send-phone-code");
            if (!button) {
                button = form.querySelector('button[type="submit"],input[type="submit"]');
            }
            if (!button) {
                var buttons = form.querySelectorAll("button");
                button = buttons.length ? buttons[buttons.length - 1] : null;
            }
            if (button && button.parentNode) {
                button.parentNode.insertBefore(created, button);
            } else {
                form.appendChild(created);
            }
            return created;
        } catch (e) {
            return null;
        }
    }

    function visibleQuantity() {
        var inputs = document.querySelectorAll('input[name="num"]');
        for (var i = 0; i < inputs.length; i++) {
            if (visibleElement(inputs[i])) {
                return inputs[i];
            }
        }
        return null;
    }

    function findTradeAnchor() {
        try {
            if (cfg.paths.indexOf("/user/api/order/trade") === -1 && cfg.paths.indexOf("/user/api/recharge/trade") === -1) {
                return null;
            }
            var custom = document.querySelector(".acg-widget-custom-cap");
            if (custom && visibleElement(custom)) {
                return custom;
            }

            var quantity = visibleQuantity();
            if (!quantity) {
                return null;
            }
            var block = quantity.closest ? quantity.closest(".input-group,.form-group,.layui-form-item,.form-floating,.number-box,.quantity,.mb-3") : null;
            block = block || quantity.parentNode;
            if (!block || !block.parentNode) {
                return null;
            }

            var created = document.createElement("div");
            created.className = "cap-guard-anchor";
            created.setAttribute("data-cap-generated", "1");
            created.style.cssText = "margin:12px 0;";
            block.parentNode.insertBefore(created, block.nextSibling);
            return created;
        } catch (e) {
            return null;
        }
    }

    function betterAnchorExists() {
        try {
            if (document.querySelector(".cap-guard-slot")) {
                return true;
            }
            if (isInlinePage() && document.querySelector("form,.send-captcha,.send-email-captcha,.send-phone-captcha,.send-email-code,.send-phone-code")) {
                return true;
            }
            var custom = document.querySelector(".acg-widget-custom-cap");
            if (custom && visibleElement(custom)) {
                return true;
            }
            return (cfg.paths.indexOf("/user/api/order/trade") > -1 || cfg.paths.indexOf("/user/api/recharge/trade") > -1) && !!visibleQuantity();
        } catch (e) {
            return false;
        }
    }
    function hideCaptchaContainer(element) {
        if (!element) {
            return;
        }
        element.disabled = true;
        element.required = false;
        element.removeAttribute("required");

        var container = element.closest
            ? element.closest(".lk-field--captcha,.captcha-group,.row,.form-group,.layui-form-item,.mb-4")
            : null;
        if (container && container.classList.contains("captcha-group") && container.parentNode) {
            container = container.parentNode;
        }
        if (container) {
            if (container.style.display !== "none") {
                container.style.display = "none";
            }
            if (container.getAttribute("aria-hidden") !== "true") {
                container.setAttribute("aria-hidden", "true");
            }
        }
    }

    function hideLegacyCaptcha() {
        var images = document.querySelectorAll('img[src*="/user/captcha/image?action="],img[data-acg-refresh*="/user/captcha/image?action="]');
        for (var i = 0; i < images.length; i++) {
            var source = images[i].getAttribute("data-acg-refresh") || images[i].getAttribute("src") || "";
            var match = /[?&]action=([A-Za-z0-9_]+)/i.exec(source);
            if (!match || !nativeActionEnabled(match[1])) {
                continue;
            }
            var container = images[i].closest
                ? images[i].closest(".lk-field--captcha,.captcha-group,.row,.form-group,.layui-form-item,.mb-4")
                : null;
            if (container && container.classList.contains("captcha-group") && container.parentNode) {
                container = container.parentNode;
            }
            if (container) {
                if (container.style.display !== "none") {
                    container.style.display = "none";
                }
                if (container.getAttribute("aria-hidden") !== "true") {
                    container.setAttribute("aria-hidden", "true");
                }
            }
        }

        if (nativeActionEnabled("login") || nativeActionEnabled("register")) {
            var authInput = document.querySelector("input#image-captcha");
            if (authInput) {
                hideCaptchaContainer(authInput);
            }
        }
        if (nativeActionEnabled("trade")) {
            var quantity = visibleQuantity();
            var tradeForm = quantity && quantity.closest ? quantity.closest("form") : null;
            var tradeInput = tradeForm ? tradeForm.querySelector('input[name="captcha"]') : null;
            if (tradeInput && !tradeInput.disabled) {
                hideCaptchaContainer(tradeInput);
            }
        }
        if (nativeActionEnabled("adminLogin")) {
            var adminInput = document.querySelector("input#lk-captcha");
            if (adminInput) {
                hideCaptchaContainer(adminInput);
            }
        }
    }

    function installNativePromptBridge() {
        var api = window.message;
        if (!api || typeof api.prompt !== "function" || api.prompt.__capGuardWrapped) {
            return;
        }

        var nativePrompt = api.prompt;
        var wrappedPrompt = function (options) {
            var html = options && typeof options === "object" ? String(options.html || "") : "";
            var match = /\/user\/captcha\/image\?action=([A-Za-z0-9_]+)/i.exec(html);
            var codeRoute = match ? codeRouteForAction(match[1]) : null;
            if (match && nativeActionEnabled(match[1])) {
                if (codeRoute) {
                    pendingCodeChallenge = null;
                    var title = options && typeof options === "object" && options.title ? String(options.title) : "人机验证";
                    return showCodeCaptcha(title).then(function (token) {
                        if (!token) {
                            return {isConfirmed: false, value: ""};
                        }
                        pendingCodeChallenge = {
                            path: codeRoute.path,
                            token: token,
                            createdAt: Date.now()
                        };
                        return {isConfirmed: true, value: "1"};
                    }, function () {
                        return {isConfirmed: false, value: ""};
                    });
                }
                return Promise.resolve({isConfirmed: true, value: "1"});
            }
            return nativePrompt.apply(this, arguments);
        };
        wrappedPrompt.__capGuardWrapped = true;
        api.prompt = wrappedPrompt;
    }

    function showCodeCaptcha(title) {
        return loadWidget().then(function () {
            return new Promise(function (resolve) {
                var token = null;
                var settled = false;
                var previousFocus = document.activeElement;
                var backdrop = document.createElement("div");
                backdrop.className = "cap-code-prompt-backdrop";
                backdrop.style.cssText = "position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:16px;background:rgba(15,23,42,.48);";

                var dialog = document.createElement("div");
                dialog.className = "cap-code-prompt";
                dialog.setAttribute("role", "dialog");
                dialog.setAttribute("aria-modal", "true");
                dialog.style.cssText = "box-sizing:border-box;width:360px;max-width:100%;padding:24px;background:var(--bs-body-bg,#fff);color:var(--bs-body-color,#212529);border:1px solid rgba(0,0,0,.08);border-radius:12px;box-shadow:0 16px 48px rgba(0,0,0,.24);";

                var heading = document.createElement("h2");
                heading.textContent = title || "人机验证";
                heading.style.cssText = "margin:0 0 10px;font-size:20px;font-weight:600;";
                var description = document.createElement("p");
                description.textContent = "请完成人机验证后继续发送验证码";
                description.style.cssText = "margin:0 0 16px;font-size:14px;line-height:1.5;";

                var challengeWidget = document.createElement("cap-widget");
                configureCapWidget(challengeWidget);
                challengeWidget.classList.add("cap-code-prompt-widget");
                challengeWidget.style.display = "block";
                challengeWidget.style.margin = "0 auto 18px";

                var buttons = document.createElement("div");
                buttons.style.cssText = "display:flex;justify-content:flex-end;gap:8px;";
                var cancelButton = document.createElement("button");
                cancelButton.type = "button";
                cancelButton.textContent = "取消";
                cancelButton.style.cssText = "min-width:80px;padding:8px 14px;border:1px solid var(--bs-border-color,#dee2e6);border-radius:8px;background:transparent;color:inherit;cursor:pointer;";
                var continueButton = document.createElement("button");
                continueButton.type = "button";
                continueButton.textContent = "继续";
                continueButton.disabled = true;
                continueButton.style.cssText = "min-width:80px;padding:8px 14px;border:0;border-radius:8px;background:var(--bs-primary,#5965f2);color:#fff;cursor:pointer;opacity:.5;";
                buttons.appendChild(cancelButton);
                buttons.appendChild(continueButton);

                function finish(confirmed) {
                    if (settled) {
                        return;
                    }
                    settled = true;
                    document.removeEventListener("keydown", onKeyDown);
                    challengeWidget.removeEventListener("solve", onSolve);
                    challengeWidget.removeEventListener("reset", onReset);
                    backdrop.remove();
                    if (previousFocus && document.contains(previousFocus) && previousFocus.focus) {
                        previousFocus.focus();
                    }
                    resolve(confirmed && token ? token : null);
                }

                function onSolve(event) {
                    token = event && event.detail && event.detail.token ? String(event.detail.token) : String(challengeWidget.token || "");
                    continueButton.disabled = !token;
                    continueButton.style.opacity = token ? "1" : ".5";
                }

                function onReset() {
                    token = null;
                    continueButton.disabled = true;
                    continueButton.style.opacity = ".5";
                }

                function onKeyDown(event) {
                    if (event.key === "Escape") {
                        finish(false);
                    }
                }

                challengeWidget.addEventListener("solve", onSolve);
                challengeWidget.addEventListener("reset", onReset);
                cancelButton.addEventListener("click", function () {
                    finish(false);
                });
                continueButton.addEventListener("click", function () {
                    if (token) {
                        finish(true);
                    }
                });
                backdrop.addEventListener("click", function (event) {
                    if (event.target === backdrop) {
                        finish(false);
                    }
                });
                document.addEventListener("keydown", onKeyDown);
                dialog.appendChild(heading);
                dialog.appendChild(description);
                dialog.appendChild(challengeWidget);
                dialog.appendChild(buttons);
                backdrop.appendChild(dialog);
                document.body.appendChild(backdrop);
                cancelButton.focus();
            });
        });
    }




    function inlineHolderUsable() {
        return !!(holder && document.contains(holder) && visibleElement(holder));
    }

    function configureCapWidget(element) {
        element.className = "cap-guard-widget";
        element.setAttribute("data-cap-api-endpoint", cfg.endpoint);
        element.setAttribute("data-cap-hidden-field-name", cfg.field || "cap-token");
        element.setAttribute("data-cap-disable-haptics", "");
        if (cfg.workers) {
            element.setAttribute("data-cap-worker-count", String(cfg.workers));
        }
        element.setAttribute("data-cap-i18n-initial-state", "请完成人机验证");
        element.setAttribute("data-cap-i18n-verifying-label", "正在验证...");
        element.setAttribute("data-cap-i18n-solved-label", "验证通过");
        element.setAttribute("data-cap-i18n-error-label", "验证失败, 请重试");
    }

    function createWidget() {
        if (widget || !window.customElements || !window.customElements.get("cap-widget")) {
            return;
        }

        var anchor = cfg.display === "programmatic" ? null : (findAuthAnchor() || findTradeAnchor());
        inline = !!anchor;
        holder = anchor;

        if (!anchor) {
            widget = document.createElement("cap-widget");
            widget.style.display = "none";
            document.documentElement.appendChild(widget);
        } else {
            widget = document.createElement("cap-widget");
            anchor.appendChild(widget);
        }

        configureCapWidget(widget);
    }

    function destroyWidget() {
        if (solving) {
            return;
        }
        if (widget && widget.parentNode) {
            try {
                widget.reset();
            } catch (e) {
            }
            widget.parentNode.removeChild(widget);
        }
        widget = null;
        consumedToken = null;
        if (holder && holder.getAttribute("data-cap-generated") === "1" && holder.parentNode) {
            holder.parentNode.removeChild(holder);
        }
        holder = null;
        inline = false;
    }

    function failWaiters() {
        while (waiters.length) {
            var callback = waiters.shift();
            callback(null);
        }
    }

    function finishSolve(callback, token, onSolve, onError) {
        if (onSolve && widget) {
            widget.removeEventListener("solve", onSolve);
        }
        if (onError && widget) {
            widget.removeEventListener("error", onError);
        }
        if (token) {
            consumedToken = token;
        }
        solving = false;
        callback(token || null);
        setTimeout(processQueue, 0);
    }

    function solveOne() {
        if (solving || !waiters.length) {
            return;
        }
        if (!widget) {
            createWidget();
            if (!widget) {
                failWaiters();
                return;
            }
        }

        var callback = waiters.shift();
        var target = widget;
        if (target.token && target.token !== consumedToken) {
            // Inline verification may already have produced the token for this submission.
            finishSolve(callback, target.token, null, null);
            return;
        }
        var settled = false;
        var timer = null;

        var finish = function (token) {
            if (settled) {
                return;
            }
            settled = true;
            if (timer) {
                clearTimeout(timer);
            }
            finishSolve(callback, token, onSolve, onError);
        };
        var onSolve = function (event) {
            var detail = event && event.detail ? event.detail : {};
            finish(detail.token || target.token || null);
        };
        var onError = function () {
            finish(null);
        };

        solving = true;
        target.addEventListener("solve", onSolve);
        target.addEventListener("error", onError);
        timer = setTimeout(function () {
            finish(null);
        }, WAIT_MS);

        try {
            var result = target.solve();
            if (result && typeof result.then === "function") {
                result.then(function (data) {
                    finish((data && data.token) || target.token || null);
                }, function () {
                    finish(null);
                });
            } else if (target.token) {
                finish(target.token);
            }
        } catch (e) {
            finish(null);
        }
    }

    function processQueue() {
        if (waiters.length) {
            solveOne();
        }
    }

    function requestToken(callback, url) {
        var codeRoute = codeRouteForPath(url);
        if (codeRoute) {
            var pending = pendingCodeChallenge;
            pendingCodeChallenge = null;
            if (pending && pending.path === codeRoute.path && Date.now() - pending.createdAt <= WAIT_MS) {
                callback(pending.token);
                return;
            }
            showCodeCaptcha().then(function (token) {
                callback(token);
            }, function () {
                callback(null);
            });
            return;
        }
        if (cfg.display !== "programmatic") {
            reconcile();
            if (!widget || !inline || !inlineHolderUsable()) {
                callback(null);
                return;
            }
        }
        waiters.push(callback);
        processQueue();
    }

    function mount() {
        loadWidget().then(function () {
            createWidget();
            processQueue();
        }, function () {
            failWaiters();
        });
    }

    function reconcile() {
        hideLegacyCaptcha();
        installNativePromptBridge();
        if (!window.customElements || !window.customElements.get("cap-widget")) {
            return;
        }
        if (cfg.display === "programmatic") {
            if (!widget) {
                createWidget();
            }
            return;
        }
        if (solving) {
            return;
        }
        if (widget && inline && inlineHolderUsable()) {
            return;
        }
        if (widget && !inline && !betterAnchorExists()) {
            return;
        }
        destroyWidget();
        createWidget();
        processQueue();
    }

    function scheduleReconcile() {
        if (reconcileTimer) {
            return;
        }
        reconcileTimer = setTimeout(function () {
            reconcileTimer = null;
            reconcile();
        }, 0);
    }

    function appendToken(body, token) {
        if (typeof FormData !== "undefined" && body instanceof FormData) {
            if (body.set) {
                body.set(cfg.field, token);
            } else {
                if (body.delete) {
                    body.delete(cfg.field);
                }
                body.append(cfg.field, token);
            }
            return body;
        }
        if (typeof URLSearchParams !== "undefined" && body instanceof URLSearchParams) {
            body.set(cfg.field, token);
            return body;
        }
        if (typeof body === "string") {
            var trimmed = body.replace(/^\s+/, "");
            if (trimmed.charAt(0) === "{") {
                try {
                    var object = JSON.parse(trimmed);
                    object[cfg.field] = token;
                    return JSON.stringify(object);
                } catch (e) {
                }
            }
            if (typeof URLSearchParams !== "undefined") {
                try {
                    var params = new URLSearchParams(body);
                    if (params.has(cfg.field)) {
                        params.set(cfg.field, token);
                        return params.toString();
                    }
                } catch (e) {
                }
            }
            return body + (body.length ? "&" : "") + encodeURIComponent(cfg.field) + "=" + encodeURIComponent(token);
        }
        if (body === null || body === undefined) {
            return encodeURIComponent(cfg.field) + "=" + encodeURIComponent(token);
        }
        return body;
    }

    var nativeOpen = XMLHttpRequest.prototype.open;
    var nativeSend = XMLHttpRequest.prototype.send;

    XMLHttpRequest.prototype.open = function (method, url) {
        this.__capGuard__ = {method: method, url: url};
        return nativeOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function (body) {
        var xhr = this;
        var info = xhr.__capGuard__;
        if (!info || !protectedRequest(info.url, info.method)) {
            return nativeSend.apply(this, arguments);
        }

        if ((body === null || body === undefined) && xhr.setRequestHeader) {
            try {
                xhr.setRequestHeader("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
            } catch (e) {
            }
        }
        requestToken(function (token) {
            try {
                nativeSend.call(xhr, token ? appendToken(body, token) : body);
            } catch (e) {
                try {
                    nativeSend.call(xhr, body);
                } catch (ignored) {
                }
            }
        }, info.url);
    };

    if (window.fetch) {
        var nativeFetch = window.fetch;
        window.fetch = function (input, init) {
            var url = typeof input === "string" ? input : ((input && input.url) || "");
            var method = (init && init.method) || (input && input.method) || "GET";
            if (!protectedRequest(url, method)) {
                return nativeFetch.apply(this, arguments);
            }

            var originalInit = init || {};
            return new Promise(function (resolve, reject) {
                requestToken(function (token) {
                    try {
                        var nextInit = {};
                        Object.keys(originalInit).forEach(function (key) {
                            nextInit[key] = originalInit[key];
                        });
                        nextInit.body = token ? appendToken(originalInit.body, token) : originalInit.body;

                        if (token && typeof nextInit.body === "string") {
                            var headers = nextInit.headers || {};
                            if (typeof Headers !== "undefined" && headers instanceof Headers) {
                                if (!headers.has("Content-Type")) {
                                    headers.set("Content-Type", "application/x-www-form-urlencoded; charset=UTF-8");
                                }
                            } else {
                                var hasContentType = false;
                                Object.keys(headers).forEach(function (key) {
                                    if (key.toLowerCase() === "content-type") hasContentType = true;
                                });
                                if (!hasContentType) {
                                    headers["Content-Type"] = "application/x-www-form-urlencoded; charset=UTF-8";
                                }
                            }
                            nextInit.headers = headers;
                        }
                        nativeFetch.call(window, input, nextInit).then(resolve, reject);
                    } catch (e) {
                        reject(e);
                    }
                }, url);
            });
        };
    }

    var boot = function () {
        hideLegacyCaptcha();
        installNativePromptBridge();
        mount();
        if (typeof MutationObserver !== "undefined" && document.body) {
            try {
                new MutationObserver(scheduleReconcile).observe(document.body, {
                    childList: true,
                    subtree: true,
                    attributes: true,
                    attributeFilter: ["class", "style"]
                });
            } catch (e) {
            }
        }
    };

    if (document.body) {
        boot();
    } else {
        document.addEventListener("DOMContentLoaded", boot);
    }
})();
