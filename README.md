# DiffCycle 官网

DiffCycle 是一套把「页面和设计稿差多少」变成可复算数字的工具：把 Figma 稿或设计稿 PNG 与运行中的页面逐像素对比，
输出严格 / 闸门 / 感知三档差异占比、差异区域坐标，并把一张并排对比图直接放进对话里。

**长期官网地址：<https://drake-yuan.github.io/diffcycle-site/>**

## 托管

| 平台 | 地址 | 状态 |
| --- | --- | --- |
| GitHub Pages | `https://drake-yuan.github.io/diffcycle-site/` | **主地址**。免费、无流量上限、已验证国内可达 |
| surge（备用） | 备用 | 免费，但未点验证邮件时域名只服务 90 分钟 |
| Gitee Pages | 备用 | 尚未启用，启用后在仓库设置里填一次即可 |
| Netlify | 已停用 | 账户额度用尽，该地址不再更新 |

除 GitHub Pages 外，其余都是备用镜像；旧的 Netlify 地址一律不要再对外发。长期只发上面那个 GitHub Pages 地址。

## 发布（GitHub Pages）

`gh-pages` 分支就是线上内容，`main` 是源。改完源站后：

```powershell
cd D:\Startup\DiffStage\diffcycle-site
git checkout gh-pages
git checkout main -- index.html assets robots.txt
git add -A
git commit -m "gh-pages: published site build"
git push github gh-pages
git checkout main
```

GitHub Pages 部署有 20-40 秒延迟，第一次请求可能拿到 0 字节。

## 目录

| 路径 | 作用 |
| --- | --- |
| `index.html` | 首页：canonical / og / twitter、首屏指标、Agent 接入、FAQ |
| `assets/css/main.css` | 深色高对比主题与克制动效 |
| `assets/js/main.js` | 首屏指标与展示，ES5 写法 |
| `assets/img/` | 截图、对比图、og 图 |
| `assets/video/` | 演示录屏（已压缩的 MP4） |
| `assets/runs/generated-page.html` | AI 生成页面的样例产物 |
| `netlify/functions/**` | `/api/contact` 等边缘函数，仓库里保留但当前未部署 |
| `_worker.js` | Cloudflare Pages 兼容版本 |

## 诚实口径

- 差异占比默认三档：严格 0.01 / 闸门 0.05 / 感知 0.2，都是**每像素容差**。
- 验收线只看**严格差异占比 ≤ 5%**；`withinGate` 是唯一允许用来宣布达标的布尔值。
- 站内展示的数字来自真实测量，样例与首页演示不是同一组，不要互换。

© 2026 DiffCycle
