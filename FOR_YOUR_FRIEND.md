# 给朋友的部署指令

## 你好！👋

这是 Murmur 项目的前端部署指南。后端已经准备好了，现在需要你在 Cloudflare Pages 上部署前端。

---

## 🎯 你的任务

**部署 Murmur 前端到 Cloudflare Pages，配置域名为 `murmur.ptoq.io`**

预计时间：**15-20 分钟**

---

## 📖 阅读顺序

### 第 1 步：快速了解（5 分钟）
阅读：**`START_HERE.md`**

这个文档告诉你：
- 项目概览
- 部署架构（Cloudflare + Railway）
- 你需要做什么

### 第 2 步：详细操作（10-15 分钟）
阅读并按照步骤操作：**`FRONTEND_DEPLOY_GUIDE.md`** ⭐ 最重要

这个文档包含：
- ✅ 完整的 Cloudflare Pages 配置步骤（一步一步）
- ✅ 所有需要的环境变量（已经填好大部分值）
- ✅ 域名 `murmur.ptoq.io` 配置方法
- ✅ 问题排查指南

### 第 3 步：完整指南（如需要）
参考：**`COMPLETE_DEPLOYMENT_GUIDE.md`**

这个文档包含：
- 前端 + 后端完整部署流程
- 架构设计原因和替代方案
- 成本分析

### 第 4 步：遇到问题时
参考 `FRONTEND_DEPLOY_GUIDE.md` 里的：
- "常见问题排查" 章节
- "故障排查" 章节

---

## 📝 前置条件

你需要有：
- ✅ Cloudflare 账户（管理 `ptoq.io` 域名的那个账户）
- ✅ GitHub 访问权限：`p-to-q/murmur` 仓库
- ✅ 从 Jiayi 那里获得 **Audio Engine URL**（他会给你）

---

## 🚀 快速流程

```
1. 登录 Cloudflare Dashboard
   ↓
2. 创建 Pages 项目
   ↓
3. 连接 GitHub 仓库 (p-to-q/murmur)
   ↓
4. 配置构建设置 (build command、output directory)
   ↓
5. 添加环境变量（所有变量都在文档里）
   ↓
6. 部署
   ↓
7. 配置自定义域名 (murmur.ptoq.io)
   ↓
8. 验证网站运行
```

**详细步骤请看 `FRONTEND_DEPLOY_GUIDE.md`**

---

## 🔑 关键信息速查

### 需要的环境变量（详细值见文档）

```bash
DATABASE_URL=postgresql://... (文档里有完整值)
AUDIO_ENGINE_URL=https://... (Jiayi 会给你)
NEXTAUTH_URL=https://murmur.ptoq.io
NEXTAUTH_SECRET=<用 openssl rand -base64 32 生成>
NEXT_PUBLIC_AUDIO_ENGINE_URL=https://... (同 AUDIO_ENGINE_URL)
NODE_VERSION=20
```

### 构建配置

```
Build command: bun install && bun run build
Build output directory: .next
Root directory: (留空)
```

### 域名

```
murmur.ptoq.io
```

---

## ✅ 验证清单

部署完成后，检查：
- [ ] 访问 `https://murmur.ptoq.io` 页面正常加载
- [ ] 可以注册用户
- [ ] 可以登录
- [ ] 可以访问所有页面（Home, Gallery, Studio, Me）

---

## 🆘 需要帮助？

1. 先查看 `FRONTEND_DEPLOY_GUIDE.md` 的"常见问题"章节
2. 查看 Cloudflare 构建日志
3. 联系 Jiayi

---

## 💡 给 AI 的 Prompt（如果你想用 AI 帮忙）

如果你想让 Claude 或其他 AI 帮你：

```
我需要在 Cloudflare Pages 上部署一个 Next.js 应用。

项目信息：
- GitHub 仓库：p-to-q/murmur
- 分支：codex/repo-governance-closure
- 目标域名：murmur.ptoq.io
- 我已经有 Cloudflare 账户，管理着 ptoq.io 域名

请帮我：
1. 阅读并理解 FRONTEND_DEPLOY_GUIDE.md 文档
2. 指导我一步一步完成 Cloudflare Pages 配置
3. 帮我理解需要配置的所有环境变量
4. 如果遇到错误，帮我排查问题

开始之前，请先读取 FRONTEND_DEPLOY_GUIDE.md 文件的内容。
```

---

## 📂 文档位置

所有文档在 GitHub 仓库根目录：
```
https://github.com/p-to-q/murmur/tree/codex/repo-governance-closure
```

或者如果 Jiayi 给你发了文件，直接在项目文件夹里找。

---

## 🎯 最重要的事

**只需要认真读并按照 `FRONTEND_DEPLOY_GUIDE.md` 操作就可以了！**

这个文档写得非常详细，包含：
- 每一步该点什么按钮
- 每个环境变量的值（大部分已经填好）
- 截图说明（如果需要的话）
- 常见错误和解决方法

如果看完文档还有疑问，随时联系 Jiayi。

---

**祝部署顺利！** 🚀

完成后，访问 https://murmur.ptoq.io 就能看到网站了！
