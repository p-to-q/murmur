# Murmur 部署指南 - Cloudflare Pages + Railway

## 架构说明

```
murmur.ptoq.io (Cloudflare Pages)
    ↓
    ├─→ Railway: Python Audio Engine
    └─→ Railway: PostgreSQL
```

---

## 第一步：Railway 后端部署（数据库 + Audio Engine）

### 1. 创建 Railway 账户并登录

访问: https://railway.app/

### 2. 创建新项目

1. 点击 "New Project"
2. 选择 "Deploy from GitHub repo"
3. 连接 GitHub 账户
4. 选择仓库: `p-to-q/murmur`
5. 选择分支: `codex/repo-governance-closure` 或 `main`

### 3. 添加 PostgreSQL 数据库

1. 在项目页面点击 "+ New"
2. 选择 "Database" → "PostgreSQL"
3. 等待部署完成（约 1-2 分钟）
4. 点击 PostgreSQL service
5. 进入 "Variables" 标签
6. 复制 `DATABASE_PUBLIC_URL` 的值（类似: `postgresql://postgres:xxx@xxx.railway.app:5432/railway`）

**保存这个 URL，后面会用到！**

### 4. 部署 Audio Engine Service

1. 回到项目页面，点击 "+ New"
2. 选择 "Empty Service"
3. 命名为 `audio-engine`
4. 点击 "Settings"
5. 在 "Source" 部分:
   - 连接到 GitHub repo: `p-to-q/murmur`
   - Branch: `codex/repo-governance-closure` 或 `main`
   - **Root Directory**: `workers/audio-engine` ⚠️ 重要！
6. 在 "Deploy" 部分:
   - Build Command: 留空（自动检测 Dockerfile）
   - Start Command: 留空（使用 Dockerfile CMD）

#### 配置环境变量

在 "Variables" 标签添加：

```
PORT=8001
```

#### 生成公开 URL

1. 进入 "Settings" → "Networking"
2. 点击 "Generate Domain"
3. 复制生成的 URL（类似: `https://audio-engine-production-xxx.up.railway.app`）

**保存这个 URL，后面会用到！**

### 5. 验证 Audio Engine

访问: `https://<your-audio-engine-domain>/docs`

应该能看到 FastAPI 文档页面。如果看到，说明部署成功！

---

## 第二步：Cloudflare Pages 前端部署

### 1. 登录 Cloudflare

访问: https://dash.cloudflare.com/

确保你的 Cloudflare 账户已经管理了 `ptoq.io` 域名。

### 2. 创建 Pages 项目

1. 进入 "Workers & Pages"
2. 点击 "Create application"
3. 选择 "Pages" 标签
4. 点击 "Connect to Git"

### 3. 连接 GitHub

1. 授权 Cloudflare 访问 GitHub
2. 选择仓库: `p-to-q/murmur`
3. 点击 "Begin setup"

### 4. 配置构建设置

**项目名称:** `murmur`

**Production branch:** `codex/repo-governance-closure` 或 `main`

**Build settings:**
- Framework preset: `Next.js (Static Exports)` 或选择 `None`
- Build command: `bun install && bun run build`
- Build output directory: `.next`

**Root Directory:** 留空（使用根目录）

### 5. 配置环境变量

在 "Environment variables" 部分添加：

```bash
# 数据库（从 Railway PostgreSQL 复制）
DATABASE_URL=postgresql://postgres:xxx@xxx.railway.app:5432/railway

# Audio Engine（从 Railway audio-engine 复制）
AUDIO_ENGINE_URL=https://audio-engine-production-xxx.up.railway.app

# NextAuth 配置
NEXTAUTH_URL=https://murmur.ptoq.io
NEXTAUTH_SECRET=<生成一个随机字符串>

# 公开 Audio Engine URL（用于前端调用）
NEXT_PUBLIC_AUDIO_ENGINE_URL=https://audio-engine-production-xxx.up.railway.app

# 可选：如果需要 S3 存储
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# AWS_REGION=us-east-1
# AWS_S3_BUCKET=

# 可选：如果需要支付功能
# STRIPE_SECRET_KEY=
# STRIPE_PUBLISHABLE_KEY=
# STRIPE_WEBHOOK_SECRET=
# NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=
```

**生成 NEXTAUTH_SECRET:**

在本地终端运行：
```bash
openssl rand -base64 32
```

复制输出的字符串。

### 6. 部署

点击 "Save and Deploy"

Cloudflare 会开始构建和部署，大约需要 3-5 分钟。

### 7. 配置自定义域名

部署完成后：

1. 进入项目的 "Custom domains" 标签
2. 点击 "Set up a custom domain"
3. 输入: `murmur.ptoq.io`
4. Cloudflare 会自动配置 DNS（因为域名已经在你的账户下）
5. 等待 DNS 生效（通常几分钟）

---

## 第三步：数据库迁移

### 方法 A: 本地运行（推荐）

1. 克隆代码到本地：
```bash
git clone https://github.com/p-to-q/murmur.git
cd murmur
```

2. 安装依赖：
```bash
bun install
```

3. 设置数据库 URL：
```bash
export DATABASE_URL="postgresql://postgres:xxx@xxx.railway.app:5432/railway"
```

4. 运行迁移：
```bash
bun run db:migrate
```

### 方法 B: Railway 临时 Service

1. 在 Railway 创建临时 service
2. 连接到 GitHub repo
3. 设置环境变量 `DATABASE_URL`
4. 运行命令: `bun run db:migrate`
5. 完成后删除该 service

---

## 第四步：验证部署

### ✅ 检查清单

- [ ] 访问 `https://murmur.ptoq.io` - 前端加载正常
- [ ] 访问 `https://<audio-engine-domain>/docs` - API 文档可见
- [ ] Railway PostgreSQL - 状态显示 "Running"
- [ ] 可以注册/登录用户
- [ ] 可以创建 Hum 并生成歌曲

### 查看日志

**Cloudflare Pages:**
- 项目 → Deployments → 点击部署 → View build log

**Railway:**
- 点击 Service → "Deployments" 标签 → 查看日志

---

## 常见问题

### Q: 构建失败，TypeScript 错误？

确保使用最新代码：
```bash
git pull origin codex/repo-governance-closure
```

### Q: 数据库连接失败？

检查 `DATABASE_URL` 格式：
```
postgresql://postgres:<password>@<host>:<port>/railway
```

确保使用的是 `DATABASE_PUBLIC_URL`，不是内部 URL。

### Q: Audio Engine 无法访问？

1. 检查 Railway audio-engine service 是否运行
2. 确保已经 "Generate Domain"
3. 访问 `/docs` 端点验证

### Q: 前端无法连接后端？

检查环境变量：
- `AUDIO_ENGINE_URL` 正确
- `NEXT_PUBLIC_AUDIO_ENGINE_URL` 正确（无需 http:// 或 https://）

### Q: Cloudflare Pages 构建超时？

增加构建超时时间：
1. 项目设置
2. Builds & deployments
3. 调整 timeout

---

## 成本估算

| 服务 | 费用 |
|------|------|
| **Cloudflare Pages** | 完全免费 |
| **Railway PostgreSQL** | $5/月（免费额度可用） |
| **Railway Audio Engine** | $5/月（免费额度可用） |
| **总计** | ~$0-10/月 |

**Railway 免费额度：**
- 每月 $5 信用额度
- 可以运行小型服务约 500 小时
- 足够测试和小规模使用

---

## 环境变量完整清单

### Cloudflare Pages (Next.js)

```bash
DATABASE_URL=postgresql://...
AUDIO_ENGINE_URL=https://...up.railway.app
NEXTAUTH_URL=https://murmur.ptoq.io
NEXTAUTH_SECRET=<random-32-char-string>
NEXT_PUBLIC_AUDIO_ENGINE_URL=https://...up.railway.app
```

### Railway Audio Engine

```bash
PORT=8001
```

---

## 后续优化

1. **设置 GitHub Actions CI/CD**
   - 自动测试
   - 自动部署

2. **配置监控**
   - Cloudflare Analytics（内置）
   - Railway Metrics（内置）
   - 可选：Sentry 错误追踪

3. **性能优化**
   - Cloudflare CDN 缓存
   - 图片优化
   - 代码分割

4. **安全加固**
   - 配置 CSP headers
   - 启用 HTTPS only
   - 定期更新依赖

---

## 需要帮助？

遇到问题可以：
1. 查看 Railway 日志
2. 查看 Cloudflare Pages 构建日志
3. 检查环境变量配置
4. 参考 GitHub repo 的 `DEPLOY.md`

---

## 快速命令参考

```bash
# 本地开发
bun install
bun run dev

# 本地构建测试
bun run build

# 数据库迁移
export DATABASE_URL="postgresql://..."
bun run db:migrate

# 推送代码（自动触发部署）
git add .
git commit -m "Update"
git push origin main
```

---

**部署完成后，访问 https://murmur.ptoq.io 即可！** 🎉
