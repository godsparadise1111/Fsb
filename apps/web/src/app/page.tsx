const modules = [
  { title: 'ساختار سازمانی', description: 'سازمان‌ها، واحدهای تودرتو و پست‌های سازمانی', status: 'هسته سازمانی', icon: '⌘' },
  { title: 'کاربران و دسترسی', description: 'مدیریت کاربران، عضویت‌ها، نقش‌ها و مجوزهای دقیق', status: 'کنترل دسترسی', icon: '♙' },
  { title: 'فرم‌ساز', description: 'طراحی فرم، نسخه‌بندی و دریافت اطلاعات ساختاریافته', status: 'طراحی و انتشار', icon: '▤' },
  { title: 'طراحی فرایند', description: 'تعریف مراحل، مسیرها، ارجاع و قواعد اجرای فرایند', status: 'موتور فرایند', icon: '◇' },
  { title: 'کارتابل گردش کار', description: 'اقدام، تأیید، رد و بازگشت مستند به مراحل قبلی', status: 'کارتابل عملیاتی', href: '/tasks', icon: '☷' },
  { title: 'داشبورد مدیریتی مشتری', description: 'شاخص‌های کلان، وظایف، فرایندها و هشدارهای سازمان', status: 'نمای مدیریتی', href: '/dashboard', icon: '▦' },
  { title: 'سلامت تجمیعی پلتفرم', description: 'پایش چندمشتری موتور گردش‌کار و صف اعلان‌ها', status: 'ویژه مدیر پلتفرم', href: '/platform-workflow-health', icon: '⌁' },
  { title: 'مدیریت تجاری پلتفرم', description: 'پلن‌ها، اشتراک مشتریان و صورتحساب‌های سازمانی', status: 'ویژه مدیر پلتفرم', href: '/platform-commercial', icon: '◫' },
  { title: 'داشبورد مدیر سازمان', description: 'عملکرد سازمان، وظایف معوق و هشدارهای SLA', status: 'تحلیل سازمانی', href: '/organization-dashboard', icon: '▥' },
  { title: 'رخدادهای بازیابی', description: 'بررسی رخدادهای Worker و رسیدگی ممیزی‌شده', status: 'پایش و بازیابی', href: '/recovery-incidents', icon: '↻' },
  { title: 'مدیریت صف اعلان‌ها', description: 'پایش Outbox، پیام‌های ناموفق و پردازش کنترل‌شده', status: 'عملیات اعلان', href: '/notifications', icon: '♧' },
  { title: 'تحلیل گلوگاه فرایندها', description: 'زمان انتظار، چرخه، تأخیر و نرخ برگشت مراحل', status: 'تحلیل عملیاتی', href: '/process-analytics', icon: '⌁' },
  { title: 'گزارش‌ها و اعلان‌ها', description: 'گزارش عملکرد، پایش SLA و تحلیل هشدارهای عملیاتی', status: 'گزارش مدیریتی', href: '/reports', icon: '▧' },
  { title: 'غیبت و جانشینی', description: 'ثبت غیبت و تعیین جانشین برای حفظ پیوستگی کار', status: 'مدیریت منابع', href: '/absences', icon: '◷' },
];

const highlights = [
  { title: 'معماری چندمشتری', detail: 'جداسازی داده و دسترسی در محدوده هر Tenant', number: '۰۱' },
  { title: 'گردش‌کار قابل ردیابی', detail: 'تاریخچه اقدامات، واگذاری و کنترل وضعیت فرایند', number: '۰۲' },
  { title: 'پایش و بازیابی', detail: 'ثبت رخدادها و ابزارهای نظارت بر سلامت عملیات', number: '۰۳' },
];

export default function Home() {
  return (
    <main dir="rtl" id="top" className="fsb-home">
      <header className="fsb-home-header">
        <a href="/" className="fsb-home-brand" aria-label="صفحه اصلی F-S">
          <span className="fsb-home-mark">F</span>
          <span><strong>F-S</strong><small>سامانه مدیریت فرایندهای سازمانی</small></span>
        </a>
        <nav className="fsb-home-nav" aria-label="دسترسی سریع">
          <a href="#modules">ماژول‌ها</a>
          <a href="#capabilities">قابلیت‌ها</a>
          <a href="/reports">گزارش‌ها</a>
        </nav>
        <span className="fsb-home-status"><i /> محیط توسعه</span>
      </header>

      <section className="fsb-hero">
        <div className="fsb-hero-copy">
          <span className="fsb-overline"><i /> BUSINESS PROCESS MANAGEMENT PLATFORM</span>
          <h1>فرایندهای سازمان را<br /><em>هوشمندانه</em> مدیریت کنید.</h1>
          <p>از ساختار سازمانی و فرم‌های اطلاعاتی تا طراحی گردش‌کار، ارجاع وظایف و تحلیل عملکرد؛ همه در یک بستر یکپارچه، امن و قابل توسعه.</p>
          <div className="fsb-hero-actions">
            <a href="#modules" className="fsb-primary-cta">ورود به ماژول‌ها <span>←</span></a>
            <a href="http://localhost:3001/api/health" target="_blank" rel="noreferrer" className="fsb-secondary-cta"><span className="fsb-api-dot" /> بررسی وضعیت API</a>
          </div>
          <div className="fsb-hero-proof"><span>✓</span> طراحی‌شده برای عملیات واقعی سازمانی <b>·</b> معماری چندمشتری</div>
        </div>
        <div className="fsb-hero-art" aria-label="نمای مفهومی گردش‌کار">
          <div className="fsb-orbit fsb-orbit-one" /><div className="fsb-orbit fsb-orbit-two" />
          <div className="fsb-flow-card fsb-flow-main">
            <div className="fsb-flow-card-head"><span className="fsb-flow-symbol">F</span><span><b>گردش‌کار سازمانی</b><small>نمای زنده فرایند</small></span><i>●</i></div>
            <div className="fsb-flow-line"><span className="done">✓</span><div><b>ثبت درخواست</b><small>تکمیل اطلاعات اولیه</small></div><label>تکمیل شد</label></div>
            <div className="fsb-flow-connector" />
            <div className="fsb-flow-line"><span className="current">Ⅱ</span><div><b>بررسی و تأیید</b><small>در انتظار اقدام مسئول</small></div><label className="waiting">در جریان</label></div>
            <div className="fsb-flow-connector" />
            <div className="fsb-flow-line"><span className="pending">3</span><div><b>بستن درخواست</b><small>مرحله نهایی</small></div><label>در صف</label></div>
          </div>
          <div className="fsb-float-chip fsb-chip-top"><span>↗</span><b>قابل ردیابی</b><small>تاریخچه کامل اقدامات</small></div>
          <div className="fsb-float-chip fsb-chip-bottom"><span>◈</span><b>امنیت Tenant</b><small>جداسازی اطلاعات مشتریان</small></div>
        </div>
      </section>

      <section id="capabilities" className="fsb-capabilities">
        <div className="fsb-section-intro"><div><span className="fsb-overline">BUILT FOR ENTERPRISE</span><h2>یک هسته، چندین قابلیت سازمانی</h2></div><p>ابزارهای کلیدی برای طراحی، اجرا، نظارت و بهبود فرایندهای سازمان.</p></div>
        <div className="fsb-highlight-grid">{highlights.map(item => <article key={item.number}><span>{item.number}</span><div><h3>{item.title}</h3><p>{item.detail}</p></div><b>↗</b></article>)}</div>
      </section>

      <section id="modules" className="fsb-module-section">
        <div className="fsb-section-intro"><div><span className="fsb-overline">PLATFORM MODULES</span><h2>ماژول‌های سامانه</h2></div><p>برای شروع، ماژول موردنظر را انتخاب کنید.</p></div>
        <div className="fsb-module-grid">
          {modules.map((item, index) => (
            <article className="fsb-module-card" key={item.title}>
              <div className="fsb-module-card-top"><span className="fsb-module-icon">{item.icon}</span><span className="fsb-module-index">{String(index + 1).padStart(2, '0')}</span></div>
              <h3>{item.title}</h3><p>{item.description}</p>
              <div className="fsb-module-card-bottom"><span>{item.status}</span>{'href' in item && item.href ? <a href={item.href} aria-label={`ورود به ${item.title}`}>ورود <b>←</b></a> : <span className="fsb-module-soon">هسته سامانه</span>}</div>
            </article>
          ))}
        </div>
      </section>

      <footer className="fsb-home-footer"><a href="/" className="fsb-footer-brand">F-S <span>·</span> سامانه مدیریت فرایندهای سازمانی</a><span>نسخه توسعه · ۲۰۲۶</span><a href="#top">بازگشت به بالا ↑</a></footer>
    </main>
  );
}
