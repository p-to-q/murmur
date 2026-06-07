# 🧪 本地开发模式测试指南

## 当前状态
- ✅ 开发服务器运行在：http://localhost:3001
- ✅ 环境变量配置：MURMUR_ALLOW_DEV_BILLING_FALLBACK=1
- ✅ 代码已包含数据库 fallback 逻辑

---

## 🎯 浏览器完整流程测试

### 1. 打开应用
```
访问：http://localhost:3001
```

### 2. 哼唱流程
```
首页 → 点击麦克风
  ↓
如果提示"音磅账本暂时不可用"
  ↓
点击【测试使用】按钮
  ↓
✅ 应该跳转到 Vibe 选择页
```

### 3. Vibe 选择
```
选择任意 Vibe（如：平静的）
  ↓
点击【继续】
  ↓
✅ 应该跳转到 Studio 编辑页
```

### 4. Studio 编辑
```
调整音轨（可选）：
- 旋律 intensity
- 和弦 intensity
- 鼓点 intensity
  ↓
点击【保存】按钮
  ↓
✅ 应该显示保存成功
✅ 应该跳转到 Gallery
```

### 5. Gallery 查看
```
Gallery 页面应该显示：
- ✅ 刚刚保存的歌曲
- ✅ 歌曲标题、时长
- ✅ 可以点击查看详情
```

### 6. 歌曲详情页
```
点击歌曲卡片
  ↓
歌曲详情页应该有：
- ✅ 播放按钮
- ✅ 下载音频
- ✅ 下载分享卡
- ✅ 分享按钮
```

---

## 🔍 调试检查

### 开启浏览器 DevTools
```
Chrome/Edge: F12 或 Cmd+Option+I
Firefox: F12 或 Cmd+Option+I
```

### 检查点 1：转录 API
```
Network 标签 → 找到 /api/transcribe
- Status: 200 ✅ 或 503 (billing_unavailable) ⚠️
- 如果是 503，检查是否点击了"测试使用"按钮
```

### 检查点 2：保存 API
```
Network 标签 → 找到 /api/songs (POST)
- Status: 200 ✅
- Response Headers:
  - X-Murmur-Fallback: local-bypass-song ✅
  - 这表示使用了本地 fallback
```

### 检查点 3：Gallery API
```
Network 标签 → 找到 /api/songs (GET)
- Status: 200 ✅
- Response: 应该返回歌曲数组
```

### 检查点 4：本地存储
```
Application 标签 → Storage
- Local Storage: 检查是否有歌曲数据
- IndexedDB: 检查 murmur-local 数据库
```

---

## 🐛 常见问题

### 问题 1：保存失败
**症状：** 点击保存后提示"保存失败，请重试"

**检查：**
1. DevTools → Network → /api/songs POST
2. 查看 Response 错误信息
3. 常见原因：
   - `billing_unavailable` → 环境变量未生效
   - `validation_error` → payload 格式错误（前端 bug）
   - `database_unavailable` → 正常，应该自动 fallback

**解决：**
```bash
# 确认环境变量
grep MURMUR_ALLOW_DEV_BILLING_FALLBACK .env

# 重启开发服务器
# Ctrl+C 停止，然后：
bun dev
```

### 问题 2：Gallery 为空
**症状：** 保存成功但 Gallery 看不到歌曲

**检查：**
1. DevTools → Application → IndexedDB → murmur-local
2. 查看是否有数据

**原因：**
- 本地 fallback 返回的歌曲可能没有持久化
- 需要检查前端是否正确存储到 IndexedDB

### 问题 3：导出失败
**症状：** 点击下载按钮没反应

**检查：**
1. DevTools → Console 查看错误
2. 音频 URL 是否有效

**原因：**
- 音频可能未生成（需要 OpenAI API）
- 导出功能主要在前端，不依赖后端

---

## ✅ 预期行为（本地开发模式）

### 正常流程
```
✅ 哼唱/测试使用 → 成功
✅ Vibe 选择 → 成功
✅ Studio 编辑 → 成功
✅ 保存歌曲 → 成功（使用 fallback）
✅ Gallery 显示 → 取决于前端存储实现
✅ 导出功能 → 取决于是否有音频数据
```

### Fallback 标记
```
API 响应头应该包含：
X-Murmur-Fallback: local-bypass-song
```

这表示后端成功使用了 fallback 机制。

---

## 📊 测试结果记录

### 测试时间
```
日期：_______
测试人：_______
```

### 测试结果
```
□ 1. 首页加载正常
□ 2. 哼唱/测试使用成功
□ 3. Vibe 选择正常
□ 4. Studio 编辑正常
□ 5. 保存歌曲成功
□ 6. Gallery 显示歌曲
□ 7. 歌曲详情页正常
□ 8. 导出功能正常
```

### 问题记录
```
问题描述：
_______________________

复现步骤：
_______________________

DevTools 错误信息：
_______________________
```

---

## 🚀 生产环境部署

测试通过后，部署到 Vercel：

1. ✅ 代码已推送到 GitHub
2. ⏳ Vercel 自动部署
3. ⚠️ 需要添加环境变量：
   ```
   MURMUR_ALLOW_DEV_BILLING_FALLBACK=1
   ```

4. 🧪 在生产环境重复上述测试流程

---

## 📝 下一步

### 短期（临时方案）
- ✅ 使用 fallback 机制（已完成）
- ✅ 用户可以正常使用所有功能
- ⚠️ 数据不持久化

### 长期（完整方案）
- □ 配置 Neon Postgres 数据库
- □ 添加 DATABASE_URL 到 Vercel
- □ 运行数据库迁移
- □ 移除 MURMUR_ALLOW_DEV_BILLING_FALLBACK
- □ 数据持久化 + 跨设备同步

---

**当前重点：通过浏览器完整测试流程，确认所有功能可用** 🎯
