# 让线上用户用上生成功能 — music/audio worker 部署指南

Vercel 上跑的只是 Next.js 壳；真正干活的是两个 Python worker：

| worker | 端口 | 职责 | 模型 |
| --- | --- | --- | --- |
| `workers/audio-engine` | 8001 | 哼唱 → 旋律转谱 | SwiftF0（CPU 即可） |
| `workers/music-engine` | 8002 | prompt + 哼唱 → 音乐 | Magenta RT2（需要算力） |

音乐生成有两条线：**生产走 RunPod Serverless**（设 `RUNPOD_SERVERLESS_ENDPOINT_ID`
+ `RUNPOD_API_KEY` 即启用，优先级最高），**本地/旧方案走 HTTP worker**
（`MUSIC_WORKER_URL`，本地默认 `127.0.0.1:8002`）。两者都没配才回退 Tone.js。

```
# 生产音乐（RunPod Serverless，App 用 RUNPOD_API_KEY 作 Bearer 调用端点）
RUNPOD_SERVERLESS_ENDPOINT_ID=   RUNPOD_API_KEY=
# 转写 + 本地/旧音乐（HTTP worker，公网必须带 token，Bearer 鉴权，无 token 一律 401）
AUDIO_WORKER_URL=   AUDIO_WORKER_TOKEN=
MUSIC_WORKER_URL=   MUSIC_WORKER_TOKEN=
```

---

## 当前生产架构（2026-06-13 起）

| worker | 落脚点 | URL | 拉起方式 |
| --- | --- | --- | --- |
| audio-engine（转写） | **Fly.io**，常驻常热 | `https://murmur-audio.fly.dev`（固定不变） | `fly deploy ./workers/audio-engine` |
| music-engine（音乐） | **RunPod Serverless**，闲时缩容到 0 | 端点 id 固定，部署脚本同步 Vercel | `bun run deploy:music-serverless` |

转写已彻底脱离本机 —— `murmur.ptoq.io` 不再依赖 Mac 开机。音乐走 RunPod Serverless 按需计费：
`bun run deploy:music-serverless` 创建/更新端点并同步 `RUNPOD_SERVERLESS_ENDPOINT_ID`（只碰音乐，
不会动 Fly 的 `AUDIO_WORKER_URL`）。端点 id 稳定，重复部署只为换镜像或调伸缩。Fly 端重新部署：
`fly deploy ./workers/audio-engine`（配置见 `workers/audio-engine/fly.toml`，鉴权 token 是 Fly secret `AUDIO_WORKER_TOKEN`）。

> **方案 A / supervisor 已退役**：两个 worker 都上云后，本机 supervisor + 隧道不再需要。
> `murmur-supervisor.sh` 已加 guard——直接跑会被拒绝（否则它会把 Vercel 的
> `AUDIO_WORKER_URL` 覆盖回临时隧道，反而搞坏 Fly 接线）。下面方案 A 仅留作本地调试/历史参考。

## 方案 A（legacy，仅本地调试）：本机 M4 Max + Cloudflare 快速隧道

**常驻方式（推荐，2026-06 起）** — launchd 系统服务，崩溃自动拉起、
重启自动恢复、隧道 URL 轮换后自动改写 Vercel env 并重新部署，全程无人值守：

```bash
bash scripts/murmur-services.sh install    # 一次安装，永久生效
bash scripts/murmur-services.sh status     # launchd 状态 + 本地健康 + 当前隧道 URL
bash scripts/murmur-services.sh logs       # tail 全部日志（~/Library/Logs/murmur/）
bash scripts/murmur-services.sh restart    # 全量重启
bash scripts/murmur-services.sh uninstall  # 停掉并移除
```

六个服务：`audio-engine`(:8001)、`music-engine`(:8002)、`tunnel-audio`、
`tunnel-music`、`tunnel-sync`（监视隧道 URL，变了就自动 sync Vercel + 预热模型）、
`caffeinate`（防休眠）。**不再需要开着终端窗口。**

**手动方式（备用）**：`bash scripts/serve-workers-public.sh --sync-vercel`
（前台运行，关终端即全停 —— 这正是历史上"后端老是崩"的原因，仅调试时用）。

- **优点**：零成本，M4 Max 上 mrt2_base 生成 1 秒音频 ≈ 1 秒，体验最好。
- **限制**：Mac 必须开机在线（笔记本合盖需插电）；快速隧道 URL 每次重启会换
  （`tunnel-sync` 服务已自动处理，约 3 分钟内恢复）；trycloudflare 无 SLA。
- 升级稳定性：注册 Cloudflare 账号 + 域名后改用 **named tunnel**
  （`cloudflared tunnel create murmur-workers`），URL 永久固定，
  连自动同步都不再需要。

## 方案 B（推荐生产）：RunPod Serverless

**一键部署** — 见 [DEPLOY_MUSIC_ENGINE_GPU.md](./DEPLOY_MUSIC_ENGINE_GPU.md)

```bash
RUNPOD_API_KEY=rpa_… VERCEL=1 bun run deploy:music-serverless
```

- JAX/CUDA，不依赖本机 MLX / 隧道；闲时缩容到 0，按生成秒数计费
- ~4 GB 模型放网络卷（只下载一次），FlashBoot 加速冷启动
- App 通过 `https://api.runpod.ai/v2/<endpoint>/run` 调用，`RUNPOD_API_KEY` 鉴权
- 冷启动有代价：闲置后首个请求 ~20–60 s，太慢自动回退 Tone.js

<details>
<summary>手动构建镜像（CI 已自动构建并公开）</summary>

```bash
docker buildx build --platform linux/amd64 \
  -t ghcr.io/p-to-q/murmur-music-engine:latest \
  workers/music-engine --push
```

> 镜像 ENTRYPOINT 跑的是 RunPod serverless handler（连 RunPod 作业队列），
> 不是 HTTP 服务——直接 `docker run` 不会监听 :8002。本地调试用 `bun run dev:music`。
> audio-engine 是纯 CPU 的，走 Fly.io 常驻。

</details>

## 方案 C：Mac mini 常驻 + named tunnel

买台 M4 Mac mini（一次性 ¥4k 左右）插电常开，跑方案 A 的脚本 +
named tunnel 固定域名。无月租、性能比同价位 GPU 云强，适合长期。

---

## 排错

- 线上 502 + `worker_http_error`：先看 worker 端 `/health`
  （`curl <URL>/health`），再确认 Vercel env 里的 URL 是否还是当前隧道。
- 首次转谱/生成慢：模型懒加载（转谱 ~40s、生成 ~1min 冷启动），
  `serve-workers-public.sh` 已内置预热。
- 生成路由超时：`/api/music/generate` 已声明 `maxDuration = 120`，
  Vercel 函数不会提前掐断。
