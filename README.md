# diffcycle-site

这是 **DiffCycle 官网的构建产物仓库**（Cloudflare Worker + Pages 静态站），不是引擎源码仓库。

- 线上地址：https://diffcycle.pages.dev/
- 正式域名：diffcycle.*（以 DNS 实际指向为准）
- 目录内容即为部署所需全部文件：`index.html` / `_worker.js` / `assets/**`
- 引擎源码（Figma 读取、AI 生成、像素 Diff、语义化修复）保持私有，不在本仓库内

## 部署

```bash
npm i -g wrangler
wrangler pages deploy . --project-name diffcycle
```

或直接把本目录作为 Cloudflare Pages 的构建输出目录上传。

## 目录说明

| 路径 | 说明 |
| --- | --- |
| `index.html` | 单页官网，深色主题，含「真实记录」板块 |
| `_worker.js` | Cloudflare Worker，处理自定义域路由与静态资源转发 |
| `assets/css/main.css` | 全站样式（含官网与工作台共用的设计 token） |
| `assets/js/main.js` | 官网交互脚本 |
| `assets/img/` | 设计稿 / 真实渲染 / 像素差三联图、录屏封面、og 图 |
| `assets/video/` | 引擎真实运行录屏（MP4） |
| `assets/runs/generated-page.html` | 某次真实运行由 AI 生成的完整单文件 HTML，可直接打开验证 |

## 说明

- 仓库内所有截图、像素差图与录屏均来自 DiffCycle 引擎在本机的真实运行，未做修饰。
- 像素差同时给出严格口径（阈值 0.01）与人眼可见口径（阈值 0.2），后者才对应实际观感。

© 2026 DiffCycle
## 线索收集（可选）

站点「免费开始」表单走三层投递：`/api/early-access`（本仓库的 `_worker.js`）→ 静态表单 → 页脚联系邮箱。
Worker 需要在 Cloudflare Pages 后台配置：

| 变量 | 类型 | 作用 |
| --- | --- | --- |
| `LEADS` | KV Namespace 绑定 | 存放登记线索（KV namespace id 自行创建） |
| `LEADS_TOKEN` | 密文/环境变量 | 读取线索用的令牌，自行设置 |
| `LEAD_WEBHOOK` | 密文/环境变量（可选） | 企业微信或飞书群机器人 Webhook，新线索即时推送 |
| `LEAD_MAIL` | 密文/环境变量（可选） | 对外联系邮箱；前端通过 `/api/contact` 运行时获取，不进代码库 |

查看已登记的线索（把 `<token>` 换成你自己的 `LEADS_TOKEN`）：

```
GET /api/leads?token=<token>          # JSON
GET /api/leads?token=<token>&format=csv   # CSV
```