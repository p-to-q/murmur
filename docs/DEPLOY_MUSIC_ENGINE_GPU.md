# Cloud GPU music engine (RunPod) — 7×24 稳定方案

本地 MLX + Cloudflare 隧道适合调试，但 Mac 休眠/隧道轮换会导致线上回退到 Tone.js 程序化合成。
**生产推荐**：RunPod 常驻 GPU Pod（JAX/CUDA），固定 HTTPS 代理 URL，不再依赖本机。

## 一键部署

### 1. 准备 RunPod API Key

1. 注册 https://www.runpod.io/
2. 充值（RTX 4090 / L4 约 **$0.3–0.5/小时**，常驻月租约 **$220–360**）
3. 在 [Settings → API Keys](https://www.runpod.io/console/user/settings) 创建 key

### 2. GHCR 镜像权限（必做）

默认镜像 `ghcr.io/p-to-q/murmur-music-engine:latest` 是 **私有包**，RunPod 拉取时需要 registry 凭证，否则会出现 `IMAGE_AUTH_ERROR: unauthorized`。

任选其一：

**A. 自动注册（推荐）** — 在 `.env.local` 添加 GitHub PAT（需 `read:packages`）：

```bash
GHCR_USERNAME=<你的 GitHub 用户名>
GHCR_TOKEN=ghp_xxxxxxxx
```

部署脚本会把凭证写入 RunPod → Container Registry Auth（名称 `murmur-ghcr`）。

**B. RunPod 控制台手动添加** — [Settings → Container Registry Auth](https://www.runpod.io/console/user/settings)：

- Username：GitHub 用户名
- Password：PAT（`read:packages`）
- 记下生成的 ID，写入 `.env.local`：`RUNPOD_REGISTRY_AUTH_ID=…`

**C. 公开 GHCR 包（org admin）** — GitHub → p-to-q → Packages → murmur-music-engine → Change visibility → Public。公开后无需 registry 凭证。

PAT 创建：GitHub → Settings → Developer settings → Personal access tokens → `read:packages`。

### 3. 构建 GPU 镜像（首次 / 代码更新后）

镜像托管在 GitHub Container Registry，push 到 `main` 后自动构建，或手动触发 Actions → **Music engine GPU image**。

本地也可：

```bash
docker buildx build --platform linux/amd64 \
  -t ghcr.io/p-to-q/murmur-music-engine:latest \
  workers/music-engine --push
```

### 4. 部署 + 写入 Vercel

```bash
export RUNPOD_API_KEY=rpa_xxxxxxxx
export VERCEL=1          # 自动 vercel env add + redeploy
bun run deploy:music-gpu
```

脚本会：

1. 在 RunPod 创建/恢复名为 `murmur-music-gpu` 的 GPU Pod
2. 挂载 40 GB 持久卷到 `/root/Documents/Magenta`（模型只下载一次）
3. 暴露 `8002/http` → `https://<pod-id>-8002.proxy.runpod.net`
4. 等待 `/health`（首次约 5–15 分钟下载权重）
5. 写入 Vercel `MUSIC_WORKER_URL` / `MUSIC_WORKER_TOKEN` 并 redeploy

凭证保存在 `.env.workers.cloud`（已 gitignore）。

### 5. 验证

```bash
curl -sS "https://<pod-id>-8002.proxy.runpod.net/health" \
  -H "Authorization: Bearer <MUSIC_WORKER_TOKEN>"
curl -sS https://murmur.ptoq.io/api/music/health
```

线上 `/api/music/health` 应返回 `"configured": true, "available": true`。

## 费用与机型

| GPU | 约价 | 备注 |
| --- | --- | --- |
| NVIDIA L4 | ~$0.35/h | 性价比高，推荐 |
| RTX 4090 | ~$0.45/h | 生成更快 |
| RTX A5000 | ~$0.40/h | 备选 |

可通过 `RUNPOD_GPU_TYPE_ID="NVIDIA L4"` 指定。

## 停用本地 MLX 隧道

GPU 上线后，可停止本机 music-engine 与 tunnel-music，避免 Vercel 仍指向旧 URL：

```bash
bash scripts/murmur-supervisor.sh stop   # 若在用 supervisor
# 或 launchd: bash scripts/murmur-services.sh stop
```

转谱 worker（audio-engine）仍可走本机隧道或单独部署 CPU VPS。

## 排错

| 现象 | 处理 |
| --- | --- |
| `IMAGE_AUTH_ERROR: unauthorized` | 配置 `GHCR_USERNAME` + `GHCR_TOKEN`，或 `RUNPOD_REGISTRY_AUTH_ID`；见上文 §2 |
| `No instances currently available` | 换 `RUNPOD_GPU_TYPE_ID` 或稍后重试 |
| `/health` 长时间 loading | 正常，首次下载 ~4 GB；看 RunPod 控制台日志 |
| Vercel 502 | 核对 `MUSIC_WORKER_TOKEN` 与 Pod env 一致 |
| 镜像 pull 失败（非 auth） | 确认 GHCR 包存在且 tag 正确；Actions → Music engine GPU image |

## 架构

```
用户 → murmur.ptoq.io (Vercel)
         └─ /api/music/generate
              └─ RunPod GPU Pod (JAX, mrt2_base)
                   https://<pod>-8002.proxy.runpod.net
```

audio-engine（转谱）与 music-engine（生成）可分离部署；本指南只覆盖 **Magenta 生成 GPU**。
