# MURMUR 实际部署架构

> **最后更新**: 2026-06-08  
> **生产环境**: https://murmur.ptoq.io

---

## 🎯 实际部署方案

**架构: Vercel + Neon PostgreSQL**

```
┌─────────────────────────────────────────────┐
│  Vercel: Next.js 前端 + API Routes         │
│  https://murmur.ptoq.io                     │
└────────────┬────────────────────────────────┘
             │
             ├─→ Neon: PostgreSQL 数据库
             │   (Vercel 集成)
             │
             └─→ Audio Engine: 外部服务
                 (需要单独配置 AUDIO_WORKER_URL)
```

---

## ✅ 当前配置

### 1. 前端 + API (Vercel)
- **平台**: Vercel
- **域名**: `murmur.ptoq.io`
- **仓库**: `p-to-q/murmur`
- **分支**: `main`
- **构建命令**: `bun install && bun run build`
- **输出目录**: `.next`
- **Node 版本**: 20

### 2. 数据库 (Neon)
- **平台**: Neon (Vercel Postgres 集成)
- **类型**: PostgreSQL (Serverless)
- **连接**: 通过 `DATABASE_URL` 环境变量
- **优势**:
  - ✅ Serverless, 按需付费
  - ✅ 与 Vercel 原生集成
  - ✅ 自动备份
  - ✅ 免费额度大

### 3. 音频引擎
- **需要配置**: `AUDIO_WORKER_URL` (外部服务)
- **可选方案**:
  - Railway Python Worker
  - 自建服务器
  - 或其他云服务

---

## 🔧 环境变量 (Vercel)

在 Vercel Dashboard → Settings → Environment Variables 配置：

```bash
# ─── 数据库 ────────────────────────────────────
DATABASE_URL=<Neon 提供的连接字符串>
# 或使用 Vercel Postgres 自动注入的变量
POSTGRES_URL=<自动注入>

# ─── 音频引擎 ──────────────────────────────────
AUDIO_WORKER_URL=<你的 Audio Engine URL>
AUDIO_WORKER_TOKEN=<可选的认证 token>
AUDIO_ENGINE_PITCH_PROVIDER=auto
AUDIO_ENGINE_DENOISE_PROVIDER=auto

# ─── NextAuth ──────────────────────────────────
NEXTAUTH_URL=https://murmur.ptoq.io
NEXTAUTH_SECRET=<用 openssl rand -base64 32 生成>

# ─── OpenAI (可选) ─────────────────────────────
OPENAI_API_KEY=<如果使用 OpenAI>
OPENAI_BASE_URL=<可选>

# ─── Vercel Cron (可选) ────────────────────────
CRON_SECRET=<随机字符串>

# ─── 存储 (可选) ───────────────────────────────
# 如果不配置，默认使用 memory 存储
MURMUR_STORAGE_DRIVER=memory
# 或使用 S3-compatible (R2, S3, COS)
# MURMUR_STORAGE_DRIVER=s3-compatible
# MURMUR_STORAGE_S3_BUCKET=
# MURMUR_STORAGE_S3_REGION=
# MURMUR_STORAGE_S3_ACCESS_KEY_ID=
# MURMUR_STORAGE_S3_SECRET_ACCESS_KEY=
# MURMUR_STORAGE_S3_ENDPOINT=

# ─── 其他 ──────────────────────────────────────
NODE_VERSION=20

# ─── UI/UX 配置 (可选) ─────────────────────────
# 永远显示示例旋律按钮（用于生产环境展示和测试）
# 设置为 "1" 永远显示，不设置则使用默认行为（前5次访问）
NEXT_PUBLIC_ALWAYS_SHOW_DEMO=1
```

---

## 📝 部署步骤回顾

### 1. Vercel 部署
1. 登录 Vercel Dashboard
2. Import Git Repository
3. 选择 `p-to-q/murmur` 仓库
4. 配置构建设置：
   - Framework Preset: Next.js
   - Build Command: `bun install && bun run build`
   - Output Directory: `.next`
5. 配置环境变量（见上）
6. Deploy

### 2. Neon 数据库
1. 在 Vercel Dashboard → Storage → Create Database
2. 选择 Neon Postgres
3. Vercel 会自动注入 `POSTGRES_URL` 等变量
4. 运行数据库迁移：
   ```bash
   bun run db:push
   ```

### 3. 域名配置
1. 在 Vercel → Settings → Domains
2. 添加 `murmur.ptoq.io`
3. 配置 DNS (在 Cloudflare 或域名提供商):
   ```
   CNAME  murmur  cname.vercel-dns.com
   ```

---

## 🎨 特点

### Vercel 的优势
- ✅ 全球 Edge Network
- ✅ 自动 HTTPS
- ✅ 零配置 CDN
- ✅ Git 集成自动部署
- ✅ Preview Deployments
- ✅ 优秀的 Next.js 支持

### Neon 的优势
- ✅ Serverless PostgreSQL
- ✅ 按需付费，冷启动快
- ✅ 与 Vercel 原生集成
- ✅ 自动备份和恢复
- ✅ 支持分支数据库

---

## 💰 成本

- **Vercel Free Tier**:
  - 100 GB 带宽/月
  - 100 GB 构建时间/月
  - 无限项目
  - **适合个人项目和原型**

- **Neon Free Tier**:
  - 0.5 GB 存储
  - 每月 191.9 小时计算时间
  - **适合小型应用**

**总成本**: $0/月（在免费额度内）

---

## 📊 与其他方案对比

| 方案 | 前端 | 数据库 | 优势 | 劣势 |
|------|------|--------|------|------|
| **当前: Vercel + Neon** | Vercel | Neon | 最简单，Vercel 原生支持 | 免费额度较小 |
| Cloudflare + Railway | Cloudflare Pages | Railway PG | 免费额度大 | 配置复杂 |
| Vercel + Railway | Vercel | Railway PG | 灵活 | 需要两个平台 |

---

## 🆘 故障排查

### 数据库连接失败
1. 检查 `DATABASE_URL` 或 `POSTGRES_URL` 是否正确
2. 检查 Neon 数据库是否启动（可能休眠）
3. 查看 Vercel Logs

### 音频引擎不可用
1. 检查 `AUDIO_WORKER_URL` 是否配置
2. 检查 Audio Engine 服务是否运行
3. 使用示例旋律测试（不依赖 Audio Engine）

### 构建失败
1. 检查 Vercel Build Logs
2. 确认 `bun install` 成功
3. 确认环境变量配置正确

---

## 📚 相关文档

- [Vercel 官方文档](https://vercel.com/docs)
- [Neon 官方文档](https://neon.tech/docs)
- [Next.js 部署指南](https://nextjs.org/docs/deployment)

---

## 🔄 未来迁移建议

如果需要扩展或降低成本，可以考虑：

1. **迁移到 Cloudflare Pages + Neon**
   - 更大免费额度
   - 但需要配置 Cloudflare Workers

2. **迁移到 Railway (全栈)**
   - 前端 + 数据库都在 Railway
   - 统一管理
   - 但 Railway 免费额度较小

3. **自建服务器**
   - 完全控制
   - 但需要运维

---

**当前方案运行良好，无需立即迁移。** ✅
