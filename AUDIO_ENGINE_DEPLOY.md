# 🚀 音频引擎部署指南（Railway）

## 📦 音频引擎位置
```
/Users/dujiayi/murmur/workers/audio-engine/
```

## ✅ 已配置
- ✅ Dockerfile
- ✅ requirements.txt
- ✅ railway.json
- ✅ 健康检查端点：`/health`

---

## 🚂 Railway 部署步骤

### 1. 安装 Railway CLI
```bash
# macOS
brew install railway

# 或使用 npm
npm install -g @railway/cli
```

### 2. 登录 Railway
```bash
railway login
```

### 3. 部署音频引擎
```bash
cd /Users/dujiayi/murmur/workers/audio-engine

# 初始化项目
railway init

# 部署
railway up

# 获取部署 URL
railway domain
```

### 4. 配置 Vercel 环境变量
获得 Railway URL 后（如 `https://murmur-audio.railway.app`），在 Vercel 添加：

```bash
AUDIO_WORKER_URL=https://murmur-audio.railway.app
AUDIO_WORKER_TOKEN=your-secret-token-here
```

**生成 Token：**
```bash
openssl rand -base64 32
```

### 5. 在 Railway 添加环境变量（可选）
如果音频引擎需要验证 token：
```bash
railway variables set WORKER_TOKEN=your-secret-token-here
```

---

## 🔐 安全配置（推荐）

### 生成并配置 Token

1. **生成 Token**
```bash
openssl rand -base64 32
# 输出示例：7xK9mP2nQ5vL8wR3jF6hS1dY4tE0uB9cA
```

2. **Railway 配置**
```bash
cd /Users/dujiayi/murmur/workers/audio-engine
railway variables set WORKER_TOKEN=7xK9mP2nQ5vL8wR3jF6hS1dY4tE0uB9cA
```

3. **Vercel 配置**
```
AUDIO_WORKER_TOKEN=7xK9mP2nQ5vL8wR3jF6hS1dY4tE0uB9cA
```

---

## 🌐 其他部署选项

### Fly.io
```bash
# 安装 flyctl
brew install flyctl

cd /Users/dujiayi/murmur/workers/audio-engine

# 登录
fly auth login

# 部署
fly launch
fly deploy

# 获取 URL
fly status
```

### Render
1. 访问 https://render.com
2. 连接 GitHub 仓库
3. 选择 `workers/audio-engine` 目录
4. 类型：Web Service
5. 构建命令：Docker
6. 部署

---

## ✅ 验证部署

### 1. 测试健康检查
```bash
curl https://your-audio-engine.railway.app/health
```

**预期响应：**
```json
{
  "status": "ok",
  "service": "murmur-audio-engine",
  "provider": "auto",
  "denoiseProvider": "auto"
}
```

### 2. 测试转录（需要音频文件）
```bash
curl -X POST https://your-audio-engine.railway.app/transcribe \
  -H "Authorization: Bearer your-token" \
  -F "audio=@test.webm" \
  -F "targetInstrument=piano"
```

---

## 🔧 Vercel 完整环境变量

部署音频引擎后，Vercel 需要以下环境变量：

```bash
# 数据库（可选，用于持久化）
DATABASE_URL=postgresql://user:password@host/database

# Google OAuth（可选，用于登录）
GOOGLE_CLIENT_ID=xxxxx.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-xxxxx
AUTH_SECRET=nho+DEqVgA5eyyZNozaaEEZ/RUEJqUWRN5gkPdeJ5q0=

# OpenAI（用于生成歌曲）
MURMUR_CHAT_ENDPOINT=https://api.openai.com/v1/chat/completions
MURMUR_CHAT_API_KEY=sk-proj-xxxxx
MURMUR_CHAT_MODEL=gpt-4o-mini

# 音频引擎（必需！）
AUDIO_WORKER_URL=https://murmur-audio.railway.app
AUDIO_WORKER_TOKEN=7xK9mP2nQ5vL8wR3jF6hS1dY4tE0uB9cA

# 临时跳过计费（可选）
MURMUR_ALLOW_DEV_BILLING_FALLBACK=1
```

---

## 📊 部署成本估算

### Railway（推荐）
- **免费额度**：500 小时/月
- **付费**：$5/月起
- **优点**：最简单，一键部署

### Fly.io
- **免费额度**：3 个小应用
- **付费**：按使用量
- **优点**：全球边缘网络，低延迟

### Render
- **免费额度**：750 小时/月
- **付费**：$7/月起
- **优点**：自动 SSL，简单配置

**建议：** 优先使用 Railway（最简单）

---

## 🎯 完整部署清单

### □ 音频引擎部署
- [ ] 安装 Railway CLI
- [ ] `railway login`
- [ ] `cd workers/audio-engine`
- [ ] `railway init`
- [ ] `railway up`
- [ ] 记录部署 URL

### □ 配置 Token
- [ ] 生成 Token：`openssl rand -base64 32`
- [ ] Railway 添加：`railway variables set WORKER_TOKEN=xxx`
- [ ] 记录 Token

### □ Vercel 配置
- [ ] 添加 `AUDIO_WORKER_URL`
- [ ] 添加 `AUDIO_WORKER_TOKEN`
- [ ] 添加其他必需环境变量（见上文）
- [ ] 触发重新部署

### □ 测试验证
- [ ] 访问 https://murmur.ptoq.io
- [ ] 点击麦克风
- [ ] 哼唱旋律
- [ ] 验证转录成功
- [ ] 完整流程测试

---

## 🚨 快速部署命令（全流程）

```bash
# 1. 安装 Railway CLI
brew install railway

# 2. 登录
railway login

# 3. 进入音频引擎目录
cd /Users/dujiayi/murmur/workers/audio-engine

# 4. 初始化并部署
railway init
railway up

# 5. 生成 Token
TOKEN=$(openssl rand -base64 32)
echo "Token: $TOKEN"

# 6. 配置 Railway
railway variables set WORKER_TOKEN=$TOKEN

# 7. 获取 URL
URL=$(railway domain)
echo "Audio Worker URL: https://$URL"

# 8. 测试健康检查
curl https://$URL/health

echo ""
echo "✅ 部署完成！"
echo ""
echo "现在在 Vercel 添加以下环境变量："
echo "AUDIO_WORKER_URL=https://$URL"
echo "AUDIO_WORKER_TOKEN=$TOKEN"
```

---

**下一步：运行上述命令，部署音频引擎！** 🚀
