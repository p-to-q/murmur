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

```bash
bash scripts/serve-workers-public.sh --sync-vercel
caffeinate -dims &        # 防休眠
```

脚本会：起两个 worker → 开两条 trycloudflare 隧道 → 预热模型 →
把 URL/token 写进 Vercel production env → 自动重新部署。

- **优点**：零成本，M4 Max 上 mrt2_base 生成 1 秒音频 ≈ 1 秒，体验最好。
- **限制**：Mac 必须开机在线；快速隧道的 URL **每次重启会换**（所以要带
  `--sync-vercel` 重跑）；trycloudflare 无 SLA，偶发掉线。
- 升级稳定性：注册 Cloudflare 账号 + 域名后改用 **named tunnel**
  （`cloudflared tunnel create murmur-workers`），URL 永久固定，
  之后就不再需要 `--sync-vercel`。

## 方案 B（7×24 稳定）：租 GPU 云主机

适合 Mac 不想常开、或访问量上来之后。月成本参考（2026-06）：

| 平台 | 机型 | 价格 | 备注 |
| --- | --- | --- | --- |
| RunPod | RTX 4090 / A5000 | ~$0.3-0.5/h（按用量） | 起停灵活，适合先试 |
| Lambda | A10 | ~$0.75/h | 稳定 |
| AWS | g5.xlarge (A10G) | ~$1/h 按需 | 企业级，贵 |

步骤（worker 已支持 `MAGENTA_BACKEND=jax`，CUDA 上自动走 JAX）：

```bash
cd workers/music-engine
docker build -t murmur-music-engine .        # 镜像在 GPU 机上构建
docker run --gpus all -p 8002:8002 \
  -e MUSIC_WORKER_TOKEN=<token> \
  -v magenta-models:/root/Documents/Magenta \
  murmur-music-engine
# 然后把 https://<GPU机域名>:8002 写进 Vercel 的 MUSIC_WORKER_URL
```

> Dockerfile 在 Mac 上无法实测（没有 NVIDIA 卡），首次远端构建当作冒烟
> 测试；audio-engine 是纯 CPU 的，可以一并丢上去（Fly.io/任何 VPS 即可）。

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
