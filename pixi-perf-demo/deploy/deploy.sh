#!/usr/bin/env bash
# FieldPlay 性能验证 DEMO · 一键「本地构建 → rsync 上传」部署脚本
#
# 用法：
#   SSH_TARGET=root@你的服务器IP ./deploy/deploy.sh
# 可选环境变量：
#   REMOTE_DIR   远端站点目录（默认 /usr/share/nginx/html/fieldplay-pixi）
#   SSH_PORT     SSH 端口（默认 22）
#
# 前提：本机已装 Node 18+，且能 ssh 免密登录服务器；服务器已建好 REMOTE_DIR 且当前用户可写。

set -euo pipefail

# 切到 pixi-perf-demo/ 根（脚本在 deploy/ 下）
cd "$(dirname "$0")/.."

SSH_TARGET="${SSH_TARGET:?请先设置 SSH_TARGET，例如 SSH_TARGET=root@1.2.3.4}"
REMOTE_DIR="${REMOTE_DIR:-/usr/share/nginx/html/fieldplay-pixi}"
SSH_PORT="${SSH_PORT:-22}"

echo "==> [1/3] 安装依赖并构建（含类型检查 + 把 ../assets 拷进 dist/assets）"
npm ci
npm run build

echo "==> [2/3] 确保远端目录存在"
ssh -p "${SSH_PORT}" "${SSH_TARGET}" "mkdir -p '${REMOTE_DIR}'"

echo "==> [3/3] 上传 dist/ → ${SSH_TARGET}:${REMOTE_DIR}（--delete 清理旧文件）"
rsync -avz --delete -e "ssh -p ${SSH_PORT}" dist/ "${SSH_TARGET}:${REMOTE_DIR}/"

echo "==> 完成 ✅  打开 https://fp.lidoartcenter.com 验证"
