# 前端部署完整指南（给你的朋友）

## 概述

这份文档提供了部署 Murmur 前端到 Cloudflare Pages 的完整步骤，包括所有必需的环境变量、API 接口说明和配置细节。

---

## 后端接口信息

### Railway 后端已部署

**PostgreSQL 数据库：**
- Public URL: `postgresql://postgres:thUllMrNKoNUrlstBqspXPciwFPLKdji@acela.proxy.rlwy.net:18838/railway`
- 状态：✅ 运行中
- 数据库迁移：✅ 已完成

**Audio Engine API：**
- 状态：⏳ 需要手动添加（见下方步骤）
- 部署后会提供 URL

---

## 第一步：完成 Audio Engine 部署

### 在 Railway 添加 Audio Engine Service

1. **访问 Railway 项目**
   - URL: https://railway.com/project/05dc78c7-9ea8-4b8c-a30f-40fa179d0a73
   - 需要 Railway 账户权限（联系 jydu_seven@outlook.com 添加）

2. **创建新 Service**
   - 点击右上角 "+ New"
   - 选择 "GitHub Repo"
   - 选择仓库：`p-to-q/murmur`
   - 选择分支：`codex/repo-governance-closure` 或 `main`
   - 点击 "Add Service"

3. **配置 Service**
   
   进入新创建的 service，点击 "Settings"：
   
   **Service Name:** `audio-engine`
   
   **Root Directory:**
   - 找到 "Source" 部分
   - 设置 Root Directory 为：`workers/audio-engine`
   - 点击 "Update"

4. **设置环境变量**
   
   进入 "Variables" 标签，添加：
   ```
   PORT=8001
   ```

5. **生成公开域名**
   
   进入 "Settings" → "Networking"：
   - 点击 "Generate Domain"
   - 会生成类似：`https://audio-engine-production-xxx.up.railway.app`
   - **记录这个 URL！** 后面需要用到

6. **等待部署完成**
   
   - 查看 "Deployments" 标签
   - 等待状态变为 "Success"（约 3-5 分钟）

7. **验证部署**
   
   访问：`https://<your-audio-engine-domain>/docs`
   
   应该看到 FastAPI 自动文档页面，显示所有 API 端点。

---

## 第二步：Cloudflare Pages 前端部署

### 前提条件

- ✅ Cloudflare 账户（已管理 `ptoq.io` 域名）
- ✅ GitHub 仓库访问权限：`p-to-q/murmur`
- ✅ Railway Audio Engine URL（从上一步获得）

### 部署步骤

#### 1. 登录 Cloudflare Dashboard

访问：https://dash.cloudflare.com/

#### 2. 创建 Pages 项目

1. 在左侧菜单选择 "Workers & Pages"
2. 点击 "Create application"
3. 选择 "Pages" 标签
4. 点击 "Connect to Git"

#### 3. 连接 GitHub

1. 如果首次使用，需要授权 Cloudflare 访问 GitHub
2. 选择仓库：`p-to-q/murmur`
3. 点击 "Begin setup"

#### 4. 配置构建设置

**基本设置：**
- **Project name:** `murmur`
- **Production branch:** `codex/repo-governance-closure` 或 `main`

**Build settings：**
- **Framework preset:** 选择 `Next.js`
- **Build command:** `bun install && bun run build`
- **Build output directory:** `.next`
- **Root directory:** 留空（使用项目根目录）

**Node version:**
- 在环境变量中添加：`NODE_VERSION = 20`

#### 5. 配置环境变量

⚠️ **重要：必须配置以下所有环境变量**

点击 "Add environment variable"，逐个添加：

##### 必需变量：

```bash
# 数据库连接（Railway PostgreSQL）
DATABASE_URL=postgresql://postgres:thUllMrNKoNUrlstBqspXPciwFPLKdji@acela.proxy.rlwy.net:18838/railway

# Audio Engine API（从上一步获得的 Railway URL）
AUDIO_ENGINE_URL=https://audio-engine-production-xxx.up.railway.app

# 前端公开 URL（最终域名）
NEXTAUTH_URL=https://murmur.ptoq.io

# NextAuth 密钥（生成方法见下方）
NEXTAUTH_SECRET=<生成一个32字符的随机字符串>

# 前端调用 Audio Engine 的公开 URL
NEXT_PUBLIC_AUDIO_ENGINE_URL=https://audio-engine-production-xxx.up.railway.app

# Node 版本
NODE_VERSION=20
```

##### 可选变量（如果需要 S3 存储）：

```bash
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
AWS_REGION=us-east-1
AWS_S3_BUCKET=<your-bucket-name>
```

##### 可选变量（如果需要支付功能）：

```bash
STRIPE_SECRET_KEY=<sk_live_xxx>
STRIPE_PUBLISHABLE_KEY=<pk_live_xxx>
STRIPE_WEBHOOK_SECRET=<whsec_xxx>
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=<pk_live_xxx>
```

##### 功能开关：

```bash
NEXT_PUBLIC_ENABLE_TOPUP=true
```

#### 如何生成 NEXTAUTH_SECRET

在本地终端运行：
```bash
openssl rand -base64 32
```

复制输出的字符串作为 `NEXTAUTH_SECRET` 的值。

#### 6. 开始部署

1. 确认所有环境变量已添加
2. 点击 "Save and Deploy"
3. Cloudflare 开始构建（约 5-8 分钟）

#### 7. 监控构建

- 可以在 "Deployments" 页面查看构建日志
- 如果失败，查看日志找原因

#### 8. 配置自定义域名

部署成功后：

1. 进入项目的 "Custom domains" 标签
2. 点击 "Set up a custom domain"
3. 输入：`murmur.ptoq.io`
4. Cloudflare 会自动配置 DNS（因为 `ptoq.io` 已在你的账户下）
5. 等待激活（通常 1-5 分钟）

---

## 第三步：验证部署

### ✅ 完整检查清单

- [ ] **Railway PostgreSQL**
  - 访问 Railway 控制台
  - 状态显示 "Active"

- [ ] **Railway Audio Engine**
  - 访问 `https://<audio-engine-url>/docs`
  - 看到 FastAPI 文档页面
  - 状态显示 "Active"

- [ ] **Cloudflare Pages 前端**
  - 访问 `https://murmur.ptoq.io`
  - 页面正常加载
  - 没有白屏或错误

- [ ] **功能测试**
  - 可以注册新用户
  - 可以登录
  - 可以进入 Hum 页面
  - 可以录音（需要麦克风权限）
  - 可以生成歌曲

### 查看日志

**Cloudflare Pages：**
1. 进入项目 → Deployments
2. 点击最新部署
3. 查看 "Build log" 和 "Function log"

**Railway：**
1. 点击对应的 Service
2. 进入 "Deployments" 标签
3. 点击最新部署查看日志

---

## API 接口文档

### Audio Engine API

**Base URL:** `https://<audio-engine-url>`

**主要端点：**

1. **健康检查**
   - `GET /health`
   - 返回：`{"status": "ok"}`

2. **API 文档**
   - `GET /docs`
   - 查看所有端点的交互式文档

3. **音频处理**
   - 端点会在 `/docs` 中列出
   - 主要功能：哼唱转歌曲

### Next.js API Routes

**Base URL:** `https://murmur.ptoq.io/api`

**端点列表：**

- `POST /api/songs` - 创建歌曲
- `GET /api/songs` - 获取歌曲列表
- `GET /api/songs/[id]` - 获取单个歌曲
- `DELETE /api/songs/[id]` - 删除歌曲
- `GET /api/balance` - 获取用户余额
- `POST /api/topup` - 充值
- 其他端点见代码：`src/app/api/`

---

## 环境变量完整清单

### Cloudflare Pages 环境变量（复制粘贴用）

```bash
DATABASE_URL=postgresql://postgres:thUllMrNKoNUrlstBqspXPciwFPLKdji@acela.proxy.rlwy.net:18838/railway
AUDIO_ENGINE_URL=https://[替换为你的audio-engine域名].up.railway.app
NEXTAUTH_URL=https://murmur.ptoq.io
NEXTAUTH_SECRET=[用openssl rand -base64 32生成]
NEXT_PUBLIC_AUDIO_ENGINE_URL=https://[替换为你的audio-engine域名].up.railway.app
NODE_VERSION=20
NEXT_PUBLIC_ENABLE_TOPUP=true
```

### Railway Audio Engine 环境变量

```bash
PORT=8001
```

---

## 常见问题排查

### Q1: Cloudflare 构建失败 "Command failed"

**可能原因：**
- 环境变量缺失
- Node 版本不对
- 依赖安装失败

**解决方法：**
1. 检查所有必需的环境变量是否都已添加
2. 确认 `NODE_VERSION=20`
3. 查看构建日志找具体错误

### Q2: 页面加载但功能不工作

**可能原因：**
- Audio Engine 未部署或 URL 错误
- 数据库连接失败

**解决方法：**
1. 验证 Audio Engine 状态
2. 检查环境变量中的 URL 是否正确
3. 查看浏览器控制台的错误信息

### Q3: 无法录音或生成歌曲

**可能原因：**
- 浏览器权限问题
- Audio Engine 未响应
- API 调用失败

**解决方法：**
1. 确保浏览器允许麦克风权限（HTTPS 必需）
2. 检查 Network 标签，看 API 调用是否成功
3. 查看 Railway Audio Engine 日志

### Q4: 自定义域名无法访问

**可能原因：**
- DNS 未生效
- SSL 证书未签发

**解决方法：**
1. 等待 5-15 分钟让 DNS 传播
2. 检查 Cloudflare DNS 记录
3. 确认 SSL/TLS 模式为 "Full" 或 "Full (strict)"

### Q5: TypeScript 或构建错误

**解决方法：**
1. 确保使用最新代码：
   ```bash
   git pull origin codex/repo-governance-closure
   ```
2. 检查是否有新的依赖需要安装
3. 查看 GitHub 仓库的最新 commit

---

## 性能优化建议

### Cloudflare 优化

1. **缓存规则**
   - 静态资源自动缓存
   - API 路由排除缓存

2. **图片优化**
   - 使用 Cloudflare Image Resizing
   - 自动 WebP/AVIF 转换

3. **压缩**
   - 自动 Brotli 压缩
   - 开启 HTTP/3

### Railway 优化

1. **增加实例数量**（如果负载高）
   - Settings → Replicas

2. **监控资源使用**
   - Metrics 标签查看 CPU/内存

3. **设置健康检查**
   - 自动重启故障实例

---

## 持续部署 (CI/CD)

### 自动部署设置

Cloudflare Pages 已经配置了自动部署：

- **推送到 production 分支** → 自动构建并部署
- **创建 Pull Request** → 自动创建预览部署
- **合并 PR** → 预览环境自动清理

### 手动重新部署

如果需要手动触发：

1. 进入 Cloudflare Pages 项目
2. Deployments → 点击 "Retry deployment"

或者：

1. 在 GitHub 创建空 commit：
   ```bash
   git commit --allow-empty -m "Trigger rebuild"
   git push
   ```

---

## 监控和日志

### Cloudflare Analytics

1. 进入项目 → Web Analytics
2. 查看：
   - 访问量
   - 性能指标
   - 错误率

### Railway Metrics

1. 进入 Service → Metrics
2. 查看：
   - CPU 使用率
   - 内存使用
   - 网络流量

### 错误追踪（可选）

推荐集成 Sentry：

```bash
bun add @sentry/nextjs
```

配置后可以实时追踪错误和性能问题。

---

## 备份和恢复

### 数据库备份

Railway PostgreSQL 自动备份：
- 每日自动备份
- 保留 7 天
- 可在 Railway 控制台恢复

### 手动备份

```bash
pg_dump $DATABASE_URL > backup.sql
```

### 恢复

```bash
psql $DATABASE_URL < backup.sql
```

---

## 安全建议

1. **环境变量**
   - 永远不要提交 `.env` 到 Git
   - 定期轮换密钥

2. **域名安全**
   - 启用 Cloudflare WAF
   - 配置速率限制

3. **数据库安全**
   - 使用强密码
   - 只允许必要的 IP 访问（Railway 已配置）

4. **HTTPS**
   - 强制 HTTPS（Cloudflare 自动）
   - HSTS headers

---

## 成本估算

| 服务 | 月费用 |
|------|--------|
| Cloudflare Pages | **免费** |
| Railway PostgreSQL | ~$5（免费额度可用） |
| Railway Audio Engine | ~$5（免费额度可用） |
| `ptoq.io` 域名 | 已有 |
| **总计** | **$0-10/月** |

**说明：**
- Cloudflare Pages 完全免费，无限带宽
- Railway 每月提供 $5 免费额度
- 如果流量不大，可能完全免费运行

---

## 技术栈说明

### 前端
- **框架:** Next.js 16 (React 19)
- **UI:** Tailwind CSS + Framer Motion
- **音频:** Tone.js + Web Audio API
- **状态管理:** Zustand
- **数据库 ORM:** Drizzle ORM

### 后端
- **API:** FastAPI (Python)
- **音频处理:** FFmpeg + 专有算法
- **数据库:** PostgreSQL

### 部署
- **前端:** Cloudflare Pages (Edge Network)
- **后端:** Railway (US West)
- **数据库:** Railway PostgreSQL

---

## 联系方式

如遇到问题：

1. **检查文档** - 先查看本文档和 GitHub 仓库的 `README.md`
2. **查看日志** - Cloudflare 和 Railway 的部署日志
3. **联系开发者** - jydu_seven@outlook.com

---

## 快速参考

### 重要 URL

- **Railway 项目:** https://railway.com/project/05dc78c7-9ea8-4b8c-a30f-40fa179d0a73
- **GitHub 仓库:** https://github.com/p-to-q/murmur
- **生产域名:** https://murmur.ptoq.io
- **Audio Engine 文档:** https://[your-domain].up.railway.app/docs

### 常用命令

```bash
# 克隆仓库
git clone https://github.com/p-to-q/murmur.git

# 安装依赖
bun install

# 本地开发
bun run dev

# 本地构建测试
bun run build

# 生成 NextAuth secret
openssl rand -base64 32

# 数据库迁移（已完成，除非更新 schema）
export DATABASE_URL="postgresql://..."
bun run db:migrate
```

---

**祝部署顺利！🚀**

如果一切正常，访问 https://murmur.ptoq.io 就能看到你的应用了！
