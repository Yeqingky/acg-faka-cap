<?php
declare(strict_types=1);

namespace App\Plugin\Capcaptcha\Core;

use App\Util\Http;

final class Verifier
{
    public const FIELD = 'cap-token';
    public const GATE_SESSION = 'cap_gate_passed';

    private const BREAKER_THRESHOLD = 5;
    private const BREAKER_OPEN_SECONDS = 300;

    /** 从 POST 或 JSON body 读取一次性 token. */
    public static function tokenFromRequest(string $tokenField = self::FIELD): string
    {
        $token = (string)($_POST[$tokenField] ?? '');
        if ($token !== '') {
            return $token;
        }

        $raw = (string)file_get_contents('php://input');
        if ($raw === '' || !str_starts_with(ltrim($raw), '{')) {
            return '';
        }

        $json = json_decode($raw, true);
        return is_array($json) ? (string)($json[$tokenField] ?? '') : '';
    }

    /**
     * 调用 Cap 的 reCAPTCHA 兼容 /siteverify 接口.
     * 熔断打开期间跳过网络请求并按短时降级策略放行; 缺失或超长 token 始终拒绝.
     *
     * @param array{endpoint:string, site_key:string, secret_key:string} $entry
     */
    public static function siteverify(array $entry, string $token): bool
    {
        $secret = trim((string)($entry['secret_key'] ?? ''));
        $verifyEndpoint = Keys::verifyEndpointFor($entry);
        if ($secret === '' || $verifyEndpoint === '' || $token === '' || strlen($token) > 16384) {
            return false;
        }

        if (self::breakerOpen()) {
            return true;
        }

        try {
            $response = Http::make([
                'verify' => true,
                'timeout' => 10,
                'http_errors' => false,
            ])->post($verifyEndpoint, [
                'headers' => [
                    'Accept' => 'application/json',
                    'Content-Type' => 'application/json',
                ],
                'json' => [
                    'secret' => $secret,
                    'response' => $token,
                ],
            ]);

            $body = json_decode((string)$response->getBody(), true);
            if (!is_array($body)) {
                return self::breakerTrip();
            }

            // 收到 Cap 的明确 JSON 答复, 说明链路恢复. success=false 仍然拒绝当前请求.
            self::breakerReset();
            return ($body['success'] ?? false) === true;
        } catch (\Throwable) {
            // 网络故障默认拒绝, 连续故障后短时降级, 避免单次网络抖动锁死所有管理员.
            return self::breakerTrip();
        }
    }

    private static function breakerFile(): string
    {
        return BASE_PATH . '/runtime/plugin/Capcaptcha/breaker.json';
    }

    private static function breakerOpen(): bool
    {
        $state = self::breakerRead();
        return $state['open_until'] > time();
    }

    /**
     * @return array{fails:int, open_until:int}
     */
    private static function breakerRead(): array
    {
        $raw = @file_get_contents(self::breakerFile());
        $state = $raw === false ? [] : (array)json_decode((string)$raw, true);
        return [
            'fails' => (int)($state['fails'] ?? 0),
            'open_until' => (int)($state['open_until'] ?? 0),
        ];
    }

    /**
     * @param array{fails:int, open_until:int} $state
     */
    private static function breakerWrite(array $state): void
    {
        $dir = dirname(self::breakerFile());
        if (!is_dir($dir)) {
            @mkdir($dir, 0777, true);
        }
        @file_put_contents(self::breakerFile(), json_encode($state));
    }

    private static function breakerTrip(): bool
    {
        $state = self::breakerRead();
        if ($state['open_until'] > time()) {
            return true;
        }

        $fails = $state['fails'] + 1;
        if ($fails >= self::BREAKER_THRESHOLD) {
            @error_log('[Cap] 连续 ' . $fails . ' 次无法连接 Cap siteverify, 已进入降级放行 ' . self::BREAKER_OPEN_SECONDS . ' 秒, 请检查服务器出站网络');
            self::breakerWrite(['fails' => $fails, 'open_until' => time() + self::BREAKER_OPEN_SECONDS]);
            return true;
        }

        self::breakerWrite(['fails' => $fails, 'open_until' => 0]);
        return false;
    }

    private static function breakerReset(): void
    {
        $state = self::breakerRead();
        if ($state['fails'] !== 0 || $state['open_until'] !== 0) {
            self::breakerWrite(['fails' => 0, 'open_until' => 0]);
        }
    }
}
