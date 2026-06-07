# Murmur 完整部署指南（前端 + 后端）

## 致部署者

这份文档包含 Murmur 项目的**完整部署流程**，包括前端和后端。你将从零开始部署整个应用。

**预计时间：** 30-40 分钟
**目标域名：** murmur.ptoq.io

---

## 📋 目录

1. [项目需求分析](#项目需求分析)
2. [架构设计与方案选择](#架构设计与方案选择)
3. [后端部署（Railway）](#后端部署railway)
4. [前端部署（Cloudflare Pages）](#前端部署cloudflare-pages)
5. [验证与测试](#验证与测试)
6. [替代方案](#替代方案)

---

## 项目需求分析

### 应用架构

Murmur 是一个**哼唱转歌曲**的 Web 应用，包含：

**前端：**
- Next.js 16 (React 19)
- 使用 Bun 作为包管理器
- 需要 HTTPS（音频录制需要安全上下文）
- 需要全球 CDN 加速（用户体验）

**后端：**
- **PostgreSQL 数据库** - 存储用户、歌曲、余额等数据
- **Python Audio Engine** - 音频处理服务（FastAPI）
  - 处理哼唱录音
  - 转换为 MIDI
  - 生成音乐

**关键需求：**
1. ✅ 支持 private GitHub 仓库
2. ✅ 自定义域名（murmur.ptoq.io）
3. ✅ 自动 HTTPS
4. ✅ 自动部署（push 即部署）
5. ✅ 低成本（预算有限）
6. ✅ 易于管理（团队协作）

---

## 架构设计与方案选择

### 推荐架构

```
murmur.ptoq.io (Cloudflare Pages)
    ↓
    ├─→ Railway: PostgreSQL 数据库
    └─→ Railway: Python Audio Engine
```

### 为什么选择这个方案？

#### 前端：Cloudflare Pages

**优势：**
- ✅ **完全免费** - 无限带宽，无限请求
- ✅ **全球 CDN** - 300+ 城市，速度最快
- ✅ **自动 HTTPS** - 无需配置
- ✅ **支持 private repos** - 可以连接私有仓库
- ✅ **自动部署** - push 到 GitHub 自动构建
- ✅ **域名管理** - ptoq.io 已在 Cloudflare，配置简单

**为什么不选 Vercel？**
- ❌ Vercel Hobby 计划不支持**组织的 private 仓库**
- ❌ 需要升级到 Pro ($20/月)

**为什么不选 Netlify？**
- ⚠️ 免费版带宽限制 100GB/月
- ⚠️ 构建时间限制更严格

#### 后端：Railway

**优势：**
- ✅ **支持 private repos** - 完全支持
- ✅ **一站式部署** - 数据库 + API 在同一平台
- ✅ **免费额度** - $5/月，够测试和小规模使用
- ✅ **简单易用** - 配置简单，日志清晰
- ✅ **自动备份** - PostgreSQL 每日备份

**为什么不选 Fly.io？**
- ⚠️ 需要写 Dockerfile（已有，但配置更复杂）
- ⚠️ 学习曲线较陡

**为什么不选 Render？**
- ⚠️ 免费版冷启动慢（15-30秒）
- ⚠️ 性能一般

**为什么不全部用 Railway？**
- ⚠️ Next.js 在 Railway 上性能不如 Cloudflare Pages
- ⚠️ Cloudflare 免费，Railway 需要付费
- ✅ 分离前后端，各取所长

---

## 后端部署（Railway）

### 准备工作

**需要：**
- Railway 账户（https://railway.app/）
- GitHub 账户（需要访问 p-to-q/murmur 仓库）

### 第一步：创建 Railway 项目

1. **访问 Railway**
   ```
   https://railway.app/
   ```

2. **登录或注册**
   - 推荐用 GitHub 账户登录
   - 这样可以直接访问仓库

3. **创建新项目**
   - 点击 "New Project"
   - 选择 "Deploy from GitHub repo"
   - 授权 Railway 访问 GitHub
   - 选择仓库：**p-to-q/murmur**
   - 选择分支：**codex/repo-governance-closure** 或 **main**

### 第二步：部署 PostgreSQL 数据库

#### 为什么需要数据库？

数据库存储：
- 用户账户信息
- 用户创建的歌曲
- 用户余额（notes）
- 会话数据

#### 操作步骤

1. **在项目页面点击 "+ New"**

2. **选择 "Database" → "PostgreSQL"**

3. **等待部署完成**（1-2 分钟）

4. **获取数据库连接信息**
   - 点击 PostgreSQL service
   - 进入 "Variables" 标签
   - 找到 `DATABASE_PUBLIC_URL`
   - **复制并保存这个 URL**

   格式类似：
   ```
   postgresql://postgres:密码@主机名.railway.app:端口/railway
   ```

**重要说明：**
- `DATABASE_URL` 是**内部地址**，只能 Railway 内部服务访问
- `DATABASE_PUBLIC_URL` 是**公开地址**，前端（Cloudflare）需要这个

#### 数据库迁移

数据库创建后是空的，需要运行迁移脚本创建表结构。

**方法 A：本地运行（推荐）**

如果你有本地开发环境：

```bash
# 克隆仓库
git clone https://github.com/p-to-q/murmur.git
cd murmur

# 安装依赖
bun install

# 设置数据库 URL
export DATABASE_URL="你的DATABASE_PUBLIC_URL"

# 运行迁移
bun run db:migrate
```

**方法 B：Railway 临时 Service**

1. 创建临时 service
2. 连接到 GitHub repo
3. 设置环境变量 `DATABASE_URL`
4. 运行命令：`bun run db:migrate`
5. 完成后删除这个 service

**方法 C：让开发者运行**

联系 Jiayi (jydu_seven@outlook.com)，他可以在本地运行迁移。

### 第三步：部署 Audio Engine

#### 为什么需要 Audio Engine？

Audio Engine 是核心音频处理服务：
- 接收用户的哼唱录音
- 分析音频特征
- 转换为 MIDI 音符
- 生成音乐片段
- 返回给前端播放

**技术栈：**
- Python + FastAPI
- FFmpeg（音频处理）
- 专有算法（音高检测、节奏分析）

#### 操作步骤

##### 选项 A：通过 Web 界面（推荐）

1. **在 Railway 项目页面点击 "+ New"**

2. **选择 "GitHub Repo"**

3. **连接仓库**
   - 仓库：**p-to-q/murmur**
   - 分支：**codex/repo-governance-closure**
   - 点击 "Add Service" 或 "Deploy"

4. **配置 Service 名称**
   - 进入新创建的 service
   - Settings → Service Name: **audio-engine**

5. **设置 Root Directory** ⚠️ **非常重要！**
   
   **为什么需要 Root Directory？**
   - 整个仓库包含前端和后端代码
   - Audio Engine 代码在 `workers/audio-engine/` 子目录
   - 设置 Root Directory 告诉 Railway 只构建这个目录
   
   **操作：**
   - Settings → Source → Root Directory
   - 输入：**workers/audio-engine**
   - 点击 "Update"

6. **添加环境变量**
   
   - Variables 标签 → "+ New Variable"
   - Variable name: **PORT**
   - Value: **8001**
   
   **为什么需要 PORT？**
   - FastAPI 需要知道监听哪个端口
   - Railway 会自动转发外部请求到这个端口

7. **等待部署完成**（3-5 分钟）
   
   **构建过程：**
   - Railway 检测到 Dockerfile
   - 安装 Python 依赖和 FFmpeg
   - 构建 Docker 镜像
   - 启动容器
   
   **查看进度：**
   - Deployments 标签 → 点击最新部署
   - 查看构建日志

8. **生成公开域名**
   
   **为什么需要公开域名？**
   - 前端（Cloudflare Pages）需要调用 Audio Engine API
   - 公开域名让外部可以访问
   
   **操作：**
   - Settings → Networking → 点击 "Generate Domain"
   - 会生成类似：`https://audio-engine-production-abc123.up.railway.app`
   - **复制并保存这个 URL**

9. **验证部署**
   
   访问：`https://<你的域名>/docs`
   
   应该看到 **FastAPI 自动文档页面**，显示所有 API 端点。

##### 选项 B：通过 CLI（如果 Web 界面有问题）

```bash
# 进入 audio-engine 目录
cd workers/audio-engine

# 部署
railway up

# 设置环境变量
railway variables --set PORT=8001

# 生成域名
railway domain
```

---

## 前端部署（Cloudflare Pages）

### 准备工作

**需要：**
- Cloudflare 账户（管理 ptoq.io 域名的账户）
- Railway 后端已部署（数据库 + Audio Engine）
- 两个 URL：
  - DATABASE_PUBLIC_URL（来自 Railway PostgreSQL）
  - AUDIO_ENGINE_URL（来自 Railway Audio Engine）

### 第一步：登录 Cloudflare

访问：https://dash.cloudflare.com/

确保你的账户已经管理 `ptoq.io` 域名。

### 第二步：创建 Pages 项目

1. **进入 Workers & Pages**
   - 左侧菜单选择 "Workers & Pages"

2. **创建新项目**
   - 点击 "Create application"
   - 选择 "Pages" 标签
   - 点击 "Connect to Git"

3. **连接 GitHub**
   - 授权 Cloudflare 访问 GitHub
   - 选择仓库：**p-to-q/murmur**
   - 点击 "Begin setup"

### 第三步：配置构建设置

**项目名称：** murmur

**Production branch：** codex/repo-governance-closure 或 main

#### Build settings

**Framework preset：** Next.js

**Build command：** 
```bash
bun install && bun run build
```

**为什么用 Bun？**
- 项目使用 Bun 作为包管理器
- 比 npm/yarn 快 2-3 倍
- Cloudflare 支持 Bun

**Build output directory：** 
```
.next
```

**Root directory：** 
```
(留空，使用项目根目录)
```

### 第四步：配置环境变量

点击 "Add environment variable"，逐个添加以下变量。

#### 必需变量

```bash
# === 数据库连接 ===
DATABASE_URL=postgresql://postgres:xxx@xxx.railway.app:5432/railway
# 👆 从 Railway PostgreSQL 的 DATABASE_PUBLIC_URL 复制

# === Audio Engine API ===
AUDIO_ENGINE_URL=https://audio-engine-production-xxx.up.railway.app
# 👆 从 Railway Audio Engine 复制

# === 前端公开 URL ===
NEXTAUTH_URL=https://murmur.ptoq.io
# 👆 最终的域名

# === NextAuth 密钥 ===
NEXTAUTH_SECRET=<生成一个随机字符串>
# 👆 生成方法见下方

# === 前端调用 Audio Engine ===
NEXT_PUBLIC_AUDIO_ENGINE_URL=https://audio-engine-production-xxx.up.railway.app
# 👆 和 AUDIO_ENGINE_URL 相同

# === Node 版本 ===
NODE_VERSION=20
# 👆 确保使用正确的 Node 版本
```

#### 生成 NEXTAUTH_SECRET

**在本地终端运行：**
```bash
openssl rand -base64 32
```

复制输出的字符串作为 `NEXTAUTH_SECRET` 的值。

**为什么需要这个？**
- NextAuth.js 用它加密 session 数据
- 必须是随机且足够长的字符串
- 不要泄露或提交到 Git

#### 可选变量（如果需要 AWS S3 存储）

```bash
AWS_ACCESS_KEY_ID=<your-key>
AWS_SECRET_ACCESS_KEY=<your-secret>
AWS_REGION=us-east-1
AWS_S3_BUCKET=<your-bucket-name>
```

**为什么需要 S3？**
- 存储用户生成的音频文件
- Railway 文件系统是临时的
- S3 提供持久化存储

**不用 S3 可以吗？**
- 可以，音频会存储在内存或临时文件
- 重启后会丢失
- 生产环境建议配置

#### 可选变量（如果需要支付功能）

```bash
STRIPE_SECRET_KEY=sk_live_xxx
STRIPE_PUBLISHABLE_KEY=pk_live_xxx
STRIPE_WEBHOOK_SECRET=whsec_xxx
NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY=pk_live_xxx
```

#### 功能开关

```bash
NEXT_PUBLIC_ENABLE_TOPUP=true
```

### 第五步：开始部署

1. **检查所有配置**
   - 确认所有环境变量已添加
   - 确认构建命令正确

2. **点击 "Save and Deploy"**

3. **等待构建**（5-8 分钟）
   
   **构建过程：**
   - 下载代码
   - 安装依赖（bun install）
   - 运行构建（bun run build）
   - 生成静态资源
   - 部署到全球 CDN

4. **查看构建日志**
   - Deployments → 点击最新部署 → "View build log"
   - 如果失败，查看日志找原因

### 第六步：配置自定义域名

部署成功后：

1. **进入 Custom domains 标签**

2. **添加域名**
   - 点击 "Set up a custom domain"
   - 输入：**murmur.ptoq.io**

3. **自动配置 DNS**
   
   **为什么自动？**
   - ptoq.io 已经在你的 Cloudflare 账户下
   - Cloudflare 会自动添加 CNAME 记录
   - 指向 Pages 部署
   
   **如果域名不在同一账户：**
   - 需要手动添加 DNS 记录
   - Cloudflare 会提供具体的 CNAME 值

4. **等待激活**（1-5 分钟）
   
   **验证：**
   - 状态变为 "Active"
   - 访问 `https://murmur.ptoq.io`

---

## 验证与测试

### 后端验证

#### PostgreSQL
```bash
# 测试连接
psql "你的DATABASE_PUBLIC_URL"

# 或者在本地
export DATABASE_URL="..."
bun run db:studio
```

#### Audio Engine
```bash
# 访问 API 文档
open https://<audio-engine-url>/docs

# 测试健康检查
curl https://<audio-engine-url>/health
```

### 前端验证

访问：`https://murmur.ptoq.io`

#### 功能测试清单

- [ ] **页面加载**
  - 首页正常显示
  - 没有白屏或错误

- [ ] **用户注册/登录**
  - 可以创建新账户
  - 可以登录
  - Session 持久化

- [ ] **录音功能**
  - 浏览器请求麦克风权限
  - 可以录音
  - 可以播放录音

- [ ] **生成歌曲**
  - 录音提交后可以生成
  - 显示处理进度
  - 生成成功后可以播放

- [ ] **Gallery**
  - 可以查看已生成的歌曲
  - 可以播放、下载、删除

- [ ] **Me 页面**
  - 显示用户信息
  - 显示余额（notes）
  - 里程碑系统工作

### 性能测试

1. **Lighthouse 测试**
   - 打开 Chrome DevTools
   - Lighthouse 标签
   - 运行测试
   - 目标：Performance > 80

2. **加载时间**
   - 首次加载 < 3 秒
   - 后续导航 < 1 秒

3. **API 响应**
   - 数据库查询 < 100ms
   - Audio Engine 处理 < 10 秒

### 日志检查

**Cloudflare Pages：**
- Deployments → 点击部署 → Logs
- 查看运行时错误

**Railway：**
- 点击 Service → Deployments → 查看日志
- 实时日志：Logs 标签

---

## 替代方案

如果推荐方案不适合你，这里是其他选择：

### 方案 B：全部用 Railway

**架构：**
```
Railway: Next.js 前端
  ↓
Railway: PostgreSQL
  ↓
Railway: Audio Engine
```

**优势：**
- 统一平台，管理简单
- 不需要 Cloudflare 账户

**劣势：**
- 前端性能不如 Cloudflare CDN
- 成本更高（~$15-20/月）
- 没有全球 CDN 加速

**适合：**
- 不在意全球速度
- 预算充足
- 想要简单管理

### 方案 C：Vercel (Pro) + Railway

**架构：**
```
Vercel: Next.js 前端
  ↓
Railway: PostgreSQL + Audio Engine
```

**优势：**
- Vercel 对 Next.js 支持最好
- 自动预览部署（PR）
- 性能优秀

**劣势：**
- Vercel Pro $20/月（private 组织 repo 必需）
- 总成本 $20-30/月

**适合：**
- 预算充足
- 需要最好的 Next.js 支持
- 团队协作频繁（PR 预览）

### 方案 D：Netlify + Railway

**架构：**
```
Netlify: Next.js 前端
  ↓
Railway: PostgreSQL + Audio Engine
```

**优势：**
- Netlify 免费版支持 private repos
- 构建速度快
- 插件生态好

**劣势：**
- 免费版带宽限制 100GB/月
- 可能不够用

**适合：**
- 流量不大
- 想要免费方案

### 方案 E：Fly.io 全栈

**架构：**
```
Fly.io: 全部服务
```

**优势：**
- 全球边缘部署
- 完全控制
- 价格合理

**劣势：**
- 配置复杂
- 需要 Docker 知识
- 学习曲线陡

**适合：**
- 有 DevOps 经验
- 需要完全控制
- 愿意花时间配置

---

## 成本对比

| 方案 | 前端 | 后端 | 月费用 |
|------|------|------|--------|
| **推荐方案** | Cloudflare (免费) | Railway | $0-10 |
| 全部 Railway | Railway | Railway | $15-20 |
| Vercel Pro | Vercel ($20) | Railway | $25-30 |
| Netlify | Netlify (免费) | Railway | $0-10 |
| Fly.io | Fly.io | Fly.io | $10-15 |

---

## 底层需求总结

### 必须满足的需求

1. **Private Repo 支持**
   - 原因：代码不能公开
   - 方案：Cloudflare/Railway 都支持

2. **自定义域名**
   - 原因：品牌形象
   - 方案：murmur.ptoq.io

3. **HTTPS**
   - 原因：Web Audio API 需要安全上下文
   - 方案：Cloudflare 自动提供

4. **音频处理能力**
   - 原因：核心功能
   - 方案：Python + FFmpeg (Railway)

5. **数据持久化**
   - 原因：用户数据不能丢失
   - 方案：PostgreSQL (Railway)

### 可以灵活选择的

1. **前端托管平台**
   - 推荐：Cloudflare Pages（免费 + 快）
   - 替代：Vercel/Netlify/Railway

2. **后端托管平台**
   - 推荐：Railway（简单 + 便宜）
   - 替代：Fly.io/Render/AWS

3. **文件存储**
   - 推荐：AWS S3（便宜 + 可靠）
   - 替代：Cloudflare R2/本地存储

4. **支付系统**
   - 推荐：Stripe（简单 + 可靠）
   - 替代：PayPal/直接转账

---

## 故障排查

### Cloudflare 构建失败

**常见原因：**
1. 环境变量缺失
2. TypeScript 错误
3. 依赖安装失败

**解决步骤：**
1. 查看构建日志
2. 检查所有环境变量
3. 确认 NODE_VERSION=20
4. 本地测试构建：`bun run build`

### Railway 部署失败

**常见原因：**
1. Root Directory 设置错误
2. Dockerfile 找不到
3. 环境变量缺失

**解决步骤：**
1. 查看部署日志
2. 确认 Root Directory
3. 检查 Dockerfile 路径
4. 验证环境变量

### 功能不工作

**数据库连接失败：**
- 检查 DATABASE_URL 格式
- 确认使用 PUBLIC_URL 而非内部 URL
- 测试连接：`psql "你的URL"`

**Audio Engine 无响应：**
- 访问 /docs 验证服务运行
- 查看 Railway 日志
- 检查 AUDIO_ENGINE_URL 是否正确

**前端白屏：**
- 打开浏览器 Console
- 查看错误信息
- 检查 Cloudflare Logs

---

## 联系与支持

**开发者：**
- Email: jydu_seven@outlook.com
- GitHub: p-to-q/murmur

**平台支持：**
- Railway: https://railway.app/help
- Cloudflare: https://developers.cloudflare.com/

---

## 下一步

部署完成后：

1. **监控**
   - 设置 Cloudflare Analytics
   - 设置 Railway Alerts

2. **优化**
   - 图片压缩
   - 代码分割
   - 缓存策略

3. **安全**
   - 定期更新依赖
   - 配置 WAF 规则
   - 备份数据库

---

**祝部署顺利！** 🚀

如果有任何问题，随时查阅文档或联系开发者。
