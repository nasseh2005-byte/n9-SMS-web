import { useEffect, useMemo, useState } from "react";
import { getConversationPermissions, saveConversationPermissions } from "./workspaceApi.js";
import { normalizeComparable } from "./dataUtils.js";

export function ConversationPermissionsEditor({ user, workspaces }) {
  const [open, setOpen] = useState(false);
  const [workspaceId, setWorkspaceId] = useState("");
  const [data, setData] = useState(null);
  const [mode, setMode] = useState("selected");
  const [selected, setSelected] = useState(new Set());
  const [query, setQuery] = useState("");
  const [limit, setLimit] = useState(100);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState("");
  const assigned = workspaces.filter((workspace) => user.workspaceIds?.includes(workspace.id));
  const activeId = assigned.some((workspace) => workspace.id === workspaceId) ? workspaceId : assigned[0]?.id || "";

  useEffect(() => {
    if (!open || !activeId) return undefined;
    let cancelled = false;
    setLoading(true);
    setData(null);
    setNotice("");
    setQuery("");
    setLimit(100);
    getConversationPermissions(user.id, activeId).then((result) => {
      if (cancelled) return;
      setData(result);
      setMode(result.policy.mode);
      setSelected(new Set(result.policy.addresses));
    }).catch((error) => { if (!cancelled) setNotice(error.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [open, activeId, user.id]);

  const visible = useMemo(() => {
    const term = normalizeComparable(query);
    return (data?.conversations || []).filter((item) => !term || normalizeComparable(`${item.name} ${item.address}`).includes(term));
  }, [data, query]);

  async function save() {
    setSaving(true);
    setNotice("");
    try {
      await saveConversationPermissions(user.id, activeId, { mode, addresses: [...selected], expectedRevision: data.policy.revision });
      const result = await getConversationPermissions(user.id, activeId);
      setData(result);
      setMode(result.policy.mode);
      setSelected(new Set(result.policy.addresses));
      setNotice("تم حفظ المحادثات المسموح بها لهذا المستخدم.");
    } catch (error) { setNotice(error.message); }
    finally { setSaving(false); }
  }

  if (user.role === "admin") return null;
  return (
    <div className="conversation-permissions-editor">
      <button aria-expanded={open} className="conversation-permissions-open" onClick={() => setOpen(!open)} disabled={saving} type="button">{open ? "إغلاق اختيار المحادثات" : "تحديد المحادثات المسموح بها"}</button>
      {open && <div className="conversation-permissions-content">
        {!assigned.length ? <p>احفظ تفويض شركة للمستخدم أولًا، ثم اختر محادثاتها.</p> : <>
          <label>الشركة<select aria-label={`شركة محادثات ${user.username}`} disabled={saving} onChange={(event) => setWorkspaceId(event.target.value)} value={activeId}>{assigned.map((workspace) => <option key={workspace.id} value={workspace.id}>{workspace.name}</option>)}</select></label>
          {loading && <p role="status">جاري تحميل أسماء المحادثات…</p>}
          {data && !loading && <>
            <label>نطاق العرض<select aria-label={`نطاق محادثات ${user.username}`} disabled={saving} onChange={(event) => setMode(event.target.value)} value={mode}><option value="selected">محادثات محددة فقط</option><option value="all">كل المحادثات الحالية والمستقبلية</option></select></label>
            {mode === "all" ? <p>سيتمكن المستخدم من فتح كل محادثات هذه الشركة، بما فيها أي محادثات تُضاف لاحقًا.</p> : <>
              <p>المستخدم يرى الرسائل داخل المحادثات المختارة فقط، ويستطيع البحث فيها وتصديرها. المحادثات الجديدة تحتاج تفويضًا منك.</p>
              <input aria-label={`البحث في محادثات ${user.username}`} placeholder="ابحث باسم المحادثة أو رقم المرسل" disabled={saving} value={query} onChange={(event) => { setQuery(event.target.value); setLimit(100); }} />
              <div className="conversation-permissions-tools"><strong>{selected.size.toLocaleString("ar-SA")} محادثة محددة</strong><button disabled={saving} onClick={() => setSelected((current) => new Set([...current, ...visible.map((item) => item.address)]))} type="button">تحديد نتائج البحث</button><button disabled={saving} onClick={() => setSelected(new Set())} type="button">مسح التحديد</button></div>
              <div className="conversation-permissions-list">
                {visible.slice(0, limit).map((item) => <label key={item.address}><input type="checkbox" disabled={saving} checked={selected.has(item.address)} onChange={() => setSelected((current) => { const next = new Set(current); if (next.has(item.address)) next.delete(item.address); else next.add(item.address); return next; })} /><span><strong>{item.name}</strong><small dir="auto">{item.address} · {item.count.toLocaleString("ar-SA")} رسالة</small></span></label>)}
                {!visible.length && <p>لا توجد محادثات مطابقة.</p>}
                {visible.length > limit && <button type="button" onClick={() => setLimit((current) => current + 100)}>عرض المزيد ({visible.length.toLocaleString("ar-SA")})</button>}
              </div>
              {!selected.size && <p>لن تظهر أي محادثة لهذا المستخدم في هذه الشركة بعد الحفظ.</p>}
            </>}
            <button className="save-permissions" disabled={saving} onClick={save} type="button">{saving ? "جاري الحفظ…" : "حفظ اختيار المحادثات"}</button>
          </>}
        </>}
        {notice && <p role="status">{notice}</p>}
      </div>}
    </div>
  );
}
