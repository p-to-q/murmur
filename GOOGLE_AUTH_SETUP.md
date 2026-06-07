# Google OAuth 设置指南

## 📝 获取 Google OAuth 凭证

### 1. 创建 Google Cloud 项目

1. 访问 [Google Cloud Console](https://console.cloud.google.com/)
2. 点击 "Select a project" → "New Project"
3. 项目名称：`Murmur` (或任意名称)
4. 点击 "Create"

### 2. 启用 OAuth API

1. 在左侧菜单选择 **APIs & Services** → **Library**
2. 搜索 "Google+ API" 或 "People API"
3. 点击 **Enable**

### 3. 配置 OAuth 同意屏幕

1. 左侧菜单选择 **APIs & Services** → **OAuth consent screen**
2. 选择 **External** (外部)
3. 点击 **Create**
4. 填写信息：
   - App name: `Murmur`
   - User support email: 你的邮箱
   - Developer contact: 你的邮箱
5. 点击 **Save and Continue**
6. Scopes: 直接点 **Save and Continue** (使用默认)
7. Test users: 添加你的 Google 账号邮箱
8. 点击 **Save and Continue**

### 4. 创建 OAuth 2.0 客户端 ID

1. 左侧菜单选择 **APIs & Services** → **Credentials**
2. 点击 **Create Credentials** → **OAuth client ID**
3. Application type: **Web application**
4. Name: `Murmur Web`
5. **Authorized JavaScript origins**:
   ```
   http://localhost:3000
   https://murmur.ptoq.io
   ```
6. **Authorized redirect URIs**:
   ```
   http://localhost:3000/api/auth/callback/google
   https://murmur.ptoq.io/api/auth/callback/google
   ```
7. 点击 **Create**
8. 复制 **Client ID** 和 **Client Secret**

---

## 🔧 配置本地环境

在项目根目录创建或更新 `.env` 文件：

```bash
# Google OAuth
GOOGLE_CLIENT_ID=your-client-id-here.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your-client-secret-here
AUTH_SECRET=nho+DEqVgA5eyyZNozaaEEZ/RUEJqUWRN5gkPdeJ5q0=

# Database (本地开发)
DATABASE_URL=postgresql://postgres:password@localhost:5432/myapp

# Other existing vars...
MURMUR_ALLOW_DEV_BILLING_FALLBACK=1
MURMUR_DEV_NOTES_BALANCE=9999
```

---

## 🗄️ 运行数据库迁移

```bash
# 启动本地数据库
bun run db:up

# 运行迁移
bun run db:migrate
```

---

## 🚀 启动开发服务器

```bash
bun dev
```

访问 http://localhost:3000

---

## ✅ 测试 Google 登录

### 1. 默认状态（Local Creator）
- 访问首页
- 右上角应该显示 "Google 登录" 和 "Local Creator" 两个按钮
- 点击 "Local Creator" 可以直接使用本地账户

### 2. Google 登录
- 点击 "Continue with Google" 按钮
- 选择你的 Google 账号
- 授权后应该跳转回首页
- 右上角显示你的 Google 头像和名字

### 3. 查看账户信息
- 点击右上角头像
- 下拉菜单显示：
  - 头像和名字
  - Songs 数量
  - Account: Google (或 Local Creator)
  - User ID
  - Sign out 按钮

### 4. 测试完整流程
1. ✅ 哼唱一段旋律
2. ✅ 选择 Vibe
3. ✅ 编辑 Studio
4. ✅ 保存到 Gallery
5. ✅ 分享歌曲

### 5. 登出
- 点击 "Sign out"
- 应该回到 Local Creator 状态

---

## 🌐 Vercel 部署配置

在 Vercel Dashboard → Settings → Environment Variables 添加：

```
GOOGLE_CLIENT_ID=your-production-client-id
GOOGLE_CLIENT_SECRET=your-production-client-secret
AUTH_SECRET=generate-a-new-one-with-openssl-rand-base64-32
```

确保 Google Cloud Console 中的 Authorized redirect URIs 包含：
```
https://murmur.ptoq.io/api/auth/callback/google
```

---

## 🐛 常见问题

### "Error 400: redirect_uri_mismatch"
- 检查 Google Cloud Console 中的 Authorized redirect URIs
- 确保 URL 完全匹配（包括 http/https）

### "Access blocked: This app's request is invalid"
- 需要在 OAuth consent screen 添加你的邮箱为 Test user
- 或者将应用发布为 Production（但需要 Google 审核）

### 数据库连接失败
- 确保 Postgres 容器正在运行：`docker ps`
- 运行 `bun run db:up` 启动数据库
- 检查 DATABASE_URL 配置

---

## 📊 数据库表结构

### users
存储所有用户（Local Creator 和 Google 用户）

### external_identities
存储 OAuth 关联（Google、Apple 等）

### sessions
存储登录会话

---

完成！🎉
