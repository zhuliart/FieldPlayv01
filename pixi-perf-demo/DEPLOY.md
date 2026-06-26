# 部署到 fp.lidoartcenter.com（Linux VPS + Nginx · 手动）

本 DEMO 构建产物是**纯静态文件**（`dist/` 内含 `index.html` + `assets/`，已把 24MB 美术一起打进去），
任何静态服务器都能托管。下面是 VPS + Nginx 的完整步骤。

> 配套文件：`deploy/nginx/fp.lidoartcenter.com.conf`（站点配置）、`deploy/deploy.sh`（本地构建+上传脚本）。

> **本项目实际部署参数**（阿里云 ECS · 已确认）：
> Pixi 性能版 → 域名 `fp.lidoartcenter.com`、目录 `/usr/share/nginx/html/fieldplay-pixi`、Nginx `conf.d` 模式（非宝塔 vhost）。
> 与 **DOM 基准版** `fieldplay.lidoartcenter.com`（`/usr/share/nginx/html/fieldplay`）**并存**做 A/B 渲染对比，互不覆盖。
> `deploy.sh` 默认 `REMOTE_DIR` 已设为该目录，本机 `SSH_TARGET=root@服务器IP ./deploy/deploy.sh` 即可。

---

## 0. 你需要准备

- 一台 Linux VPS（Ubuntu/Debian 示例），有 root 或 sudo。
- 域名 `lidoartcenter.com` 的 DNS 管理权限。
- 本机能 `ssh` 登录服务器；本机装了 Node 18+（用于构建）。

---

## 1. DNS：把 fp 子域名指向服务器

到 `lidoartcenter.com` 的 DNS 控制台，加一条 **A 记录**：

| 主机记录 | 类型 | 记录值 |
|---|---|---|
| `fp` | A | 你的服务器公网 IP |

> 用 IPv6 就再加一条 `AAAA`。生效后验证：`dig +short fp.lidoartcenter.com` 应回显服务器 IP。

---

## 2. 服务器：安装 Nginx

```bash
sudo apt update
sudo apt install -y nginx
# 放行 80/443（用 ufw 的话）
sudo ufw allow 'Nginx Full' 2>/dev/null || true
```

> 云厂商**安全组**也要放行 80、443 入站，否则外网访问不到。

---

## 3. 构建并上传站点文件

### 方式 A（推荐）：本机构建 → rsync 上传

服务器**不需要装 Node**，只当静态服务器。

```bash
# 在本机仓库的 pixi-perf-demo/ 目录里：
SSH_TARGET=root@你的服务器IP ./deploy/deploy.sh
```

脚本会：`npm ci` → `npm run build` → 远端建目录 → `rsync` 上传 `dist/` 到 `/var/www/fp.lidoartcenter.com`。
（想换目录/端口：`REMOTE_DIR=/var/www/fp SSH_PORT=2222 SSH_TARGET=... ./deploy/deploy.sh`）

手动等价命令：
```bash
npm ci && npm run build
ssh root@IP "mkdir -p /var/www/fp.lidoartcenter.com"
rsync -avz --delete dist/ root@IP:/var/www/fp.lidoartcenter.com/
```

### 方式 B：服务器上构建

适合以后想「`git pull` 就更新」。服务器需装 Node + 能拉取仓库（私有库要配 deploy key 或带 token）。

```bash
# 服务器上：
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt install -y nodejs git
sudo mkdir -p /var/www && cd /var/www
sudo git clone <你的仓库地址> fp-src
cd fp-src/pixi-perf-demo
npm ci && npm run build
# 让 nginx root 指向这里的 dist（见第 4 步把 root 改成 /var/www/fp-src/pixi-perf-demo/dist）
```

> 注意：`vite.config.ts` 的资源插件会在构建时把仓库根的 `../assets` 拷进 `dist/assets`，
> 所以**必须保留完整仓库结构**（assets/ 在 pixi-perf-demo/ 的上一级），别只拷 pixi-perf-demo/ 一个子目录去构建。

权限（方式 A/B 通用）：
```bash
sudo chown -R www-data:www-data /var/www/fp.lidoartcenter.com   # 或你的站点目录
```

---

## 4. 配置 Nginx 站点

把仓库里的 `deploy/nginx/fp.lidoartcenter.com.conf` 放到服务器并启用：

```bash
sudo cp deploy/nginx/fp.lidoartcenter.com.conf /etc/nginx/sites-available/fp.lidoartcenter.com.conf
# 如用方式 B，把文件里的 root 改成 /var/www/fp-src/pixi-perf-demo/dist
sudo ln -s /etc/nginx/sites-available/fp.lidoartcenter.com.conf /etc/nginx/sites-enabled/
sudo nginx -t        # 语法检查，必须 OK
sudo systemctl reload nginx
```

此时 `http://fp.lidoartcenter.com` 应已能打开。

---

## 5. 开启 HTTPS（Let's Encrypt 免费证书）

```bash
sudo apt install -y certbot python3-certbot-nginx
sudo certbot --nginx -d fp.lidoartcenter.com --redirect -m 你的邮箱 --agree-tos --no-eff-email
```

certbot 会自动改写站点配置：加 443 服务块、装证书、配 80→443 跳转。
建议手动在 443 块加一行 `http2 on;`（几十张背景/状态图用 HTTP/2 多路复用更快），然后 `sudo nginx -t && sudo systemctl reload nginx`。

证书自动续期已由 certbot 的 systemd timer 处理，验证：`sudo certbot renew --dry-run`。

打开 **https://fp.lidoartcenter.com** ，HUD 选「压力」即可看满载帧率。

---

## 6. 以后怎么更新

- 方式 A：本机改完代码 → 再跑一次 `SSH_TARGET=... ./deploy/deploy.sh`。
- 方式 B：服务器上 `cd /var/www/fp-src && git pull && cd pixi-perf-demo && npm run build`。
- `index.html` 配的是 no-cache，发版即时生效；美术资源缓存 7 天，**换了同名图想立刻刷新**就把 `deploy/nginx` 里图片那段 `max-age` 调小再 reload。

---

## 7. 常见问题排查

| 现象 | 排查 |
|---|---|
| 外网打不开，本机 `curl` 可以 | 云**安全组**/防火墙没放行 80、443 |
| 403 Forbidden | 站点目录权限：`sudo chown -R www-data:www-data <root>`；目录要有执行位 |
| 页面白屏、JS 404 | `root` 没指到含 `index.html` 的那层；确认 `ls <root>/index.html` 存在 |
| 背景/作物图裂图 404 | `dist/assets/` 没上传全（24MB），重跑 rsync；或方式 B 构建时丢了仓库根 assets/ |
| 字体不加载 | 页面用了 `fonts.font.im` 外链，断网环境会回退系统字体，不影响功能；要离线可自托管字体 |
| certbot 失败 | 先确认 DNS 已生效（`dig +short fp.lidoartcenter.com`）且 80 端口可达 |
| CentOS/SELinux 403 | `sudo chcon -Rt httpd_sys_content_t <root>` |

---

## 8. 备选：不想碰服务器

`dist/` 是自包含静态站，也可直接拖到 Cloudflare Pages / Vercel / Netlify，再把 `fp.lidoartcenter.com`
用 CNAME 指过去 —— 免运维、自带 HTTPS+CDN。需要的话我再给你这条路的步骤。

---

## 9. 实时天气 · 部署须知

DEMO 的「常规」档默认走**实时天气**：浏览器直接 `fetch` Open-Meteo 公共 API（农场四川南江县
≈32.353N,106.843E），把当地实况映射成游戏天气，时钟锁**农场当地时间（UTC+8）**，与访客所在时区无关。

- **服务端零配置**：纯前端请求，Open-Meteo 自带 CORS，Nginx **不用**加任何反代或 CORS 头，也不增加部署体积。
- **建议上 HTTPS**：站点跑在 https 下时 `fetch` 同为 https 的接口最稳、无混合内容（按 §5 装证书即可）；http 站点也能用（http 页面允许请求 https 接口）。
- **自动降级**：访客网络/隐私插件若拦了该请求，天气芯片显示「南江·连接中」并回退为随机天气，画面照常运行，不报错、不白屏。
- **可手动切换**：点天气芯片上的「⇄ 南江·实时 / 加速」即可在「实时天气+农场当地时」与「加速演示（合成昼夜+随机灾害，便于看画面/压测）」之间切换。
- 6 套天气背景（normal / cloudy / lightrain / wet / dry / freezing）已含在 24MB 美术内，实时切到任意天气都有对应场景，不会缺图。
