# MURMUR — Product Video 完整分镜脚本 v2

> "That melody in your head — let it out."

---

## -1. 转场系统 & 锚定元素策略

> 参考：Leonardo Dalessandri《Watchtower of Turkey》——280 个镜头通过 match cut 创造无缝视觉流。  
> 核心法则：**每个剪辑点都需要一个共享元素**（颜色、形状、运动方向、亮度区域位置），让眼睛的注意力跨越剪辑点而不中断。

### 锚定元素策略（AI 生成时的空间约定）

由于每个镜头独立 AI 生成，无法保证自然匹配。解决方案：**在每对相邻镜头的 prompt 中，指定一个"锚定元素"——某个视觉要素在画面中的固定位置和色彩**，使得后期剪辑时可以利用这个共享锚点做平滑过渡。

具体操作：
1. 每个 prompt 末尾添加 `[ANCHOR]` 标注——描述该镜头中锚定元素的画面位置（用九宫格标记：TL/TC/TR/ML/MC/MR/BL/BC/BR）和主色
2. 相邻镜头共享同一位置区域的同色系元素
3. 后期剪辑时用 1-3 帧的交叉淡化 + 锚定元素的位置对齐，实现接近 match cut 的效果

### 逐帧转场地图

| 转场点 | 从 → 到 | 匹配类型 | 共享元素 | 锚定位置 |
|--------|---------|---------|---------|---------|
| 01→02 | 水壶→鸟瞰街道 | **形状匹配** | 圆形（水壶口的俯视 → 十字路口的俯视圆弧）| MC |
| 02→03 | 鸟瞰街道→窗边人 | **颜色匹配** | 琥珀色（人群中的外套 → 桌上的茶杯）| MR→ML |
| 03→04 | 窗边人→文字墙 | **质感匹配** | 暖灰表面（桌面木纹 → 水泥墙纹理）| 全画面 |
| 04→05A | 文字墙→便利店 | **亮度匹配** | 暗底+暖光点（墙面暗处 → 夜色中便利店暖光）| MC |
| 05A→05B | 便利店→公路 | **光源位置** | 画面右侧暖光源（便利店内光 → 落日）| MR |
| 05B→05C | 公路→雨窗 | **玻璃介质** | 透过玻璃看（挡风玻璃 → 窗玻璃雨滴）| 全画面 |
| 05C→05D | 雨窗→天台 | **运动方向** | 向上（手指在玻璃上向上划 → 仰视角度的天空）| TC |
| 05D→06 | 天台→花开 | **中心辐射** | 画面中央的静态主体（人的背影 → 花蕾），背景从天空→纯黑 | MC |
| 06→07A | 花开→钢琴 | **形状匹配** | 展开/分离（花瓣打开 → 手指从琴键离开）| MC |
| 07A→07B | 钢琴→地铁 | **线条匹配** | 水平平行线（黑白琴键条纹 → 地铁座椅/扶手平行线）| 全画面 |
| 07B→07C | 地铁→布料 | **波动匹配** | 荧光灯闪烁节奏 → 布料波动节奏，相同频率 | MC |
| 07C→07D | 布料→桌面 | **俯视角度** | 都是俯拍平面，从抽象→具象 | 全画面 |
| 07D→08 | 桌面→人脸 | **暖色集中** | 桌面琥珀色调 → 脸部金色侧光 | MC偏左 |
| 08→09 | 人脸→动效 | **色温延续** | 金色侧光 → 动效线条从灰变金 | MC |
| 09→10 | 动效卡片→两人 | **矩形匹配** | 卡片矩形 → 手机矩形（同一位置、同一比例）| MC |
| 10→11A | 两人→静物 | **物件传递** | 耳机（Scene 10 人戴着 → 11A 放在桌上）| MC |
| 11A→11B | 静物→品牌 | **色调融化** | 桌面暖灰 → #F5F1EB 品牌色，交叉淡化 | 全画面 |

### 文化隐喻 & 名画线索（给懂的人看的彩蛋）

| 场景 | 隐藏引用 | 谁能认出 | 作用 |
|------|---------|---------|------|
| 01 水壶 | **物派（Mono-ha）**——日本 70 年代艺术运动，强调"物的存在感"。水壶不是道具，是主角 | 当代艺术爱好者 | 第一帧就声明："我们的审美不在消费品层面" |
| 02 鸟瞰 | **Andreas Gursky** 的大尺幅摄影——从上帝视角看人类活动的图案化 | 摄影/艺术圈 | 暗示：个体的旋律在宏观视角下是某种更大 pattern 的一部分 |
| 03 窗边人 | **Edward Hopper《Morning Sun》(1952)**——一个人坐在床边看窗外的光 | 广泛认知 | 孤独但不悲伤，Hopper 式的"有光的孤独" |
| 04 墙面文字 | **Jenny Holzer** 的"Truisms"系列——在公共空间写短句的概念艺术 | 当代艺术圈 | "Everyone hums." 像一条 Holzer 式的匿名真理 |
| 05A 便利店 | **Edward Hopper《Nighthawks》(1942)** | 广泛认知 | 已在 prompt 中明确引用，通过玻璃看的经典构图 |
| 05B 公路 | **David Lynch《Lost Highway》(1997)** | 电影爱好者 | 公路+仪表盘+黄昏 = Lynch 式的美国公路冥想 |
| 05C 雨窗 | **安德烈·塔可夫斯基《潜行者》(1979)** 中水与玻璃的母题 | 电影迷 | 水在塔可夫斯基的电影里永远是意识的隐喻 |
| 05D 天台 | **Caspar David Friedrich《雾海上的旅人》(1818)** | 广泛认知 | 浪漫主义最著名的构图——背对观众、面朝广阔。直接的致敬，但用现代都市天台替代了阿尔卑斯山 |
| 06 花开 | **Georgia O'Keeffe** 的花卉绘画——微距、中心对称、暗示内在生命力 | 艺术爱好者 | 花 = 旋律从内部展开 |
| 07A 钢琴 | **Michael Kenna** 的极简黑白摄影——物件在光线中的存在感 | 摄影圈 | 钢琴不是乐器，是一个有光的物体 |
| 07B 地铁 | **Stanley Kubrick《2001太空漫游》(1968)** 的走廊一点透视 | 广泛认知 | 日常空间 + 库布里克式几何 = "地铁也是宇宙" |
| 07D 桌面 | **Dutch Golden Age 静物画（vanitas）**——Pieter Claesz 等 | 美术史爱好者 | Vanitas = 时间流逝的静物。桌面上的残茶、干花瓣都是"已经发生过的事"的证据 |
| 08 人脸 | **伦勃朗（Rembrandt）** 的肖像画光法 | 广泛认知 | 已在 prompt 中明确使用 Rembrandt lighting |
| 09C 卡片 | 卡片内出现 **Whistler《黑与金的夜曲》** | 美术爱好者 | 这幅画本身就是"对音乐概念在视觉上的挪用"——Whistler 把画命名为"夜曲"（Nocturne），用音乐术语定义视觉作品。完美呼应 Murmur 的产品逻辑 |

---

## 0. Creative Brief

**片名**：*Murmur*（同品牌名）
**时长**：58 秒
**语言**：英文（极少文字，画面主导）
**目标受众**：中国 25-35 岁，有审美感知但未被系统训练的用户
**投放**：小红书、Bilibili、Instagram Reels、官网首屏
**核心信息**：你脑袋里的旋律，值得存在。
**制作方式**：100% AI 生成画面 + 自制代码动效（产品段落）

### 一句话定位

58 秒情绪蒙太奇。不同时空里人在哼歌的碎片，在音乐牵引下汇聚、凝固成一个可以收藏的小物件。看完后的感受是"我脑袋里好像也有一首歌"。

---

## 1. Style Bible — 视觉一致性系统

### 1.1 全局风格锚（Style Block）

**以下文本作为每一条 AI 视频提示词的固定后缀**，锁定跨镜头一致性：

```
[STYLE BLOCK]:
Cinematic photorealistic, Kodak Vision3 250D film stock, warm 
highlight roll-off into soft amber, shadows retain detail with 
muted teal-gray undertone. Subtle organic film grain visible on 
skin and flat surfaces — not digital noise, analog texture. 
Shallow depth of field f/1.8, foreground and background naturally 
separate into bokeh layers. Color palette globally muted with 
selective warm accents (amber, honey, aged brass). Skin tones 
natural and untouched — slight imperfections visible. 16:9 aspect 
ratio. No text, no watermark, no UI, no logos. Lighting motivated 
by practical sources within the scene (lamps, windows, screens, 
streetlights) — no unmotivated studio lighting. Atmosphere 
includes subtle environmental particles (dust in light beams, 
moisture in air, steam). Overall mood: the quiet weight of an 
unspoken melody.
```

**为什么这样写**：
- 指定胶片型号（Vision3 250D）比写"film look"精确 10 倍——AI 会模拟该胶片的具体高光滚降曲线和色彩响应
- 不写导演名（避免 AI 只抄一个人的画面模式），而是用具体的技术参数描述我们要的效果
- 明确"motivated lighting"（场景内光源驱动）防止 AI 默认加无来源的均匀打光
- 写"analog texture, not digital noise"——这是区分"高级胶片感"和"廉价滤镜"的关键
- 环境微粒（灰尘、湿气、蒸汽）给 AI 一个"弄脏画面"的许可，避免"AI 生成的塑料般新鲜感"

### 1.2 Prompt 结构方法论

每个镜头的提示词遵循以下 **7 层结构**，缺一层则补上：

```
[1. 镜头语言] 具体镜头类型 + 焦距 + 运镜方式 + 速度
[2. 构图法则] 对称/三分法/前景遮挡/几何/留白比例
[3. 主体与状态] 谁/什么 + 正在做什么 + 身体语言的中间态（非起点非终点）
[4. 细节与质感] 具体到可触摸的物理细节（材质、光泽、磨损、湿度）
[5. 环境与光线] 时间、空间、光源方向、光质（硬/软/散射）、空气中可见的微粒
[6. 色温与情绪] 高光色/阴影色/情绪关键词——不写抽象感受，写感官体验
[7. 反向约束] --no 列表：排除 AI 默认会加的东西
```

**关键方法论原则**（融合自多位电影美学创作者的 AI 实践）：

- **捕捉动作的中间态**：不拍"开始弹琴"或"弹完了"，拍"手指刚离开琴键、琴键还在振动"。这种"未竟"的状态携带时间的重量（塔可夫斯基的"时间压力"）
- **前景遮挡制造亲密距离**：隔着水汽玻璃、百叶窗、另一个人的肩膀去拍——不让观众直接看到一切（王家卫的"偷窥式亲密"）
- **人静景动**：主体保持静止或微小动作，让环境元素（风、烟、光影、雨）产生持续运动——命运感来自环境推动人，而非人推动环境（黑泽明的"自然参与叙事"）
- **限色而非调色**：不写"vintage filter"，而是明确规定每个场景的色彩规则（主色 1 个 + 辅色至多 2 个 + 阴影色 1 个）。色彩服从空间结构，不是装饰
- **给 AI 设定"拍摄的物理限制"**：刻意保留动态模糊、轻微过曝的自然光、发丝的凌乱——这些"不完美"让虚构场景有"摄影师蹲守抓拍"的在场感

### 1.3 色彩弧线

| 段落 | 时间 | 主色温 | 高光 | 阴影 | 限色规则 |
|------|------|--------|------|------|---------|
| 散漫期 | 0:00–0:18 | 冷中性 | 淡蓝白 | 青灰 | 主色：灰蓝 / 辅色：混凝土灰 / 暗部：青绿 |
| 生长期 | 0:18–0:38 | 渐暖 | 琥珀金 | 深棕绿 | 主色：琥珀 / 辅色：旧铜 / 暗部：苔绿 |
| 凝固期 | 0:38–0:52 | 暖金 | 蜂蜜 | 深赭 | 主色：蜂蜜金 / 辅色：暖灰 / 暗部：焦糖棕 |
| 收尾 | 0:52–0:58 | 中性暖灰 | — | — | 品牌色 #F5F1EB 统治画面 |

### 1.4 构图系统

三种模式交替，节奏为 1-2-2-3-2-1-2-3-1：

| 模式 | 占比 | 用途 | 视觉策略 |
|------|------|------|---------|
| A. 中心对称 + 极端留白 | 30% | 安静、有重量的瞬间 | 库布里克式几何秩序——人是消失点上的变量 |
| B. 三分法 + 前景遮挡 | 45% | 日常、亲密的瞬间 | 王家卫式偷窥距离——隔着某层介质看 |
| C. 鸟瞰几何 | 25% | 抽离、审视的瞬间 | 图案感——人是纹理的一部分 |

### 1.5 运镜法则

- **散漫期**：静态 + 极缓慢 push-in（呼吸感推近）
- **生长期**：横移 tracking，速度渐快
- **凝固期**：运动突然减速至静止 → 代码动效接管
- **全片禁止**：快速缩放、故障效果、无人机俯冲、手持剧烈抖动

### 1.6 Image-to-Video 工作流

1. **种子帧生成**：每个场景先用 Midjourney v7 / FLUX 生成静态种子帧，使用与视频相同的 style block，手动挑选色调最一致的版本
2. **视频生成**：以种子帧作为 reference image 输入 **Runway Gen-4.5 Image-to-Video**（当前最强的参考图→视频引擎）或 **Kling 3.0 + Elements**（可从参考视频提取 3D 结构）。两个都出片，选更好的
3. **后期统一**：DaVinci Resolve 统一 color grading + Kodak 2383 Print Film LUT + 全局胶片颗粒层

---

## 2. 音乐线索（贯穿全片的声音架构）

音乐不是配乐，是叙事骨架。

| 时间 | 声音层 | 描述 |
|------|--------|------|
| 0:00–0:08 | 环境音 only | 水壶气泡、脚步节奏、城市远景声——日常的声音，但被微调成有节拍感的 pattern |
| 0:08–0:18 | 人声哼唱浮现 | 从环境音里"长出来"，单旋律，断续的，不完整 |
| 0:18–0:38 | 编曲层逐步加入 | 钢琴→吉他→轻鼓→弦乐垫底→质感层，每切一个场景加一层 |
| 0:38–0:48 | 完整的小歌 | 所有层汇聚，干净温暖。然后逐层剥离，只留旋律线（配合动效） |
| 0:48–0:58 | 渐弱→静默 | 最后一个音符悬停在 0:54，0:56 完全静音，尾部 2 秒纯静默 |

**音轨来源**：用 Murmur 自身引擎从一段真实哼唱生成 demo 歌。用自家产品做自家视频的音乐 = 最好的产品证明。

---

## 3. 逐帧分镜

---

### SCENE 01 — 水的旋律（0:00–0:04）

**构图模式**：A（中心对称）
**情绪段**：散漫期

**画面**：微距。一个玻璃水壶在炉灶上，水刚刚开始沸腾。气泡从底部升起、在水面破裂。极度安静的画面——只有水、光、气泡。水壶把手上有轻微的水渍和使用痕迹（不是全新的）。

**运镜**：完全静态 3 秒 → 最后 1 秒极缓慢 push-in（几乎感觉不到在推近）。

**关键细节**：气泡破裂的瞬间（中间态，不是"刚冒出来"也不是"已经消失"）；壶壁上的冷凝水珠；炉灶火焰的微光从底部映上来。

```
PROMPT — SCENE 01:

[镜头] Extreme close-up, 100mm macro lens, f/2.8, completely 
static camera for 3 seconds then imperceptibly slow push-in.

[构图] Center-symmetrical. Glass kettle occupies dead center of 
frame, background dissolves into uniform warm bokeh.

[主体] Water inside a glass kettle just beginning to simmer — 
tiny bubbles rising from the bottom in rhythmic clusters, caught 
in the exact mid-state of breaking at the surface. Not the start 
of boiling, not a full boil — the liminal moment between stillness 
and activity.

[细节] Condensation droplets on the inner glass wall, slightly 
fogged. The kettle handle shows faint water stains and wear marks 
— this is a used object, not a product shot. A single bubble, 
larger than the rest, is mid-deformation as it reaches the surface.

[光线] Early morning side light entering from a window at camera-
left, cold blue-white. The gas flame beneath casts a faint warm 
amber uplight on the bottom curve of the glass. Two competing 
color temperatures: cool daylight above, warm fire below. Dust 
motes visible in the light beam crossing through frame.

[色温] Highlights: pale blue-white. Shadows: slate gray with 
cool green undertone. Single warm accent: the flame glow.

[情绪] The weight of a quiet morning before anything has begun. 
Time moves at the speed of rising bubbles.

--no: steam cloud, whistling, bright colors, people, hands, 
text, modern kitchen appliances in background, overhead lighting

[STYLE BLOCK]

[ANCHOR → SCENE 02]: 最后一帧的水壶口在画面 MC 位置呈圆形。
下一帧（Scene 02）的十字路口在 MC 位置也呈圆形/放射结构。
形状匹配 + 视角匹配（俯视→俯视）。后期用 2 帧交叉淡化过渡。
```

---

### SCENE 02 — 灰色世界里的暖色信号（0:04–0:08）

**构图模式**：C（鸟瞰几何）
**情绪段**：散漫期

**画面**：城市人行横道的正上方俯拍。行人在各个方向走，他们的长影子在地面上形成不断变化的几何图案。所有人都是灰色系的——除了一个人穿着琥珀色外套。画面速度比正常略快（约 1.2x），让行走产生一种无意识的节奏感。

**运镜**：完全静态鸟瞰，4 秒。

**关键细节**：混凝土路面的裂缝和斑驳痕迹（弄脏画面）；行人影子的几何交叉；琥珀色外套的人走在画面的黄金分割点上。

```
PROMPT — SCENE 02:

[镜头] Overhead bird's-eye view, 35mm wide lens, static camera 
mounted directly above, 4 seconds, playback at 1.2x real-time 
creating subtly dreamlike pedestrian flow.

[构图] Pure geometric composition from directly above. Crosswalk 
white stripes create horizontal rhythm. Pedestrian shadows radiate 
at diagonal angles forming an evolving pattern — the ground is a 
canvas being drawn on by moving bodies.

[主体] 8-10 pedestrians crossing in various directions. All 
wearing muted gray, charcoal, dark navy — urban winter palette. 
One person, positioned at the golden ratio point of the frame, 
wears an amber-colored wool coat that becomes the single warm 
signal in a cold field. We see only the tops of heads and 
shoulders — no faces, identity dissolved into pattern.

[细节] Concrete surface shows authentic wear: hairline cracks, 
old gum stains darkened by weather, a faded yellow lane marking 
partially repainted. The amber-coated person carries a canvas 
tote bag — the bag swings slightly, adding micro-movement that 
distinguishes them from the crowd's uniform stride.

[光线] Overcast morning light — soft, directionless, even. 
Shadows are long (low sun angle, early day) but diffused, 
not sharp-edged. No visible light source — the world is 
illuminated by the sky itself.

[色温] Dominant: concrete gray and asphalt charcoal. 
Shadows: cool blue-gray. Single accent: amber coat — 
the warmest thing in the frame by a full stop.

[情绪] The city as a rhythm machine. Everyone is walking to 
their own internal beat, but from above, it looks choreographed. 
One warm color in a cold field — a signal that hasn't been 
noticed yet.

--no: cars, traffic lights in frame, rain, puddles, bright 
signage, visible faces, sunny day, sharp shadows

[STYLE BLOCK]

[ANCHOR → SCENE 03]: 琥珀色外套人物最后位于画面 MR 区域。
下一帧（Scene 03）的琥珀色茶杯位于画面 ML-MC 区域，桌面上。
颜色匹配（amber → amber），视角从鸟瞰切换到平视。
转场策略：用 Watchtower 式的色彩匹配——琥珀色从外套"流入"茶杯。
```

---

### SCENE 03 — 有人在哼歌（0:08–0:13）

**构图模式**：B（三分法 + 前景遮挡）
**情绪段**：散漫期 → 哼唱浮现

**画面**：一个人坐在窗边，侧脸。不看镜头。窗外是失焦的城市。他/她在无意识地哼——嘴唇微动，手指在桌面上无意识敲节奏。桌上有一杯琥珀色的茶（延续 Scene 02 的颜色线索）。我们隔着一片室内植物的叶子看这个人——叶子在前景，大面积虚化，制造"偷窥式亲密"。

**运镜**：极缓慢 push-in，5 秒内推近约 5%。

**关键细节**：嘴唇的微动是中间态——不是"刚开始唱"也不是"正在唱一首完整的歌"，是那种你自己都没意识到自己在哼的状态。手指敲桌面的节奏和嘴唇的动作有一个微妙的不同步（真实感）。

**这是全片第一次出现人声。声音设计：环境音压低，哼唱声从远处慢慢推近，像从水下浮上来。**

```
PROMPT — SCENE 03:

[镜头] Medium shot, 85mm portrait lens, f/1.8. Extremely slow 
dolly-in over 5 seconds — so gradual the viewer feels drawn 
closer without realizing the camera moved. Smooth, stabilized, 
no handheld shake.

[构图] Rule-of-thirds: subject in left third of frame. Right 
two-thirds filled with the window and defocused city beyond. 
Critical: a large monstera leaf enters frame from the lower-right 
foreground, heavily blurred at f/1.8, creating a translucent green 
curtain between camera and subject — we are observing through 
an obstruction, not confronting directly. Wong Kar-wai voyeuristic 
intimacy.

[主体] A young person, 25-30, gender-ambiguous, sitting sideways 
at a wooden table by a floor-to-ceiling window. Profile view — we 
see one ear, the line of their jaw, the curve of their nose. They 
are humming unconsciously: lips barely parting and closing in 
micro-movements, not performing a song, caught in the involuntary 
act of a melody escaping. Their left hand rests on the table, index 
and middle fingers tapping an irregular rhythm — slightly out of 
sync with the lip movement (authentic imperfection). Their posture 
is relaxed, slightly slouched — they have been sitting here a while.

[细节] The amber tea in a thin glass cup — half-finished, a tea 
stain ring on the table where the cup was moved earlier. The 
person wears a soft, oversized linen shirt, slightly wrinkled at 
the elbows from being pushed up. One earbud is in, the other 
dangles against their chest — they were listening to something 
but stopped. Hair is slightly messy, not styled — morning state.

[光线] Soft morning window light illuminating the window-side half 
of their face, the other half in gentle shadow. The light quality 
is pre-direct-sun: diffused, cool-leaning but not cold. Inside the 
room, a warm-toned table lamp is on but dim, creating a secondary 
warm source that touches the tea cup and the table surface. Two 
temperatures coexist: cool window, warm lamp.

[色温] Face highlights: cool daylight blue. Table and tea: warm 
amber from lamp. Shadows: soft neutral gray. The green of the 
foreground leaf is desaturated, olive-toned, not vivid.

[情绪] The private moment before a melody becomes conscious. The 
person doesn't know they're being watched. They don't know they're 
making music. The camera knows.

--no: direct eye contact, smiling, singing with open mouth, 
headphones (only one earbud), bright room, overhead lighting, 
clean/minimalist interior, perfect hair

[STYLE BLOCK]

[ANCHOR → SCENE 04]: 桌面木纹质感在画面 BC 区域。
下一帧（Scene 04）的水泥墙质感填满全画面。
质感匹配：暖灰色表面 → 暖灰色表面。
转场策略：快速直切（hard cut），质感的相似性会让眼睛不觉得跳跃。
```

---

### SCENE 04 — 文字入画 "Everyone hums."（0:13–0:15）

**构图模式**：A（中心对称）
**情绪段**：散漫期

**画面**：一面有年代感的水泥墙。自然纹理：裂缝、水渍、褪色的旧漆痕。画面中央偏下，一行手写体文字——看起来像有人用黑色马克笔随手写在墙上的：**"Everyone hums."** 没有人。只有墙和字。字迹略微不整齐，某个字母的笔画有墨水扩散的痕迹。

**运镜**：完全静态，2 秒。

**这一帧的作用**：像一个标点符号。把前面 13 秒的"个人在哼歌"推向一个普遍性的陈述。它出现在墙上（而不是字幕条里）意味着它是世界的一部分，不是旁白。像城市里那些你偶然看到的匿名涂鸦——有人留下了一句话，你不知道是谁，不知道什么时候。

```
PROMPT — SCENE 04:

[镜头] Medium-close shot, 50mm lens, f/4 (slightly deeper depth 
of field to keep wall texture sharp across the frame), static 
camera, 2 seconds.

[构图] Center-symmetrical. The wall fills the entire frame edge 
to edge — no sky, no ground, no context beyond the wall surface 
itself. The handwritten text sits at the lower-third golden ratio 
point, slightly left of center (not perfectly centered — human 
imperfection).

[主体] An aged concrete wall. The wall IS the subject. On it, 
handwritten in black marker: "Everyone hums." — the handwriting 
is casual, slightly tilted, one letter (the 'h') shows ink 
bleeding where the marker paused. The writing looks like it has 
been there for weeks — not fresh, not ancient, just present.

[细节] Wall surface: fine hairline cracks forming an organic web 
pattern. A water stain blooms from the upper-left corner — dried, 
amber-edged. Traces of a previous layer of paint (pale sage green) 
visible where the current gray surface has chipped. A single small 
weed sprouts from a crack near the bottom of frame. The wall's 
overall color is close to #F5F1EB — Murmur's brand warm gray, 
appearing naturally.

[光线] Flat, overcast daylight. No dramatic shadows, no direct 
sun — the wall is evenly lit with just enough variation from the 
surface texture to create micro-shadows in the cracks. The light 
is colorless, letting the wall's own warmth come through.

[色温] Monochrome warm gray. No accent colors except the faint 
sage-green paint trace and the amber edge of the water stain.

[情绪] A found statement. Not an advertisement, not a protest — 
a quiet observation left by an unknown hand. The viewer discovers 
it the way they would discover graffiti on a real wall while 
walking through a city.

--no: people, graffiti art, colorful paint, posters, visible 
street or sky, perfect wall, clean surface, stencil lettering, 
neon, any text other than "Everyone hums."

[STYLE BLOCK]
```

---

### SCENE 05 — 蒙太奇：哼唱在不同的世界（0:15–0:24）

**4 个场景快切，每个约 2.25 秒。** 同一段哼唱旋律贯穿所有场景。每切一个场景，底下悄悄加一层编曲（钢琴→吉他拨弦→轻鼓→弦乐垫底）。观众意识不到编曲在加，但会感到情绪在"变厚"。

---

#### 05-A 深夜便利店（0:15–0:17.25）

**构图模式**：B（前景遮挡）

**画面**：深夜。我们透过便利店的玻璃门看进去——玻璃上叠加着街道霓虹灯的反射和室内荧光灯的透射，形成两个世界的重叠。一个人背对镜头站在货架前，肩膀微微在律动。玻璃表面有水汽——隔着水汽看一切都有一层柔焦的膜。

```
PROMPT — SCENE 05-A:

[镜头] Medium shot, 35mm lens, f/2, static camera, 2.25 seconds. 
Shot from OUTSIDE the store looking IN through glass door.

[构图] Rule-of-thirds: person in right-third. The glass door 
surface is the critical layer — it simultaneously transmits the 
warm interior light AND reflects the cool exterior streetscape, 
creating a double-exposure effect within a single unmanipulated 
frame. Foreground obstruction: the glass itself, with visible 
condensation mist along the lower edge.

[主体] One person standing with their back to camera in front 
of a convenience store shelf, shoulders barely swaying in a 
micro-rhythm as if humming. They hold a triangular rice ball 
(onigiri) in one hand, paused mid-bite — the in-between state 
of eating and listening to something internal.

[细节] Through the glass: fluorescent tubes cast even white light 
on colorful product rows. On the glass surface: condensation mist 
in the lower 20% of frame, a few fingerprint smudges, a small 
convenience store sticker (blurred, illegible). Reflected in the 
glass: the cool blue-purple glow of a pharmacy cross sign across 
the street, distorted into a soft haze.

[光线] Three competing light sources create chromatic tension: 
(1) warm amber streetlight from behind-camera illuminating the 
person's back, (2) cool white fluorescent from inside the store 
wrapping around their silhouette edges, (3) colored neon 
reflections sliding across the glass surface. The person exists 
at the intersection of all three.

[色温] Interior: clinical cool white. Exterior: amber + neon 
blue-purple. The glass merges them into something in between.

[情绪] Edward Hopper's Nighthawks reframed for East Asian late-
night convenience culture. Solitude that is comfortable, not 
tragic. The glass is a membrane between the public and the private.

--no: face visible, bright interior, crowded store, daylight, 
clean glass without condensation, camera inside the store

[STYLE BLOCK]
```

---

#### 05-B 黄昏公路（0:17.25–0:19.5）

**构图模式**：B（前景遮挡——方向盘和仪表盘）

**画面**：车内。我们坐在副驾的视角。驾驶者的手在方向盘上轻轻打节拍——不是敲击，是手指无意识地抬起放下。挡风玻璃外是空旷公路，地平线极低，天空占了三分之二。仪表盘发出琥珀色微光。

```
PROMPT — SCENE 05-B:

[镜头] Interior car POV from passenger seat, 24mm wide lens, f/2, 
static camera mounted on dashboard, 2.25 seconds. Slight natural 
vibration from the car moving — not stabilized to perfection, 
the road surface transmits through the chassis.

[构图] Three depth layers: (1) foreground — steering wheel 
silhouette and dashboard creating dark frame at bottom third, 
(2) midground — driver's left hand on wheel, fingers mid-tap, 
(3) background — empty highway stretching to a vanishing point, 
horizon line extremely low (bottom 15% of visible sky-through-
windshield area). The sky dominates.

[主体] Driver's hand — we see only the hand and part of the 
forearm, sleeve of a dark linen shirt pushed to the elbow. 
Fingers are in the mid-state of a rhythmic tap: index finger 
lifted 2cm off the wheel, about to descend. Not drumming — 
the unconscious physical expression of an internal melody.

[细节] Dashboard instruments emit a warm amber glow — the 
speedometer needle, the fuel gauge, small indicator lights. 
Through the windshield: the highway surface has heat shimmer 
distortion. A single dead insect on the lower-left of the 
windshield (lived-in car, not a commercial). The rearview 
mirror catches a sliver of the fading sky behind.

[光线] Golden hour — the sun is at the horizon directly ahead 
but slightly left, creating a warm wash across the dashboard and 
the driver's hand. The sky gradients from deep amber at the 
horizon through warm peach to a high blue-gray. Subtle anamorphic 
lens flare stretches horizontally across frame from the sun 
position.

[色温] Amber-dominant. Dashboard glow and sunset are in the same 
family. Shadows inside the car: cool dark teal. The warmth is 
arriving — we are crossing from the cool segment of the film 
into the warm segment.

[情绪] The in-between state of driving alone at dusk — not 
arriving, not departing, just moving. The road as a metronome. 
David Lynch's highway meditations without the menace.

--no: other cars, traffic, rain, city, bright interior light, 
visible face, night, headlights on

[STYLE BLOCK]
```

---

#### 05-C 雨窗（0:19.5–0:21.75）

**构图模式**：B（微距抽象，前景=窗玻璃本身）

**画面**：窗玻璃上的雨滴特写。透过雨滴看到的城市灯光被折射成无数小光圈。一只手指从画面左边缘慢慢伸入，在玻璃上划出一条线——雨滴沿着这条线重新排列流动。**这是产品"melody polishing"的隐喻**——混乱的音符被一条线整理成旋律。

```
PROMPT — SCENE 05-C:

[镜头] Extreme macro, 100mm macro lens, f/2.8, static camera 
with subject (window) perpendicular to lens, 2.25 seconds.

[构图] Abstract — no horizon, no identifiable space. The window 
glass fills the frame completely. Depth is created entirely by 
the bokeh layers: (1) glass surface with water droplets in sharp 
focus, (2) city lights behind glass in full defocus, creating 
large circular bokeh orbs of amber, white, and pale blue.

[主体] Raindrops on glass — hundreds of small droplets of varying 
size clinging to the surface. A single human finger enters slowly 
from the left frame edge, drawing a deliberate line through the 
condensation. Where the finger passes, droplets merge and flow 
downward along the traced path, reorganizing from scattered chaos 
into a single flowing stream. The finger is in the MID-STATE of 
drawing — we see neither where it started nor where it will end.

[细节] Each raindrop acts as a tiny lens, refracting the city 
lights behind it into miniature inverted images. The finger's 
skin shows realistic texture — a visible fingerprint whorl, 
slightly pruned from moisture. The traced line is not perfectly 
straight — it has the slight waver of a hand drawing on a 
vertical surface.

[光线] No direct light source visible. All illumination comes 
from the bokeh city lights behind the glass — amber streetlights, 
cool white building windows, one pale blue pharmacy sign. The 
droplets catch and scatter this light, creating micro-sparkles 
on the glass surface.

[色温] Cool dominant (rain, night, glass) with warm bokeh 
accents (amber streetlights). The finger's skin is the warmest 
element in frame — human warmth against cold glass.

[情绪] The intimate act of imposing order on randomness. 
Rain as scattered notes. The finger as the composer. A private 
gesture no one else will see.

--no: full hand visible, face reflection, clear view through 
window, daylight, dry glass, text on glass

[STYLE BLOCK]
```

---

#### 05-D 天台（0:21.75–0:24）

**构图模式**：A（中心对称 + 极端留白）

**画面**：城市天台。一个人站在栏杆前，完全背影，正中央。面对天际线。风吹动头发和外套。天空占画面三分之二。这是散漫期最后一帧——最安静、最有张力的静态画面。之后，一切开始生长。

**主体保持完全静止，但环境在动**——风吹衣服、云在移动、远处有飞鸟掠过。黑泽明的"人静景动"原则。

```
PROMPT — SCENE 05-D:

[镜头] Wide shot, 35mm lens, f/5.6 (deeper DOF to keep both 
person and skyline in acceptable focus), static camera, 2.25 
seconds.

[构图] Strict center-symmetry. Person placed at the exact vertical 
axis of frame, standing at rooftop railing. Horizon line at the 
upper-third mark. Sky fills the top two-thirds — massive negative 
space. The person is small in the frame, maybe 30% of frame 
height. Kubrick's geometric order: the human as a variable placed 
at the vanishing point.

[主体] Single person, back to camera, standing completely still 
at a rooftop railing. Feet shoulder-width apart, hands resting 
on the rail. They are the only static element — everything around 
them moves. Wind lifts the hem of their light jacket and moves 
their hair. They appear rooted, contemplative, at the edge of 
a decision or a realization.

[细节] The rooftop surface: weathered concrete with small puddles 
from earlier rain reflecting the sky. The railing is industrial 
metal, slightly rusted at the joints. In the distant skyline: 
buildings with a few lit windows, a construction crane, the 
faint red blink of an aircraft warning light on a tower. Two 
small birds cross the sky in the upper-left quadrant.

[光线] Twilight — the sun has set but the sky still holds color. 
The sky gradients from warm peach at the horizon through lavender 
to deep blue-gray overhead. The person is backlit by the residual 
horizon glow, creating a subtle rim light on their shoulders 
and hair. No artificial light on the rooftop itself.

[色温] Sky: warm-to-cool gradient (peach → lavender → steel 
blue). Person: silhouette-adjacent, warm rim light. Rooftop: 
cool concrete gray with warm puddle reflections.

[情绪] Standing at the threshold between silence and sound. 
The last frame before the music begins to grow. Kurosawa's 
"static subject, dynamic environment" — the person is the 
still eye of a slowly turning world.

--no: looking at camera, sitting, phone in hand, crowded 
rooftop, bright city lights, night, dramatic clouds, 
unsafe railing position

[STYLE BLOCK]
```

---

### SCENE 06 — 生长开始：花开（0:24–0:26）

**构图模式**：A（中心对称）
**情绪段**：生长期开始

**画面**：微距延时。一朵金琥珀色的花从花苞到完全绽放。背景纯黑。花瓣一层层打开的节奏与音乐中第一个编曲层（钢琴）的节拍精确对齐。

**这帧的质感**：David Attenborough 自然纪录片的科学严谨感——不是 MV 里的慢镜头玫瑰，是"用 macro probe lens 在实验室里拍摄植物细胞展开的过程"。花的"不完美"很重要：花瓣边缘有微小的不规则，不是完美的几何对称。

```
PROMPT — SCENE 06:

[镜头] Macro timelapse, probe lens effect, f/4, 2 seconds 
compressed from hours of growth. Background: pure black void — 
the flower exists in a space without context.

[构图] Dead center. The flower occupies the middle 40% of frame, 
surrounded by black. Perfect symmetry broken only by the organic 
asymmetry of the petals themselves — nature's imperfection 
within geometric framing.

[主体] A single flower blooming in timelapse — species ambiguous 
but suggesting a dahlia or ranunculus (layered, complex petal 
structure). Color: amber-gold with slightly darker veining on 
inner petals (the amber thread from Scene 02's coat and Scene 03's 
tea continues). The bloom unfurls in stages: outer petals first, 
revealing a tighter inner spiral that then unwinds. Mid-bloom, a 
brief pause — the flower seems to hesitate before completing its 
opening. The final petal arrangement is not symmetrical — one side 
slightly more open than the other.

[细节] Pollen dust released as inner petals separate — visible as 
golden particles in the side light. Petal surfaces show cellular 
texture at macro scale: tiny ridges, translucent edges where light 
passes through. One petal has a small natural blemish — a darker 
spot near the tip. Moisture beads on the stem just below the bloom.

[光线] Single hard side-light from camera-right, creating dramatic 
highlight-shadow split across the petals. The light is warm gold, 
matching the flower's own color — flower and light are the same 
temperature. The black background absorbs everything; the flower 
is self-illuminating.

[色温] Warm gold on black. No cool elements. This is the color-
temperature turning point of the entire film — from cool-neutral 
to decisively warm.

[情绪] A melody becoming a song. Scientific wonder meets poetic 
transformation. David Attenborough's patience, not a perfume 
commercial's glamour.

--no: vase, table, garden background, multiple flowers, rose, 
bright colorful background, slow motion water, romantic mood

[STYLE BLOCK]
```

---

### SCENE 07 — 旋律在城市里流动（0:26–0:34）

**更快的蒙太奇，每镜 1.5–2 秒。音乐正在"长出来"。**

---

#### 07-A 钢琴——离开琴键的瞬间（0:26–0:28）

**构图模式**：C（鸟瞰几何）

**画面**：正上方俯拍一架旧钢琴的琴键。一双手悬停在键上方——不是在弹，是刚弹完最后一个和弦、手指离开琴键的那个精确瞬间。琴键还在微微下沉回弹。一束侧光照过来，灰尘在光柱里漂浮。

```
PROMPT — SCENE 07-A:

[镜头] Overhead bird's-eye, 50mm, f/2.8, static, 2 seconds.

[构图] Geometric: black and white keys form strong horizontal 
stripe pattern. Hands hovering 2-3cm above keys at center frame. 
A single beam of light crosses diagonally from upper-right to 
lower-left, cutting across both hands and keys.

[主体] A pair of hands — not a pianist's perfected posture, but 
relaxed, slightly curved fingers, as if the hands played something 
casual and personal, not a recital piece. The hands are frozen in 
the mid-state of lifting away: fingers still shaped around the 
ghost of a chord, wrists beginning to rise. Below them, two or 
three keys are in the micro-state of returning to rest position — 
not fully up yet.

[细节] The piano is old: ivory keys show hairline yellowing, one 
black key has a small chip at the corner, wood grain visible on 
the key bed between keys. Skin on the hands shows realistic 
texture — knuckle creases, a small scar on one index finger. 
Dust particles are mid-float in the diagonal light beam — 
frozen in the timeless moment between sound and silence.

[光线] Single diagonal beam of warm afternoon light entering from 
a window outside frame. The beam illuminates dust particles, the 
tops of the white keys, and the backs of the hands. Everything 
outside the beam falls into soft shadow. Tarkovsky's "light as 
time made visible."

[色温] Warm amber in the light beam. Cool gray in the shadows. 
The ivory keys carry their own aged warm tone.

[情绪] The resonance after the note. Sound has left the piano 
but hasn't yet left the room. The hands remember the shape of 
what they played.

--no: sheet music, modern digital piano, bright room, playing 
in progress, concert setting

[STYLE BLOCK]
```

---

#### 07-B 地铁——一点透视的空间控制（0:28–0:30）

**构图模式**：A（中心对称 → 库布里克式空间统治）

```
PROMPT — SCENE 07-B:

[镜头] Wide shot, 24mm, f/4, static camera centered on the 
vanishing point axis, 2 seconds. Absolutely stable — no shake, 
no drift. The camera is a measuring instrument.

[构图] Single-point perspective. ALL lines in the subway car — 
ceiling rails, seat edges, floor grooves, handrail poles — 
converge to a single vanishing point at dead center of frame. 
Kubrick's geometric sovereignty: the space controls the frame, 
not a character. The car is empty — no humans, just architecture.

[主体] An empty subway car. The seats, the standing poles, the 
overhead advertisements (blurred, illegible) create a repeating 
modular pattern receding toward the vanishing point. The far end 
of the car has a window showing the black tunnel.

[细节] Fluorescent tubes flicker with a barely perceptible rhythm 
— not a malfunction, just the electrical pulse of aging fixtures. 
Seat fabric shows wear patterns: the center of each seat slightly 
more faded than the edges (thousands of sitters). A single 
forgotten newspaper on one seat, pages slightly fanned. The floor 
has shoe scuff marks, dried water spots.

[光线] Overhead fluorescent: cool white, slightly green-cast 
(the specific unpleasant warmth of subway fluorescent). Through 
the far window: pure black tunnel. The lighting is even but has 
a clinical, surveillance quality — Kubrick's "from the camera's 
objective eye, humans are geometric events."

[色温] Cool green-white dominant. Metal surfaces: gunmetal gray 
with green reflections. Seats: faded blue-gray fabric. 
Monochromatic and controlled — color as structure, not decoration.

[情绪] Rhythm without a musician. The empty car is a metronome — 
the flicker, the track noise, the repeating module. Order that 
contains the ghost of human presence.

--no: passengers, bright modern subway, daylight through windows, 
digital screens, clean/new interior

[STYLE BLOCK]
```

---

#### 07-C 布料的波——弦乐的质感对应（0:30–0:32）

**构图模式**：B（微距抽象）

```
PROMPT — SCENE 07-C:

[镜头] Extreme macro, 100mm, f/2.8, static camera, 2 seconds. 
The camera treats the fabric as a landscape.

[构图] Abstract — no identifiable garment or space. The frame is 
filled entirely with undulating fabric, creating a terrain-like 
composition with ridges (highlights) and valleys (shadows).

[主体] Linen or raw silk fabric in motion — a slow, continuous 
wave passing through the material, driven by wind from outside 
frame. The fabric is not flapping; it's breathing — one long, 
slow undulation crossing from left to right like a sound wave 
made visible. The weave structure of the fabric is visible at 
this magnification: individual threads, the crosshatch pattern, 
tiny imperfections in the weave.

[细节] Afternoon sunlight passing THROUGH the fabric where it 
thins at the wave crests — backlighting reveals the internal 
fiber structure, making the fabric glow translucent amber at 
the peaks while remaining opaque warm gray in the valleys. 
A single thread has come slightly loose along the edge of 
frame — organic imperfection.

[光线] Strong backlight from window behind fabric. The fabric 
filters and diffuses the light — hard sun becomes soft glow 
through the weave. The effect is Tarkovsky's curtain sequences: 
light made tactile, time made fabric.

[色温] Warm amber at translucent peaks, warm gray in opaque 
valleys. Monochrome warmth — no cool element.

[情绪] Sound as texture. This is what strings feel like when 
you close your eyes. The fabric is a visualization of resonance.

--no: identifiable clothing, person, hanger, room, pattern 
print, colorful fabric, synthetic material

[STYLE BLOCK]
```

---

#### 07-D 桌面物语——罗塞塔石碑（0:32–0:34）

**构图模式**：C（鸟瞰几何）

**画面**：俯拍一个桌面。物件的排列有 Kinfolk 杂志 flatlay 的精确感，但带着"有人刚用过这些东西然后离开了"的生活痕迹。每个物件都指向全片的其他场景——这是一个隐藏的索引。

```
PROMPT — SCENE 07-D:

[镜头] Overhead bird's-eye, 50mm, f/4, static, 2 seconds.

[构图] Flat-lay geometric. Objects arranged on a warm-toned 
wooden desk surface with Kinfolk editorial precision, but with 
traces of actual use that prevent it from looking staged: a 
pencil not perfectly parallel, the teacup slightly off the 
implied grid. Directional warm light from upper-right creates 
long diagonal shadows of each object.

[主体] Five objects on the desk — each a resonance of a 
previous or upcoming scene:
(1) A glass of amber tea, two-thirds full (Scene 03's tea, 
    now further consumed — time has passed)
(2) A pair of white earbuds coiled loosely (foreshadowing 
    Scene 08's listener)
(3) A small postcard, face-up, showing a reproduction of 
    Whistler's "Nocturne in Black and Gold" — the painting 
    that lives inside Murmur's artwork system
(4) A mechanical pencil with a worn grip
(5) A single amber-gold dried flower petal (echo of Scene 06's 
    bloom, now past tense — the flower has finished opening)

[细节] The desk wood has a natural grain pattern and a small 
ring stain where a wet cup was placed earlier. The postcard's 
edges are slightly soft from handling. The earbuds cable has 
a natural twist. The pencil has faint graphite smudges on the 
desk beside it — someone was writing. The flower petal is 
curled at one edge, drying.

[光线] Warm afternoon side light from upper-right. Long 
shadows extend to the lower-left. The tea catches light and 
glows amber. The postcard's glossy surface creates a small 
specular highlight.

[色温] Warm: amber tea, honey wood, gold petal. The Whistler 
postcard introduces a moment of dark teal-black that will 
echo in the final product card.

[情绪] A still life that tells a story if you know how to 
read it. Every object is a footnote. The desk is a memory 
palace laid flat.

--no: phone, laptop, modern devices, cluttered desk, 
bright white surface, overhead lighting, perfectly new objects

[STYLE BLOCK]
```

---

### SCENE 08 — 听到了（0:34–0:38）

**构图模式**：B（三分法，伦勃朗光）
**情绪段**：生长期高潮

**画面**：一个人戴着耳机，闭眼。全片最温暖的色温。这不是"哇这个 app 好厉害"的表情——是"嗯，就是这个"的安静满足。伦勃朗光把脸分成光影两半。

```
PROMPT — SCENE 08:

[镜头] Close-up portrait, 85mm, f/1.8, extremely slow dolly-in 
over 4 seconds — the camera is being drawn toward this face 
like a whisper pulls you closer.

[构图] Face fills 55% of frame, positioned on the left-third 
line. The right side of frame is soft warm shadow — negative space 
that breathes. Rembrandt lighting: a triangle of light on the 
shadow-side cheek (the classic Rembrandt triangle), created by 
golden side light from a window at camera-right.

[主体] A young person, eyes closed, wearing minimal white 
earbuds. Their expression is not ecstatic, not surprised — it is 
the quiet recognition of hearing something familiar made whole. 
A micro-smile: the corners of the mouth lifted 2mm, no teeth 
showing. The eyebrows are relaxed, slightly raised — openness, 
not effort. Head tilted 5 degrees toward the light source, 
as if leaning into the music. This is the face of someone 
hearing their own hum transformed, and finding it good.

[细节] Skin texture: visible pores on the nose and cheeks, 
a small beauty mark below the left eye, the finest peach fuzz 
on the jawline catching the golden light and glowing. Hair is 
natural, slightly tousled by wind or sleep — a few strands 
across the forehead. The earbuds' white cable traces a line 
down the neck and disappears into the collar of a soft, 
washed-out sage-green crewneck sweater. Eyelashes cast tiny 
shadows on the upper cheeks.

[光线] This is the warmest frame in the entire film. Golden hour 
light, direct but softened through a sheer curtain at camera-right. 
The light wraps around the face's contours: strong on the 
right-side cheek and forehead, falling off into warm umber shadow 
on the left. A subtle fill from ambient room light prevents the 
shadow side from going black — shadow detail is preserved with 
the warmth of aged oak.

[色温] Highlights: liquid honey gold. Shadows: warm sienna-umber, 
NOT cool. Even the darkest shadow in this frame is warm. The 
sweater's sage-green is the only cool whisper, and it's so 
desaturated it reads as warm gray.

[情绪] The moment a melody stops being "something I heard" and 
becomes "something that is mine." Not possession — recognition. 
The face of someone meeting their own music for the first time.

--no: open eyes, big smile, surprise expression, laughing, 
headphones (only earbuds), bright room, flat lighting, looking 
at phone, looking at camera

[STYLE BLOCK]
```

---

### SCENE 09 — 凝固：代码动效段落（0:38–0:48）

**⚠️ 这 10 秒全部是自制代码动效，不用 AI 生成。**

背景：Murmur 品牌暖灰 `#F5F1EB`。画面干净，只有线条和色彩在运动。

---

#### 09-A 波形诞生（0:38–0:41）— 3 秒

画面中央出现一条细线，轻微颤抖——哼唱的波形。它从不规则的、毛躁的震动开始（对应原始哼唱），然后逐渐平滑、有节奏（对应 melody polishing）。

**技术规格**：
- 实现：Canvas + Web Audio API，从 demo 歌提取真实波形数据
- 线条：起始色 `#9B9B9B` → 渐变到 `#FFBA5A`（Sunset vibe 暖金）
- 线条粗细：1.5px → 2px（随着变平滑略微变粗，暗示"信心在增长"）
- 背景：`#F5F1EB`
- 动画 easing：先 jittery/erratic → cubic-bezier 过渡到 smooth sinusoidal
- 参考美学：Stripe 官网线条动画——极细、大留白、精确 easing

#### 09-B 编曲层生长（0:41–0:44）— 3 秒

从主波形线上方和下方"生长"出更多线条，每条代表一个编曲轨道：
- 钢琴线（细、快速颤动、蓝灰色 `#8BAFC2`）
- 鼓点线（粗、短促的脉冲点阵、深棕 `#6A5240`）
- 弦乐线（柔软波浪、暖绿 `#7A8B6F`）
- 质感线（最细、微弱噪声纹理、半透明 `rgba(155,155,155,0.3)`）

**技术规格**：
- 实现：多层 Canvas/WebGL，每层独立动画曲线和 stagger delay
- 生长方式：不是同时出现——钢琴先（0.5s delay），鼓点跟上（1s），弦乐（1.5s），质感最后（2s）
- 生长动画：从主线的某个节点"分叉"出来，像植物的枝条——使用 spring physics 让分叉有弹性感
- 线条之间保持呼吸间距（不拥挤）
- 每条线的波形模式不同（钢琴=快速窄幅，鼓=短脉冲，弦乐=宽幅慢波，质感=高频噪声）

#### 09-C 卡片凝固（0:44–0:48）— 4 秒

所有波形线开始向中心收拢、凝聚成一个矩形——Murmur 音乐卡片的形状。

**动画分解**：
- 0:44–0:45.5（1.5s）：线条从各自位置开始向中心汇聚，运动有重力感——先加速再减速
- 0:45.5–0:46.5（1s）：线条凝缩成矩形轮廓，内部波形渐隐。取而代之：一幅画的隐约轮廓（Whistler《黑与金的夜曲》）从半透明渐入
- 0:46.5–0:47.5（1s）：歌名以 serif 字体出现在卡片下三分之一。一条细波形线留在卡片底部。卡片获得轻微投影——它"落到了表面上"
- 0:47.5–0:48（0.5s）：卡片完成的瞬间有一个极微小的弹跳（bounce easing）——物件"落定"的物理感

**技术规格**：
- Artwork：使用产品 `/public/artworks/` 目录中的真实画作
- 字体：产品已有的 serif display font
- 卡片尺寸：画面中央，约占画面 35% 宽度
- 投影：`box-shadow: 0 8px 32px rgba(0,0,0,0.08)` — 轻且暖
- 弹跳：`cubic-bezier(0.34, 1.56, 0.64, 1)` — 一次弹跳后静止
- 实现：GSAP timeline 或 Framer Motion
- 导出：ProRes 4444（带 alpha），60fps 渲染后合成到 30fps 时间线

---

### SCENE 10 — 递出去（0:48–0:52）

**构图模式**：B（三分法）
**情绪段**：收尾

**画面**：两个人面对面坐着。一个人把手机递向另一个人——我们看不到屏幕（正面朝向对方），但看到接过手机的人的表情变化：好奇→侧耳→微笑。一个分享的微型仪式。

```
PROMPT — SCENE 10:

[镜头] Medium two-shot, 50mm, f/2, slow track-in over 4 seconds. 
The camera approaches them as if joining a quiet conversation.

[构图] Two people face to face — one in the left third, one in 
the right third. The phone being passed between them creates a 
bridge at the center of frame. Depth: the background (a window 
or wall) is fully defocused, only the two people and the phone 
exist in sharp space.

[主体] Two people, late 20s. Person A (left) extends their phone 
toward Person B (right) — we see the back of the phone, screen 
facing away from camera. Person B receives it with both hands, 
brings it slightly closer to their ear. Their expression sequence 
over 4 seconds: neutral curiosity → head tilts 5 degrees (leaning 
in to hear) → eyes soften → a small, genuine smile. Not a grin — 
the same quiet satisfaction we saw in Scene 08, now shared.

[细节] The phone is nondescript — dark case, no visible brand. 
Person A's hand lingers on the phone for a beat before releasing — 
the gesture of sharing something personal. Both wear lived-in 
casual clothing: slightly wrinkled, soft fabrics, no logos. 
Between them on a surface: two cups, one empty, one half-full 
(the amber tea thread, one last time). A window behind them 
shows the blue-hour sky — the day is ending.

[光线] Late afternoon golden light from a window at camera-right, 
matching Scene 08's lighting but softer now — the sun has moved. 
Both faces receive warm side light, but less intensity than 
Scene 08 — the warmth is settling, not peaking. A practical 
table lamp adds a secondary warm pool between them.

[色温] Still warm but cooling at the edges — the gold is becoming 
amber, the shadows are deepening toward blue-hour cool. 
Transitioning from golden climax back toward the neutral 
warmth of the Murmur brand space.

[情绪] Music as a gift. The phone is not a device — it is a 
vessel carrying a song from one person to another. The smile 
at the end is not about technology; it is about being heard.

--no: looking at camera, visible screen content, bright room, 
overhead lighting, multiple people beyond the two, hugging, 
exaggerated reaction

[STYLE BLOCK]
```

---

### SCENE 11 — 收尾（0:52–0:58）

---

#### 11-A 最后的静物（0:52–0:54）— AI 生成

**构图模式**：C（鸟瞰几何）

**与 Scene 01 首尾呼应**——又一个微距/俯拍静物。但这次是"离开之后"：耳机放在木桌上，旁边是一杯喝完了的茶（只剩底部的茶渍）。没有人，但一切暗示着有人刚刚在这里听完了什么。

```
PROMPT — SCENE 11-A:

[镜头] Overhead bird's-eye, 85mm, f/2.8, static, 2 seconds.

[构图] Centered flat-lay. Two objects create a minimal geometric 
dialogue: the circular coil of white earbuds and the round rim 
of an empty glass tea cup, positioned with intentional spacing 
on a warm wooden surface.

[主体] White earbuds resting on warm-toned wood, loosely coiled 
(not neatly wound — placed down casually by someone who just 
finished listening). Beside them: a clear glass tea cup, now 
empty except for a thin amber ring of dried tea at the bottom 
and a single tea leaf settled at the cup's lowest point. No 
person in frame — but every element says "someone was just here."

[细节] Wood surface: natural grain, the same warm tone throughout 
the film. A faint circular water mark under the cup from earlier 
condensation. The earbud cable traces a lazy S-curve — the 
shape resembles a musical staff line. One earbud faces up, the 
other faces down (asymmetry of casual placement). Soft shadow 
beneath the cup indicates gentle side light.

[光线] Warm but diffused — the intensity of the golden hour has 
passed. The light is ambient, coming from everywhere and nowhere 
specific. The scene is illuminated by the memory of the sun.

[色温] Neutral warm. The amber of the tea stain. The white of 
the earbuds. The honey of the wood. Everything is settling into 
a quiet, Murmur-brand warmth — approaching #F5F1EB.

[情绪] The afterimage of music. The instruments (earbuds, cup) 
are still here; the musician and the listener have left. The 
story completes in the viewer's imagination.

--no: phone, laptop, person, hand, multiple objects, cluttered, 
cold light, modern furniture, tea still full

[STYLE BLOCK]
```

---

#### 11-B 品牌终帧（0:54–0:58）— 代码动效/静态

**画面**：
- 0:54–0:55：画面从 Scene 11-A 交叉淡入纯 `#F5F1EB` 背景
- 0:55–0:56：MURMUR wordmark 出现（使用产品的 `murmur-wordmark-source-cropped.png`），画面正中偏上
- 0:56–0:57：下方一行字淡入，小号 serif：*That melody in your head — let it out.*
- 0:57–0:58：再下方，更小号：`murmur.ptoq.io`
- 没有动画花活。它就在那里。像书的封底。

**排版规格**：
- Wordmark：产品原始资源，宽度约为画面 25%
- Tagline：serif italic，14pt 等效，letter-spacing: 0.02em，颜色 `#4A4A4A`
- URL：sans-serif，11pt 等效，颜色 `#9B9B9B`
- 行距：wordmark 到 tagline 间距 = 24px 等效，tagline 到 URL = 16px 等效
- 整体垂直居中偏上（视觉重心在画面上 40% 处）

**音乐**：最后一个音符在 0:54 悬停，0:56 完全静音。最后 2 秒纯静默。

---

## 4. 隐藏线索索引

| 线索 | 出现场景 | 意义 |
|------|---------|------|
| 琥珀色 | 02（外套）→ 03（茶）→ 05-B（仪表盘）→ 06（花瓣）→ 07-D（茶+花瓣）→ 11-A（茶渍） | 全片隐形色彩主线——温暖的信号从人到物到记忆 |
| Whistler 夜曲 | 07-D（明信片）→ 09-C（卡片内画作） | 与 Murmur 产品画作系统直接呼应 |
| 耳机/耳塞 | 03（一只耳塞）→ 08（戴着听）→ 11-A（放下了） | 声音的旅程：接收→沉浸→完成 |
| 手指的动作 | 03（敲桌面）→ 05-B（敲方向盘）→ 05-C（划玻璃）→ 07-A（离开琴键） | 身体无意识地表达旋律的不同方式 |
| 首尾呼应 | 01（水壶微距）↔ 11-A（耳机微距） | 从自然的声音到人造的声音——一个循环 |
| 文字入画 | 04（"Everyone hums."）→ 11-B（"let it out."） | 发现→行动。墙上的涂鸦变成品牌的邀请 |

---

## 5. 剪辑节奏表

| 段落 | 时间 | 镜头数 | 平均镜头长度 | 节奏描述 |
|------|------|--------|-------------|---------|
| 散漫期 | 0:00–0:15 | 4 | 3.75s | 呼吸般缓慢 |
| 蒙太奇 A | 0:15–0:24 | 4 | 2.25s | 脉搏出现 |
| 生长期 | 0:24–0:34 | 5 | 2s | 心跳加速 |
| 凝固期 | 0:34–0:48 | 连续 | 14s 连贯 | 精确、有重力 |
| 收尾 | 0:48–0:58 | 3 | 3.3s | 减速到静止 |

---

## 6. 派生版本

| 版本 | 时长 | 渠道 | 保留场景 |
|------|------|------|---------|
| 完整版 | 58s | 官网、B站、YouTube | 全部 |
| Reels 版 | 30s | Instagram、小红书 | 03 → 05-A → 06 → 07-C → 08 → 09-C → 11-B |
| 极短版 | 15s | Douyin、广告预览 | 03 → 08 → 09-C → 11-B |
| 海报帧 | — | 社交配图 | Scene 04、07-D、08 单帧截取 |

---

## 7. 转场执行手册（Watchtower 式 Match Cut 工作流）

### 7.1 为什么需要这个

AI 生成的每个镜头是独立的。不像真实拍摄可以在同一个场景里调整构图，AI 的每一帧都是"从零开始"。为了在后期剪辑时实现接近 Watchtower of Turkey 的无缝流动感，我们需要在**生成阶段就埋入匹配点**。

### 7.2 操作原则

Leonardo Dalessandri 的核心剪辑法则（从他的访谈中提取）：

1. **每个剪辑点都需要一个视觉借口**——颜色、形状、运动方向、亮度分布。眼睛追踪这个元素跨越剪辑点，所以不觉得"跳了"
2. **音乐节拍是剪辑的骨架**——不是画面配合音乐，是画面"踩"在音乐上。每个 cut 都要落在节拍上或半拍上
3. **环境音是胶水**——在两个完全不同的场景之间，如果环境音提前 0.5 秒切入（J-cut），视觉的跳跃会被声音桥接住
4. **速度操纵无处不在**——几乎每个镜头都有轻微的变速（加速或减速），让画面的节奏不是匀速的"纪录"感，而是有呼吸的"感受"感

### 7.3 每个转场的具体执行指引

#### 01→02：水壶口 → 十字路口（形状 match）

- **01 最后一帧要求**：水壶口的圆形在 MC 位置，从正上方看（即使整个镜头不是俯拍，最后 0.5 秒可以过渡到更俯视的角度）
- **02 第一帧要求**：十字路口的放射状线条在 MC 位置
- **后期处理**：2 帧交叉淡化。两个圆形重叠在同一位置，大脑会把它们读成"同一个东西变成了另一个东西"
- **声音桥**：水壶沸腾声 → 提前 0.3 秒切入街道环境音，水声渐弱

#### 03→04：窗边人 → 文字墙（质感 match）

- **03 最后一帧**：桌面木纹在画面下半部分
- **04 全画面**：水泥墙的暖灰纹理
- **关键**：两者的纹理方向保持一致（水平方向为主）。色调接近（暖灰对暖灰）
- **后期**：硬切（hard cut），不需要淡化——质感本身的相似性足够平滑
- **声音桥**：哼唱声在 03 尾部微微降低，04 的 2 秒纯静默让 "Everyone hums." 这句话有阅读空间

#### 05A→05B→05C→05D 蒙太奇内部转场

这组 4 个镜头之间的转场应该感觉像**同一个长镜头被切成了 4 段**。实现方法：

- **共享介质**：05A 透过玻璃 → 05B 透过挡风玻璃 → 05C 雨窗玻璃 → 05D 直接看天空。前三个都隔着"玻璃"看，第四个打破了玻璃——像走出一个封闭空间
- **光源位置连续性**：每个镜头的主光源都在画面右侧（05A 便利店内光在右、05B 落日在右、05C 窗外光在右、05D 地平线光从右展开）。眼睛会追踪这个光源位置的一致性
- **声音连续性**：哼唱旋律不中断地穿过所有 4 个场景。每个 cut 点落在旋律的拍间休止上（不是在音符上切，是在音符之间切）

#### 06→07A：花开 → 钢琴（展开 match）

- **06 最后一帧**：花瓣完全展开，从中心向外辐射
- **07A 第一帧**：手指从琴键向上展开/离开
- **match 逻辑**：两者都是"从中心向外的展开运动"。花瓣打开 = 手指抬起。方向匹配
- **后期**：Cut on action——在花瓣打开动作的最大速度点切换到手指抬起的同一运动阶段

#### 08→09：人脸 → 代码动效（色温延续）

这是全片最关键的转场——从 AI 生成画面过渡到自制动效。必须无缝。

- **08 最后一帧**：金色侧光照亮的脸，画面色温偏蜂蜜金
- **09A 第一帧**：`#F5F1EB` 背景 + 灰色波形线出现
- **过渡策略**：08 的最后 0.5 秒，画面做一个非常缓慢的过曝（exposure 从正常逐渐提亮 1.5 档），金色→乳白→`#F5F1EB`。波形线在过曝到最亮的那一帧开始出现。观众感觉"金色的光扩散成了空白，然后空白中出现了线条"
- **声音**：音乐在 08→09 的过渡点做一个 brief pause（0.3 秒微静默），然后以简化后的旋律线重新进入——这个重新进入和波形线的出现同步

#### 09→10：动效卡片 → 两人递手机（矩形 match）

- **09C 最后一帧**：Murmur 音乐卡片悬浮在 MC 位置，约占画面 35% 宽度
- **10 第一帧**：手机在两人之间的 MC 位置，大小和卡片接近
- **过渡策略**：09C 的卡片在最后 0.3 秒做一个极轻微的"缩小+位移"，向 MC 略偏右移动，同时 Scene 10 从 0% opacity 淡入。卡片的矩形"变成了"手机的矩形。后期用 2-3 帧交叉淡化

### 7.4 AI 生成时的锚定规则总结

为了让以上所有 match cut 可行，在 AI 生成种子帧时要遵守：

1. **每个镜头生成多版**（至少 4 版），从中挑选锚定元素位置最接近要求的版本
2. **锚定元素的位置用九宫格描述**（TL/TC/TR/ML/MC/MR/BL/BC/BR），在 prompt 末尾明确写出 "Place the [element] at the [position] of the frame"
3. **相邻镜头的主色温在 Kelvin 值上不要跳超过 1000K**——除非是故意的情绪转折（如 05D→06 从冷到暖的转折点）
4. **运动方向用时钟方位描述**：如果 Scene A 的运动是"3 点钟方向"，Scene B 的运动最好也从"3 点钟方向"延续或从"9 点钟方向"对冲
5. **速度操纵预留**：所有 AI 生成视频以 24fps 或 30fps 生成原速，后期用 DaVinci 的 Optical Flow 做变速处理（加速 1.2x 或减速 0.8x），以匹配音乐节拍
