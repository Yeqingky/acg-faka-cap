(() => {
    const source = (assign && assign.PLUGIN_CONFIG) ? assign.PLUGIN_CONFIG : (assign || {});
    const cfg = Object.assign({}, source);
    delete cfg.secret_key;
    const DEFAULT_WIDGET_URL = "https://cdn.jsdelivr.net/npm/@cap.js/widget@0.1.57";
    const value = (name, fallback) => {
        const current = cfg[name];
        return current === undefined || current === null || current === "" ? fallback : current;
    };

    return [
        {
            name: util.icon("fa-duotone fa-regular fa-shield-check") + " 基础配置",
            form: [
                {
                    title: false,
                    name: "guide",
                    type: "custom",
                    complete: (form, dom) => {
                        dom.html(`<div style="border:1px solid var(--md-divider,#e6edf5);border-radius:10px;padding:14px 16px;font-size:13px;line-height:2;color:var(--md-on-surface-med,#64748b)">
                            <b style="color:var(--md-on-surface,#0f172a)">配置步骤</b><br>
                            1. 启动 Cap Standalone, 在控制台创建一个站点密钥, 记下 Site Key 和对应的 Secret Key.<br>
                            2. 在下面填写 Cap 实例地址, 例如 <code>https://cap.example.com</code>. 不要把 <code>/site-key/</code> 路径手动填进实例地址.<br>
                            3. Cap 控制台负责同一个 Site Key 的域名管理, 本插件不再复制一套域名和密钥映射.<br>
                            4. Secret Key 只保存在服务端, 不会输出到浏览器. 至少保存一套完整配置后再启用插件.
                        </div>`);
                    }
                },
                {
                    title: "Cap 实例地址",
                    name: "endpoint",
                    type: "input",
                    default: value("endpoint", ""),
                    placeholder: "https://cap.example.com",
                    required: true,
                    tips: "填写 Cap Standalone 的公开根地址, 不要带 Site Key 路径, 查询参数或锚点."
                },
                {
                    title: "Site Key",
                    name: "site_key",
                    type: "input",
                    default: value("site_key", ""),
                    placeholder: "控制台创建的站点密钥",
                    required: true,
                    tips: "这是公开给浏览器使用的站点密钥. 多域名请在 Cap 控制台中统一管理."
                },
                {
                    title: "Secret Key",
                    name: "secret_key_editor",
                    type: "custom",
                    complete: (form, dom) => {
                        if (!dom.find('[data-cap-secret-editor]').length) {
                            dom.html(`<input type="password" data-cap-secret-editor autocomplete="new-password" spellcheck="false" style="display:block;width:100%;box-sizing:border-box;border:1px solid var(--md-divider,#e6edf5);border-radius:8px;padding:7px 10px;font-size:12.5px;background:var(--md-surface,#fff);color:var(--md-on-surface,#0f172a);font-family:ui-monospace,Menlo,Consolas,monospace" placeholder="首次配置请输入; 留空保留已保存的 Secret Key">
                            <div style="margin-top:6px;font-size:11.5px;color:var(--md-on-surface-med,#64748b)">已保存的 Secret Key 不回显到后台页面. 只有输入新值时才会提交并替换现有密钥.</div>`);
                        }
                        dom.find('[data-cap-secret-editor]').off('.capSecret').on('input.capSecret', function () {
                            const $input = $(this);
                            const value = String($input.val() || '').trim();
                            if (value) {
                                $input.attr('name', 'secret_key');
                            } else {
                                $input.removeAttr('name');
                            }
                        });
                    }
                },
                {
                    title: "Widget 脚本地址",
                    name: "widget_url",
                    type: "input",
                    default: value("widget_url", DEFAULT_WIDGET_URL),
                    placeholder: DEFAULT_WIDGET_URL,
                    tips: "生产环境建议固定版本. 也可以改为 Cap Standalone /assets/widget.js 或你自己的静态资源地址."
                },
                {
                    title: "WASM 地址",
                    name: "wasm_url",
                    type: "input",
                    default: value("wasm_url", ""),
                    placeholder: "留空使用 Cap 默认地址",
                    tips: "使用自托管 WASM 时填写 cap_wasm_bg.wasm 的公开 URL, 留空则使用 widget 默认地址."
                },
                {
                    title: "Worker 数量",
                    name: "worker_count",
                    type: "number",
                    default: value("worker_count", ""),
                    placeholder: "留空跟随浏览器硬件线程数, 最大 16",
                    tips: "移动端建议留空或填写 2-4, 避免验证占用过多资源."
                },
                {
                    title: "表单验证显示",
                    name: "display",
                    type: "select",
                    default: value("display", "inline"),
                    dict: [
                        {id: "inline", name: "表单内显示 Cap 组件（推荐）"},
                        {id: "programmatic", name: "提交时后台求解（无可见组件）"}
                    ],
                    tips: "Cap 使用工作量证明. 无可见组件模式会在受保护请求发送时自动求解, 可能增加提交等待时间."
                }
            ]
        },
        {
            name: util.icon("fa-duotone fa-regular fa-lock") + " 防护场景",
            form: [
                {title: "全站访问拦截", name: "gate_site", type: "switch", placeholder: "开启|关闭", default: value("gate_site", "0"), tips: "前台没有独立 Cap 验证的页面需通过验证. 已启用接口级 Cap 验证的页面不会再次拦截. 后台, 插件, 安装和支付回调放行."},
                {title: "登录验证", name: "gate_login", type: "switch", placeholder: "开启|关闭", default: value("gate_login", "0"), tips: "仅由此插件开关控制. 开启后登录接口必须携带有效 Cap token, 并以 Cap 替代宿主原图形码校验."},
                {title: "注册验证", name: "gate_register", type: "switch", placeholder: "开启|关闭", default: value("gate_register", "0"), tips: "仅由此插件开关控制注册和注册发码接口. Cap 通过后兼容宿主原生验证码检查; 宿主注册方式设置只决定可用的发码接口."},
                {title: "找回密码验证", name: "gate_forget", type: "switch", placeholder: "开启|关闭", default: value("gate_forget", "0"), tips: "仅由此插件开关控制找回密码和找回发码接口. Cap 通过后兼容宿主原生验证码检查; 宿主找回方式设置只决定可用的发码接口."},
                {title: "下单验证", name: "gate_trade", type: "switch", placeholder: "开启|关闭", default: value("gate_trade", "0"), tips: "仅由此插件开关控制商品和充值下单接口. 开启后必须携带有效 Cap token, 不读取宿主下单验证码开关."},
                {title: "后台登录验证", name: "gate_admin", type: "switch", placeholder: "开启|关闭", default: value("gate_admin", "0"), tips: "仅由此插件开关控制后台登录接口. 开启后必须携带有效 Cap token, 并以 Cap 替代宿主原图形码校验."},
                {
                    title: false,
                    name: "note",
                    type: "custom",
                    complete: (form, dom) => {
                        dom.html(`<div style="border:1px solid var(--md-divider,#e6edf5);border-radius:10px;padding:12px 14px;font-size:12px;line-height:1.9;color:var(--md-on-surface-med,#64748b)">
                            <b style="color:var(--md-on-surface,#0f172a)">安全边界说明</b><br>
                            Cap 的标准 <code>/siteverify</code> 返回成功状态和一次性 token 结果, 不提供 Turnstile 风格的 action 或 hostname 字段. 本插件不伪造这类校验, 而是依靠 Cap 的一次性 token, 服务端 Secret Key 和接口级必填校验完成防护.<br>
                            Cap 的多域名配置请在 Cap 控制台完成, 本插件只维护一套 Cap 实例和密钥.<br>
                            插件防护只由这里的场景开关控制, 不读取网站原生验证码开关. Cap 验证成功后会兼容满足宿主原图形码检查; 对应插件开关关闭时, 宿主原生验证码行为保持不变.<br>
                        </div>`);
                    }
                }
            ]
        }
    ];
})()
