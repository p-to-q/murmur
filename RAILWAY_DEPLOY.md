# Railway 部署指南

## 架构

```
Railway Project: murmur
├── Service 1: Next.js App (主应用)
├── Service 2: Python Audio Engine (音频处理)
└── Service 3: PostgreSQL (数据库)
```

## 部署步骤

### 1. 创建 Railway Project

1. 访问 https://railway.app/
2. 点击 "New Project"
3. 选择 "Deploy from GitHub repo"
4. 选择 `p-to-q/murmur` 仓库
5. 选择 `codex/repo-governance-closure` 分支（或 `main`）

### 2. 添加 PostgreSQL

1. 在 Project 页面点击 "+ New"
2. 选择 "Database" → "PostgreSQL"
3. 数据库会自动创建并生成连接信息

### 3. 配置 Next.js App Service

**环境变量：**

```bash
# Database (from Railway PostgreSQL service)
DATABASE_URL=${{Postgres.DATABASE_URL}}

# Audio Engine (will be set after creating service 2)
AUDIO_ENGINE_URL=${{audio-engine.RAILWAY_PUBLIC_DOMAIN}}

# Auth (replace with your values)
NEXTAUTH_URL=https://${{RAILWAY_PUBLIC_DOMAIN}}
NEXTAUTH_SECRET=<generate-a-secret>

# AWS S3 (optional, for production storage)
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
AWS_REGION=us-east-1
AWS_S3_BUCKET=<your-bucket>

# Stripe (optional, for payments)
STRIPE_SECRET_KEY=<your-key>
STRIPE_PUBLISHABLE_KEY=<your-key>
STRIPE_WEBHOOK_SECRET=<your-secret>

# Feature flags
NEXT_PUBLIC_ENABLE_TOPUP=true
```

**Build & Start Commands:**
- Build Command: `bun install && bun run build`
- Start Command: `bun run start`

**Root Directory:** `/` (默认)

### 4. 配置 Python Audio Engine Service

1. 在 Project 页面点击 "+ New"
2. 选择 "Empty Service"
3. 命名为 `audio-engine`

**设置：**
- Root Directory: `workers/audio-engine`
- Build Command: 自动检测 Dockerfile
- Start Command: 自动使用 Dockerfile CMD

**环境变量：**

```bash
# Port
PORT=8001

# Database (if needed)
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

**Public Domain:**
- 启用 "Generate Domain" 获取公开 URL
- 复制此 URL，用于 Next.js 的 `AUDIO_ENGINE_URL`

### 5. 运行数据库迁移

在 Next.js service 中添加部署后脚本：

```bash
# 在 Settings → Deploy 中添加
bun run db:migrate
```

或者在本地运行迁移后推送：

```bash
# 设置生产数据库 URL
export DATABASE_URL="postgresql://..."
bun run db:migrate
```

## 验证部署

1. **Next.js App**: 访问 Railway 生成的域名
2. **Audio Engine**: 访问 `https://<audio-engine-domain>/docs` 查看 FastAPI 文档
3. **数据库**: 在 Railway 控制台查看 PostgreSQL 连接状态

## 常见问题

### Q: Bun 版本不对？

在 `package.json` 中指定了 `"packageManager": "bun@1.3.9"`，Railway 会自动使用。

### Q: 构建超时？

增加超时时间：Settings → Build → Timeout (默认 10 分钟)

### Q: 音频处理失败？

检查 audio-engine service 日志，确保 ffmpeg 正确安装。

### Q: 数据库连接失败？

确保所有 service 都在同一个 Railway project 中，变量引用格式正确。

## 环境变量参考

| 变量名 | 必需 | 说明 |
|--------|------|------|
| `DATABASE_URL` | ✅ | PostgreSQL 连接字符串 |
| `AUDIO_ENGINE_URL` | ✅ | Python worker 公开域名 |
| `NEXTAUTH_URL` | ✅ | 应用公开 URL |
| `NEXTAUTH_SECRET` | ✅ | NextAuth 密钥 |
| `AWS_*` | ❌ | S3 存储（可选） |
| `STRIPE_*` | ❌ | 支付功能（可选） |

## 成本估算

- Next.js App: ~$5/月 (Hobby plan)
- Python Worker: ~$5/月
- PostgreSQL: ~$5/月
- **总计: ~$15/月**

免费额度: $5/月，可以先用免费版测试。

## 下一步

部署成功后：
1. 配置自定义域名
2. 设置生产环境监控
3. 配置 Sentry 错误追踪
4. 启用 Railway Analytics
