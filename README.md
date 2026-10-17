# ACG Faka Capcaptcha Plugin

这是一个适用于 ACG Faka 的 Capcaptcha 插件, 接入自托管 Cap 人机验证服务. 实现参考了 ACG Faka 插件开发约定和现有 Turnstile 插件的防护流程, 但没有复用 Turnstile 的代码资源或 logo.

## 设计概要

```text
浏览器
  ├─ Cap widget -> Cap Standalone challenge/redeem
  └─ 受保护请求 + cap-token -> ACG Faka
                                      └─ POST /<site-key>/siteverify -> Cap Standalone
```

插件只保存一套 Cap 配置:

- Cap 实例地址, 例如 `https://cap.example.com`.
- Site Key.
- Secret Key.

同一个 Site Key 的多域名由 Cap 控制台管理, 插件不再维护域名到密钥的第二套映射.

## 目录

- `Capcaptcha/Config/Info.php`: 插件元数据.
- `Capcaptcha/Config/Config.php`: 默认配置.
- `Capcaptcha/Config/Submit.js`: 后台配置表单.
- `Capcaptcha/Core/Keys.php`: 配置解析和 Cap endpoint 构造.
- `Capcaptcha/Hook/Main.php`: 生命周期, 全站拦截, 接口守卫, 页面注入和 CSP.
- `Capcaptcha/Controller/Api.php`: 全站拦截页的验证路由.
- `Capcaptcha/View/challenge.html`: 全站验证页面.
- `Capcaptcha/View/guard.js`: 受保护请求的 token 获取和注入.
- `Capcaptcha/Image/icon.png`: 用户提供的 512x512 蓝色帽子 PNG logo.

## Cap 端配置

按照 Cap Standalone 文档创建站点密钥, 记录 Site Key 和 Secret Key. 公开给浏览器的 endpoint 格式为:

```text
https://<cap-instance>/<site-key>/
```

服务端验证接口为:

```text
POST https://<cap-instance>/<site-key>/siteverify
Content-Type: application/json

{"secret":"<secret-key>","response":"<cap-token>"}
```

插件不会把已保存的 Secret Key 输出到前台 HTML 或浏览器运行时配置, 也不会把 Cap 控制台的 `ADMIN_KEY` 当作 Secret Key. 后台密钥输入框不回显现有值; 留空保存会保留旧密钥, 输入新值才会替换.

## Hook 与路由架构

插件不修改 ACG Faka 核心, 通过以下点位接入:

| 点位 | 用途 |
| --- | --- |
| `0x30` | 全站 GET 请求拦截 |
| `0x31` | 登录, 注册, 找回密码, 下单和后台登录的服务端 token 守卫 |
| `0x47` | 向前台 HTML 注入 widget 加载器和请求拦截脚本, 支持商品列表页 AJAX/弹窗购买 |
| `0x41`, `0x42` | 登录和注册表单官方挂载点 |
| `0x51` | 商品详情 custom widget 挂载点 |
| `0x60` | 后台登录表单官方挂载点 |
| `0x8102` | 放行 Cap widget, Cap API, WASM 和 Blob Worker 的 CSP 来源 |

全站验证页通过 `/plugin/Capcaptcha/api/verify` 接收 token. 启用防护场景后, 浏览器守卫脚本会注入前台 HTML, 并可在商品列表页动态加载的购买表单中挂载 widget. Inline 模式会及时协调挂载, 且在求解前确认 widget 位于可见表单内; 用户已完成验证时, 首次提交复用现有 token 并保持已验证状态, 后续请求会为已消费的一次性 token 重新求解. 登录和注册页的官方挂载点会移到各自提交按钮前. 邮箱/手机验证码发送路由使用独立弹窗 widget 和一次性 token, 不复用注册表单验证. 只有配置中的受保护 API 会附加 `cap-token`, 并由 `0x31` 在控制器执行前校验.

## 插件场景

可配置的防护场景仅由插件自身开关控制; 宿主原生人机验证开关不会启用或关闭 Cap 守卫:

- 全站访问拦截.
- 前台登录.
- 注册及注册验证码.
- 找回密码及找回验证码.
- 商品下单和充值下单.
- 后台登录.

全站拦截自动放行后台, 管理员安全入口, 插件路由, 安装路由和支付/充值回调.

## 宿主原生验证码接管

ACG Faka 使用按场景配置的原生验证码开关. 除始终受保护的邮箱和手机绑定接口外, Cap 守卫只由插件对应的 `gate_*` 场景开关控制:

- 插件场景开关开启时, Cap 验证通过后写入宿主当前 `cap_<action>` session key, 并更新请求中的 `captcha`, 以满足仍开启的宿主图形码检查. 即使宿主原生验证码开关关闭, 插件仍独立要求 Cap 验证.
- 插件场景开关关闭时, 插件不拦截该场景; 宿主原生验证码按宿主自身开关照常工作.
- `registered_type` 和 `forget_type` 只由宿主决定可用的邮箱/手机发码接口, 不会启用对应的 Cap 守卫.
- 邮箱和手机绑定接口在宿主中始终检查原生验证码, 插件仍始终使用 Cap 替代.
- 原生图形码输入框及 `message.prompt` 验证码弹窗只在对应 Cap 守卫启用时隐藏或跳过.
- 全站访问拦截会跳过已有独立 Cap 守卫的页面, 其他前台页面仍按 `gate_site` 设置拦截.

兼容桥接依赖宿主当前的 `cap_<action>` session key 和请求对象中的 POST 快照. 这是插件独立实现的边界; ACG Faka 升级后, 需要重新实测登录、注册、发码、下单和后台登录流程.

## 前端模式

- `inline`: 在登录, 注册和购买表单附近显示 Cap widget. 这是推荐模式.
- `programmatic`: 不显示组件, 受保护请求发送前通过 Cap widget 的 `solve()` 自动取得 token. 该模式可能增加提交等待时间.

默认 widget 地址固定为 `@cap.js/widget@0.1.57`. 可以改为 Cap Standalone 的 `/assets/widget.js` 或其他自托管地址. `wasm_url` 可用于自托管 WASM.

## 安全行为

- 受保护接口缺少 token 时直接拒绝.
- Cap `/siteverify` 使用 JSON 请求体, 只提交 `secret` 和 `response`.
- Cap token 由 Cap 服务端按一次性凭据处理, 插件不缓存和复用 token.
- Cap 标准响应不提供 Turnstile 风格的 action 或 hostname 字段, 插件不会伪造这些校验.
- Cap 服务不可达时默认 fail-closed. 连续 5 次网络失败后进入 300 秒短时降级放行, 并写入 `runtime/plugin/Capcaptcha/breaker.json`.
- 组件脚本, Cap endpoint 和 WASM endpoint 会通过 CSP hook 加入允许列表; Cap PoW worker 使用 `blob:` worker source.

## 安装和验证

1. 将 `Capcaptcha/` 目录放到 ACG Faka 的 `app/Plugin/Capcaptcha/`.
2. 在后台配置 Cap 实例地址, Site Key 和 Secret Key, 保存.
3. 先保持所有防护开关关闭, 启用插件并确认组件可以加载.
4. 逐项开启防护场景, 依次测试登录, 注册, 找回密码和下单.
5. 修改 Hook 文件后停用再启用插件, 让内核重建 hook 注册表.
6. 模板异常时只清理 `runtime/view/compile`.

## 本地检查

```bash
php -l Capcaptcha/Config/Info.php
php -l Capcaptcha/Config/Config.php
php -l Capcaptcha/Core/Keys.php
php -l Capcaptcha/Hook/Main.php
php -l Capcaptcha/Controller/Api.php
git diff --check
git check-ignore -v Turnstile/Config/Info.php
```

前端脚本不依赖本仓库的 Node 项目. 如果本机安装了 Node.js, 可额外执行:

```bash
node --check Capcaptcha/Config/Submit.js
node --check Capcaptcha/View/guard.js
```

## 官方文档

- ACG Faka 开发者文档: <https://faka.wiki/zh-cn/dev/>
- Cap 快速开始: <https://capjs.js.org/guide/>
- Cap widget: <https://capjs.js.org/guide/widget.html>
- Cap Standalone: <https://capjs.js.org/guide/standalone/index.html>
