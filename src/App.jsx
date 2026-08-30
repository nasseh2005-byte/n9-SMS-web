import { useEffect, useMemo, useRef, useState } from "react";
import Icon from "@mdi/react";
import {
  mdiAlertCircleOutline,
  mdiAccount,
  mdiAccountMultipleOutline,
  mdiBatteryHigh,
  mdiCameraOutline,
  mdiCellphoneScreenshot,
  mdiCheck,
  mdiCheckCircle,
  mdiChevronDown,
  mdiChevronLeft,
  mdiChevronRight,
  mdiClose,
  mdiContentCopy,
  mdiDatabaseLockOutline,
  mdiDotsVertical,
  mdiDownload,
  mdiFileDocumentOutline,
  mdiFileExcelOutline,
  mdiFileTableOutline,
  mdiFolderOutline,
  mdiImageMultipleOutline,
  mdiInformationOutline,
  mdiLockOutline,
  mdiLogout,
  mdiMagnify,
  mdiMicrophoneOutline,
  mdiMessageProcessingOutline,
  mdiMessagePlusOutline,
  mdiMessageTextOutline,
  mdiOfficeBuildingOutline,
  mdiPhoneOutline,
  mdiPlus,
  mdiSignal,
  mdiShieldAccountOutline,
  mdiSquareOutline,
  mdiCircleOutline,
  mdiTriangleOutline,
  mdiTrayArrowUp,
  mdiTuneVariant,
  mdiWeatherNight,
  mdiWhiteBalanceSunny,
  mdiWifi,
} from "@mdi/js";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import {
  buildManualMessage,
  buildMatches,
  extractTerms,
  extractWorkbookTerms,
  filterConversationMessages,
  getMessageTimeline,
  normalizeComparable,
  normalizeMessageIdentity,
  parseXmlTimestamp,
  quoteCsvCell,
  toIsoTimestamp,
} from "./dataUtils.js";
import { sampleMatchTerms, sampleMessages } from "./sampleData.js";
import {
  createUser,
  createWorkspace,
  getWorkspaceArchive,
  initializeWorkspaceSession,
  isLocalPreview,
  listUsers,
  listWorkspaces,
  login,
  logout,
  saveWorkspaceArchive,
  updateUser,
} from "./workspaceApi.js";

const initialsPalette = ["#d8e8ff", "#e4ddff", "#d8f5e5", "#ffe3d8", "#f5df9f"];

function formatTime(value) {
  if (!parseXmlTimestamp(value)) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function formatDate(value) {
  if (!parseXmlTimestamp(value)) return "غير متوفر";
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    year: "numeric",
    month: "long",
    day: "numeric",
  }).format(new Date(value));
}

function formatShortDate(value) {
  if (!parseXmlTimestamp(value)) return "—";
  return new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
    month: "short",
    day: "numeric",
  }).format(new Date(value));
}

function formatIphoneThreadStamp(value) {
  if (!parseXmlTimestamp(value)) return "غير متوفر";
  const messageDate = new Date(value);
  const today = new Date();
  const dayStart = new Date(messageDate.getFullYear(), messageDate.getMonth(), messageDate.getDate()).getTime();
  const todayStart = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  const dayDifference = Math.round((todayStart - dayStart) / 86_400_000);
  const dayLabel = dayDifference === 0 ? "اليوم" : dayDifference === 1 ? "أمس" : formatShortDate(value);
  return `${dayLabel} ${formatTime(value)}`;
}

function getInitials(name = "؟") {
  const words = name.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => word[0]).join("").toUpperCase() || "؟";
}

function sortMessages(messages) {
  return [...messages].sort((a, b) => Number(a.date) - Number(b.date));
}

function groupMessages(messages) {
  const groups = new Map();
  for (const message of messages) {
    const key = message.address || "غير معروف";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(message);
  }

  return [...groups.entries()]
    .map(([address, items], index) => {
      const sorted = sortMessages(items);
      const last = sorted.at(-1);
      const contactName = last.contactName && last.contactName !== "(Unknown)"
        ? last.contactName
        : address;
      return {
        address,
        contactName,
        messages: sorted,
        last,
        unread: sorted.filter((message) => message.read === "0").length,
        color: initialsPalette[index % initialsPalette.length],
      };
    })
    .sort((a, b) => Number(b.last.date) - Number(a.last.date));
}

function parseXmlFile(file) {
  return file.text().then((text) => {
    const documentNode = new DOMParser().parseFromString(text, "application/xml");
    const parserError = documentNode.querySelector("parsererror");
    if (parserError) throw new Error("تعذر قراءة ملف XML. تأكد أنه صادر من SMS Backup & Restore.");

    const nodes = [...documentNode.getElementsByTagName("sms")];
    if (!nodes.length) throw new Error("لم نجد رسائل SMS داخل الملف.");

    return nodes.map((node, index) => normalizeMessageIdentity({
      id: `xml-${node.getAttribute("date") || index}-${index}-${crypto.randomUUID()}`,
      address: node.getAttribute("address") || "غير معروف",
      contactName: node.getAttribute("contact_name") || node.getAttribute("address") || "غير معروف",
      date: parseXmlTimestamp(node.getAttribute("date")),
      dateSent: parseXmlTimestamp(node.getAttribute("date_sent")),
      rawDate: node.getAttribute("date") || "",
      rawDateSent: node.getAttribute("date_sent") || "",
      readableDate: node.getAttribute("readable_date") || "",
      type: node.getAttribute("type") || "1",
      read: node.getAttribute("read") || "1",
      status: node.getAttribute("status") || "0",
      body: node.getAttribute("body") || "",
    }));
  });
}

function downloadDataUrl(dataUrl, fileName) {
  const link = document.createElement("a");
  link.href = dataUrl;
  link.download = fileName;
  link.click();
}

function downloadBlob(blob, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = fileName;
  link.click();
  URL.revokeObjectURL(link.href);
}

function downloadText(text, fileName, type = "text/csv;charset=utf-8") {
  downloadBlob(new Blob([text], { type }), fileName);
}

function NavButton({ active, icon, label, onClick }) {
  return (
    <button className={`nav-button ${active ? "is-active" : ""}`} onClick={onClick} type="button">
      <span className="nav-icon"><Icon path={icon} size={1.05} /></span>
      <span>{label}</span>
    </button>
  );
}

function formatManualTime(value) {
  const [hours, minutes] = String(value || "").split(":").map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return "—";
  const date = new Date();
  date.setHours(hours, minutes, 0, 0);
  return formatTime(date.getTime());
}

function StatusBar({ clockMode = "message", customTime = "09:41", deviceStyle = "android", value }) {
  const [liveTime, setLiveTime] = useState(Date.now());

  useEffect(() => {
    if (clockMode !== "live") return undefined;
    setLiveTime(Date.now());
    const timer = window.setInterval(() => setLiveTime(Date.now()), 30000);
    return () => window.clearInterval(timer);
  }, [clockMode]);

  const displayedTime = clockMode === "custom"
    ? formatManualTime(customTime)
    : clockMode === "live"
      ? formatTime(liveTime)
      : formatTime(value);

  return (
    <div className="phone-statusbar" dir="ltr">
      <span>{displayedTime}</span>
      <span className="device-cutout" aria-hidden="true"><span className="device-cutout-lens" /></span>
      <div className="phone-status-icons">
        {deviceStyle === "iphone" ? (
          <>
            <span className="ios-battery-level">54</span>
            <span className="ios-network-type">5G</span>
            <Icon path={mdiSignal} size={0.68} />
          </>
        ) : (
          <>
            <Icon path={mdiSignal} size={0.62} />
            <Icon path={mdiWifi} size={0.64} />
            <span className="network-label">4G</span>
            <Icon path={mdiBatteryHigh} size={0.78} />
          </>
        )}
      </div>
    </div>
  );
}

function LinkifiedBody({ body, deviceStyle = "android" }) {
  const pattern = deviceStyle === "iphone"
    ? /(https?:\/\/\S+|[0-9٠-٩۰-۹]{7,})/g
    : /(https?:\/\/\S+)/g;
  const parts = String(body).split(pattern);
  return parts.map((part, index) => (/^https?:\/\//.test(part) || (deviceStyle === "iphone" && /^[0-9٠-٩۰-۹]{7,}$/.test(part)))
    ? <span className="message-link" key={`${part}-${index}`}>{part}</span>
    : <span key={`${part}-${index}`}>{part}</span>);
}

function ConversationPhone({ clockMode, conversation, customTime, deviceStyle, selectedId, onSelect, theme }) {
  const allMessages = conversation?.messages || [];
  const threadRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const visibleMessages = useMemo(
    () => filterConversationMessages(allMessages, threadQuery, conversation),
    [allMessages, conversation, threadQuery],
  );
  const selectedInThread = allMessages.find((message) => message.id === selectedId);
  const phoneTime = selectedInThread?.date || allMessages.at(-1)?.date;

  useEffect(() => {
    setSearchOpen(false);
    setThreadQuery("");
  }, [conversation?.address]);

  useEffect(() => {
    const container = threadRef.current;
    if (!container) return;
    const selectedNode = [...container.querySelectorAll("[data-message-id]")]
      .find((node) => node.dataset.messageId === selectedId);
    window.requestAnimationFrame(() => {
      if (selectedNode) selectedNode.scrollIntoView({ block: "center" });
      else container.scrollTop = threadQuery ? 0 : container.scrollHeight;
    });
  }, [conversation?.address, selectedId, threadQuery]);

  return (
    <div className={`phone-screen conversation-phone device-${deviceStyle} ${theme === "light" ? "phone-light" : ""}`} dir="rtl">
      <StatusBar clockMode={clockMode} customTime={customTime} deviceStyle={deviceStyle} value={phoneTime} />
      <header className="phone-conversation-header">
        {deviceStyle === "iphone" && (
          <div className="ios-header-message-backdrop" aria-hidden="true">
            <LinkifiedBody body={allMessages.at(-2)?.body || allMessages.at(-1)?.body || ""} deviceStyle="iphone" />
          </div>
        )}
        <button aria-label="رجوع" className={`phone-icon-button ${deviceStyle === "iphone" ? "ios-thread-back" : ""}`} type="button">
          {deviceStyle === "iphone" && <span>{allMessages.length.toLocaleString("ar-SA-u-nu-latn")}</span>}
          <Icon path={mdiChevronRight} size={deviceStyle === "iphone" ? 1.25 : 1.1} />
        </button>
        <div className="phone-contact">
          <span className="phone-avatar">{deviceStyle === "iphone" ? <Icon path={mdiAccount} size={1.8} /> : getInitials(conversation?.contactName)}</span>
          <span className="phone-contact-title">
            <strong>{conversation?.contactName}</strong>
            {deviceStyle === "iphone" && <Icon path={mdiChevronLeft} size={0.72} />}
            <small>{conversation?.address} · {allMessages.length.toLocaleString("ar-SA")} رسالة</small>
          </span>
        </div>
        <div className="phone-header-actions">
          <button
            aria-expanded={searchOpen}
            aria-label="البحث داخل المحادثة"
            className={`phone-icon-button ${searchOpen ? "is-active" : ""}`}
            onClick={() => setSearchOpen((value) => !value)}
            type="button"
          ><Icon path={mdiMagnify} size={1.02} /></button>
          {deviceStyle !== "iphone" && <button aria-label="اتصال" className="phone-icon-button" type="button"><Icon path={mdiPhoneOutline} size={1.02} /></button>}
          {deviceStyle !== "iphone" && <button aria-label="المزيد" className="phone-icon-button" type="button"><Icon path={mdiDotsVertical} size={1.02} /></button>}
        </div>
      </header>
      {searchOpen && (
        <div className="thread-search-row">
          <Icon path={mdiMagnify} size={0.72} />
          <input
            aria-label="نص البحث داخل المحادثة"
            autoFocus
            onChange={(event) => setThreadQuery(event.target.value)}
            placeholder="ابحث باسم أو كلمة أو رقم"
            value={threadQuery}
          />
          <span className="thread-search-count">{visibleMessages.length.toLocaleString("ar-SA")}/{allMessages.length.toLocaleString("ar-SA")}</span>
          <button aria-label="مسح البحث" onClick={() => setThreadQuery("")} type="button"><Icon path={mdiClose} size={0.72} /></button>
        </div>
      )}
      <div className="thread-scroll" ref={threadRef}>
        {!visibleMessages.length && (
          <div className="thread-empty-state">
            <Icon path={mdiMagnify} size={1.3} />
            <strong>لا توجد نتائج داخل هذه المحادثة</strong>
            <span>جرّب اسمًا آخر أو كلمة من نص الرسالة.</span>
          </div>
        )}
        {visibleMessages.map((message, index) => {
          const incoming = message.type !== "2";
          const previousMessage = visibleMessages[index - 1];
          const currentDay = parseXmlTimestamp(message.date) ? new Date(message.date).toDateString() : "missing";
          const previousDay = parseXmlTimestamp(previousMessage?.date) ? new Date(previousMessage.date).toDateString() : "missing";
          const timeGap = parseXmlTimestamp(message.date) && parseXmlTimestamp(previousMessage?.date)
            ? Number(message.date) - Number(previousMessage.date)
            : 0;
          const showDate = index === 0
            || currentDay !== previousDay
            || (deviceStyle === "iphone" && timeGap >= 10 * 60 * 1000);
          return (
            <div className="thread-message-entry" key={message.id}>
              {showDate && <div className="date-chip">{deviceStyle === "iphone" ? formatIphoneThreadStamp(message.date) : formatDate(message.date)}</div>}
              <button
                className={`sms-bubble-wrap ${incoming ? "incoming" : "outgoing"} ${selectedId === message.id ? "is-selected" : ""}`}
                data-message-id={message.id}
                onClick={() => onSelect(message.id)}
                type="button"
              >
                <span className="sms-bubble"><LinkifiedBody body={message.body} deviceStyle={deviceStyle} /></span>
                <small>{formatTime(message.date)}</small>
              </button>
            </div>
          );
        })}
      </div>
      <div className="composer-row">
        <button aria-label={deviceStyle === "iphone" ? "الكاميرا" : "إضافة"} className="composer-plus" type="button"><Icon path={deviceStyle === "iphone" ? mdiCameraOutline : mdiPlus} size={deviceStyle === "iphone" ? 0.92 : 1.12} /></button>
        <div className="composer-field"><span>{deviceStyle === "iphone" ? "iMessage" : "رسالة نصية"}</span>{deviceStyle === "iphone" && <Icon path={mdiMicrophoneOutline} size={0.78} />}</div>
      </div>
      {deviceStyle === "iphone" && <span className="ios-home-indicator" aria-hidden="true" />}
    </div>
  );
}

function EvidencePhone({ clockMode, customTime, deviceStyle = "android", message, capture = false, theme = "dark" }) {
  const timeline = getMessageTimeline(message);
  return (
    <div className={`phone-screen details-phone device-${deviceStyle} ${capture ? "capture-version" : ""} ${theme === "light" ? "phone-light" : ""}`} dir="rtl">
      <StatusBar clockMode={clockMode} customTime={customTime} deviceStyle={deviceStyle} value={timeline.statusTime} />
      <header className="details-header">
        <button aria-label="رجوع" className="phone-icon-button" type="button"><Icon path={mdiChevronRight} size={1.2} /></button>
        <strong>التفاصيل</strong>
        <span className="details-header-spacer" />
      </header>
      <div className="details-content">
        <div className="message-proof-card">
          <div className="message-proof-bubble"><LinkifiedBody body={message?.body || "اختر رسالة لعرض الدليل"} deviceStyle={deviceStyle} /></div>
        </div>
        <section className="proof-section">
          <h4>الحالة</h4>
          <div className="status-list">
            {timeline.rows.map((row) => (
              <div className={`${row.warning ? "has-warning" : ""} ${row.missing ? "is-missing" : ""}`} key={row.label}>
                <span className="status-label">
                  <strong>{row.label}</strong>
                </span>
                <span>{formatDate(row.at)}، {formatTime(row.at)}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="proof-section proof-meta">
          <h4>النوع</h4>
          <p>رسالة نصية</p>
          <h4>المرسل</h4>
          <p dir="ltr">{message?.address || "—"}</p>
        </section>
      </div>
      <div className="android-nav" aria-hidden="true">
        <Icon path={mdiSquareOutline} size={0.64} />
        <Icon path={mdiCircleOutline} size={0.64} />
        <Icon className="android-back-icon" path={mdiTriangleOutline} size={0.64} />
      </div>
      {deviceStyle === "iphone" && <span className="ios-home-indicator" aria-hidden="true" />}
    </div>
  );
}

function ImportDialog({ busy, onClose, onXml, onSheet }) {
  const xmlRef = useRef(null);
  const sheetRef = useRef(null);
  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="import-title" className="import-dialog" role="dialog">
        <header>
          <div>
            <span className="eyebrow">إضافة البيانات</span>
            <h2 id="import-title">ابدأ بملفاتك الحقيقية</h2>
            <p>سيُربط ملف الرسائل بالشركة المفتوحة، ولن يظهر في أي مساحة شركة أخرى.</p>
          </div>
          <button aria-label="إغلاق" className="icon-button" onClick={onClose} type="button"><Icon path={mdiClose} size={1.05} /></button>
        </header>
        <div className="import-options">
          <button className="import-card primary-import" disabled={busy} onClick={() => xmlRef.current?.click()} type="button">
            <span className="import-card-icon"><Icon path={mdiFileDocumentOutline} size={1.35} /></span>
            <strong>رفع نسخة الرسائل XML</strong>
            <small>يدعم ملفات SMS Backup & Restore</small>
            <span className="card-action">اختيار الملف <Icon path={mdiTrayArrowUp} size={0.76} /></span>
          </button>
          <button className="import-card" disabled={busy} onClick={() => sheetRef.current?.click()} type="button">
            <span className="import-card-icon excel"><Icon path={mdiFileExcelOutline} size={1.35} /></span>
            <strong>رفع أرقام المطابقة</strong>
            <small>Excel أو CSV — سمِّ العمود «رقم» أو «مرجع». المعرّفات الأطول من 15 خانة يجب حفظها كنص.</small>
            <span className="card-action">اختيار الملف <Icon path={mdiTrayArrowUp} size={0.76} /></span>
          </button>
        </div>
        {busy && <div className="busy-note"><span className="spinner" /> جاري تحليل الملف الكبير، لحظات…</div>}
        <input accept=".xml,text/xml,application/xml" hidden onChange={onXml} ref={xmlRef} type="file" />
        <input accept=".xlsx,.xls,.csv" hidden onChange={onSheet} ref={sheetRef} type="file" />
      </section>
    </div>
  );
}

function toDateTimeLocalValue(timestamp) {
  const date = new Date(timestamp);
  const localTimestamp = timestamp - date.getTimezoneOffset() * 60 * 1000;
  return new Date(localTimestamp).toISOString().slice(0, 19);
}

function MessageComposerDialog({ busy, conversations, onClose, onCreate, selectedAddress }) {
  const initialSentAt = Date.now();
  const [form, setForm] = useState({
    conversationMode: conversations.length ? "existing" : "new",
    existingAddress: selectedAddress || conversations[0]?.address || "",
    newConversationName: "",
    newSender: "",
    direction: "incoming",
    body: "",
    sentAt: toDateTimeLocalValue(initialSentAt),
    completedAt: toDateTimeLocalValue(initialSentAt + 4 * 60 * 1000),
  });

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateSentAt(value) {
    const timestamp = new Date(value).getTime();
    setForm((current) => ({
      ...current,
      sentAt: value,
      completedAt: Number.isFinite(timestamp) ? toDateTimeLocalValue(timestamp + 4 * 60 * 1000) : current.completedAt,
    }));
  }

  async function submit(event) {
    event.preventDefault();
    await onCreate(form);
  }

  const newConversationReady = form.newConversationName.trim() && (form.newSender.trim() || form.newConversationName.trim());
  const conversationReady = form.conversationMode === "existing" ? form.existingAddress : newConversationReady;

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !busy && onClose()}>
      <section aria-labelledby="composer-title" className="management-dialog message-composer-dialog" role="dialog">
        <header>
          <div><span className="eyebrow">إضافة دقيقة للأرشيف</span><h2 id="composer-title">منشئ الرسالة</h2><p>أنشئ رسالة بتاريخها الكامل واربطها بمحادثة موجودة أو افتح محادثة جديدة داخل الشركة الحالية.</p></div>
          <button aria-label="إغلاق" className="icon-button" disabled={busy} onClick={onClose} type="button"><Icon path={mdiClose} size={1.05} /></button>
        </header>
        <form className="message-composer-form" onSubmit={submit}>
          <div className="composer-mode-tabs" aria-label="مكان حفظ الرسالة">
            <button className={form.conversationMode === "existing" ? "is-active" : ""} disabled={!conversations.length} onClick={() => updateField("conversationMode", "existing")} type="button">محادثة موجودة</button>
            <button className={form.conversationMode === "new" ? "is-active" : ""} onClick={() => updateField("conversationMode", "new")} type="button">محادثة جديدة</button>
          </div>

          {form.conversationMode === "existing" ? (
            <label className="composer-field-wide"><span>المحادثة التابعة لها</span><select onChange={(event) => updateField("existingAddress", event.target.value)} required value={form.existingAddress}>{conversations.map((conversation) => <option key={conversation.address} value={conversation.address}>{conversation.contactName} — {conversation.address}</option>)}</select></label>
          ) : (
            <div className="composer-grid">
              <label><span>اسم المحادثة</span><input maxLength={80} onChange={(event) => updateField("newConversationName", event.target.value)} placeholder="مثال: EJADA" required value={form.newConversationName} /></label>
              <label><span>اسم أو رقم المرسل</span><input dir="ltr" maxLength={80} onChange={(event) => updateField("newSender", event.target.value)} placeholder="EJADA أو 920000000" value={form.newSender} /></label>
            </div>
          )}

          <fieldset className="message-direction"><legend>اتجاه الرسالة</legend><label><input checked={form.direction === "incoming"} onChange={() => updateField("direction", "incoming")} type="radio" /><span>واردة إليّ</span></label><label><input checked={form.direction === "outgoing"} onChange={() => updateField("direction", "outgoing")} type="radio" /><span>صادرة مني</span></label></fieldset>

          <label className="composer-field-wide"><span>محتوى الرسالة</span><textarea autoFocus maxLength={5000} onChange={(event) => updateField("body", event.target.value)} placeholder="اكتب نص الرسالة كاملًا…" required value={form.body} /><small>{form.body.length.toLocaleString("ar-SA")} / 5,000</small></label>

          <div className="composer-grid time-grid">
            <label><span>تاريخ ووقت الإرسال</span><input onChange={(event) => updateSentAt(event.target.value)} required step="1" type="datetime-local" value={form.sentAt} /></label>
            <label><span>{form.direction === "incoming" ? "تاريخ ووقت الاستلام" : "تاريخ ووقت التسليم"}</span><input min={form.sentAt} onChange={(event) => updateField("completedAt", event.target.value)} required step="1" type="datetime-local" value={form.completedAt} /></label>
          </div>
          <div className="composer-time-note"><Icon path={mdiInformationOutline} size={0.72} /><span>يُضبط الوقت الثاني تلقائيًا بعد 4 دقائق، ويمكنك تعديله لأي وقت منطقي قبل الحفظ.</span></div>

          <div className="composer-actions"><button className="secondary" disabled={busy} onClick={onClose} type="button">إلغاء</button><button className="primary" disabled={busy || !conversationReady || !form.body.trim()} type="submit"><Icon path={mdiMessagePlusOutline} size={0.8} />{busy ? "جاري الحفظ…" : "إنشاء الرسالة وحفظها"}</button></div>
        </form>
      </section>
    </div>
  );
}

const welcomeCopy = {
  ar: {
    dir: "rtl",
    eyebrow: "منصة أدلة الرسائل",
    title: "كل شركة في مساحة مستقلة. كل رسالة جاهزة كدليل.",
    description: "نظّم أرشيفات SMS، طابق أرقام Excel، واختر الرسالة الدقيقة ثم صدّرها بصورة هاتف موثوقة.",
    start: "ابدأ تسجيل الدخول",
    workspaces: "فصل كامل للشركات",
    workspacesText: "أرشيف وصلاحيات ونتائج مستقلة لكل شركة.",
    phones: "ثيمات هواتف متعددة",
    phonesText: "Google Messages وHuawei وiPhone في معاينة واحدة.",
    evidence: "دليل منظم",
    evidenceText: "التاريخ والمرسل ومحتوى الرسالة دون تغيير بيانات XML.",
    loginEyebrow: "دخول المستخدمين",
    loginTitle: "افتح مساحة عملك",
    loginDescription: "ستظهر فقط الشركات المفوض لك الوصول إليها.",
    username: "اسم المستخدم",
    password: "كلمة المرور الرقمية",
    login: "دخول آمن",
    checking: "جاري التحقق…",
    secure: "الجلسة محمية، وتُقفل المحاولات الخاطئة المتكررة مؤقتًا.",
    preview: "معاينة محلية — المشاركة بين الأجهزة تعمل في النسخة المنشورة.",
  },
  en: {
    dir: "ltr",
    eyebrow: "SMS evidence workspace",
    title: "A separate workspace for every company. Evidence-ready messages.",
    description: "Organize SMS archives, match Excel identifiers, select the exact message, and export a faithful phone capture.",
    start: "Sign in to get started",
    workspaces: "Isolated companies",
    workspacesText: "Separate archives, permissions, and results for every company.",
    phones: "Multiple phone styles",
    phonesText: "Google Messages, Huawei, and iPhone previews in one place.",
    evidence: "Structured evidence",
    evidenceText: "Preserve XML sender, message content, and timestamps exactly.",
    loginEyebrow: "User access",
    loginTitle: "Open your workspace",
    loginDescription: "You will only see companies assigned to your account.",
    username: "Username",
    password: "Numeric password",
    login: "Secure sign in",
    checking: "Checking…",
    secure: "Your session is protected, with temporary lockout after repeated failed attempts.",
    preview: "Local preview — cross-device access works on the published site.",
  },
};

function LoginScreen({ busy, error, onLogin }) {
  const [username, setUsername] = useState("nasseh");
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState(() => localStorage.getItem("n9-welcome-language") || "ar");
  const [welcomeTheme, setWelcomeTheme] = useState(() => localStorage.getItem("n9-welcome-theme") || "light");
  const usernameRef = useRef(null);
  const copy = welcomeCopy[language];

  useEffect(() => {
    localStorage.setItem("n9-welcome-language", language);
    localStorage.setItem("n9-welcome-theme", welcomeTheme);
    document.documentElement.lang = language;
    document.documentElement.dir = copy.dir;
    return () => {
      document.documentElement.lang = "ar";
      document.documentElement.dir = "rtl";
    };
  }, [copy.dir, language, welcomeTheme]);

  function submit(event) {
    event.preventDefault();
    onLogin(username, password);
  }

  return (
    <main className={`welcome-screen welcome-${welcomeTheme}`} dir={copy.dir}>
      <header className="welcome-header">
        <div className="welcome-logo"><span><Icon path={mdiMessageProcessingOutline} size={1.1} /></span><strong>N9 SMS</strong></div>
        <div className="welcome-controls">
          <div className="language-switch" aria-label="Language">
            <button className={language === "ar" ? "is-active" : ""} onClick={() => setLanguage("ar")} type="button">العربية</button>
            <button className={language === "en" ? "is-active" : ""} onClick={() => setLanguage("en")} type="button">English</button>
          </div>
          <button aria-label={welcomeTheme === "dark" ? "Light theme" : "Dark theme"} className="welcome-theme-toggle" onClick={() => setWelcomeTheme((current) => current === "dark" ? "light" : "dark")} type="button"><Icon path={welcomeTheme === "dark" ? mdiWhiteBalanceSunny : mdiWeatherNight} size={0.82} /></button>
        </div>
      </header>
      <div className="welcome-layout">
        <section className="welcome-copy">
          <div className="welcome-product-mark"><Icon path={mdiShieldAccountOutline} size={0.8} /><span>{copy.eyebrow}</span></div>
          <h1>{copy.title}</h1>
          <p>{copy.description}</p>
          <button className="welcome-primary-action" onClick={() => usernameRef.current?.focus()} type="button">{copy.start}<Icon path={mdiChevronRight} size={0.82} /></button>
          <div className="welcome-features">
            <article><span><Icon path={mdiOfficeBuildingOutline} size={0.95} /></span><div><strong>{copy.workspaces}</strong><small>{copy.workspacesText}</small></div></article>
            <article><span><Icon path={mdiCellphoneScreenshot} size={0.95} /></span><div><strong>{copy.phones}</strong><small>{copy.phonesText}</small></div></article>
            <article><span><Icon path={mdiCheckCircle} size={0.95} /></span><div><strong>{copy.evidence}</strong><small>{copy.evidenceText}</small></div></article>
          </div>
        </section>
        <section className="login-card">
          <div className="login-card-heading"><span className="eyebrow">{copy.loginEyebrow}</span><h2>{copy.loginTitle}</h2><p>{copy.loginDescription}</p></div>
          <form onSubmit={submit}>
            <label>
              <span>{copy.username}</span>
              <input autoComplete="username" maxLength={30} onChange={(event) => setUsername(event.target.value)} ref={usernameRef} required value={username} />
            </label>
            <label>
              <span>{copy.password}</span>
              <div className="pin-field"><Icon path={mdiLockOutline} size={0.82} /><input autoComplete="current-password" inputMode="numeric" maxLength={12} minLength={4} onChange={(event) => setPassword(event.target.value.replace(/\D/g, ""))} pattern="[0-9]{4,12}" placeholder="••••" required type="password" value={password} /></div>
            </label>
            {error && <div className="login-error" role="alert"><Icon path={mdiAlertCircleOutline} size={0.8} />{error}</div>}
            <button disabled={busy} type="submit">{busy ? <><span className="spinner" /> {copy.checking}</> : copy.login}</button>
          </form>
          <div className="login-security"><Icon path={mdiShieldAccountOutline} size={0.82} /><span>{copy.secure}</span></div>
          {isLocalPreview && <small className="preview-note">{copy.preview}</small>}
        </section>
      </div>
      <footer className="welcome-footer"><span>© N9 SMS</span><span>Private evidence workspace</span></footer>
    </main>
  );
}

function WorkspaceDialog({ activeId, busy, onClose, onCreate, onSelect, workspaces }) {
  const [name, setName] = useState("");

  async function submit(event) {
    event.preventDefault();
    const cleanName = name.trim();
    if (cleanName.length < 2) return;
    const created = await onCreate(cleanName);
    if (created) setName("");
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="workspaces-title" className="management-dialog workspace-dialog" role="dialog">
        <header>
          <div><span className="eyebrow">فصل الأرشيفات</span><h2 id="workspaces-title">مساحات الشركات</h2><p>كل شركة تحتفظ برسائلها وملفاتها ونتائج المطابقة بشكل مستقل.</p></div>
          <button aria-label="إغلاق" className="icon-button" onClick={onClose} type="button"><Icon path={mdiClose} size={1.05} /></button>
        </header>
        <div className="workspace-grid">
          {workspaces.map((workspace) => (
            <button className={workspace.id === activeId ? "workspace-card is-active" : "workspace-card"} key={workspace.id} onClick={() => onSelect(workspace.id)} type="button">
              <span className="workspace-card-icon"><Icon path={mdiOfficeBuildingOutline} size={1.02} /></span>
              <span className="workspace-card-copy"><strong>{workspace.name}</strong><small>{workspace.messageCount.toLocaleString("ar-SA")} رسالة · {workspace.sourceName}</small></span>
              {workspace.id === activeId && <span className="workspace-active-mark"><Icon path={mdiCheckCircle} size={0.82} /> مفتوحة</span>}
            </button>
          ))}
        </div>
        <form className="create-workspace-form" onSubmit={submit}>
          <label><span>شركة جديدة</span><input maxLength={80} onChange={(event) => setName(event.target.value)} placeholder="مثال: شركة السهلي" value={name} /></label>
          <button disabled={busy || name.trim().length < 2} type="submit"><Icon path={mdiPlus} size={0.78} /> إنشاء مساحة</button>
        </form>
      </section>
    </div>
  );
}

function UserAccessRow({ currentUserId, onUpdate, user, workspaces }) {
  const [workspaceIds, setWorkspaceIds] = useState(user.workspaceIds || []);
  const [newPassword, setNewPassword] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => setWorkspaceIds(user.workspaceIds || []), [user.workspaceIds]);

  function toggleWorkspace(workspaceId) {
    setWorkspaceIds((current) => current.includes(workspaceId)
      ? current.filter((id) => id !== workspaceId)
      : [...current, workspaceId]);
  }

  async function save() {
    setSaving(true);
    const saved = await onUpdate(user.id, { workspaceIds, ...(newPassword ? { password: newPassword } : {}) });
    if (saved) setNewPassword("");
    setSaving(false);
  }

  return (
    <article className="user-access-row">
      <header>
        <span className="user-avatar">{getInitials(user.displayName)}</span>
        <span><strong>{user.displayName}</strong><small dir="ltr">@{user.username} · {user.role === "admin" ? "مدير" : "مستخدم"}</small></span>
        <button className={user.active ? "status-toggle is-active" : "status-toggle"} disabled={user.id === currentUserId} onClick={() => onUpdate(user.id, { active: !user.active })} type="button">{user.active ? "نشط" : "موقوف"}</button>
      </header>
      <div className="workspace-permissions">
        {workspaces.map((workspace) => (
          <label key={workspace.id}><input checked={workspaceIds.includes(workspace.id)} onChange={() => toggleWorkspace(workspace.id)} type="checkbox" /><span>{workspace.name}</span></label>
        ))}
      </div>
      <div className="user-access-actions">
        <label className="user-password-reset"><Icon path={mdiLockOutline} size={0.68} /><input aria-label={`كلمة مرور جديدة للمستخدم ${user.username}`} inputMode="numeric" maxLength={12} onChange={(event) => setNewPassword(event.target.value.replace(/\D/g, ""))} placeholder="كلمة جديدة (اختياري)" type="password" value={newPassword} /></label>
        <button className="save-permissions" disabled={saving || Boolean(newPassword && !/^\d{4,12}$/.test(newPassword))} onClick={save} type="button">{saving ? "جاري الحفظ…" : "حفظ الصلاحيات"}</button>
      </div>
    </article>
  );
}

function UsersDialog({ currentUser, loading, onClose, onCreate, onUpdate, users, workspaces }) {
  const [form, setForm] = useState({ displayName: "", username: "", password: "", role: "user", workspaceIds: [] });
  const [saving, setSaving] = useState(false);

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function toggleWorkspace(workspaceId) {
    setForm((current) => ({
      ...current,
      workspaceIds: current.workspaceIds.includes(workspaceId)
        ? current.workspaceIds.filter((id) => id !== workspaceId)
        : [...current.workspaceIds, workspaceId],
    }));
  }

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    const created = await onCreate(form);
    if (created) setForm({ displayName: "", username: "", password: "", role: "user", workspaceIds: [] });
    setSaving(false);
  }

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section aria-labelledby="users-title" className="management-dialog users-dialog" role="dialog">
        <header>
          <div><span className="eyebrow">إدارة الوصول</span><h2 id="users-title">المستخدمون والصلاحيات</h2><p>أنشئ حسابًا رقميًا وحدد الشركات التي يستطيع فتحها من أي جهاز.</p></div>
          <button aria-label="إغلاق" className="icon-button" onClick={onClose} type="button"><Icon path={mdiClose} size={1.05} /></button>
        </header>
        <div className="users-layout">
          <form className="new-user-form" onSubmit={submit}>
            <h3>إضافة مستخدم</h3>
            <label><span>الاسم</span><input maxLength={80} onChange={(event) => updateField("displayName", event.target.value)} required value={form.displayName} /></label>
            <label><span>اسم المستخدم</span><input dir="ltr" maxLength={30} onChange={(event) => updateField("username", event.target.value.replace(/[^A-Za-z0-9_.-]/g, ""))} required value={form.username} /></label>
            <label><span>كلمة مرور رقمية</span><input inputMode="numeric" maxLength={12} minLength={4} onChange={(event) => updateField("password", event.target.value.replace(/\D/g, ""))} pattern="[0-9]{4,12}" required type="password" value={form.password} /></label>
            <label><span>نوع الحساب</span><select onChange={(event) => updateField("role", event.target.value)} value={form.role}><option value="user">مستخدم</option><option value="admin">مدير</option></select></label>
            <fieldset><legend>الشركات المفوض عليها</legend>{workspaces.map((workspace) => <label key={workspace.id}><input checked={form.workspaceIds.includes(workspace.id)} onChange={() => toggleWorkspace(workspace.id)} type="checkbox" /><span>{workspace.name}</span></label>)}</fieldset>
            <button disabled={saving} type="submit"><Icon path={mdiPlus} size={0.78} /> {saving ? "جاري الإضافة…" : "إضافة المستخدم"}</button>
          </form>
          <div className="users-list">
            {loading ? <div className="management-loading"><span className="spinner" /> جاري تحميل المستخدمين…</div> : users.map((user) => <UserAccessRow currentUserId={currentUser.id} key={user.id} onUpdate={onUpdate} user={user} workspaces={workspaces} />)}
          </div>
        </div>
      </section>
    </div>
  );
}

function mergeMessageArchives(currentMessages, importedMessages) {
  const seen = new Set(currentMessages.map((message) => [message.address, message.date, message.type, message.body].join("\u241f")));
  const merged = [...currentMessages];
  for (const message of importedMessages) {
    const key = [message.address, message.date, message.type, message.body].join("\u241f");
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(message);
  }
  return sortMessages(merged);
}

export function App() {
  const [messages, setMessages] = useState([]);
  const [sourceName, setSourceName] = useState("لا يوجد ملف بعد");
  const [selectedAddress, setSelectedAddress] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [query, setQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(100);
  const [activeNav, setActiveNav] = useState("messages");
  const [previewMode, setPreviewMode] = useState("details");
  const [matchInput, setMatchInput] = useState(sampleMatchTerms.join("\n"));
  const [matchTerms, setMatchTerms] = useState(sampleMatchTerms);
  const [matches, setMatches] = useState([]);
  const [selectedByTerm, setSelectedByTerm] = useState({});
  const [selectionMode, setSelectionMode] = useState("auto");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateSort, setCandidateSort] = useState("smart");
  const [theme, setTheme] = useState("dark");
  const [deviceStyle, setDeviceStyle] = useState(() => localStorage.getItem("n9-phone-style") || "android");
  const [clockMode, setClockMode] = useState(() => localStorage.getItem("n9-phone-clock-mode") || "message");
  const [customTime, setCustomTime] = useState(() => localStorage.getItem("n9-phone-custom-time") || "09:41");
  const [importOpen, setImportOpen] = useState(false);
  const [composerOpen, setComposerOpen] = useState(false);
  const [matchPanelOpen, setMatchPanelOpen] = useState(() => window.innerWidth > 1220);
  const [conversationPanelOpen, setConversationPanelOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [restoringArchive, setRestoringArchive] = useState(true);
  const [toast, setToast] = useState("");
  const [sheetReport, setSheetReport] = useState("");
  const [exportingMatch, setExportingMatch] = useState(null);
  const [sessionLoading, setSessionLoading] = useState(true);
  const [currentUser, setCurrentUser] = useState(null);
  const [loginBusy, setLoginBusy] = useState(false);
  const [loginError, setLoginError] = useState("");
  const [workspaces, setWorkspaces] = useState([]);
  const [activeWorkspaceId, setActiveWorkspaceId] = useState(null);
  const [workspaceDialogOpen, setWorkspaceDialogOpen] = useState(false);
  const [usersDialogOpen, setUsersDialogOpen] = useState(false);
  const [users, setUsers] = useState([]);
  const [managementBusy, setManagementBusy] = useState(false);
  const captureRef = useRef(null);

  const activeWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === activeWorkspaceId) || workspaces[0] || null,
    [activeWorkspaceId, workspaces],
  );
  const conversations = useMemo(() => groupMessages(messages), [messages]);
  const searchResults = useMemo(() => {
    const normalized = normalizeComparable(query);
    if (!normalized) return [];
    return messages
      .filter((message) => normalizeComparable(`${message.contactName} ${message.address} ${message.body}`).includes(normalized))
      .sort((a, b) => Number(b.date) - Number(a.date))
      ;
  }, [messages, query]);

  const selectedConversation = useMemo(
    () => conversations.find((conversation) => conversation.address === selectedAddress) || conversations[0],
    [conversations, selectedAddress],
  );
  const selectedMessage = useMemo(
    () => messages.find((message) => message.id === selectedMessageId)
      || selectedConversation?.messages.at(-1)
      || messages[0],
    [messages, selectedConversation, selectedMessageId],
  );

  const matchGroups = useMemo(() => matchTerms.map((term) => {
    const smartCandidates = matches
      .filter((match) => match.terms.includes(term))
      .sort((a, b) => (b.scoreByTerm?.[term] || 0) - (a.scoreByTerm?.[term] || 0) || Number(b.message.date) - Number(a.message.date));
    const candidates = [...smartCandidates].sort((a, b) => {
      if (candidateSort === "newest") return Number(b.message.date) - Number(a.message.date);
      if (candidateSort === "oldest") return Number(a.message.date) - Number(b.message.date);
      return (b.scoreByTerm?.[term] || 0) - (a.scoreByTerm?.[term] || 0) || Number(b.message.date) - Number(a.message.date);
    });
    const normalizedCandidateQuery = normalizeComparable(candidateQuery);
    const visibleCandidates = normalizedCandidateQuery
      ? candidates.filter(({ message }) => normalizeComparable(`${message.contactName} ${message.address} ${message.body}`).includes(normalizedCandidateQuery))
      : candidates;
    return {
      term,
      candidates,
      visibleCandidates,
      recommendedId: smartCandidates[0]?.message.id,
    };
  }), [candidateQuery, candidateSort, matchTerms, matches]);

  const selectedEvidenceMatches = useMemo(() => matchGroups.flatMap((group) => {
    const selectedId = selectedByTerm[group.term];
    const selected = group.candidates.find((candidate) => candidate.message.id === selectedId) || group.candidates[0];
    return selected ? [{ term: group.term, message: selected.message, score: selected.scoreByTerm?.[group.term] || 0 }] : [];
  }), [matchGroups, selectedByTerm]);

  function applyArchive(archive) {
    const restoredMessages = Array.isArray(archive?.messages) ? archive.messages.map(normalizeMessageIdentity) : [];
    const grouped = groupMessages(restoredMessages);
    const restoredMatches = buildMatches(restoredMessages, sampleMatchTerms);
    const restoredSelection = {};
    sampleMatchTerms.forEach((term) => {
      const recommendation = restoredMatches
        .filter((match) => match.terms.includes(term))
        .sort((a, b) => (b.scoreByTerm?.[term] || 0) - (a.scoreByTerm?.[term] || 0) || Number(b.message.date) - Number(a.message.date))[0];
      if (recommendation) restoredSelection[term] = recommendation.message.id;
    });
    setMessages(restoredMessages);
    setSourceName(archive?.sourceName || "لا يوجد ملف بعد");
    setSelectedAddress(grouped[0]?.address || "");
    setSelectedMessageId(grouped[0]?.last.id || "");
    setMatches(restoredMatches);
    setSelectedByTerm(restoredSelection);
    setQuery("");
    setSearchLimit(100);
    setSheetReport("");
  }

  useEffect(() => {
    let cancelled = false;
    initializeWorkspaceSession(sampleMessages)
      .then(({ user, workspaces: initialWorkspaces }) => {
        if (cancelled) return;
        setCurrentUser(user);
        setWorkspaces(initialWorkspaces || []);
        setActiveWorkspaceId(initialWorkspaces?.[0]?.id || null);
      })
      .catch((error) => {
        if (!cancelled) setLoginError(error.message || "تعذر تهيئة نظام الدخول.");
      })
      .finally(() => {
        if (!cancelled) setSessionLoading(false);
      });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!currentUser || !activeWorkspaceId) {
      if (currentUser && !activeWorkspaceId) applyArchive({ sourceName: "لا يوجد ملف بعد", messages: [] });
      setRestoringArchive(false);
      return undefined;
    }
    let cancelled = false;
    setRestoringArchive(true);
    getWorkspaceArchive(activeWorkspaceId)
      .then((archive) => {
        if (!cancelled) applyArchive(archive);
      })
      .catch((error) => {
        if (!cancelled) {
          applyArchive({ sourceName: "تعذر تحميل الأرشيف", messages: [] });
          setToast(error.message || "تعذر تحميل رسائل الشركة.");
        }
      })
      .finally(() => {
        if (!cancelled) setRestoringArchive(false);
      });
    return () => { cancelled = true; };
  }, [activeWorkspaceId, currentUser?.id]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  useEffect(() => {
    localStorage.setItem("n9-phone-style", deviceStyle);
    localStorage.setItem("n9-phone-clock-mode", clockMode);
    localStorage.setItem("n9-phone-custom-time", customTime);
  }, [clockMode, customTime, deviceStyle]);

  function chooseMessage(message) {
    setSelectedAddress(message.address);
    setSelectedMessageId(message.id);
    setPreviewMode("details");
  }

  function recommendSelections(terms, nextMatches) {
    const nextSelection = {};
    terms.forEach((term) => {
      const recommendation = nextMatches
        .filter((match) => match.terms.includes(term))
        .sort((a, b) => (b.scoreByTerm?.[term] || 0) - (a.scoreByTerm?.[term] || 0) || Number(b.message.date) - Number(a.message.date))[0];
      if (recommendation) nextSelection[term] = recommendation.message.id;
    });
    setSelectedByTerm(nextSelection);
    return nextSelection;
  }

  function runMatch(terms = extractTerms(matchInput)) {
    setMatchTerms(terms);
    const nextMatches = buildMatches(messages, terms);
    setMatches(nextMatches);
    const selections = recommendSelections(terms, nextMatches);
    const firstSelectedId = Object.values(selections)[0];
    const firstSelected = nextMatches.find((match) => match.message.id === firstSelectedId);
    if (firstSelected) chooseMessage(firstSelected.message);
    const matchedTermCount = new Set(nextMatches.flatMap((match) => match.terms)).size;
    setToast(nextMatches.length
      ? `طابقت ${matchedTermCount.toLocaleString("ar-SA")} من ${terms.length.toLocaleString("ar-SA")} رقم داخل ${nextMatches.length.toLocaleString("ar-SA")} رسالة`
      : `لم نجد رسائل لأي من الأرقام المطلوبة (${terms.length.toLocaleString("ar-SA")})`);
  }

  async function handleXmlUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!activeWorkspace) {
      setToast("أنشئ مساحة شركة أولًا ثم ارفع ملف الرسائل داخلها.");
      event.target.value = "";
      return;
    }
    setBusy(true);
    try {
      if (file.size > 70 * 1024 * 1024) throw new Error("ملف XML أكبر من 70 MB. قسّمه إلى أكثر من ملف لضمان الحفظ الآمن.");
      await new Promise((resolve) => window.setTimeout(resolve, 80));
      const parsed = await parseXmlFile(file);
      const merged = mergeMessageArchives(messages, parsed);
      const addedCount = merged.length - messages.length;
      await saveWorkspaceArchive(activeWorkspace.id, merged, file.name);
      setMessages(merged);
      setSourceName(file.name);
      const grouped = groupMessages(merged);
      setSelectedAddress(grouped[0]?.address || "");
      setSelectedMessageId(grouped[0]?.last.id || "");
      setMatches([]);
      setSelectedByTerm({});
      setSheetReport("");
      setImportOpen(false);
      const missingDates = parsed.filter((message) => !message.date).length;
      setWorkspaces(await listWorkspaces());
      setToast(missingDates
        ? `أضيفت ${addedCount.toLocaleString("ar-SA")} رسالة إلى ${activeWorkspace.name}؛ ${missingDates.toLocaleString("ar-SA")} بلا تاريخ XML`
        : `حُفظت ${addedCount.toLocaleString("ar-SA")} رسالة جديدة داخل ${activeWorkspace.name} · الإجمالي ${merged.length.toLocaleString("ar-SA")}`);
    } catch (error) {
      setToast(error.message || "تعذر استيراد الملف");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handleSheetUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    setBusy(true);
    try {
      if (file.size > 80 * 1024 * 1024) throw new Error("ملف Excel أكبر من 80 MB. قسّمه إلى دفعات لضمان قراءة مستقرة.");
      const XLSX = await import("xlsx");
      const buffer = await file.arrayBuffer();
      const workbook = XLSX.read(buffer, { type: "array" });
      const { terms, diagnostics } = extractWorkbookTerms(workbook, XLSX);
      if (diagnostics.unsafePrecisionCells) {
        throw new Error(`وجدنا ${diagnostics.unsafePrecisionCells.toLocaleString("ar-SA")} رقمًا أطول من دقة Excel. حوّل هذه الخلايا إلى «نص» ثم أعد الرفع حتى لا تتغير الخانات.`);
      }
      if (diagnostics.ambiguousSheetCount) {
        throw new Error(`وجدنا ${diagnostics.ambiguousSheetCount.toLocaleString("ar-SA")} ورقة متعددة الأعمدة بلا عنوان واضح. سمِّ عمود الأرقام «رقم» أو «مرجع» ثم أعد الرفع.`);
      }
      if (!terms.length) throw new Error("لم نجد أرقامًا صالحة داخل ملف المطابقة.");
      if (terms.length > 10000) throw new Error("الملف يحتوي أكثر من 10,000 رقم. قسّمه إلى دفعات لتبقى المطابقة مستقرة.");
      setMatchInput(terms.join("\n"));
      setMatchTerms(terms);
      setImportOpen(false);
      setMatchPanelOpen(true);
      runMatch(terms);
      const reportParts = [
        `${diagnostics.sheetCount.toLocaleString("ar-SA")} ورقة`,
        `${terms.length.toLocaleString("ar-SA")} رقم فريد`,
        `${diagnostics.duplicateCount.toLocaleString("ar-SA")} مكرر متجاهل`,
      ];
      if (diagnostics.ignoredDateCells) reportParts.push(`${diagnostics.ignoredDateCells.toLocaleString("ar-SA")} تاريخ متجاهل`);
      if (diagnostics.scientificCells) reportParts.push(`${diagnostics.scientificCells.toLocaleString("ar-SA")} صيغة علمية مصححة`);
      const report = reportParts.join(" · ");
      setSheetReport(report);
      setToast(`تم استقبال Excel دون دمج التواريخ أو المبالغ: ${report}`);
    } catch (error) {
      setToast(error.message || "تعذر قراءة ملف Excel");
    } finally {
      setBusy(false);
      event.target.value = "";
    }
  }

  async function handleCreateManualMessage(input) {
    if (!activeWorkspace) {
      setToast("أنشئ مساحة شركة أولًا ثم أضف الرسالة داخلها.");
      return false;
    }
    setBusy(true);
    try {
      const existingConversation = conversations.find((conversation) => conversation.address === input.existingAddress);
      const manualMessage = buildManualMessage({
        ...input,
        existingContactName: existingConversation?.contactName,
      }, `manual-${crypto.randomUUID()}`);
      const nextMessages = sortMessages([...messages, manualMessage]);
      const nextSourceName = sourceName === "لا يوجد ملف بعد" ? "رسائل منشأة يدويًا" : sourceName;
      await saveWorkspaceArchive(activeWorkspace.id, nextMessages, nextSourceName);
      setMessages(nextMessages);
      setSourceName(nextSourceName);
      setSelectedAddress(manualMessage.address);
      setSelectedMessageId(manualMessage.id);
      setPreviewMode("conversation");
      const nextMatches = buildMatches(nextMessages, matchTerms);
      setMatches(nextMatches);
      if (selectionMode === "auto") recommendSelections(matchTerms, nextMatches);
      setWorkspaces(await listWorkspaces());
      setComposerOpen(false);
      setActiveNav("messages");
      setConversationPanelOpen(false);
      setToast(`تم إنشاء الرسالة وحفظها داخل محادثة ${manualMessage.contactName}`);
      return true;
    } catch (error) {
      setToast(error.message || "تعذر إنشاء الرسالة.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function exportCurrentImage() {
    if (!captureRef.current || !selectedMessage) return;
    try {
      await document.fonts.ready;
      const dataUrl = await toPng(captureRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: theme === "light" ? "#f7f9fc" : "#171a1d" });
      downloadDataUrl(dataUrl, `N9-SMS-${selectedMessage.address}-${selectedMessage.id}.png`);
      setToast("تم تصدير صورة الدليل بدقة عالية");
    } catch {
      setToast("تعذر تصدير الصورة. أعد المحاولة بعد اكتمال تحميل الخط.");
    }
  }

  async function exportAllImages() {
    if (!selectedEvidenceMatches.length) return;
    const zip = new JSZip();
    setToast(`جاري تجهيز ${selectedEvidenceMatches.length.toLocaleString("ar-SA")} صورة مختارة داخل ملف ZIP`);
    try {
      for (let index = 0; index < selectedEvidenceMatches.length; index += 1) {
        const match = selectedEvidenceMatches[index];
        setExportingMatch(match.message);
        await new Promise((resolve) => window.setTimeout(resolve, 180));
        if (captureRef.current) {
          const dataUrl = await toPng(captureRef.current, { pixelRatio: 2, cacheBust: true, backgroundColor: theme === "light" ? "#f7f9fc" : "#171a1d" });
          const base64 = dataUrl.split(",")[1];
          const safeSender = String(match.message.address).replace(/[<>:"/\\|?*]/g, "-").slice(0, 42);
          const safeTerm = String(match.term).replace(/[<>:"/\\|?*]/g, "-").slice(0, 42);
          zip.file(`${String(index + 1).padStart(3, "0")}-${safeTerm}-${safeSender}-${match.message.id}.png`, base64, { base64: true });
        }
        if ((index + 1) % 10 === 0) setToast(`تم تجهيز ${index + 1} من ${selectedEvidenceMatches.length} صورة`);
      }
      const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
      downloadBlob(archive, "N9-SMS-evidence-images.zip");
      setToast("اكتمل تصدير جميع صور المطابقة داخل ملف ZIP واحد");
    } catch {
      setToast("تعذر إكمال ملف الصور. جرّب تقليل عدد نتائج المطابقة.");
    } finally {
      setExportingMatch(null);
    }
  }

  function exportCsv() {
    if (!selectedEvidenceMatches.length) return;
    const rows = [
      ["match", "sender", "contact", "received_or_sent_date", "date_sent", "delivery_date", "message"],
      ...selectedEvidenceMatches.map(({ message, term }) => [term, message.address, message.contactName, toIsoTimestamp(message.date), toIsoTimestamp(message.dateSent), toIsoTimestamp(message.deliveryDate), message.body]),
    ];
    downloadText(`\uFEFF${rows.map((row) => row.map(quoteCsvCell).join(",")).join("\r\n")}`, "N9-SMS-matches.csv");
    setToast("تم تصدير جدول النتائج");
  }

  async function copyCurrentMessage() {
    if (!selectedMessage?.body) return;
    try {
      await navigator.clipboard.writeText(selectedMessage.body);
    } catch {
      const field = document.createElement("textarea");
      field.value = selectedMessage.body;
      field.style.position = "fixed";
      field.style.opacity = "0";
      document.body.appendChild(field);
      field.select();
      document.execCommand("copy");
      field.remove();
    }
    setToast("تم نسخ محتوى الرسالة");
  }

  function selectCandidate(term, message) {
    setSelectionMode("manual");
    setSelectedByTerm((current) => ({ ...current, [term]: message.id }));
    chooseMessage(message);
  }

  function switchToAutomatic() {
    setSelectionMode("auto");
    const selections = recommendSelections(matchTerms, matches);
    const firstSelectedId = Object.values(selections)[0];
    const firstSelected = matches.find((match) => match.message.id === firstSelectedId);
    if (firstSelected) chooseMessage(firstSelected.message);
    setToast("تم اختيار أفضل رسالة لكل رقم تلقائيًا");
  }

  async function handleLogin(username, password) {
    setLoginBusy(true);
    setLoginError("");
    try {
      const result = await login(username, password);
      setCurrentUser(result.user);
      setWorkspaces(result.workspaces || []);
      setActiveWorkspaceId(result.workspaces?.[0]?.id || null);
    } catch (error) {
      setLoginError(error.message || "تعذر تسجيل الدخول.");
    } finally {
      setLoginBusy(false);
    }
  }

  async function handleLogout() {
    try { await logout(); } catch {}
    setCurrentUser(null);
    setWorkspaces([]);
    setActiveWorkspaceId(null);
    setUsers([]);
    setMessages([]);
    setMatches([]);
    setSelectedByTerm({});
    setLoginError("");
  }

  async function handleCreateWorkspace(name) {
    setManagementBusy(true);
    try {
      const workspace = await createWorkspace(name);
      const refreshed = await listWorkspaces();
      setWorkspaces(refreshed);
      setActiveWorkspaceId(workspace.id);
      setToast(`تم إنشاء مساحة ${workspace.name} وحفظها بشكل مستقل`);
      return workspace;
    } catch (error) {
      setToast(error.message || "تعذر إنشاء مساحة الشركة.");
      return null;
    } finally {
      setManagementBusy(false);
    }
  }

  function handleSelectWorkspace(workspaceId) {
    setActiveWorkspaceId(workspaceId);
    setWorkspaceDialogOpen(false);
    setConversationPanelOpen(false);
  }

  async function openUsersDialog() {
    setUsersDialogOpen(true);
    setManagementBusy(true);
    try {
      setUsers(await listUsers());
    } catch (error) {
      setToast(error.message || "تعذر تحميل المستخدمين.");
    } finally {
      setManagementBusy(false);
    }
  }

  async function handleCreateUser(input) {
    try {
      if (!/^[A-Za-z0-9_.-]{3,30}$/.test(input.username)) throw new Error("اسم المستخدم يجب أن يكون 3–30 حرفًا إنجليزيًا أو رقمًا.");
      if (!/^\d{4,12}$/.test(input.password)) throw new Error("كلمة المرور يجب أن تكون من 4 إلى 12 رقمًا.");
      await createUser(input);
      setUsers(await listUsers());
      setToast(`تم إنشاء المستخدم ${input.username} وتطبيق صلاحيات الشركات`);
      return true;
    } catch (error) {
      setToast(error.message || "تعذر إنشاء المستخدم.");
      return false;
    }
  }

  async function handleUpdateUser(userId, input) {
    try {
      await updateUser(userId, input);
      if (userId === currentUser.id && input.password) {
        setUsersDialogOpen(false);
        await handleLogout();
        return true;
      }
      setUsers(await listUsers());
      setToast("تم تحديث صلاحيات المستخدم");
      return true;
    } catch (error) {
      setToast(error.message || "تعذر تحديث المستخدم.");
      return false;
    }
  }

  if (sessionLoading) {
    return <main className="login-screen" dir="rtl"><div className="session-loading"><span className="spinner" /><strong>جاري تجهيز مساحة N9 SMS الآمنة…</strong></div></main>;
  }

  if (!currentUser) return <LoginScreen busy={loginBusy} error={loginError} onLogin={handleLogin} />;

  return (
    <main className={`app-shell theme-${theme}`} dir="rtl">
      <aside className="side-rail" aria-label="التنقل الرئيسي">
        <div className="brand-mark" aria-label="N9 SMS"><Icon path={mdiMessageProcessingOutline} size={1.28} /></div>
        <nav>
          <NavButton active={activeNav === "messages"} icon={mdiMessageTextOutline} label="الرسائل" onClick={() => setActiveNav("messages")} />
          <NavButton active={composerOpen} icon={mdiMessagePlusOutline} label="منشئ الرسالة" onClick={() => { setActiveNav("composer"); setComposerOpen(true); }} />
          <NavButton active={activeNav === "matches"} icon={mdiTuneVariant} label="المطابقة" onClick={() => { setActiveNav("matches"); setMatchPanelOpen(true); }} />
          <NavButton active={activeNav === "files"} icon={mdiFolderOutline} label="الملفات" onClick={() => { setActiveNav("files"); setImportOpen(true); }} />
          <NavButton active={workspaceDialogOpen} icon={mdiOfficeBuildingOutline} label="الشركات" onClick={() => setWorkspaceDialogOpen(true)} />
          {currentUser.role === "admin" && <NavButton active={usersDialogOpen} icon={mdiAccountMultipleOutline} label="المستخدمون" onClick={openUsersDialog} />}
        </nav>
        <button aria-label="تسجيل الخروج" className="rail-logout" onClick={handleLogout} title="تسجيل الخروج" type="button"><Icon path={mdiLogout} size={0.9} /></button>
        <div className="privacy-mark" title="بيانات الشركات معزولة"><Icon path={mdiDatabaseLockOutline} size={1.02} /><span>{isLocalPreview ? "محلي" : "محمي"}</span></div>
      </aside>

      <section className={`conversation-list ${conversationPanelOpen ? "is-open" : ""}`} aria-label="المحادثات">
        <header className="list-header">
          <div>
            <span className="eyebrow">مساحة الأدلة</span>
            <h1>N9 SMS</h1>
          </div>
          <div className="list-header-actions">
            <button aria-label="إغلاق المحادثات" className="icon-button responsive-list-close" onClick={() => setConversationPanelOpen(false)} type="button"><Icon path={mdiClose} size={1.02} /></button>
            <button aria-label="إنشاء رسالة" className="icon-button" onClick={() => { setActiveNav("composer"); setComposerOpen(true); }} title="منشئ الرسالة" type="button"><Icon path={mdiMessagePlusOutline} size={1.02} /></button>
            <button aria-label="استيراد ملف" className="icon-button accent" onClick={() => setImportOpen(true)} type="button"><Icon path={mdiTrayArrowUp} size={1.02} /></button>
          </div>
        </header>
        <button className="workspace-switcher" onClick={() => setWorkspaceDialogOpen(true)} type="button">
          <span className="workspace-switcher-icon"><Icon path={mdiOfficeBuildingOutline} size={0.88} /></span>
          <span><small>الشركة المفتوحة</small><strong>{activeWorkspace?.name || "اختر شركة"}</strong></span>
          <Icon path={mdiChevronDown} size={0.78} />
        </button>
        <div className="source-pill"><Icon path={mdiCheckCircle} size={0.72} /><span>{restoringArchive ? "جاري تحميل أرشيف الشركة…" : `${sourceName} · ${messages.length.toLocaleString("ar-SA")} رسالة`}</span></div>
        <label className="search-box">
          <Icon path={mdiMagnify} size={0.9} />
          <input aria-label="البحث في جميع الرسائل" onChange={(event) => { setQuery(event.target.value); setSearchLimit(100); }} placeholder="ابحث دون إخفاء المحادثات" value={query} />
          {query && <button aria-label="مسح البحث" className="search-clear" onClick={() => { setQuery(""); setSearchLimit(100); }} type="button"><Icon path={mdiClose} size={0.72} /></button>}
        </label>
        <div className="conversation-items">
          {query && (
            <section className="search-results-block" aria-label="نتائج البحث">
              <div className="conversation-count search-count"><span>نتائج البحث</span><span>عرض {Math.min(searchLimit, searchResults.length).toLocaleString("ar-SA")} من {searchResults.length.toLocaleString("ar-SA")}</span></div>
              {searchResults.length ? searchResults.slice(0, searchLimit).map((message) => (
                <button className={`search-result-item ${selectedMessage?.id === message.id ? "is-selected" : ""}`} key={message.id} onClick={() => { chooseMessage(message); setConversationPanelOpen(false); }} type="button">
                  <span className="search-result-top"><strong>{message.contactName === "(Unknown)" ? message.address : message.contactName}</strong><small>{formatShortDate(message.date)} · {formatTime(message.date)}</small></span>
                  <span className="search-result-snippet">{message.body}</span>
                </button>
              )) : <div className="search-empty">لا توجد رسائل مطابقة، وما زالت جميع المحادثات ظاهرة أدناه.</div>}
              {searchResults.length > searchLimit && (
                <div className="search-more-actions">
                  <button onClick={() => setSearchLimit((current) => Math.min(current + 100, searchResults.length))} type="button">عرض 100 رسالة أخرى</button>
                  <button onClick={() => setSearchLimit(searchResults.length)} type="button">عرض كل النتائج</button>
                </div>
              )}
              <div className="all-conversations-divider"><span>كل المحادثات</span><span>{conversations.length.toLocaleString("ar-SA")}</span></div>
            </section>
          )}
          {!query && <div className="conversation-count embedded-count"><span>المحادثات</span><span>{conversations.length.toLocaleString("ar-SA")}</span></div>}
          {!conversations.length && !restoringArchive && (
            <div className="company-empty-state">
              <span><Icon path={mdiOfficeBuildingOutline} size={1.25} /></span>
              <strong>لا توجد رسائل في {activeWorkspace?.name}</strong>
              <small>ارفع XML أو أنشئ أول رسالة، وسيبقى أرشيف هذه الشركة منفصلًا ومحفوظًا.</small>
              <div className="empty-state-actions"><button onClick={() => setImportOpen(true)} type="button"><Icon path={mdiTrayArrowUp} size={0.75} /> رفع XML</button><button onClick={() => setComposerOpen(true)} type="button"><Icon path={mdiMessagePlusOutline} size={0.75} /> إنشاء رسالة</button></div>
            </div>
          )}
          {conversations.map((conversation) => (
            <button
              className={`conversation-item ${selectedConversation?.address === conversation.address ? "is-selected" : ""}`}
              key={conversation.address}
              onClick={() => {
                setSelectedAddress(conversation.address);
                setSelectedMessageId(conversation.last.id);
                setPreviewMode("conversation");
                setConversationPanelOpen(false);
              }}
              type="button"
            >
              <span className="list-avatar" style={{ background: conversation.color }}>{getInitials(conversation.contactName)}</span>
              <span className="conversation-copy">
                <span className="conversation-title"><strong>{conversation.contactName}</strong><small>{formatShortDate(conversation.last.date)}</small></span>
                <span className="conversation-snippet">{conversation.last.body}</span>
                <span className="conversation-meta"><b>{conversation.address}</b><span>{conversation.messages.length.toLocaleString("ar-SA")} رسالة</span></span>
              </span>
              {conversation.unread > 0 && <span className="unread-dot">{conversation.unread}</span>}
            </button>
          ))}
        </div>
      </section>

      <section className="preview-stage" aria-label="معاينة الرسالة">
        <header className="stage-toolbar">
          <div className="stage-contact">
            <span className="stage-avatar">{getInitials(selectedConversation?.contactName)}</span>
            <span><strong>{selectedConversation?.contactName || "اختر محادثة"}</strong><small>{selectedConversation?.address || "—"}</small></span>
          </div>
          <div className="stage-actions">
            <div className="view-switch" aria-label="نوع المعاينة">
              <button className={previewMode === "conversation" ? "is-active" : ""} onClick={() => setPreviewMode("conversation")} type="button">محادثة</button>
              <button className={previewMode === "details" ? "is-active" : ""} onClick={() => setPreviewMode("details")} type="button">دليل</button>
            </div>
            <button className="toolbar-button responsive-list" onClick={() => setConversationPanelOpen(true)} type="button"><Icon path={mdiMessageTextOutline} size={0.78} /> المحادثات</button>
            <button className="toolbar-button responsive-match" onClick={() => setMatchPanelOpen(true)} type="button"><Icon path={mdiTuneVariant} size={0.78} /> المطابقة</button>
            <button aria-label="نسخ محتوى الرسالة" className="toolbar-button compact-action" disabled={!selectedMessage} onClick={copyCurrentMessage} title="نسخ الرسالة" type="button"><Icon path={mdiContentCopy} size={0.78} /><span>نسخ</span></button>
            <button aria-label={theme === "dark" ? "تفعيل الثيم الفاتح" : "تفعيل الثيم الداكن"} className="toolbar-button compact-action" onClick={() => setTheme((current) => current === "dark" ? "light" : "dark")} title={theme === "dark" ? "ثيم فاتح" : "ثيم داكن"} type="button">
              <Icon path={theme === "dark" ? mdiWhiteBalanceSunny : mdiWeatherNight} size={0.8} /><span>{theme === "dark" ? "فاتح" : "داكن"}</span>
            </button>
            {currentUser.role === "admin" && <button aria-label="إدارة المستخدمين" className="toolbar-button responsive-account" onClick={openUsersDialog} type="button"><Icon path={mdiAccountMultipleOutline} size={0.8} /></button>}
            <button aria-label="تسجيل الخروج" className="toolbar-button responsive-account" onClick={handleLogout} type="button"><Icon path={mdiLogout} size={0.8} /></button>
            <button className="toolbar-button primary" onClick={exportCurrentImage} type="button"><Icon path={mdiCellphoneScreenshot} size={0.82} /> تصدير الصورة</button>
          </div>
        </header>
        <div className="stage-canvas">
          <section className="phone-customizer" aria-label="تخصيص مظهر الهاتف ووقته">
            <label>
              <span>نظام الهاتف</span>
              <select onChange={(event) => setDeviceStyle(event.target.value)} value={deviceStyle}>
                <option value="android">Google Android</option>
                <option value="huawei">Huawei EMUI</option>
                <option value="iphone">Apple iPhone</option>
              </select>
            </label>
            <label>
              <span>وقت الشاشة</span>
              <select onChange={(event) => setClockMode(event.target.value)} value={clockMode}>
                <option value="message">وقت الرسالة الأصلي</option>
                <option value="live">الوقت الحقيقي الآن</option>
                <option value="custom">وقت أحدده</option>
              </select>
            </label>
            {clockMode === "custom" && <label className="custom-time-field"><span>الوقت المختار</span><input aria-label="الوقت المخصص لشاشة الهاتف" onChange={(event) => setCustomTime(event.target.value)} type="time" value={customTime} /></label>}
            <div className="phone-style-summary"><span className={`style-dot style-${deviceStyle}`} /><strong>{deviceStyle === "iphone" ? "iMessage" : deviceStyle === "huawei" ? "Huawei Messages" : "Google Messages"}</strong></div>
          </section>
          <div className="stage-label">
            <Icon path={mdiInformationOutline} size={0.72} />
            {!messages.length
              ? `مساحة ${activeWorkspace?.name || "الشركة"} فارغة. ارفع ملف XML لإضافة رسائلها دون خلطها بالشركات الأخرى.`
              : previewMode === "conversation"
                ? sourceName === "بيانات تجريبية"
                  ? `هذه عينة فقط: تعرض المحادثة كاملة وعددها ${selectedConversation?.messages.length?.toLocaleString("ar-SA") || 0} رسائل. ارفع XML لعرض أرشيفك.`
                  : `عرض كامل لمحادثة ${activeWorkspace?.name}: ${selectedConversation?.messages.length?.toLocaleString("ar-SA") || 0} رسالة. مرّر للأعلى للوصول إلى الأقدم.`
                : `دليل من ${activeWorkspace?.name || "الشركة المفتوحة"} — اختر رسالة ثم صدّر الصورة.`}
          </div>
          <div className={`phone-frame frame-${deviceStyle}`}>
            {previewMode === "conversation"
              ? <ConversationPhone clockMode={clockMode} conversation={selectedConversation} customTime={customTime} deviceStyle={deviceStyle} onSelect={(id) => { setSelectedMessageId(id); setPreviewMode("details"); }} selectedId={selectedMessage?.id} theme={theme} />
              : <EvidencePhone clockMode={clockMode} customTime={customTime} deviceStyle={deviceStyle} message={selectedMessage} theme={theme} />}
          </div>
          <div className="stage-footer">
            <span><Icon path={mdiCheck} size={0.72} /> صورة الهاتف لا تعرض أدوات الموقع</span>
            <span>{selectedMessage ? formatDate(selectedMessage.date) : "—"}</span>
          </div>
        </div>
      </section>

      <aside className={`match-panel ${matchPanelOpen ? "is-open" : ""}`} aria-label="المطابقة الذكية">
        <header className="match-header">
          <div><span className="eyebrow">الخطوة الثانية</span><h2>المطابقة الذكية</h2><p>ألصق الأرقام أو ارفع Excel</p></div>
          <button aria-label="إغلاق المطابقة" className="icon-button match-close" onClick={() => setMatchPanelOpen(false)} type="button"><Icon path={mdiClose} size={1} /></button>
        </header>
        <label className="terms-field">
          <span>الأرقام المطلوبة</span>
          <textarea onChange={(event) => { setMatchInput(event.target.value); setSheetReport(""); }} placeholder="مثال: 2000000" value={matchInput} />
          <small>رقم في كل سطر، أو افصل بينها بفاصلة.</small>
        </label>
        {sheetReport && <div className="sheet-report"><Icon path={mdiCheckCircle} size={0.7} /><span>{sheetReport}</span></div>}
        <div className="match-buttons">
          <button className="match-run" onClick={() => runMatch()} type="button"><Icon path={mdiMagnify} size={0.84} /> تنفيذ المطابقة</button>
          <button className="match-upload" onClick={() => setImportOpen(true)} type="button"><Icon path={mdiFileTableOutline} size={0.84} /> Excel / CSV</button>
        </div>
        <div className="selection-mode" aria-label="طريقة اختيار الدليل">
          <button className={selectionMode === "auto" ? "is-active" : ""} onClick={switchToAutomatic} type="button">اختيار ذكي</button>
          <button className={selectionMode === "manual" ? "is-active" : ""} onClick={() => setSelectionMode("manual")} type="button">اختيار يدوي</button>
        </div>
        <div className="candidate-tools">
          <label className="candidate-search">
            <Icon path={mdiMagnify} size={0.72} />
            <input aria-label="البحث داخل الرسائل المرشحة" onChange={(event) => setCandidateQuery(event.target.value)} placeholder="ابحث داخل كل الرسائل المرشحة" value={candidateQuery} />
            {candidateQuery && <button aria-label="مسح بحث المرشحين" onClick={() => setCandidateQuery("")} type="button"><Icon path={mdiClose} size={0.66} /></button>}
          </label>
          <label className="candidate-sort">
            <span>الترتيب</span>
            <select aria-label="ترتيب الرسائل المرشحة" onChange={(event) => setCandidateSort(event.target.value)} value={candidateSort}>
              <option value="smart">الأذكى</option>
              <option value="newest">الأحدث</option>
              <option value="oldest">الأقدم</option>
            </select>
          </label>
        </div>
        <div className="result-summary">
          <span className="result-icon"><Icon path={matches.length ? mdiCheckCircle : mdiAlertCircleOutline} size={1.08} /></span>
          <span><strong>{selectedEvidenceMatches.length.toLocaleString("ar-SA")} دليل مختار</strong><small>{matches.length.toLocaleString("ar-SA")} رسالة مرشحة عبر {matchTerms.length.toLocaleString("ar-SA")} رقم</small></span>
        </div>
        <div className="matches-heading"><span>الرسائل المرشحة لكل رقم</span><span>{matchGroups.length}</span></div>
        <div className="match-results">
          {matchTerms.length ? matchGroups.map((group) => (
            <section className="match-group" key={group.term}>
              <header><strong dir="ltr">{group.term}</strong><span>{group.visibleCandidates.length === group.candidates.length ? `${group.candidates.length.toLocaleString("ar-SA")} رسالة` : `${group.visibleCandidates.length.toLocaleString("ar-SA")} من ${group.candidates.length.toLocaleString("ar-SA")}`}</span></header>
              {!group.candidates.length && (
                <div className="unmatched-number"><Icon path={mdiAlertCircleOutline} size={0.82} /><span><strong>لا توجد رسالة مطابقة</strong><small>أُبقي الرقم ظاهرًا حتى لا يُستبعد بصمت.</small></span></div>
              )}
              {group.candidates.length > 0 && !group.visibleCandidates.length && (
                <div className="unmatched-number filtered-empty"><Icon path={mdiMagnify} size={0.82} /><span><strong>لا توجد نتيجة ضمن البحث</strong><small>امسح بحث المرشحين لعرض الرسائل كاملة.</small></span></div>
              )}
              {group.visibleCandidates.map(({ message, scoreByTerm }) => {
                const isChosen = (selectedByTerm[group.term] || group.recommendedId) === message.id;
                const isRecommended = group.recommendedId === message.id;
                return (
                  <button className={`match-item ${isChosen ? "is-chosen" : ""} ${selectedMessage?.id === message.id ? "is-previewed" : ""}`} key={`${group.term}-${message.id}`} onClick={() => selectCandidate(group.term, message)} type="button">
                    <span className="candidate-check"><Icon path={isChosen ? mdiCheckCircle : mdiCircleOutline} size={0.76} /></span>
                    <span className="candidate-copy">
                      <span className="match-item-top"><strong>{message.contactName === "(Unknown)" ? message.address : message.contactName}</strong><small>{formatShortDate(message.date)} · {formatTime(message.date)}</small></span>
                      <span className="match-snippet">{message.body}</span>
                      <span className="candidate-meta">{isRecommended ? "الترشيح الأذكى" : "اختيار بديل"} · {message.type === "2" ? "صادرة" : "واردة"} · درجة {scoreByTerm?.[group.term] || 0}</span>
                    </span>
                  </button>
                );
              })}
            </section>
          )) : <div className="empty-results"><Icon path={mdiMagnify} size={1.3} /><strong>لا توجد أرقام بعد</strong><span>أضف رقمًا ثم نفّذ المطابقة.</span></div>}
        </div>
        <div className="export-actions">
          <button disabled={!selectedEvidenceMatches.length} onClick={exportAllImages} type="button"><Icon path={mdiImageMultipleOutline} size={0.8} /> تصدير المختار ZIP</button>
          <button disabled={!selectedEvidenceMatches.length} onClick={exportCsv} type="button"><Icon path={mdiDownload} size={0.8} /> CSV</button>
        </div>
      </aside>

      {importOpen && <ImportDialog busy={busy} onClose={() => !busy && setImportOpen(false)} onSheet={handleSheetUpload} onXml={handleXmlUpload} />}
      {composerOpen && <MessageComposerDialog busy={busy} conversations={conversations} onClose={() => { if (!busy) { setComposerOpen(false); setActiveNav("messages"); } }} onCreate={handleCreateManualMessage} selectedAddress={selectedConversation?.address} />}
      {workspaceDialogOpen && <WorkspaceDialog activeId={activeWorkspace?.id} busy={managementBusy} onClose={() => setWorkspaceDialogOpen(false)} onCreate={handleCreateWorkspace} onSelect={handleSelectWorkspace} workspaces={workspaces} />}
      {usersDialogOpen && <UsersDialog currentUser={currentUser} loading={managementBusy} onClose={() => setUsersDialogOpen(false)} onCreate={handleCreateUser} onUpdate={handleUpdateUser} users={users} workspaces={workspaces} />}
      {toast && <div className="toast" role="status"><Icon path={mdiCheckCircle} size={0.82} />{toast}</div>}

      <div className="export-capture" aria-hidden="true">
        <div ref={captureRef}><EvidencePhone capture clockMode={clockMode} customTime={customTime} deviceStyle={deviceStyle} message={exportingMatch || selectedMessage} theme={theme} /></div>
      </div>
    </main>
  );
}
