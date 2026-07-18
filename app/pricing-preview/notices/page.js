import Link from "next/link";
import styles from "./PolicyCenter.module.css";

export const metadata = {
  title: "服务说明中心（内部预览）",
  robots: { index: false, follow: false },
};

const DOCS = [
  { id: "pro", title: "Pro 服务规则" },
  { id: "credits", title: "点数使用说明" },
  { id: "refunds", title: "退款与异常处理" },
  { id: "data", title: "AI 与语音数据说明" },
];

function ResponsibilityRows() {
  return (
    <div className={styles.responsibilityTable}>
      <div className={styles.tableHead}><span>事项</span><span>平台责任</span><span>用户责任</span></div>
      <div><strong>账户</strong><span>提供登录、记录查询和异常申诉渠道</span><span>妥善保管登录凭证，不转让或共享账户</span></div>
      <div><strong>订阅与点数</strong><span>按页面说明发放权益，记录流水，处理重复扣点和失败退点</span><span>购买前确认方案、有效期和点数规则</span></div>
      <div><strong>AI 结果</strong><span>标明结果用途和局限，修复可复现的系统错误</span><span>将评分和反馈作为练习参考，不视为官方考试结果</span></div>
      <div><strong>语音与内容</strong><span>按已告知的目的、范围和期限处理，并采取必要的安全措施</span><span>仅上传本人有权使用的内容，不提交违法或侵权材料</span></div>
    </div>
  );
}

export default function PolicyCenterPage() {
  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <Link href="/pricing-preview" className={styles.back}>← 返回 Pro 与点数</Link>
        <div className={styles.titleRow}>
          <div>
            <span className={styles.eyebrow}>INTERNAL PREVIEW</span>
            <h1>服务说明中心</h1>
            <p>集中说明订阅、点数、退款、AI 与语音数据相关规则。</p>
          </div>
          <div className={styles.version}>内部草案 v0.1<br />更新于 2026 年 7 月 14 日</div>
        </div>
        <div className={styles.draftNotice}>
          本页面尚未上线，也不构成最终法律文本。正式发布前需补齐经营主体、联系方式、支付渠道、第三方处理者和实际数据保存期限，并由专业法律人员复核。
        </div>
      </header>

      <div className={styles.layout}>
        <aside className={styles.sidebar}>
          <span>目录</span>
          {DOCS.map((doc) => <a key={doc.id} href={"#" + doc.id}>{doc.title}</a>)}
          <a href="#responsibilities">责任划分</a>
        </aside>

        <article className={styles.content}>
          <section id="pro">
            <div className={styles.sectionHeader}>
              <span>01</span>
              <div><h2>Pro 服务规则</h2><p>适用于 Pro 订阅的购买、使用和到期处理。</p></div>
            </div>
            <h3>方案与有效期</h3>
            <ul>
              <li>方案价格、有效期、点数数量和发放频率，以购买确认页面展示的内容为准。</li>
              <li>7 天体验卡和 30 天月卡的点数一次性发放；季卡和年卡按页面标明的周期发放。</li>
              <li>当前预览方案不自动续费。未来如增加自动续费，将另行明确扣费周期、取消方式和提醒规则。</li>
              <li>订阅到期后，Pro 权益停止；练习记录和用户购买的长期有效点数不因订阅到期删除。</li>
            </ul>
            <h3>服务调整</h3>
            <p>涉及价格、点数数量、有效期或主要功能范围的调整，将在生效前通过页面公告等合理方式说明。已生效订单在当前有效期内按购买时确认的规则执行，法律另有规定或双方另有约定的除外。</p>
          </section>

          <section id="credits">
            <div className={styles.sectionHeader}>
              <span>02</span>
              <div><h2>点数使用说明</h2><p>说明点数来源、扣除顺序、有效期和异常退回。</p></div>
            </div>
            <div className={styles.definitionGrid}>
              <div><strong>订阅点数</strong><p>随 Pro 订阅按周期发放，优先使用；到期规则以购买页面为准。</p></div>
              <div><strong>加量点数</strong><p>用户单独购买，当前方案为长期有效；订阅到期后仍可保留。</p></div>
            </div>
            <h3>扣点规则</h3>
            <ul>
              <li>AI 评分：每次成功返回完整结果扣 1 点。</li>
              <li>口语转写：按实际开始处理的音频时长计费，每 30 秒扣 1 点；不足 30 秒按 30 秒计。</li>
              <li>公共听力、阅读题库、模拟考试和已生成音频的重复播放不扣点。</li>
              <li>同一请求重试不会重复扣点。系统失败、超时或未返回可用结果时不扣点；已经扣除的点数自动退回。</li>
              <li>点数余额和流水以账户内记录为准。用户认为记录有误时，可通过反馈入口申请核查。</li>
            </ul>
          </section>

          <section id="refunds">
            <div className={styles.sectionHeader}>
              <span>03</span>
              <div><h2>退款与异常处理</h2><p>权益正常开通后，个人原因原则上不支持退款；法定和履约异常情形除外。</p></div>
            </div>
            <h3>可以申请核查的情形</h3>
            <ul>
              <li>同一订单被重复扣款，或付款成功后权益未到账且无法在合理时间内补发。</li>
              <li>平台原因导致已购买的主要服务持续无法提供，且无法通过修复、补发点数或延长有效期解决。</li>
              <li>订单信息与实际开通的方案、有效期或点数数量不一致。</li>
              <li>法律法规或支付渠道规则规定应当退款的其他情形。</li>
            </ul>
            <h3>个人原因原则上不退款</h3>
            <p>权益已经正常开通且平台能够按约提供服务后，因备考计划变化、选错方案、未充分使用、忘记使用或对 AI 结果的主观评价差异等个人原因提出的退款，原则上不予支持。</p>
            <h3>法定权利</h3>
            <p>首次购买相同服务且依法享有无理由退款或合同解除权的用户，仍按适用法律处理。本规则不排除或限制用户依法享有的退款、解除合同、投诉或争议解决权利。</p>
            <h3>申请与处理渠道</h3>
            <p>付款由爱发电处理。本网站不提供即时自动退款。用户可通过平台反馈入口或爱发电订单联系售后；核查通过后，退款或部分退款通过爱发电原订单协商处理。平台也可根据实际影响采取补开权益、退回点数或延长有效期等方式处理。</p>
          </section>

          <section id="data">
            <div className={styles.sectionHeader}>
              <span>04</span>
              <div><h2>AI 与语音数据说明</h2><p>说明 AI 输出的性质以及语音、文本和使用记录如何处理。</p></div>
            </div>
            <h3>AI 结果</h3>
            <ul>
              <li>AI 评分、转写和反馈用于学习练习，不是 TOEFL 官方评分，也不保证与真实考试结果一致。</li>
              <li>用户应结合题目、评分标准和自身情况判断反馈内容；发现明显错误时可提交反馈。</li>
            </ul>
            <h3>语音与个人信息</h3>
            <ul>
              <li>为提供转写、评分或播放功能，平台可能处理用户提交的语音、转写文本、练习内容和必要的技术日志。</li>
              <li>正式版本将以清单方式列明处理目的、信息种类、第三方服务提供者、保存期限、存储地点和删除方式。</li>
              <li>未经另行明确告知并取得依法所需的同意，不将用户语音用于公开展示或与本次服务无关的模型训练。</li>
              <li>用户可通过平台提供的入口申请查阅、更正、删除相关信息，或撤回基于同意开展的处理。</li>
            </ul>
          </section>

          <section id="responsibilities">
            <div className={styles.sectionHeader}>
              <span>05</span>
              <div><h2>责任划分</h2><p>将平台责任和用户责任分别列明。</p></div>
            </div>
            <ResponsibilityRows />
            <div className={styles.boundaryNote}>
              第三方支付、AI 或网络服务发生故障时，平台负责提供合理的排查和协调，并按照实际影响处理点数或订单；第三方故障不当然免除平台依法或依约应承担的责任。
            </div>
          </section>
        </article>
      </div>
    </main>
  );
}
