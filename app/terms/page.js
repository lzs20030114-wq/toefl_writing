"use client";

const FONT = "'Plus Jakarta Sans','Noto Sans SC',system-ui,sans-serif";

const S = {
  page: { maxWidth: 720, margin: "0 auto", padding: "40px 24px 80px", fontFamily: FONT, color: "#1e293b", lineHeight: 1.8 },
  h1: { fontSize: 22, fontWeight: 800, marginBottom: 4 },
  updated: { fontSize: 12, color: "#94a3b8", marginBottom: 32 },
  h2: { fontSize: 16, fontWeight: 700, marginTop: 32, marginBottom: 8, paddingBottom: 6, borderBottom: "1px solid #e2e8f0" },
  p: { fontSize: 14, color: "#334155", marginBottom: 12 },
  ul: { fontSize: 14, color: "#334155", paddingLeft: 20, marginBottom: 12 },
  back: { display: "inline-block", marginBottom: 24, fontSize: 13, color: "#3b82f6", textDecoration: "none", cursor: "pointer", fontFamily: FONT },
};

export default function TermsPage() {
  return (
    <div style={S.page}>
      <a href="/" style={S.back}>&larr; 返回首页</a>
      <h1 style={S.h1}>使用条款与隐私政策</h1>
      <div style={S.updated}>最后更新：2026 年 3 月 15 日</div>

      <p style={S.p}>
        欢迎使用 Tree Practice（以下简称"本平台"）。使用本平台即表示您同意以下条款。如不同意，请停止使用。
      </p>

      <h2 style={S.h2}>一、服务说明</h2>
      <p style={S.p}>
        本平台提供基于人工智能的英语写作练习服务（适用于 TOEFL® 备考），包括但不限于：题目生成、写作练习、AI 评分与反馈。
  </p>
      <ul style={S.ul}>
        <li>AI 生成的评分和反馈仅供参考，不代表任何官方考试评分标准，不保证与实际考试结果一致。</li>
        <li>题目内容由 AI 生成，本平台不对其准确性、完整性或适用性做出保证。</li>
        <li>本平台与 ETS 无任何关联，也未获得其认可。TOEFL® 和 TOEFL iBT® 为 Educational Testing Service (ETS) 的注册商标。本平台对这些商标的使用仅为说明产品用途，不暗示任何赞助或背书关系。</li>
      </ul>

      <h2 style={S.h2}>二、账户与使用规范</h2>
      <ul style={S.ul}>
        <li>每个账户仅供一人使用，不得转让、出借或出售。</li>
        <li>禁止使用自动化脚本、爬虫或其他技术手段大量请求服务。</li>
        <li>禁止对平台进行反向工程、攻击、注入或其他破坏行为。</li>
        <li>为保障服务稳定，系统对异常高频使用设有保护机制。触发后将暂时限制访问。</li>
        <li>本平台保留对违反规定的账户进行限制或封禁的权利，且无需事先通知。</li>
      </ul>

      <h2 style={S.h2}>三、免费与付费服务</h2>
      <ul style={S.ul}>
        <li>免费用户每日享有有限次数的练习机会。</li>
        <li>付费用户（Pro）在有效期内享有更多练习次数，具体以购买方案为准。</li>
        <li>付费通过第三方平台"爱发电"(afdian.com) 完成，本平台不直接处理支付信息。</li>
        <li><strong>付款后需在爱发电留言栏填写您的登录码，系统将自动开通服务。如未正确填写，可能导致无法自动开通。</strong></li>
        <li>由于数字服务的特殊性，付费后原则上不支持退款。如遇特殊情况，请联系我们协商处理。</li>
        <li>Pro 有效期到期后，账户将自动恢复为免费用户，已保存的练习记录不受影响。</li>
      </ul>

      <h2 style={S.h2}>四、隐私与数据</h2>
      <ul style={S.ul}>
        <li>本平台收集的信息包括：邮箱地址（用于登录验证）、练习内容与评分记录、使用频次统计。</li>
        <li>我们不会将您的个人信息出售或分享给第三方，除非法律要求。</li>
        <li>练习内容可能被用于改进 AI 评分质量，但不会公开展示或关联到个人身份。</li>
        <li>您可以随时联系我们删除您的账户和相关数据。</li>
      </ul>

      <h2 style={S.h2}>五、服务可用性</h2>
      <ul style={S.ul}>
        <li>本平台不承诺 100% 的服务可用性。可能因维护、升级或不可抗力导致服务中断。</li>
        <li>因服务中断造成的使用时间损失，本平台不予补偿，但会尽力减少影响。</li>
        <li>本平台保留随时修改、暂停或终止服务的权利。</li>
      </ul>

      <h2 style={S.h2}>六、免责声明</h2>
      <ul style={S.ul}>
        <li>本平台按"现状"提供服务，不做任何明示或暗示的保证。</li>
        <li>对于因使用本平台产生的任何直接或间接损失，本平台不承担责任。</li>
        <li>用户应自行判断 AI 反馈的参考价值，本平台不对用户的考试成绩负责。</li>
      </ul>

      <h2 style={S.h2}>七、条款变更</h2>
      <p style={S.p}>
        本平台保留随时修改本条款的权利。修改后的条款将在页面上公布，继续使用本平台即视为同意修改后的条款。
      </p>

      <h2 style={S.h2}>八、联系方式</h2>
      <p style={S.p}>
        如有任何问题或需要帮助，请通过平台内的反馈功能联系我们。
      </p>
    </div>
  );
}
