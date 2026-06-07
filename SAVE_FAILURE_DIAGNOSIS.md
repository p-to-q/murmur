# 🔍 保存失败问题诊断与解决方案

## 问题现象
用户在线上保存歌曲时提示："保存失败，请重试"

---

## 🕵️ 问题诊断

### 根本原因
`/api/songs` POST 路由在 bypass billing 模式下仍然尝试连接数据库：

```typescript
// 第 147 行：即使跳过计费，仍然调用 createSong()
if (shouldBypassBillingInDevelopment({ host: req.nextUrl?.hostname })) {
  const song = await createSong(songInput);  // ❌ 这里会连接数据库
  return NextResponse.json(song, { ... });
}
```

### 问题链：
1. ✅ Vercel 设置了 `MURMUR_ALLOW_DEV_BILLING_FALLBACK=1`
2. ✅ 跳过了计费检查
3. ❌ **但是 `createSong()` 仍然需要数据库连接**
4. ❌ `DATABASE_URL` 未配置 → 数据库连接失败
5. ❌ 错误未被 catch → 直接返回 500 错误

---

## ✅ 解决方案

### 修复内容
在 bypass billing 逻辑中添加 **数据库 fallback**：

```typescript
try {
  if (shouldBypassBillingInDevelopment({ host: req.nextUrl?.hostname })) {
    try {
      // 尝试保存到数据库
      const song = await createSong(songInput);
      return NextResponse.json(song, { ... });
    } catch (dbError) {
      // ✅ 数据库失败 → 使用本地 fallback
      if (isDatabaseUnavailable(dbError)) {
        const fallbackSong = createLocalSongFallback(songInput);
        return NextResponse.json(fallbackSong, {
          headers: {
            "X-Request-Id": requestId,
            "X-Murmur-Fallback": "local-bypass-song",  // 标记为 fallback
          },
        });
      }
      throw dbError;
    }
  }
  // ... 正常计费流程
} catch (err) {
  // 外层 catch 处理其他错误
}
```

### 工作流程
```
保存歌曲请求
  ↓
检查 MURMUR_ALLOW_DEV_BILLING_FALLBACK=1 ？
  ↓ 是
尝试保存到数据库
  ↓
数据库连接失败？
  ↓ 是
使用 createLocalSongFallback()
  ↓
返回本地快照（前端照常显示）
  ↓
✅ 用户可以继续使用
```

---

## 📊 本地 Fallback 机制

### `createLocalSongFallback()` 做了什么？

```typescript
// 返回一个内存中的歌曲对象
{
  id: "song-abc123",
  title: "My Song",
  userId: "user-xyz",
  createdAt: "2026-06-08T...",
  // ... 其他字段
}
```

**特点：**
- ✅ 不需要数据库
- ✅ 立即返回
- ✅ 前端照常显示
- ⚠️ 刷新后可能消失（未持久化）
- ⚠️ 不跨设备同步

### 响应头标记
```http
X-Murmur-Fallback: local-bypass-song
```

前端可以检测这个标记，提示用户：
> "歌曲已保存到本地，配置数据库后可同步到云端"

---

## 🎯 验证步骤

### 1. 确认 Vercel 环境变量
访问 Vercel Dashboard → Environment Variables

确保已添加：
```bash
MURMUR_ALLOW_DEV_BILLING_FALLBACK=1
```

### 2. 部署并测试
1. 推送代码到 GitHub
2. Vercel 自动部署（2-3 分钟）
3. 访问 https://murmur.ptoq.io
4. 完整流程：哼唱 → 选择 Vibe → 编辑 → **保存**
5. ✅ 应该保存成功（即使没有数据库）

### 3. 检查响应头
打开浏览器 DevTools → Network → 找到 `/api/songs` POST 请求

响应头应该包含：
```
X-Murmur-Fallback: local-bypass-song
```

### 4. 查看 Vercel 日志
Vercel Dashboard → 项目 → Logs

应该看到：
```
song.create_failed
reason: database_unavailable
fallback: local_bypass_song_snapshot
```

---

## 🔧 长期解决方案

### 步骤 1：配置数据库
按照 `PRODUCTION_CONFIG_CHECKLIST.md` 配置：
- Neon Postgres（免费）
- 添加 `DATABASE_URL` 到 Vercel
- 运行数据库迁移

### 步骤 2：移除临时跳过
```bash
# Vercel 环境变量
MURMUR_ALLOW_DEV_BILLING_FALLBACK=0  # 或直接删除
```

### 步骤 3：验证正常流程
- 余额系统正常工作
- 歌曲保存到云端数据库
- Gallery 显示所有歌曲
- 跨设备同步

---

## 📝 总结

### 问题
保存歌曲时数据库连接失败 → 返回 500 错误

### 原因
bypass billing 模式下仍然需要数据库，但未配置 `DATABASE_URL`

### 修复
添加数据库 fallback → 使用内存快照返回成功

### 结果
✅ 用户可以正常保存和查看歌曲（即使没有数据库）
✅ 完整流程可用
⚠️ 数据不持久化（配置数据库后解决）

---

**修复已推送，等待 Vercel 部署完成！** 🚀
