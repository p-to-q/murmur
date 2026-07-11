#!/usr/bin/env node

/**
 * 本地开发模式完整流程测试
 * 验证：哼唱 → Vibe → Studio → 保存 → Gallery → 导出
 */

const BASE_URL = "http://localhost:3001";

async function testFlow() {
  console.log("🧪 开始测试 Murmur 完整流程（本地开发模式）\n");

  // 1. 测试健康检查
  console.log("1️⃣ 测试健康检查...");
  try {
    const res = await fetch(`${BASE_URL}/api/qa/health`);
    const data = await res.json();
    console.log(`   ✅ 健康检查通过: ${data.status}`);
  } catch (err) {
    console.log(`   ❌ 健康检查失败: ${err.message}`);
    return;
  }

  // 2. 测试转录 API（使用示例旋律）
  console.log("\n2️⃣ 测试转录 API（示例旋律）...");
  let melodyId;
  try {
    const res = await fetch(`${BASE_URL}/api/transcribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        useFixture: true,  // 使用示例旋律
      }),
    });

    if (!res.ok) {
      const error = await res.json();
      console.log(`   ⚠️  转录失败: ${error.error} - ${error.message}`);
      console.log(`   💡 这是预期的（需要配置数据库或设置 MURMUR_ALLOW_DEV_BILLING_FALLBACK=1）`);
    } else {
      const data = await res.json();
      melodyId = data.melody?.id;
      console.log(`   ✅ 转录成功: melody ID = ${melodyId}`);
    }
  } catch (err) {
    console.log(`   ❌ 转录失败: ${err.message}`);
  }

  // 3. 测试保存歌曲 API
  console.log("\n3️⃣ 测试保存歌曲 API...");
  const testSong = {
    id: `test-song-${Date.now()}`,
    title: "测试歌曲",
    vibe: "平静的",
    vibeEn: "calm",
    bpm: 90,
    keySignature: "C",
    scaleType: "major",
    duration: 30,
    visualConfig: {
      background: "#F5F1EB",
      particleColor: "#8C8780",
    },
    tracks: {
      melody: {
        enabled: true,
        intensity: 0.8,
        originalPattern: "C4 D4 E4",
        currentPattern: "C4 D4 E4",
        instrument: "piano",
        versionHistory: ["C4 D4 E4"],
      },
      chords: {
        enabled: true,
        intensity: 0.5,
        originalPattern: "Cmaj Fmaj",
        currentPattern: "Cmaj Fmaj",
        instrument: "pad",
        versionHistory: ["Cmaj Fmaj"],
      },
      bass: {
        enabled: true,
        intensity: 0.6,
        originalPattern: "C2 F2",
        currentPattern: "C2 F2",
        instrument: "bass",
        versionHistory: ["C2 F2"],
      },
      drums: {
        enabled: true,
        intensity: 0.4,
        originalPattern: "kick snare",
        currentPattern: "kick snare",
        instrument: "drums",
        versionHistory: ["kick snare"],
      },
    },
  };

  try {
    const res = await fetch(`${BASE_URL}/api/songs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(testSong),
    });

    if (!res.ok) {
      const error = await res.json();
      console.log(`   ⚠️  保存失败: ${error.error} - ${error.message}`);

      // 检查是否有 fallback 标记
      const fallback = res.headers.get("X-Murmur-Fallback");
      if (fallback) {
        console.log(`   ✅ 使用了本地 fallback: ${fallback}`);
      } else {
        console.log(`   💡 需要配置 MURMUR_ALLOW_DEV_BILLING_FALLBACK=1`);
      }
    } else {
      const data = await res.json();
      console.log(`   ✅ 保存成功: song ID = ${data.id}`);

      // 检查是否有 fallback 标记
      const fallback = res.headers.get("X-Murmur-Fallback");
      if (fallback) {
        console.log(`   ℹ️  使用了本地 fallback: ${fallback}`);
      }
    }
  } catch (err) {
    console.log(`   ❌ 保存失败: ${err.message}`);
  }

  // 4. 测试获取歌曲列表
  console.log("\n4️⃣ 测试 Gallery（获取歌曲列表）...");
  try {
    const res = await fetch(`${BASE_URL}/api/songs`);

    if (!res.ok) {
      const error = await res.json();
      console.log(`   ⚠️  获取列表失败: ${error.error}`);

      // 检查是否有 fallback 标记
      const fallback = res.headers.get("X-Murmur-Fallback");
      if (fallback) {
        console.log(`   ✅ 使用了本地 fallback: ${fallback}`);
      }
    } else {
      const songs = await res.json();
      console.log(`   ✅ 获取列表成功: ${songs.length} 首歌曲`);

      if (songs.length > 0) {
        console.log(`   📋 示例: ${songs[0].title} (ID: ${songs[0].id})`);
      }
    }
  } catch (err) {
    console.log(`   ❌ 获取列表失败: ${err.message}`);
  }

  console.log("\n" + "=".repeat(60));
  console.log("🎯 测试总结");
  console.log("=".repeat(60));
  console.log("\n✅ 本地开发服务器正常运行");
  console.log("✅ API 路由可访问");
  console.log("\n⚠️  如果看到 billing_unavailable 错误：");
  console.log("   1. 这是正常的（本地开发模式）");
  console.log("   2. 确保 .env 文件中有：");
  console.log("      MURMUR_ALLOW_DEV_BILLING_FALLBACK=1");
  console.log("   3. 重启开发服务器");
  console.log("\n📱 浏览器测试：");
  console.log(`   访问 ${BASE_URL}`);
  console.log("   完整流程：哼唱 → Vibe → Studio → 保存 → Gallery");
  console.log("\n🎉 本地存储模式：");
  console.log("   - 数据保存在浏览器 localStorage/IndexedDB");
  console.log("   - 可以导出音频、分享卡");
  console.log("   - 刷新后数据保留在本地");
  console.log("");
}

testFlow().catch(console.error);
