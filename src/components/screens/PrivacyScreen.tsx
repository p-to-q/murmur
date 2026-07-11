"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  CreditCard,
  Database,
  EyeOff,
  LockKeyhole,
  Mail,
  Mic2,
  ServerCog,
  ShieldCheck,
  Sparkles,
  Trash2,
} from "lucide-react";

import { useCurrentLang, useTranslator } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

type LocalizedText = Record<Lang, string>;

type SummaryItem = {
  icon: ReactNode;
  title: LocalizedText;
  body: LocalizedText;
};

type DataItem = {
  icon: ReactNode;
  label: LocalizedText;
  collect: LocalizedText;
  why: LocalizedText;
  keep: LocalizedText;
};

type ProcessorItem = {
  icon: ReactNode;
  name: string;
  role: LocalizedText;
  note: LocalizedText;
};

type TextSection = {
  id: string;
  eyebrow: LocalizedText;
  title: LocalizedText;
  body: LocalizedText[];
};

const UPDATED_AT: LocalizedText = {
  zh: "生效于 2026 年 7 月 11 日",
  en: "Effective July 11, 2026",
};

const HERO = {
  eyebrow: {
    zh: "PRIVACY",
    en: "PRIVACY",
  },
  title: {
    zh: "你的哼唱，先属于你。",
    en: "Your hum belongs to you first.",
  },
  intro: {
    zh: "Murmur 会处理你的录音、旋律、作品和支付状态，用来把一段哼唱变成可以保存、编辑和分享的小歌。",
    en: "Murmur handles your recordings, melodies, songs, and payment state so a hum can become a song you can save, edit, and share.",
  },
};

const SUMMARY_ITEMS: SummaryItem[] = [
  {
    icon: <Mic2 className="h-4 w-4" />,
    title: {
      zh: "原始录音默认不会随账号长期保存",
      en: "Raw recordings are not kept with your account by default",
    },
    body: {
      zh: "录音会用于旋律转写；在使用原声风格引导时，也会随生成请求交给音乐处理服务。Murmur 默认保存旋律和歌曲数据，不把原始哼唱作为账号资产长期保存。",
      en: "A recording is used for melody transcription and, when raw-hum style conditioning is used, sent with the generation request to the music processor. Murmur saves melody and song data by default, not the original hum as a long-term account asset.",
    },
  },
  {
    icon: <EyeOff className="h-4 w-4" />,
    title: {
      zh: "作品默认是私人的",
      en: "Songs are private by default",
    },
    body: {
      zh: "你保存的歌、编曲和封面只在你的账户或本地演示空间里出现。只有当你主动导出或分享时，相关内容才会离开这个空间。",
      en: "Saved songs, arrangements, and visuals live in your account or local demo space. They leave that space only when you export or share them.",
    },
  },
  {
    icon: <ShieldCheck className="h-4 w-4" />,
    title: {
      zh: "不卖个人数据，不做广告追踪",
      en: "No sale of personal data, no ad tracking",
    },
    body: {
      zh: "Murmur 目前不接入通用广告分析 SDK，也不会出售你的个人数据。",
      en: "Murmur does not currently load generic ad analytics SDKs and does not sell your personal data to data brokers.",
    },
  },
  {
    icon: <Trash2 className="h-4 w-4" />,
    title: {
      zh: "你可以要求导出或删除",
      en: "You can ask to export or delete",
    },
    body: {
      zh: "账号删除入口在应用内；如果你需要数据副本、纠正信息或隐私支持，也可以直接联系 hi@ptoq.io。",
      en: "Account deletion is available in the app. For a data copy, correction, or privacy help, contact hi@ptoq.io.",
    },
  },
];

const DATA_ITEMS: DataItem[] = [
  {
    icon: <LockKeyhole className="h-4 w-4" />,
    label: { zh: "账号与登录", en: "Account and sign-in" },
    collect: {
      zh: "登录提供方返回的基础资料，例如名称、头像、邮箱或提供方 ID。",
      en: "Basic profile details from your sign-in provider, such as name, avatar, email, or provider ID.",
    },
    why: {
      zh: "用于识别你的歌架、同步余额、保护账号，并让你在不同设备上继续创作。",
      en: "To identify your song shelf, sync your balance, protect your account, and let you continue across devices.",
    },
    keep: {
      zh: "账号存在期间保留；你请求删除后，我们会按删除流程以及必要的账务、安全保留要求处理。",
      en: "Kept while your account exists; after a deletion request, handled through the deletion flow and required billing or security retention.",
    },
  },
  {
    icon: <Mic2 className="h-4 w-4" />,
    label: { zh: "哼唱录音与旋律", en: "Hummed audio and melody" },
    collect: {
      zh: "你录下或上传的短音频，以及转写出的音符、节奏、调性、质量诊断、目标乐器和原声风格引导强度。",
      en: "Short audio you record or upload, plus derived notes, rhythm, key, quality diagnostics, target instrument, and raw-hum conditioning strength.",
    },
    why: {
      zh: "用于识别旋律、修正噪音和跑调，并在对应生成请求中可选地用原始哼唱引导音乐的质感与表达。",
      en: "To identify melody, repair noise or pitch issues, and optionally condition a generation on the texture and expression of the original hum.",
    },
    keep: {
      zh: "原始录音默认只用于当次转写和适用的风格引导请求，不会作为账号资产长期保存；旋律结果会随作品一起保存。",
      en: "Raw audio is used for the transcription request and applicable style-conditioning requests by default, and is not kept as an account asset; melody results may be saved with the song.",
    },
  },
  {
    icon: <Sparkles className="h-4 w-4" />,
    label: { zh: "歌曲、编曲与导出", en: "Songs, arrangements, and exports" },
    collect: {
      zh: "标题、风格、BPM、调性、音轨状态、封面视觉配置、音频导出和分享文件。",
      en: "Title, vibe, BPM, key, track state, visual settings, audio exports, and share files.",
    },
    why: {
      zh: "用于保存、重新打开、播放、继续编辑、生成封面，以及导出你选择分享的内容。",
      en: "To save, reopen, play, keep editing, render cover art, and export shareable artifacts.",
    },
    keep: {
      zh: "保存在你的歌架里，直到你删除作品或账号；本地演示数据可能只留在当前设备。",
      en: "Kept in your shelf until you delete the song or account; local demo data may live only on the current device.",
    },
  },
  {
    icon: <CreditCard className="h-4 w-4" />,
    label: { zh: "音磅、购买与账务", en: "Notes, purchases, and billing" },
    collect: {
      zh: "音磅余额、消费记录、购买档位、收据邮箱、金额与币种、支付方式、支付方订单 ID、退款状态和账务回调事件。",
      en: "Notes balance, spend records, top-up tier, receipt email, amount and currency, payment method, provider order IDs, refund state, and billing callback events.",
    },
    why: {
      zh: "用于扣减创作消耗、发放购买的音磅、处理退款、防止重复到账，并完成账务核对。",
      en: "To debit creation actions, grant purchased notes, process refunds, prevent duplicate grants, and reconcile payments.",
    },
    keep: {
      zh: "按账务、税务、风控和支持需要保留。Murmur 不接收或保存完整银行卡号、微信支付凭据。",
      en: "Kept as needed for accounting, tax, fraud prevention, and support. Murmur does not receive or store full card numbers or WeChat Pay credentials.",
    },
  },
  {
    icon: <Database className="h-4 w-4" />,
    label: { zh: "设备偏好与本地状态", en: "Device preferences and local state" },
    collect: {
      zh: "语言、创作偏好、开发者模式、侧栏状态、本地音频解锁状态、游客音磅和少量本地事件。",
      en: "Language, creative preference, developer mode, sidebar state, local audio-unlock state, guest notes, and small local event history.",
    },
    why: {
      zh: "用于让当前设备上的体验保持稳定，也避免把每个小设置都同步到服务器。",
      en: "To keep the experience stable on this device without turning every small preference into server data.",
    },
    keep: {
      zh: "主要存在浏览器 localStorage 或 sessionStorage；清理浏览器数据会移除它们。",
      en: "Stored mainly in browser localStorage or sessionStorage; clearing browser data removes it.",
    },
  },
  {
    icon: <ServerCog className="h-4 w-4" />,
    label: { zh: "诊断、限制与安全日志", en: "Diagnostics, limits, and safety logs" },
    collect: {
      zh: "请求 ID、路由、错误码、耗时、速率限制状态、音频质量指标和非敏感运行诊断。",
      en: "Request IDs, routes, error codes, timing, rate-limit state, audio quality metrics, and non-sensitive runtime diagnostics.",
    },
    why: {
      zh: "用于排查失败、保护服务、防止滥用，并确认从哼唱到歌曲的路径没有退化。",
      en: "To debug failures, protect the service, prevent abuse, and confirm the hum-to-song path has not regressed.",
    },
    keep: {
      zh: "尽量最小化，优先保存排障所需的结构化信息，而不是原始创作内容。",
      en: "Minimized where possible, favoring structured troubleshooting data over raw creative content.",
    },
  },
];

const PROCESSORS: ProcessorItem[] = [
  {
    icon: <LockKeyhole className="h-4 w-4" />,
    name: "Google / Auth.js",
    role: {
      zh: "可选登录提供方",
      en: "Optional sign-in provider",
    },
    note: {
      zh: "用于完成 OAuth 登录。Murmur 只使用登录所需的基本账号资料。",
      en: "Used for OAuth sign-in. Murmur uses only the basic account details needed to log you in.",
    },
  },
  {
    icon: <Mic2 className="h-4 w-4" />,
    name: "Murmur audio worker",
    role: {
      zh: "哼唱转写服务",
      en: "Humming transcription service",
    },
    note: {
      zh: "处理短音频，并返回旋律、节奏和诊断结果。它不是公开社交平台。",
      en: "Processes short audio and returns melody, rhythm, and diagnostics. It is not a public social platform.",
    },
  },
  {
    icon: <Sparkles className="h-4 w-4" />,
    name: "RunPod",
    role: {
      zh: "生产音乐处理服务",
      en: "Production music processor",
    },
    note: {
      zh: "生产环境会发送生成提示、片段时长、请求标识和可选旋律。使用原声风格引导时，还会发送引导强度和原始哼唱音频；未使用时不会发送原始哼唱。",
      en: "Production requests include the generation prompt, clip duration, request identifier, and optional melody. When raw-hum style conditioning is used, Murmur also sends the conditioning strength and original hum audio; otherwise the raw hum is not sent for music generation.",
    },
  },
  {
    icon: <Sparkles className="h-4 w-4" />,
    name: "OpenAI-compatible AI gateway",
    role: {
      zh: "可选的 Studio 编辑理解",
      en: "Optional Studio edit understanding",
    },
    note: {
      zh: "当 AI 编辑可用时，Murmur 会发送你的编辑指令和必要上下文来理解要改什么，不会发送整段原始录音。",
      en: "When AI editing is enabled, Murmur sends your edit instruction and necessary context to understand the change, not the full raw recording.",
    },
  },
  {
    icon: <CreditCard className="h-4 w-4" />,
    name: "Waffo / ZPay / WeChat Pay",
    role: {
      zh: "支付与结账处理",
      en: "Payment and checkout processing",
    },
    note: {
      zh: "银行卡结账可由 Waffo 托管；符合条件的人民币微信支付可经 ZPay 发起。Murmur 会发送商品说明、金额与币种、内部账号和订单标识、返回与回调地址，以及支付所需的收据邮箱或客户端 IP，并接收订单结果来发放音磅。",
      en: "Waffo may host card checkout; eligible CNY WeChat Pay orders may be initiated through ZPay. Murmur sends the product description, amount and currency, internal account and order references, return and callback URLs, and the receipt email or client IP when required, then receives order results to grant notes.",
    },
  },
  {
    icon: <ServerCog className="h-4 w-4" />,
    name: "Hosting, database, and storage providers",
    role: {
      zh: "基础设施",
      en: "Infrastructure",
    },
    note: {
      zh: "用于运行网页、数据库、文件存储、备份，以及必要的安全监控。",
      en: "Used to run the web app, database, file storage, backups, and necessary security monitoring.",
    },
  },
];

const TEXT_SECTIONS: TextSection[] = [
  {
    id: "training",
    eyebrow: { zh: "AI 与训练", en: "AI AND TRAINING" },
    title: {
      zh: "你的作品不是默认训练素材。",
      en: "Your work is not default training material.",
    },
    body: [
      {
        zh: "Murmur 当前不会把你的原始哼唱、保存歌曲或导出作品作为通用模型训练数据出售或公开提供。",
        en: "Murmur does not currently sell or publicly provide your raw hums, saved songs, or exports as general model-training data.",
      },
      {
        zh: "如果未来某个质量改进计划需要保存原始音频样本，我们会把它做成明确选项，而不是默认开启；也会说明用途、保留期限和退出方式。",
        en: "If a future quality program needs to keep raw audio samples, it will be an explicit choice rather than a default setting, with purpose, retention, and opt-out details stated clearly.",
      },
    ],
  },
  {
    id: "sharing",
    eyebrow: { zh: "分享", en: "SHARING" },
    title: {
      zh: "分享发生在你按下分享之后。",
      en: "Sharing starts when you choose it.",
    },
    body: [
      {
        zh: "导出的音频、封面、HTML 或视频会包含你选择导出的歌曲内容。公开链接也请按公开内容来处理。",
        en: "Exported audio, cover images, HTML, or video include the song content you choose to export. Treat public links as public content.",
      },
      {
        zh: "Murmur 不会为了广告定向出售你的个人数据，也不会把你的私有歌架变成公开信息流。",
        en: "Murmur does not sell your personal data for ad targeting and does not turn your private shelf into a public feed.",
      },
    ],
  },
  {
    id: "rights",
    eyebrow: { zh: "你的选择", en: "YOUR CHOICES" },
    title: {
      zh: "你可以查看、纠正、导出或删除。",
      en: "You can view, correct, export, or delete.",
    },
    body: [
      {
        zh: "你可以在应用里删除账号。删除请求可能会有冷静期；到期后，个人资料和关联内容会被移除，除非法律、账务、退款、安全或争议处理要求我们保留有限记录。",
        en: "You can request account deletion in the app. A grace period may apply; after it ends, profile and linked content are removed unless limited records are required for law, billing, refunds, security, or dispute handling.",
      },
      {
        zh: "如果你需要数据副本、纠正信息、撤回同意、投诉，或处理地区隐私权利，请联系 hi@ptoq.io。",
        en: "For a data copy, correction, consent withdrawal, complaint, or region-specific privacy request, contact hi@ptoq.io.",
      },
    ],
  },
];

export function PrivacyScreen() {
  const t = useTranslator();
  const lang = useCurrentLang();

  return (
    <div className="relative min-h-svh overflow-hidden bg-[#F5F1EB] text-[#1A1A1A]">
      <PageBackdrop variant="soft" />

      <div
        className="relative z-10 mx-auto max-w-6xl px-5 pb-28 md:px-12"
        style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 42px)" }}
      >
        <Link
          href="/me"
          className="inline-flex h-9 w-9 items-center justify-center rounded-full border border-white/55 bg-white/70 transition-colors hover:bg-white"
          aria-label={t("common.back") || "Back"}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        <header className="mt-8 grid gap-8 md:grid-cols-[1.08fr_0.92fr] md:items-end">
          <div>
            <p className="eyebrow text-[#FF8A5C]">{pick(HERO.eyebrow, lang)}</p>
            <h1 className="hero-serif mt-4 max-w-[11ch] text-[46px] leading-[1.02] tracking-[0] md:text-[76px]">
              {pick(HERO.title, lang)}
            </h1>
          </div>

          <div className="max-w-[34rem] md:pb-2">
            <p className="font-serif-italic text-[17px] leading-[1.55] tracking-[0] text-[#6F6A63] md:text-[20px]">
              {pick(HERO.intro, lang)}
            </p>
            <p className="mt-5 text-[12px] uppercase tracking-[0.24em] text-[#B6B0A4]">
              {pick(UPDATED_AT, lang)}
            </p>
          </div>
        </header>

        <section className="mt-12 rounded-[14px] bg-[#1A1A1A] px-5 py-7 text-[#F5F1EB] md:px-8 md:py-8">
          <div className="grid gap-5 md:grid-cols-4">
            {SUMMARY_ITEMS.map((item) => (
              <article key={pick(item.title, "en")} className="space-y-3">
                <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#F5F1EB]/10 text-[#FF8A5C]">
                  {item.icon}
                </span>
                <h2 className="text-[15px] font-medium leading-snug text-[#FFFEFB]">
                  {pick(item.title, lang)}
                </h2>
                <p className="text-[13px] leading-[1.65] text-[#F5F1EB]/68">
                  {pick(item.body, lang)}
                </p>
              </article>
            ))}
          </div>
        </section>

        <div className="mt-10 grid gap-8 lg:grid-cols-[15rem_1fr] lg:items-start">
          <aside className="lg:sticky lg:top-8">
            <nav
              aria-label={lang === "zh" ? "隐私页面目录" : "Privacy sections"}
              className="space-y-2 text-[13px] text-[#8C8780]"
            >
              <a href="#data-map" className="block transition-colors hover:text-[#1A1A1A]">
                {lang === "zh" ? "数据地图" : "Data map"}
              </a>
              <a href="#processors" className="block transition-colors hover:text-[#1A1A1A]">
                {lang === "zh" ? "第三方处理" : "Processors"}
              </a>
              {TEXT_SECTIONS.map((section) => (
                <a
                  key={section.id}
                  href={`#${section.id}`}
                  className="block transition-colors hover:text-[#1A1A1A]"
                >
                  {pick(section.title, lang)}
                </a>
              ))}
              <a href="#contact" className="block transition-colors hover:text-[#1A1A1A]">
                {lang === "zh" ? "联系" : "Contact"}
              </a>
            </nav>
          </aside>

          <div className="space-y-10">
            <section id="data-map" className="scroll-mt-8">
              <SectionHeader
                eyebrow={lang === "zh" ? "DATA MAP" : "DATA MAP"}
                title={lang === "zh" ? "我们收集什么，以及为什么。" : "What we collect, and why."}
                body={
                  lang === "zh"
                    ? "我们把数据按用户真正关心的类别拆开：输入、作品、账号、支付、本地状态和诊断。"
                    : "Following the clearest privacy pages, we split data into the categories people actually ask about: inputs, work, account, payment, local state, and diagnostics."
                }
              />

              <div className="mt-5 grid gap-4 md:grid-cols-2">
                {DATA_ITEMS.map((item) => (
                  <article key={pick(item.label, "en")} className="mm-card p-5">
                    <div className="mb-4 flex items-center gap-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#EFE8DA] text-[#1A1A1A]">
                        {item.icon}
                      </span>
                      <h3 className="text-[15px] font-medium">{pick(item.label, lang)}</h3>
                    </div>
                    <DataLine
                      label={lang === "zh" ? "收集" : "Collect"}
                      value={pick(item.collect, lang)}
                    />
                    <DataLine
                      label={lang === "zh" ? "用途" : "Use"}
                      value={pick(item.why, lang)}
                    />
                    <DataLine
                      label={lang === "zh" ? "保留" : "Keep"}
                      value={pick(item.keep, lang)}
                    />
                  </article>
                ))}
              </div>
            </section>

            <section id="processors" className="scroll-mt-8">
              <SectionHeader
                eyebrow={lang === "zh" ? "SERVICE PROVIDERS" : "SERVICE PROVIDERS"}
                title={lang === "zh" ? "哪些服务会参与处理。" : "Services that may process data."}
                body={
                  lang === "zh"
                    ? "Murmur 把登录、转写、音乐生成、AI 编辑、支付和基础设施放在清晰边界后面。供应商只应为了提供对应功能处理必要数据。"
                    : "Murmur keeps sign-in, transcription, music generation, AI editing, payments, and infrastructure behind clear boundaries. Providers should process only the data needed for their role."
                }
              />

              <div className="mt-5 space-y-3">
                {PROCESSORS.map((processor) => (
                  <article
                    key={processor.name}
                    className="grid gap-4 rounded-[10px] border border-[#E7DCCB] bg-white/62 p-5 md:grid-cols-[12rem_1fr]"
                  >
                    <div className="flex items-center gap-3">
                      <span className="inline-flex h-8 w-8 items-center justify-center rounded-full bg-[#1A1A1A] text-[#F5F1EB]">
                        {processor.icon}
                      </span>
                      <div>
                        <h3 className="text-[14px] font-medium">{processor.name}</h3>
                        <p className="mt-1 text-[11px] uppercase tracking-[0.18em] text-[#B6B0A4]">
                          {pick(processor.role, lang)}
                        </p>
                      </div>
                    </div>
                    <p className="text-[14px] leading-[1.65] text-[#3A3A3A]">
                      {pick(processor.note, lang)}
                    </p>
                  </article>
                ))}
              </div>
            </section>

            {TEXT_SECTIONS.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-8">
                <SectionHeader
                  eyebrow={pick(section.eyebrow, lang)}
                  title={pick(section.title, lang)}
                />
                <div className="mt-4 space-y-4">
                  {section.body.map((paragraph) => (
                    <p
                      key={pick(paragraph, "en")}
                      className="max-w-[44rem] text-[15px] leading-[1.75] text-[#3A3A3A]"
                    >
                      {pick(paragraph, lang)}
                    </p>
                  ))}
                </div>
              </section>
            ))}

            <section
              id="contact"
              className="scroll-mt-8 rounded-[14px] border border-[#E7DCCB] bg-[#FFFEFB] p-6 md:p-8"
            >
              <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="eyebrow text-[#FF8A5C]">
                    {lang === "zh" ? "CONTACT" : "CONTACT"}
                  </p>
                  <h2 className="mt-3 text-[24px] font-medium leading-tight text-[#1A1A1A] md:text-[30px]">
                    {lang === "zh" ? "隐私问题，直接写给我们。" : "For privacy questions, write to us."}
                  </h2>
                  <p className="mt-3 max-w-[36rem] text-[14px] leading-[1.65] text-[#6F6A63]">
                    {lang === "zh"
                      ? "请尽量带上你的账号邮箱、相关歌曲 ID 或订单号。不要在邮件里发送银行卡号、身份证件照片或不必要的敏感信息。"
                      : "Include your account email, relevant song ID, or order number when useful. Please do not email card numbers, identity documents, or unnecessary sensitive details."}
                  </p>
                </div>
                <a href="mailto:hi@ptoq.io" className="mm-btn-primary inline-flex shrink-0">
                  <Mail className="h-4 w-4" />
                  hi@ptoq.io
                </a>
              </div>
            </section>

            <p className="max-w-[44rem] text-[12px] leading-[1.7] text-[#8C8780]">
              {lang === "zh" ? (
                <>
                  Murmur 是一个{" "}
                  <a
                    href="https://www.ptoq.io/writing"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-[#CFC5B7] underline-offset-4 transition-colors hover:text-[#1A1A1A]"
                  >
                    [p → q]
                  </a>{" "}
                  项目。这份说明描述的是当前 Murmur 产品的隐私实践。随着账号、移动端、通知或质量改进计划上线，我们会更新这里，并在需要重新同意时给出明确提示。
                </>
              ) : (
                <>
                  Murmur is a{" "}
                  <a
                    href="https://www.ptoq.io/writing"
                    target="_blank"
                    rel="noreferrer"
                    className="underline decoration-[#CFC5B7] underline-offset-4 transition-colors hover:text-[#1A1A1A]"
                  >
                    [p → q]
                  </a>{" "}
                  project. This notice describes Murmur&apos;s current privacy practices. As
                  account, mobile, notification, or quality-improvement features evolve, we will
                  update this page and ask for renewed consent when needed.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function SectionHeader({
  eyebrow,
  title,
  body,
}: {
  eyebrow: string;
  title: string;
  body?: string;
}) {
  return (
    <div>
      <p className="eyebrow text-[#FF8A5C]">{eyebrow}</p>
      <h2 className="mt-3 text-[26px] font-medium leading-tight text-[#1A1A1A] md:text-[34px]">
        {title}
      </h2>
      {body ? (
        <p className="mt-3 max-w-[42rem] text-[14px] leading-[1.65] text-[#6F6A63]">
          {body}
        </p>
      ) : null}
    </div>
  );
}

function DataLine({ label, value }: { label: string; value: string }) {
  return (
    <div className="border-t border-[#EFE8DA] py-3 first:border-t-0 first:pt-0 last:pb-0">
      <p className="text-[11px] uppercase tracking-[0.18em] text-[#B6B0A4]">{label}</p>
      <p className="mt-1 text-[13px] leading-[1.6] text-[#3A3A3A]">{value}</p>
    </div>
  );
}

function pick(text: LocalizedText, lang: Lang): string {
  return text[lang];
}
