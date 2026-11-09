const modules = [
  { title: 'ساختار سازمانی', description: 'سازمان‌ها، واحدهای تودرتو و پست‌های سازمانی', status: 'پیاده‌سازی هسته' },
  { title: 'کاربران و دسترسی', description: 'کاربران، انتساب پست، نقش‌ها و مجوزها', status: 'پیاده‌سازی هسته' },
  { title: 'فرم‌ساز', description: 'تعریف فرم، نسخه‌بندی و ثبت اطلاعات', status: 'نسخه‌بندی و API' },
  { title: 'طراحی فرایند', description: 'تعریف فرایند و انتشار نسخه‌های مستقل', status: 'نسخه‌بندی و API' },
  { title: 'گردش کار', description: 'نمونه فرایند، کارتابل، ارجاع چندنفره و تاریخچه', status: 'هسته اجرایی اولیه' },
  { title: 'داشبورد مدیریتی', description: 'شاخص‌های عملیاتی، وضعیت فرایندها، هشدارها و صف اعلان‌ها', status: 'نمای زنده مدیریتی', href: '/dashboard' },
  { title: 'مدیریت صف اعلان‌ها', description: 'پایش Outbox، Dead Letter Queue و بازپردازش کنترل‌شده', status: 'پنل عملیاتی', href: '/notifications' },
  { title: 'تحلیل گلوگاه فرایندها', description: 'زمان انتظار، چرخه، تأخیر و نرخ عدم تأیید مراحل', status: 'تحلیل عملیاتی', href: '/process-analytics' },
  { title: 'گزارش‌ها و اعلان‌ها', description: 'گزارش عملکرد فرایندها، پایش SLA و تحلیل هشدارهای عملیاتی', status: 'گزارش مدیریتی فعال', href: '/reports' },
  { title: 'غیبت و جانشینی', description: 'ثبت غیبت کارکنان، تعیین جانشین موقت و حفظ پیوستگی گردش کار', status: 'پنل مدیریتی فعال', href: '/absences' },
];

export default function Home() {
  return (
    <main dir="rtl">
      <header className="topbar">
        <div className="brand"><span className="brand-mark">F</span><span>F-S <small>سامانه مدیریت فرایند</small></span></div>
        <span className="status">محیط توسعه</span>
      </header>
      <section className="hero">
        <div>
          <p className="eyebrow">F-S / BUSINESS PROCESS MANAGEMENT</p>
          <h1>مدیریت یکپارچه فرایندهای سازمانی</h1>
          <p className="intro">از ساختار سازمانی و فرم‌های اطلاعاتی تا تعریف فرایند، ارجاع وظایف و پیگیری اجرای کارها؛ در یک بستر یکپارچه.</p>
          <div className="hero-actions"><a href="#modules" className="primary-link">مشاهده ماژول‌ها</a><a href="http://localhost:3001/api/health" target="_blank" rel="noreferrer" className="secondary-link">وضعیت API</a></div>
        </div>
        <div className="hero-panel">
          <span className="panel-label">هسته سامانه</span>
          <strong>فرایندمحور</strong>
          <p>نسخه‌بندی مستقل، تاریخچه اقدامات و پشتیبانی از ارجاع چندنفره</p>
          <div className="mini-stats"><div><b>۲</b><span>سیاست ارجاع</span></div><div><b>۳</b><span>لایه پایه</span></div></div>
        </div>
      </section>
      <section id="modules" className="module-section">
        <div className="section-heading"><div><p className="eyebrow">PLATFORM MODULES</p><h2>ماژول‌های سامانه</h2></div><span className="muted">معماری ماژولار</span></div>
        <div className="module-grid">
          {modules.map((item, index) => (
            <article className="module-card" key={item.title}>
              <div className="module-number">{String(index + 1).padStart(2, '0')}</div>
              <h3>{item.title}</h3>
              <p>{item.description}</p>
              <span className="module-status">{item.status}</span>{'href' in item && item.href && <a className="module-open-link" href={item.href}>ورود به پنل ←</a>}
            </article>
          ))}
        </div>
      </section>
      <footer><span>F-S · سامانه مدیریت فرایندهای سازمانی</span><span>نسخه توسعه · ۲۰۲۶</span></footer>
    </main>
  );
}
