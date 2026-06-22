"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import {
  ArrowLeft,
  Ban,
  BookOpen,
  CreditCard,
  FileText,
  Gavel,
  Globe,
  Mail,
  Music2,
  RefreshCcw,
  Scale,
  ShieldCheck,
  UserCheck,
} from "lucide-react";

import { useCurrentLang } from "@/lib/i18n";
import type { Lang } from "@/lib/i18n";
import { PageBackdrop } from "@/components/murmur/page-backdrop";

type L = Record<Lang, string>;

function pick(text: L, lang: Lang): string {
  return text[lang];
}

const UPDATED_AT: L = {
  zh: "生效日期：2026 年 6 月 18 日",
  en: "Effective: June 18, 2026",
};

const HERO = {
  eyebrow: { zh: "TERMS OF SERVICE", en: "TERMS OF SERVICE" } as L,
  title: { zh: "在你开始哼唱之前。", en: "Before you start humming." } as L,
  intro: {
    zh: "这份条款说明了你在使用 Murmur 时的权利、义务和我们之间的约定。使用 Murmur 即表示你同意以下条款。",
    en: "These terms explain your rights, obligations, and our mutual agreement when you use Murmur. By using Murmur you agree to these terms.",
  } as L,
};

type SummaryItem = { icon: ReactNode; title: L; body: L };

const SUMMARY_ITEMS: SummaryItem[] = [
  {
    icon: <UserCheck className="h-4 w-4" />,
    title: {
      zh: "你使用，即代表同意",
      en: "Use means agreement",
    },
    body: {
      zh: "访问或使用 Murmur 的任何功能即表示你接受本条款。如果你不同意，请停止使用。",
      en: "Accessing or using any feature of Murmur means you accept these terms. If you disagree, please stop using the service.",
    },
  },
  {
    icon: <Music2 className="h-4 w-4" />,
    title: {
      zh: "你的旋律是你的",
      en: "Your melodies are yours",
    },
    body: {
      zh: "你保留对自己创作内容的权利。Murmur 只获取运行服务所需的有限许可。",
      en: "You retain rights to your creative content. Murmur only receives a limited license to operate the service.",
    },
  },
  {
    icon: <CreditCard className="h-4 w-4" />,
    title: {
      zh: "音磅不可退款",
      en: "Notes are non-refundable",
    },
    body: {
      zh: "已购买的音磅属于预付型虚拟额度，除法律另有规定外，一般不予退款。",
      en: "Purchased notes are prepaid virtual credits and are generally non-refundable unless required by law.",
    },
  },
  {
    icon: <Scale className="h-4 w-4" />,
    title: {
      zh: "我们可能会修改条款",
      en: "Terms may be updated",
    },
    body: {
      zh: "我们会在重大变更时通知你。继续使用即表示接受更新后的条款。",
      en: "We will notify you of material changes. Continued use after notice constitutes acceptance.",
    },
  },
];

type TermsSection = {
  id: string;
  icon: ReactNode;
  eyebrow: L;
  title: L;
  paragraphs: L[];
};

const SECTIONS: TermsSection[] = [
  {
    id: "service",
    icon: <BookOpen className="h-4 w-4" />,
    eyebrow: { zh: "SERVICE", en: "SERVICE" },
    title: { zh: "服务说明", en: "Service description" },
    paragraphs: [
      {
        zh: "Murmur 是一个由 [p → q] 运营的音乐创作工具，让你通过哼唱录制旋律，并由系统自动编曲、生成可保存和分享的小歌。服务包括但不限于：录音与旋律转写、AI 辅助编曲、歌曲保存与管理、封面生成、音频与视频导出，以及分享功能。",
        en: "Murmur is a music-creation tool operated by [p → q] that lets you record a hummed melody and have it automatically arranged into a small song you can save and share. The service includes, but is not limited to: recording and melody transcription, AI-assisted arrangement, song storage and management, cover art generation, audio and video export, and sharing features.",
      },
      {
        zh: "Murmur 目前处于早期产品阶段。功能、定价、可用性和服务范围可能会随时调整，不另行通知。我们会尽力保持服务的连续性，但不对服务的持续可用性作出保证。",
        en: "Murmur is currently in an early product stage. Features, pricing, availability, and scope of service may change at any time without prior notice. We will make reasonable efforts to maintain continuity but do not guarantee uninterrupted availability.",
      },
    ],
  },
  {
    id: "eligibility",
    icon: <UserCheck className="h-4 w-4" />,
    eyebrow: { zh: "ELIGIBILITY", en: "ELIGIBILITY" },
    title: { zh: "使用资格", en: "Eligibility" },
    paragraphs: [
      {
        zh: "你必须年满 13 周岁（或你所在法域规定的最低数字服务使用年龄）才能使用 Murmur。如果你未满法定成年年龄，应在监护人知情和同意的情况下使用。",
        en: "You must be at least 13 years old (or the minimum age for digital services in your jurisdiction) to use Murmur. If you are under the age of legal majority, you should use the service with the knowledge and consent of a parent or guardian.",
      },
      {
        zh: "使用 Murmur 即表示你声明并保证你具备接受本条款的法律行为能力，或已获得必要的监护人授权。",
        en: "By using Murmur, you represent and warrant that you have the legal capacity to accept these terms, or have obtained the necessary guardian authorization.",
      },
    ],
  },
  {
    id: "accounts",
    icon: <ShieldCheck className="h-4 w-4" />,
    eyebrow: { zh: "ACCOUNTS", en: "ACCOUNTS" },
    title: { zh: "账号与安全", en: "Accounts and security" },
    paragraphs: [
      {
        zh: "Murmur 支持通过 Google OAuth 登录，也允许以本地访客身份有限体验。你有责任保管好自己的登录凭证和账号安全。因你的凭证被他人使用而产生的活动，由你自行承担。",
        en: "Murmur supports sign-in via Google OAuth and also allows limited use as a local guest. You are responsible for safeguarding your login credentials and account security. Activities arising from the use of your credentials by others are your responsibility.",
      },
      {
        zh: "每位用户应只注册一个账号。我们保留在发现多账号滥用时合并或停用重复账号的权利。",
        en: "Each user should register only one account. We reserve the right to merge or deactivate duplicate accounts if multi-account abuse is detected.",
      },
    ],
  },
  {
    id: "content",
    icon: <FileText className="h-4 w-4" />,
    eyebrow: { zh: "CONTENT", en: "CONTENT" },
    title: { zh: "内容所有权与许可", en: "Content ownership and license" },
    paragraphs: [
      {
        zh: "你录制的原始哼唱和由此生成的旋律、歌曲属于你的创作内容（以下简称「用户内容」）。Murmur 不会主张对你的用户内容的所有权。",
        en: "Your recorded hums and the melodies and songs generated from them are your creative content (hereinafter 'User Content'). Murmur does not claim ownership of your User Content.",
      },
      {
        zh: "为了运营服务，你授予 Murmur 一项全球范围的、非独占的、免版税的、可转授权的有限许可，仅用于：存储、处理、转写、编曲、渲染、缓存和向你展示你的用户内容；以及在你主动触发时执行导出、分享操作。此许可在你删除相关内容或账号后终止（但已执行的导出和分享不可撤回）。",
        en: "To operate the service, you grant Murmur a worldwide, non-exclusive, royalty-free, sublicensable limited license solely to: store, process, transcribe, arrange, render, cache, and display your User Content to you; and perform export and sharing operations when you initiate them. This license terminates when you delete the relevant content or account (exports and shares already executed are irrevocable).",
      },
      {
        zh: "Murmur 生成的编曲、封面、视觉效果等衍生元素中，AI 模型和模板所贡献的部分由 Murmur 或其许可方保留权利。你可以将完整作品（含衍生元素）用于个人和非商业目的。如需商业使用，请联系我们获取额外授权。",
        en: "In the derivative elements generated by Murmur — such as arrangements, cover art, and visual effects — the portions contributed by AI models and templates are retained by Murmur or its licensors. You may use the complete work (including derivative elements) for personal and non-commercial purposes. For commercial use, please contact us for additional authorization.",
      },
    ],
  },
  {
    id: "usage",
    icon: <Ban className="h-4 w-4" />,
    eyebrow: { zh: "USAGE RULES", en: "USAGE RULES" },
    title: { zh: "使用规则", en: "Acceptable use" },
    paragraphs: [
      {
        zh: "你同意不将 Murmur 用于以下用途：上传、录制或生成包含非法、侵权、仇恨、色情、暴力或骚扰性内容的材料；尝试对服务进行逆向工程、反编译或提取源代码；干扰或破坏服务的正常运行，包括但不限于发起拒绝服务攻击、注入恶意代码或超出合理使用量的自动化请求；冒充他人或虚假陈述你与任何个人或实体的关系；规避速率限制、音磅扣减机制或其他技术保护措施。",
        en: "You agree not to use Murmur for the following: uploading, recording, or generating material that is illegal, infringing, hateful, pornographic, violent, or harassing; attempting to reverse-engineer, decompile, or extract source code from the service; interfering with or disrupting the normal operation of the service, including but not limited to denial-of-service attacks, injection of malicious code, or automated requests exceeding reasonable usage; impersonating others or misrepresenting your affiliation with any person or entity; circumventing rate limits, note deduction mechanisms, or other technical safeguards.",
      },
      {
        zh: "违反上述规则可能导致账号被暂停或永久终止，且不退还已购买的音磅余额。",
        en: "Violation of these rules may result in account suspension or permanent termination, without refund of purchased note balances.",
      },
    ],
  },
  {
    id: "billing",
    icon: <CreditCard className="h-4 w-4" />,
    eyebrow: { zh: "BILLING", en: "BILLING" },
    title: { zh: "音磅、计费与支付", en: "Notes, billing, and payment" },
    paragraphs: [
      {
        zh: "Murmur 使用「音磅」（Murmur Notes）作为服务内虚拟额度。某些操作（如哼唱转写和编曲生成）会消耗音磅。音磅可以通过购买获得，也可能以免费赠送、活动奖励或推荐邀请等方式发放。",
        en: "Murmur uses 'Notes' (Murmur Notes) as in-service virtual credits. Certain operations (such as hum transcription and arrangement generation) consume notes. Notes can be acquired through purchase, and may also be granted via free allocations, promotional events, or referral rewards.",
      },
      {
        zh: "音磅不是货币，不可转让、交易或兑换为现金。音磅没有到期日，但在账号删除时将被清零。",
        en: "Notes are not currency and cannot be transferred, traded, or redeemed for cash. Notes do not expire, but will be forfeited upon account deletion.",
      },
      {
        zh: "支付处理由第三方支付服务商（如 Waffo）完成。Murmur 不直接存储你的完整银行卡号或支付账号信息。所有购买以下单时展示的价格和币种为准。",
        en: "Payment processing is handled by third-party payment providers (such as Waffo). Murmur does not directly store your full card numbers or payment account information. All purchases are charged at the price and currency displayed at the time of order.",
      },
      {
        zh: "Murmur 保留随时调整音磅定价、面额和消耗费率的权利。已购买的音磅余额不受后续定价变更的影响。",
        en: "Murmur reserves the right to adjust note pricing, denominations, and consumption rates at any time. Existing purchased note balances are not affected by subsequent pricing changes.",
      },
    ],
  },
  {
    id: "refunds",
    icon: <RefreshCcw className="h-4 w-4" />,
    eyebrow: { zh: "REFUNDS", en: "REFUNDS" },
    title: { zh: "退款政策", en: "Refund policy" },
    paragraphs: [
      {
        zh: "音磅属于一次性消耗型虚拟额度，购买后一般不予退款。以下情况除外：重复扣款或技术错误导致的多收费用，我们会核实后全额退还；因服务重大故障（非用户操作原因）导致音磅被错误扣减的，我们会补回对应音磅或按原支付方式退款；你所在法域的法律强制要求的退款权利。",
        en: "Notes are single-use virtual credits and are generally non-refundable after purchase. Exceptions include: duplicate charges or overcharges caused by technical errors, which will be fully refunded upon verification; notes incorrectly deducted due to a major service malfunction (not caused by user action), which will be restored or refunded via the original payment method; and refund rights mandated by the laws of your jurisdiction.",
      },
      {
        zh: "如需申请退款，请在购买后 14 个自然日内联系 hi@ptoq.io，并附上你的账号邮箱和订单编号。逾期申请将酌情处理。",
        en: "To request a refund, please contact hi@ptoq.io within 14 calendar days of purchase, including your account email and order number. Late requests will be handled at our discretion.",
      },
    ],
  },
  {
    id: "disclaimer",
    icon: <Gavel className="h-4 w-4" />,
    eyebrow: { zh: "DISCLAIMER", en: "DISCLAIMER" },
    title: { zh: "免责声明与责任限制", en: "Disclaimers and limitation of liability" },
    paragraphs: [
      {
        zh: "Murmur 按「现状」和「可用状态」提供服务，不提供任何明示或暗示的保证，包括但不限于对适销性、特定用途适用性、不侵权的保证，也不保证服务不会中断或无错误。",
        en: "Murmur is provided 'as is' and 'as available' without warranties of any kind, whether express or implied, including but not limited to warranties of merchantability, fitness for a particular purpose, or non-infringement. We do not guarantee uninterrupted or error-free service.",
      },
      {
        zh: "在适用法律允许的最大范围内，Murmur 及其运营方、关联方和许可方对因使用或无法使用服务而产生的任何直接、间接、附带、特殊、惩罚性或后果性损害概不负责，无论是否事先被告知此类损害的可能性。",
        en: "To the maximum extent permitted by applicable law, Murmur, its operators, affiliates, and licensors shall not be liable for any direct, indirect, incidental, special, punitive, or consequential damages arising out of or related to your use of or inability to use the service, regardless of whether we were advised of the possibility of such damages.",
      },
      {
        zh: "如果适用法律不允许完全排除或限制上述责任，我们的总累积责任不超过你在引发索赔的事件发生前 12 个月内实际支付给 Murmur 的费用总额，或人民币 100 元，以较高者为准。",
        en: "If applicable law does not allow complete exclusion or limitation of the above liability, our total cumulative liability shall not exceed the total fees you actually paid to Murmur in the 12 months preceding the event giving rise to the claim, or RMB 100, whichever is greater.",
      },
    ],
  },
  {
    id: "ip",
    icon: <ShieldCheck className="h-4 w-4" />,
    eyebrow: { zh: "INTELLECTUAL PROPERTY", en: "INTELLECTUAL PROPERTY" },
    title: { zh: "知识产权", en: "Intellectual property" },
    paragraphs: [
      {
        zh: "Murmur 的品牌名称、标志、界面设计、软件代码、AI 模型、编曲模板和文档等均为 [p → q] 或其许可方的知识产权，受著作权法和其他知识产权法保护。未经书面许可，你不得复制、修改、分发或以其他方式使用这些材料。",
        en: "The Murmur brand name, logo, interface design, software code, AI models, arrangement templates, and documentation are the intellectual property of [p → q] or its licensors, protected by copyright and other intellectual property laws. You may not copy, modify, distribute, or otherwise use these materials without written permission.",
      },
      {
        zh: "如果你认为 Murmur 上的内容侵犯了你的知识产权，请联系 hi@ptoq.io 并提供相关权属证明，我们会依法及时处理。",
        en: "If you believe content on Murmur infringes your intellectual property rights, please contact hi@ptoq.io with relevant proof of ownership. We will handle such matters promptly in accordance with applicable law.",
      },
    ],
  },
  {
    id: "termination",
    icon: <Ban className="h-4 w-4" />,
    eyebrow: { zh: "TERMINATION", en: "TERMINATION" },
    title: { zh: "终止与暂停", en: "Termination and suspension" },
    paragraphs: [
      {
        zh: "你可以随时通过应用内的「删除账号」功能或联系 hi@ptoq.io 请求终止你的账号。账号终止后，你的个人资料和歌曲数据将按隐私说明中描述的流程处理。",
        en: "You may terminate your account at any time via the in-app 'Delete account' feature or by contacting hi@ptoq.io. After termination, your profile and song data will be handled according to the process described in the Privacy notice.",
      },
      {
        zh: "我们保留在以下情况下暂停或终止你的账号的权利，恕不另行通知：违反本条款或使用规则；从事欺诈、滥用或非法活动；长期不活跃（超过 24 个月无登录）。暂停或终止账号时，已购买的音磅余额一般不予退还。",
        en: "We reserve the right to suspend or terminate your account without prior notice in the following circumstances: violation of these terms or usage rules; engagement in fraudulent, abusive, or illegal activity; prolonged inactivity (no sign-in for over 24 months). Purchased note balances are generally not refunded upon suspension or termination.",
      },
    ],
  },
  {
    id: "changes",
    icon: <RefreshCcw className="h-4 w-4" />,
    eyebrow: { zh: "CHANGES", en: "CHANGES" },
    title: { zh: "条款变更", en: "Changes to these terms" },
    paragraphs: [
      {
        zh: "我们可能会不时修订本条款。重大变更将通过应用内通知、邮件或在本页面顶部更新生效日期的方式告知你。变更发布后继续使用 Murmur 即表示你接受修订后的条款。",
        en: "We may revise these terms from time to time. Material changes will be communicated via in-app notification, email, or by updating the effective date at the top of this page. Continued use of Murmur after changes are posted constitutes acceptance of the revised terms.",
      },
      {
        zh: "如果你不同意修订后的条款，你有权在变更生效前停止使用服务并删除账号。",
        en: "If you disagree with the revised terms, you have the right to stop using the service and delete your account before the changes take effect.",
      },
    ],
  },
  {
    id: "governing",
    icon: <Globe className="h-4 w-4" />,
    eyebrow: { zh: "GOVERNING LAW", en: "GOVERNING LAW" },
    title: { zh: "适用法律与争议解决", en: "Governing law and disputes" },
    paragraphs: [
      {
        zh: "本条款受中华人民共和国法律管辖并据其解释（不适用冲突法规则）。如果你从中国大陆以外的地区访问 Murmur，你有责任遵守当地的法律法规。",
        en: "These terms are governed by and construed in accordance with the laws of the People's Republic of China (without regard to conflict-of-law principles). If you access Murmur from outside mainland China, you are responsible for compliance with local laws and regulations.",
      },
      {
        zh: "因本条款引起或与之相关的任何争议，双方应首先通过友好协商解决。协商不成的，任何一方可向运营方所在地有管辖权的人民法院提起诉讼。",
        en: "Any dispute arising out of or in connection with these terms shall first be resolved through amicable negotiation. If negotiation fails, either party may submit the dispute to a court of competent jurisdiction at the operator's place of business.",
      },
    ],
  },
];

export function TermsScreen() {
  const lang = useCurrentLang();

  const navLabels: Record<string, L> = {
    service: { zh: "服务说明", en: "Service" },
    eligibility: { zh: "使用资格", en: "Eligibility" },
    accounts: { zh: "账号与安全", en: "Accounts" },
    content: { zh: "内容与许可", en: "Content" },
    usage: { zh: "使用规则", en: "Usage rules" },
    billing: { zh: "计费与支付", en: "Billing" },
    refunds: { zh: "退款政策", en: "Refunds" },
    disclaimer: { zh: "免责声明", en: "Disclaimers" },
    ip: { zh: "知识产权", en: "IP" },
    termination: { zh: "终止与暂停", en: "Termination" },
    changes: { zh: "条款变更", en: "Changes" },
    governing: { zh: "适用法律", en: "Governing law" },
    contact: { zh: "联系", en: "Contact" },
  };

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
          aria-label={lang === "zh" ? "返回" : "Back"}
        >
          <ArrowLeft className="h-4 w-4" />
        </Link>

        {/* ── Hero ─────────────────────────────────────────────────── */}
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

        {/* ── Summary cards (dark block) ──────────────────────────── */}
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

        {/* ── Body: sidebar nav + sections ────────────────────────── */}
        <div className="mt-10 grid gap-8 lg:grid-cols-[15rem_1fr] lg:items-start">
          <aside className="lg:sticky lg:top-8">
            <nav
              aria-label={lang === "zh" ? "条款目录" : "Terms sections"}
              className="space-y-2 text-[13px] text-[#8C8780]"
            >
              {SECTIONS.map((s) => (
                <a
                  key={s.id}
                  href={`#${s.id}`}
                  className="block transition-colors hover:text-[#1A1A1A]"
                >
                  {pick(navLabels[s.id] ?? s.title, lang)}
                </a>
              ))}
              <a href="#contact" className="block transition-colors hover:text-[#1A1A1A]">
                {pick(navLabels.contact, lang)}
              </a>
            </nav>
          </aside>

          <div className="space-y-10">
            {SECTIONS.map((section) => (
              <section key={section.id} id={section.id} className="scroll-mt-8">
                <div>
                  <p className="eyebrow text-[#FF8A5C]">{pick(section.eyebrow, lang)}</p>
                  <h2 className="mt-3 text-[26px] font-medium leading-tight text-[#1A1A1A] md:text-[34px]">
                    {pick(section.title, lang)}
                  </h2>
                </div>
                <div className="mt-4 space-y-4">
                  {section.paragraphs.map((p) => (
                    <p
                      key={pick(p, "en").slice(0, 64)}
                      className="max-w-[44rem] text-[15px] leading-[1.75] text-[#3A3A3A]"
                    >
                      {pick(p, lang)}
                    </p>
                  ))}
                </div>
              </section>
            ))}

            {/* ── Contact ──────────────────────────────────────────── */}
            <section
              id="contact"
              className="scroll-mt-8 rounded-[14px] border border-[#E7DCCB] bg-[#FFFEFB] p-6 md:p-8"
            >
              <div className="flex flex-col gap-5 md:flex-row md:items-end md:justify-between">
                <div>
                  <p className="eyebrow text-[#FF8A5C]">CONTACT</p>
                  <h2 className="mt-3 text-[24px] font-medium leading-tight text-[#1A1A1A] md:text-[30px]">
                    {lang === "zh"
                      ? "条款相关问题，写信给我们。"
                      : "Questions about these terms? Write to us."}
                  </h2>
                  <p className="mt-3 max-w-[36rem] text-[14px] leading-[1.65] text-[#6F6A63]">
                    {lang === "zh"
                      ? "请附上你的账号邮箱和相关订单号（如涉及支付问题）。我们会在收到后尽快回复。"
                      : "Include your account email and relevant order number (if payment-related). We will respond as soon as possible."}
                  </p>
                </div>
                <a href="mailto:hi@ptoq.io" className="mm-btn-primary inline-flex shrink-0">
                  <Mail className="h-4 w-4" />
                  hi@ptoq.io
                </a>
              </div>
            </section>

            {/* ── Footer note ──────────────────────────────────────── */}
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
                  项目。本条款与{" "}
                  <Link
                    href="/me/privacy"
                    className="underline decoration-[#CFC5B7] underline-offset-4 transition-colors hover:text-[#1A1A1A]"
                  >
                    隐私说明
                  </Link>{" "}
                  共同构成你与 Murmur 之间的完整协议。如两份文件之间存在冲突，以本条款为准。
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
                  project. These terms, together with the{" "}
                  <Link
                    href="/me/privacy"
                    className="underline decoration-[#CFC5B7] underline-offset-4 transition-colors hover:text-[#1A1A1A]"
                  >
                    Privacy notice
                  </Link>
                  , form the entire agreement between you and Murmur. In the event of a conflict
                  between the two documents, these terms prevail.
                </>
              )}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
