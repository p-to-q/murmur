# Railway Audio Engine 手动配置步骤

## 当前 Railway 项目信息

**Project:** upbeat-integrity
**Project ID:** 05dc78c7-9ea8-4b8c-a30f-40fa179d0a73
**URL:** https://railway.com/project/05dc78c7-9ea8-4b8c-a30f-40fa179d0a73

**已部署服务：**
- ✅ PostgreSQL - 运行中
  - Public URL: `postgresql://postgres:thUllMrNKoNUrlstBqspXPciwFPLKdji@acela.proxy.rlwy.net:18838/railway`

## 需要添加 Audio Engine Service

### 步骤：

1. **访问项目页面**
   https://railway.com/project/05dc78c7-9ea8-4b8c-a30f-40fa179d0a73

2. **创建新 Service**
   - 点击 "+ New"
   - 选择 "GitHub Repo"
   - 选择仓库: `p-to-q/murmur`
   - Branch: `codex/repo-governance-closure`

3. **配置 Root Directory**
   - Settings → Service Settings
   - **Root Directory:** `workers/audio-engine`
   - 保存

4. **环境变量**
   - Variables 标签
   - 添加: `PORT=8001`

5. **生成公开域名**
   - Settings → Networking
   - 点击 "Generate Domain"
   - 记录 URL（例如: `https://audio-engine-production-xxx.up.railway.app`）

6. **验证部署**
   - 访问: `https://<your-domain>/docs`
   - 应该看到 FastAPI 文档

## 数据库迁移

从本地运行：

```bash
export DATABASE_URL="postgresql://postgres:thUllMrNKoNUrlstBqspXPciwFPLKdji@acela.proxy.rlwy.net:18838/railway"
bun run db:migrate
```

## 完成！

之后将这两个 URL 提供给前端配置：
- DATABASE_URL (PostgreSQL)
- AUDIO_ENGINE_URL (Audio Engine)
