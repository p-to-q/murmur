# 🚨 生产环境配置清单

> **当前状态**：线上临时跳过了计费检查，用户可以正常使用
> 
> **TODO**：需要配置数据库和 OAuth，然后移除临时跳过逻辑

---

## 📋 需要配置的地方

### 1️⃣ **Vercel Dashboard 环境变量**

登录 [Vercel Dashboard](https://vercel.com) → 选择 `murmur` 项目 → **Settings** → **Environment Variables**

#### ✅ 必须配置（否则功能不完整）

```bash
# ─── 数据库连接 ────────────────────────────────────
# 使用 Neon、Supabase 或其他 Postgres 数据库
DATABASE_URL=postgresql://user:password@host:5432/database
# 或者
POSTGRES_URL=postgresql://user:password@host:5432/database

# ─── Google OAuth ──────────────────────────────────
# 从 Google Cloud Console 获取
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx

# 生成方式：openssl rand -base64 32
AUTH_SECRET=nho+DEqVgA5eyyZNozaaEEZ/RUEJqUWRN5gkPdeJ5q0=

# ─── OpenAI API ────────────────────────────────────
# 用于生成歌曲（哼唱 → 旋律 → 歌曲）
MURMUR_CHAT_ENDPOINT=https://api.openai.com/v1/chat/completions
MURMUR_CHAT_API_KEY=sk-proj-xxxxx
MURMUR_CHAT_MODEL=gpt-4o-mini

# ─── 临时：跳过计费检查 ────────────────────────────
# TODO: 配置完数据库后，删除这个变量或设为 0
MURMUR_ALLOW_DEV_BILLING_FALLBACK=1
MURMUR_DEV_NOTES_BALANCE=9999
```

#### 🔧 可选配置

```bash
# ─── 存储（如果使用云存储）──────────────────────────
MURMUR_STORAGE_DRIVER=s3-compatible
MURMUR_STORAGE_S3_BUCKET=your-bucket
MURMUR_STORAGE_S3_REGION=auto
MURMUR_STORAGE_S3_ACCESS_KEY_ID=xxxxx
MURMUR_STORAGE_S3_SECRET_ACCESS_KEY=xxxxx
MURMUR_STORAGE_S3_ENDPOINT=https://xxxxx.r2.cloudflarestorage.com
MURMUR_STORAGE_S3_PUBLIC_URL_BASE=https://your-cdn.com
```

---

### 2️⃣ **Google Cloud Console 配置**

访问 [Google Cloud Console](https://console.cloud.google.com)

#### 📝 步骤：

1. **创建项目**（如果还没有）
   - 项目名称：`Murmur`
   
2. **启用 API**
   - APIs & Services → Library
   - 启用 "Google+ API" 或 "People API"

3. **配置 OAuth 同意屏幕**
   - APIs & Services → OAuth consent screen
   - User Type: **External**
   - App name: `Murmur`
   - User support email: 你的邮箱
   - Developer contact: 你的邮箱
   - Test users: 添加你的 Google 账号（开发测试用）

4. **创建 OAuth 客户端 ID**
   - APIs & Services → Credentials
   - Create Credentials → OAuth client ID
   - Application type: **Web application**
   - Name: `Murmur Web`
   
   **Authorized JavaScript origins**:
   ```
   http://localhost:3000
   https://murmur.ptoq.io
   ```
   
   **Authorized redirect URIs**:
   ```
   http://localhost:3000/api/auth/callback/google
   https://murmur.ptoq.io/api/auth/callback/google
   ```

5. **复制凭证**
   - Client ID → 复制到 Vercel `GOOGLE_CLIENT_ID`
   - Client Secret → 复制到 Vercel `GOOGLE_CLIENT_SECRET`

---

### 3️⃣ **数据库设置（Neon 或其他 Postgres）**

推荐使用 [Neon](https://neon.tech)（免费 Postgres）

#### 📝 步骤：

1. **创建 Neon 项目**
   - 访问 https://neon.tech
   - Create Project → `murmur`
   
2. **获取连接字符串**
   - Dashboard → Connection Details
   - 复制 `Connection string`
   - 格式：`postgresql://user:password@host/database`

3. **添加到 Vercel**
   - Vercel → Environment Variables
   - `DATABASE_URL` = 连接字符串

4. **运行数据库迁移**
   
   **方式 1：本地运行（推荐）**
   ```bash
   # 设置连接字符串
   DATABASE_URL="postgresql://user:password@host/database"
   
   # 运行迁移
   bun run db:migrate
   ```
   
   **方式 2：Vercel 构建钩子**
   - 在 `package.json` 添加：
     ```json
     {
       "scripts": {
         "vercel-build": "bun run db:migrate && next build"
       }
     }
     ```

---

### 4️⃣ **OpenAI API 配置**

访问 [OpenAI Platform](https://platform.openai.com)

#### 📝 步骤：

1. **创建 API Key**
   - API Keys → Create new secret key
   - 名称：`Murmur Production`
   
2. **复制 Key**
   - 格式：`sk-proj-xxxxx`
   - 添加到 Vercel `MURMUR_CHAT_API_KEY`

3. **选择模型**
   - 推荐：`gpt-4o-mini`（便宜快速）
   - 或：`gpt-4o`（更好质量）

---

## ✅ 配置完成后的验证步骤

### 1. **验证 Google 登录**
```bash
# 访问
https://murmur.ptoq.io

# 测试
1. 点击 "Continue with Google"
2. 选择 Google 账号
3. 应该跳转回首页，右上角显示 Google 头像
```

### 2. **验证余额系统**
```bash
# 访问
https://murmur.ptoq.io/me

# 检查
- 余额显示正常（不再是 "音磅账本暂时不可用"）
- Local Creator: 3 notes
- Google 用户: 10 notes
```

### 3. **验证完整流程**
```bash
1. 哼唱旋律 → 应该成功转录
2. 选择 Vibe → 应该正常进入
3. Studio 编辑 → 应该能保存
4. Gallery 查看 → 应该显示歌曲
```

---

## 🔧 配置完成后需要做的事

### 1. **移除临时跳过逻辑**

在 Vercel 环境变量中：
```bash
# 删除或设为 0
MURMUR_ALLOW_DEV_BILLING_FALLBACK=0
```

或者直接在代码中移除（更彻底）：

**文件**：`src/lib/billing/dev-balance.ts`

删除这段代码：
```typescript
// 删除这几行
if (process.env.MURMUR_ALLOW_DEV_BILLING_FALLBACK === "1") {
  return true;
}
```

### 2. **重新部署**
```bash
# 在 Vercel Dashboard 触发重新部署
# 或推送新的 commit
```

---

## 📊 环境变量优先级总结

| 变量 | 必需 | 用途 | 不配置的后果 |
|------|------|------|------------|
| `DATABASE_URL` | ✅ 是 | 用户数据、余额、歌曲存储 | 计费不可用，无法保存云端数据 |
| `GOOGLE_CLIENT_ID` | ✅ 是 | Google 登录 | 无法用 Google 登录 |
| `GOOGLE_CLIENT_SECRET` | ✅ 是 | Google 登录 | 无法用 Google 登录 |
| `AUTH_SECRET` | ✅ 是 | Session 加密 | Google 登录会失败 |
| `MURMUR_CHAT_API_KEY` | ✅ 是 | 生成歌曲 | 哼唱后无法生成歌曲 |
| `MURMUR_ALLOW_DEV_BILLING_FALLBACK` | ⚠️ 临时 | 跳过计费检查 | 配置数据库后删除 |
| `MURMUR_STORAGE_*` | ❌ 否 | 云存储（可选） | 使用默认存储 |

---

## 🎯 快速配置顺序（建议）

1. ✅ **Neon 数据库** → 5 分钟
2. ✅ **Vercel 添加 `DATABASE_URL`** → 1 分钟
3. ✅ **本地运行迁移** → 2 分钟
4. ✅ **Google Cloud Console OAuth** → 10 分钟
5. ✅ **Vercel 添加 Google 变量** → 2 分钟
6. ✅ **OpenAI API Key** → 3 分钟
7. ✅ **Vercel 添加 OpenAI 变量** → 1 分钟
8. ✅ **Vercel 重新部署** → 2 分钟
9. ✅ **测试完整流程** → 5 分钟
10. ✅ **移除 `MURMUR_ALLOW_DEV_BILLING_FALLBACK`** → 1 分钟

**总时间**：约 30 分钟

---

## 📞 需要帮助？

如果配置过程中遇到问题，检查：

1. **Vercel 部署日志** - 查看是否有错误
2. **浏览器控制台** - 查看前端错误
3. **数据库连接** - 确保连接字符串正确
4. **Google OAuth 回调 URL** - 确保完全匹配

---

完成！🎉
