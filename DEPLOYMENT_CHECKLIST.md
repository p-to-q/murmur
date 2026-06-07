# ✅ Murmur 生产环境完整部署检查清单

**目标：** 确保 https://murmur.ptoq.io 上用户可以完整使用所有功能

---

## 🎯 核心功能要求

用户应该能够：
1. ✅ 真实录音（哼唱旋律）
2. ✅ 选择 Vibe
3. ✅ Studio 编辑
4. ✅ 保存歌曲
5. ✅ Gallery 查看
6. ✅ 导出/分享

---

## 📋 部署步骤总览

### 阶段 1：音频引擎部署 🎤
**状态：** ⏳ 待完成  
**优先级：** 🔴 最高（用户无法录音）

### 阶段 2：Vercel 环境变量配置 ⚙️
**状态：** ⏳ 待完成  
**优先级：** 🔴 最高

### 阶段 3：数据库配置（可选）💾
**状态：** ⚠️ 可延后  
**优先级：** 🟡 中（使用 fallback）

---

## 🚀 阶段 1：音频引擎部署

### 步骤 1.1：安装 Railway CLI
```bash
brew install railway
```

### 步骤 1.2：登录 Railway
```bash
railway login
```

### 步骤 1.3：部署音频引擎
```bash
cd /Users/dujiayi/murmur/workers/audio-engine
railway init
railway up
```

### 步骤 1.4：获取部署 URL
```bash
railway domain
# 记录输出，例如：murmur-audio-production.up.railway.app
```

### 步骤 1.5：生成 Token
```bash
openssl rand -base64 32
# 记录输出，例如：7xK9mP2nQ5vL8wR3jF6hS1dY4tE0uB9cA
```

### 步骤 1.6：配置 Railway Token（可选）
```bash
railway variables set WORKER_TOKEN=7xK9mP2nQ5vL8wR3jF6hS1dY4tE0uB9cA
```

### 步骤 1.7：测试健康检查
```bash
curl https://murmur-audio-production.up.railway.app/health
```

**预期输出：**
```json
{
  "status": "ok",
  "service": "murmur-audio-engine",
  "provider": "auto",
  "denoiseProvider": "auto"
}
```

✅ **完成标记：** 健康检查返回 200 OK

---

## ⚙️ 阶段 2：Vercel 环境变量配置

访问：[Vercel Dashboard](https://vercel.com) → 你的项目 → Settings → Environment Variables

### 必需变量（音频引擎）

#### AUDIO_WORKER_URL
```
值：https://murmur-audio-production.up.railway.app
环境：Production, Preview, Development
```

#### AUDIO_WORKER_TOKEN
```
值：7xK9mP2nQ5vL8wR3jF6hS1dY4tE0uB9cA
环境：Production, Preview, Development
```

#### MURMUR_ALLOW_DEV_BILLING_FALLBACK
```
值：1
环境：Production, Preview, Development
说明：临时跳过计费检查，允许使用 fallback
```

### 可选变量（增强功能）

#### OpenAI API（用于 AI 编辑建议）
```
MURMUR_CHAT_ENDPOINT=https://api.openai.com/v1/chat/completions
MURMUR_CHAT_API_KEY=sk-proj-xxxxx
MURMUR_CHAT_MODEL=gpt-4o-mini
```

#### Google OAuth（用于云端登录）
```
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
AUTH_SECRET=nho+DEqVgA5eyyZNozaaEEZ/RUEJqUWRN5gkPdeJ5q0=
```

#### 数据库（用于持久化）
```
DATABASE_URL=postgresql://user:password@host/database
```

### 步骤 2.1：添加环境变量
在 Vercel Dashboard 中逐一添加上述必需变量

### 步骤 2.2：触发重新部署
添加完环境变量后，Vercel 会自动重新部署

### 步骤 2.3：等待部署完成
查看 Deployments 标签，等待状态变为 "Ready"（约 2-3 分钟）

✅ **完成标记：** Vercel 部署状态为 "Ready"

---

## 🧪 阶段 3：生产环境测试

### 测试 3.1：访问首页
```
访问：https://murmur.ptoq.io
预期：首页正常加载，显示麦克风图标
```

### 测试 3.2：真实录音
```
1. 点击麦克风图标
2. 允许麦克风权限
3. 哼唱旋律（3-10秒）
4. 点击停止

预期：
- ✅ 音频上传成功
- ✅ 转录成功
- ✅ 跳转到 Vibe 选择页
```

**如果失败：**
- 检查浏览器 DevTools → Network
- 查找 `/api/transcribe` 请求
- 查看错误信息
- 确认 AUDIO_WORKER_URL 配置正确

### 测试 3.3：Vibe 选择
```
1. 选择任意 Vibe（如：平静的）
2. 点击继续

预期：
- ✅ 跳转到 Studio 编辑页
```

### 测试 3.4：Studio 编辑
```
1. 调整音轨（可选）
2. 点击保存按钮

预期：
- ✅ 保存成功
- ✅ 跳转到 Gallery
```

**如果失败：**
- 检查 DevTools → Network → `/api/songs` POST
- 查看响应头：应有 `X-Murmur-Fallback: local-bypass-song`
- 确认 MURMUR_ALLOW_DEV_BILLING_FALLBACK=1

### 测试 3.5：Gallery 查看
```
预期：
- ✅ 显示刚保存的歌曲
- ✅ 显示歌曲标题、时长
```

### 测试 3.6：歌曲详情和导出
```
1. 点击歌曲卡片
2. 查看歌曲详情页
3. 测试播放
4. 测试下载/分享

预期：
- ✅ 详情页正常显示
- ✅ 可以播放音频
- ✅ 可以下载/分享
```

✅ **完成标记：** 完整流程测试通过

---

## 📊 部署状态表

| 组件 | 状态 | 优先级 | 说明 |
|------|------|--------|------|
| 音频引擎 | ⏳ 待部署 | 🔴 最高 | Railway 部署 |
| Vercel 环境变量 | ⏳ 待配置 | 🔴 最高 | 3个必需变量 |
| 真实录音 | ⏳ 待测试 | 🔴 最高 | 依赖音频引擎 |
| 保存功能 | ✅ 可用 | 🟢 已完成 | Fallback 机制 |
| Gallery | ✅ 可用 | 🟢 已完成 | 前端实现 |
| 导出/分享 | ✅ 可用 | 🟢 已完成 | 前端实现 |
| 数据库 | ⚠️ 未配置 | 🟡 中 | 使用 fallback |
| Google OAuth | ⚠️ 未配置 | 🟡 中 | 可选功能 |
| OpenAI API | ⚠️ 未配置 | 🟡 中 | AI 编辑功能 |

---

## 🎯 最小可用版本（MVP）

**只需完成以下 2 个阶段：**

1. ✅ 阶段 1：部署音频引擎
2. ✅ 阶段 2：配置 Vercel 环境变量（3个必需）

**用户即可：**
- ✅ 真实录音
- ✅ 完整流程
- ✅ 保存和查看歌曲
- ✅ 导出/分享

**限制：**
- ⚠️ 数据不持久化（刷新后可能消失）
- ⚠️ 无 Google 登录
- ⚠️ 无 AI 编辑建议

---

## 🔧 故障排查

### 问题 1：录音后提示"转录失败"
**检查：**
```bash
# 测试音频引擎
curl https://your-railway-url/health

# 检查 Vercel 环境变量
# AUDIO_WORKER_URL 是否正确
```

### 问题 2：保存失败
**检查：**
```bash
# 确认环境变量
MURMUR_ALLOW_DEV_BILLING_FALLBACK=1
```

### 问题 3：Vercel 部署失败
**检查：**
- Vercel Dashboard → Deployments → Logs
- 查看错误信息

---

## 📞 支持文档

- **AUDIO_ENGINE_DEPLOY.md** - 详细部署步骤
- **AUDIO_ENGINE_STATUS.md** - 音频引擎状态说明
- **PRODUCTION_CONFIG_CHECKLIST.md** - 完整配置清单
- **SAVE_FAILURE_DIAGNOSIS.md** - 保存失败诊断
- **LOCAL_TESTING_GUIDE.md** - 本地测试指南

---

## ✅ 快速执行

```bash
# 1. 部署音频引擎
cd /Users/dujiayi/murmur/workers/audio-engine
railway login
railway init
railway up
railway domain  # 记录 URL

# 2. 生成 Token
openssl rand -base64 32  # 记录 Token

# 3. 配置 Railway（可选）
railway variables set WORKER_TOKEN=your-token

# 4. 前往 Vercel 添加环境变量
# AUDIO_WORKER_URL=https://xxx.railway.app
# AUDIO_WORKER_TOKEN=your-token
# MURMUR_ALLOW_DEV_BILLING_FALLBACK=1

# 5. 等待 Vercel 重新部署

# 6. 测试
open https://murmur.ptoq.io
```

---

**预计完成时间：** 15-30 分钟  
**部署后即可上线！** 🚀
