# Murmur 部署指南（推荐方案）

## 架构：Vercel + Railway

```
┌─────────────────────────────────────┐
│ Vercel: Next.js 前端 + API Routes  │ ← 主域名
└────────────┬────────────────────────┘
             │
             ├─→ Railway: Python Audio Engine (内部服务)
             │
             └─→ Railway: PostgreSQL (数据库)
```

**优势：**
- ✅ Vercel 全球 CDN，前端性能最佳
- ✅ Railway 处理后端服务和数据库
- ✅ 成本优化（Vercel 免费额度大）
- ✅ 各自专注优势领域

---

## 第一步：Railway 部署后端

### 1. 创建 Railway Project

1. 访问 https://railway.app/
2. 登录后点击 "New Project"
3. 选择 "Deploy from GitHub repo"
4. 选择 `p-to-q/murmur` 仓库

### 2. 添加 PostgreSQL

1. 在 Project 页面点击 "+ New"
2. 选择 "Database" → "PostgreSQL"
3. 记录生成的 `DATABASE_URL`

### 3. 部署 Python Audio Engine

1. 点击 "+ New" → "Empty Service"
2. 命名为 `audio-engine`
3. 连接到 GitHub repo

**Settings → Service:**
- **Root Directory**: `workers/audio-engine`
- **Build**: 自动检测 Dockerfile
- **Start Command**: (自动使用 Dockerfile)

**Settings → Networking:**
- 启用 "Generate Domain"
- 记录生成的公开 URL (例如: `https://audio-engine-production.up.railway.app`)

**环境变量:**
```bash
PORT=8001
```

**保存并部署**

### 4. 验证 Audio Engine

访问: `https://<your-audio-engine-domain>/docs`

应该能看到 FastAPI 文档页面。

---

## 第二步：Vercel 部署前端

### 1. 安装 Vercel CLI（可选）

```bash
npm i -g vercel
```

或直接使用 Vercel Web 控制台。

### 2. 导入项目到 Vercel

**方式 A: Web 控制台**

1. 访问 https://vercel.com/
2. 点击 "Add New..." → "Project"
3. Import Git Repository: `p-to-q/murmur`
4. 选择分支: `main` 或 `codex/repo-governance-closure`

**方式 B: CLI**

```bash
cd /Users/dujiayi/murmur
vercel
```

### 3. 配置环境变量

在 Vercel Project Settings → Environment Variables 添加：

```bash
# Database (from Railway PostgreSQL)
DATABASE_URL=postgresql://postgres:xxx@xxx.railway.app:5432/railway

# Audio Engine (from Railway audio-engine service)
AUDIO_ENGINE_URL=https://audio-engine-production-xxx.up.railway.app

# NextAuth
NEXTAUTH_URL=https://your-domain.vercel.app
NEXTAUTH_SECRET=<generate-with: openssl rand -base64 32>

# AWS S3 (可选，用于生产存储)
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
AWS_REGION=us-east-1
AWS_S3_BUCKET=murmur-production

# Stripe (可选，用于支付)
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx

# Feature Flags
NEXT_PUBLIC_ENABLE_TOPUP=true
NEXT_PUBLIC_AUDIO_ENGINE_URL=https://audio-engine-production-xxx.up.railway.app
```

### 4. 配置构建设置

**Framework Preset:** Next.js

**Build & Output Settings:**
- Build Command: `bun run build`
- Output Directory: `.next` (默认)
- Install Command: `bun install`

**Root Directory:** `./` (默认)

**Node.js Version:** 20.x (推荐)

### 5. 部署

点击 "Deploy" 按钮，Vercel 会自动：
1. 安装依赖 (`bun install`)
2. 运行构建 (`bun run build`)
3. 部署到全球 CDN

---

## 第三步：数据库迁移

### 方法 A: 本地运行迁移

```bash
# 设置生产数据库 URL（从 Railway 复制）
export DATABASE_URL="postgresql://postgres:xxx@xxx.railway.app:5432/railway"

# 运行迁移
bun run db:migrate

# 验证
bun run db:studio
```

### 方法 B: Railway 上运行

1. 在 Railway Next.js service 创建临时 service
2. 设置环境变量
3. 运行: `bun run db:migrate`

---

## 第四步：验证部署

### ✅ 检查清单

- [ ] Vercel 部署成功，域名可访问
- [ ] Railway PostgreSQL 运行中
- [ ] Railway Audio Engine 运行中，`/docs` 可访问
- [ ] 数据库迁移完成
- [ ] 可以注册/登录用户
- [ ] 可以创建 Hum
- [ ] 音频处理正常（检查 audio-engine 日志）

### 🔍 调试工具

**Vercel:**
- 查看部署日志: Project → Deployments → 点击部署 → Logs
- 查看运行时日志: Project → Logs
- 查看函数执行: Project → Functions

**Railway:**
- Audio Engine 日志: Service → Logs
- PostgreSQL 日志: Database → Logs
- 监控: Service → Metrics

---

## 成本估算

| 服务 | 免费额度 | 付费后 |
|------|---------|--------|
| **Vercel** | 100GB 带宽/月<br/>100 次构建/月 | ~$20/月 (Pro) |
| **Railway** | $5 信用额度/月 | ~$10/月 (Hobby) |
| **总计** | **基本免费** | **~$30/月** |

**初期建议：**
- Vercel 免费版完全够用
- Railway 免费 $5 可以运行 PostgreSQL + Audio Engine 约 500-1000 小时

---

## 自定义域名

### Vercel (前端主域名)

1. Project Settings → Domains
2. 添加域名: `murmur.app`
3. 配置 DNS:
   - A 记录: `76.76.21.21`
   - 或 CNAME: `cname.vercel-dns.com`

### Railway (可选，audio-engine 内部)

通常不需要自定义域名，使用 Railway 生成的即可。

---

## 环境变量完整清单

### Vercel (Next.js)

```bash
# === 必需 ===
DATABASE_URL=postgresql://...                    # Railway PostgreSQL
AUDIO_ENGINE_URL=https://...up.railway.app     # Railway Audio Engine
NEXTAUTH_URL=https://your-domain.vercel.app
NEXTAUTH_SECRET=<random-secret>

# === 可选 ===
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
AWS_REGION=us-east-1
AWS_S3_BUCKET=

STRIPE_SECRET_KEY=
STRIPE_PUBLISHABLE_KEY=
STRIPE_WEBHOOK_SECRET=

NEXT_PUBLIC_ENABLE_TOPUP=true
NEXT_PUBLIC_AUDIO_ENGINE_URL=https://...
```

### Railway (Audio Engine)

```bash
PORT=8001
# 如果需要访问数据库
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

---

## 持续部署 (CI/CD)

### Vercel
- 自动部署：push 到 `main` 分支
- 预览部署：push 到其他分支或 PR

### Railway
- 自动部署：push 到连接的分支
- 手动部署：在控制台点击 "Deploy"

---

## 监控和日志

### 推荐工具

1. **Sentry** (错误追踪)
   ```bash
   bun add @sentry/nextjs
   ```

2. **LogTail** (日志聚合)
   - Vercel 集成
   - Railway 集成

3. **Vercel Analytics** (性能监控)
   - 免费包含在 Vercel 中

---

## 故障排查

### 前端无法连接后端

1. 检查 `AUDIO_ENGINE_URL` 是否正确
2. 检查 Railway audio-engine 是否启用了 Public Domain
3. 测试: `curl https://<audio-engine-domain>/docs`

### 数据库连接失败

1. 检查 `DATABASE_URL` 格式是否正确
2. 在 Railway 控制台验证 PostgreSQL 运行状态
3. 检查网络策略（Railway 默认允许外部连接）

### 音频处理失败

1. 查看 Railway audio-engine 日志
2. 验证 ffmpeg 是否正确安装
3. 检查请求体大小限制（Vercel: 4.5MB，可调整）

---

## 下一步优化

1. **自定义域名** - 配置 `murmur.app`
2. **CDN 优化** - Vercel 自动处理
3. **数据库备份** - Railway 自动备份
4. **监控告警** - 配置 Sentry/LogTail
5. **性能优化** - 启用 Vercel Analytics

---

## 快速命令

```bash
# 本地开发
bun run dev

# 本地构建测试
bun run build && bun run start

# 数据库迁移
export DATABASE_URL="postgresql://..."
bun run db:migrate

# 推送代码（自动触发部署）
git push origin main
```

---

## 需要帮助？

- Vercel 文档: https://vercel.com/docs
- Railway 文档: https://docs.railway.app
- Next.js 文档: https://nextjs.org/docs
