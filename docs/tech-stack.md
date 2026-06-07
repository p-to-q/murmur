# Murmur 技术栈总览

## 📊 架构全景图

```
┌─────────────────────────────────────────────────────────────┐
│                     Frontend (Web)                           │
│  React 19 + Next.js 16 + TypeScript + Tailwind CSS 4        │
└──────────────────────┬──────────────────────────────────────┘
                       │
        ┌──────────────┼──────────────┐
        │              │              │
   ┌────▼──────┐  ┌────▼──────┐  ┌───▼──────┐
   │ Animation │  │  UI/UX    │  │ Realtime │
   │ framer    │  │ shadcn    │  │ Zustand  │
   │ motion    │  │ recharts  │  │ state    │
   └───────────┘  └───────────┘  └──────────┘
        │
┌───────▼─────────────────────────────────────────────────────┐
│              API Gateway & Backend Services                  │
│  Next.js API Routes + TypeScript + Zod Validation           │
└──────────────────────┬──────────────────────────────────────┘
        │
    ┌───┴────────────────────────┬─────────────────┐
    │                            │                 │
┌───▼──────────┐  ┌──────────────▼────┐  ┌────────▼───┐
│  Audio       │  │  LLM Services     │  │ Payment &  │
│  Processing  │  │  (Strummer/Stain) │  │ Billing    │
│  Worker      │  │  Python + FastAPI │  │ RevenueCat │
│  (Python)    │  │  Localhost:8001   │  │ Stripe     │
└──────────────┘  └───────────────────┘  └────────────┘
    │
┌───▴──────────────────────────────────────────────────────────┐
│           Data Layer & Storage                               │
│  PostgreSQL + Drizzle ORM + S3/R2 Compatible Storage         │
└──────────────────────────────────────────────────────────────┘
    │
┌───▴──────────────────────────────────────────────────────────┐
│           Infrastructure & DevOps                            │
│  Docker + Cloudflare Workers + GitHub Actions CI/CD          │
└──────────────────────────────────────────────────────────────┘
```

---

## 🎯 核心技术栈详解

### **Frontend 层** (Web UI)

#### 框架和运行时
| 技术 | 版本 | 用途 |
|------|------|------|
| **React** | 19.2.4 | UI 组件库 |
| **Next.js** | 16.2.4 | 全栈框架 (SSR/SSG) |
| **TypeScript** | 5.x | 类型安全 |
| **Bun** | 1.3.9 | 包管理 + 运行时 |

#### UI 和样式
| 技术 | 版本 | 用途 |
|------|------|------|
| **Tailwind CSS** | 4.x | 原子化 CSS 框架 |
| **Shadcn/ui** | 4.10.0 | 无头 UI 组件库 |
| **Lucide React** | 1.8.0 | 图标库 |
| **Geist** | 1.7.2 | 字体系统 |
| **LXGW WenKai TC** | 5.2.9 | 中文字体 |

#### 动画和交互
| 技术 | 版本 | 用途 |
|------|------|------|
| **Framer Motion** | 12.40.0 | 声明式动画库 |
| **React Spring** | 10.1.0 | 物理引擎动画 |
| **TW Animate CSS** | 1.4.0 | Tailwind 动画扩展 |
| **React Intersection Observer** | 10.0.3 | 可见性检测 |

#### 数据可视化
| 技术 | 版本 | 用途 |
|------|------|------|
| **Recharts** | 3.8.1 | React 图表库 |
| **React Masonry CSS** | 1.0.16 | 瀑布流布局 |

#### 音频处理
| 技术 | 版本 | 用途 |
|------|------|------|
| **Tone.js** | 14.7.77 | Web Audio API 包装层 |
| **Lamejs** | 1.2.7 | MP3 编码 (Web) |

#### 状态管理和数据
| 技术 | 版本 | 用途 |
|------|------|------|
| **Zustand** | 5.0.14 | 轻量级状态管理 |
| **IDB (IndexedDB)** | 8.0.3 | 本地数据库 |
| **Zod** | 4.3.6 | 运行时数据验证 |

#### 工具和通知
| 技术 | 版本 | 用途 |
|------|------|------|
| **Sonner** | 2.0.7 | 吐司通知库 |
| **HTML2Canvas** | 1.4.1 | 网页截图 |
| **Next Themes** | 0.4.6 | 主题切换 |
| **ULID** | 3.0.2 | 唯一 ID 生成 |

#### 开发工具
| 技术 | 版本 | 用途 |
|------|------|------|
| **ESLint** | 9.x | 代码检查 |
| **TypeScript** | 5.x | 编译器 |

---

### **Backend 层** (API 服务)

#### 核心框架
| 技术 | 版本 | 用途 |
|------|------|------|
| **Next.js API Routes** | 16.2.4 | REST API 端点 |
| **TypeScript** | 5.x | 类型安全 |

#### 数据库 ORM
| 技术 | 版本 | 用途 |
|------|------|------|
| **Drizzle ORM** | 0.45.2 | 类型安全的 SQL ORM |
| **PostgreSQL** | - | 主要数据库 |
| **Postgres Client** | 3.4.9 | PG 驱动 |

#### 认证和授权
| 技术 | 版本 | 用途 |
|------|------|------|
| **NextAuth.js** | 5.0.0-beta.31 | OAuth 认证 |

#### 云存储
| 技术 | 版本 | 用途 |
|------|------|------|
| **AWS SDK S3** | 3.1062.0 | S3/R2 兼容存储 |
| **S3 Request Presigner** | 3.1062.0 | 临时访问签名 |

#### AI 和 MCP
| 技术 | 版本 | 用途 |
|------|------|------|
| **MCP SDK** | 1.29.0 | 模型上下文协议 |

#### 验证和数据处理
| 技术 | 版本 | 用途 |
|------|------|------|
| **Zod** | 4.3.6 | Schema 验证 |
| **Class Variance Authority** | 0.7.1 | 条件样式组合 |
| **Clsx** | 2.1.1 | 条件类名 |
| **Tailwind Merge** | 3.6.0 | CSS 类合并 |

#### 环境管理
| 技术 | 版本 | 用途 |
|------|------|------|
| **Dotenv** | 17.4.2 | 环境变量管理 |

---

### **Audio Worker 层** (Python 微服务)

| 技术 | 用途 |
|------|------|
| **Python 3.11** | 音频处理脚本语言 |
| **FastAPI** | 轻量级 Web 框架 |
| **Uvicorn** | ASGI 服务器 |
| **pYIN** | 音高检测 |
| **SwiftF0** | 现代音高检测 |
| **DeepFilterNet** | 噪声抑制 |

音频处理流程:
```
User Hum (WebM/MP4)
        ↓
[AudioWorker - Python]
        ↓
pYIN/SwiftF0 提取音高
        ↓
DeepFilterNet 降噪
        ↓
Melody Polisher 优化
        ↓
JSON Response (CleanMelody)
        ↓
Browser
```

---

### **DevOps 和 CI/CD**

#### 容器化
| 技术 | 用途 |
|------|------|
| **Docker** | 容器化应用 |
| **Docker Compose** | 本地开发环境编排 |

#### 云平台
| 技术 | 用途 |
|------|------|
| **Cloudflare Workers** | 边缘计算 |
| **Vercel** | Next.js 部署 |
| **AWS S3/R2** | 存储后端 |

#### CI/CD 流程
| 工具 | 用途 |
|------|------|
| **GitHub Actions** | 自动化工作流 |
| **Dependabot** | 依赖更新 |
| **ESLint + TypeScript** | 代码质量检查 |
| **Bun test** | 单元测试 |

---

## 🔌 外部服务集成

| 服务 | 用途 | 集成 |
|------|------|------|
| **RevenueCat** | 应用内购买 | REST API |
| **Stripe** | 支付处理 | REST API + Webhook |
| **WeChat Pay** | 微信支付 | 中国本地支付 |
| **S3/R2/COS** | 存储 | AWS SDK |
| **Cloudflare** | CDN + Workers | API |

---

## 📈 性能特性

### 前端性能
- ✅ 代码分割 (Next.js automatic)
- ✅ 图像优化 (Next.js Image)
- ✅ 动画优化 (Framer Motion GPU 加速)
- ✅ 虚拟滚动 (React Intersection Observer)
- ✅ 缓存 (Zustand + IDB)

### 后端性能
- ✅ 数据库连接池 (Postgres)
- ✅ ORM 查询优化 (Drizzle)
- ✅ 速率限制 (Memory adapter)
- ✅ 请求去重 (inflight promise)
- ✅ 幂等性设计 (ledger system)

### 音频处理
- ✅ 流式处理
- ✅ GPU 加速 (可选)
- ✅ 多提供者支持 (pYIN/SwiftF0)

---

## 🔐 安全特性

| 层 | 措施 |
|----|------|
| **认证** | NextAuth.js OAuth + Session |
| **授权** | 基于角色的访问控制 |
| **数据验证** | Zod Schema 验证 |
| **API 安全** | 速率限制 + 幂等性 |
| **传输安全** | HTTPS + CSP 头 |
| **依赖安全** | Dependabot + CodeQL |

---

## 📊 技术栈评估

### 优势 ✅
- **全 TypeScript** - 类型安全覆盖前后端
- **现代工具链** - Bun, Next.js 16, React 19
- **灵活的音频处理** - 支持多种提供者
- **完整的支付集成** - 多种支付方式
- **云原生就绪** - S3/R2 兼容存储
- **高质量工程** - 完善的 CI/CD，测试覆盖

### 改进空间 ⚠️
- **存储抽象不完整** - rebuild 分支改进了这点
- **HTTP 超时处理** - rebuild 有更精细的 deadline 原语
- **跨地区部署** - 需要更多的基础设施代码
- **实时功能** - 暂无 WebSocket 或 Server-Sent Events

---

## 🚀 未来演进方向

### 短期（1-2 个月）
- [ ] 集成 rebuild 的 HTTP deadline 原语
- [ ] 完善存储适配器（S3/R2/COS）
- [ ] 添加 WebSocket 支持（实时协作）

### 中期（3-6 个月）
- [ ] Remix 迁移评估（Server Actions）
- [ ] 边缘函数优化（Cloudflare Workers）
- [ ] 多区域部署支持

### 长期（6+ 个月）
- [ ] 离线优先架构
- [ ] P2P 同步（Crdt）
- [ ] 移动原生版本 (React Native)

---

**总结**: 现在的技术栈是**现代、安全、高质量**的选择，适合**生产部署**。rebuild 分支的改进应该逐步融合到 main。
