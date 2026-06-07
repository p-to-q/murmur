# Railway Audio Engine 添加步骤（图文指南）

## 🌐 在浏览器中操作（5分钟）

### 第1步：打开 Railway 项目

访问：https://railway.com/project/05dc78c7-9ea8-4b8c-a30f-40fa179d0a73

### 第2步：添加新 Service

1. 点击页面右上角的 **"+ New"** 按钮
2. 在弹出菜单中选择 **"GitHub Repo"**

### 第3步：连接仓库

1. 选择仓库：**p-to-q/murmur**
2. 选择分支：**codex/repo-governance-closure**
3. 点击 **"Add Service"** 或 **"Deploy"**

### 第4步：配置 Service 名称（可选）

部署开始后，你可以：
1. 点击新创建的 service
2. 进入 **"Settings"** 标签
3. 修改 Service Name 为：**audio-engine**

### 第5步：设置 Root Directory ⚠️ 重要！

1. 在 Settings 页面，找到 **"Source"** 部分
2. 找到 **"Root Directory"** 字段
3. 输入：**workers/audio-engine**
4. 点击 **"Update"** 或保存

### 第6步：添加环境变量

1. 切换到 **"Variables"** 标签
2. 点击 **"+ New Variable"**
3. Variable name: **PORT**
4. Value: **8001**
5. 点击 **"Add"**

### 第7步：等待部署完成

1. 切换到 **"Deployments"** 标签
2. 等待状态变为 **"Success"**（约 3-5 分钟）
3. 如果失败，查看日志找原因

### 第8步：生成公开域名

1. 回到 **"Settings"** 标签
2. 找到 **"Networking"** 部分
3. 点击 **"Generate Domain"**
4. **复制生成的 URL**（例如：`https://audio-engine-production-abc123.up.railway.app`）

### 第9步：验证部署

1. 打开新标签页
2. 访问：`https://<你的域名>/docs`
3. 应该看到 **FastAPI 自动文档页面**
4. 页面显示所有 API 端点

---

## ✅ 完成！

**你的 Audio Engine URL：** `https://[复制你的域名]`

把这个 URL 发给你的朋友，他需要配置在环境变量里。

---

## 🆘 常见问题

### Q: 部署失败，显示错误

**可能原因：**
- Root Directory 没设置正确
- Dockerfile 找不到

**解决方法：**
1. 检查 Root Directory 是否为 `workers/audio-engine`
2. 查看部署日志的详细错误信息
3. 确认分支是 `codex/repo-governance-closure`

### Q: /docs 页面 404

**可能原因：**
- 部署还没完成
- 服务启动失败

**解决方法：**
1. 检查 Deployments 标签，确认状态是 "Success"
2. 查看日志，看是否有启动错误
3. 确认 PORT=8001 环境变量已添加

### Q: 生成域名按钮找不到

**位置：**
Settings → 下滑到 Networking 部分 → Generate Domain

---

## 📋 配置总结

- **Service Name:** audio-engine
- **Root Directory:** workers/audio-engine
- **Environment Variables:**
  - PORT=8001
- **Public Domain:** 已生成 ✅
- **验证 URL:** https://<domain>/docs

---

操作完成后，回来告诉我你的 Audio Engine URL，我帮你更新文档！
