<?php
declare(strict_types=1);

namespace App\Plugin\Capcaptcha\Hook;

use App\Controller\Base\View\UserPlugin;
use App\Plugin\Capcaptcha\Core\Keys;
use App\Plugin\Capcaptcha\Core\Verifier;
use Kernel\Annotation\Hook;
use Kernel\Annotation\Plugin;
use Kernel\Exception\JSONException;
use Kernel\Util\Session;

class Main extends UserPlugin
{

    /** 全站验证通过后的有效期, 秒. */
    public const GATE_TTL = 7200;

    /** 生产环境默认固定的 Cap widget 版本. */
    private const DEFAULT_WIDGET_URL = 'https://cdn.jsdelivr.net/npm/@cap.js/widget@0.1.57';

    /**
     * 受保护接口清单. 场景守卫由插件独立开关控制; 邮箱和手机绑定接口保持始终保护.
     *
     * @return array<int, array{
     *   path:string,
     *   page:string|string[],
     *   class:string,
     *   method:string,
     *   feature:?string,
     *   captcha_action?:string,
     *   captcha_prompt?:bool,
     *   native_always?:bool,
     *   request_post?:bool
     * }>
     */
    private static function guards(): array
    {
        $auth = \App\Controller\User\Api\Authentication::class;
        $security = \App\Controller\User\Api\Security::class;
        return [
            ['path' => '/user/api/authentication/login', 'page' => '/user/authentication/login', 'class' => $auth, 'method' => 'login', 'feature' => 'gate_login', 'captcha_action' => 'login'],

            ['path' => '/user/api/authentication/register', 'page' => '/user/authentication/register', 'class' => $auth, 'method' => 'register', 'feature' => 'gate_register', 'captcha_action' => 'register'],
            ['path' => '/user/api/authentication/emailRegisterCaptcha', 'page' => '/user/authentication/register', 'class' => $auth, 'method' => 'emailRegisterCaptcha', 'feature' => 'gate_register', 'captcha_action' => 'emailRegisterCaptcha', 'captcha_prompt' => true],
            ['path' => '/user/api/authentication/phoneRegisterCaptcha', 'page' => '/user/authentication/register', 'class' => $auth, 'method' => 'phoneRegisterCaptcha', 'feature' => 'gate_register', 'captcha_action' => 'phoneRegisterCaptcha', 'captcha_prompt' => true],

            ['path' => '/user/api/authentication/password', 'page' => ['/user/authentication/emailForget', '/user/authentication/phoneForget'], 'class' => $auth, 'method' => 'password', 'feature' => 'gate_forget'],
            ['path' => '/user/api/authentication/emailForgetCaptcha', 'page' => '/user/authentication/emailForget', 'class' => $auth, 'method' => 'emailForgetCaptcha', 'feature' => 'gate_forget', 'captcha_action' => 'emailForgetCaptcha', 'captcha_prompt' => true],
            ['path' => '/user/api/authentication/phoneForgetCaptcha', 'page' => '/user/authentication/phoneForget', 'class' => $auth, 'method' => 'phoneForgetCaptcha', 'feature' => 'gate_forget', 'captcha_action' => 'phoneForgetCaptcha', 'captcha_prompt' => true],

            ['path' => '/user/api/order/trade', 'page' => '/user/index/item', 'class' => \App\Controller\User\Api\Order::class, 'method' => 'trade', 'feature' => 'gate_trade', 'captcha_action' => 'trade', 'request_post' => true],
            ['path' => '/user/api/recharge/trade', 'page' => '/user/recharge/index', 'class' => \App\Controller\User\Api\Recharge::class, 'method' => 'trade', 'feature' => 'gate_trade'],

            ['path' => '/admin/api/authentication/login', 'page' => '/admin/authentication/login', 'class' => \App\Controller\Admin\Api\Authentication::class, 'method' => 'login', 'feature' => 'gate_admin', 'captcha_action' => 'adminLogin', 'request_post' => true],

            ['path' => '/user/api/security/emailBindNew', 'page' => '/user/security/email', 'class' => $security, 'method' => 'emailBindNew', 'feature' => null, 'captcha_action' => 'emailBindNew', 'native_always' => true, 'captcha_prompt' => true],
            ['path' => '/user/api/security/phoneBindNew', 'page' => '/user/security/phone', 'class' => $security, 'method' => 'phoneBindNew', 'feature' => null, 'captcha_action' => 'phoneBindNew', 'native_always' => true, 'captcha_prompt' => true],
        ];
    }

    /**
     * 启用插件前检查完整配置.
     *
     * @throws JSONException
     */
    #[Plugin(state: Plugin::START)]
    public function start(): void
    {
        if (!Keys::configured()) {
            throw new JSONException('请先在插件配置中填写完整的 Cap 实例地址, Site Key 和 Secret Key, 保存后再启用插件');
        }
    }

    /**
     * 全站访问拦截. 后台, 安全入口, 插件路由与支付回调自动放行.
     */
    #[Hook(point: 0x30)]
    public function gate(): void
    {
        $config = (array)getPluginConfig('Capcaptcha');
        if (($config['gate_site'] ?? '') != '1') {
            return;
        }

        if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? 'GET')) !== 'GET') {
            return;
        }

        $passedAt = (int)Session::get(Verifier::GATE_SESSION);
        if ($passedAt > 0 && (time() - $passedAt) < self::GATE_TTL) {
            return;
        }

        $endpoint = Keys::widgetEndpoint();
        if ($endpoint === '') {
            return;
        }

        $route = strtolower(trim((string)($_GET['s'] ?? ''), '/'));
        if (self::isExemptRoute($route) || self::pageHasCapGuard($route, $config)) {
            return;
        }

        if (!headers_sent()) {
            header('Cache-Control: no-store, no-cache, must-revalidate');
        }

        $nonceValue = self::cspNonce();
        echo $this->render('安全验证', 'challenge.html', [
            'endpoint' => self::html($endpoint),
            'endpointJson' => self::json($endpoint),
            'widgetScript' => self::html(self::widgetScript($config)),
            'wasmUrlJson' => self::json(self::wasmUrl($config)),
            'nonceAttr' => self::nonceAttr($nonceValue),
            'nonceJson' => self::json($nonceValue),
        ]);
        exit;
    }

    /**
     * 登录, 注册, 发码, 找回密码, 下单, 绑定和后台登录接口守卫.
     *
     * @param mixed $controller
     * @param mixed $action
     * @throws JSONException
     */
    #[Hook(point: 0x31)]
    public function actionGuard(mixed $controller = null, mixed $action = null): void
    {
        if (!is_object($controller) || !is_string($action)) {
            return;
        }

        $actionName = strtolower($action);
        $guard = null;
        foreach (self::guards() as $item) {
            if (strtolower($item['method']) === $actionName && $controller instanceof $item['class']) {
                $guard = $item;
                break;
            }
        }

        if ($guard === null) {
            return;
        }

        $config = (array)getPluginConfig('Capcaptcha');
        if (!self::guardEnabled($guard, $config)) {
            return;
        }

        $entry = Keys::resolve();
        $token = Verifier::tokenFromRequest();
        if ($entry === null || $token === '' || !Verifier::siteverify($entry, $token)) {
            throw new JSONException('请完成人机验证后再提交, 如页面未出现验证组件请刷新重试');
        }
        self::satisfyNativeCaptcha($controller, $guard);
    }

    /**
     * 向受保护的前台页面和后台登录页注入 Cap widget 与请求守卫脚本.
     */
    #[Hook(point: 0x47)]
    public function inject(mixed $route = null, mixed $response = null): void
    {
        if (!is_string($response) || $response === '') {
            return;
        }
        if (strtoupper((string)($_SERVER['REQUEST_METHOD'] ?? '')) !== 'GET') {
            return;
        }

        $routePath = strtolower(trim((string)$route, '/'));
        $first = explode('/', $routePath)[0];
        if ($first === 'admin' && $routePath !== 'admin/authentication/login') {
            return;
        }
        if ($first === 'plugin' || $first === 'install') {
            return;
        }

        $entrance = strtolower(trim(trim((string)\App\Model\Config::get('admin_entrance'), '/')));
        if ($entrance !== '' && $first === $entrance) {
            return;
        }

        $config = (array)getPluginConfig('Capcaptcha');
        $entry = Keys::resolve();
        if ($entry === null) {
            return;
        }

        $paths = [];
        $pages = [];
        $nativeActions = [];
        $codeRoutes = [];
        foreach (self::guards() as $item) {
            if (!self::guardEnabled($item, $config)) {
                continue;
            }
            $paths[] = strtolower($item['path']);
            $pages = array_merge($pages, self::guardPages($item));
            if (isset($item['captcha_action'])) {
                $nativeActions[] = $item['captcha_action'];
            }
            if (!empty($item['captcha_prompt']) && isset($item['captcha_action'])) {
                $codeRoutes[] = [
                    'path' => strtolower($item['path']),
                    'action' => $item['captcha_action'],
                ];
            }
        }
        $pages = array_values(array_unique($pages));
        // Purchase forms may be loaded into a modal on the listing route; inject here
        // so MutationObserver can attach after the form appears.
        if (!$paths) {
            return;
        }

        $script = self::guardScript();
        if ($script === '') {
            return;
        }

        $pos = strripos($response, '</body>');
        if ($pos === false) {
            return;
        }

        $guardConfig = [
            'endpoint' => self::widgetEndpointFor($entry),
            'field' => self::FIELD,
            'widgetUrl' => self::widgetScript($config),
            'wasmUrl' => self::wasmUrl($config),
            'display' => (($config['display'] ?? 'inline') === 'programmatic') ? 'programmatic' : 'inline',
            'workers' => self::workerCount($config),
            'paths' => array_values(array_unique($paths)),
            'pages' => $pages,
            'nativeActions' => array_values(array_unique($nativeActions)),
            'codeRoutes' => $codeRoutes,
            'nonce' => self::cspNonce(),
        ];
        $cfg = self::json($guardConfig);
        $nonce = self::nonceAttr((string)$guardConfig['nonce']);
        $html = "\n<script{$nonce}>window.__capGuardCfg__={$cfg};</script>\n<script{$nonce}>{$script}</script>\n</body>";

        if (!headers_sent()) {
            header('Content-type: text/html; charset=utf-8');
        }
        echo substr_replace($response, $html, $pos, strlen('</body>'));
        exit;
    }

    /** 前台登录页官方挂载点. */
    #[Hook(point: 0x41)]
    public function loginSlot(): void
    {
        echo self::slotHtml('gate_login');
    }

    /** 前台注册页官方挂载点. */
    #[Hook(point: 0x42)]
    public function registerSlot(): void
    {
        echo self::slotHtml('gate_register');
    }

    /**
     * 商品详情数据中注入 custom widget 锚点. 新版主题优先使用该锚点, 旧版由 guard.js 探测购买数量输入框.
     */
    #[Hook(point: 0x51)]
    public function commodityWidget(array &$data): void
    {
        $config = (array)getPluginConfig('Capcaptcha');
        if (!self::featureEnabled('gate_trade', $config) || Keys::widgetEndpoint() === '') {
            return;
        }
        if (!self::coreSupportsCustomWidget()) {
            return;
        }

        $widgets = is_array($data['widget'] ?? null) ? $data['widget'] : [];
        foreach ($widgets as $widget) {
            if (($widget['name'] ?? '') === 'cap') {
                return;
            }
        }
        $widgets[] = [
            'type' => 'custom',
            'name' => 'cap',
            'cn' => '人机验证',
            'placeholder' => '',
            'dict' => '',
            'regex' => '',
            'error' => '',
        ];
        $data['widget'] = $widgets;
    }

    /** 后台登录页官方挂载点. 旧核心没有该常量, 使用字面量保持兼容. */
    #[Hook(point: 0x60)]
    public function adminLoginSlot(): void
    {
        echo self::slotHtml('gate_admin');
    }

    /**
     * 向内核声明 Cap widget, Cap API 和可选 WASM 的 CSP 来源.
     */
    #[Hook(point: 0x8102)]
    public function CSP_SOURCE_ALLOW(array &$sources): void
    {
        $config = (array)getPluginConfig('Capcaptcha');
        // widget 在未指定 wasm_url 时仍会从默认 CDN 获取 WASM 和 pako 回退脚本.
        $this->allowUrlSource($sources, 'script-src', self::DEFAULT_WIDGET_URL);
        $this->allowUrlSource($sources, 'connect-src', self::DEFAULT_WIDGET_URL);
        $this->allowUrlSource($sources, 'script-src', self::widgetScript($config));
        $this->allowUrlSource($sources, 'connect-src', self::widgetScript($config));
        $this->allowUrlSource($sources, 'connect-src', self::wasmUrl($config));

        $entry = Keys::resolve();
        if ($entry !== null) {
            $this->allowUrlSource($sources, 'connect-src', $entry['endpoint']);
        }

        // Cap widget 使用 Blob Worker 求解 PoW. 没有 worker-src 时部分 CSP 会回退到 script-src.
        $sources['worker-src'] = array_values(array_unique(array_merge((array)($sources['worker-src'] ?? []), ['blob:'])));
    }


    /**
     * @param array<string, mixed> $config
     */
    private static function widgetScript(array $config): string
    {
        $value = trim((string)($config['widget_url'] ?? ''));
        if ($value === '') {
            return self::DEFAULT_WIDGET_URL;
        }
        if (str_starts_with($value, '/') && !str_starts_with($value, '//')) {
            return $value;
        }

        $parts = parse_url($value);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || !in_array(strtolower((string)$parts['scheme']), ['http', 'https'], true)) {
            return self::DEFAULT_WIDGET_URL;
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            return self::DEFAULT_WIDGET_URL;
        }
        return $value;
    }

    /**
     * @param array<string, mixed> $config
     */
    private static function wasmUrl(array $config): string
    {
        $value = trim((string)($config['wasm_url'] ?? ''));
        if ($value === '') {
            return '';
        }
        if (str_starts_with($value, '/') && !str_starts_with($value, '//')) {
            return $value;
        }

        $parts = parse_url($value);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host']) || !in_array(strtolower((string)$parts['scheme']), ['http', 'https'], true)) {
            return '';
        }
        if (isset($parts['user']) || isset($parts['pass'])) {
            return '';
        }
        return $value;
    }

    /**
     * @param array<string, mixed> $config
     */
    private static function workerCount(array $config): int
    {
        $count = (int)($config['worker_count'] ?? 0);
        return $count >= 1 && $count <= 16 ? $count : 0;
    }

    /**
     * @param array{endpoint:string, site_key:string} $entry
     */
    private static function widgetEndpointFor(array $entry): string
    {
        return Keys::widgetEndpointFor($entry);
    }

    /**
     * @param array<string, array<int, string>> $sources
     */
    private function allowUrlSource(array &$sources, string $directive, string $url): void
    {
        if ($url === '' || str_starts_with($url, '/')) {
            return;
        }
        $parts = parse_url($url);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) {
            return;
        }
        $origin = strtolower((string)$parts['scheme']) . '://' . strtolower((string)$parts['host']);
        if (isset($parts['port'])) {
            $origin .= ':' . (int)$parts['port'];
        }
        $sources[$directive] = array_values(array_unique(array_merge((array)($sources[$directive] ?? []), [$origin])));
    }

    /**
     * @param string $feature
     */
    private static function slotHtml(string $feature): string
    {
        $config = (array)getPluginConfig('Capcaptcha');
        if (!self::featureEnabled($feature, $config) || Keys::widgetEndpoint() === '') {
            return '';
        }
        return '<div class="cap-guard-slot" data-cap-feature="' . self::html($feature) . '" style="margin:12px 0;"></div>';
    }

    private static function coreSupportsCustomWidget(): bool
    {
        static $support = null;
        if ($support === null) {
            $helper = @file_get_contents(BASE_PATH . '/app/View/User/Helper.php');
            $support = $helper !== false && str_contains($helper, 'acg-widget-custom');
        }
        return $support;
    }

    /**
     * Whether this guard is enabled by its plugin scenario switch.
     *
     * @param array<string, mixed> $guard
     * @param array<string, mixed> $config
     */
    private static function guardEnabled(array $guard, array $config): bool
    {
        if (($guard['native_always'] ?? false) === true) {
            return true;
        }

        $feature = $guard['feature'] ?? null;
        return is_string($feature) && ($config[$feature] ?? '') == '1';
    }

    /**
     * @param array<string, mixed> $config
     */
    private static function featureEnabled(string $feature, array $config): bool
    {
        foreach (self::guards() as $guard) {
            if (($guard['feature'] ?? null) === $feature && self::guardEnabled($guard, $config)) {
                return true;
            }
        }
        return false;
    }

    /**
     * @param array<string, mixed> $guard
     * @return string[]
     */
    private static function guardPages(array $guard): array
    {
        $pages = $guard['page'] ?? [];
        if (!is_array($pages)) {
            $pages = [$pages];
        }
        $normalized = [];
        foreach ($pages as $page) {
            if (is_string($page) && trim($page, '/') !== '') {
                $normalized[] = '/' . strtolower(trim($page, '/'));
            }
        }
        return $normalized;
    }

    /**
     * Skip the full-page gate when the current view has its own Cap-protected action.
     *
     * @param array<string, mixed> $config
     */
    private static function pageHasCapGuard(string $route, array $config): bool
    {
        $route = '/' . strtolower(trim($route, '/'));
        foreach (self::guards() as $guard) {
            if (!self::guardEnabled($guard, $config)) {
                continue;
            }
            if (in_array($route, self::guardPages($guard), true)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Satisfy the host's legacy image-CAPTCHA check only after Cap passed.
     *
     * This bridge mirrors the host's current `cap_<action>` session key and request
     * field. Request-backed actions need their already-created request snapshot updated.
     *
     * @param array<string, mixed> $guard
     * @throws JSONException
     */
    private static function satisfyNativeCaptcha(object $controller, array $guard): void
    {
        $action = $guard['captcha_action'] ?? null;
        if (!is_string($action) || $action === '') {
            return;
        }

        $_POST['captcha'] = '1';
        $_REQUEST['captcha'] = '1';
        Session::set('cap_' . $action, '1');

        if (($guard['request_post'] ?? false) !== true) {
            return;
        }

        try {
            $controllerReflection = new \ReflectionObject($controller);
            if (!$controllerReflection->hasProperty('request')) {
                throw new \ReflectionException('controller request property is unavailable');
            }
            $requestProperty = $controllerReflection->getProperty('request');
            $requestProperty->setAccessible(true);
            $request = $requestProperty->getValue($controller);
            if (!is_object($request)) {
                throw new \ReflectionException('controller request is unavailable');
            }

            $requestReflection = new \ReflectionObject($request);
            if (!$requestReflection->hasProperty('post')) {
                throw new \ReflectionException('request post property is unavailable');
            }
            $postProperty = $requestReflection->getProperty('post');
            $postProperty->setAccessible(true);
            $post = $postProperty->getValue($request);
            if (!is_array($post)) {
                throw new \ReflectionException('request post data is unavailable');
            }
            $post['captcha'] = '1';
            $postProperty->setValue($request, $post);
        } catch (\Throwable) {
            Session::remove('cap_' . $action);
            throw new JSONException('Cap 人机验证适配失败, 请刷新页面重试');
        }
    }

    private static function isExemptRoute(string $route): bool
    {
        $first = explode('/', $route)[0];
        if ($first === 'admin' || $first === 'plugin' || $first === 'install') {
            return true;
        }

        $entrance = strtolower(trim(trim((string)\App\Model\Config::get('admin_entrance'), '/')));
        if ($entrance !== '' && $first === $entrance) {
            return true;
        }

        if (str_starts_with($route, 'user/api/order/callback') || str_starts_with($route, 'user/api/rechargenotification/callback')) {
            return true;
        }
        return false;
    }

    private static function guardScript(): string
    {
        static $script = null;
        if ($script === null) {
            $path = BASE_PATH . '/app/Plugin/Capcaptcha/View/guard.js';
            $script = file_exists($path) ? (string)file_get_contents($path) : '';
        }
        return $script;
    }

    private static function cspNonce(): string
    {
        try {
            if (class_exists('\\App\\Util\\Csp') && \App\Util\Csp::enabled()) {
                return (string)\App\Util\Csp::nonce();
            }
        } catch (\Throwable $e) {
        }
        return '';
    }

    private static function nonceAttr(string $nonce): string
    {
        return $nonce === '' ? '' : ' nonce="' . self::html($nonce) . '"';
    }

    private static function html(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private static function json(mixed $value): string
    {
        $json = json_encode($value, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE | JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT);
        return $json === false ? 'null' : $json;
    }
}
