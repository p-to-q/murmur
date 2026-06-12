# 让线上用户用上生成功能 — music/audio worker 部署指南

Vercel 上跑的只是 Next.js 壳；真正干活的是两个 Python worker：

| worker | 端口 | 职责 | 模型 |
| --- | --- | --- | --- |
| `workers/audio-engine` | 8001 | 哼唱 → 旋律转谱 | SwiftF0（CPU 即可） |
| `workers/music-engine` | 8002 | prompt + 哼唱 → 音乐 | Magenta RT2（需要算力） |

Next.js 侧只认四个环境变量（设了 `MUSIC_WORKER_URL` 即启用 Magenta 引擎，
不设则自动回退 Tone.js 合成）：

```
AUDIO_WORKER_URL=   AUDIO_WORKER_TOKEN=
MUSIC_WORKER_URL=   MUSIC_WORKER_TOKEN=
```

worker 在公网上必须带 token（`MUSIC_WORKER_TOKEN`/`AUDIO_WORKER_TOKEN`
环境变量，Bearer 鉴权，无 token 的请求一律 401）。

---

## 方案 A（当前在用，免费）：本机 M4 Max + Cloudflare 快速隧道

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

## 方案 B（7×24 稳定，推荐生产）：RunPod GPU

**一键部署** — 见 [DEPLOY_MUSIC_ENGINE_GPU.md](./DEPLOY_MUSIC_ENGINE_GPU.md)

```bash
RUNPOD_API_KEY=rpa_… VERCEL=1 bun run deploy:music-gpu
```

- JAX/CUDA，不依赖本机 MLX / 隧道
- 固定 `https://<pod-id>-8002.proxy.runpod.net`
- 约 $0.3–0.5/h（L4 / 4090）

<details>
<summary>手动 Docker 步骤（旧）</summary>

```bash
cd workers/music-engine
docker build -t murmur-music-engine .
docker run --gpus all -p 8002:8002 \
  -e MUSIC_WORKER_TOKEN=<token> \
  -v magenta-models:/root/Documents/Magenta \
  murmur-music-engine
```

> audio-engine 是纯 CPU 的，可继续走本机隧道或单独 VPS。

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
