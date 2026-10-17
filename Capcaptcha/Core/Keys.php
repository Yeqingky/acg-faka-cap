<?php
declare(strict_types=1);

namespace App\Plugin\Capcaptcha\Core;

/**
 * Cap 单站点密钥配置.
 *
 * Cap Standalone 的一个 Site Key 可以由 Cap 侧管理多个域名, 插件不需要像
 * Turnstile 参考实现那样维护域名到密钥组的映射. 插件只负责读取一套 Cap 实例,
 * Site Key 和 Secret Key, 并把同一个公开 endpoint 提供给前端和服务端校验.
 */
class Keys
{
    /**
     * @var array{endpoint:string, site_key:string, secret_key:string}|null
     */
    private static ?array $cache = null;

    /**
     * 返回完整配置. 任意一项为空都视为未配置.
     *
     * @return array{endpoint:string, site_key:string, secret_key:string}|null
     */
    public static function resolve(): ?array
    {
        if (self::$cache !== null) {
            return self::$cache;
        }

        $config = (array)getPluginConfig('Capcaptcha');
        $entry = [
            'endpoint' => self::normalizeEndpoint((string)($config['endpoint'] ?? '')),
            'site_key' => trim((string)($config['site_key'] ?? '')),
            'secret_key' => trim((string)($config['secret_key'] ?? '')),
        ];

        if ($entry['endpoint'] === '' || $entry['site_key'] === '' || $entry['secret_key'] === '') {
            return self::$cache = null;
        }
        return self::$cache = $entry;
    }

    /**
     * 与生命周期检查兼容的布尔接口.
     */
    public static function configured(): bool
    {
        return self::resolve() !== null;
    }

    /**
     * Cap widget API endpoint: <instance>/<site-key>/
     */
    public static function widgetEndpoint(): string
    {
        $entry = self::resolve();
        return $entry === null ? '' : self::widgetEndpointFor($entry);
    }

    /**
     * @param array{endpoint:string, site_key:string} $entry
     */
    public static function widgetEndpointFor(array $entry): string
    {
        $endpoint = rtrim((string)($entry['endpoint'] ?? ''), '/');
        $siteKey = rawurlencode((string)($entry['site_key'] ?? ''));
        if ($endpoint === '' || $siteKey === '') {
            return '';
        }
        return $endpoint . '/' . $siteKey . '/';
    }

    /**
     * Cap siteverify endpoint: <instance>/<site-key>/siteverify
     *
     * @param array{endpoint:string, site_key:string} $entry
     */
    public static function verifyEndpointFor(array $entry): string
    {
        $widgetEndpoint = self::widgetEndpointFor($entry);
        return $widgetEndpoint === '' ? '' : $widgetEndpoint . 'siteverify';
    }

    /**
     * 只接受 http/https 绝对 URL, 去掉末尾斜杠, 拒绝用户信息、查询参数和锚点.
     */
    public static function normalizeEndpoint(string $endpoint): string
    {
        $endpoint = trim($endpoint);
        if ($endpoint === '') {
            return '';
        }

        $parts = parse_url($endpoint);
        if (!is_array($parts) || !isset($parts['scheme'], $parts['host'])) {
            return '';
        }

        $scheme = strtolower((string)$parts['scheme']);
        if (!in_array($scheme, ['http', 'https'], true)) {
            return '';
        }
        if (isset($parts['user']) || isset($parts['pass']) || isset($parts['query']) || isset($parts['fragment'])) {
            return '';
        }

        $host = strtolower(trim((string)$parts['host']));
        if ($host === '') {
            return '';
        }

        $authority = $scheme . '://' . $host;
        if (isset($parts['port'])) {
            $port = (int)$parts['port'];
            if ($port < 1 || $port > 65535) {
                return '';
            }
            $authority .= ':' . $port;
        }

        $path = trim((string)($parts['path'] ?? ''), '/');
        return rtrim($authority . ($path === '' ? '' : '/' . $path), '/');
    }
}
