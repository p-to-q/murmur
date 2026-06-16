# Cloud GPU music engine (RunPod Serverless) — 按需计费、自动伸缩

本地 MLX + Cloudflare 隧道适合调试，但 Mac 休眠/隧道轮换会导致线上回退到 Tone.js 程序化合成。
**生产方案**：RunPod **Serverless** 端点（JAX/CUDA）——闲时缩容到 0，按生成秒数计费，
~4 GB 模型放在网络卷上（只下载一次，跨冷启动复用），FlashBoot 加速恢复。

> 与旧的常驻 Pod 方案的区别：不再有固定的 `https://<pod>-8002.proxy.runpod.net`；
> App 通过 `https://api.runpod.ai/v2/<endpoint-id>/run` 调用，用 `RUNPOD_API_KEY` 鉴权。
> 冷启动有代价：闲置后的第一次哼唱会等待 ~20–60 s 冷启动，太慢时 App 自动回退 Tone.js。

## 一键部署

### 1. 准备 RunPod API Key

1. 注册 https://www.runpod.io/ 并充值
2. 在 [Settings → API Keys](https://www.runpod.io/console/user/settings) 创建 key（`rpa_…`）

### 2. 构建镜像（首次 / 代码更新后）

镜像托管在 GitHub Container Registry，push 到 `main`（改动 `workers/music-engine/**`）后
自动构建，或手动触发 Actions → **Music engine image**。

包**已设为 public**（Serverless 匿名拉取，无需 registry 凭证）。注意：CI 里的「设为 public」
步骤用默认 `GITHUB_TOKEN` 改组织包可见性会 404 失败（已知、无害，`continue-on-error`）——
public 是在 org 设置允许 public 包后**手动**点的，一次性、推新版本不会变回私有。

> 若镜像哪天变回私有，配 GHCR PAT（classic，`read:packages`）走 registry 鉴权：
> ```bash
> GHCR_USERNAME=<GitHub 用户名>   # PAT 持有者，需对 org 包有读权限
> GHCR_TOKEN=ghp_xxxx
> ```
> 部署脚本会注册成 RunPod 凭证 `murmur-ghcr` 并自动带上；或设 `RUNPOD_REGISTRY_AUTH_ID` 复用。

本地也可：

```bash
docker buildx build --platform linux/amd64 \
  -t ghcr.io/p-to-q/murmur-music-engine:latest \
  workers/music-engine --push
```

### 3. 部署 + 写入 Vercel

```bash
export RUNPOD_API_KEY=rpa_xxxxxxxx
export VERCEL=1          # 自动 vercel env add + redeploy
bun run deploy:music-serverless
```

脚本会（全部走 RunPod REST API `rest.runpod.io/v1`）：

1. 创建/复用 50 GB **网络卷** `murmur-music-vol`（默认数据中心 `EU-RO-1`，`RUNPOD_DATA_CENTER_ID` 可改）
2. 创建/更新 **template** `murmur-music-serverless`（镜像 + `MAGENTA_BACKEND=jax` 等环境变量）
3. 创建/更新 **serverless endpoint**（`workersMin=0`、`flashboot=true`、`idleTimeout=120s`、挂载网络卷、GPU 候选列表）
4. 发一个 **warm-up** 作业并轮询 `/status`：首次会拉镜像 + 下载 ~4 GB 模型到网络卷（约 ~20 min），把模型缓存下来
5. 写入 Vercel `RUNPOD_SERVERLESS_ENDPOINT_ID` / `RUNPOD_API_KEY` 并 redeploy

端点信息保存在 `.env.workers.cloud`（已 gitignore）：`RUNPOD_SERVERLESS_ENDPOINT_ID` + `RUNPOD_NETWORK_VOLUME_ID`。

### 4. 验证

```bash
# 端点 worker / job 指标（缩容到 0 时各 worker 计数为 0，仍可接单）
curl -sS "https://api.runpod.ai/v2/<endpoint-id>/health" \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
# 线上健康（应 configured:true, available:true）
curl -sS https://murmur.ptoq.io/api/music/health
```

## 调参

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `RUNPOD_WORKERS_MAX` | `2` | 最大并发 worker |
| `RUNPOD_IDLE_TIMEOUT` | `120` | worker 闲置多少秒后缩容（秒） |
| `RUNPOD_DATA_CENTER_ID` | `EU-RO-1` | 网络卷所在数据中心（决定可用 GPU） |
| `RUNPOD_GPU_TYPE_ID` | _(列表)_ | 偏好 GPU，如 `NVIDIA L4` |
| `MAGENTA_MODEL` | `mrt2_base` | 或 `mrt2_small` |
| `MAGENTA_CFG_NOTES` | `1.5` | 旋律 CFG 强度（worker 端 [-1.0, 7.0]） |
| `WARMUP` | `1` | `0` 跳过部署后的预热作业 |

> **想要始终热（无冷启动）？** 在 RunPod 控制台把该端点的 *Active (min) workers* 设为 1，
> 或改脚本里的 `workersMin`。代价是 GPU ~7×24 计费，基本等同旧的常驻 Pod。

## 费用与机型

| GPU | 约价 | 备注 |
| --- | --- | --- |
| NVIDIA L4 | ~$0.4/h（按秒计） | 性价比高，推荐 |
| RTX 4090 | ~$0.7/h（按秒计） | 生成更快 |
| RTX A5000 | ~$0.4/h（按秒计） | 备选 |

Serverless 只在 worker 运行时计费（生成 + 冷启动），闲时为 0。低流量下远比常驻 Pod 便宜。

## 排错

| 现象 | 处理 |
| --- | --- |
| `IMAGE_AUTH_ERROR: unauthorized` | 镜像变回私有了：配 `GHCR_USERNAME`+`GHCR_TOKEN`（PAT，read:packages）或 `RUNPOD_REGISTRY_AUTH_ID`，见 §2 |
| 部署报 GPU/容量不可用 | 换 `RUNPOD_DATA_CENTER_ID` 或 `RUNPOD_GPU_TYPE_ID`（网络卷会把端点锁在其数据中心） |
| warm-up 超时 | 正常（首次下载 ~4 GB）；端点已创建，首个真实请求会继续下载。看 RunPod 控制台日志 |
| 首次哼唱回退 Tone.js | 冷启动超过 110 s 路由预算；再哼一次（worker 已热）即走 Magenta |
| `/api/music/health` available:false | 核对 Vercel 的 `RUNPOD_API_KEY` 与 `RUNPOD_SERVERLESS_ENDPOINT_ID` |

## 架构

```
用户 → murmur.ptoq.io (Vercel)
         └─ /api/music/generate
              └─ POST https://api.runpod.ai/v2/<endpoint>/run   (Bearer RUNPOD_API_KEY)
                   ↳ 轮询 /status/<job>
                        └─ Serverless worker (handler.py, JAX, mrt2_base)
                             ⇢ /runpod-volume 上缓存的模型权重
```

audio-engine（转谱）走 Fly.io 常驻；music-engine（生成）走 RunPod Serverless 按需。
本指南只覆盖 **Magenta 生成**。本地开发仍用 `bun run dev:music`（FastAPI on :8002），不受影响。
