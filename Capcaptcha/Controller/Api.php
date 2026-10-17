<?php
declare(strict_types=1);

namespace App\Plugin\Capcaptcha\Controller;

use App\Controller\Base\API\UserPlugin;
use App\Plugin\Capcaptcha\Core\Keys;
use App\Plugin\Capcaptcha\Hook\Main;
use Kernel\Exception\JSONException;
use Kernel\Util\Session;

class Api extends UserPlugin
{
    /**
     * 全站拦截页提交 Cap token, 校验通过后放行当前会话.
     *
     * @throws JSONException
     */
    public function verify(): array
    {
        $token = Main::tokenFromRequest('token');
        if ($token === '') {
            throw new JSONException('验证数据缺失, 请刷新页面重试');
        }

        $entry = Keys::resolve();
        if ($entry === null) {
            throw new JSONException('本站尚未配置 Cap 密钥, 请联系站长在插件配置中补充');
        }

        if (!Main::siteverify($entry, $token)) {
            throw new JSONException('人机验证未通过, 请重试');
        }

        Session::set(Main::GATE_SESSION, time());
        return $this->json(200, 'success');
    }
}
