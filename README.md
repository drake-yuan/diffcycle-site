# DiffCycle 官网

DiffCycle 的官方站点：单页官网 + 早鸟登记，部署在 Netlify（`*.netlify.app` 国内可直开）。

- 本仓库是**官网站点**的发布仓库，**不包含引擎源码**（Figma 读取、AI 生成、像素 Diff、语义化修复等能力独立维护，不在此仓库内）

- 线上地址：https://diffcycle.netlify.app
- 正式域名：diffcycle.*（以 DNS 实际指向为准；买下域名后用 `node tools/set-domain.mjs <域名>` 一次替换并重新部署）
- 目录内容即为部署所需全部文件：`index.html` / `netlify/functions/**` / `assets/**`
- 部署与运维的完整流程见 [`部署与运维.md`](./部署与运维.md)

## 部署

**主线路：Netlify**（已上线；实测 `*.pages.dev` 在国内无应答、`vercel.app` 被污染，`*.netlify.app` 国内可直开）

```powershell
# 本机
cd D:\Startup\DiffStage\netlify-site
D:\Startup\DiffStage\netlify-cli\node_modules\.bin\netlify.cmd deploy --dir=site --functions=netlify/functions --site 40550ffe-950b-4817-a43f-ab02fb738736 --prod
```

**备选：Cloudflare Pages**（控制台需 VPN 才能进入，且 pages.dev 在国内不可访问，保留仅作应急）

```bash
npm i -g wrangler
wrangler pages deploy . --project-name diffcycle
```

## 目录说明

| 路径 | 说明 |
| --- | --- |
| `index.html` | 单页官网，深色主题，含「真实记录」板块；canonical / og / twitter 元信息均指向正式域名 |
| `netlify/functions/contact.mjs` | 返回对外联系邮箱（读取 `LEAD_MAIL`，运行时取值，不写死） |
| `netlify/functions/early-access.mjs` | 早鸟登记接口：写入 Netlify Forms，可选推送到企微/飞书群机器人 |
| `netlify.toml` | 路由与 Functions 声明（`/api/contact`、`/api/early-access`） |
| `_worker.js` | Cloudflare Pages 备选方案：自定义域路由、KV 版线索接口 |
| `assets/css/main.css` | 全站样式（含官网与工作台共用的设计 token） |
| `assets/js/main.js` | 官网交互脚本 |
| `assets/img/` | 设计稿 / 真实渲染 / 像素差三联图、录屏封面、og 图 |
| `assets/video/` | 引擎真实运行录屏（MP4） |
| `assets/runs/generated-page.html` | 某次真实运行由 AI 生成的完整单文件 HTML，可直接打开验证 |
| `tools/set-domain.mjs` | 换正式域名：一条命令改掉 index.html 四处绝对地址与本 README 的线上地址 |
| `tools/add-demo-note.mjs` | 追加一条真实运行记录（截图 / 像素差 / 代码）到官网 |

## 说明

- 仓库内所有截图、像素差图与录屏均来自 DiffCycle 引擎在本机的真实运行，未做修饰。
- 像素差同时给出严格口径（阈值 0.01）与人眼可见口径（阈值 0.2），后者才对应实际观感。

© 2026 DiffCycle

## 线索收集（可选）

站点「免费开始」表单走 Netlify Forms：`/api/early-access`（`netlify/functions/early-access.mjs`）→ 以 `form-name=lead` POST 回站点根路径 → 落到 Netlify 后台 **Forms** 面板的 `lead` 表单。

| 变量 | 类型 | 作用 |
| --- | --- | --- |
| `LEAD_MAIL` | 环境变量 | 对外联系邮箱；前端通过 `/api/contact` 运行时获取，不进代码库 |
| `LEAD_WEBHOOK` | 环境变量（可选） | 企业微信或飞书群机器人 Webhook，新线索即时推送 |
| `LEADS_TOKEN` | 环境变量 | 读取线索用的令牌（Cloudflare 版才用得上，Netlify 无 KV） |

Netlify 站点的线索列表在后台 **Forms** 面板查看；Cloudflare Pages 版可用 `GET /api/early-access?token=<token>`（加 `&format=csv` 出 CSV）。
