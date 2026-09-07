import { memo, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import Icon from "@mdi/react";
import {
  mdiAlertCircleOutline,
  mdiAccount,
  mdiAccountMultipleOutline,
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
  mdiEyeOffOutline,
  mdiEyeOutline,
  mdiFileDocumentOutline,
  mdiFileExcelOutline,
  mdiFileTableOutline,
  mdiFolderOutline,
  mdiImageMultipleOutline,
  mdiInformationOutline,
  mdiLockOutline,
  mdiLockOpenVariantOutline,
  mdiLogout,
  mdiMagnify,
  mdiMicrophoneOutline,
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
} from "@mdi/js";
import { toPng } from "html-to-image";
import JSZip from "jszip";
import {
  buildManualMessage,
  buildMatches,
  extractTerms,
  extractWorkbookTerms,
  filterConversationMessages,
  filterMatchCandidates,
  getMessageTimeline,
  normalizeComparable,
  normalizeMessageIdentity,
  parseXmlTimestamp,
  quoteCsvCell,
  toIsoTimestamp,
} from "./dataUtils.js";
import { buildConversationReferenceRows } from "./conversationExportUtils.js";
import { StoredZipBuilder } from "./zipUtils.js";
import {
  buildEvidenceBaseName,
  createJpegPdf,
  imageDataUrlToJpeg,
  sanitizeEvidenceName,
} from "./pdfUtils.js";
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
const THREAD_RENDER_BATCH = 160;
const CONVERSATION_RENDER_BATCH = 200;
const MATCH_GROUP_RENDER_BATCH = 40;
const MATCH_CANDIDATE_RENDER_BATCH = 80;
const timeFormatter = new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
  hour: "numeric",
  minute: "2-digit",
});
const dateFormatter = new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
  year: "numeric",
  month: "long",
  day: "numeric",
});
const shortDateFormatter = new Intl.DateTimeFormat("ar-SA-u-nu-latn", {
  month: "short",
  day: "numeric",
});

function formatTime(value) {
  if (!parseXmlTimestamp(value)) return "—";
  return timeFormatter.format(new Date(value));
}

function formatDate(value) {
  if (!parseXmlTimestamp(value)) return "غير متوفر";
  return dateFormatter.format(new Date(value));
}

function formatShortDate(value) {
  if (!parseXmlTimestamp(value)) return "—";
  return shortDateFormatter.format(new Date(value));
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

function formatIphoneEvidenceDate(value) {
  const timestamp = parseXmlTimestamp(value);
  if (!timestamp) return "—";
  const date = new Date(timestamp);
  const toArabicDigits = (part) => String(part).replace(/\d/g, (digit) => "٠١٢٣٤٥٦٧٨٩"[Number(digit)]);
  return `${toArabicDigits(date.getFullYear())}/${toArabicDigits(date.getMonth() + 1)}/${toArabicDigits(date.getDate())}`;
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
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

function downloadText(text, fileName, type = "text/csv;charset=utf-8") {
  downloadBlob(new Blob([text], { type }), fileName);
}

function buildUniqueEvidenceNames(items, extension) {
  const usedNames = new Map();
  return items.map((item) => {
    const baseName = buildEvidenceBaseName(item.message, item.term);
    const duplicateNumber = (usedNames.get(baseName) || 0) + 1;
    usedNames.set(baseName, duplicateNumber);
    return `${baseName}${duplicateNumber > 1 ? `-${duplicateNumber}` : ""}.${extension}`;
  });
}

function buildEvidenceArchiveName(items, label) {
  const firstName = items[0] ? buildEvidenceBaseName(items[0].message, items[0].term) : "export";
  return sanitizeEvidenceName(`N9-${label}-${firstName}`) + ".zip";
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
      <span className="status-clock">{displayedTime}</span>
      <span className="device-cutout" aria-hidden="true"><span className="device-cutout-lens" /></span>
      <div className={`phone-status-icons ${deviceStyle === "iphone" ? "is-ios" : "is-android"}`}>
        {deviceStyle === "iphone" ? (
          <>
            <span className="ios-battery-level">54</span>
            <span className="ios-network-type">5G</span>
            <Icon path={mdiSignal} size={0.68} />
          </>
        ) : (
          <>
            <span className="cellular-bars" aria-hidden="true">
              <i /><i /><i /><i />
            </span>
            <svg aria-hidden="true" className="status-wifi" viewBox="0 0 18 14">
              <path d="M1.5 4.7a11.4 11.4 0 0 1 15 0" />
              <path d="M4.3 7.7a7.2 7.2 0 0 1 9.4 0" />
              <path d="M7.1 10.7a2.9 2.9 0 0 1 3.8 0" />
              <circle cx="9" cy="12.4" r=".8" />
            </svg>
            <span className="status-battery" aria-hidden="true"><i /></span>
          </>
        )}
      </div>
    </div>
  );
}

const LinkifiedBody = memo(function LinkifiedBody({ body, deviceStyle = "android" }) {
  const pattern = deviceStyle === "iphone"
    ? /(https?:\/\/\S+|[0-9٠-٩۰-۹]{7,})/g
    : /(https?:\/\/\S+)/g;
  const parts = String(body).split(pattern);
  return parts.map((part, index) => {
    const isUrl = /^https?:\/\//.test(part);
    const isNumber = deviceStyle === "iphone" && /^[0-9٠-٩۰-۹]{7,}$/.test(part);
    return isUrl || isNumber
      ? <span className={`message-link ${isUrl ? "is-url" : "is-number"}`} key={`${part}-${index}`}>{part}</span>
      : <span key={`${part}-${index}`}>{part}</span>;
  });
});

function ConversationPhone({ clockMode, conversation, customTime, deviceStyle, selectedId, onSelect, theme }) {
  const allMessages = conversation?.messages || [];
  const threadRef = useRef(null);
  const [searchOpen, setSearchOpen] = useState(false);
  const [threadQuery, setThreadQuery] = useState("");
  const [messageWindow, setMessageWindow] = useState({ key: "", start: 0, end: THREAD_RENDER_BATCH });
  const deferredThreadQuery = useDeferredValue(threadQuery);
  const visibleMessages = useMemo(
    () => filterConversationMessages(allMessages, deferredThreadQuery, conversation),
    [allMessages, conversation, deferredThreadQuery],
  );
  const selectedInThread = useMemo(
    () => allMessages.find((message) => message.id === selectedId),
    [allMessages, selectedId],
  );
  const phoneTime = selectedInThread?.date || allMessages.at(-1)?.date;
  const windowKey = `${conversation?.address || ""}\u241f${deferredThreadQuery}`;
  const defaultWindow = {
    start: Math.max(0, visibleMessages.length - THREAD_RENDER_BATCH),
    end: visibleMessages.length,
  };
  let renderStart = messageWindow.key === windowKey ? Math.min(messageWindow.start, visibleMessages.length) : defaultWindow.start;
  let renderEnd = messageWindow.key === windowKey ? Math.min(messageWindow.end, visibleMessages.length) : defaultWindow.end;
  if (renderEnd <= renderStart && visibleMessages.length) {
    renderStart = defaultWindow.start;
    renderEnd = defaultWindow.end;
  }
  const selectedVisibleIndex = visibleMessages.findIndex((message) => message.id === selectedId);
  if (messageWindow.key !== windowKey && selectedVisibleIndex >= 0 && (selectedVisibleIndex < renderStart || selectedVisibleIndex >= renderEnd)) {
    renderStart = Math.max(0, Math.min(
      selectedVisibleIndex - Math.floor(THREAD_RENDER_BATCH / 2),
      visibleMessages.length - THREAD_RENDER_BATCH,
    ));
    renderEnd = Math.min(visibleMessages.length, renderStart + THREAD_RENDER_BATCH);
  }
  const renderedMessages = visibleMessages.slice(renderStart, renderEnd);

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
  }, [conversation?.address, deferredThreadQuery, selectedId]);

  function revealOlderMessages() {
    const nextEnd = renderStart;
    setMessageWindow({
      key: windowKey,
      start: Math.max(0, nextEnd - THREAD_RENDER_BATCH),
      end: nextEnd,
    });
  }

  function revealNewerMessages() {
    const nextStart = renderEnd;
    setMessageWindow({
      key: windowKey,
      start: nextStart,
      end: Math.min(visibleMessages.length, nextStart + THREAD_RENDER_BATCH),
    });
  }

  return (
    <div className={`phone-screen conversation-phone device-${deviceStyle} ${theme === "light" ? "phone-light" : ""}`} dir="rtl">
      <StatusBar clockMode={clockMode} customTime={customTime} deviceStyle={deviceStyle} value={phoneTime} />
      <header className="phone-conversation-header">
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
        {renderStart > 0 && (
          <button className="thread-window-control" onClick={revealOlderMessages} type="button">
            عرض دفعة أقدم ({Math.min(THREAD_RENDER_BATCH, renderStart).toLocaleString("ar-SA")} رسالة)
            <small>{renderStart.toLocaleString("ar-SA")} رسالة متاحة قبل هذه الدفعة</small>
          </button>
        )}
        {visibleMessages.length > THREAD_RENDER_BATCH && (
          <div className="thread-window-summary">
            عرض {(renderEnd - renderStart).toLocaleString("ar-SA")} من {visibleMessages.length.toLocaleString("ar-SA")} رسالة للحفاظ على سرعة الهاتف
          </div>
        )}
        {renderedMessages.map((message, index) => {
          const incoming = message.type !== "2";
          const absoluteIndex = renderStart + index;
          const previousMessage = visibleMessages[absoluteIndex - 1];
          const currentDay = parseXmlTimestamp(message.date) ? new Date(message.date).toDateString() : "missing";
          const previousDay = parseXmlTimestamp(previousMessage?.date) ? new Date(previousMessage.date).toDateString() : "missing";
          const timeGap = parseXmlTimestamp(message.date) && parseXmlTimestamp(previousMessage?.date)
            ? Number(message.date) - Number(previousMessage.date)
            : 0;
          const showDate = absoluteIndex === 0
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
        {renderEnd < visibleMessages.length && (
          <button className="thread-window-control" onClick={revealNewerMessages} type="button">
            عرض دفعة أحدث ({Math.min(THREAD_RENDER_BATCH, visibleMessages.length - renderEnd).toLocaleString("ar-SA")} رسالة)
            <small>{(visibleMessages.length - renderEnd).toLocaleString("ar-SA")} رسالة متاحة بعد هذه الدفعة</small>
          </button>
        )}
      </div>
      <div className="composer-row">
        <button aria-label={deviceStyle === "iphone" ? "الكاميرا" : "إضافة"} className="composer-plus" type="button"><Icon path={deviceStyle === "iphone" ? mdiCameraOutline : mdiPlus} size={deviceStyle === "iphone" ? 0.92 : 1.12} /></button>
        <div className="composer-field"><span>{deviceStyle === "iphone" ? "iMessage" : "رسالة نصية"}</span>{deviceStyle === "iphone" && <Icon path={mdiMicrophoneOutline} size={0.78} />}</div>
      </div>
      {deviceStyle === "iphone" && <span className="ios-home-indicator" aria-hidden="true" />}
    </div>
  );
}

function IphoneEvidencePhone({ capture = false, message, theme = "dark" }) {
  const body = message?.body || "اختر رسالة لعرض الدليل";
  const sender = message?.contactName && message.contactName !== "(Unknown)"
    ? message.contactName
    : message?.address || "SMS";
  const incoming = message?.type !== "2";
  const numericSender = /^\+?[\d\s()-]+$/.test(sender);
  const lengthClass = body.length > 700
    ? "is-tiny"
    : body.length > 320
      ? "is-very-long"
      : body.length > 220
        ? "is-extra-long"
        : body.length > 175
          ? "is-long"
          : body.length > 95
            ? "is-medium"
            : "is-short";

  return (
    <div className={`phone-screen iphone-evidence-screen ${capture ? "capture-version" : ""} ${theme === "light" ? "phone-light" : ""}`} dir="ltr">
      <div className="iphone-evidence-rule" aria-hidden="true" />
      <header className="iphone-evidence-header">
        <strong dir="auto">{sender}</strong>
        <time dir="ltr">{formatIphoneEvidenceDate(message?.date)}</time>
      </header>
      <main className="iphone-evidence-message" dir="rtl">
        <div className={`iphone-evidence-bubble ${incoming ? "incoming" : "outgoing"} ${lengthClass}`}>
          <LinkifiedBody body={body} deviceStyle="iphone" />
        </div>
      </main>
      <footer className="iphone-evidence-footer" aria-hidden="true">
        <Icon path={mdiChevronLeft} size={1.35} />
        {numericSender && <span className="iphone-evidence-avatar"><Icon path={mdiAccount} size={1.55} /></span>}
      </footer>
    </div>
  );
}

function EvidencePhone({ clockMode, customTime, deviceStyle = "android", message, capture = false, theme = "dark" }) {
  if (deviceStyle === "iphone") return <IphoneEvidencePhone capture={capture} message={message} theme={theme} />;
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
                  <span className="status-marker"><Icon path={row.missing ? mdiAlertCircleOutline : mdiCheckCircle} size={0.72} /></span>
                  <strong>{row.label}</strong>
                </span>
                <time>{formatDate(row.at)}، {formatTime(row.at)}</time>
              </div>
            ))}
          </div>
        </section>
        <section className="proof-details-list">
          <div><span>النوع</span><strong>رسالة نصية</strong></div>
          <div><span>الأولوية</span><strong>عادية</strong></div>
        </section>
      </div>
      <div className="android-nav" aria-hidden="true">
        <Icon path={mdiSquareOutline} size={0.64} />
        <Icon path={mdiCircleOutline} size={0.64} />
        <Icon className="android-back-icon" path={mdiTriangleOutline} size={0.64} />
      </div>
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
    brandSubtitle: "مساحة أدلة الرسائل",
    eyebrow: "أرشيف رقمي آمن للشركات",
    heroAlt: "N9 SMS — مساحة آمنة لأرشيفات وأدلة الرسائل",
    title: "مساحة آمنة لرفع الرسائل، مطابقتها، وتصديرها.",
    description: "أدر أرشيفات الشركات من مكان واحد، مع الحفاظ على الرسالة الأصلية وبياناتها أثناء البحث والمراجعة والتصدير.",
    start: "الانتقال إلى تسجيل الدخول",
    headerLogin: "تسجيل الدخول",
    unlockTitle: "جاري فتح البوابة الآمنة",
    unlockDescription: "يتم الآن التحقق من مسار الدخول",
    closeLogin: "إغلاق تسجيل الدخول",
    backToHome: "العودة إلى الواجهة الرئيسية",
    flowLabel: "طريقة العمل",
    importStep: "ارفع الأرشيف",
    importStepText: "استورد XML داخل مساحة الشركة الصحيحة.",
    matchStep: "طابق واختر",
    matchStepText: "ابحث برقم واحد أو قائمة Excel واعتمد الرسالة المناسبة.",
    exportStep: "راجع وصدّر",
    exportStepText: "اختر شكل الهاتف ونزّل PNG أو PDF أو ZIP.",
    formats: "XML  ·  Excel / CSV  ·  PNG / PDF / ZIP",
    loginEyebrow: "بوابة المستخدمين",
    loginTitle: "الدخول إلى مساحة العمل",
    loginDescription: "استخدم بيانات حسابك للوصول إلى الشركات المفوضة لك فقط.",
    username: "اسم المستخدم",
    password: "كلمة المرور الرقمية",
    login: "تسجيل الدخول",
    checking: "جاري التحقق…",
    secure: "دخول محمي وصلاحيات منفصلة لكل شركة.",
    showPassword: "إظهار كلمة المرور",
    hidePassword: "إخفاء كلمة المرور",
    preview: "معاينة محلية — المشاركة بين الأجهزة تعمل في النسخة المنشورة.",
  },
  en: {
    dir: "ltr",
    brandSubtitle: "SMS evidence workspace",
    eyebrow: "Secure digital archive for companies",
    heroAlt: "N9 SMS — secure SMS archive and evidence workspace",
    title: "Upload, match, and export in one secure workspace.",
    description: "Manage company archives in one place while preserving every original message and its data through search, review, and export.",
    start: "Go to sign in",
    headerLogin: "Sign in",
    unlockTitle: "Opening the secure gateway",
    unlockDescription: "Preparing your protected sign-in path",
    closeLogin: "Close sign in",
    backToHome: "Back to the main screen",
    flowLabel: "How it works",
    importStep: "Upload the archive",
    importStepText: "Import XML into the correct company workspace.",
    matchStep: "Match and select",
    matchStepText: "Search one identifier or an Excel list and approve the right message.",
    exportStep: "Review and export",
    exportStepText: "Choose a phone style and download PNG, PDF, or ZIP.",
    formats: "XML  ·  Excel / CSV  ·  PNG / PDF / ZIP",
    loginEyebrow: "User portal",
    loginTitle: "Sign in to your workspace",
    loginDescription: "Use your account to access only the companies assigned to you.",
    username: "Username",
    password: "Numeric password",
    login: "Sign in",
    checking: "Checking…",
    secure: "Protected access with separate permissions for every company.",
    showPassword: "Show password",
    hidePassword: "Hide password",
    preview: "Local preview — cross-device access works on the published site.",
  },
};

function LoginScreen({ busy, error, onLogin }) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [language, setLanguage] = useState(() => localStorage.getItem("n9-welcome-language") || "ar");
  const [welcomeTheme, setWelcomeTheme] = useState(() => localStorage.getItem("n9-welcome-theme-v3") || "light");
  const [entryPhase, setEntryPhase] = useState("closed");
  const usernameRef = useRef(null);
  const unlockTimerRef = useRef(null);
  const copy = welcomeCopy[language];

  useEffect(() => {
    localStorage.setItem("n9-welcome-language", language);
    localStorage.setItem("n9-welcome-theme-v3", welcomeTheme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", welcomeTheme === "dark" ? "#03142c" : "#fbf8f1");
    document.documentElement.lang = language;
    document.documentElement.dir = copy.dir;
    return () => {
      document.documentElement.lang = "ar";
      document.documentElement.dir = "rtl";
    };
  }, [copy.dir, language, welcomeTheme]);

  useEffect(() => {
    if (entryPhase !== "open") return undefined;
    const focusTimer = window.setTimeout(() => usernameRef.current?.focus(), 620);
    return () => window.clearTimeout(focusTimer);
  }, [entryPhase]);

  useEffect(() => {
    function closeOnEscape(event) {
      if (event.key === "Escape" && entryPhase === "open") setEntryPhase("closed");
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [entryPhase]);

  useEffect(() => () => {
    if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
  }, []);

  function openLogin() {
    if (entryPhase === "open") {
      usernameRef.current?.focus();
      return;
    }
    if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
    setEntryPhase("unlocking");
    unlockTimerRef.current = window.setTimeout(() => setEntryPhase("open"), 900);
  }

  function closeLogin() {
    if (unlockTimerRef.current) window.clearTimeout(unlockTimerRef.current);
    setShowPassword(false);
    setEntryPhase("closed");
  }

  function submit(event) {
    event.preventDefault();
    onLogin(username, password);
  }

  return (
    <main className={`welcome-screen welcome-${welcomeTheme}`} dir={copy.dir}>
      <header className="welcome-header">
        <div className="welcome-logo">
          <img alt="N9" className="welcome-logo-image" src={welcomeTheme === "dark" ? "/n9-logo-night-512.png" : "/n9-logo-pearl-512.png"} />
          <span className="welcome-logo-copy"><strong>N9 SMS</strong><small>{copy.brandSubtitle}</small></span>
        </div>
        <div className="welcome-controls">
          <div className="language-switch" aria-label="Language">
            <button className={language === "ar" ? "is-active" : ""} onClick={() => setLanguage("ar")} type="button">العربية</button>
            <button className={language === "en" ? "is-active" : ""} onClick={() => setLanguage("en")} type="button">English</button>
          </div>
          <button aria-label={welcomeTheme === "dark" ? "Light theme" : "Dark theme"} className="welcome-theme-toggle" onClick={() => setWelcomeTheme((current) => current === "dark" ? "light" : "dark")} type="button"><Icon path={welcomeTheme === "dark" ? mdiWhiteBalanceSunny : mdiWeatherNight} size={0.82} /></button>
          <button aria-expanded={entryPhase === "open"} className="welcome-header-login" onClick={openLogin} type="button"><Icon path={mdiLockOutline} size={0.76} /><span>{copy.headerLogin}</span></button>
        </div>
      </header>
      <section className="welcome-hero-stage" aria-label={copy.eyebrow}>
        <div className="welcome-hero-frame">
          <img alt={copy.heroAlt} className={`welcome-hero-image welcome-hero-dark-image ${welcomeTheme === "dark" ? "is-visible" : ""}`} src="/og.png" />
          <img alt="" aria-hidden="true" className={`welcome-hero-image welcome-hero-light-image ${welcomeTheme === "light" ? "is-visible" : ""}`} src="/n9-hero-light.png" />
          <div className="welcome-hero-entry">
            <button aria-expanded={entryPhase === "open"} className="welcome-primary-action" onClick={openLogin} type="button"><Icon path={mdiLockOutline} size={0.8} /><span>{copy.start}</span><Icon path={mdiChevronRight} size={0.82} /></button>
          </div>
        </div>
      </section>

      <div className="welcome-mobile-dock">
        <button className="welcome-mobile-login" onClick={openLogin} type="button"><Icon path={mdiLockOutline} size={0.8} />{copy.start}</button>
      </div>

      {entryPhase === "unlocking" && (
        <div aria-live="polite" className="welcome-unlock-layer" role="status">
          <span className="welcome-unlock-mark"><Icon className="unlock-closed" path={mdiLockOutline} size={1.65} /><Icon className="unlock-open" path={mdiLockOpenVariantOutline} size={1.65} /></span>
          <strong>{copy.unlockTitle}</strong>
          <small>{copy.unlockDescription}</small>
        </div>
      )}

      <div className={`welcome-login-layer ${entryPhase === "open" ? "is-open" : ""}`} onMouseDown={(event) => event.target === event.currentTarget && closeLogin()} role="presentation">
        <section aria-labelledby="welcome-login-title" aria-modal="true" className="login-card welcome-login-panel" role="dialog">
          <button aria-label={copy.closeLogin} className="welcome-login-close" onClick={closeLogin} type="button"><Icon path={mdiClose} size={0.9} /></button>
          <div className="welcome-login-brand"><img alt="N9" src={welcomeTheme === "dark" ? "/n9-logo-night-512.png" : "/n9-logo-pearl-512.png"} /><span><strong>N9 SMS</strong><small>{copy.brandSubtitle}</small></span></div>
          <button className="welcome-login-back" onClick={closeLogin} type="button"><Icon path={copy.dir === "rtl" ? mdiChevronRight : mdiChevronLeft} size={0.78} />{copy.backToHome}</button>
          <div className="login-card-top"><span className="login-card-icon"><Icon path={mdiDatabaseLockOutline} size={1.05} /></span><span className="eyebrow">{copy.loginEyebrow}</span></div>
          <div className="login-card-heading"><h2 id="welcome-login-title">{copy.loginTitle}</h2><p>{copy.loginDescription}</p></div>
          <form autoComplete="off" onSubmit={submit}>
            <label>
              <span>{copy.username}</span>
              <div className="credential-field"><Icon path={mdiAccount} size={0.82} /><input autoComplete="off" maxLength={30} name="n9-login-user" onChange={(event) => setUsername(event.target.value)} ref={usernameRef} required value={username} /></div>
            </label>
            <label>
              <span>{copy.password}</span>
              <div className="pin-field"><Icon path={mdiLockOutline} size={0.82} /><input autoComplete="current-password" inputMode="numeric" maxLength={12} minLength={4} onChange={(event) => setPassword(event.target.value.replace(/\D/g, ""))} pattern="[0-9]{4,12}" placeholder="••••" required type={showPassword ? "text" : "password"} value={password} /><button aria-label={showPassword ? copy.hidePassword : copy.showPassword} onClick={() => setShowPassword((current) => !current)} type="button"><Icon path={showPassword ? mdiEyeOffOutline : mdiEyeOutline} size={0.78} /></button></div>
            </label>
            {error && <div className="login-error" role="alert"><Icon path={mdiAlertCircleOutline} size={0.8} />{error}</div>}
            <button disabled={busy} type="submit">{busy ? <><span className="spinner" /> {copy.checking}</> : copy.login}</button>
          </form>
          <div className="login-security"><Icon path={mdiShieldAccountOutline} size={0.82} /><span>{copy.secure}</span></div>
          {isLocalPreview && <small className="preview-note">{copy.preview}</small>}
        </section>
      </div>
      <footer className="welcome-footer"><span>© N9 SMS</span><span>nasseh zaher alnaman by N9 TOOLS</span></footer>
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

const comparableMessageCache = new WeakMap();

function getComparableMessageText(message) {
  if (!message || typeof message !== "object") return "";
  const cached = comparableMessageCache.get(message);
  if (cached !== undefined) return cached;
  const normalized = normalizeComparable(`${message.contactName || ""} ${message.address || ""} ${message.body || ""}`);
  comparableMessageCache.set(message, normalized);
  return normalized;
}

function indexMatchesByTerm(terms, matches) {
  const index = new Map(terms.map((term) => [term, []]));
  for (const match of matches) {
    for (const term of match.terms) index.get(term)?.push(match);
  }
  return index;
}

function sortSmartCandidates(candidates, term) {
  return [...candidates].sort((a, b) => (
    (b.scoreByTerm?.[term] || 0) - (a.scoreByTerm?.[term] || 0)
    || Number(b.message.date) - Number(a.message.date)
  ));
}

function buildRecommendedSelections(terms, matches) {
  const indexed = indexMatchesByTerm(terms, matches);
  return Object.fromEntries(terms.flatMap((term) => {
    const recommendation = sortSmartCandidates(indexed.get(term) || [], term)[0];
    return recommendation ? [[term, recommendation.message.id]] : [];
  }));
}

function ConversationExportProgress({ collapsed, onToggle, progress }) {
  const percent = Math.max(0, Math.min(100, Number(progress?.percent) || 0));
  return (
    <div aria-live="polite" className={`conversation-export-dock ${collapsed ? "is-collapsed" : ""}`} role="status">
      <section aria-labelledby="conversation-export-title" className="conversation-export-progress">
        <header className="export-progress-header">
          <div className="export-progress-icon"><Icon path={mdiFolderOutline} size={1.05} /></div>
          <div className="export-progress-heading">
            <span className="eyebrow">تصدير في الخلفية</span>
            <h2 id="conversation-export-title">{progress.title}</h2>
          </div>
          <strong className="export-progress-percent">{percent.toLocaleString("ar-SA")}٪</strong>
          <button aria-label={collapsed ? "عرض تفاصيل التصدير" : "تصغير إشعار التصدير"} className="export-progress-toggle" onClick={onToggle} type="button">
            <Icon path={mdiChevronDown} size={0.82} />
          </button>
        </header>
        <div className="export-progress-body">
          <p className="export-progress-stage">{progress.stage}</p>
          <div aria-label="نسبة إنجاز تصدير المحادثة" aria-valuemax="100" aria-valuemin="0" aria-valuenow={percent} className="export-progress-track" role="progressbar">
            <span style={{ width: `${percent}%` }} />
          </div>
          <div className="export-progress-meta">
            <span>{progress.completed.toLocaleString("ar-SA")} من {progress.total.toLocaleString("ar-SA")} رسالة</span>
            <span>PDF + Excel + ZIP</span>
          </div>
          <small>يمكنك متابعة استخدام الموقع؛ سيستمر التصدير في الخلفية ويبدأ التنزيل عند اكتماله.</small>
        </div>
      </section>
    </div>
  );
}

export function App() {
  const [messages, setMessages] = useState([]);
  const [sourceName, setSourceName] = useState("لا يوجد ملف بعد");
  const [selectedAddress, setSelectedAddress] = useState("");
  const [selectedMessageId, setSelectedMessageId] = useState("");
  const [query, setQuery] = useState("");
  const [searchLimit, setSearchLimit] = useState(100);
  const [conversationLimit, setConversationLimit] = useState(CONVERSATION_RENDER_BATCH);
  const [activeNav, setActiveNav] = useState("messages");
  const [previewMode, setPreviewMode] = useState("details");
  const [matchInput, setMatchInput] = useState(sampleMatchTerms.join("\n"));
  const [matchTerms, setMatchTerms] = useState(sampleMatchTerms);
  const [matches, setMatches] = useState([]);
  const [selectedByTerm, setSelectedByTerm] = useState({});
  const [selectionMode, setSelectionMode] = useState("manual");
  const [candidateQuery, setCandidateQuery] = useState("");
  const [candidateSort, setCandidateSort] = useState("smart");
  const [candidateDirection, setCandidateDirection] = useState("all");
  const [matchGroupLimit, setMatchGroupLimit] = useState(MATCH_GROUP_RENDER_BATCH);
  const [candidateLimits, setCandidateLimits] = useState({});
  const [batchSelection, setBatchSelection] = useState({});
  const [exportBusy, setExportBusy] = useState(false);
  const [conversationExportProgress, setConversationExportProgress] = useState(null);
  const [conversationExportCollapsed, setConversationExportCollapsed] = useState(false);
  const [theme, setTheme] = useState(() => localStorage.getItem("n9-app-theme-v2") || "light");
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
  const [exportCaptureSettings, setExportCaptureSettings] = useState(null);
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
  const canCreateManualMessages = currentUser?.role === "admin";
  const deferredQuery = useDeferredValue(query);
  const deferredCandidateQuery = useDeferredValue(candidateQuery);
  const conversations = useMemo(() => groupMessages(messages), [messages]);
  const searchResults = useMemo(() => {
    const normalized = normalizeComparable(deferredQuery);
    if (!normalized) return [];
    return messages
      .filter((message) => getComparableMessageText(message).includes(normalized))
      .sort((a, b) => Number(b.date) - Number(a.date))
      ;
  }, [deferredQuery, messages]);

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

  const matchesByTerm = useMemo(() => indexMatchesByTerm(matchTerms, matches), [matchTerms, matches]);
  const matchGroups = useMemo(() => matchTerms.map((term) => {
    const smartCandidates = sortSmartCandidates(matchesByTerm.get(term) || [], term);
    const candidates = [...smartCandidates].sort((a, b) => {
      if (candidateSort === "newest") return Number(b.message.date) - Number(a.message.date);
      if (candidateSort === "oldest") return Number(a.message.date) - Number(b.message.date);
      return (b.scoreByTerm?.[term] || 0) - (a.scoreByTerm?.[term] || 0) || Number(b.message.date) - Number(a.message.date);
    });
    const visibleCandidates = filterMatchCandidates(candidates, deferredCandidateQuery, candidateDirection);
    return {
      term,
      candidates,
      visibleCandidates,
      recommendedId: smartCandidates[0]?.message.id,
    };
  }), [candidateDirection, candidateSort, deferredCandidateQuery, matchTerms, matchesByTerm]);

  const selectedEvidenceMatches = useMemo(() => matchGroups.flatMap((group) => {
    const selectedId = selectedByTerm[group.term] || (selectionMode === "auto" ? group.recommendedId : "");
    const selected = group.candidates.find((candidate) => candidate.message.id === selectedId);
    return selected ? [{ term: group.term, message: selected.message, score: selected.scoreByTerm?.[group.term] || 0 }] : [];
  }), [matchGroups, selectedByTerm, selectionMode]);

  const messagesById = useMemo(
    () => new Map(messages.map((message) => [message.id, message])),
    [messages],
  );
  const selectedBatchItems = useMemo(() => Object.entries(batchSelection).flatMap(([messageId, term]) => {
    const message = messagesById.get(messageId);
    return message ? [{ term, message }] : [];
  }), [batchSelection, messagesById]);
  const batchExportItems = useMemo(() => {
    const source = selectedBatchItems.length ? selectedBatchItems : selectedEvidenceMatches;
    const seen = new Set();
    return source.filter(({ message }) => {
      if (seen.has(message.id)) return false;
      seen.add(message.id);
      return true;
    });
  }, [selectedBatchItems, selectedEvidenceMatches]);
  function applyArchive(archive) {
    const restoredMessages = Array.isArray(archive?.messages) ? archive.messages.map(normalizeMessageIdentity) : [];
    const grouped = groupMessages(restoredMessages);
    const restoredMatches = buildMatches(restoredMessages, sampleMatchTerms);
    const restoredSelection = selectionMode === "auto" ? buildRecommendedSelections(sampleMatchTerms, restoredMatches) : {};
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
    localStorage.setItem("n9-app-theme-v2", theme);
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", theme === "dark" ? "#03142c" : "#fbf8f1");
  }, [clockMode, customTime, deviceStyle, theme]);

  useEffect(() => {
    setConversationLimit(CONVERSATION_RENDER_BATCH);
  }, [activeWorkspaceId, messages]);

  useEffect(() => {
    setMatchGroupLimit(MATCH_GROUP_RENDER_BATCH);
    setCandidateLimits({});
  }, [candidateSort, deferredCandidateQuery, matches]);

  useEffect(() => {
    setBatchSelection({});
  }, [matches]);

  function chooseMessage(message) {
    setSelectedAddress(message.address);
    setSelectedMessageId(message.id);
    setPreviewMode("details");
  }

  function recommendSelections(terms, nextMatches) {
    const nextSelection = buildRecommendedSelections(terms, nextMatches);
    setSelectedByTerm(nextSelection);
    return nextSelection;
  }

  function runMatch(terms = extractTerms(matchInput)) {
    setMatchTerms(terms);
    const nextMatches = buildMatches(messages, terms);
    setMatches(nextMatches);
    const selections = selectionMode === "auto" ? recommendSelections(terms, nextMatches) : {};
    if (selectionMode === "manual") setSelectedByTerm({});
    const firstSelectedId = Object.values(selections)[0];
    const firstSelected = nextMatches.find((match) => match.message.id === firstSelectedId) || nextMatches[0];
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
    if (!canCreateManualMessages) {
      setToast("منشئ الرسالة متاح للمشرف فقط.");
      return false;
    }
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

  async function captureMessageImage(message, appearance = null) {
    const captureSettings = appearance || { clockMode, customTime, deviceStyle, theme };
    setExportingMatch(message);
    setExportCaptureSettings(captureSettings);
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
    if (!captureRef.current) throw new Error("capture-unavailable");
    await document.fonts.ready;
    return toPng(captureRef.current, {
      pixelRatio: 2,
      cacheBust: true,
      backgroundColor: captureSettings.theme === "light" ? "#f7f9fc" : "#171a1d",
    });
  }

  async function exportCurrentImage() {
    if (!selectedMessage || exportBusy) return;
    setExportBusy(true);
    try {
      const dataUrl = await captureMessageImage(selectedMessage);
      downloadDataUrl(dataUrl, `${buildEvidenceBaseName(selectedMessage)}.png`);
      setToast("تم تصدير صورة الدليل بدقة عالية وباسم مستخرج من الرسالة");
    } catch {
      setToast("تعذر تصدير الصورة. أعد المحاولة بعد اكتمال تحميل الخط.");
    } finally {
      setExportingMatch(null);
      setExportCaptureSettings(null);
      setExportBusy(false);
    }
  }

  async function exportCurrentPdf() {
    if (!selectedMessage || exportBusy) return;
    setExportBusy(true);
    setToast("جاري إنشاء PDF من صورة الرسالة");
    try {
      const dataUrl = await captureMessageImage(selectedMessage);
      const jpeg = await imageDataUrlToJpeg(dataUrl, theme === "light" ? "#f7f9fc" : "#171a1d");
      downloadBlob(createJpegPdf([jpeg]), `${buildEvidenceBaseName(selectedMessage)}.pdf`);
      setToast("تم تصدير الرسالة كملف PDF مستقل");
    } catch {
      setToast("تعذر إنشاء PDF لهذه الرسالة. أعد المحاولة.");
    } finally {
      setExportingMatch(null);
      setExportCaptureSettings(null);
      setExportBusy(false);
    }
  }

  async function exportAllImages() {
    if (!batchExportItems.length || exportBusy) return;
    const exportAppearance = { clockMode, customTime, deviceStyle, theme };
    const zip = new JSZip();
    const fileNames = buildUniqueEvidenceNames(batchExportItems, "png");
    setExportBusy(true);
    setToast(`جاري تجهيز ${batchExportItems.length.toLocaleString("ar-SA")} صورة محددة`);
    try {
      for (let index = 0; index < batchExportItems.length; index += 1) {
        const dataUrl = await captureMessageImage(batchExportItems[index].message, exportAppearance);
        if (batchExportItems.length === 1) {
          downloadDataUrl(dataUrl, fileNames[index]);
        } else {
          zip.file(fileNames[index], dataUrl.split(",")[1], { base64: true });
        }
        setToast(`تم تجهيز ${(index + 1).toLocaleString("ar-SA")} من ${batchExportItems.length.toLocaleString("ar-SA")} صورة`);
      }
      if (batchExportItems.length > 1) {
        const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
        downloadBlob(archive, buildEvidenceArchiveName(batchExportItems, "images"));
      }
      setToast(batchExportItems.length > 1 ? "اكتمل تنزيل الصور داخل ملف ZIP واحد" : "تم تنزيل صورة الرسالة");
    } catch {
      setToast("تعذر إكمال ملف الصور. جرّب تحديد عدد أقل ثم أعد المحاولة.");
    } finally {
      setExportingMatch(null);
      setExportCaptureSettings(null);
      setExportBusy(false);
    }
  }

  async function exportAllPdfs() {
    if (!batchExportItems.length || exportBusy) return;
    const exportAppearance = { clockMode, customTime, deviceStyle, theme };
    const zip = new JSZip();
    const fileNames = buildUniqueEvidenceNames(batchExportItems, "pdf");
    setExportBusy(true);
    setToast(`جاري إنشاء ${batchExportItems.length.toLocaleString("ar-SA")} ملف PDF`);
    try {
      for (let index = 0; index < batchExportItems.length; index += 1) {
        const dataUrl = await captureMessageImage(batchExportItems[index].message, exportAppearance);
        const jpeg = await imageDataUrlToJpeg(dataUrl, exportAppearance.theme === "light" ? "#f7f9fc" : "#171a1d");
        const pdf = createJpegPdf([jpeg]);
        if (batchExportItems.length === 1) {
          downloadBlob(pdf, fileNames[index]);
        } else {
          zip.file(fileNames[index], await pdf.arrayBuffer());
        }
        setToast(`تم إنشاء ${(index + 1).toLocaleString("ar-SA")} من ${batchExportItems.length.toLocaleString("ar-SA")} PDF`);
      }
      if (batchExportItems.length > 1) {
        const archive = await zip.generateAsync({ type: "blob", compression: "DEFLATE", compressionOptions: { level: 6 } });
        downloadBlob(archive, buildEvidenceArchiveName(batchExportItems, "PDF"));
      }
      setToast(batchExportItems.length > 1 ? "اكتمل تنزيل ملفات PDF داخل ZIP واحد" : "تم تنزيل PDF للرسالة");
    } catch {
      setToast("تعذر إكمال ملفات PDF. جرّب تحديد عدد أقل ثم أعد المحاولة.");
    } finally {
      setExportingMatch(null);
      setExportCaptureSettings(null);
      setExportBusy(false);
    }
  }

  async function exportConversationPackage() {
    const conversationMessages = selectedConversation?.messages || [];
    if (!conversationMessages.length || exportBusy) return;

    const conversationTitle = selectedConversation.contactName || selectedConversation.address || "المحادثة";
    const safeConversationTitle = sanitizeEvidenceName(conversationTitle) || "conversation";
    const items = conversationMessages.map((message) => ({ message, term: "" }));
    const nameWidth = Math.max(3, String(conversationMessages.length).length);
    const pdfFileNames = buildUniqueEvidenceNames(items, "pdf").map((fileName, index) => (
      `${String(index + 1).padStart(nameWidth, "0")}-${fileName}`
    ));
    const zipWriter = new StoredZipBuilder();
    const addArchiveEntry = (path, data) => zipWriter.addFile(path, data);
    const exportAppearance = { clockMode, customTime, deviceStyle, theme };

    setExportBusy(true);
    setConversationExportCollapsed(false);
    setConversationExportProgress({
      percent: 0,
      completed: 0,
      total: conversationMessages.length,
      stage: "جاري تجهيز قائمة الرسائل وأسماء الملفات…",
      title: conversationTitle,
    });

    try {
      for (let index = 0; index < conversationMessages.length; index += 1) {
        setConversationExportProgress({
          percent: Math.round((index / conversationMessages.length) * 86),
          completed: index,
          total: conversationMessages.length,
          stage: `إنشاء PDF للرسالة ${(index + 1).toLocaleString("ar-SA")}…`,
          title: conversationTitle,
        });
        const dataUrl = await captureMessageImage(conversationMessages[index], exportAppearance);
        const jpeg = await imageDataUrlToJpeg(dataUrl, exportAppearance.theme === "light" ? "#f7f9fc" : "#171a1d", 0.9);
        const pdf = createJpegPdf([jpeg]);
        addArchiveEntry(`PDF/${pdfFileNames[index]}`, new Uint8Array(await pdf.arrayBuffer()));
        setConversationExportProgress({
          percent: Math.round(((index + 1) / conversationMessages.length) * 86),
          completed: index + 1,
          total: conversationMessages.length,
          stage: `تم تجهيز ${(index + 1).toLocaleString("ar-SA")} من ${conversationMessages.length.toLocaleString("ar-SA")} ملف PDF`,
          title: conversationTitle,
        });
      }

      setConversationExportProgress({
        percent: 89,
        completed: conversationMessages.length,
        total: conversationMessages.length,
        stage: "جاري إنشاء ملف Excel المرجعي للمحادثة…",
        title: conversationTitle,
      });
      const XLSX = await import("xlsx");
      const referenceRows = buildConversationReferenceRows(conversationMessages, {
        conversationName: conversationTitle,
        pdfFileNames,
      });
      const worksheet = XLSX.utils.json_to_sheet(referenceRows);
      worksheet["!cols"] = [
        { wch: 10 }, { wch: 24 }, { wch: 20 }, { wch: 22 }, { wch: 14 },
        { wch: 25 }, { wch: 25 }, { wch: 25 }, { wch: 76 }, { wch: 52 },
        { wch: 42 }, { wch: 18 }, { wch: 30 },
      ];
      if (worksheet["!ref"]) worksheet["!autofilter"] = { ref: worksheet["!ref"] };
      const workbook = XLSX.utils.book_new();
      workbook.Props = {
        Title: `N9 SMS - ${conversationTitle}`,
        Subject: "مرجع كامل للمحادثة وملفات PDF المصدرة",
        Author: "N9 TOOLS",
      };
      workbook.Workbook = { Views: [{ RTL: true }] };
      XLSX.utils.book_append_sheet(workbook, worksheet, "مرجع المحادثة");
      const workbookData = XLSX.write(workbook, { bookType: "xlsx", compression: true, type: "array" });
      const excelFileName = sanitizeEvidenceName(`N9-SMS-${conversationTitle}-مرجع-المحادثة`) + ".xlsx";
      addArchiveEntry(excelFileName, new Uint8Array(workbookData));

      setConversationExportProgress({
        percent: 96,
        completed: conversationMessages.length,
        total: conversationMessages.length,
        stage: "جاري إغلاق ملف ZIP وتجميع الفهرس النهائي…",
        title: conversationTitle,
      });
      await new Promise((resolve) => window.requestAnimationFrame(() => resolve()));
      const archive = zipWriter.toBlob();
      setConversationExportProgress({
        percent: 100,
        completed: conversationMessages.length,
        total: conversationMessages.length,
        stage: "اكتمل التصدير، يبدأ التنزيل الآن.",
        title: conversationTitle,
      });
      downloadBlob(archive, `N9-SMS-${safeConversationTitle}-المحادثة-الكاملة.zip`);
      await new Promise((resolve) => window.setTimeout(resolve, 450));
      setToast(`تم تصدير محادثة ${conversationTitle}: ${conversationMessages.length.toLocaleString("ar-SA")} PDF وملف Excel داخل ZIP واحد`);
    } catch (error) {
      setToast(error?.message || "تعذر إكمال تصدير المحادثة. أعد المحاولة بعد التأكد من وجود مساحة كافية.");
    } finally {
      setConversationExportProgress(null);
      setExportingMatch(null);
      setExportCaptureSettings(null);
      setExportBusy(false);
    }
  }

  function exportCsv() {
    if (!batchExportItems.length || exportBusy) return;
    const rows = [
      ["evidence_file", "match", "sender", "contact", "received_or_sent_date", "date_sent", "delivery_date", "message"],
      ...batchExportItems.map(({ message, term }) => [buildEvidenceBaseName(message, term), term, message.address, message.contactName, toIsoTimestamp(message.date), toIsoTimestamp(message.dateSent), toIsoTimestamp(message.deliveryDate), message.body]),
    ];
    downloadText(`\uFEFF${rows.map((row) => row.map(quoteCsvCell).join(",")).join("\r\n")}`, `N9-SMS-${buildEvidenceBaseName(batchExportItems[0].message, batchExportItems[0].term)}.csv`);
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
    setSelectedByTerm((current) => (selectionMode === "auto" ? { [term]: message.id } : { ...current, [term]: message.id }));
    chooseMessage(message);
  }

  function toggleBatchCandidate(term, message) {
    setSelectionMode("manual");
    setSelectedByTerm((current) => (selectionMode === "auto" ? { [term]: message.id } : { ...current, [term]: message.id }));
    setBatchSelection((current) => {
      const next = { ...current };
      if (next[message.id]) delete next[message.id];
      else next[message.id] = term;
      return next;
    });
    chooseMessage(message);
  }

  function selectAllVisibleCandidates() {
    const nextSelection = {};
    for (const group of matchGroups) {
      for (const { message } of group.visibleCandidates) {
        if (!nextSelection[message.id]) nextSelection[message.id] = group.term;
      }
    }
    setBatchSelection(nextSelection);
    setSelectionMode("manual");
    setSelectedByTerm({});
    setToast(`تم تحديد ${Object.keys(nextSelection).length.toLocaleString("ar-SA")} رسالة ظاهرة للتصدير`);
  }

  function clearBatchSelection() {
    setBatchSelection({});
    setToast(selectionMode === "auto" ? "تم مسح التحديد المتعدد؛ سيُستخدم الاقتراح التلقائي لكل رقم" : "تم مسح التحديد المتعدد؛ اختر الرسالة التي تريد اعتمادها يدويًا");
  }

  function switchToManual() {
    setSelectionMode("manual");
    setSelectedByTerm({});
    setBatchSelection({});
    setToast("الاختيار اليدوي مفعّل — لن يُعتمد أي دليل حتى تختاره بنفسك");
  }

  function switchToAutomatic() {
    setSelectionMode("auto");
    setBatchSelection({});
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
        <div className="brand-mark" aria-label="N9 SMS"><img alt="" src={theme === "dark" ? "/n9-logo-night-512.png" : "/n9-logo-pearl-512.png"} /></div>
        <nav>
          <NavButton active={activeNav === "messages"} icon={mdiMessageTextOutline} label="الرسائل" onClick={() => setActiveNav("messages")} />
          {canCreateManualMessages && <NavButton active={composerOpen} icon={mdiMessagePlusOutline} label="منشئ الرسالة" onClick={() => { setActiveNav("composer"); setComposerOpen(true); }} />}
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
            {canCreateManualMessages && <button aria-label="إنشاء رسالة" className="icon-button" onClick={() => { setActiveNav("composer"); setComposerOpen(true); }} title="منشئ الرسالة" type="button"><Icon path={mdiMessagePlusOutline} size={1.02} /></button>}
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
              <div className="conversation-count search-count"><span>نتائج البحث</span><span>{query !== deferredQuery ? "جاري البحث…" : `عرض ${Math.min(searchLimit, searchResults.length).toLocaleString("ar-SA")} من ${searchResults.length.toLocaleString("ar-SA")}`}</span></div>
              {searchResults.length ? searchResults.slice(0, searchLimit).map((message) => (
                <button className={`search-result-item ${selectedMessage?.id === message.id ? "is-selected" : ""}`} key={message.id} onClick={() => { chooseMessage(message); setConversationPanelOpen(false); }} type="button">
                  <span className="search-result-top"><strong>{message.contactName === "(Unknown)" ? message.address : message.contactName}</strong><small>{formatShortDate(message.date)} · {formatTime(message.date)}</small></span>
                  <span className="search-result-snippet">{message.body}</span>
                </button>
              )) : <div className="search-empty">لا توجد رسائل مطابقة، وما زالت جميع المحادثات ظاهرة أدناه.</div>}
              {searchResults.length > searchLimit && (
                <div className="search-more-actions">
                  <button onClick={() => setSearchLimit((current) => Math.min(current + 100, searchResults.length))} type="button">عرض 100 رسالة أخرى</button>
                </div>
              )}
              <div className="all-conversations-divider"><span>كل المحادثات</span><span>{conversations.length.toLocaleString("ar-SA")}</span></div>
            </section>
          )}
          {!query && <div className="conversation-count embedded-count"><span>المحادثات</span><span>عرض {Math.min(conversationLimit, conversations.length).toLocaleString("ar-SA")} من {conversations.length.toLocaleString("ar-SA")}</span></div>}
          {!conversations.length && !restoringArchive && (
            <div className="company-empty-state">
              <span><Icon path={mdiOfficeBuildingOutline} size={1.25} /></span>
              <strong>لا توجد رسائل في {activeWorkspace?.name}</strong>
              <small>{canCreateManualMessages ? "ارفع XML أو أنشئ أول رسالة، وسيبقى أرشيف هذه الشركة منفصلًا ومحفوظًا." : "ارفع XML لبدء أرشيف هذه الشركة، وسيبقى منفصلًا ومحفوظًا."}</small>
              <div className="empty-state-actions"><button onClick={() => setImportOpen(true)} type="button"><Icon path={mdiTrayArrowUp} size={0.75} /> رفع XML</button>{canCreateManualMessages && <button onClick={() => { setActiveNav("composer"); setComposerOpen(true); }} type="button"><Icon path={mdiMessagePlusOutline} size={0.75} /> إنشاء رسالة</button>}</div>
            </div>
          )}
          {conversations.slice(0, conversationLimit).map((conversation) => (
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
          {conversations.length > conversationLimit && (
            <button className="list-window-control" onClick={() => setConversationLimit((current) => Math.min(current + CONVERSATION_RENDER_BATCH, conversations.length))} type="button">
              عرض {Math.min(CONVERSATION_RENDER_BATCH, conversations.length - conversationLimit).toLocaleString("ar-SA")} محادثة أخرى
              <small>جميع المحادثات محفوظة، ويتم عرضها على دفعات لتجنب التعليق.</small>
            </button>
          )}
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
            <button className="toolbar-button compact-action conversation-export-action" disabled={!selectedConversation?.messages.length || exportBusy} onClick={exportConversationPackage} title="تصدير كل رسائل المحادثة كملفات PDF مع مرجع Excel داخل ZIP" type="button"><Icon path={mdiFolderOutline} size={0.82} /><span>المحادثة</span></button>
            <button className="toolbar-button compact-action" disabled={!selectedMessage || exportBusy} onClick={exportCurrentPdf} title="تصدير الرسالة كملف PDF" type="button"><Icon path={mdiFileDocumentOutline} size={0.82} /><span>PDF</span></button>
            <button className="toolbar-button primary" disabled={!selectedMessage || exportBusy} onClick={exportCurrentImage} type="button"><Icon path={mdiCellphoneScreenshot} size={0.82} /> تصدير الصورة</button>
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
                  : `كل رسائل محادثة ${activeWorkspace?.name} متاحة (${selectedConversation?.messages.length?.toLocaleString("ar-SA") || 0})، ويعرضها الهاتف على دفعات سريعة.`
                : `دليل من ${activeWorkspace?.name || "الشركة المفتوحة"} — اختر رسالة ثم صدّر الصورة أو PDF.`}
          </div>
          <div className={`phone-frame frame-${deviceStyle}`}>
            {previewMode === "conversation"
              ? <ConversationPhone clockMode={clockMode} conversation={selectedConversation} customTime={customTime} deviceStyle={deviceStyle} onSelect={(id) => { setSelectedMessageId(id); setPreviewMode("details"); }} selectedId={selectedMessage?.id} theme={theme} />
              : <EvidencePhone clockMode={clockMode} customTime={customTime} deviceStyle={deviceStyle} message={selectedMessage} theme={theme} />}
          </div>
          <div className="stage-footer">
            <span><Icon path={mdiCheck} size={0.72} /> صورة الهاتف لا تعرض أدوات الموقع</span>
            <span className="developer-credit">nasseh zaher alnaman by N9 TOOLS</span>
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
        <div className="selection-mode" aria-label="طريقة اعتماد الدليل">
          <button aria-pressed={selectionMode === "manual"} className={selectionMode === "manual" ? "is-active" : ""} onClick={switchToManual} type="button"><strong>اختيار يدوي</strong><small>أنت تعتمد الرسالة</small></button>
          <button aria-pressed={selectionMode === "auto"} className={selectionMode === "auto" ? "is-active" : ""} onClick={switchToAutomatic} type="button"><strong>اقتراح تلقائي</strong><small>أفضل رسالة لكل رقم</small></button>
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
          <label className="candidate-sort candidate-direction">
            <span>النوع</span>
            <select
              aria-label="فلترة الرسائل المرشحة حسب الاتجاه"
              onChange={(event) => {
                setCandidateDirection(event.target.value);
                setCandidateLimits({});
              }}
              value={candidateDirection}
            >
              <option value="all">الكل</option>
              <option value="incoming">واردة</option>
              <option value="outgoing">صادرة</option>
            </select>
          </label>
        </div>
        <div className={`selection-status-card ${batchExportItems.length ? "is-ready" : "is-pending"}`} aria-label="حالة اختيار الأدلة">
          <div className="result-summary">
            <span className="result-icon"><Icon path={batchExportItems.length ? mdiCheckCircle : mdiAlertCircleOutline} size={1.02} /></span>
            <span>
              <strong>{selectedBatchItems.length
                ? `${selectedBatchItems.length.toLocaleString("ar-SA")} رسالة محددة للتصدير`
                : selectionMode === "manual"
                  ? `${selectedEvidenceMatches.length.toLocaleString("ar-SA")} دليل معتمد يدويًا`
                  : `${selectedEvidenceMatches.length.toLocaleString("ar-SA")} اقتراح تلقائي جاهز`}</strong>
              <small>{matches.length.toLocaleString("ar-SA")} رسالة مرشحة · {matchTerms.length.toLocaleString("ar-SA")} رقم بحث</small>
            </span>
          </div>
          <div className="selection-quick-actions">
            <button disabled={!matches.length || exportBusy} onClick={selectAllVisibleCandidates} type="button">تحديد الكل</button>
            <button disabled={!selectedBatchItems.length || exportBusy} onClick={clearBatchSelection} type="button">مسح التحديد</button>
          </div>
          <small className="selection-help">اضغط على نص الرسالة لمعاينتها واعتمادها، أو على الدائرة لاختيار عدة رسائل للتصدير.</small>
        </div>
        <div className="matches-heading"><span>الرسائل المرشحة</span><span>{matchGroups.length.toLocaleString("ar-SA")} مجموعة أرقام</span></div>
        <div className="match-results">
          {matchTerms.length ? matchGroups.slice(0, matchGroupLimit).map((group) => {
            const candidateLimit = candidateLimits[group.term] || MATCH_CANDIDATE_RENDER_BATCH;
            const renderedCandidates = group.visibleCandidates.slice(0, candidateLimit);
            return (
            <section className="match-group" key={group.term}>
              <header><strong dir="ltr">{group.term}</strong><span>{group.visibleCandidates.length === group.candidates.length ? `${group.candidates.length.toLocaleString("ar-SA")} رسالة` : `${group.visibleCandidates.length.toLocaleString("ar-SA")} من ${group.candidates.length.toLocaleString("ar-SA")}`}</span></header>
              {!group.candidates.length && (
                <div className="unmatched-number"><Icon path={mdiAlertCircleOutline} size={0.82} /><span><strong>لا توجد رسالة مطابقة</strong><small>أُبقي الرقم ظاهرًا حتى لا يُستبعد بصمت.</small></span></div>
              )}
              {group.candidates.length > 0 && !group.visibleCandidates.length && (
                <div className="unmatched-number filtered-empty"><Icon path={mdiMagnify} size={0.82} /><span><strong>لا توجد نتيجة ضمن الفلاتر</strong><small>اختر «الكل» أو امسح البحث لعرض الرسائل كاملة.</small></span></div>
              )}
              {renderedCandidates.map(({ message, scoreByTerm }) => {
                const chosenId = selectedByTerm[group.term] || (selectionMode === "auto" ? group.recommendedId : "");
                const isChosen = chosenId === message.id;
                const isRecommended = group.recommendedId === message.id;
                const isBatchSelected = Boolean(batchSelection[message.id]);
                return (
                  <article className={`match-item ${isChosen ? "is-chosen" : ""} ${isBatchSelected ? "is-batch-selected" : ""} ${selectedMessage?.id === message.id ? "is-previewed" : ""}`} key={`${group.term}-${message.id}`}>
                    <button aria-label={isBatchSelected ? "إزالة الرسالة من التحديد المتعدد" : "إضافة الرسالة إلى التحديد المتعدد"} aria-pressed={isBatchSelected} className="candidate-check" onClick={() => toggleBatchCandidate(group.term, message)} title="تحديد للتصدير" type="button"><Icon path={isBatchSelected ? mdiCheckCircle : mdiCircleOutline} size={0.76} /></button>
                    <button className="candidate-copy candidate-preview" onClick={() => selectCandidate(group.term, message)} type="button">
                      <span className="match-item-top"><strong>{message.contactName === "(Unknown)" ? message.address : message.contactName}</strong><small>{formatShortDate(message.date)} · {formatTime(message.date)}</small></span>
                      <span className="match-snippet">{message.body}</span>
                      <span className="candidate-meta">{isRecommended ? "اقتراح النظام" : "رسالة بديلة"} · {isChosen ? (selectionMode === "manual" ? "معتمدة يدويًا" : "المقترح المعتمد") : "اضغط للاعتماد"} · {message.type === "2" ? "صادرة" : "واردة"} · درجة {scoreByTerm?.[group.term] || 0}</span>
                    </button>
                  </article>
                );
              })}
              {group.visibleCandidates.length > candidateLimit && (
                <button className="list-window-control compact" onClick={() => setCandidateLimits((current) => ({
                  ...current,
                  [group.term]: Math.min(candidateLimit + MATCH_CANDIDATE_RENDER_BATCH, group.visibleCandidates.length),
                }))} type="button">
                  عرض {Math.min(MATCH_CANDIDATE_RENDER_BATCH, group.visibleCandidates.length - candidateLimit).toLocaleString("ar-SA")} ترشيح آخر
                </button>
              )}
            </section>
            );
          }) : <div className="empty-results"><Icon path={mdiMagnify} size={1.3} /><strong>لا توجد أرقام بعد</strong><span>أضف رقمًا ثم نفّذ المطابقة.</span></div>}
          {matchGroups.length > matchGroupLimit && (
            <button className="list-window-control" onClick={() => setMatchGroupLimit((current) => Math.min(current + MATCH_GROUP_RENDER_BATCH, matchGroups.length))} type="button">
              عرض {Math.min(MATCH_GROUP_RENDER_BATCH, matchGroups.length - matchGroupLimit).toLocaleString("ar-SA")} رقم مطابق آخر
              <small>لم تُستبعد أي أرقام؛ يتم عرض مجموعات المطابقة على دفعات.</small>
            </button>
          )}
        </div>
        <div className="export-actions">
          <button disabled={!batchExportItems.length || exportBusy} onClick={exportAllImages} type="button"><Icon path={mdiImageMultipleOutline} size={0.8} /> صور / ZIP</button>
          <button disabled={!batchExportItems.length || exportBusy} onClick={exportAllPdfs} type="button"><Icon path={mdiFileDocumentOutline} size={0.8} /> PDF / ZIP</button>
          <button disabled={!batchExportItems.length || exportBusy} onClick={exportCsv} type="button"><Icon path={mdiDownload} size={0.8} /> CSV</button>
          <small>{selectedBatchItems.length ? "سيُصدّر التحديد المتعدد فقط." : selectionMode === "manual" ? "اختر رسالة يدويًا لتفعيل التصدير." : "سيُصدّر الاقتراح التلقائي لكل رقم."}</small>
        </div>
      </aside>

      {importOpen && <ImportDialog busy={busy} onClose={() => !busy && setImportOpen(false)} onSheet={handleSheetUpload} onXml={handleXmlUpload} />}
      {canCreateManualMessages && composerOpen && <MessageComposerDialog busy={busy} conversations={conversations} onClose={() => { if (!busy) { setComposerOpen(false); setActiveNav("messages"); } }} onCreate={handleCreateManualMessage} selectedAddress={selectedConversation?.address} />}
      {workspaceDialogOpen && <WorkspaceDialog activeId={activeWorkspace?.id} busy={managementBusy} onClose={() => setWorkspaceDialogOpen(false)} onCreate={handleCreateWorkspace} onSelect={handleSelectWorkspace} workspaces={workspaces} />}
      {usersDialogOpen && <UsersDialog currentUser={currentUser} loading={managementBusy} onClose={() => setUsersDialogOpen(false)} onCreate={handleCreateUser} onUpdate={handleUpdateUser} users={users} workspaces={workspaces} />}
      {conversationExportProgress && <ConversationExportProgress collapsed={conversationExportCollapsed} onToggle={() => setConversationExportCollapsed((current) => !current)} progress={conversationExportProgress} />}
      {toast && <div className="toast" role="status"><Icon path={mdiCheckCircle} size={0.82} />{toast}</div>}

      <div className={`export-capture ${(exportCaptureSettings?.deviceStyle || deviceStyle) === "iphone" ? "iphone-export-capture" : ""}`} aria-hidden="true">
        <div ref={captureRef}><EvidencePhone capture clockMode={exportCaptureSettings?.clockMode || clockMode} customTime={exportCaptureSettings?.customTime || customTime} deviceStyle={exportCaptureSettings?.deviceStyle || deviceStyle} message={exportingMatch || selectedMessage} theme={exportCaptureSettings?.theme || theme} /></div>
      </div>
    </main>
  );
}
