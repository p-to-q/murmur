# Cloud GPU music engine (RunPod Serverless) — 按需计费、自动伸缩

本地 MLX + Cloudflare 隧道适合调试，但 Mac 休眠/隧道轮换会导致线上回退到 Tone.js 程序化合成。
**生产方案**：RunPod **Serverless** 端点（JAX/CUDA）——闲时缩容到 0，按生成秒数计费，
~4 GB 模型放在网络卷上（只下载一次，跨冷启动复用），FlashBoot 加速恢复。

> 与旧的常驻 Pod 方案的区别：不再有固定的 `https://<pod>-8002.proxy.runpod.net`；
> App 通过 `https://api.runpod.ai/v2/<endpoint-id>/run` 调用，用 `RUNPOD_API_KEY` 鉴权。
> 冷启动有代价：闲置后的第一次哼唱会等待 ~20–60 s 冷启动。生产 live Hum
> 不再自动生成 Tone.js 低规格替代结果；如果 RunPod 没能在路由预算内完成，
> App 会显示 music-engine 热机 / 不可用状态，让用户重试。

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

本地也可。必须使用目标 `main` 的完整 SHA，不要发布可变的 `latest`：

```bash
export RELEASE_SHA=$(git rev-parse HEAD)
docker buildx build --platform linux/amd64 \
  --build-arg MURMUR_MUSIC_ENGINE_REVISION="$RELEASE_SHA" \
  -t "ghcr.io/p-to-q/murmur-music-engine:$RELEASE_SHA" \
  workers/music-engine --push
```

### 3. 部署 + 写入 Vercel

```bash
export RUNPOD_API_KEY=rpa_xxxxxxxx
export MURMUR_MUSIC_RELEASE_SHA=$(git rev-parse HEAD)
export VERCEL=1          # 自动 vercel env add；不会绕过 Actions 直接部署
bun run deploy:music-serverless
```

脚本会（全部走 RunPod REST API `rest.runpod.io/v1`）：

1. 创建/复用 50 GB **网络卷** `murmur-music-vol`（默认数据中心 `EU-RO-1`，`RUNPOD_DATA_CENTER_ID` 可改）
2. 用完整 SHA 镜像创建独立 **template** `murmur-music-<sha12>`；脚本拒绝 `latest` 等可变 tag
3. 创建独立 **serverless endpoint** `murmur-music-<sha12>`；旧 endpoint 继续服务，失败不会影响线上
4. 发带 hum + melody 的 **warm-up** 并轮询 `/status`；校验完整 v2 receipt、候选 digest、conditioning、WAV 和 `engine_revision == release SHA`
5. 写入 Vercel `RUNPOD_SERVERLESS_ENDPOINT_ID` / `RUNPOD_API_KEY` /
   `MUSIC_ENGINE_MODE=serverless` /
   `MURMUR_MUSIC_QUALITY_EVIDENCE_REQUIRED=1` /
   `MURMUR_MUSIC_V2_EVIDENCE_REQUIRED=1`。只有 warm-up 输出
   通过 `music-technical-v2` 协议校验后才会执行这一步；旧 warm worker 或旧镜像
   仍在服务时，脚本会拒绝切换。环境同步后，通过 GitHub Actions 的
   **Release (production)** 对最新 `main` SHA 进行正式发布；脚本不会直接执行
   `vercel --prod`。

端点信息保存在 `.env.workers.cloud`（已 gitignore），包括 endpoint、volume、release SHA 和不可变镜像引用。切流稳定后再手动清理旧 endpoint/template。

### 4. 验证

```bash
# 端点 worker / job 指标（缩容到 0 时各 worker 计数为 0，仍可接单）
curl -sS "https://api.runpod.ai/v2/<endpoint-id>/health" \
  -H "Authorization: Bearer $RUNPOD_API_KEY"
# 线上健康（应 configured:true, available:true）
curl -sS https://murmur.ptoq.io/api/music/health
```

`/api/music/health` 会回传实际 transport：`mode:"serverless"` 表示走本页方案；
`mode:"http"` / `requestedMode:"http"` 表示 production 仍显式切在 warm pod failover 上。
要切回 serverless，重跑本部署脚本，或设置 Vercel `MUSIC_ENGINE_MODE=serverless`
后 redeploy。

## 调参

| 环境变量 | 默认 | 说明 |
| --- | --- | --- |
| `RUNPOD_WORKERS_MAX` | `2` | 最大并发 worker |
| `RUNPOD_IDLE_TIMEOUT` | `120` | worker 闲置多少秒后缩容（秒） |
| `RUNPOD_DATA_CENTER_ID` | `EU-RO-1` | 网络卷所在数据中心（决定可用 GPU） |
| `RUNPOD_GPU_TYPE_ID` | _(列表)_ | 偏好 GPU，如 `NVIDIA L4` |
| `MAGENTA_MODEL` | `mrt2_base` | 线上最高规格模型；`mrt2_small` 只适合低配本地调试 |
| `MAGENTA_CFG_NOTES` | `1.5` | 当前实验收敛值；更高会让旋律过度受控，容易 robotic / dissonant |
| `MAGENTA_TEMPERATURE` | `1.3` | 第一候选采样温度；技术失败重试会使用更保守值 |
| `MAGENTA_TOP_K` | `40` | 第一候选 top-k；技术失败重试会使用更保守值 |
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
| 首次哼唱显示音乐引擎热机 / 不可用 | 冷启动超过路由预算；再哼一次（worker 已热）即走 Magenta |
| `/api/music/health` available:false | 核对 Vercel 的 `RUNPOD_API_KEY` 与 `RUNPOD_SERVERLESS_ENDPOINT_ID` |
| `/api/music/health` 显示 `mode:"http"` | 线上被 `MUSIC_ENGINE_MODE=http` pin 到 warm pod；切回 serverless 后再判断本端点 |

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
